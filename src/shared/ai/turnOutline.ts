// src/shared/ai/turnOutline.ts
//
// 回合目录（第 56 批，对照 DSH `packages/session/session-turn-outline/src/projection.ts`）。
//
// 纯函数、零依赖：主进程/渲染层/测试都能直接算。
// 口径（与上游逐条对齐）：
//   · 每条用户消息开一轮，`turn` 从 1 开始；
//   · prompt 只取该用户消息正文，折叠空白后截 50 字符；
//   · response 取本轮内**最后一条**有正文的 assistant 消息，截 120 字符；
//   · 预览只是展示，不改消息本身，也不进模型。

export const TURN_PROMPT_PREVIEW_LIMIT = 50
export const TURN_RESPONSE_PREVIEW_LIMIT = 120

export interface TurnOutlineMessage {
  role: string
  content: string
}

export interface TurnOutlineEntry {
  /** 第几轮（从 1 开始） */
  turn: number
  /** 该轮用户消息在消息数组里的下标 —— 界面跳转锚点靠它 */
  userIndex: number
  /** 用户需求预览（≤50 字符，超限带 …） */
  prompt: string
  /** 助手回答预览（≤120 字符，超限带 …；本轮没回答 = 空串） */
  response: string
}

/** 折叠空白 + 按字符截断（码点安全：用 Array.from 数可见字符，不切代理对） */
export function previewText(input: string, limit: number): string {
  const text = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return chars.slice(0, limit).join('') + '…'
}

/**
 * 从消息数组切出回合目录。
 *
 * 注意：**没有用户消息 → 空数组**（不是一条"空轮"）；系统/attempt 消息忽略不上。
 * response 取"本轮最后一条 assistant"而不是第一条 —— 工具循环里 assistant 可能有多条
 * （思考/工具前的半句），最后一条才是结论。
 */
export function buildTurnOutline(messages: readonly TurnOutlineMessage[]): TurnOutlineEntry[] {
  const out: TurnOutlineEntry[] = []
  let current: TurnOutlineEntry | null = null

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const content = String(message?.content ?? '')
    if (message?.role === 'user') {
      current = {
        turn: out.length + 1,
        userIndex: index,
        prompt: previewText(content, TURN_PROMPT_PREVIEW_LIMIT),
        response: '',
      }
      out.push(current)
      continue
    }
    if (!current || message?.role !== 'assistant') continue
    const response = previewText(content, TURN_RESPONSE_PREVIEW_LIMIT)
    if (response) current.response = response
  }

  return out
}
