/**
 * 固定密度的启发式 token 定价 —— 与「上下文分解投影」共用同一套算法，
 * 让两个界面把同一段内容算成同一个数。
 *
 * @module vendor/dsh/token-meter/estimate
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 *   packages/llm/token-meter/src/estimate.ts
 *   https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动（逐条登记在 ../../MANIFEST.json 的 adaptedNotes）：
 *   1. 类型来自本地 `./types`，不依赖 `@deepseek-ai/dsh-llm` / `dsh-session`；
 *   2. 字符计量改走 `./measure`（上游直接 `text.length / 4`，对中文低估约 4 倍）；
 *   3. 导出 `CHARS_PER_TOKEN` / `BLOCK_OVERHEAD`（适配层要用同一个数）；
 *   4. 删掉 `estimateToolsTokens`（要 `EpochHeader`，本仓库没有该模型）。
 */

import { measureChars } from './measure'
import type { ContentBlock, Message } from './types'

/** 固定文本密度估算；等到需要精确分词的那天再换。 */
export const CHARS_PER_TOKEN = 4

/** 每个块的 JSON 框与类型标签的结构开销。 */
export const BLOCK_OVERHEAD = 4

/** 每条被定价消息都要加的角色字段框开销。 */
export const ROLE_OVERHEAD = 4

/**
 * 一个块在类型化分支之外的结构 JSON 价格：合并扩展块与图片引用走这条。
 * 图片引用剔掉 `offloaded` 再算 —— 上游由 route 自己算占位价，这里只算引用结构。
 * @param block - 要定价的块（不改它）
 * @returns 该块 JSON 结构的启发式 token 数
 */
export function estimateStructuralBlock(block: ContentBlock): number {
  if (block.type === 'image') {
    const { offloaded: _offloaded, ...reference } = block
    return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(reference).length / CHARS_PER_TOKEN)
  }
  return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
}

/**
 * 按固定密度启发式递归定价一组内容块。
 * @param blocks - 要定价的块（不改它们）
 * @returns 含每块结构开销的启发式 token 数
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(measureChars(block.text) / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens +=
          Math.ceil(measureChars(block.name) / CHARS_PER_TOKEN) +
          Math.ceil(measureChars(block.arguments) / CHARS_PER_TOKEN) +
          BLOCK_OVERHEAD
        break
      default:
        // 未知块（含图片引用，请求价由 route 拥有）保留保守的结构 JSON 价格。
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

/**
 * 定价渲染后的系统提示：按文本密度 + 角色框，不加每块结构开销。
 * @param message - 系统角色消息（不改它）
 * @returns 启发式系统提示 token 数；空内容返回 0（=「没有系统提示」）
 */
export function estimateSystemMessage(message: Message): number {
  if (message.content.length === 0) return 0
  let characters = 0
  for (const block of message.content) {
    characters += block.type === 'text' ? measureChars(block.text) : JSON.stringify(block).length
  }
  return Math.ceil(characters / CHARS_PER_TOKEN) + ROLE_OVERHEAD
}

/**
 * 启发式定价一条模型可见消息。
 * @param message - 要定价的消息（不改它）
 * @returns 内容价 + 角色框；system 角色走 {@link estimateSystemMessage}
 */
export function estimateMessage(message: Message): number {
  if (message.role === 'system') return estimateSystemMessage(message)
  return estimateContent(message.content) + ROLE_OVERHEAD
}
