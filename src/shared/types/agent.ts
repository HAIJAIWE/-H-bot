// src/shared/types/agent.ts
//
// **多智能体之间的交接类型**（评审文档 §三·补）。
//
// 为什么必须是类型而不是"两个 agent 聊天"：
//   · 类型可以被闸门钉住（字段齐全、severity 合法）；
//   · 类型可以进 trace（谁在什么时候产出了什么）；
//   · 类型可以被 evals 断言（"坏计划必须被拦下"是可判定的）。
// 自然语言的"讨论"这三样都做不到。
//
// 2026-10-06 v1：只落地 `Verdict`（验证者），Brief/Plan 见文档，等 M5/M6。

/** 验证者发现的一条问题 */
export interface VerdictIssue {
  severity: 'error' | 'warn';
  /** 一句话说清"哪里不对" */
  what: string;
  /** 一句话说清"怎么改"（给用户看，也给模型回灌用） */
  howToFix: string;
  /** 相关节点/操作（有就带上，便于在画布上定位） */
  ref?: string;
}

/**
 * 侦察者简报（`Brief`）—— 多智能体的第二个交接产物（评审文档 §三·补 M6）。
 *
 * ## 它解决什么
 *
 * 大项目里模型最爱干的两件蠢事：**重复造已有的命令词**（机器人对同一条消息回两遍）与
 * **自造变量名**（项目里明明在用 `exp`，它写 `experience`）。这两件事的共同点是：
 * **答案早就在项目里，只是没人在开工前告诉它。**
 *
 * ## v1 是静态简报（不调模型）
 *
 * 这些字段全都能从流程里**算**出来（命令词、变量名、系统分组），比让模型"先侦察一轮"更快更准。
 * LLM 版的侦察者（并发读代码/文档、产出语义简报）等有真实需求再上。
 */
export interface Brief {
  /** 项目里**已经在用**的命令词（不带 /）—— 规划时不许重复 */
  existingCommands: string[];
  /** 项目里**已经在用**的数据键名 —— 配置时优先复用 */
  dataKeys: string[];
  /** 系统/分组名（让模型知道这个项目是怎么分块的） */
  systems: string[];
  /** 规模（节点数）—— 决定它该"小步改"还是"先看再说" */
  nodeCount: number;
  /** 静态提醒（从项目事实推出来的坑） */
  pitfalls: string[];
}

/**
 * 规划者的产出（多智能体第一阶段的交接产物，2026-10-18）。
 *
 * 为什么要有它：执行者（主循环）是"边读边改"的，容易在第 2 轮就跑偏；
 * 而一个**独立上下文、没有写工具**的规划者先出计划，执行者照着做 —— 这是
 * Planner/Executor 分离的最小形态。计划是**结构**而不是自然语言，理由同 Verdict：
 * 可被闸门钉、可进 trace、可被 evals 断言。
 */
export interface PlanStep {
  /** 这一步要干什么（一句话，动词开头） */
  intent: string;
  /** 建议用到的工具（只是提示，执行者可以不用） */
  tools?: string[];
}

export interface Plan {
  /** 目标：用一句话复述用户要什么 */
  goal: string;
  steps: PlanStep[];
  /** 已知风险/前置条件（执行者要留意） */
  risks: string[];
  /** 谁产出的：llm = 规划者模型；static = 规则生成 */
  by: 'llm' | 'static';
}

/**
 * 验证结论。
 *
 * 语义约定：**fail-open** —— 验证跑不起来（读盘失败/模型没按格式回）时返回 `ok: true` +
 * `note` 说明"本次没验成"。验证是**增益，不是关卡**：它绝不能把"能用的提案"变成"发不出去"。
 */
export interface Verdict {
  ok: boolean;
  issues: VerdictIssue[];
  /** 给人看的证据摘要（校验原文/测试日志/为什么放行） */
  evidence: string;
  /** 验证是怎么做的（`static` = 结构规则；`llm` = 独立上下文的只读复核） */
  by: 'static' | 'llm';
}
