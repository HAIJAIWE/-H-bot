// src/renderer/src/components/ai/AiSidebar.tsx
//
// **助手侧边条**：窄图标轨 + 点一下滑出内容。
//
// 位置在**对话区的右边**（用户 2026-10-08：「把这个侧边改到右边去，别在左边」）。
//
// ## 为什么列表是**浮层**而不是把对话挤窄
//
// 用户同时要求「对话框架固定一下下限的大小」。而右栏可以拖拽（下限 300px），
// 图标轨占 40px —— 如果列表还参与占位（208px），拖到最窄时对话区只剩几十像素。
// 所以列表做成 **absolute 浮层**：展开时盖在对话上，**一个像素都不抢**对话宽度。
//
// 三个条目：
//   · 新对话 —— 直接新建（不需要展开）
//   · 对话   —— 滑出对话列表（标题 + 条数）
//   · 设置   —— 打开**现有**的 AIProviderConfig 弹窗（不新造设置界面）
//
// ## 曾经有过第四个「可用工具」，**已删**（2026-10-08，用户原话）
//
// 「这个可用工具也不用显示吧？而且我也用不了吧？我也不知道他们叫什么」
// —— 三条全对：**工具是模型调的，用户调不了**；30 个工具名 + 密集描述对用户是纯噪音。
// 它原本是"当年显示错了 8 个数据工具"那个 bug 的遗留物（内容修好了、位置和名字没跟上）。
// 真要给用户看"这台助手能做什么"，该给的是**按域分组的能力清单**，不是裸工具名。
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Download,
  Gauge,
  History,
  MessageSquarePlus,
  Pencil,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useAiStore } from '../../stores/aiStore'
import type { ThreadInfo } from '../../stores/aiStore'
import { useProjectStore } from '../../stores/projectStore'
import { useBotStore } from '../../stores/botStore'
import { AIProviderConfig } from '../settings/AIProviderConfig'
import { ThreadSearchResults } from './ThreadSearchResults'
import { AiContextFlyout } from './AiContextFlyout'
import { RailButton } from './AiRailButton'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

/**
 * 对话列表里的一行（工作区分组下每行都长这样）。
 *
 * 第 56 批给它加了两件事（都要求"用户不用点进来就能判断"）：
 *   · hover 提示里追加规模（N 轮 · 约 X tokens）—— 来自主进程 listThreads 的 stats，这里不算；
 *   · 重命名入口（铅笔 / 双击标题）—— 改的是线程的 **pin 标题**（titleSource 变 user）。
 *
 * 第 57 批再加两个入口（导出 / 删除），三个图标挤在行右端、hover 才出现：
 *   · 204px 的浮层里行本身很窄，常驻三个图标会把标题截到看不清 —— 所以默认隐藏；
 *   · 删除是**不可撤销**的（删的是磁盘上的记忆文件），点一下不能删：先进行内确认态。
 *     不用 `window.confirm`：原生弹窗会抢焦点、在 Electron 里还挡不住误触（ENTER 默认确认）。
 */
export function ThreadRow({
  title,
  tooltip,
  count,
  stats,
  active,
  disabled,
  onClick,
  onRename,
  onExport,
  onDelete,
}: {
  title: string
  /** hover 提示；**不显示在行里**（行里只有标题，条数在右侧，别重复） */
  tooltip?: string
  count: number
  /** 线程规模（turns / estimatedTokens）；没有就只显示基础提示 */
  stats?: ThreadInfo['stats']
  active: boolean
  disabled: boolean
  onClick: () => void
  /**
   * 重命名：给了才出现入口（占位行「当前对话」还没落盘，不提供）。
   * 返回值与 store 的 renameThread 同形 —— 失败原因这里翻成人话。
   */
  onRename?: (next: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * 导出为 Markdown：主进程弹保存框并写盘，成功返回**落盘路径**（界面只提示文件名）。
   * 用户取消走 `error: '用户取消'`（preload 契约值）——那不是错误，这一行静默。
   */
  onExport?: () => Promise<{ ok: true; filePath: string } | { ok: false; error: string }>
  /**
   * 删除这条线程：**行内二次确认之后**才会被调用。
   * 失败原因显示在行下（静默失败会让用户以为已经删了）。
   */
  onDelete?: () => Promise<{ ok: true } | { ok: false; error: string }>
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 导出/删除进行中：与重命名的 busy 分开，否则改名框会被一次导出弄成禁用 */
  const [actionBusy, setActionBusy] = useState(false)
  /** 删除的二次确认：true 时整行换成「确定删除？」+ 确认/取消 */
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /** 成功回执（导出后提示文件名）；失败走 error，成功走这里 */
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 进编辑态时整段选中旧标题：用户多半是"在原名上改"，不是重新打一遍
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  /** 正在流式输出时不许改名 —— 与行本身禁用同一个理由（避免半路换标题造成误解） */
  const canRename = Boolean(onRename) && !disabled

  const startEditing = (): void => {
    if (!canRename) return
    setDraft(title)
    setError(null)
    setEditing(true)
  }

  const cancelEditing = (): void => {
    setEditing(false)
    setError(null)
  }

  /** 导出 / 删除入口与重命名同一口径：流式输出中连图标都不出现 */
  const canExport = Boolean(onExport) && !disabled
  const canDelete = Boolean(onDelete) && !disabled
  const hasActions = canRename || canExport || canDelete

  // 删除确认态开着时 Esc 撤回 —— 与重命名输入框同一个手势。
  // **捕获阶段**拦下：别让 Esc 继续去"停止流式输出"（此刻用户想取消的是删除）。
  useEffect(() => {
    if (!confirmingDelete) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setConfirmingDelete(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [confirmingDelete])

  /**
   * 导出：成功提示文件名，失败分三种。
   * `用户取消` 是用户在保存框里的主动选择，**不是故障** —— 弹红字会像"出事了"；
   * `ipc-missing` 是界面与主进程版本不一致（要重启），跟"写盘失败"不是一回事。
   */
  const runExport = (): void => {
    if (!onExport) return
    void (async () => {
      setError(null)
      setNotice(null)
      setActionBusy(true)
      const res = await onExport()
      setActionBusy(false)
      if (res.ok) {
        // 只提示文件名：完整路径太长，204px 的浮层里会被截成一片
        const file = res.filePath.split(/[\\/]/).filter(Boolean).pop() ?? res.filePath
        setNotice(t('ai.sidebar.exported', { file }))
        return
      }
      if (res.error === '用户取消') return
      setError(
        res.error === 'ipc-missing'
          ? t('ai.sidebar.threadsIpcMissing')
          : t('ai.sidebar.exportFailed', { message: res.error }),
      )
    })()
  }

  /** 二次确认之后才真的删（删的是记忆文件，不可撤销） */
  const confirmDelete = (): void => {
    if (!onDelete) return
    void (async () => {
      setActionBusy(true)
      setError(null)
      setNotice(null)
      const res = await onDelete()
      setActionBusy(false)
      if (res.ok) {
        // 删成功后**不留确认态**：列表刷新会让这一行消失，万一还在也别停在「确定删除？」
        setConfirmingDelete(false)
        return
      }
      // 失败时保留确认态：用户可以再确认一次重试，或点取消退出
      setError(
        res.error === 'ipc-missing'
          ? t('ai.sidebar.threadsIpcMissing')
          : t('ai.sidebar.deleteFailed', { message: res.error }),
      )
    })()
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    void (async () => {
      if (!onRename) return
      // 空标题先在本地挡：主进程归一后也会拒绝，但那一趟 IPC 没有任何价值
      if (!draft.trim()) {
        setError(t('ai.sidebar.renameEmpty'))
        return
      }
      setBusy(true)
      const res = await onRename(draft)
      setBusy(false)
      if (res.ok) {
        setEditing(false)
        setError(null)
        return
      }
      // `ipc-missing` = 界面与主进程版本不一致（要重启），跟"标题不合法"不是一回事
      setError(
        res.error === 'ipc-missing'
          ? t('ai.sidebar.threadsIpcMissing')
          : t('ai.sidebar.renameFailed', { message: res.error }),
      )
    })()
  }

  // 统计只进 hover 提示：行里已经有条数了，再塞一行数字会让 208px 的浮层变成表格
  const fullTooltip = [
    tooltip ?? title,
    stats
      ? t('ai.sidebar.stats', {
          turns: stats.turns,
          tokens: stats.estimatedTokens.toLocaleString(),
        })
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group">
      {confirmingDelete ? (
        // 确认态与编辑态**同一行高度**：换行会让整个列表跳一下
        <div className="flex items-center gap-1 pl-4 pr-2.5 py-1">
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
            {t('ai.sidebar.deleteConfirm')}
          </span>
          <button
            type="button"
            disabled={actionBusy}
            onClick={confirmDelete}
            title={t('ai.sidebar.deleteConfirmAria')}
            aria-label={t('ai.sidebar.deleteConfirmAria')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            title={t('ai.sidebar.deleteCancelAria')}
            aria-label={t('ai.sidebar.deleteCancelAria')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={12} />
          </button>
        </div>
      ) : editing ? (
        // 编辑态与展示态**同一行高度**：换行会让整个列表跳一下
        <form onSubmit={submit} className="flex items-center gap-1 pl-4 pr-2.5 py-1">
          <input
            ref={inputRef}
            value={draft}
            disabled={busy}
            onChange={e => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelEditing()
              }
            }}
            aria-label={t('ai.sidebar.renameAria')}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={busy}
            title={t('ai.sidebar.renameSave')}
            aria-label={t('ai.sidebar.renameSave')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={cancelEditing}
            title={t('ai.sidebar.renameCancel')}
            aria-label={t('ai.sidebar.renameCancel')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={12} />
          </button>
        </form>
      ) : (
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            onDoubleClick={startEditing}
            title={fullTooltip}
            className={`w-full text-left pl-4 pr-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors ${
              active
                ? 'bg-blue-500/10 text-blue-300'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
          >
            <span className="flex-1 truncate">{title}</span>
            {/* 有操作图标时 hover 把条数淡出：否则图标会正好盖在数字上 */}
            <span
              className={`text-zinc-600 tabular-nums ${
                hasActions ? 'transition-opacity group-hover:opacity-0' : ''
              }`}
            >
              {count}
            </span>
          </button>
          {hasActions && (
            // 三个图标**绝对定位盖在条数上**：行本身是 button，按钮里不能再嵌按钮。
            // 从右往左：删除 / 导出 / 重命名（危险操作贴边，离标题最远）
            <>
              {canRename && (
                <button
                  type="button"
                  onClick={startEditing}
                  title={t('ai.sidebar.renameAria')}
                  aria-label={t('ai.sidebar.renameAria')}
                  className="absolute right-11 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-zinc-800/90 text-zinc-400 opacity-0 transition-opacity hover:text-zinc-100 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Pencil size={11} />
                </button>
              )}
              {canExport && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={runExport}
                  title={t('ai.sidebar.exportAria')}
                  aria-label={t('ai.sidebar.exportAria')}
                  className="absolute right-6 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-zinc-800/90 text-zinc-400 opacity-0 transition-opacity hover:text-zinc-100 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                >
                  <Download size={11} />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    // 点垃圾桶只是**进入确认态**，什么都不删
                    setError(null)
                    setNotice(null)
                    setConfirmingDelete(true)
                  }}
                  title={t('ai.sidebar.deleteAria')}
                  aria-label={t('ai.sidebar.deleteAria')}
                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-zinc-800/90 text-zinc-400 opacity-0 transition-opacity hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </>
          )}
        </div>
      )}
      {notice && (
        // 成功回执不是错误：不用 role="alert"，但也要在行下说一声（否则导出成功没反馈）
        <p role="status" className="px-2.5 pb-1 text-[11px] leading-tight text-emerald-500/80">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="px-2.5 pb-1 text-[11px] leading-tight text-amber-500/80">
          {error}
        </p>
      )}
    </div>
  )
}

export function AiSidebar() {
  useLocaleSubscription()
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const threads = useAiStore(s => s.threads)
  const activeThreadId = useAiStore(s => s.activeThreadId)
  const streaming = useAiStore(s => s.streaming)
  const threadsError = useAiStore(s => s.threadsError)
  /** 本轮统计（含上下文明细）—— 与状态栏同一个来源，不另算 */
  const stats = useAiStore(s => s.stats)
  const allThreads = useAiStore(s => s.allThreads)
  const setKnownProjects = useAiStore(s => s.setKnownProjects)
  const setActiveThread = useAiStore(s => s.setActiveThread)
  /** 项目列表（工作区）= 左侧那一栏的项目 */
  const bots = useBotStore(s => s.bots)
  const loadThreads = useAiStore(s => s.loadThreads)
  const newThread = useAiStore(s => s.newThread)
  const switchThread = useAiStore(s => s.switchThread)
  /** 改名：**乐观更新**由 store 做（成功即改内存里的 title），失败原因原样交回这一行 */
  const renameThread = useAiStore(s => s.renameThread)
  /** 删除：记忆文件不可撤销 —— 入口那一行负责二次确认，这里只转发 */
  const deleteThread = useAiStore(s => s.deleteThread)
  /** 正文搜索：命中片段由主进程算好（列表上方那块「正文命中」用它） */
  const searchThreads = useAiStore(s => s.searchThreads)
  /** 滑出面板：对话列表 / 都没开 */
  const [flyout, setFlyout] = useState<'none' | 'threads' | 'context'>('none')
  const [showSettings, setShowSettings] = useState(false)
  /** 🔍 搜索框是否展开（默认收起，不占地方） */
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  /** ⇅ 只看当前项目（对话多了以后，把别的项目收起来） */
  const [onlyCurrent, setOnlyCurrent] = useState(false)

  // 线程列表由**消费它的地方**负责加载
  useEffect(() => {
    if (projectPath) void loadThreads(projectPath)
  }, [projectPath, loadThreads])

  /**
   * 把项目列表喂进 store —— 工作区列表要**遍历所有项目**。
   *
   * 用户的原话：「我的建议抄，没必要一个项目切换」。
   * 所以这里不再只列当前项目：一次把每个项目的对话都拉出来，
   * 点哪条就进哪条（跨项目时自动切过去，见 openThread）。
   */
  useEffect(() => {
    if (bots.length === 0) return
    setKnownProjects(bots.map(b => ({ path: b.projectPath, name: b.name })))
  }, [bots, setKnownProjects])

  /**
   * 一轮对话结束后刷新列表。
   *
   * 不刷新的话：标题（取自第一条用户消息）与条数**永远停在进项目那一刻** ——
   * 刚开的新对话在列表里一直叫「当前对话」，即使它已经有十几条了。
   * 依赖里只有 streaming 与 projectPath，不会自激。
   */
  useEffect(() => {
    if (!streaming && projectPath) void loadThreads(projectPath)
  }, [streaming, projectPath, loadThreads])

  const busy = !projectPath || streaming

  /**
   * 打开一条对话。
   *
   * **跨项目**时：先 setActiveThread，再 selectBot ——
   * 反过来的话，切项目那一下会用**旧的** activeThreadId 去读历史。
   */
  const openThread = (projPath: string, threadId: string) => {
    if (projPath === projectPath) {
      void switchThread(projPath, threadId)
    } else {
      setActiveThread(threadId)
      useBotStore.getState().selectBot(projPath)
    }
    // 选完就收起：浮层挡着对话，留着它反而碍事
    setFlyout('none')
  }

  /**
   * 导出为 Markdown。
   *
   * **没放进 store**：它不是 AI 会话状态，只是一次保存框 + 写盘；store 里也没有这个 action
   * （第 57 批 store 只加了 searchThreads / deleteThread）。守卫写法与 store 内一致：
   * 缺 IPC = `ipc-missing`（界面与主进程版本不一致，要重启）。
   */
  const exportThread = async (
    projPath: string,
    threadId: string,
  ): Promise<{ ok: true; filePath: string } | { ok: false; error: string }> => {
    if (typeof window.qqbat?.ai?.exportThread !== 'function') {
      return { ok: false, error: 'ipc-missing' }
    }
    try {
      const res = await window.qqbat.ai.exportThread(projPath, threadId)
      if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'unknown' }
      return { ok: true, filePath: res.data.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 点一条正文命中：打开那条线程并收起搜索（留着搜索框会挡住刚打开的列表） */
  const openSearchHit = (projPath: string, threadId: string): void => {
    openThread(projPath, threadId)
    setQuery('')
    setSearching(false)
  }

  /** 工作区列表：当前项目排最前，其余按名字排（顺序稳定，不会每次刷新换位） */
  const sortedGroups = [...allThreads].sort((a, b) => {
    if (a.projectPath === projectPath) return -1
    if (b.projectPath === projectPath) return 1
    return a.projectName.localeCompare(b.projectName)
  })

  /**
   * 过滤（🔍 搜索 + ⇅ 只看当前项目）。
   *
   * 搜索**只匹配标题**：标题本来就是第一条消息的摘要，用户记得住的就是它。
   * 搜索时把没有命中的组整组藏掉（否则满屏空标题）；不搜索时保留当前项目的组
   * （它要显示「当前对话」那条占位）。
   */
  const q = query.trim().toLowerCase()
  const groups = sortedGroups
    .filter(g => !onlyCurrent || g.projectPath === projectPath)
    .map(g => ({
      ...g,
      threads: q ? g.threads.filter(th => th.title.toLowerCase().includes(q)) : g.threads,
    }))
    .filter(g => g.threads.length > 0 || (!q && !onlyCurrent && g.projectPath === projectPath))

  return (
    <>
      <aside className="relative shrink-0 self-stretch">
        {/*
          滑出的对话列表 = **浮层**（绝对定位，从图标轨向左展开）。
          它盖住对话区的一部分，但**不改变对话区的宽度** —— 这是"对话区要有下限"的前提。
        */}
        {flyout === 'context' && <AiContextFlyout stats={stats} />}
        {flyout === 'threads' && (
          <div className="absolute right-10 top-0 bottom-0 w-52 z-20 min-h-0 flex flex-col bg-zinc-950 border-l border-zinc-800 shadow-2xl">
            {/*
              表头三个按钮（对齐 DSH 的工作区表头）：搜索 · 只看当前项目 · 新建对话。
              前两个是**列表变长之后才需要**的东西，所以做成按需展开/切换，不常驻占地方。
            */}
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-zinc-800 shrink-0">
              <span className="flex-1 text-xs text-zinc-500 truncate">{t('ai.sidebar.chats')}</span>
              <button
                type="button"
                title={t('ai.sidebar.searchAria')}
                aria-label={t('ai.sidebar.searchAria')}
                aria-pressed={searching}
                onClick={() => {
                  setSearching(v => {
                    if (v) setQuery('')
                    return !v
                  })
                }}
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  searching ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                <Search size={13} />
              </button>
              <button
                type="button"
                title={t('ai.sidebar.onlyCurrent')}
                aria-label={t('ai.sidebar.onlyCurrent')}
                aria-pressed={onlyCurrent}
                onClick={() => setOnlyCurrent(v => !v)}
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  onlyCurrent ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                <SlidersHorizontal size={13} />
              </button>
              <button
                type="button"
                title={t('ai.sidebar.newChat')}
                aria-label={t('ai.sidebar.newChat')}
                disabled={busy}
                onClick={() => {
                  if (!projectPath) return
                  newThread(projectPath)
                  void loadThreads(projectPath)
                  // 留在列表里：用户就是在这一页新建的，收起会显得没反应
                }}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-40"
              >
                <MessageSquarePlus size={13} />
              </button>
            </div>
            {searching && (
              <div className="px-2 py-1.5 border-b border-zinc-800 shrink-0">
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('ai.sidebar.searchPlaceholder')}
                  aria-label={t('ai.sidebar.searchAria')}
                  className="w-full bg-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 outline-none border border-zinc-700 focus:border-blue-500"
                />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto py-1">
              {/*
                正文命中（第 57 批）：放在**标题匹配之上**单独一块。
                标题只取自第一条用户消息 —— 聊到第 20 轮时用户记得的那句话往往不在标题里。
                查询为空时这块不渲染（组件内部对「太短/空」也兜了一层）。
              */}
              {searching && q && projectPath && (
                <ThreadSearchResults
                  projectPath={projectPath}
                  query={query}
                  searchThreads={searchThreads}
                  onOpen={openSearchHit}
                />
              )}
              {/* 工作区分组：一次列出**所有项目**的对话（用户原话：「没必要一个项目切换」） */}
              {/*
                搜索时标题一条都不命中，不该说「还没有对话」—— 对话明明都在，
                只是标题里没有这个词；正文命中区已经在上方交代了结果（或「没有命中」）。
              */}
              {groups.length === 0 && !q ? (
                <p className="px-2.5 py-2 text-xs text-zinc-600">{t('ai.sidebar.empty')}</p>
              ) : (
                groups.map(g => {
                  const isCurrent = g.projectPath === projectPath
                  // 别的项目且一条对话都没有 → 不占地方（当前项目即使空着也要出现）
                  if (!isCurrent && g.threads.length === 0) return null
                  const needsPlaceholder =
                    isCurrent && !g.threads.some(th => th.id === activeThreadId)
                  return (
                    <div key={g.projectPath}>
                      <div className="px-2.5 py-1.5 text-[11px] text-zinc-500 bg-zinc-900/60 border-y border-zinc-800/60">
                        {g.projectName}
                      </div>
                      {needsPlaceholder && (
                        <ThreadRow
                          title={t('ai.sidebar.currentChat')}
                          count={0}
                          active
                          disabled={streaming}
                          onClick={() => openThread(g.projectPath, activeThreadId)}
                        />
                      )}
                      {g.threads.map(th => (
                        <ThreadRow
                          key={th.id}
                          title={th.title}
                          tooltip={t('ai.chat.threadOption', {
                            title: th.title,
                            count: th.messageCount,
                          })}
                          count={th.messageCount}
                          stats={th.stats}
                          active={isCurrent && th.id === activeThreadId}
                          disabled={streaming}
                          onClick={() => openThread(g.projectPath, th.id)}
                          onRename={next => renameThread(g.projectPath, th.id, next)}
                          onExport={() => exportThread(g.projectPath, th.id)}
                          onDelete={() => deleteThread(g.projectPath, th.id)}
                        />
                      ))}
                    </div>
                  )
                })
              )}
              {/*
                读取失败就说出来（这地方静默失败过一次，排查了一个来回）。
                ⚠️ 这段在「工作区分组」那次重构里被我误删过 —— 孤儿键闸门当场抓出来：
                key 在语言包里、源码里却没人用，正好说明「显示失败原因」这段没了。
              */}
              {threadsError && threadsError !== 'no-project' && (
                <p className="px-2.5 py-2 text-[11px] leading-relaxed text-amber-500/80">
                  {threadsError === 'ipc-missing'
                    ? t('ai.sidebar.threadsIpcMissing')
                    : t('ai.sidebar.threadsFailed', { message: threadsError })}
                </p>
              )}
              {/*
                搜索时不提「第一条消息」的事：那说的是**新建的空对话**，
                跟「这个词没搜到」是两件事，摆在一起会让人以为对话丢了。
              */}
              {!threadsError && !searching && !threads.some(th => th.id === activeThreadId) && (
                <p className="px-2.5 py-2 text-[11px] leading-relaxed text-zinc-600">
                  {t('ai.sidebar.firstMessageHint')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 图标轨：贴**右**边缘，常驻 40px */}
        <div className="w-10 h-full flex flex-col items-center gap-0.5 py-2 bg-zinc-900/40 border-l border-zinc-800">
          <RailButton
            icon={MessageSquarePlus}
            label={t('ai.sidebar.newChat')}
            disabledHint={streaming ? t('ai.sidebar.busyHint') : t('ai.sidebar.noProjectHint')}
            disabled={busy}
            onClick={() => {
              if (!projectPath) return
              newThread(projectPath)
              void loadThreads(projectPath)
              /**
               * **把列表打开**（2026-10-08 用户反馈：「我新建对话好像没用」）。
               *
               * 不打开的话，点完 ➕ 界面上唯一的变化是"对话被清空" ——
               * 如果那条对话本来就是空的，就**看起来什么都没发生**。
               * 而"新对话已经建好了"这件事，只有列表里那条置顶的「当前对话」能证明。
               * 新建是个**要有回执**的动作：要么看见它，要么别让人猜。
               */
              setFlyout('threads')
            }}
          />
          <RailButton
            icon={History}
            label={t('ai.sidebar.chats')}
            disabledHint={t('ai.sidebar.noProjectHint')}
            active={flyout === 'threads'}
            disabled={!projectPath}
            onClick={() => setFlyout(f => (f === 'threads' ? 'none' : 'threads'))}
          />
          <RailButton
            icon={Gauge}
            label={t('ai.sidebar.context')}
            active={flyout === 'context'}
            onClick={() => setFlyout(f => (f === 'context' ? 'none' : 'context'))}
          />
          <RailButton
            icon={Settings}
            label={t('ai.sidebar.settings')}
            onClick={() => setShowSettings(true)}
          />
        </div>
      </aside>

      {/* 设置：复用现有的模型配置弹窗，不另造一个 */}
      {showSettings && <AIProviderConfig onClose={() => setShowSettings(false)} />}
    </>
  )
}
