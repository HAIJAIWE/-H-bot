import { EventEmitter } from 'events';
import { app } from 'electron';
import { join, basename } from 'path';
import { readFile, writeFile, mkdir, stat, open } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import { createHash } from 'crypto';
import { emitSystemLog } from './runtimeEvents';
import { isEncryptionAvailable, encryptSecret, tryDecryptSecret } from './safeStorage';
import { canonicalProjectPath } from './pathGuard';

export type OfficialStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface OfficialSession {
  projectPath: string;
  status: OfficialStatus;
  appId: string;
  appSecret: string;
  sandbox: boolean;
  customWsUrl: string;
  ws: WebSocket | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
  heartbeatInterval: number;
  lastHeartbeatAck: number | null;
  lastMessageAt: number;
  seq: number | null;
  sessionId: string | null;
  accessToken: string;
  tokenExpiresAt: number;
  tokenRefreshTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
  maxRetries: number;
  /** 本次连接订阅的 Intents 位（来自项目配置，缺省 DEFAULT_INTENTS） */
  intents: number;
  reconnecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  alive: boolean;
}

export interface OfficialEvent {
  type: string;
  id: string;
  content: string;
  timestamp: string;
  author: {
    userOpenid?: string;
    memberOpenid?: string;
    memberRole?: string;
    bot?: boolean;
  };
  groupOpenid?: string;
  attachments?: OfficialAttachment[];
  /** 结构化卡片（`message_type=3`）。官方**只能收不能发**，解析出来仅供流程读取。 */
  arkData?: OfficialArkData;
  /** 嵌套消息元素（引用消息 103 / 聊天记录 102 等），原样保留供流程读取 */
  msgElements?: unknown[];
  /** 消息场景上下文：`ext` 里带 `msg_idx`（即 REFIDX，引用回复要用） */
  messageScene?: OfficialMessageScene;
}

export interface OfficialAttachment {
  contentType: string;
  filename: string;
  url: string;
  width?: number;
  height?: number;
  size?: number;
}

/**
 * 结构化卡片数据（官方 `ark_data` 字段）。
 *
 * 字段名按官方 `ARKData` 模型：`ark_type` 取值 tuwen/feed/miniapp/map/contact_card/
 * video_share/music_together/picture，`fields` 是卡片自己的 KV（tag/title/desc/jump_url…）。
 */
export interface OfficialArkData {
  arkType: string;
  arkName: string;
  prompt: string;
  fields: Record<string, unknown>;
}

/** 官方 `MessageScene`：`ext` 是 `["msg_idx=REFIDX_x", "auth_token=…"]` 这种 `k=v` 列表 */
export interface OfficialMessageScene {
  source: string;
  ext: string[];
  /** 从 `ext` 的 `msg_idx` 解析出的 REFIDX；没有则为空串 */
  refIdx: string;
}

export interface SendMessageOptions {
  msgType?: number;
  eventId?: string;
  msgId?: string;
  msgSeq?: number;
  /**
   * 富媒体。两条场景用的字段不同：
   *   · 群聊 / 单聊 —— `fileInfo`（必须先上传拿 `file_info`，走 `msg_type=7`）
   *   · 频道       —— `url`（平台自行拉取转存，走 `image` 参数；频道没有上传流程）
   */
  media?: { fileInfo: string; url?: string };
  markdown?: { content: string };
  keyboard?: Record<string, unknown>;
  messageReference?: { message_id: string };
  /**
   * 互动召回消息（官方 `is_wakeup`，**仅单聊**）。
   *
   * 官方规定它与 `msg_id` / `event_id` **互斥** —— 同时传会被服务端拒，
   * 所以 `buildMessageBody` 里为 true 时不会再带那两个字段。
   */
  isWakeup?: boolean;
  /**
   * 输入中状态（官方 `msg_type=6`，**仅单聊**）。
   *
   * 官方契约：`input_notify: { input_type: 1, input_second: N }`，`N` 上限 60 秒；
   * 该消息类型**没有内容字段**（不能同时带 content / markdown / media）。
   * 群聊接口没有这个能力 —— 传了也不会生效。
   */
  inputNotify?: { inputSecond: number };
}

const sessions = new Map<string, OfficialSession>();
// 反向索引：projectPath → sessionKey，用于 O(1) 查找 session，避免线性扫描
const projectPathIndex = new Map<string, string>();
const emitter = new EventEmitter();

type StatusCallback = (projectPath: string, status: OfficialStatus, appId: string) => void;
type MessageCallback = (projectPath: string, message: { type: string; data: unknown }) => void;

// 官方于变更记录 20260810 统一了接口域名：所有接口调用域名统一为 api.bot.qq.com。
// 旧域名 api.sgroup.qq.com 实测仍在服务（两套并行集群），但新能力只会落新域名，
// 故此处的 TOKEN_URL / API_BASE / SANDBOX_API_BASE 一律使用新域名。
const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken';
const API_BASE = 'https://api.bot.qq.com';
// 沙箱域名官方文档未公布，此处由实测得出（与生产同 IP 池，靠 Host 路由区分）
const SANDBOX_API_BASE = 'https://sandbox.api.bot.qq.com';

/**
 * Intents 位定义。序号即位移位数。
 *
 * 注意 `GROUP_MEMBER_EVENT (1<<24)` 与 `OPEN_FORUM_EVENT`：这两个 Intent 被各自的
 * 事件页声明使用，却**没有写进官方 Intents 位运算表**，属于文档缺口。
 * 1<<24 是群成员变动与入群申请事件的关键位，很容易漏订。
 */
export const INTENT_BITS: ReadonlyArray<{ bit: number; name: string; note: string }> = [
  { bit: 0, name: 'GUILDS', note: '基础事件·默认有权限' },
  { bit: 1, name: 'GUILD_MEMBERS', note: '基础事件·默认有权限' },
  { bit: 9, name: 'GUILD_MESSAGES', note: '仅私域机器人' },
  { bit: 10, name: 'GUILD_MESSAGE_REACTIONS', note: '需申请' },
  { bit: 12, name: 'DIRECT_MESSAGE', note: '需申请·不支持沙箱' },
  { bit: 24, name: 'GROUP_MEMBER_EVENT', note: '位表外·群成员变动/入群申请' },
  { bit: 25, name: 'GROUP_AND_C2C_EVENT', note: '单聊与群聊消息主事件' },
  { bit: 26, name: 'INTERACTION', note: '按钮/菜单互动回调' },
  { bit: 27, name: 'MESSAGE_AUDIT', note: '主动消息审核结果' },
  { bit: 28, name: 'FORUMS_EVENT', note: '仅私域机器人' },
  { bit: 29, name: 'AUDIO_ACTION', note: '需申请·音频类机器人' },
  { bit: 30, name: 'PUBLIC_GUILD_MESSAGES', note: '基础事件·默认有权限' },
];

/** 默认 intents：仅 GROUP_AND_C2C_EVENT，与历史行为保持一致 */
export const DEFAULT_INTENTS = 1 << 25;

/**
 * 推荐 intents：群成员事件 | 单聊群聊事件 | 互动回调 | 消息审核。
 * 已实测该组合可被网关接受（identify 返回 READY）。
 */
export const RECOMMENDED_INTENTS = (1 << 24) | (1 << 25) | (1 << 26) | (1 << 27);

/** 把 intents 数值翻译成可读字符串，用于日志与排障 */
export function describeIntents(value: number): string {
  const names = INTENT_BITS.filter((b) => (value & (1 << b.bit)) !== 0).map((b) => `${b.name}(1<<${b.bit})`);
  return names.length ? `${value} = ${names.join(' | ')}` : `${value} = (空)`;
}

/** 规范化 intents：非法值（非正整数）回退到默认值，避免把脏数据发到网关 */
export function resolveIntents(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return DEFAULT_INTENTS;
  return raw;
}

/**
 * 致命关闭码：属于「配置/账号状态错误」，重连不会自愈。
 * 遇到这些码直接进 error 态并给出可读原因，不再空转重试。
 */
const FATAL_CLOSE_CODES: Record<number, string> = {
  4004: '鉴权失败：token 无效',
  4012: '无效的 version',
  4013: '无效的 intents 值',
  4014: 'intents 无权限（该位未获开放平台授权）',
  4914: '机器人已下架，只允许连接沙箱环境',
  4915: '机器人已被封禁',
};

/** Token 提前刷新阈值（毫秒）：过期前 10 秒即视为需刷新 */
const TOKEN_REFRESH_THRESHOLD_MS = 10_000;
/** Token 刷新调度提前量（毫秒）：过期前 45 秒安排刷新 */
const TOKEN_REFRESH_SCHEDULE_LEAD_MS = 45_000;
/** Token 刷新失败后的重试延迟（毫秒） */
const TOKEN_REFRESH_RETRY_DELAY_MS = 60_000;
/** 心跳检测间隔（毫秒）：定期检查 WebSocket 是否存活 */
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;
/** 心跳超时判定阈值（毫秒）：超过此时间无消息则触发重连 */
const HEARTBEAT_TIMEOUT_THRESHOLD_MS = 30_000;
/** 重连指数退避上限（毫秒） */
const RECONNECT_MAX_DELAY_MS = 30_000;
/** 默认心跳间隔（毫秒，服务端未下发时使用） */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;

export function onOfficialStatusChange(cb: StatusCallback): () => void {
  emitter.on('official:status', cb);
  return () => emitter.off('official:status', cb);
}

export function onOfficialMessage(cb: MessageCallback): () => void {
  emitter.on('official:message', cb);
  return () => emitter.off('official:message', cb);
}

function emitStatus(session: OfficialSession): void {
  emitter.emit('official:status', session.projectPath, session.status, session.appId);
}

function appDataDir(): string {
  return join(app.getPath('userData'), 'qqbat-data', 'official');
}

export function apiBase(sandbox: boolean): string {
  return sandbox ? SANDBOX_API_BASE : API_BASE;
}

export async function saveOfficialConfig(
  projectPath: string,
  config: { appId: string; appSecret: string; sandbox?: boolean; wsUrl?: string; intents?: number },
): Promise<void> {
  const dir = appDataDir();
  await mkdir(dir, { recursive: true });
  // 用归一化路径做文件名，和 loadOfficialConfig 的查找保持一致；
  // 若旧文件名（原始路径）已存在，顺手把旧文件内容并进来、避免丢配置。
  const key = Buffer.from(canonicalProjectPath(projectPath)).toString('base64url');
  const file = join(dir, `${key}.json`);
  const legacyKey = Buffer.from(projectPath).toString('base64url');
  const legacyFile = join(dir, `${legacyKey}.json`);

  // 合并式保存：整文件覆盖会让任何「只改一部分字段」的调用方把其它字段静默抹掉
  // （历史 bug：从配置对话框点保存会丢掉 wsUrl/intents）。因此先读回现有配置，
  // 仅用本次显式提供的字段覆盖。
  let existing: Record<string, unknown> = {};
  // 新文件名不存在但旧文件名存在时，以旧文件为底（否则会把已有凭据写丢）
  const readFrom = existsSync(file) ? file : existsSync(legacyFile) ? legacyFile : '';
  if (readFrom) {
    try {
      existing = JSON.parse(await readFile(readFrom, 'utf-8')) as Record<string, unknown>;
    } catch {
      // 现有文件损坏时按空配置处理，本次保存会重建它
      existing = {};
    }
  }

  const persisted: Record<string, unknown> = { ...existing, appId: config.appId };
  if (config.sandbox !== undefined) persisted.sandbox = config.sandbox;
  if (config.wsUrl !== undefined) persisted.wsUrl = config.wsUrl;
  // intents 落盘前规范化，避免把非法值写进配置后在启动时才炸
  if (config.intents !== undefined) persisted.intents = resolveIntents(config.intents);

  // 加密 appSecret 后再落盘，避免敏感凭证明文存储
  if (config.appSecret) {
    if (isEncryptionAvailable()) {
      persisted.appSecret = encryptSecret(config.appSecret);
      persisted._encrypted = true;
    } else {
      persisted.appSecret = config.appSecret;
      delete persisted._encrypted;
      emitSystemLog(
        projectPath,
        '官方适配器 AppSecret 无法加密：系统不支持安全存储，将以明文保存',
        'warn',
      );
    }
  }
  await writeFile(file, JSON.stringify(persisted, null, 2), 'utf-8');
}

export async function loadOfficialConfig(
  projectPath: string,
): Promise<{
  appId: string;
  appSecret: string;
  sandbox?: boolean;
  wsUrl?: string;
  intents?: number;
} | null> {
  const dir = appDataDir();
  // 凭据文件名 = base64url(项目路径)：路径字符串差一个分隔符就找不到凭据，
  // 表现为「未配置 AppID 和 AppSecret」（真机踩到）。所以先用归一化路径，
  // 找不到再退回原始路径 —— 兼容修复前已经落盘的文件名。
  const candidates = [canonicalProjectPath(projectPath), projectPath].filter(
    (p, i, arr) => p && arr.indexOf(p) === i,
  );
  let file = '';
  for (const candidate of candidates) {
    const key = Buffer.from(candidate).toString('base64url');
    const probe = join(dir, `${key}.json`);
    if (existsSync(probe)) {
      file = probe;
      break;
    }
  }
  if (!file) return null;
  const raw = await readFile(file, 'utf-8');
  const parsed = JSON.parse(raw) as {
    appId: string;
    appSecret: string;
    sandbox?: boolean;
    wsUrl?: string;
    intents?: number;
    _encrypted?: boolean;
  };
  // 解密 appSecret
  if (parsed._encrypted && typeof parsed.appSecret === 'string') {
    const decrypted = tryDecryptSecret(parsed.appSecret);
    if (decrypted) {
      parsed.appSecret = decrypted;
    } else {
      emitSystemLog(
        projectPath,
        '官方适配器 AppSecret 解密失败，凭证可能已损坏或在其他机器上加密',
        'error',
      );
      parsed.appSecret = '';
    }
    delete parsed._encrypted;
  }
  return parsed;
}

export async function testOfficialConnection(appId: string, appSecret: string): Promise<boolean> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token?: string };
    return !!data.access_token;
  } catch (err) {
    // 测试连接失败需记录错误，便于排查凭证或网络问题（无 projectPath，附 appId）
    emitSystemLog(
      '',
      '官方连接测试失败 appId=' + appId + ': ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
    return false;
  }
}

export async function fetchAccessToken(
  appId: string,
  appSecret: string,
): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
  });
  if (!res.ok) throw new Error(`获取 token 失败: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  if (!data.access_token) throw new Error('获取 token 失败: 无 access_token');
  return { token: data.access_token, expiresIn: Number(data.expires_in) || 7200 };
}

async function getGatewayUrl(token: string, sandbox: boolean): Promise<string> {
  const base = apiBase(sandbox);
  const res = await fetch(`${base}/gateway/bot`, {
    headers: { Authorization: `QQBot ${token}` },
  });
  if (!res.ok) throw new Error(`获取网关地址失败: HTTP ${res.status}`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('获取网关地址失败: 无 url');
  return data.url;
}

function getSession(projectPath: string): OfficialSession | undefined {
  // 通过反向索引 O(1) 查找，避免对 sessions 全表线性扫描
  const sessionKey = projectPathIndex.get(projectPath);
  if (!sessionKey) return undefined;
  return sessions.get(sessionKey);
}

async function authFetch(
  session: OfficialSession,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = session.accessToken || (await ensureToken(session));
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      Authorization: `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// ── 消息发送 ──

/**
 * 将 keyboard 包装为 QQ 官方 API 期望的格式。
 *
 * QQ 官方 API 支持两种 keyboard 格式：
 * 1. 模板格式：`{ id: '123' }` → 原样传递
 * 2. 自定义格式：`{ content: { rows: [...], bot_appid: 123 } }` → 原样传递
 * 3. 简化格式（来自用户配置）：`{ rows: [...] }` → 包装为 `{ content: { rows, bot_appid } }`
 *
 * @param keyboard 原始 keyboard 配置
 * @param appIdStr bot 的 appId（字符串形式，会转换为 number）
 * @returns 符合 QQ 官方 API 规范的 keyboard 对象
 */
export function wrapKeyboardForApi(
  keyboard: Record<string, unknown>,
  appIdStr: string,
): Record<string, unknown> {
  // 防御：字符串（JSON 形态）先解析为对象，否则下面的 `'id' in keyboard` 会抛
  // TypeError，让整条按钮发送路径静默失败（历史事故）。
  if (typeof keyboard === 'string') {
    try {
      const parsed = JSON.parse(keyboard) as unknown;
      if (parsed && typeof parsed === 'object') {
        keyboard = parsed as Record<string, unknown>;
      } else {
        return {};
      }
    } catch {
      return {};
    }
  }
  if (!keyboard || typeof keyboard !== 'object') return {};

  // 模板格式：{ id: '123' }
  if ('id' in keyboard) {
    return keyboard;
  }
  // 已经是自定义格式：{ content: { rows, bot_appid } }
  if ('content' in keyboard) {
    return keyboard;
  }
  // 简化格式：{ rows: [...] } → 包装为 { content: { rows, bot_appid } }
  if ('rows' in keyboard) {
    const botAppId = Number(appIdStr);
    return {
      content: {
        rows: keyboard.rows,
        bot_appid: Number.isNaN(botAppId) ? 0 : botAppId,
      },
    };
  }
  // 其他情况：原样返回，让 QQ API 层报错便于排查
  return keyboard;
}

/**
 * 官方发消息接口的返回体。`refIdx` 是这条消息的引用标识 —— 发出去以后才能被引用。
 *
 * `error` 是可选的失败原因：此前失败只有 `ok: false`，原因只写进系统日志，
 * 于是节点层只能报一句「操作失败」，用户看不出是权限、频率还是内容被拦。
 */
export interface OfficialSendResult {
  ok: boolean;
  data?: { id: string; timestamp: number; refIdx: string };
  error?: string;
}

/** 官方「输入中状态」时长上限（秒），文档写"最长 60s" */
export const INPUT_NOTIFY_MAX_SECONDS = 60;

/**
 * 把用户填的秒数夹到官方允许的 1~60。
 *
 * 不夹的话，`0` / 负数 / 非数字会被官方按默认值处理或直接报 `50059 输入类型错误`，
 * 用户看到的是一个与真实原因无关的错误码。缺省用 30 秒（比 60 更保守，
 * 避免"机器人一直显示正在输入"的观感）。
 */
export function clampInputSeconds(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(INPUT_NOTIFY_MAX_SECONDS, n);
}

/**
 * 拼装官方发消息接口的请求体（纯函数，便于不起网络就单测三条规则）。
 *
 * 1. `msg_type` 0/2/7 三选一：markdown+keyboard 只跟 2 走、media 只跟 7 走；
 * 2. **`is_wakeup` 与 `msg_id` / `event_id` 互斥** —— 官方规定，同时传会被服务端拒；
 * 3. `message_reference`（引用回复）对 0/2/7 都生效 —— 官方要求引用**不能单独发送**，
 *    必须挂在某条真实消息上。
 */
export function buildMessageBody(
  content: string,
  options: SendMessageOptions,
  appIdStr: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { msg_type: options.msgType ?? 0 };

  // keyboard 包装：QQ 官方 API 要求自定义 keyboard 必须包装在 content 字段内
  const wrappedKeyboard = options.keyboard
    ? wrapKeyboardForApi(options.keyboard, appIdStr)
    : undefined;

  if (options.msgType === 6) {
    // 输入中状态：内容字段是 input_notify，**不能带 content**（带了官方报 22006 类型不匹配）。
    // 时长官方文档写"最长 60s"，这里夹紧到 1~60，避免把非法值直接发给官方。
    body.input_notify = { input_type: 1, input_second: clampInputSeconds(options.inputNotify?.inputSecond) };
  } else if (options.msgType === 7 && options.media) {
    body.media = { file_info: options.media.fileInfo };
  } else if (options.msgType === 2 && options.markdown) {
    body.markdown = options.markdown;
    if (wrappedKeyboard) body.keyboard = wrappedKeyboard;
  } else {
    body.content = content;
    if (wrappedKeyboard) body.keyboard = wrappedKeyboard;
  }

  // is_wakeup（互动召回）与 msg_id/event_id 互斥：同发会被官方拒，所以二选一
  if (options.isWakeup) {
    body.is_wakeup = true;
  } else {
    if (options.eventId) body.event_id = options.eventId;
    if (options.msgId) body.msg_id = options.msgId;
  }
  if (options.msgSeq != null) body.msg_seq = options.msgSeq;
  if (options.messageReference) body.message_reference = options.messageReference;

  return body;
}

/**
 * 消息目标场景。
 *
 * `c2c` / `group` 走 `/v2/...`（openid 体系 + `msg_type` 请求体）；
 * `channel` 走 `/channels/{channel_id}/messages`（**guild_id/channel_id 体系**，
 * 且**没有 `msg_type`** —— 频道用 `content`/`markdown`/`image`/`embed`/`ark` 表达内容形态）。
 */
export type ChatType = 'c2c' | 'group' | 'channel';

/**
 * 拼装频道发消息请求体（纯函数，便于不起网络就单测）。
 *
 * 与 `buildMessageBody` 的差异（都是官方文档明确写的）：
 *   · **没有 `msg_type`** —— 频道用参数本身表达内容形态
 *   · **没有 `msg_seq`** —— 那是群聊/单聊的 `msg_id` 去重机制，频道不适用
 *   · 富媒体是 `image`（图片 URL，平台转存），不是 `media.file_info`
 *   · `content` / `embed` / `ark` / `image` / `markdown` **至少要有一个**，否则官方拒发
 */
export function buildChannelMessageBody(
  content: string,
  options: SendMessageOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (options.markdown) {
    body.markdown = options.markdown;
  } else if (options.media?.url) {
    // 频道富媒体：直接把可公开拉取的图片地址交给平台转存
    body.image = options.media.url;
    if (content) body.content = content;
  } else {
    body.content = content;
  }

  // 频道不用 is_wakeup（那是单聊的互动召回），只处理被动回复标识
  if (options.msgId) body.msg_id = options.msgId;
  if (options.eventId) body.event_id = options.eventId;
  if (options.messageReference) body.message_reference = options.messageReference;

  return body;
}

export async function sendOfficialMessage(
  projectPath: string,
  chatType: ChatType,
  chatId: string,
  content: string,
  options: SendMessageOptions = {},
): Promise<OfficialSendResult> {
  const session = getSession(projectPath);
  if (!session || !session.alive) {
    emitSystemLog(projectPath, '发送失败: session不存在或未连接', 'error');
    return { ok: false };
  }

  const base = apiBase(session.sandbox);
  const endpoint =
    chatType === 'c2c'
      ? `${base}/v2/users/${chatId}/messages`
      : chatType === 'group'
        ? `${base}/v2/groups/${chatId}/messages`
        : `${base}/channels/${chatId}/messages`;

  const body =
    chatType === 'channel'
      ? buildChannelMessageBody(content, options)
      : buildMessageBody(content, options, session.appId);

  emitSystemLog(
    projectPath,
    '发送消息: chatType=' +
      chatType +
      ', chatId=' +
      chatId +
      ', content="' +
      content.slice(0, 50) +
      '"',
  );
  try {
    const res = await authFetch(session, endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      id?: string;
      timestamp?: number;
      ext_info?: { ref_idx?: string };
    };
    if (!res.ok) {
      // HTTP 层失败：记录状态码与返回体，便于定位 QQ 错误码
      emitSystemLog(
        projectPath,
        '消息发送失败: HTTP ' + res.status + ', data=' + JSON.stringify(data),
        'error',
      );
      return { ok: false };
    }
    emitSystemLog(projectPath, '消息发送成功: id=' + (data.id || ''));
    return {
      ok: true,
      data: {
        id: data.id ?? '',
        timestamp: data.timestamp ?? 0,
        refIdx: data.ext_info?.ref_idx ?? '',
      },
    };
  } catch (err) {
    // 网络异常或响应解析失败：记录底层错误信息
    emitSystemLog(
      projectPath,
      '消息发送异常: ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
    return { ok: false };
  }
}

// ── 富媒体 ──

/**
 * 媒体类型名 → 官方 `file_type`（1 图片 / 2 视频 / 3 语音 / 4 文件）。
 *
 * 节点与翻译器共用这一份映射，避免两处各写一张表（历史上模式清单就是这么漂移的）。
 * 返回 null 表示类型名不认识 —— 调用方必须**明确报错**，不能兜底成图片。
 */
export function mediaFileTypeOf(t: string): 1 | 2 | 3 | 4 | null {
  switch (String(t || '').toLowerCase()) {
    case 'image':
      return 1;
    case 'video':
      return 2;
    case 'record':
    case 'voice':
      return 3;
    case 'file':
      return 4;
    default:
      return null;
  }
}

export async function uploadOfficialFile(
  projectPath: string,
  chatType: 'c2c' | 'group',
  chatId: string,
  fileType: number,
  url: string,
  fileName?: string,
): Promise<{ ok: boolean; data?: { fileInfo: string; fileUuid: string; ttl: number }; error?: string }> {
  const session = getSession(projectPath);
  if (!session || !session.alive) {
    emitSystemLog(projectPath, '发送失败: session不存在或未连接', 'error');
    return { ok: false, error: 'session 不存在或未连接' };
  }

  const base = apiBase(session.sandbox);
  const endpoint =
    chatType === 'c2c' ? `${base}/v2/users/${chatId}/files` : `${base}/v2/groups/${chatId}/files`;

  const body: Record<string, unknown> = { file_type: fileType, url, srv_send_msg: false };
  if (fileName) body.file_name = fileName;

  try {
    const res = await authFetch(session, endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      file_info?: string;
      file_uuid?: string;
      ttl?: number;
      message?: string;
      err_code?: number;
    };
    if (!res.ok) {
      // 上传失败必须把原因带回去：否则媒体模式只能说「操作失败」，
      // 分不清是 URL 不可达、类型不符还是额度问题（QQ 是服务端去拉这个 URL 的）。
      const errMsg =
        `文件上传失败: HTTP ${res.status}` +
        (data.message ? `, ${data.message}` : '') +
        (data.err_code ? ` (err_code=${data.err_code})` : '');
      emitSystemLog(projectPath, errMsg, 'error');
      return { ok: false, error: errMsg };
    }
    return {
      ok: true,
      data: { fileInfo: data.file_info ?? '', fileUuid: data.file_uuid ?? '', ttl: data.ttl ?? 0 },
    };
  } catch (err) {
    // 文件上传异常需记录错误，便于排查网络或权限问题
    const errMsg = '官方文件上传异常: ' + (err instanceof Error ? err.message : String(err));
    emitSystemLog(projectPath, errMsg, 'error');
    return { ok: false, error: errMsg };
  }
}

export async function sendOfficialMedia(
  projectPath: string,
  chatType: ChatType,
  chatId: string,
  mediaUrl: string,
  fileType: number,
  fileName?: string,
  replyOptions?: {
    eventId?: string;
    msgId?: string;
    msgSeq?: number;
    messageReference?: { message_id: string };
    isWakeup?: boolean;
  },
): Promise<OfficialSendResult> {
  // 本地文件走分片上传（官方推荐，不要求公网可访问），
  // http(s) 直链走 URL 上传（官方由服务端去拉取转存）。
  const source = String(mediaUrl || '').trim();

  // 频道是另一套：**没有 file_info 上传流程**，富媒体只能给可公开拉取的地址，
  // 由平台自己拉取转存（对应请求体的 `image` 字段）。
  if (chatType === 'channel') {
    if (isLocalFileSource(source)) {
      return {
        ok: false,
        error:
          '频道不支持本地文件：频道没有富媒体上传流程，只能提供可公开拉取的 http(s) 图片地址。' +
          '如需发本地文件请改用单聊或群聊（那边走分片上传）',
      };
    }
    if (!/^https?:\/\//i.test(source)) {
      return { ok: false, error: `频道富媒体需要一个可公开拉取的 http(s) 地址（收到：${source}）` };
    }
    return await sendOfficialMessage(projectPath, 'channel', chatId, '', {
      media: { fileInfo: '', url: source },
      eventId: replyOptions?.eventId,
      msgId: replyOptions?.msgId,
      messageReference: replyOptions?.messageReference,
    });
  }

  const upload = isLocalFileSource(source)
    ? await uploadOfficialLocalFile(projectPath, chatType, chatId, source, fileType, fileName)
    : await uploadOfficialFile(projectPath, chatType, chatId, fileType, source, fileName);
  if (!upload.ok || !upload.data) {
    return { ok: false, error: upload.error || '富媒体上传失败' };
  }

  return await sendOfficialMessage(projectPath, chatType, chatId, '', {
    msgType: 7,
    media: { fileInfo: upload.data.fileInfo },
    eventId: replyOptions?.eventId,
    msgId: replyOptions?.msgId,
    msgSeq: replyOptions?.msgSeq,
    messageReference: replyOptions?.messageReference,
    isWakeup: replyOptions?.isWakeup,
  });
}

// ── 本地文件分片上传 ──

/**
 * 判断媒体来源是不是「本地文件」。
 *
 * 官方 URL 上传要求来源是**平台可访问的 http(s) 地址**（由 QQ 服务端去拉），
 * 本地路径发不出去；分片上传正是为了补上这个能力。
 */
export function isLocalFileSource(source: string): boolean {
  const s = String(source || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return false;
  // file:// 前缀按本地路径处理
  const p = s.startsWith('file://') ? s.slice('file://'.length) : s;
  return existsSync(p);
}

/** 官方 `md5_10m` 的取值范围：文件前 10002432 字节 */
const MD5_10M_BYTES = 10002432;
/** 官方硬上限 200MB；超过这个值直接本地拦下，不必白跑一次预上传 */
const UPLOAD_HARD_LIMIT_BYTES = 200 * 1024 * 1024;

export interface FileDigests {
  size: number;
  md5: string;
  sha1: string;
  md5_10m: string;
}

/**
 * 计算分片上传所需的三个校验值。
 *
 * 用**流式**读取而不是 readFile：官方硬上限 200MB，整读进内存会白白吃掉
 * 一大块堆，而这里只需要哈希结果。
 * 文件小于 10002432 字节时，`md5_10m` 就是整个文件的 MD5（前 N 字节即全部）。
 */
export async function computeFileDigests(filePath: string): Promise<FileDigests> {
  const st = await stat(filePath);
  if (!st.isFile()) throw new Error(`不是文件: ${filePath}`);
  const size = st.size;
  if (size > UPLOAD_HARD_LIMIT_BYTES) {
    throw new Error(
      `文件超过官方上限 200MB（实际 ${(size / 1024 / 1024).toFixed(1)}MB），无法上传`,
    );
  }

  const md5 = createHash('md5');
  const sha1 = createHash('sha1');
  const md5_10m = createHash('md5');
  let seen = 0;

  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    rs.on('data', (chunk: Buffer) => {
      md5.update(chunk);
      sha1.update(chunk);
      if (seen < MD5_10M_BYTES) {
        const remain = MD5_10M_BYTES - seen;
        md5_10m.update(remain >= chunk.length ? chunk : chunk.subarray(0, remain));
      }
      seen += chunk.length;
    });
    rs.on('error', reject);
    rs.on('end', resolve);
  });

  return {
    size,
    md5: md5.digest('hex'),
    sha1: sha1.digest('hex'),
    md5_10m: md5_10m.digest('hex'),
  };
}

/** 预上传响应里的一个分片 */
interface UploadPart {
  index: number;
  presignedUrl: string;
  blockSize: number;
}

/** 把官方返回的 `parts[]` 规范化（字段是字符串，且可能缺项） */
export function normalizeUploadParts(raw: unknown): UploadPart[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        index: Number(o.index ?? 0),
        presignedUrl: String(o.presigned_url ?? ''),
        blockSize: Number(o.block_size ?? 0) || 0,
      };
    })
    .filter((p) => p.presignedUrl)
    .sort((a, b) => a.index - b.index);
}

/**
 * 按 `concurrency` 并发执行任务；默认 1（顺序）。
 * 官方 `upload_config.concurrency` 默认就是 1，且明确「由后台下发控制客户端上传行为」，
 * 所以不写死并发数，也不擅自放大。
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

/** 带退避的 PUT：单请求失败时按 retryDelay 重试，整体不超过 retryTimeout */
async function putPartWithRetry(
  presignedUrl: string,
  chunk: Buffer,
  retryTimeoutSec: number,
  retryDelaySec: number,
  projectPath: string,
  partIndex: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(1, retryTimeoutSec) * 1000;
  const delayMs = Math.max(1, retryDelaySec) * 1000;
  let lastErr = '';
  for (let attempt = 1; ; attempt++) {
    try {
      // 预签名 URL 自带签名，**不能**再带 Authorization 头（会被 COS 判为签名冲突）
      const res = await fetch(presignedUrl, { method: 'PUT', body: new Uint8Array(chunk) });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() + delayMs >= deadline) {
      throw new Error(`分片 ${partIndex} 上传失败（已重试 ${attempt} 次）: ${lastErr}`);
    }
    emitSystemLog(projectPath, `分片 ${partIndex} 上传失败，${delayMs}ms 后重试: ${lastErr}`, 'warn');
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

/**
 * 计算第 `ordinal` 片在文件中的字节范围（纯函数）。
 *
 * **为什么单独抽出来**：偏移量算错会产生一个"看起来正常"的失败 ——
 * 上传返回 200、分片通知返回 200，最后合并时报 `850019 富媒体文件格式不支持`，
 * 排查方向会被完全带偏。而这个 bug 单测原本覆盖不到（它在网络函数中间），
 * 只有真机验证才抓出来。抽成纯函数后，这条规则可以被测试钉住。
 *
 * ⚠️ 参数是**序号**（0 起，即排序后的第几片），**不是**服务端返回的 `part.index` ——
 * 官方文档说 index 从 0 开始，实测却是 1 起（预签名路径也是 `part_1`）。
 */
export function partByteRange(
  ordinal: number,
  blockSize: number,
  totalSize: number,
): { start: number; length: number } {
  const start = ordinal * blockSize;
  return { start, length: Math.max(0, Math.min(blockSize, totalSize - start)) };
}

/**
 * 本地文件分片上传（官方推荐路径，四步）。
 *
 *   1. upload_prepare   —— 拿 upload_id / block_size / 预签名 URL / upload_config
 *   2. 逐片 PUT 到预签名 URL（客户端直传对象存储，**不经开放平台**）
 *   3. upload_part_finish —— 每片 PUT 成功后通知服务端
 *   4. files + upload_id  —— 合并，拿到 file_info
 *
 * 注意路径参数命名**不一致**（官方文档原文如此，不是笔误）：
 * 预上传/分片完成用 `{user_id}` / `{group_id}`，而合并用 `{user_openid}` / `{group_openid}`。
 */
export async function uploadOfficialLocalFile(
  projectPath: string,
  chatType: 'c2c' | 'group',
  chatId: string,
  filePath: string,
  fileType: number,
  fileName?: string,
): Promise<{ ok: boolean; data?: { fileInfo: string; fileUuid: string; ttl: number }; error?: string }> {
  const session = getSession(projectPath);
  if (!session || !session.alive) {
    emitSystemLog(projectPath, '发送失败: session不存在或未连接', 'error');
    return { ok: false, error: 'session 不存在或未连接' };
  }
  const localPath = filePath.startsWith('file://') ? filePath.slice('file://'.length) : filePath;
  const base = apiBase(session.sandbox);
  const seg = chatType === 'c2c' ? 'users' : 'groups';
  const name = fileName || basename(localPath);

  let digests: FileDigests;
  try {
    digests = await computeFileDigests(localPath);
  } catch (err) {
    const msg = '读取本地文件失败: ' + (err instanceof Error ? err.message : String(err));
    emitSystemLog(projectPath, msg, 'error');
    return { ok: false, error: msg };
  }

  try {
    // 1. 预上传
    const prepRes = await authFetch(session, `${base}/v2/${seg}/${chatId}/upload_prepare`, {
      method: 'POST',
      body: JSON.stringify({
        file_type: fileType,
        // 官方要求 file_size / block_size 为**字符串**
        file_size: String(digests.size),
        file_name: name,
        md5: digests.md5,
        sha1: digests.sha1,
        md5_10m: digests.md5_10m,
      }),
    });
    const prep = (await prepRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!prepRes.ok) {
      const msg = `预上传失败: HTTP ${prepRes.status} ${String(prep.message ?? '')} ${
        prep.err_code ? `(err_code=${prep.err_code})` : ''
      }`;
      emitSystemLog(projectPath, msg, 'error');
      return { ok: false, error: msg };
    }
    const uploadId = String(prep.upload_id ?? '');
    const parts = normalizeUploadParts(prep.parts);
    const cfg = (prep.upload_config ?? {}) as Record<string, unknown>;
    const concurrency = Number(cfg.concurrency ?? 1) || 1;
    const retryTimeout = Number(cfg.retry_timeout ?? 300) || 300;
    const retryDelay = Number(cfg.retry_delay ?? 1) || 1;
    if (!uploadId || !parts.length) {
      const msg = '预上传响应缺少 upload_id 或 parts，无法继续分片上传';
      emitSystemLog(projectPath, msg, 'error');
      return { ok: false, error: msg };
    }

    emitSystemLog(
      projectPath,
      `开始分片上传: ${name}（${(digests.size / 1024 / 1024).toFixed(1)}MB，${parts.length} 片，并发 ${concurrency}）`,
    );

    // 2 + 3. 逐片 PUT 并通知服务端
    const fh = await open(localPath, 'r');
    try {
      // ⚠️ 偏移量必须按「排序后的第几片」算（下面的 `ordinal`），**不能拿服务端返回的
      // `part.index` 去乘**。官方文档写的是「分片序号，从 0 开始」，但**实测返回的是
      // 1 起**（预签名 URL 路径也是 `part_1`）。按 index 乘会得到：
      //   start = 1 * blockSize = 文件大小 → 切出长度 0 的空分片
      //   → 合并时服务端看到空文件，报 `850019 富媒体文件格式不支持`
      // 这个 bug 在真机上被验证脚本抓出来过（单测只覆盖了校验值与 parts 归一化，
      // 覆盖不到切片偏移），所以这里按数组序号算，对 0 起 / 1 起都成立。
      await runWithConcurrency(parts, concurrency, async (part, ordinal) => {
        const blockSize = part.blockSize || Math.ceil(digests.size / parts.length);
        const { start, length } = partByteRange(ordinal, blockSize, digests.size);
        // 按需读取该片，避免把整个文件读进内存
        const buf = Buffer.alloc(length);
        if (length > 0) await fh.read(buf, 0, length, start);

        await putPartWithRetry(
          part.presignedUrl,
          buf,
          retryTimeout,
          retryDelay,
          projectPath,
          part.index,
        );

        const partMd5 = createHash('md5').update(buf).digest('hex');
        const finRes = await authFetch(
          session,
          `${base}/v2/${seg}/${chatId}/upload_part_finish`,
          {
            method: 'POST',
            body: JSON.stringify({
              upload_id: uploadId,
              part_index: part.index,
              block_size: String(blockSize),
              md5: partMd5,
            }),
          },
        );
        if (!finRes.ok) {
          const t = await finRes.text().catch(() => '');
          throw new Error(`分片 ${part.index} 完成通知失败: HTTP ${finRes.status} ${t.slice(0, 120)}`);
        }
      });
    } finally {
      await fh.close();
    }

    // 4. 合并（携带 upload_id，url 可为空）
    const mergeRes = await authFetch(session, `${base}/v2/${seg}/${chatId}/files`, {
      method: 'POST',
      body: JSON.stringify({
        file_type: fileType,
        srv_send_msg: false,
        file_name: name,
        upload_id: uploadId,
      }),
    });
    const merged = (await mergeRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!mergeRes.ok) {
      const msg = `分片合并失败: HTTP ${mergeRes.status} ${String(merged.message ?? '')} ${
        merged.err_code ? `(err_code=${merged.err_code})` : ''
      }`;
      emitSystemLog(projectPath, msg, 'error');
      return { ok: false, error: msg };
    }

    const fileInfo = String(merged.file_info ?? '');
    if (!fileInfo) {
      const msg = '分片合并成功但响应里没有 file_info';
      emitSystemLog(projectPath, msg, 'error');
      return { ok: false, error: msg };
    }
    emitSystemLog(projectPath, `分片上传完成: ${name} → ${String(merged.file_uuid ?? '')}`);
    return {
      ok: true,
      data: {
        fileInfo,
        fileUuid: String(merged.file_uuid ?? ''),
        ttl: Number(merged.ttl ?? 0),
      },
    };
  } catch (err) {
    const msg = '本地文件分片上传异常: ' + (err instanceof Error ? err.message : String(err));
    emitSystemLog(projectPath, msg, 'error');
    return { ok: false, error: msg };
  }
}

// ── 流式消息（仅单聊）──

/** 流式消息单片参数（官方 `/v2/users/{openid}/stream_messages`） */
export interface StreamMessageOptions {
  /** `append`（默认，contentRaw 是增量）/ `replace`（contentRaw 是全量正文） */
  inputMode?: 'append' | 'replace';
  /** 1 = 生成中，10 = 生成结束 */
  inputState?: 1 | 10;
  /** 分片序号，从 0 递增 */
  index?: number;
  /** `text` / `markdown` */
  contentType?: 'text' | 'markdown';
  /** 首片不带（由服务端生成）；后续分片必须带上上一片返回的 id */
  streamMsgId?: string;
  eventId?: string;
  msgId?: string;
  msgSeq?: number;
  isWakeup?: boolean;
}

/**
 * 拼装流式消息单片请求体（纯函数，便于不起网络就单测）。
 *
 * 与 `buildMessageBody` 的区别：流式接口没有 `msg_type`/`markdown` 这些字段，
 * 用 `input_mode` / `input_state` / `index` / `content_type` / `content_raw` 描述分片。
 * `stream_msg_id` 是**首片不带、续片必带** —— 首片由服务端生成并在响应 `id` 里返回。
 */
export function buildStreamMessageBody(
  contentRaw: string,
  options: StreamMessageOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // 默认 append：每片只发增量，天然满足官方"已下发前缀不可修改"的约束
    input_mode: options.inputMode ?? 'append',
    input_state: options.inputState ?? 1,
    index: options.index ?? 0,
    content_type: options.contentType ?? 'text',
    content_raw: contentRaw,
  };
  if (options.streamMsgId) body.stream_msg_id = options.streamMsgId;
  if (options.isWakeup) body.is_wakeup = true;
  else {
    if (options.eventId) body.event_id = options.eventId;
    if (options.msgId) body.msg_id = options.msgId;
  }
  if (options.msgSeq != null) body.msg_seq = options.msgSeq;
  return body;
}

/**
 * 发送**一片**流式消息（官方 `POST /v2/users/{openid}/stream_messages`）。
 *
 * 只有单聊有这个接口 —— 函数刻意**不接 chatType**，群聊的判断留给调用方拦截，
 * 免得以后有人顺手传个 'group' 进来，发到不存在的端点上再排查半天。
 *
 * 返回 `data.id`：首片是服务端生成的 `stream_msg_id`，续片回的就是自己带的那个。
 */
export async function sendOfficialStreamMessage(
  projectPath: string,
  chatId: string,
  contentRaw: string,
  options: StreamMessageOptions = {},
): Promise<OfficialSendResult> {
  const session = getSession(projectPath);
  if (!session || !session.alive) {
    emitSystemLog(projectPath, '发送失败: session不存在或未连接', 'error');
    return { ok: false };
  }

  const base = apiBase(session.sandbox);
  const endpoint = `${base}/v2/users/${chatId}/stream_messages`;
  const body = buildStreamMessageBody(contentRaw, options);

  try {
    const res = await authFetch(session, endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      id?: string;
      timestamp?: number | string;
      ext_info?: { ref_idx?: string };
    };
    if (!res.ok) {
      emitSystemLog(
        projectPath,
        '流式消息分片失败: HTTP ' + res.status + ', data=' + JSON.stringify(data),
        'error',
      );
      return { ok: false };
    }
    return {
      ok: true,
      data: {
        id: data.id ?? '',
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : 0,
        refIdx: data.ext_info?.ref_idx ?? '',
      },
    };
  } catch (err) {
    emitSystemLog(
      projectPath,
      '流式消息发送异常: ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
    return { ok: false };
  }
}

// ── 撤回消息 ──

export async function recallOfficialMessage(
  projectPath: string,
  chatType: ChatType,
  chatId: string,
  msgId: string,
): Promise<boolean> {
  const session = getSession(projectPath);
  if (!session || !session.alive) return false;

  const base = apiBase(session.sandbox);
  // 频道的撤回路径**没有 /v2 前缀**，而且带一个 `hidetip` 查询参数
  const endpoint =
    chatType === 'c2c'
      ? `${base}/v2/users/${chatId}/messages/${msgId}`
      : chatType === 'group'
        ? `${base}/v2/groups/${chatId}/messages/${msgId}`
        : `${base}/channels/${chatId}/messages/${msgId}?hidetip=false`;

  try {
    const res = await authFetch(session, endpoint, { method: 'DELETE' });
    return res.ok;
  } catch (err) {
    // 消息撤回异常需记录错误，便于排查
    emitSystemLog(
      projectPath,
      '官方消息撤回异常: ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
    return false;
  }
}

// ── 互动事件响应 ──

/** 互动回调的响应码（官方 `PUT /interactions/{id}` 的 body.code） */
export type InteractionCode =
  /** 0 成功 */
  | 0
  /** 1 操作失败 */
  | 1
  /** 2 操作频繁 */
  | 2
  /** 3 重复操作 */
  | 3
  /** 4 没有权限 */
  | 4
  /** 5 仅管理员操作 */
  | 5;

/**
 * 回应互动事件（`PUT /interactions/{interaction_id}`）。
 *
 * 官方约束（三条都容易踩）：
 *   1. **仅 `type=11`（消息按钮）与 `type=12`（快捷菜单）需要回应**；其余类型不必回应。
 *   2. 同一 `interaction_id` **只能回应一次**，超时后失效。
 *   3. 客户端等待超时为 **3 秒** —— 所以业务逻辑必须先回执再干活，不能等业务流程跑完才回。
 *
 * `interactionId` 取事件体的 `d.id`，**不带 `INTERACTION_CREATE:` 前缀**。
 */
export async function answerInteraction(
  projectPath: string,
  interactionId: string,
  code: InteractionCode = 0,
): Promise<{ ok: boolean; error?: string }> {
  const session = getSession(projectPath);
  if (!session || !session.alive) return { ok: false, error: 'session不存在或未连接' };
  if (!interactionId) return { ok: false, error: 'interaction_id 不能为空' };

  const base = apiBase(session.sandbox);
  // 注意：互动回执路径**没有 /v2 前缀**
  const endpoint = `${base}/interactions/${interactionId}`;
  try {
    const res = await authFetch(session, endpoint, {
      method: 'PUT',
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const msg = `互动回执失败: HTTP ${res.status} ${text.slice(0, 200)}`;
      emitSystemLog(projectPath, msg, 'warn');
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = '互动回执异常: ' + (err instanceof Error ? err.message : String(err));
    emitSystemLog(projectPath, msg, 'error');
    return { ok: false, error: msg };
  }
}

// ── QQ 群管理（官方群接口） ──
//
// 这批接口有共同的硬门槛，调用失败时要把原因讲清楚，否则用户只会看到
// 一个 11253 或 401 不知道怎么办：
//   · 禁言 / 入群审批 → 需机器人为**群管理员**
//   · 群信息 / 群成员列表 / 批量踢人 → 目前为**内邀接入中或仅白名单**（11253）
//   · 禁言单次 ≤20 人，最长 30 天

/** 禁言时长上限（秒）：官方文档明确「最大禁言时长为 30 天」 */
const GROUP_MUTE_MAX_SECONDS = 30 * 24 * 60 * 60;

/**
 * 官方错误码 → 可操作的中文提示（覆盖群管理 / 菜单面板 / 频道 / 通用）。
 *
 * 三类接口此前各写了一份几乎相同的解释函数与调用封装，加频道时眼看要写第四份。
 * 重复的映射表正是本项目历史上「模式清单漂移」的成因，所以统一到这里一处。
 */
function explainOpenApiError(status: number, body: string, scope: string): string {
  // —— 权限类（跨场景通用）——
  if (body.includes('11253')) {
    return '应用无接口访问权限：该能力目前为内邀接入中或仅白名单机器人可用，需联系平台运营申请';
  }
  if (body.includes('11254')) return '应用接口被封禁';
  if (body.includes('11282') || body.includes('11264')) {
    return `机器人权限不足：需要在目标${scope}拥有管理员身份`;
  }

  // —— 菜单 / 指令面板类 ——
  const menuPanel: ReadonlyArray<readonly [string, string]> = [
    ['40030008', 'URL 格式错误：链接必须以 https:// 开头'],
    ['40030009', '存在并发操作冲突，请稍后重试'],
    ['40030011', '生效场景不合法：scope 仅支持 c2c / group / channel / dm'],
    ['40030012', '生效范围不合法：target_type 仅支持 all / specific（channel 与 dm 只能传 all）'],
    ['40030013', '超出数量限制：请减少数量（菜单项 ≤10、子菜单 ≤5、面板元素 ≤20、单次指定 ≤20 个）'],
    ['40030014', '菜单类型不合法：仅支持 switch / send_message / link / menu'],
    ['40030015', '面板元素类型不合法：panel_item.type 仅支持 command / link'],
    ['40030016', '必填字段缺失：请检查参数是否完整'],
    ['40030018', '当前场景不支持此操作：请检查 scope'],
    ['40030020', '内容存在安全风险，请修改后重试（菜单/面板文案含敏感信息）'],
    ['40030021', '全局面板不支持添加指定关联对象：target_type=all 的面板请改用 specific 模式'],
  ];
  for (const [code, msg] of menuPanel) {
    if (body.includes(code)) return msg;
  }

  // —— 频道内容类 ——
  if (body.includes('304003')) return 'URL 未报备：该地址未在开放平台报备，无法作为链接下发';
  if (body.includes('304004')) return '没有发送 ark 消息的权限';
  if (body.includes('304035')) return '主动消息推送超过限制的子频道数（每频道每天最多 2 个子频道）';
  if (body.includes('306004')) return '没有撤回此消息的权限';

  // —— 群管理类 ——
  if (body.includes('40103002')) {
    return '无效的成员标识（该用户不是本群成员，或 openid 不正确）';
  }

  if (status === 401) return '鉴权失败：AccessToken 无效或已过期';
  if (status === 403) return `没有权限：需要管理员身份或相应接口授权`;
  if (status === 429) return '触发频率限制，请稍后重试';

  // 其余未识别的错误：**把官方的 code / message 摘出来**，而不是把整段 JSON 原样
  // 吐给用户 —— 那样既难看，又把 trace_id 之类的内部信息散到界面上。
  try {
    const parsed = JSON.parse(body) as { code?: unknown; err_code?: unknown; message?: unknown };
    const code = parsed.code ?? parsed.err_code;
    if (code !== undefined || parsed.message !== undefined) {
      return `${String(parsed.message ?? '请求失败')}（code=${String(code ?? '?')}）`;
    }
  } catch {
    // 非 JSON 响应（网关页面等）走下面的兜底
  }
  return `HTTP ${status} ${body.slice(0, 120)}`;
}

/**
 * 统一的开放接口调用：返回解析后的 JSON，失败时给出可读错误。
 *
 * @param label 用于日志与错误前缀，例如「查询群信息」「创建子频道」
 * @param scope 权限提示里用的目标名词，例如「群」「频道」
 */
async function callOpenApi(
  projectPath: string,
  endpoint: string,
  init: RequestInit,
  label: string,
  scope = '群',
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const session = getSession(projectPath);
  if (!session || !session.alive) return { ok: false, error: 'session不存在或未连接' };
  try {
    const res = await authFetch(session, endpoint, init);
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const error = `${label}失败：${explainOpenApiError(res.status, text, scope)}`;
      emitSystemLog(projectPath, `${error}（${endpoint}）`, 'warn');
      return { ok: false, error };
    }
    // 官方部分接口成功时返回空体或 {}，统一兜成空对象
    if (!text.trim()) return { ok: true, data: {} };
    try {
      return { ok: true, data: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { ok: true, data: {} };
    }
  } catch (err) {
    const error = `${label}异常: ` + (err instanceof Error ? err.message : String(err));
    emitSystemLog(projectPath, error, 'error');
    return { ok: false, error };
  }
}

/** 群管理接口：走统一封装，权限提示里用「群」 */
function callGroupApi(projectPath: string, endpoint: string, init: RequestInit) {
  return callOpenApi(projectPath, endpoint, init, '群管理接口', '群');
}

/**
 * 设置群成员禁言（官方 `POST /v2/groups/{group_openid}/restrict_chat_setting`）。
 *
 * @param durationSeconds 0 表示立即解除禁言；否则为禁言时长（秒），上限 30 天
 */
export async function setGroupMemberMute(
  projectPath: string,
  groupOpenid: string,
  memberOpenid: string,
  durationSeconds: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const base = apiBase(session.sandbox);

  const seconds = Number(durationSeconds) || 0;
  const lift = seconds <= 0;
  if (!lift && seconds > GROUP_MUTE_MAX_SECONDS) {
    return {
      ok: false,
      error: `禁言时长超上限：官方最大 30 天，收到 ${Math.round(seconds / 86400)} 天`,
    };
  }
  const member: Record<string, unknown> = {
    op: lift ? 'del' : 'add',
    member_openid: memberOpenid,
  };
  // op=del 时传空串表示立即解除
  member.mute_expire_at = lift ? '' : new Date(Date.now() + seconds * 1000).toISOString();

  const r = await callGroupApi(
    projectPath,
    `${base}/v2/groups/${groupOpenid}/restrict_chat_setting`,
    { method: 'POST', body: JSON.stringify({ members: [member] }) },
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ── 全员禁言规则判定（纯函数，可离线回归） ──
//
// 「查询群禁言状态」GET 与「设置群成员禁言」POST **同路径不同方法**，
// 返回体结构也完全不同：GET 给的是 global_rule（群级规则）+ members（成员级列表）。
// 对象/数组的收窄复用文件下方的 asRecord / asArray（它们同时容忍"字段被塞成 JSON 字符串"）。

/**
 * 北京时间（UTC+8）下的「星期几」与「当天第几分钟」。
 *
 * 官方文档明确周期规则的 `start_time` / `end_time` 是**北京时间**，
 * 因此这里不读运行机器的本地时区 —— 否则在同一份配置上，
 * 部署到 UTC 机器会得出与 QQ 侧不一致的判定。
 */
export function beijingClock(now: Date): { weekday: number; minutes: number } {
  const bj = new Date(now.getTime() + 8 * 3600_000);
  const day = bj.getUTCDay(); // 0=周日
  return { weekday: day === 0 ? 7 : day, minutes: bj.getUTCHours() * 60 + bj.getUTCMinutes() };
}

/** `"HH:mm"` → 当天第几分钟；不合法返回 null（不猜） */
function parseHm(value: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 同一天内的时段判定（左闭右开）：调用方已排除跨天与零长度窗口 */
function withinWindow(cur: number, start: number, end: number): boolean {
  return cur >= start && cur < end;
}

/** 前一天（1=周一 … 7=周日，7 的前一天是 6，1 的前一天是 7） */
function previousWeekday(weekday: number): number {
  return weekday === 1 ? 7 : weekday - 1;
}

/**
 * 此刻是否**真的**处于全员禁言中。
 *
 * 为什么不能只看 `global_rule.mode`：`mode` 只说明**配置了哪一类规则**。
 * 官方文档的响应示例就是 `mode: "schedule"` 且两条定时规则 `enabled: false` ——
 * 此时群里并没有被禁言。只看 mode 会把「配了但没生效」误报成「正在禁言」，
 * 而这类误报会让下游的「禁言中就不回复」逻辑整段失效。
 *
 * 逐条按官方字段判定：
 *   · `always`   → 恒真
 *   · `none`     → 恒假
 *   · `schedule` → 任一 `enabled` 定时规则覆盖当前时刻，
 *                  或任一 `enabled` 周期规则覆盖当前「星期 + 时段」
 *
 * 周期规则的 `end_time` 小于 `start_time` 表示**跨天到次日**（官方文档明确）。
 * 跨天时后半段落在第二天，所以要同时检查「今天在 weekdays 且已过 start_time」与
 * 「昨天在 weekdays 且还没到 end_time」——只看今天会把跨天窗口的下半段漏掉。
 *
 * `enabled` 缺省按**启用**处理（只在显式为 false 时跳过），避免字段缺失被当成"没生效"。
 * 未知 mode 一律返回 false —— 宁可不判，也不猜。
 */
export function isGroupMutedNow(globalRule: unknown, now: Date = new Date()): boolean {
  const rule = asRecord(globalRule) ?? {};
  const mode = String(rule.mode ?? 'none');
  if (mode === 'always') return true;
  if (mode !== 'schedule') return false;

  const t = now.getTime();
  for (const raw of asArray(rule.schedule_rules) ?? []) {
    const r = asRecord(raw) ?? {};
    if (r.enabled === false) continue;
    const start = Date.parse(String(r.start_at ?? ''));
    const end = Date.parse(String(r.end_at ?? ''));
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (t >= start && t < end) return true;
  }

  const { weekday, minutes } = beijingClock(now);
  const prev = previousWeekday(weekday);
  for (const raw of asArray(rule.recurring_rules) ?? []) {
    const r = asRecord(raw) ?? {};
    if (r.enabled === false) continue;
    const days = (asArray(r.weekdays) ?? []).map((d) => Number(d));
    const start = parseHm(r.start_time);
    const end = parseHm(r.end_time);
    if (start === null || end === null) continue;
    if (start === end) continue; // 零长度窗口，官方不该出现，跳过而不是当成全天
    if (end > start) {
      if (days.includes(weekday) && withinWindow(minutes, start, end)) return true;
      continue;
    }
    // 跨天：今天负责 start→24:00，昨天负责 00:00→end
    if (days.includes(weekday) && minutes >= start) return true;
    if (days.includes(prev) && minutes < end) return true;
  }
  return false;
}

/**
 * 查询群禁言状态（官方 `GET /v2/groups/{group_openid}/restrict_chat_setting`）。
 *
 * 返回 `global_rule`（群级全员禁言规则）+ `members`（当前禁言中的成员）。
 * 需机器人为**群管理员**（实测：未设管理员时返回 `11703`）。
 */
export async function getGroupMuteState(
  projectPath: string,
  groupOpenid: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!groupOpenid) return { ok: false, error: 'group_openid 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callGroupApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/${groupOpenid}/restrict_chat_setting`,
    { method: 'GET' },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 批量移除群成员（官方 `POST /v2/groups/{group_openid}/batch_remove_members`）。
 * 单次最多 20 个；该能力目前为内邀接入中。
 */
export async function removeGroupMembers(
  projectPath: string,
  groupOpenid: string,
  memberOpenids: string[],
  addToBlacklist = false,
): Promise<{ ok: boolean; error?: string }> {
  const ids = memberOpenids.filter(Boolean);
  if (!ids.length) return { ok: false, error: 'member_openids 不能为空' };
  if (ids.length > GROUP_BATCH_MAX) {
    return { ok: false, error: `单次最多移除 ${GROUP_BATCH_MAX} 人，收到 ${ids.length} 人` };
  }
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const base = apiBase(session.sandbox);

  const r = await callGroupApi(
    projectPath,
    `${base}/v2/groups/${groupOpenid}/batch_remove_members`,
    {
      method: 'POST',
      body: JSON.stringify({ member_openids: ids, add_to_member_blacklist: addToBlacklist }),
    },
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** 获取群基本信息（官方 `GET /v2/groups/{group_openid}/info`，仅白名单机器人可用） */
export async function getGroupInfo(
  projectPath: string,
  groupOpenid: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const base = apiBase(session.sandbox);
  const r = await callGroupApi(projectPath, `${base}/v2/groups/${groupOpenid}/info`, {
    method: 'GET',
  });
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 获取群成员列表（官方 `GET /v2/groups/{group_openid}/members`，游标分页，每次最多 30 条） */
export async function getGroupMembers(
  projectPath: string,
  groupOpenid: string,
  cursor = '',
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const base = apiBase(session.sandbox);
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const r = await callGroupApi(projectPath, `${base}/v2/groups/${groupOpenid}/members${qs}`, {
    method: 'GET',
  });
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 审批入群申请（官方 `POST /v2/groups/{group_openid}/approval_join_request/{member_openid}`）。
 * 需机器人为群管理员。
 */
export async function approveGroupJoinRequest(
  projectPath: string,
  groupOpenid: string,
  memberOpenid: string,
  approve: boolean,
  options: { joinRequestId?: string; rejectReason?: string; addToBlacklist?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const base = apiBase(session.sandbox);

  const body: Record<string, unknown> = { op: approve ? 'approve' : 'decline' };
  if (options.joinRequestId) body.join_request_id = options.joinRequestId;
  if (!approve) {
    if (options.rejectReason) body.reject_reason = options.rejectReason;
    if (options.addToBlacklist) body.add_to_member_blacklist = true;
  }

  const r = await callGroupApi(
    projectPath,
    `${base}/v2/groups/${groupOpenid}/approval_join_request/${memberOpenid}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ── QQ 频道专属能力（子频道 / 公告 / 精华 / 表情表态） ──
//
// 这批接口**只在频道（Guild）场景存在**，群聊与单聊没有对应概念。
// 与群管理一样，失败原因多集中在权限（需管理员）与额度，统一走 callOpenApi。

/** 频道接口：统一封装，权限提示里用「频道」 */
function callChannelApi(projectPath: string, endpoint: string, init: RequestInit, label: string) {
  return callOpenApi(projectPath, endpoint, init, label, '频道');
}

/** 子频道类型（官方枚举），用于把用户选的类型名转成整数 */
export const CHANNEL_TYPE_CODES: Readonly<Record<string, number>> = {
  text: 0,
  voice: 2,
  category: 4,
  live: 10005,
  application: 10006,
  forum: 10007,
};

/** 获取子频道列表（官方 `GET /guilds/{guild_id}/channels`） */
export async function listGuildChannels(
  projectPath: string,
  guildId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!guildId) return { ok: false, error: 'guild_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/guilds/${guildId}/channels`,
    { method: 'GET' },
    '获取子频道列表',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 创建子频道（官方 `POST /guilds/{guild_id}/channels`，**需管理员权限**，私域接口）。
 *
 * @param body 原样透传：name / type / sub_type / position / parent_id / private_type / speak_permission
 */
export async function createGuildChannel(
  projectPath: string,
  guildId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!guildId) return { ok: false, error: 'guild_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/guilds/${guildId}/channels`,
    { method: 'POST', body: JSON.stringify(body) },
    '创建子频道',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 获取子频道详情（官方 `GET /channels/{channel_id}`） */
export async function getGuildChannel(
  projectPath: string,
  channelId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId) return { ok: false, error: 'channel_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}`,
    { method: 'GET' },
    '获取子频道详情',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 修改子频道（官方 `PATCH /channels/{channel_id}`，需管理员权限） */
export async function updateGuildChannel(
  projectPath: string,
  channelId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId) return { ok: false, error: 'channel_id 不能为空' };
  if (!Object.keys(body).length) {
    return { ok: false, error: '修改子频道至少需要一个字段（名称/排序/发言权限…）' };
  }
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    '修改子频道',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 删除子频道（官方 `DELETE /channels/{channel_id}`，**删除后无法恢复**） */
export async function deleteGuildChannel(
  projectPath: string,
  channelId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId) return { ok: false, error: 'channel_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}`,
    { method: 'DELETE' },
    '删除子频道',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 创建频道公告（官方 `POST /guilds/{guild_id}/announces`）。
 *
 * 两种公告互斥、会互相顶替：
 *   · `message_id` 有值 → 消息类型（此时 `channel_id` 必填），**只能建成成员公告**
 *   · `message_id` 为空 + `announces_type` + `recommend_channels` → 推荐子频道类型（一次性全量替换）
 * 同频道推荐子频道最多 3 条，且只有「全体成员可见」的子频道才能设为推荐。
 */
export async function createChannelAnnounce(
  projectPath: string,
  guildId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!guildId) return { ok: false, error: 'guild_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };

  // 本地先拦官方那条硬约束：消息类型公告必须带 channel_id
  if (body.message_id && !body.channel_id) {
    return { ok: false, error: '消息类型的频道公告必须提供 channel_id' };
  }
  const recommends = body.recommend_channels;
  if (Array.isArray(recommends) && recommends.length > 3) {
    return { ok: false, error: `同一频道推荐子频道最多 3 条，收到 ${recommends.length} 条` };
  }

  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/guilds/${guildId}/announces`,
    { method: 'POST', body: JSON.stringify(body) },
    '创建频道公告',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 删除频道公告（官方 `DELETE /guilds/{guild_id}/announces/{message_id}`）。
 * 删除**推荐子频道类型**的公告时，`messageId` 传 `all`。
 */
export async function deleteChannelAnnounce(
  projectPath: string,
  guildId: string,
  messageId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!guildId) return { ok: false, error: 'guild_id 不能为空' };
  if (!messageId) return { ok: false, error: 'message_id 不能为空（删除推荐类型公告请传 all）' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/guilds/${guildId}/announces/${messageId}`,
    { method: 'DELETE' },
    '删除频道公告',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 添加精华消息（官方 `PUT /channels/{channel_id}/pins/{message_id}`，单子频道最多 20 条） */
export async function addChannelPin(
  projectPath: string,
  channelId: string,
  messageId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId || !messageId) return { ok: false, error: 'channel_id 与 message_id 都不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}/pins/${messageId}`,
    { method: 'PUT' },
    '添加精华消息',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 获取精华消息列表（官方 `GET /channels/{channel_id}/pins`） */
export async function listChannelPins(
  projectPath: string,
  channelId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId) return { ok: false, error: 'channel_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}/pins`,
    { method: 'GET' },
    '获取精华消息',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 删除精华消息（官方 `DELETE /channels/{channel_id}/pins/{message_id}`，传 `all` 删除全部） */
export async function removeChannelPin(
  projectPath: string,
  channelId: string,
  messageId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId || !messageId) return { ok: false, error: 'channel_id 与 message_id 都不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}/pins/${messageId}`,
    { method: 'DELETE' },
    '删除精华消息',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 表情表态的 emoji 类型：1 = 系统表情，2 = emoji 表情 */
export const REACTION_EMOJI_TYPES: Readonly<Record<string, number>> = { system: 1, unicode: 2 };

/** 机器人发表表情表态（官方 `PUT /channels/{cid}/messages/{mid}/reactions/{type}/{id}`） */
export async function addChannelReaction(
  projectPath: string,
  channelId: string,
  messageId: string,
  emojiType: number,
  emojiId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId || !messageId || !emojiId) {
    return { ok: false, error: 'channel_id / message_id / emoji_id 都不能为空' };
  }
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}/messages/${messageId}/reactions/${emojiType}/${emojiId}`,
    { method: 'PUT' },
    '发表表情表态',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 删除机器人发表的表情表态（官方 `DELETE` 同一路径） */
export async function removeChannelReaction(
  projectPath: string,
  channelId: string,
  messageId: string,
  emojiType: number,
  emojiId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId || !messageId || !emojiId) {
    return { ok: false, error: 'channel_id / message_id / emoji_id 都不能为空' };
  }
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}/messages/${messageId}/reactions/${emojiType}/${emojiId}`,
    { method: 'DELETE' },
    '删除表情表态',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 获取消息表情表态的用户列表（官方 `GET` 同一路径，游标分页）。
 * `limit` 默认 20、最多 50，且**只在第一次请求时生效**，后续翻页用返回的 `cookie`。
 */
export async function listChannelReactionUsers(
  projectPath: string,
  channelId: string,
  messageId: string,
  emojiType: number,
  emojiId: string,
  cursor = '',
  limit?: number,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!channelId || !messageId || !emojiId) {
    return { ok: false, error: 'channel_id / message_id / emoji_id 都不能为空' };
  }
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const qs = new URLSearchParams();
  if (cursor) qs.set('cookie', cursor);
  if (limit && Number(limit) > 0) qs.set('limit', String(Math.min(50, Number(limit))));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const r = await callChannelApi(
    projectPath,
    `${apiBase(session.sandbox)}/channels/${channelId}/messages/${messageId}/reactions/${emojiType}/${emojiId}${suffix}`,
    { method: 'GET' },
    '获取表情表态用户列表',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 拉取入群申请列表（官方 `GET /v2/groups/{group_openid}/join_request_list`）。
 *
 * 需机器人为**群管理员**（实测：设成管理员前返回 `11703 机器人不是群管理员`）。
 * 与「入群申请审批」配套 —— 审批靠 `GROUP_JOIN_REQUEST` 事件拿到具体申请，
 * 这个接口用于**查看待处理的全貌**（对账、漏事件时补看）。
 */
export async function listGroupJoinRequests(
  projectPath: string,
  groupOpenid: string,
  cursor = '',
  limit?: number,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!groupOpenid) return { ok: false, error: 'group_openid 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit && Number(limit) > 0) qs.set('limit', String(Math.min(50, Number(limit))));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const r = await callGroupApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/${groupOpenid}/join_request_list${suffix}`,
    { method: 'GET' },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

// ── 群成员管理 / 群黑名单 / 入群自动审批策略 ──
//
// 这三组都属于「接口在、但部分要资质」的能力：
//   · 群成员信息 / 群黑名单 —— **内邀接入中**（11253），写完也未必能立刻调通
//   · 机器人群内状态       —— 与群信息同批（文档标"仅白名单"，实测进群即可用）
//   · 入群自动审批策略     —— **实测可用**（本 bot 能查到策略列表）
//
// 因此这里把「官方数量上限」和「参数形状」做成**纯函数**（可离线回归），
// 网络部分只负责拼 URL 与请求体 —— 上限写错、二选一参数同时传，
// 都是官方会直接报错而用户看不懂的类型。

/**
 * 获取机器人自身详情（`GET /users/@me`）。
 *
 * 以前只靠会话里缓存的 `self_id` 与写死的昵称「QQBot」—— 界面上想显示真实机器人名/头像
 * 就只能自己去调接口。这里把它接到官方，失败时由调用方回退到缓存值。
 */
export async function getBotSelf(
  projectPath: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callOpenApi(
    projectPath,
    `${apiBase(session.sandbox)}/users/@me`,
    { method: 'GET' },
    '获取机器人详情',
    '机器人',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 群成员批量移除 / 黑名单 / 禁言单次人数上限（官方契约：同为 20） */
export const GROUP_BATCH_MAX = 20;
/** 入群自动审批策略：单策略最多关联的群数 */
export const STRATEGY_MAX_GROUPS = 100;
/** 入群自动审批策略：单个机器人的策略数上限（服务端限制，本地只做提示） */
export const STRATEGY_MAX_COUNT = 20;
/** 策略白名单：单次最多提交的号码数 */
export const WHITELIST_BATCH_MAX = 10_000;
/** 分享链接的 callback_data 最长字符数（官方契约） */
export const CALLBACK_DATA_MAX = 32;

/**
 * 群号归一化：`group_ids` 官方是 uint64 数组。
 *
 * 群号在 2^53 以内，用 number 传最稳；但用户可能从表格里粘进来带空格的字符串，
 * 这里统一 trim + 转数字，非数字原样保留（让官方报"参数异常"而不是我们悄悄改成 0）。
 */
export function toGroupIdValue(raw: unknown): number | string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : s;
}

/**
 * 入群自动审批策略的创建/修改参数校验（纯函数）。
 *
 * 官方有两条**容易踩的硬约束**：
 *   1. `group_openids` 与 `group_ids` **二选一**，"同时传入或均未传入均返回错误"；
 *   2. PATCH 的 `group_action` 里，**群标识形式必须与创建时一致** ——
 *      创建用的 openid，修改时也得用 openid。
 *
 * 本地先把这两条拦住，比让用户对着 `10001 请求参数异常` 猜要好。
 */
export function validateStrategyGroups(input: {
  groupOpenids?: unknown;
  groupIds?: unknown;
}): { ok: true; value: { group_openids?: string[]; group_ids?: Array<number | string> } } | { ok: false; error: string } {
  const openids = (Array.isArray(input.groupOpenids) ? input.groupOpenids : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  const ids = (Array.isArray(input.groupIds) ? input.groupIds : [])
    .map(toGroupIdValue)
    .filter((v) => v !== '');
  if (openids.length && ids.length) {
    return { ok: false, error: 'group_openids 与 group_ids 只能填一个（官方同时传入会报错）' };
  }
  if (!openids.length && !ids.length) {
    return { ok: false, error: 'group_openids 与 group_ids 必须填一个（关联到哪些群）' };
  }
  if (openids.length > STRATEGY_MAX_GROUPS) {
    return { ok: false, error: `单个策略最多关联 ${STRATEGY_MAX_GROUPS} 个群，收到 ${openids.length} 个` };
  }
  if (ids.length > STRATEGY_MAX_GROUPS) {
    return { ok: false, error: `单个策略最多关联 ${STRATEGY_MAX_GROUPS} 个群，收到 ${ids.length} 个` };
  }
  return openids.length ? { ok: true, value: { group_openids: openids } } : { ok: true, value: { group_ids: ids } };
}

/** 策略白名单参数校验（纯函数）：op 只能是 add/del，单次 ≤10000，且号码必须是数字串 */
export function validateWhitelistUsers(
  op: unknown,
  users: unknown,
): { ok: true; value: { op: 'add' | 'del'; whitelist_users: string[] } } | { ok: false; error: string } {
  const opStr = String(op ?? '').trim();
  if (opStr !== 'add' && opStr !== 'del') {
    return { ok: false, error: `op 只能是 add 或 del，收到 ${opStr || '(空)'}` };
  }
  const list = (Array.isArray(users) ? users : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  if (!list.length) return { ok: false, error: 'whitelist_users 不能为空' };
  if (list.length > WHITELIST_BATCH_MAX) {
    return { ok: false, error: `单次最多 ${WHITELIST_BATCH_MAX} 个号码，收到 ${list.length} 个` };
  }
  const bad = list.filter((u) => !/^\d+$/.test(u));
  if (bad.length) {
    return { ok: false, error: `白名单必须是纯数字 QQ 号，这些不合法：${bad.slice(0, 5).join(', ')}` };
  }
  return { ok: true, value: { op: opStr, whitelist_users: list } };
}

/** 分享链接的 callback_data 校验（纯函数）：官方限 32 字符，超了直接报 10001 */
export function validateCallbackData(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? '').trim();
  if (s.length > CALLBACK_DATA_MAX) {
    return { ok: false, error: `callback_data 最长 ${CALLBACK_DATA_MAX} 个字符，收到 ${s.length} 个` };
  }
  return { ok: true, value: s };
}

/** 获取群成员信息（`GET /v2/groups/{group_openid}/members/{member_openid}`，内邀接入中） */
export async function getGroupMemberInfo(
  projectPath: string,
  groupOpenid: string,
  memberOpenid: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!groupOpenid) return { ok: false, error: 'group_openid 不能为空' };
  if (!memberOpenid) return { ok: false, error: 'member_openid 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callGroupApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/${groupOpenid}/members/${memberOpenid}`,
    { method: 'GET' },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 获取机器人群内状态（`GET .../bot_state`）：是否接收主动推送、收消息模式、群内角色 */
export async function getGroupBotState(
  projectPath: string,
  groupOpenid: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!groupOpenid) return { ok: false, error: 'group_openid 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callGroupApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/${groupOpenid}/bot_state`,
    { method: 'GET' },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 群黑名单查询（`GET .../member_blacklist`，内邀接入中；单页 ≤100） */
export async function listGroupBlacklist(
  projectPath: string,
  groupOpenid: string,
  cursor = '',
  limit?: number,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!groupOpenid) return { ok: false, error: 'group_openid 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit && Number(limit) > 0) qs.set('limit', String(Math.min(100, Number(limit))));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const r = await callGroupApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/${groupOpenid}/member_blacklist${suffix}`,
    { method: 'GET' },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 群黑名单操作（`POST .../member_blacklist`，内邀接入中）。
 *
 * ⚠️ 官方硬约束：**目标用户在群里时无法加入黑名单**（要先移除再拉黑）。
 * 这条不本地拦（服务端才知道用户在不在群里），但报错时 `fail_openids` 会指出哪些失败。
 */
export async function updateGroupBlacklist(
  projectPath: string,
  groupOpenid: string,
  memberOpenids: string[],
  op: 'add' | 'del',
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!groupOpenid) return { ok: false, error: 'group_openid 不能为空' };
  const ids = memberOpenids.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'member_openids 不能为空' };
  if (ids.length > GROUP_BATCH_MAX) {
    return { ok: false, error: `单次最多 ${GROUP_BATCH_MAX} 个，收到 ${ids.length} 个` };
  }
  if (op !== 'add' && op !== 'del') return { ok: false, error: `op 只能是 add 或 del，收到 ${op}` };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callGroupApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/${groupOpenid}/member_blacklist`,
    { method: 'POST', body: JSON.stringify({ op, member_openids: ids }) },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

// ── 入群自动审批策略（配置类：一次配置、长期生效）──
//
// 与「按事件逐条审批」是两条互补的路：
//   · `approval_join_request` —— 事件驱动，来一个批一个（流程可控但要求在线）
//   · 本组接口              —— 规则驱动，官方**异步全量扫描**（离线也能批）
// 该接口的 scope 用「机器人配置」，因为失败原因集中在参数与上限而非群权限。

function callStrategyApi(projectPath: string, endpoint: string, init: RequestInit, label: string) {
  return callOpenApi(projectPath, endpoint, init, label, '机器人配置');
}

/** 查询入群自动审批策略列表（`GET /v2/groups/join_approval_strategy`，实测可用） */
export async function listJoinApprovalStrategies(
  projectPath: string,
  cursor = '',
  limit?: number,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit && Number(limit) > 0) qs.set('limit', String(Math.min(50, Number(limit))));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const r = await callStrategyApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/join_approval_strategy${suffix}`,
    { method: 'GET' },
    '查询入群自动审批策略',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 创建入群自动审批策略（`POST /v2/groups/join_approval_strategy`） */
export async function createJoinApprovalStrategy(
  projectPath: string,
  input: {
    groupOpenids?: unknown;
    groupIds?: unknown;
    isEnable?: unknown;
    expireAt?: unknown;
    remark?: unknown;
  },
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const groups = validateStrategyGroups(input);
  if (!groups.ok) return { ok: false, error: groups.error };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };

  const body: Record<string, unknown> = { ...groups.value };
  // 官方用 'on' / 'off' 字符串而不是布尔 —— 传 true/false 会被判参数异常
  body.is_enable = input.isEnable === 'off' || input.isEnable === false ? 'off' : 'on';
  const expireAt = String(input.expireAt ?? '').trim();
  if (expireAt) body.expire_at = expireAt;
  const remark = String(input.remark ?? '').trim();
  if (remark) body.remark = remark;

  const r = await callStrategyApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/join_approval_strategy`,
    { method: 'POST', body: JSON.stringify(body) },
    '创建入群自动审批策略',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 修改入群自动审批策略（`PATCH .../{strategy_id}`）；关联群增删同样二选一 */
export async function updateJoinApprovalStrategy(
  projectPath: string,
  strategyId: string,
  input: {
    isEnable?: unknown;
    expireAt?: unknown;
    remark?: unknown;
    groupOp?: unknown;
    groupOpenids?: unknown;
    groupIds?: unknown;
  },
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const id = String(strategyId ?? '').trim();
  if (!id) return { ok: false, error: 'strategy_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };

  const body: Record<string, unknown> = {};
  if (input.isEnable !== undefined && input.isEnable !== '') {
    body.is_enable = input.isEnable === 'off' || input.isEnable === false ? 'off' : 'on';
  }
  const expireAt = String(input.expireAt ?? '').trim();
  if (expireAt) body.expire_at = expireAt;
  const remark = String(input.remark ?? '').trim();
  if (remark) body.remark = remark;

  const groupOp = String(input.groupOp ?? '').trim();
  if (groupOp) {
    if (groupOp !== 'add' && groupOp !== 'del') {
      return { ok: false, error: `group_action.op 只能是 add 或 del，收到 ${groupOp}` };
    }
    const groups = validateStrategyGroups(input);
    if (!groups.ok) return { ok: false, error: groups.error };
    body.group_action = { op: groupOp, ...groups.value };
  }
  if (!Object.keys(body).length) {
    return { ok: false, error: '没有要修改的内容（启用状态 / 过期时间 / 备注 / 关联群 至少填一个）' };
  }

  const r = await callStrategyApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/join_approval_strategy/${id}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    '修改入群自动审批策略',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 删除入群自动审批策略（`DELETE .../{strategy_id}`） */
export async function deleteJoinApprovalStrategy(
  projectPath: string,
  strategyId: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const id = String(strategyId ?? '').trim();
  if (!id) return { ok: false, error: 'strategy_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callStrategyApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/join_approval_strategy/${id}`,
    { method: 'DELETE' },
    '删除入群自动审批策略',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 执行入群自动审批策略（`POST .../{strategy_id}/execute`）。
 *
 * ⚠️ 官方说明：**异步全量扫描，约 10 分钟**。这里返回成功只代表"任务已受理"，
 * 不代表审批已经跑完 —— 文案上必须说清楚，否则用户会以为没生效。
 */
export async function executeJoinApprovalStrategy(
  projectPath: string,
  strategyId: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const id = String(strategyId ?? '').trim();
  if (!id) return { ok: false, error: 'strategy_id 不能为空' };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callStrategyApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/join_approval_strategy/${id}/execute`,
    { method: 'POST', body: JSON.stringify({}) },
    '执行入群自动审批策略',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 修改策略白名单号码（`POST .../{strategy_id}/whitelist_users`；单次 ≤10000，上限 10W） */
export async function updateStrategyWhitelist(
  projectPath: string,
  strategyId: string,
  op: unknown,
  users: unknown,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const id = String(strategyId ?? '').trim();
  if (!id) return { ok: false, error: 'strategy_id 不能为空' };
  const checked = validateWhitelistUsers(op, users);
  if (!checked.ok) return { ok: false, error: checked.error };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callStrategyApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/groups/join_approval_strategy/${id}/whitelist_users`,
    { method: 'POST', body: JSON.stringify(checked.value) },
    '修改策略白名单',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 生成机器人分享链接（`POST /v2/generate_url_link`）。
 *
 * 用户通过该链接添加机器人时，`callback_data` 会原样透传到 `FRIEND_ADD` 事件的
 * `scene_param` —— 也就是"这个用户是从哪张海报/哪个群来的"，做渠道统计就靠它。
 */
export async function generateUrlLink(
  projectPath: string,
  callbackData: unknown,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const checked = validateCallbackData(callbackData);
  if (!checked.ok) return { ok: false, error: checked.error };
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/generate_url_link`,
    { method: 'POST', body: JSON.stringify({ callback_data: checked.value }) },
    '生成分享链接',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

// ── 自定义菜单 / 指令面板（配置类，非消息收发） ──
//
// 两者都是「一次配置、长期生效」的能力，与消息链路的区别：
//   · 不针对某个会话，因此不需要 UID ↔ openid 换算
//   · 失败原因集中在内容合规与数量上限，需要把官方错误码翻成人话

/**
 * 菜单/面板接口：走统一封装。
 *
 * 官方对菜单/面板的限频比别处紧（菜单修改 5 QPM、面板创建 10 QPM），
 * scope 传「机器人配置」是为了让权限/限频提示带上这个上下文。
 */
function callConfigApi(projectPath: string, endpoint: string, init: RequestInit, label: string) {
  return callOpenApi(projectPath, endpoint, init, label, '机器人配置');
}

/** 是否含 `://` 但不是 https —— 官方明确要求链接必须以 https:// 开头 */
export function findNonHttpsLink(value: unknown): string | null {
  let found: string | null = null;
  const walk = (node: unknown): void => {
    if (found) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (found) return;
        // 只看 link 字段：其它字段里出现 http 字样不代表是链接
        if (k === 'link' && typeof v === 'string' && v && !/^https:\/\//i.test(v)) {
          found = v;
          return;
        }
        walk(v);
      }
    }
  };
  walk(value);
  return found;
}

/** 查询全局自定义菜单（官方 `GET /v2/menu`，仅 C2C 单聊场景） */
export async function getMenu(
  projectPath: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const r = await callConfigApi(projectPath, `${apiBase(session.sandbox)}/v2/menu`, {
    method: 'GET',
  }, '查询自定义菜单');
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 修改全局自定义菜单（官方 `PUT /v2/menu`，5 QPM）。
 *
 * **传入即整体覆盖**原有菜单配置 —— 不是增量修改，调用前想清楚。
 */
export async function setMenu(
  projectPath: string,
  menu: unknown,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };

  // 本地先拦 https：官方会报 40030008，但那时用户已经白跑一次请求，
  // 而且报错里不会指出是哪一条 link 有问题。
  const badLink = findNonHttpsLink(menu);
  if (badLink) {
    return { ok: false, error: `菜单链接必须以 https:// 开头（收到：${badLink}）` };
  }

  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/menu`,
    { method: 'PUT', body: JSON.stringify({ menu }) },
    '修改自定义菜单',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 查询指令面板列表（官方 `GET /v2/panels`，**必须传 scope**，30 QPM） */
export async function listPanels(
  projectPath: string,
  scope: string,
  limit?: number,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  const validScope = ['c2c', 'group', 'channel', 'dm'];
  if (!validScope.includes(scope)) {
    return { ok: false, error: `scope 非法：${scope || '(空)'}（可选 ${validScope.join(' / ')}）` };
  }
  const qs = new URLSearchParams({ scope });
  if (limit && Number(limit) > 0) qs.set('limit', String(Math.min(50, Number(limit))));
  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/panels?${qs.toString()}`,
    { method: 'GET' },
    '查询指令面板列表',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 创建指令面板（官方 `POST /v2/panels`，10 QPM，一个机器人最多 20 个）。
 *
 * @param payload 原样透传给官方（scope / target_type / panel / user_openids / group_openids）
 */
export async function createPanel(
  projectPath: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };

  const scope = String(payload.scope || '');
  const targetType = String(payload.target_type || 'all');
  const validScope = ['c2c', 'group', 'channel', 'dm'];
  if (!validScope.includes(scope)) {
    return { ok: false, error: `scope 非法：${scope || '(空)'}（可选 ${validScope.join(' / ')}）` };
  }
  // channel / dm 只支持全局配置 —— 本地先拦，省一次必然失败的请求
  if (targetType === 'specific' && (scope === 'channel' || scope === 'dm')) {
    return {
      ok: false,
      error: `${scope} 场景只支持 target_type=all（指定对象仅在 c2c / group 可用）`,
    };
  }
  const badLink = findNonHttpsLink(payload.panel);
  if (badLink) {
    return { ok: false, error: `面板链接必须以 https:// 开头（收到：${badLink}）` };
  }

  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/panels`,
    { method: 'POST', body: JSON.stringify(payload) },
    '创建指令面板',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 查询指令面板详情（官方 `GET /v2/panels/{panel_id}`，30 QPM） */
export async function getPanel(
  projectPath: string,
  panelId: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  if (!panelId) return { ok: false, error: 'panel_id 不能为空' };
  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/panels/${panelId}`,
    { method: 'GET' },
    '查询指令面板详情',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 修改指令面板（官方 `PUT /v2/panels/{panel_id}`，10 QPM）。
 * 覆盖面板元素与备注，**不影响已关联的用户/群**。
 */
export async function updatePanel(
  projectPath: string,
  panelId: string,
  panel: unknown,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  if (!panelId) return { ok: false, error: 'panel_id 不能为空' };
  const badLink = findNonHttpsLink(panel);
  if (badLink) {
    return { ok: false, error: `面板链接必须以 https:// 开头（收到：${badLink}）` };
  }
  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/panels/${panelId}`,
    { method: 'PUT', body: JSON.stringify({ panel }) },
    '修改指令面板',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** 删除指令面板（官方 `DELETE /v2/panels/{panel_id}`，10 QPM） */
export async function deletePanel(
  projectPath: string,
  panelId: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  if (!panelId) return { ok: false, error: 'panel_id 不能为空' };
  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/panels/${panelId}`,
    { method: 'DELETE' },
    '删除指令面板',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 * 修改指令面板关联对象（官方 `PUT /v2/panels/{panel_id}/target`，60 QPM）。
 * 仅 specific 面板可用；单次最多 20 个 openid。
 */
export async function setPanelTarget(
  projectPath: string,
  panelId: string,
  target: { userOpenids?: string[]; groupOpenids?: string[] },
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession(projectPath);
  if (!session) return { ok: false, error: 'session不存在或未连接' };
  if (!panelId) return { ok: false, error: 'panel_id 不能为空' };
  const users = (target.userOpenids ?? []).filter(Boolean);
  const groups = (target.groupOpenids ?? []).filter(Boolean);
  if (!users.length && !groups.length) {
    return { ok: false, error: '需要至少提供 user_openids 或 group_openids 之一' };
  }
  if (users.length > 20 || groups.length > 20) {
    return { ok: false, error: '单次最多关联 20 个 openid' };
  }
  const body: Record<string, unknown> = {};
  if (users.length) body.user_openids = users;
  if (groups.length) body.group_openids = groups;

  const r = await callConfigApi(
    projectPath,
    `${apiBase(session.sandbox)}/v2/panels/${panelId}/target`,
    { method: 'PUT', body: JSON.stringify(body) },
    '修改指令面板关联对象',
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

// ── Token 管理 ──

function scheduleTokenRefresh(session: OfficialSession): void {
  if (session.tokenRefreshTimer) clearTimeout(session.tokenRefreshTimer);
  const refreshIn = session.tokenExpiresAt - Date.now() - TOKEN_REFRESH_SCHEDULE_LEAD_MS;
  if (refreshIn <= 0) {
    refreshToken(session);
    return;
  }
  session.tokenRefreshTimer = setTimeout(() => refreshToken(session), refreshIn);
}

async function refreshToken(session: OfficialSession): Promise<void> {
  try {
    const { token, expiresIn } = await fetchAccessToken(session.appId, session.appSecret);
    session.accessToken = token;
    session.tokenExpiresAt = Date.now() + expiresIn * 1000;
    scheduleTokenRefresh(session);
  } catch (err) {
    // Token 刷新失败需记录错误，便于排查凭证或网络问题
    emitSystemLog(
      session.projectPath,
      'Token 刷新失败: ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
    // 安排一次延迟重试，避免一次失败后 token 永不刷新；重试前确认 session 仍然存活
    session.tokenRefreshTimer = setTimeout(() => {
      if (session.alive) refreshToken(session).catch(() => {});
    }, TOKEN_REFRESH_RETRY_DELAY_MS);
  }
}

async function ensureToken(session: OfficialSession): Promise<string> {
  if (!session.accessToken || session.tokenExpiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
    const { token, expiresIn } = await fetchAccessToken(session.appId, session.appSecret);
    session.accessToken = token;
    session.tokenExpiresAt = Date.now() + expiresIn * 1000;
    scheduleTokenRefresh(session);
  }
  return session.accessToken;
}

// ── 心跳 ──

function stopHeartbeat(session: OfficialSession): void {
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = null;
  }
  if (session.heartbeatTimeout) {
    clearTimeout(session.heartbeatTimeout);
    session.heartbeatTimeout = null;
  }
}

function startHeartbeat(session: OfficialSession, interval: number): void {
  stopHeartbeat(session);
  session.heartbeatInterval = interval;
  const sendBeat = () => {
    if (session.heartbeatTimeout) {
      clearTimeout(session.heartbeatTimeout);
      session.heartbeatTimeout = null;
    }
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ op: 1, d: session.seq }));
    }
    session.heartbeatTimeout = setTimeout(() => {
      if (
        session.lastMessageAt &&
        Date.now() - session.lastMessageAt > HEARTBEAT_TIMEOUT_THRESHOLD_MS
      )
        scheduleReconnect(session);
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  };
  sendBeat();
  session.heartbeatTimer = setInterval(sendBeat, interval);
}

// ── 事件解析 ──

/**
 * 解析官方 `message_scene.ext`。
 *
 * 官方给的是 `["msg_idx=REFIDX_x", "auth_token=…", "ref_msg_idx=…"]` 这种 `k=v` 列表；
 * 历史实现里也可能塞 JSON 字符串，所以两种都认 —— 认不出的条目直接跳过，不抛。
 */
export function parseMessageSceneExt(ext: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(ext)) return out;
  for (const item of ext) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s) continue;
    if (s.startsWith('{')) {
      try {
        const obj = JSON.parse(s) as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
          if (v !== null && v !== undefined) out[k] = String(v);
        }
      } catch {
        // 不是合法 JSON：当作普通字符串，下面按 k=v 再试一次
        const idx = s.indexOf('=');
        if (idx > 0) out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
      }
      continue;
    }
    const idx = s.indexOf('=');
    if (idx <= 0) continue;
    out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
  }
  return out;
}

/** 官方偶尔把对象字段塞成 JSON 字符串，两种形态都认；认不出返回 null */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 不是合法 JSON，交给调用方走兜底
    }
  }
  return null;
}

/** 同上，数组版：数组或 JSON 字符串都认 */
function asArray(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 不是合法 JSON
    }
  }
  return null;
}

/**
 * 官方事件 → 内部事件。
 *
 * 这里解析出的 `attachments` / `arkData` / `msgElements` / `messageScene` 是**接收侧**能力的
 * 基础：翻译器构造 OneBot 事件时会读它们。不解析的话，用户发来的图片、结构化卡片、
 * 引用内容在流程里完全看不到（历史上就是如此 —— attachments 解析了但挂在没人消费的 `parsed` 上）。
 */
export function parseOfficialEvent(t: string, d: Record<string, unknown>): OfficialEvent {
  const event: OfficialEvent = {
    type: t,
    id: (d.id as string) || '',
    content: (d.content as string) || '',
    timestamp: (d.timestamp as string) || '',
    author: {},
  };
  if (d.author && typeof d.author === 'object') {
    const a = d.author as Record<string, unknown>;
    event.author.userOpenid = a.user_openid as string;
    event.author.memberOpenid = a.member_openid as string;
    event.author.memberRole = a.member_role as string;
    event.author.bot = a.bot as boolean;
  }
  if (d.group_openid) event.groupOpenid = d.group_openid as string;
  const rawAttachments = asArray(d.attachments);
  if (rawAttachments) {
    event.attachments = rawAttachments
      .map((a) => asRecord(a))
      .filter((a): a is Record<string, unknown> => a !== null)
      .map((a) => ({
        contentType: (a.content_type as string) || '',
        filename: (a.filename as string) || '',
        url: (a.url as string) || '',
        width: a.width as number,
        height: a.height as number,
        size: a.size as number,
      }));
  }
  // 结构化卡片（官方只支持收，不支持发）
  const ark = asRecord(d.ark_data);
  if (ark) {
    const fields = asRecord(ark.fields);
    event.arkData = {
      arkType: (ark.ark_type as string) || '',
      arkName: (ark.ark_name as string) || '',
      prompt: (ark.prompt as string) || '',
      fields: fields ?? {},
    };
  }
  // 嵌套消息元素（引用消息 103 / 聊天记录 102 等），原样保留
  const elements = asArray(d.msg_elements);
  if (elements) event.msgElements = elements;
  // 消息场景上下文：`msg_idx` 就是引用回复要用的 REFIDX
  const scene = asRecord(d.message_scene);
  if (scene) {
    const ext = asArray(scene.ext) ?? [];
    const kv = parseMessageSceneExt(ext);
    event.messageScene = {
      source: (scene.source as string) || '',
      ext: ext.filter((x): x is string => typeof x === 'string'),
      refIdx: kv.msg_idx || '',
    };
  }
  return event;
}

// ── WebSocket 连接 ──

function connectWs(session: OfficialSession, url: string, isResume: boolean): void {
  if (session.ws) {
    try {
      session.ws.close();
    } catch (err) {
      emitSystemLog(
        session.projectPath,
        '关闭旧 WebSocket 异常: ' + (err instanceof Error ? err.message : String(err)),
        'warn',
      );
    }
  }

  const ws = new WebSocket(url);
  session.ws = ws;

  ws.onopen = () => {
    session.status = 'connected';
    session.reconnecting = false;
    emitStatus(session);
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      session.lastMessageAt = Date.now();
      const payload = JSON.parse(event.data as string);
      const { op, d, s, t } = payload;
      if (s != null) session.seq = s;

      switch (op) {
        case 10: {
          emitter.emit('official:message', session.projectPath, {
            type: 'hello',
            data: { heartbeat_interval: d.heartbeat_interval },
          });
          const hb =
            d.heartbeat_interval && d.heartbeat_interval > 0
              ? d.heartbeat_interval
              : DEFAULT_HEARTBEAT_INTERVAL_MS;
          startHeartbeat(session, hb);
          if (isResume && session.sessionId && session.seq) {
            ws.send(
              JSON.stringify({
                op: 6,
                d: {
                  token: `QQBot ${session.accessToken}`,
                  session_id: session.sessionId,
                  seq: session.seq,
                },
              }),
            );
          } else {
            ws.send(
              JSON.stringify({
                op: 2,
                d: {
                  token: `QQBot ${session.accessToken}`,
                  intents: session.intents,
                  shard: [0, 1],
                  properties: { $os: 'windows', $browser: 'qqbat', $device: 'qqbat' },
                },
              }),
            );
          }
          break;
        }
        case 0:
          if (t === 'READY') {
            session.sessionId = d.session_id;
            session.alive = true;
            session.retryCount = 0;
            emitter.emit('official:message', session.projectPath, { type: 'READY', data: d });
          } else if (t === 'RESUMED') {
            session.alive = true;
            session.retryCount = 0;
            emitter.emit('official:message', session.projectPath, { type: 'resumed', data: d });
          } else {
            emitter.emit('official:message', session.projectPath, {
              type: t,
              data: d,
              parsed: parseOfficialEvent(t, d),
            });
          }
          break;
        case 11:
          session.lastHeartbeatAck = Date.now();
          session.alive = true;
          emitter.emit('official:message', session.projectPath, {
            type: 'heartbeat_ack',
            data: {},
          });
          break;
        case 7:
          emitter.emit('official:message', session.projectPath, { type: 'reconnect', data: d });
          ws.close();
          break;
        case 9:
          session.sessionId = null;
          session.seq = null;
          ws.close();
          break;
      }
    } catch (err) {
      emitSystemLog(
        session.projectPath,
        '官方消息解析异常: ' + (err instanceof Error ? err.message : String(err)),
        'error',
      );
    }
  };

  ws.onclose = (event: CloseEvent) => {
    stopHeartbeat(session);
    session.ws = null;
    emitter.emit('official:message', session.projectPath, {
      type: 'ws:close',
      data: { code: event.code, reason: event.reason },
    });

    // 鉴权类关闭码是「配置错误」，重连再多次也不会成功，只会把真正的错误淹没在
    // 重试日志里。这里直接给出可操作提示并终止，不进入重连循环。
    const fatal = FATAL_CLOSE_CODES[event.code];
    if (fatal) {
      session.alive = false;
      session.status = 'error';
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      emitSystemLog(
        session.projectPath,
        `官方适配器连接被拒绝（close ${event.code}）：${fatal}。` +
          (event.code === 4014
            ? ` 当前 intents = ${describeIntents(session.intents)}。` +
              ' 请到 QQ 开放平台确认这些 Intents 是否已获授权，或在项目配置里改用已授权的组合。'
            : ''),
        'error',
      );
      emitStatus(session);
      return;
    }

    if (
      (session.status === 'connected' || session.status === 'connecting') &&
      !session.reconnecting
    ) {
      session.status = 'disconnected';
      emitStatus(session);
      scheduleReconnect(session);
    }
  };
  // WebSocket 错误后通常会触发 onclose，但为防御性编程（部分场景下 onclose 丢失），
  // 在 onerror 中也调度一次重连（scheduleReconnect 内部有去重逻辑，不会重复调度）
  ws.onerror = () => {
    session.status = 'error';
    emitStatus(session);
    if (!session.reconnecting && session.alive) {
      scheduleReconnect(session);
    }
  };
}

// ── 重连 ──

/**
 * 调度延迟重连：统一管理 reconnectTimer，避免重复调度与递归调用
 * 调用方一律通过本函数触发重连，doReconnect 失败后也通过本函数调度下一轮
 * @param delay 调度延迟（毫秒），默认 0 表示立即触发下一轮 doReconnect（doReconnect 内部会再 sleep 退避时间）
 */
function scheduleReconnect(session: OfficialSession, delay: number = 0): void {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
  }
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    void doReconnect(session);
  }, delay);
}

/**
 * 实际重连逻辑：retryCount++ → 上限检查 → sleep(指数退避) → connectWs
 * 失败时通过 scheduleReconnect(session, 0) 调度下一轮，消除原有递归调用，
 * 避免维护者误改 `reconnecting = false; void reconnectWs()` 顺序导致重连卡死
 */
async function doReconnect(session: OfficialSession): Promise<void> {
  if (session.reconnecting) return;
  if (!session.alive) return;
  session.reconnecting = true;
  stopHeartbeat(session);
  if (session.ws) {
    try {
      session.ws.close();
    } catch (err) {
      emitSystemLog(
        session.projectPath,
        '重连时关闭 WebSocket 异常: ' + (err instanceof Error ? err.message : String(err)),
        'warn',
      );
    }
    session.ws = null;
  }
  session.retryCount++;
  if (session.retryCount > session.maxRetries) {
    session.alive = false;
    session.status = 'error';
    emitStatus(session);
    session.reconnecting = false;
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, session.retryCount), RECONNECT_MAX_DELAY_MS);
  await new Promise((r) => setTimeout(r, delay));
  // 等待延迟期间 session 可能已被 stopOfficial 废弃，需在此处感知并中止重连
  if (!session.alive) {
    session.reconnecting = false;
    return;
  }
  try {
    const token = await ensureToken(session);
    const url = session.customWsUrl || (await getGatewayUrl(token, session.sandbox));
    connectWs(session, url, true);
  } catch (err) {
    // 重连失败需记录错误，便于排查后再触发重连
    // 通过 scheduleReconnect 调度下一轮（其内部 doReconnect 会再次 sleep 退避时间），
    // 消除递归调用，避免顺序依赖性强导致维护者误改后重连卡死
    emitSystemLog(
      session.projectPath,
      '官方重连异常: ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
    session.reconnecting = false;
    scheduleReconnect(session, 0);
    return;
  }
  session.reconnecting = false;
}

// ── 生命周期 ──

export async function startOfficial(projectPath: string): Promise<void> {
  for (const [, s] of sessions) {
    if (s.projectPath === projectPath && s.alive) throw new Error('官方 API 已在运行中');
  }
  const config = await loadOfficialConfig(projectPath);
  if (!config) throw new Error('未配置 AppID 和 AppSecret');

  const sessionKey = `${projectPath}-${Date.now()}`;
  const session: OfficialSession = {
    projectPath,
    status: 'connecting',
    appId: config.appId,
    appSecret: config.appSecret,
    sandbox: config.sandbox ?? false,
    customWsUrl: config.wsUrl || '',
    ws: null,
    heartbeatTimer: null,
    heartbeatTimeout: null,
    heartbeatInterval: 0,
    lastHeartbeatAck: null,
    lastMessageAt: 0,
    seq: null,
    sessionId: null,
    accessToken: '',
    tokenExpiresAt: 0,
    tokenRefreshTimer: null,
    retryCount: 0,
    maxRetries: 5,
    intents: resolveIntents(config.intents),
    reconnecting: false,
    reconnectTimer: null,
    alive: false,
  };
  sessions.set(sessionKey, session);
  // 同步更新反向索引，保证 getSession 可 O(1) 命中
  projectPathIndex.set(projectPath, sessionKey);
  emitSystemLog(projectPath, `官方适配器 intents: ${describeIntents(session.intents)}`, 'info');
  emitStatus(session);
  try {
    const token = await ensureToken(session);
    const url = session.customWsUrl || (await getGatewayUrl(token, session.sandbox));
    connectWs(session, url, false);
  } catch (e) {
    // 启动失败需清理残留 session 与反向索引，避免后续误用半初始化的 session
    session.status = 'error';
    emitStatus(session);
    sessions.delete(sessionKey);
    projectPathIndex.delete(projectPath);
    throw e;
  }
}

export function stopOfficial(projectPath: string): void {
  for (const [sessionKey, session] of sessions) {
    if (session.projectPath !== projectPath) continue;
    stopHeartbeat(session);
    if (session.tokenRefreshTimer) clearTimeout(session.tokenRefreshTimer);
    // 清理重连定时器：避免 stopOfficial 后 doReconnect 仍被调度，引用已废弃的 session 造成内存泄漏
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    if (session.ws) {
      try {
        session.ws.close();
      } catch (err) {
        emitSystemLog(
          session.projectPath,
          '停止时关闭 WebSocket 异常: ' + (err instanceof Error ? err.message : String(err)),
          'warn',
        );
      }
    }
    session.ws = null;
    session.alive = false;
    session.status = 'disconnected';
    emitStatus(session);
    // 同步清除反向索引与 sessions 表项，避免残留指向已停止 session 的索引
    projectPathIndex.delete(session.projectPath);
    sessions.delete(sessionKey);
  }
}

export function getOfficialStatus(projectPath: string): {
  status: OfficialStatus;
  appId: string;
  alive: boolean;
} {
  // 通过反向索引 O(1) 查找，避免对 sessions 全表线性扫描
  const session = getSession(projectPath);
  if (!session) return { status: 'disconnected', appId: '', alive: false };
  return { status: session.status, appId: session.appId, alive: session.alive };
}