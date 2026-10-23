// src/shared/agent/policy.ts
//
// **A/B 两条 agent 路径的唯一差异表**（W2，2026-10-18）。
//
// 为什么要有它：作者助手（面对开发者）与机器人（面对群友）的循环骨架是同一套，
// 差别只在几个旋钮 —— 轮数、守卫基线、审批形态、预算。以前这些数字散在
// chatRun / tokenBudget / agentNodes 三处，改一个要读三个文件，而且"两边行为不一致"
// 没法被用例钉住。现在旋钮集中在这里，循环实现（AgentRuntime）从中读。
//
// ⚠️ 改数值前先想清楚它属于哪一侧：A 侧宽松是为了效率，B 侧收紧是为了成本与安全。

/** 与 toolGuard 的 GuardMode 同源（那边 re-export 这里，避免两份字面量） */
export type AgentGuardMode = 'readonly' | 'acceptEdits' | 'auto';

/** 一次 agent 运行里会改变行为的旋钮 */
export interface AgentPolicyProfile {
  id: 'author' | 'bot';
  /** 最多几轮「模型 → 工具 → 模型」 */
  maxRounds: number;
  /** 工具闸基线 */
  guardMode: AgentGuardMode;
  /** 审批形态：A 阻塞等用户；B 两阶段（先问，下一条消息确认）；none = 不问 */
  approval: 'blocking' | 'twoPhase' | 'none';
  /** 会话上下文预算（估算 token） */
  conversationTokenBudget: number;
  /** 单条工具结果上限（码点） */
  toolResultBudgetChars: number;
  /** 厂商没回传 usage 时是否允许本地估算（B 侧不允许：额度必须是真的） */
  estimateUsageWhenMissing: boolean;
  /**
   * **单次运行允许的辅助调用次数**（侦察 / 规划 / 并行 lane 各算 1 次）。
   *
   * 多智能体的成本不是线性的：一次复杂需求最多多 3 次模型调用。
   * 没有硬顶，"一次对话"就可能变成"一次账单"。超预算按价值从低到高砍：
   * 先砍并行 lane（最贵、可退化）、再砍规划、最后连侦察也砍。
   */
  auxiliaryCallBudget: number;
}

/** 作者助手：面对开发者本人，可以多跑几轮、按「可撤回」自动执行 */
export const AUTHOR_PROFILE = {
  id: 'author',
  maxRounds: 18,
  guardMode: 'acceptEdits',
  approval: 'blocking',
  conversationTokenBudget: 80_000,
  toolResultBudgetChars: 8192,
  estimateUsageWhenMissing: true,
  // 侦察 + 规划 + 1 次并行 = 3；再多并行的收益递减、成本线性
  auxiliaryCallBudget: 3,
} as const satisfies AgentPolicyProfile;

/** 机器人：面对群友，轮数少、能力窄、只认真实用量 */
export const BOT_PROFILE = {
  id: 'bot',
  maxRounds: 3,
  guardMode: 'auto',
  approval: 'twoPhase',
  conversationTokenBudget: 2000,
  toolResultBudgetChars: 8192,
  estimateUsageWhenMissing: false,
  // 机器人侧不做多智能体：群聊里多一次调用就多一份钱，收益也不成立
  auxiliaryCallBudget: 0,
} as const satisfies AgentPolicyProfile;
