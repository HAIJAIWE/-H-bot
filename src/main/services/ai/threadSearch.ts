// src/main/services/ai/threadSearch.ts
//
// 第 57 批：**线程正文搜索**的主进程侧。
//
// 为什么必须在主进程：渲染层只加载**当前**线程的消息（`loadHistoryFromDisk`），
// 别的线程正文从来不在内存里；要搜正文只能读盘。
//
// 口径全部来自 `@shared/ai/threadSearch`（归一 / 命中 / 上限 / 片段），
// 这里只做两件 IO 的事：列出线程、逐个读记忆文件。
import { loadHistory } from './historyStore'
import { listThreads, threadFile } from './threads'
import {
  THREAD_SEARCH_MAX_RESULTS,
  matchThreadEntries,
  normalizeThreadSearchQuery,
  type ThreadSearchHit,
} from '@shared/ai/threadSearch'

/** 命中线程的形状 = `listThreads` 那一条 + `hits`（界面拿到就能直接渲染） */
export interface ThreadSearchMatch {
  id: string
  title: string
  titleSource: 'user' | 'provider' | 'fallback'
  messageCount: number
  updatedAt: number
  stats: {
    turns: number
    messages: number
    assistantMessages: number
    chars: number
    estimatedTokens: number
    durationMs: number
  }
  hits: ThreadSearchHit[]
}

export interface ThreadSearchResult {
  /** 归一后的查询（界面回显用；也让"为什么没命中"可解释） */
  query: string
  results: ThreadSearchMatch[]
}

/**
 * 在**一个项目**的线程里搜正文。
 *
 * 顺序沿用 `listThreads` 的"最后活动在前"——不另造打分规则：
 * 用户找的往往是"最近说过的那个"，而"看起来像"的排序无法解释。
 *
 * 为什么先 `listThreads` 再逐个 `loadHistory`：`listThreads` 只回元信息（标题/规模），
 * 命中片段要正文。两次读盘的代价在百 KB 量级，换来的是**不需要第二份"线程列表"口径**
 * （两处各扫一遍目录，早晚会出现"列表里有、搜索里没有"）。
 */
export async function searchProjectThreads(
  projectPath: string,
  query: string,
  limit: number = THREAD_SEARCH_MAX_RESULTS,
): Promise<ThreadSearchResult> {
  const normalized = normalizeThreadSearchQuery(query)
  if (!normalized) return { query: '', results: [] }
  const cap = Math.max(
    1,
    Math.min(Math.floor(limit) || THREAD_SEARCH_MAX_RESULTS, THREAD_SEARCH_MAX_RESULTS),
  )
  const threads = await listThreads(projectPath)
  const results: ThreadSearchMatch[] = []
  for (const thread of threads) {
    if (results.length >= cap) break
    let entries
    try {
      entries = await loadHistory(projectPath, threadFile(projectPath, thread.id))
    } catch {
      // 单个文件读不出来只跳过它：搜索不能因为一条坏记忆整个失败
      continue
    }
    const hits = matchThreadEntries(entries, normalized)
    if (hits.length === 0) continue
    results.push({
      id: thread.id,
      title: thread.title,
      titleSource: thread.titleSource,
      messageCount: thread.messageCount,
      updatedAt: thread.updatedAt,
      stats: thread.stats,
      hits,
    })
  }
  return { query: normalized, results }
}
