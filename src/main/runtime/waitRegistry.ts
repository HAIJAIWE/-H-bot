// src/main/runtime/waitRegistry.ts
//
// D2 · 跨事件等待的**挂起表**（`wait_input` 真实现的地基）。
//
// ## 为什么需要它
//
// 原来的 `wait_input` 直接返回 `{ input: '', timeout: false }` —— 没等就继续，下游拿到空输入。
// 而"等下一步"是**游戏级玩法的门槛**：挂机修炼到点结算、卡牌对战等对手出手、多步对话、
// 组队匹配，全都要跨事件。
//
// ## 机制（不阻塞线程）
//
// 1. 解释器遇到等待节点 → 把**恢复现场**（链标识 + 下一个节点 id + 变量快照 + 等待条件 +
//    截止时间）登记进本表，然后结束本次事件处理；
// 2. 下一条消息到达时 → `matchWait()` 用指纹匹配（谁 / 哪个会话）取出该条挂起记录 →
//    解释器从 `resumeNodeId` 继续执行同一条链（变量从快照恢复）；
// 3. 超时 → `takeExpired()` 取出 → 解释器走"超时"分支。
//    ⚠️ 取出方有**两个**（都要保留，别只留一个）：
//      a. `FlowRuntime.tickSchedules` 的**1 秒心跳** —— 保证"没人说话时超时也按时触发"；
//      b. 事件到达时的 `settleWaitsAndResume` —— 顺手先结算一遍。
//    这条曾经是坏的：只有 (b)，于是**安静群/单聊里超时永不触发**。
//
// ## 已知边界（第一版就接受，不假装可靠）
//
// - **进程重启丢挂起表**：内存表，重启后等待中的链不会恢复（用户会看到"超时"或再无响应）。
//   要持久化需把变量快照落盘，属后续工作。
// - 单进程内有效：多实例部署时各实例只认自己的挂起记录。
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../services/infra/logger';

/** 等待谁 */
export type WaitScope = 'trigger_user' | 'any_in_group' | 'specific_user';

/** 登记一条等待所需的恢复现场 */
export interface WaitSpec {
  projectPath: string;
  scope: WaitScope;
  /** specific_user 时的目标 QQ；trigger_user 时也填（触发者） */
  userId?: string;
  /** 会话类型与 id（避免跨群/跨私聊误匹配） */
  chatType?: 'group' | 'private';
  chatId?: string;
  /** 链标识（同一链同时只允许一条挂起记录） */
  chainId: string;
  /** 等待节点自身的 id（恢复时用它把 reply/user_id/timed_out/is_valid 写回输出端口） */
  waitNodeId?: string;
  /** 收到回复时从哪个节点继续（等待节点 received 出口的下一个节点） */
  resumeNodeId: string;
  /** 超时时从哪个节点继续（等待节点 timeout 出口的下一个节点）；缺省则不恢复、仅记日志 */
  timeoutNodeId?: string;
  /** 变量快照（恢复时还原上下文） */
  variables: Record<string, unknown>;
  /** 最长等待毫秒数 */
  timeoutMs: number;
  /** 恢复成功后要写入的变量名（供下游用 {input}/{user_id}） */
  inputVarName?: string;
  /** 期望格式（正则）：回复不匹配时按 invalidMessage 提示并重试 */
  expectedPattern?: string;
  /** 格式不匹配时发给用户的提示 */
  invalidMessage?: string;
  /** 格式不匹配的最大重试次数（0 = 不重试，直接按原出口继续） */
  maxRetries?: number;
  /** 已重试次数（内部维护） */
  retries?: number;
}

export interface PendingWait extends WaitSpec {
  id: string;
  createdAt: number;
  deadline: number;
}

/** 收到的消息指纹（由解释器从事件里提取） */
export interface IncomingFingerprint {
  projectPath: string;
  userId?: string;
  chatType?: 'group' | 'private';
  chatId?: string;
}

/**
 * 从运行时事件里提取匹配指纹（解释器在 dispatchEvent 入口调用）。
 *
 * 字段名按运行时事件约定，全部做容错（缺字段不抛错）：
 * user_id（私聊/群聊发送者；通知事件用 operator_id 回退）、message_type / group_id。
 */
export function fingerprintFromEvent(projectPath: string, event: unknown): IncomingFingerprint {
  const e = (event ?? {}) as Record<string, unknown>;
  const rawType = String(e.message_type ?? '');
  const chatType: 'group' | 'private' | undefined =
    rawType === 'group' ? 'group' : rawType === 'private' ? 'private' : undefined;
  const chatIdRaw = chatType === 'group' ? e.group_id : e.user_id;
  const userIdRaw = e.operator_id ?? e.user_id;
  return {
    projectPath,
    userId: userIdRaw === undefined || userIdRaw === null ? undefined : String(userIdRaw),
    chatType,
    chatId: chatIdRaw === undefined || chatIdRaw === null ? undefined : String(chatIdRaw),
  };
}

/**
 * 从事件里取出用户回复的文本（解释器恢复等待时写入 `reply` 输出端口）。
 *
 * 运行时事件的 `raw_message` 是字符串；适配层也可能给数组式 `message` 段，
 * 这里统一拍平成文本，取不到就返回空串（由调用方决定怎么处理）。
 */
export function messageTextFromEvent(event: unknown): string {
  const e = (event ?? {}) as Record<string, unknown>;
  const raw = e.raw_message ?? e.message ?? e.message_text ?? '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((seg) =>
        typeof seg === 'string'
          ? seg
          : String((seg as { data?: { text?: unknown } })?.data?.text ?? ''),
      )
      .join('');
  }
  return '';
}

/** 超时上限/下限：避免 0 秒立刻超时或无限等待 */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1_000;

const waits = new Map<string, PendingWait>();

/**
 * **挂起表的落盘**（P2-2，2026-10-18）。
 *
 * 之前这里写的是"进程重启丢挂起表，属后续工作"。但它不是"后续"：崩一次、
 * 或用户重启应用，等待中的链就**静默消失** —— 下游既收不到超时分支，也再不会被唤醒。
 *
 * 落盘范围：每个项目一份 .qqbat/runtime/pending-waits.json（含变量快照）。
 * 正常停止（botManager）仍会 clearWaits → 顺带删文件：那是**用户主动停**，
 * 不该在下次启动时复活。只有"没走停止流程就没了"（崩溃/强退）才靠这份文件恢复。
 */
export function waitsFilePath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'runtime', 'pending-waits.json');
}

/**
 * 把某项目的挂起记录落盘（**同步**，失败只告警）。
 *
 * 为什么是同步：这是低频小写入（一次登记/唤醒一条），但如果是 fire-and-forget，
 * 删除项目/清临时目录时会与写盘赛跑 —— 目录已经删完、文件才落地，rmdir 报
 * ENOTEMPTY（真机上表现为"删不干净"，测试里表现为随机红）。同步写把这条路堵死。
 */
export function saveWaitsFor(projectPath: string): void {
  try {
    const own = [...waits.values()].filter((w) => w.projectPath === projectPath);
    const file = waitsFilePath(projectPath);
    /**
     * 项目目录已经不在（被删 / 临时目录已清理）⇒ **不要 mkdir 重建**。
     * 这条不只是为了测试：给一个已删除的项目重建 .qqbat 目录毫无意义，
     * 而"删除后又被异步写创回来"正是 ENOTEMPTY 的来源。
     */
    if (!existsSync(join(projectPath, '.qqbat'))) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(own, null, 2) + '\n', 'utf-8');
  } catch (e) {
    logger.warn('[wait] 挂起表落盘失败（不影响本次等待）:', e);
  }
}

/**
 * 启动时把盘上的挂起记录读回内存。
 *
 * **过期的也照收**：由 1 秒心跳 / 事件结算把它走"超时"分支 ——
 * 直接丢弃等于用户永远等不到那句超时提示。
 */
export async function restoreWaitsFor(projectPath: string): Promise<number> {
  try {
    const raw = await readFile(waitsFilePath(projectPath), 'utf-8');
    const list = JSON.parse(raw) as PendingWait[];
    let restored = 0;
    for (const w of list) {
      if (!w || typeof w.id !== 'string' || w.projectPath !== projectPath) continue;
      if (typeof w.chainId !== 'string' || typeof w.resumeNodeId !== 'string') continue;
      if (typeof w.deadline !== 'number' || typeof w.createdAt !== 'number') continue;
      if (waits.has(w.id)) continue;
      waits.set(w.id, w);
      restored += 1;
    }
    if (restored > 0) logger.info(`[wait] 已从磁盘恢复 ${restored} 条挂起等待（${projectPath}）`);
    return restored;
  } catch {
    return 0; // 文件不存在/坏了：当没有挂起记录
  }
}

function clampTimeout(ms: number): number {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  return Math.min(Math.max(n, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/** 登记一条等待（同一链重复登记时覆盖旧记录，避免残留） */
export function registerWait(spec: WaitSpec, now: number = Date.now()): PendingWait {
  for (const [id, w] of waits) {
    if (w.projectPath === spec.projectPath && w.chainId === spec.chainId) waits.delete(id);
  }
  const timeoutMs = clampTimeout(spec.timeoutMs);
  const pending: PendingWait = {
    ...spec,
    timeoutMs,
    id: randomUUID(),
    createdAt: now,
    deadline: now + timeoutMs,
  };
  waits.set(pending.id, pending);
  saveWaitsFor(pending.projectPath);
  return pending;
}

/** 指纹是否匹配某条等待 */
function matches(w: PendingWait, fp: IncomingFingerprint): boolean {
  if (w.projectPath !== fp.projectPath) return false;
  // 会话必须一致（两者都知道时）：避免 A 群的等待被 B 群的消息唤醒
  if (w.chatId && fp.chatId && w.chatId !== fp.chatId) return false;
  if (w.chatType && fp.chatType && w.chatType !== fp.chatType) return false;
  if (w.scope === 'any_in_group') return true;
  // trigger_user / specific_user：必须是同一个用户
  if (!w.userId || !fp.userId) return false;
  return String(w.userId) === String(fp.userId);
}

/**
 * 取出并消费一条匹配的等待（先注册先匹配）。
 * 返回 null 表示没有在等这条消息 —— 调用方按普通事件继续处理。
 */
export function matchWait(fp: IncomingFingerprint, now: number = Date.now()): PendingWait | null {
  const candidates = [...waits.values()]
    .filter((w) => w.deadline > now) // 已过期的留给 takeExpired
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const w of candidates) {
    if (matches(w, fp)) {
      waits.delete(w.id);
      saveWaitsFor(w.projectPath);
      return w;
    }
  }
  return null;
}

/**
 * 取出并消费所有已过期的等待（解释器结算 → 走"超时"分支）。
 *
 * `projectPath` 用于只结算本项目的等待：挂起表是进程级的，别的项目的记录
 * 交给它自己的解释器结算，否则会被这里悄悄丢掉。
 */
export function takeExpired(now: number = Date.now(), projectPath?: string): PendingWait[] {
  const expired: PendingWait[] = [];
  for (const [id, w] of waits) {
    if (projectPath && w.projectPath !== projectPath) continue;
    if (w.deadline <= now) {
      expired.push(w);
      waits.delete(id);
    }
  }
  for (const project of new Set(expired.map((w) => w.projectPath))) {
    saveWaitsFor(project);
  }
  return expired.sort((a, b) => a.deadline - b.deadline);
}

/** 当前挂起的等待（不消费；用于「运行状态」面板与测试） */
export function listWaits(projectPath?: string): PendingWait[] {
  const all = [...waits.values()].sort((a, b) => a.createdAt - b.createdAt);
  return projectPath ? all.filter((w) => w.projectPath === projectPath) : all;
}

/** 清空某项目（或全部）的等待 —— 停止机器人 / 删除项目时调用 */
export function clearWaits(projectPath?: string): number {
  let removed = 0;
  for (const [id, w] of waits) {
    if (!projectPath || w.projectPath === projectPath) {
      waits.delete(id);
      removed++;
    }
  }
  // 正常停止 ⇒ 连盘上的记录一起删（用户主动停，不该在下次启动时复活）
  if (projectPath) {
    try {
      rmSync(waitsFilePath(projectPath), { force: true });
    } catch {
      // 删不掉也不能影响停止流程
    }
  }
  return removed;
}

/** 测试用：清空全部 */
export function _resetWaitsForTesting(): void {
  waits.clear();
}
