// src/renderer/src/lib/ai/turnGrouping.ts
//
// **把消息数组切成"轮"**（2026-10-18）：一轮 = 一条用户消息 + 它的回复与过程。
//
// 为什么要有它：轮是**渲染单位** —— 用户气泡、过程行（`TurnProcess`）、助手正文、操作行
// 都按轮落在同一个容器里，轮与轮之间才有间距。
//
// ⚠️ 2026-10-25 按 DSH 重排后**整轮不再折叠**（历史一直展开），折叠只发生在"过程"这一层；
// 原来那个 `turnPreview`（把整轮压成一行摘要）因此删掉了 —— 别再加回来。
//
// 这里刻意只有**纯函数**（不做 React 状态）：折叠是交互，切轮是数据，两者分开才测得动。

export interface TurnGroup {
  /** 折叠状态的 key。用起点下标：消息只追加、不插入，所以它稳定 */
  key: string
  /** 在 messages 里的范围 [start, end) */
  start: number
  end: number
  /** 这一轮的用户消息下标（没有用户消息时是 null，比如开场就报错） */
  userIndex: number | null
  /** 这一轮里助手消息条数 */
  replies: number
  /** 这一轮里工具调用条数（trace 里那些） */
  tools: number
}

type MessageLike = { role: string; trace?: readonly unknown[] }

/** 切轮：每条用户消息开一轮，之后的消息都归它；开场没有用户消息时单独成一轮 */
export function groupIntoTurns(messages: readonly MessageLike[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let cur: TurnGroup | null = null

  messages.forEach((msg, i) => {
    if (msg.role === 'user') {
      if (cur) {
        cur.end = i
        groups.push(cur)
      }
      cur = { key: 'turn-' + i, start: i, end: i + 1, userIndex: i, replies: 0, tools: 0 }
      return
    }
    if (!cur) {
      cur = { key: 'turn-' + i, start: i, end: i + 1, userIndex: null, replies: 0, tools: 0 }
    }
    cur.end = i + 1
    if (msg.role === 'assistant') {
      cur.replies += 1
      cur.tools += msg.trace?.length ?? 0
    }
  })

  if (cur) groups.push(cur)
  return groups
}
