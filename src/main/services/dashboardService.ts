import path from 'path'
import fs from 'fs'
import { getDb } from './dataService'
import { getBotStatus } from './botProcess'
import { getTranslatorStatus } from './onebot-translator'
import type { DashboardStatus, TimelineItem, GroupInfo } from '@shared/types/launch'
import { logger } from './logger'

export function getDashboardStatus(projectPath: string): DashboardStatus {
  const botStatus = getBotStatus(projectPath)
  const running = botStatus?.status === 'running'
  const startedAt = botStatus?.startedAt
  const onlineTime = running && startedAt ? Date.now() - new Date(startedAt).getTime() : 0

  // 优先从翻译器获取消息计数（支持官方和 NapCat 两种适配器）
  let messageCount = 0
  const translatorStatus = getTranslatorStatus(undefined, projectPath)
  if (translatorStatus?.running) {
    messageCount = translatorStatus.messageCount ?? 0
  }

  // 回退：尝试从 messages.db 读取（NapCat 适配器路径）
  if (messageCount === 0) {
    const messagesDbPath = path.join(projectPath, 'data', 'logs', 'messages.db')
    if (fs.existsSync(messagesDbPath)) {
      try {
        const db = getDb(messagesDbPath)
        messageCount = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
      } catch { /* 表可能还不存在 */ }
    }
  }

  return { running, onlineTime, messageCount, groupCount: 0, memberCount: 0 }
}

export function getTimeline(projectPath: string): TimelineItem[] {
  // 优先从翻译器获取最近消息事件
  const translatorStatus = getTranslatorStatus(undefined, projectPath)
  if (translatorStatus?.running && translatorStatus.recentEvents?.length) {
    return translatorStatus.recentEvents.map((e, i) => ({
      id: Date.now() - i,
      time: e.time,
      content: e.content,
      type: e.type as 'message' | 'reply' | 'event'
    }))
  }

  // 回退：从 messages.db 读取（NapCat 适配器路径）
  const messagesDbPath = path.join(projectPath, 'data', 'logs', 'messages.db')
  if (!fs.existsSync(messagesDbPath)) return []
  try {
    const db = getDb(messagesDbPath)
    const rows = db.prepare('SELECT rowid as id, * FROM messages ORDER BY rowid DESC LIMIT 20').all() as Record<string, unknown>[]
    return rows.map(r => ({
      id: r.id as number,
      time: (r.time as string) ?? new Date().toLocaleTimeString(),
      content: (r.content as string) ?? JSON.stringify(r),
      type: ((r.type as string) ?? 'message') as 'message' | 'reply' | 'event'
    }))
  } catch (e) {
    logger.warn('[dashboardService] 时间线查询失败:', e)
    return []
  }
}

export function getGroups(projectPath: string): GroupInfo[] {
  const messagesDbPath = path.join(projectPath, 'data', 'logs', 'messages.db')
  if (!fs.existsSync(messagesDbPath)) return []
  try {
    const db = getDb(messagesDbPath)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'").get()
    if (tables) {
      const rows = db.prepare('SELECT * FROM groups').all() as Record<string, unknown>[]
      return rows.map(g => ({
        groupId: String(g.group_id ?? g.id ?? ''),
        groupName: String(g.group_name ?? g.name ?? g.group_id ?? ''),
        memberCount: (g.member_count as number) ?? 0
      }))
    }
    const rows = db.prepare('SELECT DISTINCT group_id FROM messages WHERE group_id IS NOT NULL').all() as Record<string, unknown>[]
    return rows.map(g => ({ groupId: String(g.group_id), groupName: String(g.group_id), memberCount: 0 }))
  } catch (e) {
    logger.warn('[dashboardService] 群组查询失败:', e)
    return []
  }
}
