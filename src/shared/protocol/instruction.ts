// src/shared/protocol/instruction.ts
//
// 主进程 → 渲染层的**写指令回执协议**（P1-1）：派发 ≠ 成功，只有回了 applied 才算。
// 背景与它要治的三处假成功见 docs/ai/agent-architecture-review-2026-10-18.md（P1-1）。

/**
 * 主进程下发的一条写指令（= ai:clientInstruction 的 payload）。
 *
 * ⚠️ 形状**保持既有嵌套**（instruction.name / instruction.args）：
 * 渲染层 handleClientInstruction 与 preload 的类型都按这个读；改造只加了一个 requestId，
 * 不趁机改结构 —— 那会让"回执协议"和"payload 迁移"两件事缠在一起。
 */
export interface InstructionRequest {
  /** 一次派发一个 id；回执必须带回同一个 */
  requestId: string;
  /** 归属项目（多项目/多窗口时用于路由与超时清理） */
  projectPath: string;
  /** 指令本体（与渲染层 switch 对应） */
  instruction: { name: string; args: Record<string, unknown> };
}

/** 渲染层执行的结果 —— **不设"未知"状态**：必须给一个明确结局 */
export type InstructionOutcome =
  | { status: 'applied'; detail?: string }
  | { status: 'rejected'; reason: string }
  | { status: 'failed'; reason: string };

export interface InstructionResult {
  requestId: string;
  outcome: InstructionOutcome;
}

/** 窄化外部输入（IPC 参数不可信）：只认三个状态，别的一律 false */
export function isInstructionResult(value: unknown): value is InstructionResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as { requestId?: unknown; outcome?: unknown };
  if (typeof v.requestId !== 'string' || !v.requestId) return false;
  const outcome = v.outcome as { status?: unknown; reason?: unknown; detail?: unknown };
  if (!outcome || typeof outcome !== 'object') return false;
  if (outcome.status === 'applied') {
    return outcome.detail === undefined || typeof outcome.detail === 'string';
  }
  if (outcome.status === 'rejected' || outcome.status === 'failed') {
    return typeof outcome.reason === 'string';
  }
  return false;
}

/** 给模型/日志看的一句话（唯一措辞来源，避免三处各写一套） */
export function describeInstructionOutcome(outcome: InstructionOutcome): string {
  switch (outcome.status) {
    case 'applied':
      return outcome.detail ? "已执行：" + outcome.detail : "已执行";
    case 'rejected':
      return "被拒绝：" + outcome.reason + "（这一步**没有执行**，也没有产生任何改动）";
    case 'failed':
      return "执行失败：" + outcome.reason + "（改动**可能没有生效**，不要当成已完成）";
  }
}
