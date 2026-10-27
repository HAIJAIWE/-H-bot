// src/main/services/ai/threadTitles.ts
//
// 会话标题的**落盘与生成**（第 56 批；第 60 批加"每轮刷新"）。
//
// 上游把标题做成 session 事件流里的投影 + 可插拔 provider；本仓没有事件流，于是降成：
//   · fallback：不落盘，读取列表时由首条用户消息即时推导（纯函数在 shared）；
//   · provider：线程首轮成功后异步生成一次；从第二轮起**每轮刷新一次**（第 60 批）；
//   · user：用户重命名，落盘并 pin（此后不再自动生成，对齐上游 rename supersede 语义）。
//
// 落盘用 `infra/fileOps.atomicWrite`（先写临时文件再 rename），所以不需要进
// `projectWritesViaFileOps` 的直写登记表；坏文件一律容忍成"没有标题"，绝不因为一份
// 标题缓存坏了就让线程列表打不开。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../infra/fileOps'
import { logger } from '../infra/logger'
import { normalizeThreadTitle } from '@shared/ai/threadTitle'
import type { ThreadTitleRecord, ThreadTitleSource } from '@shared/ai/threadTitleTypes'
import { callLlm, type LlmConfig } from './llm'

export const THREAD_TITLES_FILE = '.qqbat/ai-thread-titles.json'
export const THREAD_TITLES_VERSION = 1

/** 标题生成请求的字数切片：需求与回答各取前这么多字，够模型判断主题，又不烧 token */
const TITLE_PROMPT_CHARS = 500
const TITLE_RESPONSE_CHARS = 500
/**
 * 每轮刷新时折叠的用户消息总字数上限（第 60 批）。
 *
 * 上游的做法是**取最后一条用户消息**，但本仓的线程消息落盘在 .jsonl、上下文还有
 * 压缩与裁剪，单取最后一条会把"这个会话到底在干什么"切掉一半。所以改成折叠多条、
 * 总量封顶：4000 字 ≈ 一次很便宜的标题请求（对比主回答的预算可以忽略），
 * 再长也不加了 —— 标题只需要主题，不需要全文。
 */
const REFRESH_INPUT_MAX_CHARS = 4000
/**
 * 同一个线程两次刷新之间的最小间隔（第 60 批）。
 *
 * 一秒钟内连发两条要求的场景真实存在（用户回车两次、或一轮结束后立刻纠偏），
 * 那时的标题请求模型还没回，新的又发出去只会互相覆盖。**放行前一次、丢弃后一次**，
 * 因为后一次的上下文马上会包含前一次已经覆盖的消息（下一次刷新会补上）。
 */
const REFRESH_MIN_INTERVAL_MS = 2000
/** 标题生成是"锦上添花"的旁路请求 —— 超时就放弃，绝不拖住主流程 */
const TITLE_TIMEOUT_MS = 30_000

export type ThreadTitleMap = Record<string, ThreadTitleRecord>

function titlesPath(projectPath: string): string {
  return join(projectPath, THREAD_TITLES_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: unknown): value is ThreadTitleSource {
  return value === 'fallback' || value === 'provider' || value === 'user'
}

/** 单条记录校验：字段齐全、source 合法、标题归一后仍非空。不合格 → 丢弃 */
function parseRecord(value: unknown): ThreadTitleRecord | null {
  if (!isRecord(value)) return null
  const rawTitle = typeof value.title === 'string' ? value.title : ''
  const source = isSource(value.source) ? value.source : null
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : ''
  const title = normalizeThreadTitle(rawTitle)
  if (!title || !source || !updatedAt) return null
  // 第 60 批之前落的记录没有 revision：按 1 兜底，别因为加了个字段就把旧标题全作废
  const revision =
    typeof value.revision === 'number' && Number.isFinite(value.revision) && value.revision > 0
      ? Math.floor(value.revision)
      : 1
  const inputCount =
    typeof value.inputCount === 'number' && Number.isFinite(value.inputCount)
      ? Math.max(0, Math.floor(value.inputCount))
      : undefined
  return {
    title,
    source,
    updatedAt,
    revision,
    ...(inputCount === undefined ? {} : { inputCount }),
  }
}

/**
 * 读整份标题表。**任何异常都返回空表**：
 * 文件不存在（最常见）、JSON 坏、版本不认识（将来升级）、条目字段不合法 —— 一律当"还没有标题"，
 * 让 fallback 顶上；不自动删文件（与第 54 批撤销点的"坏记录不自动删"同一纪律）。
 */
export async function readThreadTitles(projectPath: string): Promise<ThreadTitleMap> {
  let raw: string
  try {
    raw = await readFile(titlesPath(projectPath), 'utf-8')
  } catch {
    return {}
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(data) || data.version !== THREAD_TITLES_VERSION || !isRecord(data.titles)) return {}
  const map: ThreadTitleMap = {}
  for (const [threadId, value] of Object.entries(data.titles)) {
    const record = parseRecord(value)
    if (record) map[threadId] = record
  }
  return map
}

async function writeThreadTitles(projectPath: string, titles: ThreadTitleMap): Promise<void> {
  const body = JSON.stringify({ version: THREAD_TITLES_VERSION, titles }, null, 2) + '\n'
  await atomicWrite(titlesPath(projectPath), body)
}

interface WriteFenceOptions {
  title: string
  source: ThreadTitleSource
  /**
   * 生成这次标题**之前**看到的修订号（`0` = 当时没有任何标题）。
   *
   * 生成是异步的：等模型回话的这几秒里用户可能已经手动重命名、或另一个刷新先落了盘。
   * 落盘前重读一次，修订号对不上就**整条丢弃** —— 自动标题永远不覆盖更新的决定
   * （上游 rename supersede 的同一语义，只是这里靠版本号判而不是事件流）。
   */
  baseRevision: number
  inputCount?: number
  /** 手动写入（用户重命名）：不校验修订号，也允许覆盖 provider 标题 */
  force?: boolean
}

/**
 * 带栅栏的写一条标题。返回落盘记录；栅栏判定过期 / 被手动 pin → 返回 null。
 *
 * 注意：`force` 只给用户重命名用。自动链路（首轮生成 + 每轮刷新）一律过栅栏。
 */
async function writeTitleWithFence(
  projectPath: string,
  threadId: string,
  opts: WriteFenceOptions,
): Promise<ThreadTitleRecord | null> {
  const titles = await readThreadTitles(projectPath)
  const current = titles[threadId]
  if (!opts.force) {
    // 用户改过的标题是 pin：自动标题永远不覆盖它（判据在磁盘上，不只是内存里）
    if (current?.source === 'user') return null
    const currentRevision = current?.revision ?? 0
    if (currentRevision !== opts.baseRevision) {
      logger.info(
        `[ai] 标题刷新作废（${threadId}）：磁盘上的修订号 ${currentRevision} 与开工时的 ${opts.baseRevision} 不一致`,
      )
      return null
    }
  }
  const record: ThreadTitleRecord = {
    title: opts.title,
    source: opts.source,
    updatedAt: new Date().toISOString(),
    revision: (current?.revision ?? 0) + 1,
    ...(opts.inputCount === undefined ? {} : { inputCount: opts.inputCount }),
  }
  titles[threadId] = record
  await writeThreadTitles(projectPath, titles)
  return record
}

/**
 * 写一条标题。归一后为空 → 抛人话错误（IPC 统一把 message 转成 `{ok:false,error}`）。
 * 返回落到文件里的记录（含归一后的标题与来源）。
 */
export async function setThreadTitle(
  projectPath: string,
  threadId: string,
  rawTitle: string,
  source: ThreadTitleSource,
): Promise<ThreadTitleRecord> {
  const title = normalizeThreadTitle(rawTitle)
  if (!title) {
    throw new Error('标题不能为空（去掉控制字符后没有可见字符）')
  }
  const record = await writeTitleWithFence(projectPath, threadId, {
    title,
    source,
    baseRevision: 0,
    force: true,
  })
  // force 路径只有"文件读不出来"才有 null 的可能；真出现了也要给调用方一个记录
  if (record) return record
  throw new Error('标题没能写进磁盘（标题缓存不可读或不可写）')
}

/** 用户重命名：来源固定 `user`，此后自动生成不会再覆盖它 */
export async function renameThreadTitle(
  projectPath: string,
  threadId: string,
  rawTitle: string,
): Promise<ThreadTitleRecord> {
  return setThreadTitle(projectPath, threadId, rawTitle, 'user')
}

function buildTitlePrompt(
  prompt: string,
  responseText: string,
): {
  system: string
  user: string
} {
  return {
    system:
      '你是会话标题生成器。根据用户的第一句需求和助手的第一段回答，用中文起一个简短标题。' +
      '要求：不超过 16 个汉字，不用引号、句号、书名号，不加"标题："之类前缀，只输出标题本身。',
    user:
      `用户需求：\n${String(prompt ?? '').slice(0, TITLE_PROMPT_CHARS)}\n\n` +
      `助手回答：\n${String(responseText ?? '').slice(0, TITLE_RESPONSE_CHARS)}\n\n` +
      '请只输出标题。',
  }
}

/**
 * 每轮刷新的提示（第 60 批，措辞与结构对照 DSH `session-title` 的刷新模板）。
 *
 * 三条硬要求，缺一条这个功能就会变成"标题每分钟抖一次"：
 *  1. 不准改：原样返回一个**仍然准确**的标题（模型天然爱润色，必须明说保持原样优先）；
 *  2. 什么不算理由：追问 / 补充细节 / 道谢 / 要求继续 —— 这些是同一件事的延续；
 *  3. 只有话题**实质性改变**才改。
 *
 * 用 JSON 包一层而不是自然语言拼接：消息里可能带换行、引号、甚至看起来像指令的句子，
 * JSON 至少把"哪是数据、哪是要求"划清楚（上游模板也是这么做的）。
 */
function buildRefreshPrompt(
  messages: readonly string[],
  currentTitle: string,
): { system: string; user: string } {
  const system = [
    '你是会话标题生成器。根据用户这次对话里说过的全部需求，更新这个会话的标题，用中文。',
    '要求：不超过 16 个汉字，不用引号、句号、书名号，不加"标题："之类前缀，只输出标题本身。',
    '如果现有标题**仍然准确**地描述了主要话题或任务，就原样返回它，不要改写、换词、润色或缩短。',
    '以下情况不构成改标题的理由：追问、同一话题内的补充细节、道谢（"谢谢"）、要求继续。',
    '只有当对话内容实质性地改变或扩展了主要话题（旧标题已经不准确）时，才改标题。',
  ].join('\n')
  const payload = {
    currentTitle: String(currentTitle ?? ''),
    messages: messages.map(m => String(m ?? '')),
  }
  return {
    system,
    user: '根据下面这个 JSON 对象更新会话标题：\n' + JSON.stringify(payload),
  }
}

/**
 * 一次小请求拿标题正文；失败抛错，由调用方吞掉。
 *
 * **厂商回 tool_calls 时整条作废**（返回空串）：标题请求不该带工具，回了就说明
 * 厂商侧的行为与预期不符，此时"续写正文当标题"会得到一段工具调用 JSON —— 宁可没有标题。
 */
async function generateTitleText(
  config: LlmConfig,
  prompts: { system: string; user: string },
  signal?: AbortSignal,
): Promise<string> {
  let text = ''
  let toolCallsRejected = false
  const timeout = AbortSignal.timeout(TITLE_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  await callLlm(
    config,
    [
      { role: 'system', content: prompts.system },
      { role: 'user', content: prompts.user },
    ],
    [],
    {
      onChunk: chunk => {
        if (chunk.type === 'text') text += chunk.content
      },
      onToolCalls: () => {
        toolCallsRejected = true
      },
      onComplete: full => {
        if (!text && full) text = full
      },
    },
    combined,
  )
  if (toolCallsRejected) {
    logger.warn('[ai] 标题请求返回了工具调用，本次标题作废')
    return ''
  }
  return text
}

/**
 * 线程首轮回答成功后调用：**最多生成一次**标题。
 *
 * 跳过条件（任一即返回 null，调用方无需区分）：
 *   · 配置缺 provider/model/apiKey（不拿用户 key 去试一个注定 401 的请求）；
 *   · 该线程已有落盘标题（provider 或 user 都算 —— 用户改过就绝不允许被覆盖）；
 *   · 生成出来的标题归一后为空。
 *
 * fire-and-forget 契约：本函数自己吞掉生成/落盘错误（只记 warning），永远不 reject。
 */
export async function maybeGenerateThreadTitle(opts: {
  projectPath: string
  threadId: string
  prompt: string
  responseText: string
  config: LlmConfig
  signal?: AbortSignal
}): Promise<ThreadTitleRecord | null> {
  const { projectPath, threadId, prompt, responseText, config, signal } = opts
  if (!config?.provider || !config.model || !config.apiKey) return null
  if (!String(prompt ?? '').trim() || !String(responseText ?? '').trim()) return null
  try {
    const existing = (await readThreadTitles(projectPath))[threadId]
    if (existing) return null
    const raw = await generateTitleText(config, buildTitlePrompt(prompt, responseText), signal)
    const title = normalizeThreadTitle(raw)
    if (!title) return null
    // 落盘前再读一次：生成期间用户可能刚好重命名（以已落盘的为准，绝不对用户操作翻脸）
    return await writeTitleWithFence(projectPath, threadId, {
      title,
      source: 'provider',
      baseRevision: 0,
    })
  } catch (error) {
    logger.warn(
      `[ai] 线程标题生成失败（${threadId}）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/** 在飞的刷新：同一个线程同一时刻只留一个（新的会 abort 旧的） */
const REFRESH_INFLIGHT = new Map<string, { at: number; controller: AbortController }>()
/**
 * 上一次刷新的**发起时间**（跨完成保留）。
 *
 * 为什么要跟 `REFRESH_INFLIGHT` 分开：在飞表在 `finally` 里就清掉了，而"2 秒内别连发"
 * 要管的是**已经完成的**前一次 —— 用户连着回车两次，第一次的请求可能已经回来，
 * 但两次输入只差几百毫秒，这时再发一次得到的还是同一个主题，纯属白烧。
 * 只存时间戳、不存 controller，避免把已完成请求的引用留在这里。
 */
const REFRESH_LAST_AT = new Map<string, number>()

function inflightKey(projectPath: string, threadId: string): string {
  return projectPath + '\u0000' + threadId
}

/** 顺手清掉 1 分钟前的旧记录（线程很多时这张表也不该无限涨） */
function pruneRefreshClock(now: number): void {
  if (REFRESH_LAST_AT.size <= 200) return
  for (const [key, at] of REFRESH_LAST_AT) {
    if (now - at > 60_000) REFRESH_LAST_AT.delete(key)
  }
}

/**
 * 每轮刷新标题（第 60 批，对齐 DSH `session-title` 的 per-turn refresh）。
 *
 * 与首轮生成的分工：首轮手上只有"需求 + 第一段回答"，用它起标题更准；
 * 之后每一轮把**至今为止的用户消息**折叠进去重问一次（用回答反而会把标题带偏到
 * 某次工具细节上）。模型被明确要求"没变就原样返回"，所以大部分轮次是**零改动**。
 *
 * 跳过条件（返回 null，调用方无需区分）：
 *   · 配置缺 provider/model/apiKey；
 *   · 消息为空，或折叠后总字数超过 `REFRESH_INPUT_MAX_CHARS`；
 *   · 该线程已有 `user` 来源标题（手动 pin，永不覆盖）；
 *   · 折叠的消息条数与上次刷新相同（同一个输入不会得到不同结果）；
 *   · 同线程 2 秒内已经发过刷新（放行前一次，丢弃后一次）；
 *   · 模型原样返回了现有标题（一字不差 = 没变）。
 *
 * fire-and-forget 契约与首轮生成一致：吞掉错误，永远不 reject。
 * 被 abort（用户点了停止 / 线程被顶掉）不算失败，只记 info。
 */
export async function maybeRefreshThreadTitle(opts: {
  projectPath: string
  threadId: string
  /** 时间序：这个线程到本轮为止全部用户消息（含本轮要求） */
  messages: readonly string[]
  config: LlmConfig
  signal?: AbortSignal
}): Promise<ThreadTitleRecord | null> {
  const { projectPath, threadId, config, signal } = opts
  if (!config?.provider || !config.model || !config.apiKey) return null
  const messages = opts.messages.map(m => String(m ?? '')).filter(m => m.trim().length > 0)
  if (messages.length === 0) return null
  const totalChars = messages.reduce((sum, m) => sum + m.length, 0)
  if (totalChars > REFRESH_INPUT_MAX_CHARS) {
    logger.info(
      `[ai] 标题刷新跳过（${threadId}）：折叠消息 ${totalChars} 字超过 ${REFRESH_INPUT_MAX_CHARS} 上限`,
    )
    return null
  }

  const key = inflightKey(projectPath, threadId)
  const now = Date.now()
  pruneRefreshClock(now)
  if (now - (REFRESH_LAST_AT.get(key) ?? 0) < REFRESH_MIN_INTERVAL_MS) {
    logger.info(`[ai] 标题刷新跳过（${threadId}）：${REFRESH_MIN_INTERVAL_MS}ms 内已经发过`)
    return null
  }
  REFRESH_LAST_AT.set(key, now)
  const previous = REFRESH_INFLIGHT.get(key)
  previous?.controller.abort()

  const own = new AbortController()
  REFRESH_INFLIGHT.set(key, { at: Date.now(), controller: own })
  try {
    const existing = (await readThreadTitles(projectPath))[threadId]
    if (existing?.source === 'user') return null
    if (existing && existing.inputCount === messages.length) return null
    const baseRevision = existing?.revision ?? 0
    const timeout = AbortSignal.timeout(TITLE_TIMEOUT_MS)
    const combined = signal
      ? AbortSignal.any([signal, own.signal, timeout])
      : AbortSignal.any([own.signal, timeout])
    const raw = await generateTitleText(
      config,
      buildRefreshPrompt(messages, existing?.title ?? ''),
      combined,
    )
    const title = normalizeThreadTitle(raw)
    if (!title) return null
    // 一字不差 = 模型按嘱咐保留了原样：这不是"要写盘的变化"
    if (existing && title === existing.title) return null
    return await writeTitleWithFence(projectPath, threadId, {
      title,
      source: 'provider',
      baseRevision,
      inputCount: messages.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (own.signal.aborted) {
      logger.info(`[ai] 标题刷新被取消（${threadId}）：${message}`)
    } else {
      logger.warn(`[ai] 标题刷新失败（${threadId}）：${message}`)
    }
    return null
  } finally {
    const current = REFRESH_INFLIGHT.get(key)
    if (current?.controller === own) REFRESH_INFLIGHT.delete(key)
  }
}
