// src/main/services/agent-core/contextGate.ts
//
// **循环内的上下文闸门**（2026-10-24，对齐 DSH 的 compaction 语义）。
// 跨轮历史由调用方裁；这里管**同一轮**里只增不减的 messages —— 每跑一次工具就多一条输出
// （单条上限 24k 字符），12 轮足够撑爆任何窗口，而撑爆时厂商要么 400、
// 要么悄悄截掉最前面的系统提示。
//
// 四条边界：保住 index 0 的系统提示；保住紧随其后的那句 user（任务原文，90 字摘要顶不上）；
// 保住尾部 keepRecentTurns 条（推理链不能半剪）；中间那段换成一条 system 注记，
// 并明说"摘要非原文、要细节就重读文件"。
//
// 不管"工具结果有没有主人"：循环不把带 tool_calls 的 assistant 回合放进 messages，
// 结果就是一条纯内容，没有配不上的调用 —— 真正会丢的是上面那句任务。
//
// 摘要两档（与 ai/contextDigest 同一纪律）：有模型先用模型，失败/空退回确定性摘要。
import type { ChatTurn } from './core'
import type { DigestLlm } from '../ai/contextDigest'

/** 循环内预算默认值：与助手的 `AUTHOR_PROFILE.conversationTokenBudget` 同量级 */
export const LOOP_TOKEN_BUDGET_DEFAULT = 80_000
/** 尾部至少留几条：一轮里通常 4 条（assistant + tool×N），8 条 ≈ 两轮 */
export const KEEP_RECENT_TURNS_DEFAULT = 8

const MAX_NOTE_LINE_CHARS = 90
const MAX_NOTE_TOTAL_CHARS = 1200
/** 送去模型摘要的**素材**上限：压下来的东西可能很大，摘要请求本身也得有上限 */
const MAX_SUMMARY_MATERIAL_CHARS = 6000
const MAX_SUMMARY_ITEM_CHARS = 400
/** 模型摘要回来的上限（再长就不像"备忘录"了） */
export const MAX_SUMMARY_CHARS = 1200

/**
 * 一张图按多少 token 估。
 *
 * 与 ai/tokenBudget 的 IMAGE_TOKENS 同一个口径（1024×1024 一档约 1000），
 * 但**不 import 过来**：那个模块是助手链路的一整包（预算/测量/日志），
 * 循环入口只想要一个常数。两处数字若哪天分叉，注释会指路。
 */
const IMAGE_TOKENS = 1000

export const COMPACTION_NOTE_HEAD = '【本轮上下文已压缩（摘要非原文，需要细节请重读文件）】'

/**
 * 估算一段文本的 token 数。
 *
 * 不用 `length / 3`（旧实现的写法）：中文在主流分词器里约等于 1 字符 1 token，
 * 除以 3 会把"已经 80k 了"误判成"才 27k"，压到一半才发现爆了。
 * 这里 ASCII 按 4 字符 1 token、其余按 1 字符 1 token —— 粗糙但**偏保守**，
 * 宁可早压一次，也不要等厂商 400。
 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let wide = 0
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) ascii += 1
    else wide += 1
  }
  return Math.ceil(ascii / 4) + wide
}

/** 一段对话的 token 估算（逐条相加，留一点每条的结构开销） */
export function estimateTurns(turns: readonly ChatTurn[]): number {
  let total = 0
  for (const turn of turns) {
    // 图片按张估（base64 长度当文字算会把预算判断成爆表）
    total += estimateTokens(turn.content ?? '') + 4 + (turn.images?.length ?? 0) * IMAGE_TOKENS
  }
  return total
}

export interface CompactionOptions {
  /** 预算（token）。超了才压；默认 LOOP_TOKEN_BUDGET_DEFAULT */
  budgetTokens?: number
  /** 尾部保留条数。默认 KEEP_RECENT_TURNS_DEFAULT */
  keepRecentTurns?: number
  /** 语义摘要（可选）：给了就先试它，抛错/空串退回确定性摘要 */
  summarize?: (dropped: readonly ChatTurn[]) => Promise<string | undefined>
}

export interface CompactionPlan {
  /** 被替换区间的起点（系统提示与任务句之后） */
  start: number
  /** 被替换区间的终点（尾部保留区之前） */
  end: number
  dropped: ChatTurn[]
  tokensBefore: number
  tokensAfter: number
}

export interface CompactionOutcome {
  dropped: number
  tokensBefore: number
  tokensAfter: number
}

const ROLE_LABEL: Record<ChatTurn['role'], string> = {
  system: '系统',
  user: '用户',
  assistant: '助手',
  tool: '工具',
}

function oneLine(text: string, max: number): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/**
 * 算一次压缩计划；不该压时返回 null（预算内、没有可丢的中段、只剩系统提示）。
 *
 * **纯函数**：只读 turns，不改任何东西 —— 循环里怎么落地由 `applyCompaction` 决定，
 * 这样"压哪一段"可以单独测，不用假装跑一个循环。
 */
export function planCompaction(
  turns: readonly ChatTurn[],
  opts: CompactionOptions = {},
): CompactionPlan | null {
  const budget = opts.budgetTokens ?? LOOP_TOKEN_BUDGET_DEFAULT
  const keep = Math.max(2, opts.keepRecentTurns ?? KEEP_RECENT_TURNS_DEFAULT)
  const tokensBefore = estimateTurns(turns)
  if (tokensBefore <= budget) return null
  const headEnd = turns.length > 0 && turns[0]?.role === 'system' ? 1 : 0
  // 头部紧随系统提示的那条 user 是**这一轮要做什么**，不许压（摘要只剩一行 90 字，够不上需求原文）
  const start = turns[headEnd]?.role === 'user' ? headEnd + 1 : headEnd
  const end = Math.max(start, turns.length - keep)
  const dropped = turns.slice(start, end)
  if (dropped.length < 2) return null
  return {
    start,
    end,
    dropped,
    tokensBefore,
    tokensAfter: tokensBefore - estimateTurns(dropped),
  }
}

/**
 * 被压掉的那一段 → 塞回上下文的一条 system 注记。
 *
 * 有模型摘要就用它；没有就给确定性摘要（每条一行、有总长上限）。
 * 两种都**必须**带上条数与"非原文"提醒 —— 让模型知道哪些细节已经不在眼前。
 */
export function buildCompactionNote(dropped: readonly ChatTurn[], summary?: string): string {
  const head = COMPACTION_NOTE_HEAD + '共 ' + dropped.length + ' 条早先回合被压缩。'
  const clean = (summary ?? '').trim()
  if (clean) return head + '\n' + clean.slice(0, MAX_SUMMARY_CHARS)
  const lines: string[] = []
  let used = 0
  let cut = false
  for (const turn of dropped) {
    const who = ROLE_LABEL[turn.role] + (turn.name ? '(' + turn.name + ')' : '')
    const line = '- ' + who + '：' + oneLine(turn.content, MAX_NOTE_LINE_CHARS)
    if (used + line.length + 1 > MAX_NOTE_TOTAL_CHARS) {
      cut = true
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  if (cut) lines.push('- …（更早的内容继续省略）')
  return head + '\n' + lines.join('\n')
}

/** 给模型看的摘要请求（素材先按条裁剪：被压下来的工具输出可能 24k 字符一条） */
export function buildTurnSummaryPrompt(dropped: readonly ChatTurn[]): string {
  const lines: string[] = []
  let used = 0
  for (const turn of dropped) {
    const who = ROLE_LABEL[turn.role] + (turn.name ? '(' + turn.name + ')' : '')
    const line = who + '：' + oneLine(turn.content, MAX_SUMMARY_ITEM_CHARS)
    if (used + line.length > MAX_SUMMARY_MATERIAL_CHARS) {
      lines.push('…（后面的回合继续省略）')
      break
    }
    lines.push(line)
    used += line.length
  }
  return [
    '下面是一轮正在进行的任务里、被上下文预算压掉的早先回合。请压缩成给同一助手看的备忘录。',
    '要求：',
    '1. 只保留任务目标、已达成的决定、改过/读过的文件路径、失败过的做法与原因、还没做完的待办；',
    '2. 用简洁的条目，不要客套，不要复述工具输出全文；',
    '3. 原文没提到的事不要猜，宁可省略；',
    '4. 总长不超过 800 字。',
    '',
    '【被压掉的回合】',
    ...lines,
  ].join('\n')
}

/**
 * 把语义摘要包成 `CompactionOptions.summarize`。
 *
 * 没给 llm 就返回 undefined（= 只用确定性摘要）。摘要失败一律吞掉返回 undefined ——
 * 同 `summarizeDroppedHistory`：压缩不能成为新的故障点。
 */
export function makeTurnSummarizer(
  llm?: DigestLlm,
): ((dropped: readonly ChatTurn[]) => Promise<string | undefined>) | undefined {
  if (!llm) return undefined
  return async dropped => {
    try {
      const text = (await llm.summarize(buildTurnSummaryPrompt(dropped))).trim()
      return text ? text.slice(0, MAX_SUMMARY_CHARS) : undefined
    } catch {
      return undefined
    }
  }
}

/**
 * 在循环里**就地**压一次：把中段换成一条 system 注记。
 *
 * 返回 null = 没压（预算内 / 没得压），调用方据此决定要不要报事件。
 * 注意它是 `splice` 同一个数组：调度器与调用方都拿着这个引用，
 * 换成新数组会让它们看到两份不同的对话。
 */
export async function applyCompaction(
  messages: ChatTurn[],
  opts?: CompactionOptions,
): Promise<CompactionOutcome | null> {
  if (!opts) return null
  const plan = planCompaction(messages, opts)
  if (!plan) return null
  const summary = opts.summarize ? await opts.summarize(plan.dropped) : undefined
  const note = buildCompactionNote(plan.dropped, summary)
  messages.splice(plan.start, plan.end - plan.start, { role: 'system', content: note })
  return {
    dropped: plan.dropped.length,
    tokensBefore: plan.tokensBefore,
    tokensAfter: estimateTurns(messages),
  }
}
