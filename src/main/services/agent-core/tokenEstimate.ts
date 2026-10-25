// src/main/services/agent-core/tokenEstimate.ts
//
// 循环这边的 token 估算：**定价算法来自 vendor/dsh/token-meter**（搬运与改动见那里的
// README / MANIFEST），本文件只做三件上游没有的事：
//   1. 把 ChatTurn 摊成上游的 content blocks；
//   2. 图片按张计价 —— 上游把图片当「结构 JSON 引用价」，那是 route 自己的账，
//      而这里要的是「这张图会占多少上下文」，1024×1024 一档约 1000 token；
//   3. 中文口径：上游 `text.length / 4` 对中文低估约 4 倍，所以字符计量走
//      `measureChars`（ASCII 记 1、宽字符记 4）。数字与本仓库旧 `estimateTokens` 等价。
import { CHARS_PER_TOKEN, estimateMessage } from '../../vendor/dsh/token-meter/estimate'
import { measureChars } from '../../vendor/dsh/token-meter/measure'
import type { ContentBlock } from '../../vendor/dsh/token-meter/types'
import type { ChatTurn } from './core'

/**
 * 一张图按多少 token 估。
 *
 * 与 `ai/tokenBudget` 的 IMAGE_TOKENS 同口径，但**故意不 import 过来**：那个模块是
 * 助手链路的一整包（预算 / 测量 / 日志），循环入口只想要一个常数。两处数字若哪天分叉，
 * 这条注释指路。
 */
export const IMAGE_TOKENS = 1000

/**
 * 一段纯文本的 token 估算（不含角色框 / 块开销）。
 * @param text - 要估算的文本
 * @returns 启发式 token 数；空串为 0
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(measureChars(text) / CHARS_PER_TOKEN)
}

/**
 * 一条对话回合的 token 估算：内容块定价 + 角色框 + 图片。
 *
 * 用上游的 `estimateMessage` 而不是自己再写一遍 `estimateTokens + 4`：
 * 块结构开销与角色框开销的定义权归 vendor，本仓库只负责「回合里有什么」。
 * system 回合成不算块开销，由上游 `estimateSystemMessage` 决定 —— 与本仓库旧口径
 * 相比，system 回合会略低（旧口径一律加 4），其余回合完全一致。
 * @param turn - 一条回合
 * @returns 启发式 token 数
 */
export function estimateTurnTokens(turn: ChatTurn): number {
  const text = turn.content ?? ''
  const content: ContentBlock[] = text ? [{ type: 'text', text }] : []
  const images = (turn.images?.length ?? 0) * IMAGE_TOKENS
  return estimateMessage({ role: turn.role, content }) + images + estimateToolCallTokens(turn)
}

/**
 * assistant 回合里「要了哪些工具」的计价（2026-10-26 补）。
 *
 * 为什么必须算：`write_file` 的 content 参数可以上万字符，一次写文件就可能把窗口撑满；
 * 以前只算 `content`，上下文压力被**低估**，闸门等到厂商 400 才反应过来。
 * 口径：工具名 + 参数 JSON，走同一个 {@link estimateTextTokens}（不另立算法）。
 * @param turn - 一条回合（通常只有 assistant 会带 toolCalls）
 * @returns 工具调用带来的 token 数；没有调用为 0
 */
function estimateToolCallTokens(turn: ChatTurn): number {
  if (!turn.toolCalls?.length) return 0
  let total = 0
  for (const call of turn.toolCalls) {
    total += estimateTextTokens(call.name)
    try {
      total += estimateTextTokens(JSON.stringify(call.args ?? {}))
    } catch {
      // 参数里有循环引用 / BigInt：给一个保守小常数，别让估算自己抛错把循环打死
      total += 16
    }
  }
  return total
}
