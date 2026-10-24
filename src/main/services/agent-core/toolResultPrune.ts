// src/main/services/agent-core/toolResultPrune.ts
//
// **工具结果先掐头留尾，再考虑压回合**（2026-10-25）。策略本身从
// vendor/dsh/tool-result-pruner 搬来（上游 compaction 的第三步），本文件只做适配：
//   1. 把 `ChatTurn.content`（纯字符串）包成单个 text 块，剪完再拼回字符串；
//   2. 只剪调用方指定的区间（循环里是「本来要被摘要压掉的中段」）；
//   3. 只动 `role === "tool"` 的回合 —— 用户/助手/系统的话不许被剪。
//
// 为什么值得先剪再压：保头保尾的原文比一段摘要有用得多（路径、报错、文件尾部的导出
// 都还在），而且这一步是**确定性**的，不用多调一次模型。
import { measureContent, pruneContent } from '../../vendor/dsh/tool-result-pruner/prune'
import type { ContentBlock } from '../../vendor/dsh/token-meter/types'
import type { ToolResultPruneConfig } from '../../vendor/dsh/tool-result-pruner/types'
import type { ChatTurn } from './core'

/**
 * 循环里用的剪枝预算：直接取上游 `DEFAULTS` 的数值（8k 阈值、保头 4k、保尾 1k）。
 *
 * 不 import `DEFAULTS` 本身：那是被 `deepFreeze` 冻结的对象，塞进 options 再被
 * `resolveConfig` 二次 `structuredClone` 也没问题，但显式写一遍更看得清「我们改没改」。
 */
export const TOOL_PRUNE_DEFAULTS: ToolResultPruneConfig = {
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
}

export interface ToolPruneOutcome {
  /** 实际被剪的工具回合数 */
  readonly pruned: number
  /** 一共剪掉多少 code point（给日志用） */
  readonly charsRemoved: number
}

/**
 * 把 `turns[start, end)` 区间里超预算的工具结果剪成「保头 + 标记 + 保尾」。
 *
 * **就地改** `turns`（与 `applyCompaction` 同一个理由：循环各处拿着同一个数组引用，
 * 换成新数组会让它们看到两份不同的对话）。
 * @param turns - 要处理的对话（就地改）
 * @param start - 区间起点（含）
 * @param end - 区间终点（不含）
 * @param config - 字符预算；默认 {@link TOOL_PRUNE_DEFAULTS}
 * @returns 剪了几条、剪掉多少字符
 */
export function pruneToolTurns(
  turns: ChatTurn[],
  start: number,
  end: number,
  config: ToolResultPruneConfig = TOOL_PRUNE_DEFAULTS,
): ToolPruneOutcome {
  let pruned = 0
  let charsRemoved = 0
  for (let index = Math.max(0, start); index < end && index < turns.length; index += 1) {
    const turn = turns[index]
    if (!turn || turn.role !== 'tool') continue
    const text = turn.content ?? ''
    const blocks: ContentBlock[] = [{ type: 'text', text }]
    const before = measureContent(blocks)
    const next = pruneContent(blocks, config)
    if (!next) continue
    const after = measureContent(next)
    // 我们只会传纯 text 块进来，剪完仍然只有 text（非文本块只是原样透传）
    const merged = next.map(block => (block.type === 'text' ? block.text : '')).join('')
    turns[index] = { ...turn, content: merged }
    pruned += 1
    charsRemoved += before - after
  }
  return { pruned, charsRemoved }
}
