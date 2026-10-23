// src/main/services/ai/toolApproval.ts
//
// # 工具批准：让 `ask` 从「提示」变成「真拦」（M1d）
//
// ## 为什么要有它
//
// `toolGuard.classifyTool` 判定某些调用该问用户（不可撤回的那些：run_bot / run_test /
// invoke_capability …）。但"问"必须**真的停下来等**才算数 —— 在这之前 `ask` 只能发条警告
// 然后照常执行，等于没有闸门。
//
// ## 形状（照主流做法）
//
// · Claude Code：工具调用**阻塞**等用户决定；批准可以「以后别再问」（allow 规则）。
// · Cursor：被挡的命令可**经批准重试**。
// · 所以这里：发一条 `ai:approvalRequest` → **await** 一个 promise → 渲染层用 IPC 回决定。
//
// ## 三条纪律
//
// 1. **超时按拒绝**（fail-safe）：用户走开了不能变成"默认放行" —— 那闸门就白做了。
// 2. **取消必须连带解掉等待**：否则整轮对话会挂在一个永远不 resolve 的 promise 上
//    （真机上表现为"点了停止但一直转圈"）。
// 3. **同一 callId 只解一次**：界面可能重复点（双击/重发），重复解会让同一调用执行两遍。
import { logger } from '../infra/logger';

export type ApprovalDecision = 'allow' | 'deny' | 'always';

export interface ApprovalRequest {
  projectPath: string;
  /** 工具调用 id（渲染层回决定时带回来） */
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 给用户看的一句话（来自 VERDICT_HINT，避免两处措辞漂移） */
  hint: string;
}

interface Pending extends ApprovalRequest {
  resolve: (d: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

/** 待批准的调用：callId → 等待者 */
const PENDING = new Map<string, Pending>();

/** 默认等待时长：5 分钟。超时按**拒绝**处理（见纪律 1） */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 请求用户批准一次工具调用。**会一直等**，直到：
 * · 渲染层回 `allow` / `deny` / `always`；
 * · 超时（按 deny）；
 * · 调用方 `signal` 被 abort（按 deny）。
 */
export function requestApproval(
  req: ApprovalRequest,
  opts: {
    /** 发给渲染层的通道（测试可注入） */
    emit: (channel: string, payload: unknown) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<ApprovalDecision> {
  /**
   * 同一个 callId 又来了：把**旧的那条按拒绝收掉**，再登记新的。
   *
   * ⚠️ 2026-10-15 修正：这里原来是「直接拒绝新请求」。后果是——上一轮留下的**僵尸条目**
   * （比如那一轮被顶掉、没人回决定）会把**新一轮的同名调用**直接判死：
   * 真机上是偶发的「工具莫名失败」，测试里是 `chat-steps` 16ms 就红（单独跑却全绿）。
   * 现在的语义更符合本意：**新的请求总是能等**，旧的那条反正没人要了。
   */
  const stale = PENDING.get(req.callId);
  if (stale) {
    logger.warn('[approval] 同一个 callId 重复请求，旧的按拒绝收掉:', req.callId);
    stale.resolve('deny');
  }

  const timeoutMs = opts.timeoutMs ?? APPROVAL_TIMEOUT_MS;
  return new Promise<ApprovalDecision>((resolve) => {
    const settle = (d: ApprovalDecision, why: string): void => {
      const p = PENDING.get(req.callId);
      if (!p) return; // 纪律 3：只解一次
      PENDING.delete(req.callId);
      clearTimeout(p.timer);
      opts.signal?.removeEventListener('abort', onAbort);
      logger.info(`[approval] ${req.toolName} -> ${d}（${why}）`);
      opts.emit('ai:approvalResolved', {
        projectPath: req.projectPath,
        callId: req.callId,
        decision: d,
      });
      resolve(d);
    };

    // 纪律 2：取消要连带解掉等待
    const onAbort = (): void => settle('deny', '已取消');

    const timer = setTimeout(
      () => settle('deny', `超时 ${Math.round(timeoutMs / 1000)}s`),
      timeoutMs,
    );
    PENDING.set(req.callId, { ...req, resolve: (d) => settle(d, '用户决定'), timer });

    if (opts.signal?.aborted) {
      settle('deny', '已取消');
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    opts.emit('ai:approvalRequest', {
      projectPath: req.projectPath,
      callId: req.callId,
      toolName: req.toolName,
      args: req.args,
      hint: req.hint,
      timeoutMs,
    });
  });
}

/** 渲染层回决定。返回 false = 这个 callId 已经解过或不存在（界面据此提示） */
export function resolveApproval(callId: string, decision: ApprovalDecision): boolean {
  const p = PENDING.get(callId);
  if (!p) return false;
  p.resolve(decision);
  return true;
}

/** 取消某个项目的全部等待（整轮被顶掉 / 用户点停止 / 窗口关闭时调） */
export function cancelApprovalsFor(projectPath: string): number {
  let n = 0;
  for (const [callId, p] of [...PENDING]) {
    if (p.projectPath !== projectPath) continue;
    p.resolve('deny');
    n += 1;
    logger.info('[approval] 取消等待中的批准:', callId);
  }
  return n;
}

/** 测试用：清空 */
export function _resetApprovals(): void {
  for (const p of PENDING.values()) {
    clearTimeout(p.timer);
    p.resolve('deny');
  }
  PENDING.clear();
}
