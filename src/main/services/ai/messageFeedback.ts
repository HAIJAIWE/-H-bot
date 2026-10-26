// src/main/services/ai/messageFeedback.ts
//
// 消息反馈的落盘与校验（第 58 批，对照 DSH `dsh-message-feedback`）。
//
// 与上游的三处对齐：
//   1. **目标必须是已持久化的 assistant 消息**：上游校验 "assistant/message 事件 + 可追加面"，
//      本仓校验 "这条线程的历史文件里存在这个 id 且 role=assistant"。否则 `target-not-found`
//      —— 界面上的乐观渲染会闪一下再回滚，比默默存一条指向不存在消息的反馈好。
//   2. **内容不变不重写**：同 rating、同分类、同说明再提交一次，只回现有条目（不刷新 updatedAt）。
//      上游连事件都不追加，本仓连文件都不写。
//   3. **撤回是删除**：点掉已选中的那档 = 删掉这条反馈（上游 `feedback/message-delete`）。
//
// 落盘 `infra/fileOps.atomicWrite`（先写临时文件再 rename），所以不进
// `projectWritesViaFileOps` 的直写登记表；坏文件一律容忍成"没有反馈"，
// 绝不因为一份反馈表坏了就让对话打不开。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../infra/fileOps'
import { logger } from '../infra/logger'
import {
  MAX_FEEDBACK_NOTE_CHARS,
  isFeedbackCategory,
  isFeedbackRating,
  normalizeFeedbackNote,
  type FeedbackCategory,
  type FeedbackRating,
  type MessageFeedbackItem,
  type ThreadFeedbackMap,
} from '@shared/ai/messageFeedback'
import { loadHistory } from './historyStore'
import { sanitizeThreadId, threadFile } from './threads'

/** 反馈目录（按线程分文件：一份线程的反馈坏了不影响别的线程） */
const FEEDBACK_DIR = '.qqbat/ai-feedback'
const FEEDBACK_VERSION = 1

/** 单条线程反馈条数上限：超出丢最旧的一条（不因为反馈把文件撑爆） */
const MAX_FEEDBACK_PER_THREAD = 500

interface FeedbackFile {
  version: number
  items: ThreadFeedbackMap
}

export function feedbackPath(projectPath: string, threadId: string): string {
  return join(projectPath, FEEDBACK_DIR, `${sanitizeThreadId(threadId)}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseItem(value: unknown): MessageFeedbackItem | null {
  if (!isRecord(value)) return null
  if (!isFeedbackRating(value.rating)) return null
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : ''
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt
  if (!createdAt) return null
  const category = isFeedbackCategory(value.category) ? value.category : undefined
  const note = typeof value.note === 'string' && value.note.trim() ? value.note : undefined
  return {
    rating: value.rating,
    ...(category ? { category } : {}),
    ...(note ? { note } : {}),
    createdAt,
    updatedAt,
  }
}

/** 读一条线程的反馈表。文件不存在/坏掉/版本不认识 → 空表（绝不抛） */
export async function readThreadFeedback(
  projectPath: string,
  threadId: string,
): Promise<ThreadFeedbackMap> {
  const file = feedbackPath(projectPath, threadId)
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(parsed) || parsed.version !== FEEDBACK_VERSION || !isRecord(parsed.items)) return {}
  const out: ThreadFeedbackMap = {}
  for (const [messageId, value] of Object.entries(parsed.items)) {
    const item = parseItem(value)
    if (item) out[messageId] = item
  }
  return out
}

async function writeThreadFeedback(
  projectPath: string,
  threadId: string,
  items: ThreadFeedbackMap,
): Promise<void> {
  const ids = Object.keys(items)
  // 超上限时按 updatedAt 丢最旧的（反馈是附属信息，宁可丢旧也不能让文件无限长）
  if (ids.length > MAX_FEEDBACK_PER_THREAD) {
    ids
      .sort((a, b) => (items[a]?.updatedAt ?? '').localeCompare(items[b]?.updatedAt ?? ''))
      .slice(0, ids.length - MAX_FEEDBACK_PER_THREAD)
      .forEach(id => {
        delete items[id]
      })
  }
  const payload: FeedbackFile = { version: FEEDBACK_VERSION, items }
  await atomicWrite(feedbackPath(projectPath, threadId), `${JSON.stringify(payload, null, 2)}\n`)
}

/** 历史文件里有没有这条 assistant 消息（反馈只能挂在真实存在的回答上） */
async function hasAssistantMessage(
  projectPath: string,
  threadId: string,
  messageId: string,
): Promise<boolean> {
  const entries = await loadHistory(projectPath, threadFile(projectPath, threadId))
  // historyStore 带 @ts-nocheck，`id` 没进它的返回类型 —— 这里按实际形状窄化一下
  return entries.some(
    entry => entry.role === 'assistant' && (entry as { id?: string }).id === messageId,
  )
}

export class MessageFeedbackError extends Error {
  constructor(
    readonly code: 'target-not-found' | 'note-too-long' | 'invalid-rating' | 'invalid-category',
    message: string,
  ) {
    super(message)
    this.name = 'MessageFeedbackError'
  }
}

/**
 * 写一条反馈（upsert）。
 *
 * `note` 归一后为空即当作"没写"；超过上限直接拒绝而不是悄悄截断 —— 截断会让用户
 * 以为自己写的整段都提交了（上游 `note-too-large` 同为拒绝）。
 */
export async function setMessageFeedback(input: {
  projectPath: string
  threadId: string
  messageId: string
  rating: FeedbackRating
  category?: FeedbackCategory
  note?: string
}): Promise<MessageFeedbackItem> {
  const { projectPath, threadId, messageId, rating } = input
  if (!isFeedbackRating(rating)) {
    throw new MessageFeedbackError('invalid-rating', '反馈只有"有用"和"没用"两种')
  }
  if (input.category !== undefined && !isFeedbackCategory(input.category)) {
    throw new MessageFeedbackError('invalid-category', '未知的反馈分类')
  }
  if (!(await hasAssistantMessage(projectPath, threadId, messageId))) {
    throw new MessageFeedbackError('target-not-found', '找不到这条回答（可能已清空或换过线程）')
  }
  const rawNote = typeof input.note === 'string' ? input.note : ''
  if (rawNote.length > MAX_FEEDBACK_NOTE_CHARS * 4) {
    throw new MessageFeedbackError(
      'note-too-long',
      `补充说明太长（不超过 ${MAX_FEEDBACK_NOTE_CHARS} 字）`,
    )
  }
  const note = normalizeFeedbackNote(rawNote)
  const items = await readThreadFeedback(projectPath, threadId)
  const existing = items[messageId]
  const now = new Date().toISOString()
  const same =
    existing !== undefined &&
    existing.rating === rating &&
    (existing.category ?? '') === (input.category ?? '') &&
    (existing.note ?? '') === note
  if (same) return existing
  const item: MessageFeedbackItem = {
    rating,
    ...(input.category ? { category: input.category } : {}),
    ...(note ? { note } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  items[messageId] = item
  await writeThreadFeedback(projectPath, threadId, items)
  return item
}

/** 撤回一条反馈。返回是否真的删掉了（没有时返回 false，不写盘） */
export async function deleteMessageFeedback(input: {
  projectPath: string
  threadId: string
  messageId: string
}): Promise<boolean> {
  const items = await readThreadFeedback(input.projectPath, input.threadId)
  if (!(input.messageId in items)) return false
  delete items[input.messageId]
  try {
    await writeThreadFeedback(input.projectPath, input.threadId, items)
  } catch (e) {
    logger.warn('[ai/messageFeedback] 撤回反馈写盘失败:', String(e))
    return false
  }
  return true
}

/** 线程清空/删除时连反馈一起清（否则同名线程重建会带上旧反馈） */
export async function clearThreadFeedback(projectPath: string, threadId: string): Promise<void> {
  try {
    await writeThreadFeedback(projectPath, threadId, {})
  } catch (e) {
    logger.warn('[ai/messageFeedback] 清理线程反馈失败:', String(e))
  }
}
