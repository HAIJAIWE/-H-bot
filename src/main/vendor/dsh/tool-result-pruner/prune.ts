/**
 * 工具结果的确定性「保头 + 标记 + 保尾」剪枝（纯函数版）。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 *   packages/compaction/compaction-tool-result-pruner/src/index.ts
 *   https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：上游是一整个 Cordis `Service`（`ToolResultPruner`），真正的策略只有两个
 * 方法；这里把它们原样提成纯函数 —— **剪枝逻辑一行没改**（按 code point 切、标记只插一次、
 * 剪后必须更小且不超阈值的自检都保留），只是 `this.config` 改成入参。
 * 没有搬 `pruneSession()`：它要上游的 Session 与 shadow-price 事件协议。
 */

import { PRUNE_MARKER, codePointLength, resolveConfig } from './config'
import type { ContentBlock } from '../token-meter/types'
import type { ResolvedConfig, ToolResultPruneConfig } from './types'

/**
 * 统计文本块的 code point 数；非文本块不计费。
 * @param blocks - 要统计的工具结果内容
 * @returns 所有文本块的 code point 总数
 */
export function measureContent(blocks: readonly ContentBlock[]): number {
  let chars = 0
  for (const block of blocks) {
    if (block.type === 'text') chars += codePointLength(block.text)
  }
  return chars
}

/**
 * 把一个超预算的工具结果替换成「保头 + 标记 + 保尾」，其余块顺序保留。
 * 文本按 code point 切，所以保留边界不会劈断代理对（grapheme 簇仍可能被切开）。
 * @param blocks - 原始工具结果内容
 * @param config - 字符预算（默认同上游 `DEFAULTS`）
 * @returns 剪过的内容；文本在预算内时返回 `null`
 */
export function pruneContent(
  blocks: readonly ContentBlock[],
  config: ToolResultPruneConfig | ResolvedConfig = {},
): ContentBlock[] | null {
  const settings: ResolvedConfig = resolveConfig(config)
  const totalChars = measureContent(blocks)
  if (totalChars <= settings.thresholdChars) return null

  const removedStart = settings.headChars
  const removedEnd = totalChars - settings.tailChars
  const pruned: ContentBlock[] = []
  let consumed = 0
  let markerInserted = false

  for (const block of blocks) {
    if (block.type !== 'text') {
      pruned.push(block)
      continue
    }

    const points = Array.from(block.text)
    const blockStart = consumed
    const blockEnd = blockStart + points.length
    const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
    const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
    const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
    const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : ''
    if (marker.length > 0) markerInserted = true
    const text = points.slice(0, headEnd).join('') + marker + points.slice(tailStart).join('')
    if (text.length > 0) pruned.push({ ...block, text })
    consumed = blockEnd
  }

  if (!markerInserted) throw new Error('tool-result prune: failed to locate the removed text span')
  const charsAfter = measureContent(pruned)
  if (charsAfter > settings.thresholdChars || charsAfter >= totalChars) {
    throw new Error('tool-result prune: replacement must be smaller and within threshold')
  }
  return pruned
}
