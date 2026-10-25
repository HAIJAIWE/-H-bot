// src/main/services/agent-core/toolPairing.ts
//
// **工具调用配对**（2026-10-26，语义对齐 DSH `packages/compaction/compaction/src/tool-pairing.ts`）。
//
// 为什么必须有：厂商协议要求 assistant(tool_calls) → tool(tool_call_id) 成对。
// 压缩若把切口落在「调用在丢弃段、结果留在尾部」之间，下一次请求直接 400，
// 而报错文本（一个孤零零的 tool_call_id）完全看不出是压缩切坏的。
//
// 循环的 messages 从 2026-10-25 起**真的**带 toolCalls / toolResult
// （core.ts:708 推 assistant(toolCalls)、scheduler.ts:147 推 tool(toolResult)），
// 所以上游那条「不劈开配对」的约束现在也适用于我们。
//
// 口径与上游一致：以当前顺序为序，assistant 每带一个工具调用 +1、每条工具结果 -1，
// **切口处余额为 0** 才允许切。区别只有一处：上游遇到「没有调用的结果」直接抛错，
// 这里把该切口及其之后一律判为不可切（压缩是每轮都跑的路，不该被一条坏数据整轮打死）。
import type { ChatTurn } from './core'

/**
 * 一条回合对「未完成工具调用数」的增减。
 * @param turn - 一条对话回合
 * @returns assistant 带 N 个调用为 +N，tool 结果为 -1，其余 0
 */
export function toolCallDelta(turn: ChatTurn): number {
  const calls = turn.toolCalls?.length ?? 0
  const results = turn.toolResult !== undefined ? 1 : 0
  return calls - results
}

/**
 * 每个切口的配平表：第 i 项表示「turns[i] 之前」那个切口是否安全。
 *
 * 结果比 turns 长 1（最后一项是尾部之后的切口），方便调用方直接按索引取。
 * 一旦出现余额为负（结果没有对应调用 = 数据已经坏了），这张表从那里起全部为
 * false —— 不切在坏数据旁边，比"切完再猜哪里坏了"可控。
 *
 * @param turns - 当前 messages（顺序即送入模型的顺序）
 * @returns 长度 turns.length + 1 的布尔数组
 */
export function toolPairingCuts(turns: readonly ChatTurn[]): boolean[] {
  const cuts: boolean[] = [true]
  let pending = 0
  let corrupt = false
  for (const turn of turns) {
    pending += toolCallDelta(turn)
    if (pending < 0) corrupt = true
    cuts.push(!corrupt && pending === 0)
  }
  return cuts
}

/**
 * 「turns[index] 之前」这个切口是否工具配对平衡。
 * @param turns - 当前 messages
 * @param index - 切口位置（0 = 序列最前，turns.length = 序列最后）
 * @returns 没有跨切口未完成的工具调用时为 true；越界为 false
 */
export function toolPairingBalancedBefore(turns: readonly ChatTurn[], index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index > turns.length) return false
  return toolPairingCuts(turns)[index] === true
}

/**
 * 从 `from` 往回找第一个配平的切口（含 `from`）。
 *
 * 压缩用它把"想切的位置"退回到最近的配平点：往回想 = 多留内容，
 * 与上游 `keepFromIdx -= 1` 同方向（宁可少丢，也不让协议断链）。
 *
 * @param turns - 当前 messages
 * @param from - 期望的切口（通常是"按预算算出来的终点"）
 * @param floor - 不许再往前退的下限（通常是压缩起点）
 * @returns 配平切口；`floor` 之上找不到时返回 -1
 */
export function retreatToBalancedCut(
  turns: readonly ChatTurn[],
  from: number,
  floor: number,
): number {
  const limit = Math.max(0, Math.min(floor, turns.length))
  for (let index = Math.min(from, turns.length); index > limit; index -= 1) {
    if (toolPairingBalancedBefore(turns, index)) return index
  }
  return toolPairingBalancedBefore(turns, limit) && limit < from ? limit : -1
}
