import { WebSocketServer, WebSocket } from 'ws';
import {
  answerInteraction,
  onOfficialMessage,
  onOfficialStatusChange,
  parseOfficialEvent,
  sendOfficialMessage,
  sendOfficialMedia,
  sendOfficialStreamMessage,
  mediaFileTypeOf,
  recallOfficialMessage,
  type InteractionCode,
  type SendMessageOptions,
  type StreamMessageOptions,
} from './official';
import {
  ACTION_NAMES,
  UNSUPPORTED_ACTIONS,
  buildGuildMessageEvent,
  buildInteractionEvent,
  buildJoinRequestEvent,
  buildNoticeEvent,
  runOfficialAction,
  type ActionReply,
  type OfficialActionHost,
  type OfficialEventHost,
} from './officialExtras';

/**
 * 「官方 API 没有」的拒绝表对外再导出一份。
 *
 * 流程作者/测试需要能问「这个 action 到底是没实现还是平台没有」；
 * 从翻译器导出比让上游再 import 一次 officialExtras 更贴近使用面。
 */
export { ACTION_NAMES, UNSUPPORTED_ACTIONS } from './officialExtras';
import { translateSegments, attachmentsToSegments } from './segmentTranslator';
import { emitSystemLog } from './runtimeEvents';
import { logger } from './logger';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { isPortFree, findFreePort as scanFreePort } from './portFinder';

/** 顺序UID起始值（1~100 预留，10000+ 自动分配） */
const UID_START = 10000;

/** 待发送消息数上限（背压触发阈值，按端口/翻译器实例隔离） */
const MAX_PENDING_SENDS = 1000;
/** WebSocket 发送缓冲区字节数上限（背压触发阈值，1MB） */
const MAX_WS_BUFFERED = 1024 * 1024;
/** 背压通知限流间隔（毫秒，每分钟最多 1 条通知） */
const BACKPRESSURE_NOTIFY_INTERVAL_MS = 60_000;
/**
 * 互动回调的兜底回执时限（毫秒）。
 *
 * 官方客户端在用户点按钮后会一直转圈，等机器人调 answer_interaction。
 * 流程若没接这个事件（或没配回执节点），用户看到的是「点了没反应」——
 * 到点自动回执「成功」，让按钮至少不卡住；流程自己回过的不会重复回。
 * 1.5s 是「够快看不出等待、又给流程留出同步处理时间」的折中。
 */
const INTERACTION_ACK_FALLBACK_MS = 1500;

/** 带重试的文件写入（失败时重试 maxRetries 次，间隔 100ms） */
async function writeWithRetry(filePath: string, content: string, maxRetries = 3): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      writeFileSync(filePath, content, 'utf-8');
      return;
    } catch (e) {
      logger.warn(`[translator] 写入文件失败 (尝试 ${i + 1}/${maxRetries}):`, e);
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 100));
      } else {
        throw e;
      }
    }
  }
}

/** 项目端口分配基准：translatorPort = 1000 + portBlock（见 ProjectService._buildFullConfig） */
export const TRANSLATOR_PORT_BASE = 1001;

/** 项目配置中与端口分配相关的字段（避免依赖完整 ProjectConfig 类型） */
export interface TranslatorPortConfig {
  translatorPort?: number;
  portBlock?: number;
}

/**
 * 解析项目应使用的翻译器端口（确定性，不探测）。
 *
 * 优先级：配置里保存的 translatorPort → 由 portBlock 推导（1000 + block） → 默认基准端口。
 */
export function resolveTranslatorPort(config: TranslatorPortConfig | null | undefined): number {
  const saved = Number(config?.translatorPort ?? 0);
  if (Number.isInteger(saved) && saved > 0) return saved;
  const block = Number(config?.portBlock ?? 0);
  if (Number.isInteger(block) && block > 0) return 1000 + block;
  return TRANSLATOR_PORT_BASE;
}

/**
 * 解析一个真正可用的翻译器端口：优先项目规范端口，被占用时才顺延。
 *
 * 修复背景（实测线上问题：运行时对 127.0.0.1:8080 反复 404）：
 * 1. 旧实现在端口缺失时直接 `findFreePort(8080)`，而 8080 是极易被第三方
 *    软件占用的端口（本机实测被 Steam web helper 占用）；
 * 2. 旧的 `findFreePort` 用 `try { server.listen() } catch` 判断占用，
 *    但 EADDRINUSE 是异步 'error' 事件，catch 永不触发 → 几乎无条件返回 8080；
 * 3. 旧探测绑定 `::`（双栈），与 127.0.0.1 上的既有监听不冲突，于是"探测成功"，
 *    而运行时客户端连的是 IPv4 → 连到别人的服务上。
 */
export async function resolveUsableTranslatorPort(
  config: TranslatorPortConfig | null | undefined,
  projectPath?: string,
): Promise<number> {
  // 该项目已有翻译器在跑：直接复用它的端口。
  // 否则（端口被自己在用 → isPortFree 判定为占用）会顺延出新端口，
  // 同一个项目就出现两个翻译器、各自连接官方网关 → 消息被重复处理。
  if (projectPath) {
    for (const translator of translators.values()) {
      if (translator['projectPath'] === projectPath) return translator.port;
    }
  }

  const preferred = resolveTranslatorPort(config);
  if (!translators.has(preferred) && (await isPortFree(preferred))) return preferred;
  logger.warn(`[translator] 端口 ${preferred} 不可用，顺延寻找空闲端口`);
  return findFreePort(preferred + 1);
}

/**
 * 查找空闲端口（从 startPort 开始查找，最多 100 个）。
 * 跳过已在用的翻译器端口；探测统一绑定 127.0.0.1（与运行时客户端同一地址族）。
 */
export async function findFreePort(startPort: number): Promise<number> {
  const limit = Math.min(startPort + 100, 65535);
  for (let port = startPort; port < limit; port++) {
    if (translators.has(port)) continue; // 已有翻译器在用
    if (await isPortFree(port)) return port;
  }
  // 极端情况：该区间全被占用，交给全端口扫描（无可用端口时抛错）
  return scanFreePort(limit);
}

interface MessageContext {
  eventId: string;
  msgId: string;
  msgSeq?: number;
  userOpenid: string;
  memberOpenid?: string;
  groupOpenid?: string;
}

/** 按端口管理多个翻译器实例（支持同时运行多个机器人项目） */
const translators = new Map<number, OneBotTranslator>();
const retryTimers = new Map<number, ReturnType<typeof setTimeout>>();

export async function startTranslator(
  projectPath: string,
  port: number,
  delay = 1000,
): Promise<void> {
  // 如果该端口已有翻译器在运行，直接返回（不重复创建）
  if (translators.has(port)) {
    logger.info(`[translator] 端口 ${port} 已有翻译器在运行，跳过`);
    return;
  }

  // 同一项目出现第二个翻译器时给出显式告警：多实例会各自连接官方网关，
  // 导致同一条消息被处理多次（实测出现过重复 hello/READY 与重复 C2C 消息）。
  // 只告警不阻断 —— 端口解析（resolveUsableTranslatorPort）已保证同一项目复用
  // 稳定端口，这里的作用是让异常情况在日志里可见。
  for (const [existingPort, existing] of translators) {
    if (existing['projectPath'] === projectPath) {
      logger.warn(
        `[translator] 项目已存在端口 ${existingPort} 的翻译器，端口 ${port} 将再创建一个实例（可能导致消息重复处理）`,
      );
    }
  }

  const timerKey = port;
  if (retryTimers.has(timerKey)) {
    clearTimeout(retryTimers.get(timerKey)!);
    retryTimers.delete(timerKey);
  }

  // 注意：translator 必须用 let，否则 while 循环体重新创建的实例无法赋值，
  // while 条件永远检查第一个实例，端口被占用时会无限重试消耗 CPU/内存
  const MAX_START_RETRIES = 5;
  let translator = new OneBotTranslator(projectPath, port);
  translators.set(port, translator);
  let retries = 0;

  // 等待真实绑定结果：占用错误是异步事件，靠读 translator.failed 判断会永远为 false
  let ok = await waitForTranslatorReady(translator);
  while (!ok && retries < MAX_START_RETRIES) {
    translator.stop();
    translators.delete(port);
    await new Promise((r) => {
      retryTimers.set(timerKey, setTimeout(r, delay));
    });
    translator = new OneBotTranslator(projectPath, port);
    translators.set(port, translator);
    retries++;
    ok = await waitForTranslatorReady(translator);
  }

  if (!ok) {
    translator.stop();
    translators.delete(port);
    throw new Error(`启动翻译器失败（端口 ${port} 不可用，已重试 ${MAX_START_RETRIES} 次）`);
  }
}

/** 等待翻译器完成绑定（带超时，避免绑定事件丢失时永久挂起） */
async function waitForTranslatorReady(
  translator: OneBotTranslator,
  timeoutMs = 3000,
): Promise<boolean> {
  return Promise.race<boolean>([
    translator.ready,
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

export function stopTranslator(projectPath?: string): void {
  // 如果指定了 projectPath，只停对应项目的翻译器
  // 如果不指定，停所有翻译器（向后兼容）
  for (const [port, translator] of translators) {
    if (projectPath && translator['projectPath'] !== projectPath) continue;
    if (retryTimers.has(port)) {
      clearTimeout(retryTimers.get(port)!);
      retryTimers.delete(port);
    }
    translator.stop();
    translators.delete(port);
  }
}

export function getTranslatorStatus(
  port?: number,
  projectPath?: string,
): {
  running: boolean;
  clients: number;
  port: number;
  messageCount?: number;
  recentEvents?: Array<{ time: string; content: string; type: string }>;
} {
  let t: OneBotTranslator | undefined;
  if (port !== undefined) {
    t = translators.get(port);
  } else if (projectPath) {
    for (const translator of translators.values()) {
      if (translator['projectPath'] === projectPath) {
        t = translator;
        break;
      }
    }
  } else {
    for (const translator of translators.values()) {
      t = translator;
      break;
    }
  }
  if (!t) return { running: false, clients: 0, port: port ?? 0 };
  return {
    running: true,
    clients: t.clientCount,
    port: t.port,
    messageCount: t.msgCount,
    recentEvents: t.events,
  };
}

/** 获取指定端口的翻译器实例（用于 injectTestMessage 等） */
export function getTranslatorByPort(port: number): OneBotTranslator | undefined {
  return translators.get(port);
}

/**
 * 注入一条测试消息，模拟群聊/私聊消息经过翻译器 → bot 的完整流程
 * @param chatType 'group'（默认）或 'c2c'，原实现硬编码 group 导致私聊测试无效
 * @param chatId 群聊时为 group_id，私聊时为 user_id；缺省使用测试占位值
 */
export function injectTestMessage(
  projectPath: string,
  message: string,
  chatType: 'group' | 'c2c' = 'group',
  chatId?: number,
): boolean {
  // 找到该项目的翻译器
  let targetTranslator: OneBotTranslator | undefined;
  for (const [, t] of translators) {
    if (t['projectPath'] === projectPath) {
      targetTranslator = t;
      break;
    }
  }
  if (!targetTranslator || targetTranslator.clientCount === 0) return false;
  const now = Math.floor(Date.now() / 1000);
  const isGroup = chatType === 'group';
  targetTranslator.broadcast({
    post_type: 'message',
    message_type: isGroup ? 'group' : 'private',
    sub_type: isGroup ? 'normal' : 'friend',
    group_id: isGroup ? (chatId ?? 99999) : undefined,
    user_id: isGroup ? 10000 : (chatId ?? 10000),
    message: [{ type: 'text', data: { text: message } }],
    raw_message: message,
    font: 0,
    message_id: now,
    self_id: 0,
    time: now,
  });
  return true;
}

class OneBotTranslator {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private ctx = new Map<string, MessageContext>();

  /**
   * 引用标识映射：OneBot 消息 id / 官方事件 id → REFIDX。
   *
   * 官方引用回复要的是 `REFIDX_xxx`，而流程里用户手里只有 OneBot 的 message_id，
   * 两者不是一个东西 —— 没有这层映射，「引用回复」对用户就是不可用的。
   * 两个来源：收到的消息（`message_scene.ext` 的 `msg_idx`）、自己发出的消息（响应 `ext_info.ref_idx`）。
   */
  private refIdxByMessageId = new Map<string, string>();

  /** UID 映射: uid ↔ openid */
  private uidToOpenid = new Map<number, string>();
  private openidToUid = new Map<string, number>();
  private uidNext = UID_START;

  /** message_id → {chatType, chatId} 映射，用于 delete_msg 撤回消息 */
  private messageIdToContext = new Map<string, { chatType: 'c2c' | 'group'; chatId: string }>();

  private unsubMessage: (() => void) | null = null;
  private unsubStatus: (() => void) | null = null;
  private alive = false;
  private botUserId = '';
  /**
   * 已回过执的互动 id。
   *
   * 官方对同一 interaction 重复回执会报「重复操作」，而流程可能先自己回执、
   * 兜底定时器随后又回一次 —— 用这个集合去重（显式回执时顺手清掉定时器）。
   */
  private answeredInteractions = new Set<string>();
  /** 互动兜底回执定时器（stop 必须清理，否则翻译器停了还会打官方接口） */
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private uidMappingPath = '';
  failed = false;

  /** 当前待发送消息数（用于背压检测，按翻译器实例隔离） */
  private pendingSends = 0;
  /** 上次背压通知时间戳（限流：每分钟最多 1 条） */
  private lastBackpressureNotify = 0;
  /** saveUidMapping 的延迟定时器引用（用于 stop 时清理） */
  private saveUidTimer: ReturnType<typeof setTimeout> | null = null;

  /** 消息计数（用于仪表盘显示） */
  private messageCount = 0;
  /** 最近事件记录（用于仪表盘"最近动态"，最多保留 50 条） */
  private recentEvents: Array<{ time: string; content: string; type: string }> = [];
  private readonly MAX_RECENT_EVENTS = 50;

  /**
   * 绑定结果：true=已开始监听，false=端口不可用等错误。
   * 用于让 startTranslator 能 await 真实的绑定结果（EADDRINUSE 是异步事件）。
   */
  readonly ready: Promise<boolean>;
  private readyResolve: ((ok: boolean) => void) | null = null;

  readonly port: number;

  constructor(
    private projectPath: string,
    port: number,
  ) {
    this.port = port;
    this.ready = new Promise<boolean>((resolve) => {
      this.readyResolve = resolve;
    });
    this.uidMappingPath = join(projectPath, '.qqbat', 'uid_mapping.json');
    this.loadUidMapping();
    this.start();
  }

  get clientCount(): number {
    return this.clients.size;
  }
  get msgCount(): number {
    return this.messageCount;
  }
  get events(): Array<{ time: string; content: string; type: string }> {
    return this.recentEvents;
  }

  /** 记录一条消息事件（用于仪表盘） */
  private recordEvent(content: string, type: 'message' | 'reply' | 'event'): void {
    this.messageCount++;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.recentEvents.unshift({ time, content, type });
    if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
      this.recentEvents.length = this.MAX_RECENT_EVENTS;
    }
  }

  /** 从磁盘加载 UID 映射 */
  private loadUidMapping(): void {
    const bakPath = this.uidMappingPath + '.bak';

    // 尝试加载主文件
    try {
      if (existsSync(this.uidMappingPath)) {
        const data = JSON.parse(readFileSync(this.uidMappingPath, 'utf-8'));
        this.uidNext = data.nextUid || UID_START;
        for (const [openid, uid] of Object.entries(data.mapping || {})) {
          const n = uid as number;
          this.uidToOpenid.set(n, openid);
          this.openidToUid.set(openid, n);
        }
        logger.info(
          `[translator] 加载 UID 映射: ${this.openidToUid.size} 个用户, nextUid=${this.uidNext}`,
        );
      }
    } catch (e) {
      logger.error('[translator] 加载 UID 映射失败:', e);
      // 主文件损坏，尝试从 .bak 备份恢复
      if (existsSync(bakPath)) {
        try {
          const bakRaw = readFileSync(bakPath, 'utf-8');
          const data = JSON.parse(bakRaw);
          this.uidNext = data.nextUid || UID_START;
          for (const [openid, uid] of Object.entries(data.mapping || {})) {
            const n = uid as number;
            this.uidToOpenid.set(n, openid);
            this.openidToUid.set(openid, n);
          }
          logger.info(
            `[translator] 从备份恢复 UID 映射: ${this.openidToUid.size} 个用户, nextUid=${this.uidNext}`,
          );
          // 恢复成功后将备份写回主文件
          try {
            writeFileSync(this.uidMappingPath, bakRaw, 'utf-8');
          } catch (e2) {
            logger.warn('[translator] 恢复后写回主文件失败:', e2);
          }
        } catch (e2) {
          logger.error('[translator] 从备份恢复 UID 映射失败:', e2);
        }
      }
    }
  }

  /** 保存 UID 映射到磁盘 */
  private saveUidMapping(): void {
    try {
      const mapping: Record<string, number> = {};
      for (const [openid, uid] of this.openidToUid) {
        mapping[openid] = uid;
      }
      const dir = join(this.projectPath, '.qqbat');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // 保存前先备份当前主文件到 .bak（若存在）
      if (existsSync(this.uidMappingPath)) {
        try {
          const current = readFileSync(this.uidMappingPath, 'utf-8');
          writeFileSync(this.uidMappingPath + '.bak', current, 'utf-8');
        } catch (e) {
          logger.warn('[translator] 备份 UID 映射文件失败:', e);
        }
      }

      // 带重试的异步写入；3 次均失败时通知前端
      const content = JSON.stringify({ nextUid: this.uidNext, mapping }, null, 2);
      void writeWithRetry(this.uidMappingPath, content).catch((e) => {
        logger.error('[translator] 保存 UID 映射失败:', e);
        emitSystemLog(this.projectPath, '保存 UID 映射失败（已重试3次）: ' + String(e), 'error');
      });
    } catch (e) {
      logger.error('[translator] 保存 UID 映射失败:', e);
    }
  }

  /** 获取或创建用户的顺序 UID */
  private getOrCreateUid(openid: string): number {
    const existing = this.openidToUid.get(openid);
    if (existing !== undefined) return existing;
    const uid = this.uidNext++;
    this.uidToOpenid.set(uid, openid);
    this.openidToUid.set(openid, uid);
    // 延迟保存（避免频繁写入），并记录定时器以便 stop 时清理
    if (this.saveUidTimer) clearTimeout(this.saveUidTimer);
    this.saveUidTimer = setTimeout(() => {
      this.saveUidTimer = null;
      this.saveUidMapping();
    }, 0);
    return uid;
  }

  /** 通过 UID 查找 openid（用于发消息时回查） */
  private getOpenidByUid(uid: number): string | undefined {
    return this.uidToOpenid.get(uid);
  }

  /** 将字符串哈希为正整数（OneBot V11 要求 message_id 为 int） */
  private hashToInt(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash << 5) - hash + s.charCodeAt(i);
      hash = hash & 0x7fffffff;
    }
    return hash || 1;
  }

  /** 获取 self_id 的整数表示 */
  private get selfIdNum(): number {
    return Number(this.botUserId) || 0;
  }

  private start(): void {
    try {
      // 绑定 127.0.0.1：与运行时客户端（FlowRuntime 默认 host）同一地址族。
      // 若绑定 :: （双栈），当别的程序占用 127.0.0.1:<port> 时绑定仍会"成功"，
      // 但客户端（IPv4）连到的是对方 —— 实测表现为运行时对 8080 反复 404。
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port, path: '/onebot/v11/ws' });
    } catch (e) {
      this.failed = true;
      logger.error(
        `[translator] 端口 ${this.port} 创建 WebSocket 服务失败: ${e instanceof Error ? e.message : String(e)}`,
      );
      this.readyResolve?.(false);
      this.readyResolve = null;
      return;
    }

    // 绑定失败（EADDRINUSE 等）是异步 'error' 事件：旧实现只在同步 catch 里设置
    // failed，端口被占用时仍会被当作"启动成功"，重试逻辑形同虚设。
    this.wss.on('error', (err: Error) => {
      this.failed = true;
      logger.error(`[translator] 端口 ${this.port} WebSocket 服务错误: ${err.message}`);
      this.readyResolve?.(false);
      this.readyResolve = null;
    });
    this.wss.on('listening', () => {
      logger.info(`[translator] 已监听 127.0.0.1:${this.port}`);
      this.readyResolve?.(true);
      this.readyResolve = null;
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info(`[translator] 运行时已连接 (当前客户端: ${this.clients.size})`);
      emitSystemLog(this.projectPath, '运行时已连接 (当前客户端: ' + this.clients.size + ')');
      this.sendMetaEvent(ws, 'lifecycle', {
        post_type: 'meta_event',
        meta_event_type: 'lifecycle',
        sub_type: 'connect',
        self_id: this.selfIdNum,
        time: Math.floor(Date.now() / 1000),
      });
      this.sendMetaEvent(ws, 'heartbeat', {
        post_type: 'meta_event',
        meta_event_type: 'heartbeat',
        status: { online: true, good: true },
        interval: 5000,
        self_id: this.selfIdNum,
        time: Math.floor(Date.now() / 1000),
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleAction(ws, msg);
        } catch {
          /* ignore */
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info(`[translator] 运行时断开 (剩余客户端: ${this.clients.size})`);
        emitSystemLog(this.projectPath, '运行时断开 (剩余客户端: ' + this.clients.size + ')');
      });
      ws.on('error', () => {
        this.clients.delete(ws);
        logger.info(`[translator] 运行时连接错误 (剩余客户端: ${this.clients.size})`);
      });
    });

    this.unsubMessage = onOfficialMessage((path, message) => {
      if (path !== this.projectPath) return;
      this.handleOfficialEvent(message.type, message.data as Record<string, unknown>);
    });

    this.unsubStatus = onOfficialStatusChange((path, status) => {
      if (path !== this.projectPath) return;
      if (status === 'connected') this.alive = true;
      else if (status === 'disconnected' || status === 'error') this.alive = false;
      this.broadcast({
        post_type: 'meta_event',
        meta_event_type: 'lifecycle',
        sub_type: status === 'connected' ? 'connect' : 'disable',
        self_id: this.selfIdNum,
        time: Math.floor(Date.now() / 1000),
      });
    });
  }

  stop(): void {
    // 先保存 UID 映射（保留持久化加固逻辑：重试 + .bak 备份）
    this.saveUidMapping();
    // 清理 saveUidMapping 的延迟定时器（防止 stop 后定时器仍触发）
    if (this.saveUidTimer) {
      clearTimeout(this.saveUidTimer);
      this.saveUidTimer = null;
    }
    // 互动兜底回执定时器同理：翻译器已停，不能再往官方接口发请求
    for (const timer of this.ackTimers.values()) clearTimeout(timer);
    this.ackTimers.clear();
    this.answeredInteractions.clear();
    // 取消事件订阅，置 null 防止 stop 被多次调用时重复取消
    this.unsubMessage?.();
    this.unsubMessage = null;
    this.unsubStatus?.();
    this.unsubStatus = null;
    // 关闭所有 WebSocket 客户端，移除监听器防止内存泄漏
    for (const ws of this.clients) {
      try {
        ws.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    // 关闭 WebSocket 服务器
    this.wss?.close();
    this.wss = null;
    // 清理内存缓存（多实例安全：只清理当前实例的缓存，不影响其他端口/项目）
    this.ctx.clear();
    this.uidToOpenid.clear();
    this.openidToUid.clear();
    // 清理消息上下文映射
    this.messageIdToContext.clear();
    // 重置背压状态
    this.pendingSends = 0;
    this.lastBackpressureNotify = 0;
  }

  public broadcast(data: Record<string, unknown>): void {
    const raw = JSON.stringify(data);
    // 不在终端输出调试日志（避免日志风暴），emitSystemLog 已在各事件处理中推送

    // 背压判定：heartbeat 视为非关键消息（可丢弃），其余（message/notice/request/lifecycle）视为关键
    const postType = String(data.post_type || '');
    const metaEventType = String(data.meta_event_type || '');
    const isCritical = !(postType === 'meta_event' && metaEventType === 'heartbeat');

    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      // 背压检查 1：当前待发送消息数超限，丢弃非关键消息（保留关键消息）
      if (this.pendingSends > MAX_PENDING_SENDS && !isCritical) {
        this.notifyBackpressure(
          `待发送消息数超限 (${this.pendingSends}/${MAX_PENDING_SENDS})，丢弃非关键消息(heartbeat)`,
        );
        continue;
      }

      // 背压检查 2：WebSocket 发送缓冲区满，丢弃非关键消息
      if (ws.bufferedAmount > MAX_WS_BUFFERED && !isCritical) {
        this.notifyBackpressure(
          `WebSocket 缓冲区满 (${ws.bufferedAmount} bytes)，丢弃非关键消息(heartbeat)`,
        );
        continue;
      }

      // 入队待发送，发送完成回调中递减计数
      this.pendingSends++;
      ws.send(raw, (err) => {
        this.pendingSends--;
        if (err) {
          logger.error('[translator] ws.send 失败:', err);
        }
      });
    }
  }

  /**
   * 通知背压触发（限流：每分钟最多 1 条通知，避免日志风暴）。
   * 通过 emitSystemLog 推送到前端"输出"面板。
   */
  private notifyBackpressure(reason: string): void {
    const now = Date.now();
    if (now - this.lastBackpressureNotify < BACKPRESSURE_NOTIFY_INTERVAL_MS) return;
    this.lastBackpressureNotify = now;
    emitSystemLog(this.projectPath, `背压触发: ${reason}`, 'warn');
  }

  private sendMetaEvent(ws: WebSocket, _type: string, data: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  private sendResponse(ws: WebSocket, echo: unknown, data: unknown = {}): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        data,
        echo,
      }),
    );
  }

  private sendError(ws: WebSocket, echo: unknown, msg: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        status: 'failed',
        retcode: 100,
        data: null,
        echo,
        message: msg,
      }),
    );
  }

  // ── 扩展能力的适配面（给 officialExtras 用，实例状态仍在本类）──

  /** action 侧：只暴露 UID↔openid 换算（扩展 action 最终都落到官方 openid 接口） */
  private actionHost(): OfficialActionHost {
    return {
      projectPath: this.projectPath,
      selfId: this.selfIdNum,
      botUserId: this.botUserId,
      openidOfUid: (uid: number) => this.getOpenidByUid(uid),
      uidOf: (openid: string) => this.getOrCreateUid(openid),
    };
  }

  /** 事件侧：官方推送事件里的 openid 换成 UID 再广播 */
  private eventHost(): OfficialEventHost {
    return {
      selfId: this.selfIdNum,
      uidOf: (openid: string) => this.getOrCreateUid(openid),
      hashToInt: (raw: string) => this.hashToInt(raw),
    };
  }

  /** 把 officialExtras 的 reply 回调接到 OneBot 回包（ok→sendResponse / fail→sendError） */
  private replyOf(ws: WebSocket, echo: unknown): ActionReply {
    return {
      ok: (data?: unknown) => this.sendResponse(ws, echo, data === undefined ? {} : data),
      fail: (msg: string) => this.sendError(ws, echo, msg),
    };
  }

  /**
   * 回执一次互动（幂等）。
   *
   * 显式回执会取消兜底定时器；已回过的不再打官方接口（重复回执会被官方拒绝）。
   */
  private async ackInteraction(interactionId: string, code: InteractionCode): Promise<void> {
    if (!interactionId) return;
    if (this.answeredInteractions.has(interactionId)) return;
    const timer = this.ackTimers.get(interactionId);
    if (timer) {
      clearTimeout(timer);
      this.ackTimers.delete(interactionId);
    }
    this.answeredInteractions.add(interactionId);
    const res = await answerInteraction(this.projectPath, interactionId, code);
    if (!res.ok) {
      emitSystemLog(
        this.projectPath,
        '互动回执失败（' + interactionId + '）：' + (res.error || '官方 API 返回失败'),
        'warn',
      );
    }
  }

  /** 登记兜底回执（同一 interaction 只登记一次） */
  private scheduleAckFallback(interactionId: string): void {
    if (!interactionId || this.ackTimers.has(interactionId)) return;
    const timer = setTimeout(() => {
      this.ackTimers.delete(interactionId);
      void this.ackInteraction(interactionId, 0 as InteractionCode);
    }, INTERACTION_ACK_FALLBACK_MS);
    this.ackTimers.set(interactionId, timer);
  }

  // ── 发送辅助：三个 send action 共用的唯一发送路径 ──

  /** 登记「消息 id → REFIDX」（收到的消息与自己发出的消息都要记，否则引用回复用不了） */
  private recordRefIdx(messageId: string | number, refIdx: string): void {
    if (!messageId || !refIdx) return;
    this.refIdxByMessageId.set(String(messageId), refIdx);
  }

  /**
   * 消息 id / REFIDX → REFIDX。
   *
   * 已经是 `REFIDX` 开头的原样透传（用户可能直接从事件里拿到），否则查映射表。
   * 查不到返回空串，**由调用方明确报错** —— 不能悄悄丢掉引用。
   */
  private resolveRefIdx(v: string): string {
    const s = String(v || '').trim();
    if (!s) return '';
    if (s.startsWith('REFIDX')) return s;
    return this.refIdxByMessageId.get(s) || '';
  }

  /**
   * 组装发送参数：eventId / msgId 从会话上下文取，msgSeq 每次递增。
   *
   * 递增是硬要求：官方对同一 `msg_id` 下重复的 `msg_seq` 返回 40054005（去重），
   * 所以「一条链发多条消息」必须每次换一个值。
   * `isWakeup`（互动召回）与 event_id/msg_id **互斥**，为 true 时不带它们。
   */
  private nextSendOptions(
    ctx: MessageContext | undefined,
    extra: { isWakeup?: boolean } = {},
  ): SendMessageOptions {
    const opts: SendMessageOptions = {};
    if (extra.isWakeup) {
      opts.isWakeup = true;
    } else if (ctx) {
      if (ctx.eventId) opts.eventId = ctx.eventId;
      if (ctx.msgId) opts.msgId = ctx.msgId;
    }
    if (ctx?.msgSeq != null) {
      opts.msgSeq = ctx.msgSeq;
      ctx.msgSeq = (ctx.msgSeq + 1) & 0x7fffffff;
    }
    return opts;
  }

  /**
   * 把一条 OneBot 消息发到官方 API。
   *
   * 在它之前，`send_private_msg` / `send_msg` / `send_group_msg` 各写一遍
   * 「extractText → sendOfficialMessage」，而 `extractText` 只认 text 段 ——
   * 于是 image / record / face / reply 等段在三条路径上都被静默丢弃，
   * 最后发出 `content: ''` 的空消息（不报错、不告警）。
   *
   * 现在的规则：
   *   1. markdown + keyboard 段 → `msg_type=2`（既有行为不变）；
   *   2. 否则按段翻译：文本走 `msg_type=0`、媒体逐个上传后走 `msg_type=7`；
   *   3. 什么都发不出去 → **返回错误并列出无法映射的段**，不再发空消息；
   *   4. 有内容但也有认不出的段 → 照发，并把丢掉的段写进系统日志（warn）。
   */
  private async sendSegmentsToOfficial(
    chatType: 'c2c' | 'group',
    openid: string,
    message: unknown,
    ctx: MessageContext | undefined,
    extra: { replyTo?: string; isWakeup?: boolean } = {},
  ): Promise<{ ok: boolean; id: string; error: string }> {
    // 引用回复：先解析 REFIDX，解析不到就明确报错
    let messageReference: { message_id: string } | undefined;
    if (extra.replyTo) {
      const ref = this.resolveRefIdx(extra.replyTo);
      if (!ref) {
        return {
          ok: false,
          id: '',
          error:
            `找不到引用消息的 REFIDX（${extra.replyTo}）：QQ 官方只支持引用「本会话内收到或发出过的消息」，` +
            '也可以直接传 REFIDX_ 开头的标识',
        };
      }
      messageReference = { message_id: ref };
    }

    // 1. markdown + keyboard 段（按钮UI / Markdown 文本模式）
    const mk = this.extractMarkdownKeyboard(message);
    if (mk) {
      const opts = this.nextSendOptions(ctx, extra);
      if (messageReference) opts.messageReference = messageReference;
      const res = await sendOfficialMessage(this.projectPath, chatType, openid, '', {
        msgType: 2,
        markdown: { content: mk.markdown },
        ...(mk.keyboard ? { keyboard: mk.keyboard } : {}),
        ...opts,
      });
      const id = res.data?.id || '';
      if (id) this.recordRefIdx(id, res.data?.refIdx || '');
      return { ok: res.ok, id, error: res.ok ? '' : '发送 Markdown 消息失败（详见日志）' };
    }

    // 2. 通用消息段翻译（纯函数，见 segmentTranslator.ts）
    const translated = translateSegments(message, {
      resolveOpenid: (uid) => {
        const n = Number(uid);
        return Number.isFinite(n) ? this.getOpenidByUid(n) : undefined;
      },
      resolveRefIdx: (v) => this.resolveRefIdx(v),
    });

    // 段里带的引用（reply 段）与参数里的 replyTo，参数优先
    const ref =
      messageReference ?? (translated.reference ? { message_id: translated.reference } : undefined);

    if (!translated.text && translated.media.length === 0) {
      // 这就是「静默发空消息」的修复点：认不出的段必须报出来
      const detail = translated.unsupported.length
        ? `无法发送的段：${translated.unsupported.join('；')}`
        : '消息里没有任何可发送的内容（文本与媒体都为空）';
      return { ok: false, id: '', error: `消息未发送：${detail}` };
    }
    if (translated.unsupported.length) {
      emitSystemLog(
        this.projectPath,
        '部分消息段被丢弃（官方接入不支持）：' + translated.unsupported.join('；'),
        'warn',
      );
    }
    for (const w of translated.warnings) emitSystemLog(this.projectPath, w, 'warn');

    let firstId = '';

    // 3. 文本 → msg_type=0
    if (translated.text) {
      const opts = this.nextSendOptions(ctx, extra);
      if (ref) opts.messageReference = ref;
      const res = await sendOfficialMessage(
        this.projectPath,
        chatType,
        openid,
        translated.text,
        opts,
      );
      if (!res.ok) return { ok: false, id: firstId, error: '文本发送失败（详见日志）' };
      if (res.data?.id) {
        firstId = firstId || res.data.id;
        this.recordRefIdx(res.data.id, res.data.refIdx || '');
      }
    }

    // 4. 媒体 → 先上传拿 file_info，再 msg_type=7
    for (const part of translated.media) {
      const opts = this.nextSendOptions(ctx, extra);
      if (ref) opts.messageReference = ref;
      const res = await sendOfficialMedia(
        this.projectPath,
        chatType,
        openid,
        part.url,
        part.fileType,
        part.fileName,
        opts,
      );
      if (!res.ok) {
        return {
          ok: false,
          id: firstId,
          error: `媒体发送失败（file_type=${part.fileType}, url=${part.url}），详见日志`,
        };
      }
      if (res.data?.id) {
        firstId = firstId || res.data.id;
        this.recordRefIdx(res.data.id, res.data.refIdx || '');
      }
    }

    return { ok: true, id: firstId, error: '' };
  }

  /**
   * 从官方原始事件里提取**接收侧**信息。
   *
   * 历史问题：`attachments` 被解析后挂在没人消费的 `parsed` 字段上，`ark_data` /
   * `msg_elements` / `message_scene` 全仓库零解析，于是用户发来的图片、结构卡片、
   * 引用内容在流程里完全看不到 —— 附件信息在翻译层就被丢了。
   *
   * 返回两部分：
   *   · `attachmentSegments` —— 附件合成的消息段，拼到 `message` 里（`get_context`
   *     的 `message_part` 与表达式因此看得到 image / record / video / file）；
   *   · `fields` —— 附加字段（含 `_ref_idx`，即引用回复要用的 REFIDX）。
   */
  private receiveExtrasOf(
    type: string,
    data: Record<string, unknown>,
  ): {
    attachmentSegments: Array<{ type: string; data: Record<string, unknown> }>;
    fields: Record<string, unknown>;
  } {
    const parsed = parseOfficialEvent(type, data);
    const attachmentSegments = attachmentsToSegments(parsed.attachments);
    const fields: Record<string, unknown> = {};
    if (parsed.attachments?.length) fields.attachments = parsed.attachments;
    if (parsed.arkData) fields.ark_data = parsed.arkData;
    if (parsed.msgElements) fields.msg_elements = parsed.msgElements;
    if (parsed.messageScene) {
      fields.message_scene = parsed.messageScene;
      // 本会话内这条消息的 REFIDX：`reply_to` 直接传它即可引用
      if (parsed.messageScene.refIdx) {
        fields._ref_idx = parsed.messageScene.refIdx;
        // 收到的消息也要登记进「消息 id → REFIDX」表（官方只允许引用本会话内收到/发出过的消息）。
        // 登记后用户在「引用回复」端口直接填当前会话的 message_id 就能引用，不必自己去找 REFIDX。
        this.recordRefIdx(this.hashToInt(String(data.id || '')), parsed.messageScene.refIdx);
      }
    }
    return { attachmentSegments, fields };
  }

  private handleOfficialEvent(type: string, data: Record<string, unknown>): void {
    const eventId = data.id as string;
    const author = data.author as Record<string, unknown> | undefined;
    const content = (data.content as string) || '';
    const ts = Math.floor(Date.now() / 1000);

    // hello 事件：一次性的连接确认，推送到面板
    if (type === 'hello') {
      emitSystemLog(
        this.projectPath,
        '收到官方事件: type=' + type + ', content="' + content.slice(0, 50) + '"',
      );
    }
    if (type === 'READY') {
      const user = data.user as Record<string, unknown> | undefined;
      if (user) {
        this.botUserId = String(user.id || '');
        emitSystemLog(this.projectPath, 'READY: botUserId=' + this.botUserId);
      }
    }

    if (type === 'C2C_MESSAGE_CREATE') {
      const userOpenid = (author?.user_openid as string) || (author?.id as string) || '';
      if (!userOpenid) return;
      const extras = this.receiveExtrasOf(type, data);
      const uid = this.getOrCreateUid(userOpenid);
      emitSystemLog(
        this.projectPath,
        'C2C消息: user=' + userOpenid + ', UID=' + uid + ', content="' + content.slice(0, 50) + '"',
      );
      this.recordEvent(content, 'message');

      this.ctx.set(userOpenid, {
        eventId,
        msgId: eventId,
        // C2C 事件不携带 msg_seq，初始化为 1，每次发送后递增，避免连续发送被 QQ API 去重
        msgSeq: 1,
        userOpenid,
        groupOpenid: undefined,
      });

      this.broadcast({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        to_me: true,
        time: ts,
        self_id: this.selfIdNum,
        user_id: uid,
        message_id: this.hashToInt(eventId),
        _openid: userOpenid,
        message: [{ type: 'text', data: { text: content } }, ...extras.attachmentSegments],
        raw_message: content,
        font: 0,
        sender: { user_id: uid, nickname: '', sex: 'unknown', age: 0 },
        ...extras.fields,
      });
    }

    if (type === 'GROUP_AT_MESSAGE_CREATE') {
      const groupOpenid = data.group_openid as string;
      const memberOpenid = (author?.member_openid as string) || '';
      const userOpenid = (author?.user_openid as string) || '';
      const chatUid = memberOpenid || userOpenid;
      if (!groupOpenid || !chatUid) return;
      const extras = this.receiveExtrasOf(type, data);
      const uid = this.getOrCreateUid(chatUid);
      const groupUid = this.getOrCreateUid(groupOpenid);
      emitSystemLog(
        this.projectPath,
        '群@消息: group=' +
          groupOpenid +
          ', user=' +
          chatUid +
          ', UID=' +
          uid +
          ', content="' +
          content.slice(0, 50) +
          '"',
      );
      this.recordEvent(content, 'message');

      this.ctx.set(groupOpenid, {
        eventId,
        msgId: eventId,
        // 群消息事件可能不携带 msg_seq，初始化为 1，每次发送后递增，避免连续发送被 QQ API 去重
        msgSeq: (data.msg_seq as number | undefined) ?? 1,
        userOpenid,
        memberOpenid,
        groupOpenid,
      });

      this.broadcast({
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        to_me: true,
        time: ts,
        self_id: this.selfIdNum,
        group_id: groupUid,
        user_id: uid,
        message_id: this.hashToInt(eventId),
        _openid: chatUid,
        message: [
          { type: 'at', data: { qq: String(uid) } },
          { type: 'text', data: { text: content } },
          ...extras.attachmentSegments,
        ],
        raw_message: content,
        font: 0,
        sender: { user_id: uid, nickname: '', sex: 'unknown', age: 0, role: 'member', area: '' },
        ...extras.fields,
      });
    }

    if (type === 'GROUP_MESSAGE_CREATE') {
      const groupOpenid = data.group_openid as string;
      const memberOpenid = (author?.member_openid as string) || '';
      const userOpenid = (author?.user_openid as string) || '';
      const chatUid = memberOpenid || userOpenid;
      if (!groupOpenid || !chatUid) return;
      const extras = this.receiveExtrasOf(type, data);
      const groupUid = this.getOrCreateUid(groupOpenid);

      const isToMe = content.includes('<@') || content.startsWith('/');
      const uid = this.getOrCreateUid(chatUid);
      emitSystemLog(
        this.projectPath,
        '群消息: group=' +
          groupOpenid +
          ', user=' +
          chatUid +
          ', UID=' +
          uid +
          ', content="' +
          content.slice(0, 50) +
          '", to_me=' +
          isToMe,
      );

      this.ctx.set(groupOpenid, {
        eventId,
        msgId: eventId,
        // 群消息事件可能不携带 msg_seq，初始化为 1，每次发送后递增，避免连续发送被 QQ API 去重
        msgSeq: (data.msg_seq as number | undefined) ?? 1,
        userOpenid,
        memberOpenid,
        groupOpenid,
      });

      const cleanContent = content.replace(/<@[^>]+>\s*/g, '').trim();
      this.recordEvent(cleanContent || content, 'message');

      this.broadcast({
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        to_me: isToMe,
        time: ts,
        self_id: this.selfIdNum,
        group_id: groupUid,
        user_id: uid,
        message_id: this.hashToInt(eventId),
        _openid: chatUid,
        message: [{ type: 'text', data: { text: cleanContent } }, ...extras.attachmentSegments],
        raw_message: cleanContent,
        font: 0,
        sender: { user_id: uid, nickname: '', sex: 'unknown', age: 0, role: 'member', area: '' },
        ...extras.fields,
      });
    }

    // ── 扩展事件（群成员/消息审核/入群申请/互动回调/频道消息）──
    // 「官方字段 → OneBot 键名」的映射都在 officialExtras，
    // 这里只负责取时间戳、广播，以及互动回执的兜底定时器。
    const eventHost = this.eventHost();

    if (type === 'INTERACTION_CREATE') {
      const built = buildInteractionEvent(eventHost, data, ts);
      if (!built) return;
      this.recordEvent('互动回调: ' + built.interactionId, 'event');
      this.broadcast(built.payload);
      if (built.needAck) this.scheduleAckFallback(built.interactionId);
      return;
    }

    if (type === 'GROUP_JOIN_REQUEST') {
      const payload = buildJoinRequestEvent(eventHost, data, ts);
      if (!payload) return;
      this.recordEvent('入群申请', 'event');
      this.broadcast(payload);
      return;
    }

    if (type === 'AT_MESSAGE_CREATE' || type === 'MESSAGE_CREATE') {
      // 频道消息的 message_id 是雪花 id，流程侧只认整数，走 hashToInt
      const payload = buildGuildMessageEvent(eventHost, type, data, ts);
      if (!payload) return;
      this.recordEvent(String(payload.raw_message ?? ''), 'message');
      this.broadcast(payload);
      return;
    }

    const notice = buildNoticeEvent(eventHost, type, data, ts);
    if (notice) {
      this.recordEvent(String(notice.notice_type ?? type), 'event');
      this.broadcast(notice);
    }
  }

  private handleAction(ws: WebSocket, msg: Record<string, unknown>): void {
    const action = msg.action as string;
    const params = (msg.params as Record<string, unknown>) || {};
    const echo = msg.echo;
    // 不推送到面板（调试信息）
    const run = async () => {
      switch (action) {
        case 'send_private_msg': {
          const uid = Number(params.user_id || 0);
          const openid = this.getOpenidByUid(uid) || String(params.user_id || '');
          const ctx = this.ctx.get(openid);
          emitSystemLog(this.projectPath, '准备发送: UID=' + uid + ', openid=' + openid);
          const res = await this.sendSegmentsToOfficial('c2c', openid, params.message, ctx, {
            replyTo: String(params.reply_to || ''),
            isWakeup: params.is_wakeup === true,
          });
          if (res.id) this.messageIdToContext.set(res.id, { chatType: 'c2c', chatId: openid });
          if (!res.ok) this.sendError(ws, echo, res.error);
          else this.sendResponse(ws, echo, { message_id: res.id });
          break;
        }
        case 'send_msg': {
          const msgType = params.message_type as string;
          // 频道会话也走 send_msg（流程侧只认 message_type），转给频道通路：
          // 频道没有 user_id/group_id，只有 channel_id，退化成 c2c 会发错人。
          if (msgType === 'guild') {
            await runOfficialAction(
              this.actionHost(),
              'send_channel_msg',
              params,
              this.replyOf(ws, echo),
            );
            break;
          }
          const uid = Number(msgType === 'group' ? params.group_id || 0 : params.user_id || 0);
          // 没有目标就无法反查 openid：以前会拿 openid='0' 去发，官方 API 回一句
          // 「请求的资源不存在(用户/群已注销)」，把"没带目标"伪装成"用户不存在"（真机踩过）。
          if (!uid) {
            this.sendError(
              ws,
              echo,
              'send_msg 缺少目标：需要 user_id 或 group_id（"回复当前会话"请带上来源事件的目标）',
            );
            break;
          }
          const openid = this.getOpenidByUid(uid) || String(uid);
          const ctx = this.ctx.get(openid);
          const chatType = msgType === 'group' ? 'group' : 'c2c';
          const res = await this.sendSegmentsToOfficial(chatType, openid, params.message, ctx, {
            replyTo: String(params.reply_to || ''),
            // is_wakeup 只对单聊有效（官方群聊发消息接口没有该字段）
            isWakeup: chatType === 'c2c' && params.is_wakeup === true,
          });
          if (res.id) this.messageIdToContext.set(res.id, { chatType, chatId: openid });
          if (!res.ok) this.sendError(ws, echo, res.error);
          else this.sendResponse(ws, echo, { message_id: res.id });
          break;
        }
        case 'send_group_msg': {
          const uid = Number(params.group_id || 0);
          const openid = this.getOpenidByUid(uid) || String(params.group_id || '');
          const ctx = this.ctx.get(openid);
          const res = await this.sendSegmentsToOfficial('group', openid, params.message, ctx, {
            replyTo: String(params.reply_to || ''),
          });
          if (res.id) this.messageIdToContext.set(res.id, { chatType: 'group', chatId: openid });
          if (!res.ok) this.sendError(ws, echo, res.error);
          else this.sendResponse(ws, echo, { message_id: res.id });
          break;
        }
        case 'send_media': {
          // 富媒体（图片/视频/语音/文件）：先上传拿 file_info，再 msg_type=7 发送。
          // 官方是**服务端去拉 url** 再转存，所以本地路径发不出去，必须明确拒绝。
          const mMsgType = params.message_type as string;
          const mUid = Number(mMsgType === 'group' ? params.group_id || 0 : params.user_id || 0);
          if (!mUid) {
            this.sendError(ws, echo, 'send_media 缺少目标：需要 user_id 或 group_id');
            break;
          }
          const mOpenid = this.getOpenidByUid(mUid) || String(mUid);
          const mCtx = this.ctx.get(mOpenid);
          const mChatType = mMsgType === 'group' ? 'group' : 'c2c';

          const mediaUrl = String(params.url || '');
          if (!mediaUrl) {
            this.sendError(ws, echo, 'send_media 缺少 url（QQ 官方需要可公开拉取的 http(s) 直链）');
            break;
          }
          if (!/^https?:\/\//i.test(mediaUrl)) {
            this.sendError(
              ws,
              echo,
              `send_media 的 url 必须是 http(s) 直链（收到：${mediaUrl}）：官方由服务端拉取该地址`,
            );
            break;
          }
          // 类型：优先数字 file_type，否则按 media_type 名映射（共用 official.mediaFileTypeOf）
          const byName = mediaFileTypeOf(String(params.media_type || 'image'));
          const numFileType = Number(params.file_type);
          const fileType =
            Number.isInteger(numFileType) && numFileType >= 1 && numFileType <= 4
              ? (numFileType as 1 | 2 | 3 | 4)
              : byName;
          if (!fileType) {
            this.sendError(
              ws,
              echo,
              `无法识别的媒体类型：${String(params.media_type || params.file_type || '')}（可用 image/video/record/file）`,
            );
            break;
          }

          const mReplyTo = String(params.reply_to || '');
          let mReference: { message_id: string } | undefined;
          if (mReplyTo) {
            const ref = this.resolveRefIdx(mReplyTo);
            if (!ref) {
              this.sendError(ws, echo, `找不到引用消息的 REFIDX（${mReplyTo}）`);
              break;
            }
            mReference = { message_id: ref };
          }

          const mOpts = this.nextSendOptions(mCtx, {
            isWakeup: mChatType === 'c2c' && params.is_wakeup === true,
          });
          if (mReference) mOpts.messageReference = mReference;

          const mRes = await sendOfficialMedia(
            this.projectPath,
            mChatType,
            mOpenid,
            mediaUrl,
            fileType,
            String(params.file_name || ''),
            mOpts,
          );
          if (mRes.data?.id) {
            this.messageIdToContext.set(mRes.data.id, { chatType: mChatType, chatId: mOpenid });
            this.recordRefIdx(mRes.data.id, mRes.data.refIdx || '');
          }
          if (!mRes.ok) {
            this.sendError(ws, echo, '媒体发送失败：上传或发送被官方拒绝（详见日志）');
          } else {
            this.sendResponse(ws, echo, { message_id: mRes.data?.id || '' });
          }
          break;
        }
        case 'send_stream_msg': {
          // 流式消息：官方**仅单聊**（`POST /v2/users/{openid}/stream_messages`，群聊没有这个端点）。
          // 节点 `sendStream` 已把整段文本切好片，这里只做「一片 → 一次 API 调用」的翻译；
          // 首片不带 `stream_msg_id`（由服务端生成并通过响应返回），后续片由节点带回。
          if (String(params.message_type || '') === 'group' || params.group_id) {
            this.sendError(
              ws,
              echo,
              'send_stream_msg 仅支持单聊：QQ 官方只有 /v2/users/{openid}/stream_messages 这一个流式端点，群聊没有',
            );
            break;
          }
          const sUid = Number(params.user_id || 0);
          if (!sUid) {
            this.sendError(ws, echo, 'send_stream_msg 缺少目标：需要 user_id（流式消息仅支持单聊）');
            break;
          }
          const sOpenid = this.getOpenidByUid(sUid) || String(sUid);
          const sCtx = this.ctx.get(sOpenid);

          const sIndexRaw = Number(params.index);
          const sOpts: StreamMessageOptions = {
            index: Number.isInteger(sIndexRaw) && sIndexRaw >= 0 ? sIndexRaw : 0,
            inputState: Number(params.input_state) === 10 ? 10 : 1,
            contentType:
              String(params.content_type || 'text').toLowerCase() === 'markdown' ? 'markdown' : 'text',
            // event_id / msg_id / msg_seq / is_wakeup 统一走 nextSendOptions：
            // event_id 只能用一次，所以首片走 event_id，后续片自动换成 msg_id + 递增 msg_seq
            ...this.nextSendOptions(sCtx, { isWakeup: params.is_wakeup === true }),
          };
          if (params.stream_msg_id) sOpts.streamMsgId = String(params.stream_msg_id);

          const sRes = await sendOfficialStreamMessage(
            this.projectPath,
            sOpenid,
            String(params.content_raw ?? ''),
            sOpts,
          );
          if (sRes.data?.id) {
            this.messageIdToContext.set(sRes.data.id, { chatType: 'c2c', chatId: sOpenid });
            this.recordRefIdx(sRes.data.id, sRes.data.refIdx || '');
          }
          if (!sRes.ok) {
            this.sendError(ws, echo, '流式消息分片失败：QQ 官方 API 返回失败（详见日志）');
          } else {
            this.sendResponse(ws, echo, { message_id: sRes.data?.id || '' });
          }
          break;
        }
        case 'send_group_forward_msg':
        case 'send_forward_msg': {
          // BUG2：QQ 官方发送侧只有 msg_type 0/2/7，**根本没有合并转发能力**。
          // 以前这两个 action 落进 default 报「不支持的 OneBot action」，
          // 用户分不清是自己图配错了还是平台不支持 —— 这里给出可操作的说明。
          this.sendError(
            ws,
            echo,
            '当前接入（QQ 官方 API）不支持合并转发：官方发送侧只有「文本 / Markdown / 富媒体」三种，' +
              '请改用多条「发消息」逐条发送',
          );
          break;
        }
        case 'send_keyboard_msg': {
          const markdown = params.markdown as string;
          const keyboard = params.keyboard as Record<string, unknown> | undefined;
          const msgId = params.msg_id as string | undefined;

          // 与 send_msg 逻辑一致：从 params 获取 message_type 和目标 ID
          const kMsgType = params.message_type as string;
          const kUid = Number(kMsgType === 'group' ? params.group_id || 0 : params.user_id || 0);
          const kOpenid = this.getOpenidByUid(kUid) || String(kUid);
          const kCtx = this.ctx.get(kOpenid);
          const kChatType = kMsgType === 'group' ? 'group' : 'c2c';

          const kOpts: SendMessageOptions = {
            msgType: 2, // markdown 消息
            markdown: { content: markdown },
            // eventId / msgId / msgSeq / isWakeup 统一走 nextSendOptions：
            // 以前这里手抄了一遍（少了 isWakeup 互斥），互动召回在按钮/Markdown 模式下静默失效
            ...this.nextSendOptions(kCtx, {
              isWakeup: kChatType === 'c2c' && params.is_wakeup === true,
            }),
          };
          // 按钮可选：「Markdown 文本」模式不传 keyboard（官方 msg_type=2 允许只带 markdown）。
          // 空对象同样视为没有按钮 —— 传给官方 API 只会渲染不出按钮。
          if (keyboard && typeof keyboard === 'object' && Object.keys(keyboard).length > 0) {
            kOpts.keyboard = keyboard;
          }
          if (msgId) kOpts.msgId = msgId;
          // 引用回复：与 send_msg 同一规则（换算不到 REFIDX 就明确报错，不静默丢掉引用）
          const kReplyTo = String(params.reply_to || '');
          if (kReplyTo) {
            const kRef = this.resolveRefIdx(kReplyTo);
            if (!kRef) {
              this.sendError(ws, echo, `找不到引用消息的 REFIDX（${kReplyTo}）`);
              break;
            }
            kOpts.messageReference = { message_id: kRef };
          }

          emitSystemLog(
            this.projectPath,
            '发送 Markdown 消息: chatType=' +
              kChatType +
              ', openid=' +
              kOpenid +
              (kOpts.keyboard ? '（含按钮）' : '（无按钮）'),
          );
          const kRes = await sendOfficialMessage(this.projectPath, kChatType, kOpenid, '', kOpts);
          emitSystemLog(
            this.projectPath,
            '发送结果: ok=' + kRes.ok + ', id=' + (kRes.data?.id || '无'),
          );
          const kSentId = kRes.data?.id || '';
          if (kSentId)
            this.messageIdToContext.set(String(kSentId), { chatType: kChatType, chatId: kOpenid });
          // API 失败时通过 sendError 返回错误，让 handler 抛出异常，避免误报"发送成功"
          if (!kRes.ok) {
            this.sendError(ws, echo, '发送 Markdown 消息失败：QQ 官方 API 返回失败（详见日志）');
          } else {
            this.sendResponse(ws, echo, { message_id: kSentId });
          }
          break;
        }
        case 'delete_msg': {
          // 撤回消息：通过 messageIdToContext 找到原始会话，调用 recallOfficialMessage
          const dMsgId = String(params.message_id || '');
          if (!dMsgId) {
            this.sendError(ws, echo, 'delete_msg 缺少 message_id 参数');
            break;
          }
          const ctxInfo = this.messageIdToContext.get(dMsgId);
          if (!ctxInfo) {
            this.sendError(ws, echo, '找不到消息对应的会话上下文（仅支持撤回本翻译器发送的消息）');
            break;
          }
          const rOk = await recallOfficialMessage(
            this.projectPath,
            ctxInfo.chatType,
            ctxInfo.chatId,
            dMsgId,
          );
          if (rOk) {
            this.messageIdToContext.delete(dMsgId);
            this.sendResponse(ws, echo, {});
          } else {
            this.sendError(ws, echo, '撤回消息失败（API 返回失败或会话已断开）');
          }
          break;
        }
        case 'answer_interaction': {
          // 流程对按钮回调的显式回执（不回官方客户端会一直转圈）
          const interactionId = String(params.interaction_id || '');
          if (!interactionId) {
            this.sendError(ws, echo, 'answer_interaction 缺少 interaction_id');
            break;
          }
          await this.ackInteraction(interactionId, Number(params.code ?? 0) as InteractionCode);
          this.sendResponse(ws, echo, {});
          break;
        }
        default: {
          // 扩展 action（群管理 / 入群审批 / 菜单面板 / 频道 …）统一交给 officialExtras
          if (await runOfficialAction(this.actionHost(), action, params, this.replyOf(ws, echo))) {
            break;
          }
          // 平台层面不存在的能力：说清原因，别让用户等一个永远不会来的功能
          const reason = UNSUPPORTED_ACTIONS[action];
          if (reason) {
            // 带上 action 名：调用方日志里只有原因，没法定位是哪个调用失败
            const rejected = `不支持的 OneBot action: ${action} —— ${reason}`;
            emitSystemLog(this.projectPath, rejected, 'warn');
            this.sendError(ws, echo, rejected);
            break;
          }
          // 未知 action：返回错误而非静默成功，避免调用方误以为操作已执行
          const errMsg = `不支持的 OneBot action: ${action}（可用：${ACTION_NAMES.join('/')}）`;
          emitSystemLog(this.projectPath, errMsg, 'warn');
          this.sendError(ws, echo, errMsg);
          break;
        }
      }
    };
    run().catch((e: unknown) => {
      logger.error(`[translator] 发送消息失败:`, e);
      emitSystemLog(this.projectPath, '发送消息失败: ' + String(e), 'error');
      this.sendError(ws, echo, String(e));
    });
  }

  /**
   * 从消息段里提取 markdown（与可选的 keyboard）。
   *
   * 两种形状都认：
   *   · `markdown` + `keyboard` 段 —— 「按钮UI」模式；
   *   · 只有 `markdown` 段 —— 「Markdown 文本」模式（官方 msg_type=2 允许不带 keyboard）。
   * 只有 markdown 内容为空时才返回 null（交给纯文本路径处理）。
   * 用于 send_msg 等标准 action 中识别 markdown 消息并路由到 Official API 端点。
   */
  private extractMarkdownKeyboard(
    message: unknown,
  ): { markdown: string; keyboard?: Record<string, unknown> } | null {
    if (!Array.isArray(message)) return null;
    let markdown = '';
    let keyboard: Record<string, unknown> | null = null;
    for (const seg of message as Record<string, unknown>[]) {
      if (seg.type === 'markdown' && seg.data) {
        markdown = String((seg.data as Record<string, unknown>).content || '');
      } else if (seg.type === 'keyboard' && seg.data) {
        const data = seg.data as Record<string, unknown>;
        const raw = (data.content as unknown) ?? data;
        // 兼容两种来源：规范写法是对象 `{ rows: [...] }`；但外部实现/旧代码可能
        // 传 JSON 字符串（历史上本项目自己就这么发过），这里统一解析为对象，
        // 否则下游 `'id' in keyboard` 会抛 TypeError。
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw) as unknown;
            keyboard = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
          } catch {
            keyboard = null;
          }
        } else {
          keyboard = (raw as Record<string, unknown>) || null;
        }
      }
    }
    if (!markdown) return null;
    return keyboard ? { markdown, keyboard } : { markdown };
  }
}
