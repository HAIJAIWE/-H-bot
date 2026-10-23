// src/renderer/src/lib/ai/turnGrouping.ts
//
// **把消息数组切成"轮"**（2026-10-18）：一轮 = 一条用户消息 + 它的回复与被折叠的工具行。
//
// 为什么要有它：十轮之后面板会变成一条几百行、翻不到底的流水 —— 用户只想看"我刚问的和
// 它刚答的"，往上全是历史。折叠成一行摘要（"你: … · 2 条回复 · 1 次工具"）之后，
// 历史可翻、当前可读。
//
// 这里刻意只有**纯函数**（不做 React 状态）：折叠是交互，切轮是数据，两者分开才测得动。

export interface TurnGroup {
  /** 折叠状态的 key。用起点下标：消息只追加、不插入，所以它稳定 */
  key: string;
  /** 在 messages 里的范围 [start, end) */
  start: number;
  end: number;
  /** 这一轮的用户消息下标（没有用户消息时是 null，比如开场就报错） */
  userIndex: number | null;
  /** 这一轮里助手消息条数 */
  replies: number;
  /** 这一轮里工具调用条数（trace 里那些） */
  tools: number;
}

type MessageLike = { role: string; trace?: readonly unknown[] };

/** 切轮：每条用户消息开一轮，之后的消息都归它；开场没有用户消息时单独成一轮 */
export function groupIntoTurns(messages: readonly MessageLike[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let cur: TurnGroup | null = null;

  messages.forEach((msg, i) => {
    if (msg.role === 'user') {
      if (cur) {
        cur.end = i;
        groups.push(cur);
      }
      cur = { key: 'turn-' + i, start: i, end: i + 1, userIndex: i, replies: 0, tools: 0 };
      return;
    }
    if (!cur) {
      cur = { key: 'turn-' + i, start: i, end: i + 1, userIndex: null, replies: 0, tools: 0 };
    }
    cur.end = i + 1;
    if (msg.role === 'assistant') {
      cur.replies += 1;
      cur.tools += msg.trace?.length ?? 0;
    }
  });

  if (cur) groups.push(cur);
  return groups;
}

/**
 * 折叠行上那半句话：用户消息的第一行，超长截断。
 *
 * 取第一行是因为用户经常贴一大段（日志/报错）—— 摘要里塞全文等于没折叠。
 */
export function turnPreview(text: string, max = 42): string {
  const first = (text ?? '').trim().split('\n')[0]?.trim() ?? '';
  if (!first) return '';
  return first.length > max ? first.slice(0, max) + '…' : first;
}
