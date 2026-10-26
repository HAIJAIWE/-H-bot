// src/shared/ai/messageFeedback.ts
//
// 单条消息的**反馈**（第 58 批，对照 DSH `dsh-message-feedback` / `dsh-command-feedback`）。
//
// 上游把反馈做成会话事件流里的**投影**（`feedback/message-put` 累加、删除靠墓碑事件回放），
// 本仓没有事件流，于是降成"每条线程一份小的反馈表 + 落盘"：
//   · rating 只有两档（👍/👎），点已选中的那档 = 撤回（对齐上游 retract 语义）；
//   · category 是**七选一**的固定词表（上游 `FEEDBACK_CATEGORIES` 原样搬，名字不改）；
//   · note 是可选的补充说明，归一后为空就不落（上游 `note-blank` 同款判定）。
//
// 为什么词表与常量都放 shared：主进程要校验、渲染层要渲染 chip 文案，
// 两边各写一份就会出现"菜单里有第七个分类、主进程拒收"这种漂移。
// 分类的**展示文案**走 i18n（键名 = 分类 id），这里只定义 id 与顺序。

/** 反馈分类（顺序即界面上的 chip 顺序，与上游一致） */
export const FEEDBACK_CATEGORIES = [
  'task-result',
  'instruction-following',
  'product-interaction',
  'service-stability',
  'resource-cost',
  'security-privacy-permission',
  'other',
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export type FeedbackRating = 'positive' | 'negative'

/** 补充说明的字数上限。上游是字节上限（`maxNoteBytes`），本仓按字符算更适合中文 */
export const MAX_FEEDBACK_NOTE_CHARS = 500

/** 一条反馈（落盘形状；`createdAt` 保留首次，改评分只更新 `updatedAt`） */
export interface MessageFeedbackItem {
  rating: FeedbackRating
  category?: FeedbackCategory
  note?: string
  /** ISO 时间串：与历史 JSONL 的 ts 同一口径 */
  createdAt: string
  updatedAt: string
}

/** 一条线程的反馈表：messageId → 反馈 */
export type ThreadFeedbackMap = Record<string, MessageFeedbackItem>

export function isFeedbackRating(value: unknown): value is FeedbackRating {
  return value === 'positive' || value === 'negative'
}

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(value as string)
}

/**
 * 归一序号解释文字：去控制字符、折叠空白、截断。
 *
 * 与标题归一同一个口径（`cleanTitleText` 那套太激进 —— 它会把整段说明压成一行标题），
 * 这里只做三件事：剥控制字符（含方向性字符以外的 C0/C1）、折叠连续空白、按码点截断。
 * 空串表示"没有说明"，调用方据此不落 `note` 字段。
 */
export function normalizeFeedbackNote(raw: string): string {
  const stripped = raw.replace(/\p{Cc}/gu, ' ')
  const folded = stripped.replace(/\s+/gu, ' ').trim()
  return truncateByCodePoints(folded, MAX_FEEDBACK_NOTE_CHARS)
}

/** 按码点截断（不用 `slice`：代理对会被切成半个 emoji） */
function truncateByCodePoints(text: string, max: number): string {
  if (text.length <= max) return text
  const points = Array.from(text)
  if (points.length <= max) return text
  return points.slice(0, max).join('')
}
