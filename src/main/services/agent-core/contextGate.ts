// src/main/services/agent-core/contextGate.ts
//
// **循环内的上下文闸门**（2026-10-24，对齐 DSH 的 compaction 语义）。
// 跨轮历史由调用方裁；这里管**同一轮**里只增不减的 messages —— 每跑一次工具就多一条输出
// （单条上限 24k 字符），12 轮足够撑爆任何窗口，而撑爆时厂商要么 400、
// 要么悄悄截掉最前面的系统提示。
//
// 四条边界：保住 index 0 的系统提示；保住紧随其后的那句 user（任务原文，90 字摘要顶不上）；
// 保住尾部（条数下限 keepRecentTurns + 按 token 的保留区 retainTokens，推理链不能半剪）；
// 中间那段换成一条 system 注记，并明说"摘要非原文、要细节就重读文件"。
//
// **工具配对是硬约束**（2026-10-26，对齐 DSH `compaction/tool-pairing`）：循环从
// 2026-10-25 起把 assistant(toolCalls) 与 tool(toolResult) 真的放进 messages
// （core.ts:708 / scheduler.ts:147），切口落在"调用被丢进中段、结果留在尾部"之间，
// 厂商下一次请求就是 400，而报错只有一个孤零零的 tool_call_id，看不出是压缩切坏的。
// 所以切口要往回想，退到最近的配平位置（宁可多留一段，也不让协议断链）。
//
// 摘要两档（与 ai/contextDigest 同一纪律）：有模型先用模型，失败/空退回确定性摘要。
import type { DigestLlm } from '../ai/contextDigest'
import type { ToolResultPruneConfig } from '../../vendor/dsh/tool-result-pruner/types'
import { estimateTextTokens, estimateTurnTokens } from './tokenEstimate'
import { retreatToBalancedCut } from './toolPairing'
import { pruneToolTurns, TOOL_PRUNE_DEFAULTS } from './toolResultPrune'
import type { ChatTurn } from './core'

/** 循环内预算默认值：与助手的 `AUTHOR_PROFILE.conversationTokenBudget` 同量级 */
export const LOOP_TOKEN_BUDGET_DEFAULT = 80_000
/** 尾部至少留几条：一轮里通常 4 条（assistant + tool×N），8 条 ≈ 两轮 */
export const KEEP_RECENT_TURNS_DEFAULT = 8
/**
 * 尾部按 token 保留的比例（上游 `retainRatio` 默认 0.16）。
 * 与条数下限取**更宽**的那个：条数是地板（现场不许只剩摘要），比例是天花板之外的安全垫
 * （一条工具输出就能顶掉几十条短消息，只数条数会留得太少）。
 */
export const RETAIN_RATIO_DEFAULT = 0.16

const MAX_NOTE_LINE_CHARS = 90
const MAX_NOTE_TOTAL_CHARS = 1200
/** 送去模型摘要的**素材**上限：压下来的东西可能很大，摘要请求本身也得有上限 */
const MAX_SUMMARY_MATERIAL_CHARS = 6000
const MAX_SUMMARY_ITEM_CHARS = 400
/** 模型摘要回来的上限（再长就不像"备忘录"了） */
export const MAX_SUMMARY_CHARS = 1200

export const COMPACTION_NOTE_HEAD = '【本轮上下文已压缩（摘要非原文，需要细节请重读文件）】'

/**
 * 估算一段文本的 token 数（委托 `tokenEstimate`，定价算法来自 vendor/dsh/token-meter）。
 *
 * 口径没变：ASCII 4 字符 1 token、其余 1 字符 1 token —— 粗糙但**偏保守**，
 * 宁可早压一次，也不要等厂商 400。为什么换成上游算法、中文怎么校正，
 * 见 `tokenEstimate.ts` 的头注释与 `vendor/dsh/README.md`。
 */
export function estimateTokens(text: string): number {
  return estimateTextTokens(text)
}

/** 一段对话的 token 估算（逐条相加：内容块 + 角色框 + 图片，定义权在 `tokenEstimate`） */
export function estimateTurns(turns: readonly ChatTurn[]): number {
  let total = 0
  for (const turn of turns) total += estimateTurnTokens(turn)
  return total
}

export interface CompactionOptions {
  /** 预算（token）。超了才压；默认 LOOP_TOKEN_BUDGET_DEFAULT */
  budgetTokens?: number
  /** 尾部保留条数的**下限**。默认 KEEP_RECENT_TURNS_DEFAULT；与 retainTokens 取更宽的那个 */
  keepRecentTurns?: number
  /** 尾部按 token 至少保留多少。默认取预算的 {@link RETAIN_RATIO_DEFAULT}（16%） */
  retainTokens?: number
  /** 语义摘要（可选）：给了就先试它，抛错/空串退回确定性摘要 */
  summarize?: (dropped: readonly ChatTurn[]) => Promise<string | undefined>
  /**
   * 摘要之前先剪工具结果：`false` 关掉，给对象就用它的预算。
   * 默认 {@link TOOL_PRUNE_DEFAULTS}（上游 `DEFAULTS` 的同一组数：8k / 4k / 1k）。
   */
  pruneToolResults?: ToolResultPruneConfig | false
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
  /** 被摘要替换掉的回合数；只剪不压时为 0 */
  dropped: number
  /** 摘要之前先剪了几条超长工具结果（剪完可能就不需要压了） */
  pruned: number
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
 *
 * "压了也不省"不在这里判（这条注记的成本要落地时才算得准，见 `applyCompaction`）；
 * 这里只保证切口合法：头尾不被压、工具调用不劈开。
 */
export function planCompaction(
  turns: readonly ChatTurn[],
  opts: CompactionOptions = {},
): CompactionPlan | null {
  const budget = opts.budgetTokens ?? LOOP_TOKEN_BUDGET_DEFAULT
  const keepFloor = Math.max(2, opts.keepRecentTurns ?? KEEP_RECENT_TURNS_DEFAULT)
  const retainTokens = Math.max(0, opts.retainTokens ?? Math.round(budget * RETAIN_RATIO_DEFAULT))
  const tokensBefore = estimateTurns(turns)
  if (tokensBefore <= budget) return null
  const headEnd = turns.length > 0 && turns[0]?.role === 'system' ? 1 : 0
  // 头部紧随系统提示的那条 user 是**这一轮要做什么**，不许压（摘要只剩一行 90 字，够不上需求原文）
  const start = turns[headEnd]?.role === 'user' ? headEnd + 1 : headEnd

  // ① 条数下限：现场至少留几条，不能压到只剩一句摘要
  const available = Math.max(0, turns.length - start)
  let retained = Math.min(keepFloor, available)
  // ② token 保留区：从尾部往前累加，直到够 retainTokens（与上游 retainTokens 同口径）
  let retainedTokens = estimateTurns(turns.slice(turns.length - retained))
  while (retained < available && retainedTokens < retainTokens) {
    retained += 1
    retainedTokens += estimateTurnTokens(turns[turns.length - retained]!)
  }

  // ③ 工具配对是硬约束：切口不配平就往前退（退 = 多留），退不到配平点就放弃这次压缩
  const end = retreatToBalancedCut(turns, Math.max(start, turns.length - retained), start)
  if (end < 0) return null
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
 *
 * **最小收益**（2026-10-26）：注记本身也占 token（确定性注记最多 1200 字符）。
 * 若被丢的段落还不比这条注记大，压完反而更长 —— 这时只落剪枝、不落摘要，
 * 免得"每轮都压一次、每次都多调一次模型、上下文却更胖"。
 */
export async function applyCompaction(
  messages: ChatTurn[],
  opts?: CompactionOptions,
): Promise<CompactionOutcome | null> {
  if (!opts) return null
  const pruneConfig = opts.pruneToolResults ?? TOOL_PRUNE_DEFAULTS
  let plan = planCompaction(messages, opts)
  if (!plan) return null
  const tokensBefore = plan.tokensBefore

  /**
   * **先剪，再压**（2026-10-25）：把中段里超长的工具结果掐成「保头 + 标记 + 保尾」，
   * 剪完若回到预算内就一条回合都不丢 —— 保头保尾的原文（路径、报错、文件尾部的导出）
   * 比一段摘要有用，而且这一步确定、不用多调一次模型。
   * 剪完还超，才走原来的摘要压缩。
   */
  const pruned =
    pruneConfig === false
      ? { pruned: 0, charsRemoved: 0 }
      : pruneToolTurns(messages, plan.start, plan.end, pruneConfig)
  if (pruned.pruned > 0) {
    const retry = planCompaction(messages, opts)
    if (!retry) {
      return {
        dropped: 0,
        pruned: pruned.pruned,
        tokensBefore,
        tokensAfter: estimateTurns(messages),
      }
    }
    plan = retry
  }

  const summary = opts.summarize ? await opts.summarize(plan.dropped) : undefined
  const note = buildCompactionNote(plan.dropped, summary)
  // 压完（含注记）必须真的变小；只压掉几句寒暄就贴一条 1200 字的备忘录是净亏
  if (estimateTurns(plan.dropped) <= estimateTextTokens(note)) {
    return {
      dropped: 0,
      pruned: pruned.pruned,
      tokensBefore,
      tokensAfter: estimateTurns(messages),
    }
  }
  messages.splice(plan.start, plan.end - plan.start, { role: 'system', content: note })
  return {
    dropped: plan.dropped.length,
    pruned: pruned.pruned,
    tokensBefore,
    tokensAfter: estimateTurns(messages),
  }
}
