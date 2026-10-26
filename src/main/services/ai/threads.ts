// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/threads.ts），只保证语法/行为，类型待补。
import * as require_historyStore from './historyStore'

import { clearHistoryFile, historyFilePath, loadHistory } from './historyStore'
import { readThreadTitles } from './threadTitles'
import { fallbackThreadTitle } from '@shared/ai/threadTitle'
import * as node_path from 'node:path'
import * as node_crypto from 'node:crypto'
import * as node_fs from 'node:fs'
/**
 * 老记忆（`.qqbat/ai-history.jsonl`）的线程 id。
 *
 * **不清不丢**：升级后它作为"最早的那条线程"出现在列表里，用户能点回去看。
 */
var DEFAULT_THREAD_ID = 'default'
function threadsDir(projectPath) {
  return (0, node_path.join)(projectPath, '.qqbat', 'ai-history')
}
/**
 * 线程 id 会被拼进文件名 —— 必须白名单。
 *
 * 与 B 侧 sanitizeKey 同一个思路：`../../etc/passwd` 这种输入只会得到一个无害文件名。
 *
 * 合法 id（`[A-Za-z0-9_-]{1,64}`）**由渲染层生成**（形如 `t-<时间>-<随机>`）——
 * 主进程不产 id，只负责"任何 id 都不会变成越界路径"。
 */
function sanitizeThreadId(threadId) {
  const t = String(threadId ?? '').trim()
  if (/^[A-Za-z0-9_-]{1,64}$/.test(t)) return t
  return `h${(0, node_crypto.createHash)('sha1').update(t).digest('hex').slice(0, 16)}`
}
/** 线程 → 记忆文件路径。`default` 指回老文件（兼容升级前的历史） */
function threadFile(projectPath, threadId) {
  if (!threadId || threadId === 'default') return historyFilePath(projectPath)
  return (0, node_path.join)(threadsDir(projectPath), `${sanitizeThreadId(threadId)}.jsonl`)
}
/** 标题：第一条用户消息的首行，截断；没有用户消息就用时间（老逻辑，fallback 的兜底） */
function titleOf(entries, fallbackAt) {
  const first = entries.find(e => e.role === 'user' && e.content.trim())
  if (!first) return new Date(fallbackAt).toLocaleString()
  const line = first.content.trim().split('\n')[0]?.trim() ?? ''
  return line.length > 28 ? `${line.slice(0, 28)}…` : line
}
/** 第一条有正文的用户消息（给 fallback 标题用；和 titleOf 同一判据） */
function firstUserText(entries) {
  const first = entries.find(e => e.role === 'user' && String(e.content ?? '').trim())
  return first ? String(first.content) : ''
}
/**
 * 整条线程的规模统计（第 56 批）。
 *
 * 口径刻意保守：只算**已经存在**的事实（消息条数、正文字符、时间戳跨度），
 * 不编造 llm/tool 耗时 —— 那需要逐轮墙钟事件，本仓 trace 没有 threadId。
 * 估算 token = ceil(chars / 4)：只用于列表上的量级感，不是计费口径。
 */
function statsOf(entries) {
  let turns = 0
  let assistantMessages = 0
  let chars = 0
  let first = NaN
  let last = NaN
  for (const entry of entries) {
    const content = typeof entry?.content === 'string' ? entry.content : ''
    if (entry?.role === 'user') {
      turns += 1
      chars += content.length
    } else if (entry?.role === 'assistant') {
      assistantMessages += 1
      chars += content.length
    }
    const at = Date.parse(String(entry?.ts ?? ''))
    if (!Number.isNaN(at)) {
      if (Number.isNaN(first) || at < first) first = at
      if (Number.isNaN(last) || at > last) last = at
    }
  }
  return {
    turns,
    messages: entries.length,
    assistantMessages,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    durationMs: Number.isNaN(first) || Number.isNaN(last) ? 0 : Math.max(0, last - first),
  }
}
function infoOf(id, file) {
  try {
    const st = (0, node_fs.statSync)(file)
    if (!st.isFile()) return null
    return {
      id,
      title: '',
      updatedAt: st.mtimeMs,
      messageCount: 0,
    }
  } catch {
    return null
  }
}
/** 读不出条目的线程：形状与正常线程一致，界面不用分支处理 */
function emptyThreadInfo(t) {
  return {
    ...t,
    title: '',
    titleSource: 'fallback',
    stats: statsOf([]),
  }
}
/**
 * 列出该项目的全部任务线程，**按最后活动时间倒序**。
 *
 * 标题优先级（第 56 批）：落盘记录（provider/user，user 优先级别最高）> fallback（首条需求前 8 词）
 * > 时间戳兜底。落盘表读失败/损坏不影响列表 —— 最多退回 fallback。
 *
 * 任何单个文件读不出来（损坏/权限）都只跳过它 —— 列表不能因为一条坏记忆整个消失。
 */
async function listThreads(projectPath) {
  const titles = await readThreadTitles(projectPath).catch(() => ({}))
  const found = []
  const legacy = historyFilePath(projectPath)
  if ((0, node_fs.existsSync)(legacy)) {
    const info = infoOf(DEFAULT_THREAD_ID, legacy)
    if (info) found.push(info)
  }
  const dir = threadsDir(projectPath)
  if ((0, node_fs.existsSync)(dir)) {
    let names = []
    try {
      names = (0, node_fs.readdirSync)(dir).filter(f => f.endsWith('.jsonl'))
    } catch {
      names = []
    }
    for (const name of names) {
      const info = infoOf(name.slice(0, -6), (0, node_path.join)(dir, name))
      if (info) found.push(info)
    }
  }
  const out = []
  for (const t of found)
    try {
      const entries = await loadHistory(projectPath, threadFile(projectPath, t.id))
      const stored = titles[t.id]
      const title =
        (stored && stored.title) ||
        fallbackThreadTitle(firstUserText(entries)) ||
        titleOf(entries, t.updatedAt)
      out.push({
        ...t,
        messageCount: entries.length,
        title,
        titleSource: stored ? stored.source : 'fallback',
        stats: statsOf(entries),
      })
    } catch {
      out.push(emptyThreadInfo(t))
    }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}
/** 忘掉一条线程（清空它的记忆文件；线程本身随之从列表消失） */
async function clearThread(projectPath, threadId) {
  await clearHistoryFile(projectPath, threadFile(projectPath, threadId))
}

export {
  threadsDir,
  sanitizeThreadId,
  threadFile,
  titleOf,
  infoOf,
  listThreads,
  clearThread,
  DEFAULT_THREAD_ID,
}
