// src/main/services/ai/autoTx.ts
//
// # 【运行级自动事务】（P0-4，2026-10-15）—— 多轮 mutation 的原子性
//
// ## 为什么（真机事故）
//
// 助手删掉节点、准备重建时模型额度 403 中断 → 删除已经落盘、重建没发生，
// **用户的流程永久少一个节点，而且没有任何提示**。
// 根因不是"模型不听话"，而是**多轮改动之间没有事务边界**：
// 仓库里其实**已经有** begin_batch / commit_batch / rollback_batch —— 问题是它们要
// **模型自己想起来用**。而"靠模型自觉"正是本仓库反复证明会失败的模式
// （`narrowRepeatedTools` 的原话："**不靠求它别查，直接让它查不了**"）。
//
// ## 做法：把"开事务"从模型的记性里挪到**循环的结构里**
//
//   · **开**：一次运行里第一次真要累积 mutation 时，循环**自己**开事务（不靠模型调 begin_batch）；
//   · **提交**：运行**正常收尾**（出了提案 / 给了答复）才提交；
//   · **回滚**：报错（403 / 网络）、用户取消、或"没能正常收尾"（轮数用尽 / 上下文超限）一律回滚。
//
// 本模块只放**判据**（纯函数 + 开关 + 文案），IO 在 index.ts：
// 因为它要碰的是那个模块的批次状态机（`batches`）与 `BrowserWindow`，搬出来反而会把
// 模块级单例依赖引进来（chatRun.ts 当初拆出去时刻意避开了这件事，这里照同一条纪律）。
//
// ## 四条边界（写在这里，免得后来者以为它管得比实际多）
//
// 1. **不新造回滚**：回滚用的是**既有**三样 —— 批次的图快照（`ai:needRollback`）、
//    轮次日志（`rollbackTurn`，与用户点"撤回这一轮"**同一个函数**）、主进程批次状态（`handleRollbackBatch`）。
// 2. **用户/模型自己开的批次不归这里管**：已经有批次在跑时**不重复开**，也不替它提交/回滚
//    （否则会把用户自己那笔事务提前结掉）。
// 3. **当前助手路径上 mutation 本来就不落盘**（它们累积成提案、等用户确认）。
//    所以这层事务在助手路径上是**兜底**（挡住"运行期间真的落了盘"的那些路径与将来的改动）；
//    它**不是**"跨多次确认的原子性" —— 两次确认之间的事务不在它的射程内。
// 4. 批次自带的 30 秒自动提交比很多运行都短：**跑过 30 秒的运行，图快照那一半会先超时**，
//    此时回滚只剩"轮次日志里的文件 / 数据"那一半（渲染层拿到 needRollback 时快照已空，会安全跳过）。
//

/**
 * 诊断开关（与 `QQBAT_PLAN_PHASE` / `QQBAT_TOOL_GUARD` / `QQBAT_KB` 同一类）。
 *
 * 默认**关**：不设这个变量时，运行的事务行为与改造前**逐字节一致** ——
 * 不自动开、不自动提交、不自动回滚（模型自己调 begin_batch/commit_batch 的老路一个字都不改）。
 * 打开：`QQBAT_AUTO_TX=1`。
 *
 * ## 为什么默认关（有意的，不是没做完）
 * 它会在**每次运行**里多发两条 `ai:clientInstruction`（begin/commit_batch）并可能触发一次自动回滚，
 * 而既有闸门（tests/evals、react-loop…）都在数"发了哪些事件 / 调了几次模型" —— 默认开会一起打红，
 * 而那些文件不在本任务的写范围内（与 P1-7 计划阶段同一处决断）。
 */
export const AUTO_TX_ENV = 'QQBAT_AUTO_TX';

export function isAutoTxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AUTO_TX_ENV] === '1';
}

/**
 * 循环那一侧需要的钩子（两个："该开事务了" + "模型自己在管事务"）。
 *
 * 为什么**提交/回滚不在循环里**：那两个时机属于**运行边界**（正常收尾 / 报错 / 取消 /
 * 没能正常收尾）—— 那四件事只有 `processAiChat` 看得见。判据留在那边，循环就只管"第一次改动"。
 */

/** 循环那一侧要的两个钩子："第一次真要改动" + "模型自己在管事务" */
export interface AutoTxHooks {
  open(toolName: string): void;
  noticeTransactionTool(toolName: string): void;
}

/** 运行结束时对这笔自动事务的处置：不归它管 / 提交 / 回滚 */
export type AutoTxOutcome = 'none' | 'commit' | 'rollback';

/**
 * 判据（纯函数）：只有"开关开着、事务确实是我们开的"才归这里管；
 * 报错 / 取消 / 没能正常收尾 一律回滚，其余正常收尾才提交。
 */
export function decideAutoTxOutcome(input: {
  enabled: boolean;
  opened: boolean;
  aborted: boolean;
  errored: boolean;
  degraded: boolean;
}): AutoTxOutcome {
  if (!input.enabled || !input.opened) return 'none';
  if (input.aborted || input.errored || input.degraded) return 'rollback';
  return 'commit';
}

/** 写进日志的回滚原因（只用于人读，不参与判据） */
export function autoTxRollbackReason(outcome: AutoTxOutcome): string {
  switch (outcome) {
    case 'commit':
      return '正常收尾';
    case 'rollback':
      return '报错 / 取消 / 未能正常收尾';
    default:
      return '不归自动事务管';
  }
}
