// src/shared/types/proposal.ts
import type { FlowIssue } from '@shared/nodes/flowNormalize';
import type { CommandDataMode } from '@shared/nodes/commandChain';
import type { Verdict } from '@shared/types/agent';

export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * 操作本体（按 kind 判别的联合）。
 *
 * 对外导出的是它 **& { lane?: string }** —— lane 由并行子代理合并时打上，
 * 用于提案卡按 lane 分组/筛选。放在一处交叉，避免给 12 个成员各加一遍。
 */
type ProposalOperationCore =
  | {
      kind: 'add_node';
      /**
       * **备注**（画布上显示在节点名**下方**那一行）。
       *
       * 2026-10-15 用户提的：「不要老让 AI 改节点信息，让他在备注那边写就好了」——
       * 在此之前这个操作**没有备注字段**，AI 唯一能写字的地方就是 label，于是它把
       * 「指令/意图」全塞进标题（真机截图：收到消息节点的标题写成 `/菜单`）。
       */
      description?: string;
      tempRef: string;
      nodeKind: string;
      label?: string;
      config?: Record<string, unknown>;
    }
  | {
      kind: 'connect';
      sourceRef: string;
      sourcePortId: string;
      targetRef: string;
      targetPortId: string;
    }
  | {
      kind: 'update_config';
      nodeRef: string;
      /** config 可选：只想写备注/改名时不必塞个空对象（浅合并，见 pendingGraph） */
      config?: Record<string, unknown>;
      /** 改名：**保持类型名**，意图写 description */
      label?: string;
      /** 备注：画布显示在节点名下方（AI 的意图写这里） */
      description?: string;
    }
  /**
   * 套用**预置玩法片段**（片段库那 21 条）。
   *
   * 为什么要有它（2026-10-06）：在这之前助手只能「读」片段（list_templates），
   * 想落地得自己 add_node + connect 十几个 —— 实测它把 10 轮上限全花在探索上、
   * 一次提案都没提出（真机："智能体他不会干活"）。一条片段 = 一串已连好的节点。
   */
  | { kind: 'apply_template'; templateId: string }
  /**
   * 新建一条"**查表 → 回复**"指令（= 界面上「新建查询」向导那条路）。
   *
   * 为什么必须有它：查表的配置绑定是**伪源边**（`source: '__config_api__'`），
   * 现有工具（add_node / connect_nodes）**造不出来** —— 没有这条工具，助手就永远做不出
   * "按配置表回不同内容"这类指令（而那正是 100 条技能该有的形态）。
   */
  | {
      kind: 'new_lookup';
      command: string;
      table: string;
      dbPath: string;
      /** 查表：要回的字段 */
      field: string;
      /** 可选：WHERE 条件字段（做等值匹配） */
      matchField?: string;
      /** 回复文案（可含 {值} 占位） */
      reply: string;
    }
  | {
      kind: 'delete_node';
      nodeRef: string;
    }
  | {
      kind: 'write_code';
      filePath: string;
      content: string;
      riskLevel: RiskLevel;
    }
  | { kind: 'generate_code' }
  | {
      kind: 'capability';
      capabilityId: string;
      capabilityArgs: Record<string, unknown>;
      riskLevel: RiskLevel;
      /** 高危能力的影响面估算（只有登记过估算器的能力才有） */
      impact?: ImpactEstimate;
    }
  | {
      kind: 'new_command';
      command: string;
      reply: string;
      dataMode: CommandDataMode;
      dataKey?: string;
    };

/**
 * 高危能力的**影响面**估算（"会删掉多少行/发给谁"）。
 *
 * 为什么放在提案里：这些能力的破坏面**算得出来**，而用户在点确认之前就该看到
 * 数字，而不是等执行完才发现清空了 300 个键。算不出来（没有登记估算器）时
 * 调用方必须拒绝提案 —— 见 `capabilityImpact.estimateImpact`。
 */
export interface ImpactEstimate {
  /** none = 实际影响为零；single = 单条；bulk = 成批 */
  level: 'none' | 'single' | 'bulk';
  /** 给人看的一句话（可含 Markdown） */
  summary: string;
  /** 结构化数字，便于界面呈现与测试断言 */
  counts?: Record<string, number>;
}

/** 一次提案里的单个操作（lane 只在"并行子代理合并出来的操作"上存在） */
export type ProposalOperation = ProposalOperationCore & {
  /** 产出这条操作的子代理 lane（L1/L2…）；父代理自己产出的没有这个字段 */
  lane?: string;
};

export interface Proposal {
  id: string;
  summary: string;
  operations: ProposalOperation[];
  riskLevel: RiskLevel;
  createdAt: number;
  /**
   * 并行子代理的回报（Phase 4，纯展示）。
   *
   * 只在多智能体真的跑了 lane 时出现：父代理看得到"子代理 A 加了 3 个节点、
   * 子代理 B 写了 1 个文件"，用户也该看得到 —— 否则提案卡上只是凭空多出几项操作。
   */
  lanes?: string;
  /**
   * 本次运行摘要（轮次 / 工具数 / 耗时 / tokens），Phase 4 的可见性补充。
   * 与 lanes 一起收进提案卡的折叠区 —— **零新 IPC**：数据在主进程已算好。
   */
  runSummary?: string;
  /**
   * 结构校验结果 —— **这次改动引入了哪些问题**。
   *
   * ## 为什么提案必须带这个（2026-09-30）
   *
   * 在此之前，`validate_flow` 只是模型**可以选择调用**的工具：
   * **模型不调，就没有任何人校验它刚改的图** —— 用户看到的是"3 个操作 / 风险：中"，
   * 点确认，图坏了。而看懂"端口断了没"这件事**本来不需要人**（用户是机器人作者，不是程序员）。
   */
  validation?: ProposalValidation;
  /** 复核结论（llm 复核 / 静态检查；没有复核时不带这个键） */
  verdict?: Verdict;
}

/** 结构校验结果：这批操作**新引入**了哪些问题（改之前就有的不算） */
export interface ProposalValidation {
  introduced: FlowIssue[];
  /** 改之前就存在的结构问题数（说明为什么只关心 introduced） */
  preexisting: number;
  /** 校验时刻（ISO） */
  checkedAt: string;
}

export function hasBlockingIssue(v: ProposalValidation | undefined): boolean {
  return !!v && v.introduced.some((i) => i.severity === 'error');
}

const RISK_PRIORITY: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/**
 * 这份提案的**整体风险** = 各操作里最高的那档。
 *
 * 判据（与 10/18 产物逐句对齐）：写代码按脚本内容给的风险等级取最大；
 * 删节点/生成代码至少 medium（改错了代价高）；调用前端能力按它自己的 riskLevel。
 */
export function assessProposalRisk(operations: readonly ProposalOperation[]): RiskLevel {
  let max: RiskLevel = 'low';
  for (const op of operations) {
    if (op.kind === 'write_code') {
      if (RISK_PRIORITY[op.riskLevel] > RISK_PRIORITY[max]) max = op.riskLevel;
    }
    if (op.kind === 'delete_node') {
      if (RISK_PRIORITY['medium'] > RISK_PRIORITY[max]) max = 'medium';
    }
    if (op.kind === 'generate_code') {
      if (RISK_PRIORITY['medium'] > RISK_PRIORITY[max]) max = 'medium';
    }
    if (op.kind === 'capability') {
      if (RISK_PRIORITY[op.riskLevel] > RISK_PRIORITY[max]) max = op.riskLevel;
    }
  }
  return max;
}

export function createProposal(
  summary: string,
  operations: ProposalOperation[],
  validation?: ProposalValidation,
  verdict?: Verdict,
  lanes?: string,
  runSummary?: string,
): Proposal {
  return {
    id: crypto.randomUUID(),
    summary,
    operations,
    riskLevel: assessProposalRisk(operations),
    createdAt: Date.now(),
    ...(lanes ? { lanes } : {}),
    ...(runSummary ? { runSummary } : {}),
    // 显式只在有值时挂上这个键：`validation: undefined` 与"没有这个键"在
    // 序列化后是不同的形状，前者会让 `'validation' in proposal` 为真（界面判断会走错分支）。
    ...(validation ? { validation } : {}),
    ...(verdict ? { verdict } : {}),
  };
}
