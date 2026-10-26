// src/renderer/src/components/ai/ThreadSearchResults.tsx
//
// 「对话正文搜索」结果区（第 57 批 Phase C，对照 DSH 的会话搜索）。
//
// ## 为什么
//
// 标题只取自**第一条**用户消息：聊到第 20 轮时用户记得的是「上次让它改的那个导出」，
// 而那句话不在标题里 —— 正文搜索补的就是这个缺口。
//
// ## 口径
//
// 命中片段由 `@shared/ai/threadSearch` 算好，这里只画；高亮用 match 原文 + before/after
// 拼回，不自己 indexOf（多语言下不可靠）；每行 title 用 `formatThreadSearchSnippet`。
//
// ## 为什么防抖
//
// 每敲一键就发一趟 IPC（主进程要读所有线程记忆）会拖住磁盘与列表；250ms 后只让最后一下发出。
import { useEffect, useState } from 'react'
import { THREAD_SEARCH_HITS_PER_THREAD, formatThreadSearchSnippet } from '@shared/ai/threadSearch'
import type { ThreadSearchMatch } from '../../stores/aiStore'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

/** 防抖窗口：见文件头注释 */
const SEARCH_DEBOUNCE_MS = 250

/**
 * 少于 2 个字符不搜。
 *
 * 一个字（尤其中文）几乎命中每一条消息 —— 结果等于没筛，还白读一遍所有记忆文件。
 * 主进程不设这个下限（它是通用接口），下限是**界面**的交互口径。
 */
const SEARCH_MIN_CHARS = 2

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; results: ThreadSearchMatch[] }

export interface ThreadSearchResultsProps {
  /** 搜索范围：当前项目（跨项目搜索不在本批范围，列表本身已经按项目分组） */
  projectPath: string
  /** 输入框里的**原始**查询（trim / 长度判断都在这里做，父组件不用预处理） */
  query: string
  /** store 的 searchThreads（从父组件传进来：这一块只负责画和防抖，不持状态） */
  searchThreads: (
    projectPath: string,
    query: string,
  ) => Promise<{ ok: true; results: ThreadSearchMatch[] } | { ok: false; error: string }>
  /** 点一条结果：打开那条线程（由父组件负责切线程 + 收起浮层） */
  onOpen: (projectPath: string, threadId: string) => void
}

export function ThreadSearchResults({
  projectPath,
  query,
  searchThreads,
  onOpen,
}: ThreadSearchResultsProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < SEARCH_MIN_CHARS) {
      // 短查询把上一轮的结果清掉：留着会让用户以为「刚敲的字也命中了」
      setState(prev => (prev.status === 'idle' ? prev : { status: 'idle' }))
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      // 进 loading 放在**防抖窗口结束时**：每敲一个键闪一下「搜索中」像在抽搐
      setState(prev => (prev.status === 'loading' ? prev : { status: 'loading' }))
      void (async () => {
        const res = await searchThreads(projectPath, trimmed)
        // 查询已经变了（或组件已经卸载）：这次结果作废，别覆盖新结果
        if (cancelled) return
        setState(
          res.ok
            ? { status: 'done', results: res.results }
            : { status: 'error', message: res.error },
        )
      })()
    }, SEARCH_DEBOUNCE_MS)
    // cleanup = 新查询清旧计时器 + 卸载清计时器（同一处，不会漏）
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [projectPath, trimmed, searchThreads])

  // 空查询 / 一个字：这块整个不渲染（父组件也会用 q 挡一层，这里再兜一次）
  if (trimmed.length < SEARCH_MIN_CHARS) return null

  const results = state.status === 'done' ? state.results : []

  return (
    <div
      data-testid="thread-search-results"
      className="border-b border-zinc-800/60 bg-zinc-900/30 px-1.5 pb-1"
    >
      {state.status === 'done' && (
        <div className="px-1 py-1 text-[11px] text-zinc-500">
          {t('ai.sidebar.bodySearchTitle', { count: results.length })}
        </div>
      )}
      {state.status === 'loading' && (
        <p className="px-1 pb-1 text-[11px] text-zinc-600">{t('ai.sidebar.bodySearching')}</p>
      )}
      {state.status === 'error' && (
        // 「正文搜索失败」不能静默：用户会以为"没搜到"就是"没聊过"
        <p role="alert" className="px-1 pb-1 text-[11px] leading-tight text-amber-500/80">
          {state.message === 'ipc-missing'
            ? t('ai.sidebar.threadsIpcMissing')
            : t('ai.sidebar.bodySearchFailed', { message: state.message })}
        </p>
      )}
      {state.status === 'done' && results.length === 0 && (
        <p className="px-1 pb-1 text-[11px] text-zinc-600">{t('ai.sidebar.bodySearchEmpty')}</p>
      )}
      {results.map(result => (
        <button
          key={result.id}
          type="button"
          title={result.title}
          onClick={() => onOpen(projectPath, result.id)}
          className="block w-full rounded px-1 py-1 text-left transition-colors hover:bg-zinc-800/60"
        >
          <span className="block truncate text-xs text-zinc-300">{result.title}</span>
          {result.hits.slice(0, THREAD_SEARCH_HITS_PER_THREAD).map((hit, i) => (
            // 片段：before + <mark>match</mark> + after，前后有截断才补省略号（口径同共享函数）。
            // title 用共享函数的**整段**口径：行内只画两行（line-clamp），hover 才能看全文上下文。
            <span
              key={i}
              title={formatThreadSearchSnippet(hit)}
              className="mt-0.5 line-clamp-2 block text-[11px] leading-tight text-zinc-500"
            >
              {hit.moreBefore ? '…' : ''}
              {hit.before}
              <mark className="rounded bg-amber-500/25 px-0.5 text-amber-200">{hit.match}</mark>
              {hit.after}
              {hit.moreAfter ? '…' : ''}
            </span>
          ))}
        </button>
      ))}
    </div>
  )
}
