// src/main/services/ai/threadTitles.ts
//
// 会话标题的**落盘与生成**（第 56 批，对照 DSH `packages/session/session-title`）。
//
// 上游把标题做成 session 事件流里的投影 + 可插拔 provider；本仓没有事件流，于是降成：
//   · fallback：不落盘，读取列表时由首条用户消息即时推导（纯函数在 shared）；
//   · provider：线程首轮成功后**异步生成一次**，落盘；
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
  return { title, source, updatedAt }
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
  const titles = await readThreadTitles(projectPath)
  const record: ThreadTitleRecord = { title, source, updatedAt: new Date().toISOString() }
  titles[threadId] = record
  await writeThreadTitles(projectPath, titles)
  return record
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

/** 一次小请求拿标题正文；失败抛错，由调用方吞掉 */
async function generateTitle(
  config: LlmConfig,
  prompt: string,
  responseText: string,
  signal?: AbortSignal,
): Promise<string> {
  const { system, user } = buildTitlePrompt(prompt, responseText)
  let text = ''
  const timeout = AbortSignal.timeout(TITLE_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  await callLlm(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    [],
    {
      onChunk: chunk => {
        if (chunk.type === 'text') text += chunk.content
      },
      onToolCalls: () => {
        // 标题请求不带工具；万一厂商回 tool_calls，忽略即可
      },
      onComplete: full => {
        if (!text && full) text = full
      },
    },
    combined,
  )
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
    const raw = await generateTitle(config, prompt, responseText, signal)
    const title = normalizeThreadTitle(raw)
    if (!title) return null
    // 落盘前再读一次：生成期间用户可能刚好重命名（以已落盘的为准，绝不对用户操作翻脸）
    const titles = await readThreadTitles(projectPath)
    if (titles[threadId]) return null
    const record: ThreadTitleRecord = {
      title,
      source: 'provider',
      updatedAt: new Date().toISOString(),
    }
    titles[threadId] = record
    await writeThreadTitles(projectPath, titles)
    return record
  } catch (error) {
    logger.warn(
      `[ai] 线程标题生成失败（${threadId}）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
