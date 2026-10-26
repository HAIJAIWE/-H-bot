// src/renderer/src/components/ai/ChatPanel.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAgentMode, useAiStore, type AgentStageInfo } from '../../stores/aiStore'
import { useUiStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { ProposalCard } from './ProposalCard'
import { MiniMarkdown } from '../ui/MiniMarkdown'
import { ZoomableImage } from '../ui/ZoomableImage'
import { Button } from '../ui/Button'
import { Modal, ModalFooter } from '../ui/Modal'
import { AI_NOTE_REGENERATE, AI_NOTE_ROLLED_BACK } from '@shared/types/ai'
import type { AiConfig, ChatMessage } from '@shared/types/ai'
import { AIProviderConfig } from '../settings/AIProviderConfig'
import { findLlmPreset } from '@shared/types/llm-presets'
import type { ChatMessageWithTrace, ToolCallRecord } from '../../stores/aiStore'
import { t } from '../../i18n'
import { groupIntoTurns } from '../../lib/ai/turnGrouping'
import { ToolCallCard } from './ToolRows'
import { AiSlot } from '../../lib/ai/uiSlots'
import '../../plugins'
import { listPlugins } from '../../lib/plugins/api'
import { ExternalPluginsSection } from './ExternalPluginsSection'
import { InstalledPluginsList } from './InstalledPluginsList'
import { TurnChangesCard } from './TurnChangesCard'
import { TrajectoryPanel } from './TrajectoryPanel'
import { ChatEmptyState } from './ChatEmptyState'
import type { AgentPresetRow } from '@shared/ai/presetRoster'
import { PresetEditor } from './PresetEditor'
import { PresetImportDialog } from './PresetImportDialog'
import { PresetUndoDialog } from './PresetUndoDialog'
import type { PresetUndoState } from '@shared/ai/presetUndo'
import { InlineEditBox } from './InlineEditBox'
import { StreamingBubble } from './MessageBubble'
import { MessageActions } from './MessageActions'
import { AgentTranscript } from './AgentTranscript'
import { ReasoningRow } from './ReasoningRow'
import { RunningLine } from './RunningLine'
import { TurnProcess } from './TurnProcess'
import { toast } from '../ui/Toast'
import { compactTokens, formatRunStats } from './runStats'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { AI_TURN_NOTE_PREFIX } from '@shared/types/ai'
import { MAX_IMAGES, clipboardImageToDataUrl, imagesFromClipboard } from './clipboardImage'
import { MODE_OF_ROLE } from '@shared/ai/roleDomains'
import { AgentPresetMenu } from './AgentPresetMenu'
import { TurnBoundary } from './TurnBoundary'
import { TurnOutlineLauncher } from './TurnOutlineLauncher'
import { AtReferenceMenu } from './AtReferenceMenu'
import { useAtReference } from '../../hooks/useAtReference'
import { creatorWorkspaceStatus, useFrameworkDevStore } from '../../stores/frameworkDevStore'

/* 角色按钮表在 ./agentModes（渲染层唯一那处枚举）；选择器是 ./AgentPresetMenu（纯组件）——
   这样测「四个角色 + 自定义预设 + 跟随页面都在、点了回调收到哪个」不用把整个 ChatPanel 连 store 一起 mock。 */

/**
 * 「已记住的自动批准」里每一类动作的名字。
 *
 * 刻意写成**完整 key 的查表**而不是拼字符串（`'ai.allowRules.kind.' + kind`）：
 * i18n 闸门只认源码里的字面量 key，拼出来的那句它看不见 —— 于是漏翻也不会红。
 */
const RULE_KIND_KEY: Record<'write' | 'command' | 'tool', string> = {
  write: 'ai.allowRules.kind.write',
  command: 'ai.allowRules.kind.command',
  tool: 'ai.allowRules.kind.tool',
}

/* ── 多智能体阶段进度 ────────────────────────────────── */

/**
 * 侦察 → 规划 → 并行 → 执行 的一行进度。
 *
 * 只显示**已经有事件**的阶段（没跑多智能体就整条不出现），文字全部来自主进程，
 * 渲染层只负责图标与配色（避免 i18n 硬编码）。
 */
function AgentStageStrip() {
  const stages = useAiStore(s => s.agentStages)
  if (!stages.length) return null
  const style = (status: AgentStageInfo['status']) => {
    switch (status) {
      case 'done':
        // 中性：成功是常态，不需要绿色装饰（与 DSH 一致：过程只留一行灰字）
        return { icon: '·', cls: 'border-zinc-700 bg-zinc-800/40 text-zinc-400' }
      case 'fail':
        return { icon: '✕', cls: 'border-red-600/60 bg-red-500/10 text-red-300' }
      case 'skip':
        return { icon: '–', cls: 'border-zinc-700 bg-zinc-800/60 text-zinc-400' }
      default:
        return { icon: '·', cls: 'border-zinc-700 bg-zinc-800/60 text-zinc-300' }
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-[11px]">
      {stages.map((st, i) => {
        const s = style(st.status)
        return (
          <span
            key={st.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${s.cls}`}
          >
            <span className="font-mono">{s.icon}</span>
            <span className="font-medium">{st.label}</span>
            {st.detail ? <span className="opacity-70">{st.detail}</span> : null}
            {typeof st.ms === 'number' ? (
              <span className="opacity-60">{Math.round(st.ms / 100) / 10}s</span>
            ) : null}
            {i < stages.length - 1 ? <span className="opacity-30">›</span> : null}
          </span>
        )
      })}
    </div>
  )
}

/* ── Agent 状态栏 ──────────────────────────────────────── */

function AgentStatusBar() {
  useLocaleSubscription()
  const agentState = useAiStore(s => s.agentState)
  /**
   * 秒表：长任务里没有时间信息，用户就会以为卡死（实测一轮 76 秒）。
   * 计时放在渲染层，主进程不用每秒钟推事件。
   */
  const active = agentState.state === 'thinking' || agentState.state === 'executing'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])

  const { label, color, pulse } = (() => {
    switch (agentState.state) {
      case 'thinking':
        return {
          label: agentState.message || t('ai.status.thinking'),
          color: 'text-zinc-300',
          pulse: true,
        }
      case 'executing':
        return {
          label: agentState.message || t('ai.status.executing'),
          color: 'text-zinc-300',
          pulse: true,
        }
      case 'warning':
        return {
          label: agentState.message || t('ai.status.warning'),
          color: 'text-amber-400',
          pulse: false,
        }
      case 'error':
        return {
          label: agentState.message || t('ai.status.error'),
          color: 'text-red-400',
          pulse: false,
        }
      case 'idle':
      default:
        return { label: t('ai.status.idle'), color: 'text-zinc-500', pulse: false }
    }
  })()

  const dotColor = (() => {
    switch (agentState.state) {
      case 'thinking':
        return 'bg-zinc-300'
      case 'executing':
        return 'bg-zinc-300'
      case 'warning':
        return 'bg-amber-400'
      case 'error':
        return 'bg-red-400'
      default:
        return 'bg-zinc-600'
    }
  })()

  return (
    <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2 text-xs">
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotColor} ${pulse ? 'animate-pulse' : ''}`}
      />
      <span className={`font-medium ${color}`}>
        {label}
        {active && elapsed > 0 ? ` · ${elapsed}s` : ''}
      </span>
    </div>
  )
}

/**
 * **底部状态行**（本轮统计）。
 *
 * 放底部而不是顶部：它是"看状态"的东西，不该跟"AI 正在干什么"抢同一行的注意力。
 *
 * 显示纪律（判据在 `runStats.ts` 的单测里）：轮/步永远真实；tok/s、总量、缓存命中
 * **只有厂商回传了才显示** —— 拿不到就整段不出现，hover 说明是"没回传"而不是 0；
 * 上下文占用是**本地估算**，单独一个图标，绝不与厂商口径的数字混在一串里。
 */
function RunStatsBar() {
  useLocaleSubscription()
  const stats = useAiStore(s => s.stats)
  const view = formatRunStats(stats)
  if (!view) return null

  return (
    <div
      className="px-3 py-1 border-t border-zinc-800 flex items-center gap-3 text-[11px] text-zinc-500 tabular-nums"
      title={view.totalTokens === null ? t('ai.stats.noUsage') : undefined}
    >
      <span>
        ⟳ {t('ai.stats.rounds', { count: view.rounds })}{' '}
        {t('ai.stats.steps', { count: view.steps })}
        {view.tokPerSec !== null ? ` · ${t('ai.stats.tokPerSec', { rate: view.tokPerSec })}` : ''}
      </span>
      {view.totalTokens !== null && (
        <span>
          ⛁ {t('ai.stats.totalTokens', { tokens: compactTokens(view.totalTokens) })}
          {view.cacheHitPercent !== null
            ? ` · ${t('ai.stats.cacheHit', { percent: view.cacheHitPercent })}`
            : ''}
        </span>
      )}
      {view.contextPercent !== null && (
        <span>◔ {t('ai.stats.context', { percent: view.contextPercent })}</span>
      )}
      {/* 本轮换过 provider：给个标记 + hover 看 from → to（别让用户自己猜） */}
      {stats?.fallbackNote && (
        <span className="text-amber-500/90" title={stats.fallbackNote}>
          ⇄ {t('ai.stats.fallback')}
        </span>
      )}
    </div>
  )
}

/* ── 主面板 ────────────────────────────────────────────── */

/** 收掉 details 菜单（点完一项就关，不靠点第二次） */
function closeMenu(el: HTMLElement): void {
  el.closest('details')?.removeAttribute('open')
}

/** 下拉菜单里的一行开关：✓ 表示当前开启 */
function MenuToggle({
  label,
  title,
  on,
  disabled,
  onClick,
}: {
  label: string
  title?: string
  on: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-zinc-800 disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      title={title}
    >
      <span className="w-3 text-center text-zinc-400">{on ? '✓' : ''}</span>
      <span className="text-zinc-300">{label}</span>
    </button>
  )
}

export const ChatPanel = React.memo(function ChatPanel() {
  useLocaleSubscription()
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const messages = useAiStore(s => s.messages)
  const streaming = useAiStore(s => s.streaming)
  const currentChunk = useAiStore(s => s.currentChunk)
  const currentReasoning = useAiStore(s => s.currentReasoning)
  /** 主进程给的当前阶段文案（「执行…」「规划…」等）；没有就不显示，不造文案 */
  const runningLabel = useAiStore(s => s.agentState.message)
  const agentStep = useAiStore(s => s.agentStep)
  const todos = useAiStore(s => s.todos)
  /**
   * 运行中耗时（显示在对话流末尾的「思考中」气泡里）。
   * 主流客户端把「正在跑多久」放在流尾一行，而不是钉在顶部状态条 ——
   * 用户看的是消息，所以提示也该跟着消息走。
   */
  const [runElapsed, setRunElapsed] = useState(0)
  useEffect(() => {
    if (!streaming) {
      setRunElapsed(0)
      return
    }
    const startedAt = Date.now()
    const timer = setInterval(
      () => setRunElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    )
    return () => clearInterval(timer)
  }, [streaming])
  const isBatchMode = useAiStore(s => s.isBatchMode)
  const toolCalls = useAiStore(s => s.toolCalls)
  /** 助手模式：显示当前身份 + 允许用户显式切换（默认跟页面走） */
  const agentModeOverride = useAiStore(s => s.agentModeOverride)
  const setAgentModeOverride = useAiStore(s => s.setAgentModeOverride)
  const centerTab = useUiStore(s => s.centerTab)
  const effectiveAgentMode = resolveAgentMode(centerTab, agentModeOverride)
  const sendMessage = useAiStore(s => s.sendMessage)
  /**
   * 循环是唯一入口（2026-10-20 合并双引擎第 3 步）：有项目就一律走 agent-core，
   * 这里不再有"开/关"——原来那个开关是双引擎时代的历史包袱，DSH 里没有它。
   */
  /** 先计划：这一轮只给只读工具 → 产出一份计划，不写盘 */
  const planFirst = useAiStore(s => s.planFirst)
  const setPlanFirst = useAiStore(s => s.setPlanFirst)
  /** 完全权限：本次会话不再逐个审批（先计划时无意义 —— 只读轮次本来就不审批） */
  const fullAccess = useAiStore(s => s.fullAccess)
  const preset = useAiStore(s => s.preset)
  const setPreset = useAiStore(s => s.setPreset)
  /** 当前线程（第 50 批）：会话锁按线程算，菜单要拿它去问主进程 */
  const activeThreadId = useAiStore(s => s.activeThreadId)
  const syncSessionPreset = useCallback(
    (name: string | null) => {
      if (useAiStore.getState().preset !== name) setPreset(name)
    },
    [setPreset],
  )
  /** 当前预设的元信息（权限模式）：只用于界面提示，主进程仍自己解析 */
  const [presetMeta, setPresetMeta] = useState<AgentPresetRow | null>(null)
  /**
   * 预设自带角色时，把"生效角色"同步过去（2026-10-20 预设化，2026-10-25 合并成一个选择器）：
   * 选了「只读巡检（role: coder）」，界面上却说"搭建者"，两边说的就不是一件事了。
   * 主进程本来就是预设优先，这里只是让界面说实话；预设没写 role 就退回跟随页面。
   * 没选预设时什么都不做 —— 否则手动点的角色会被这条 effect 一直洗回 null。
   */
  useEffect(() => {
    if (!preset) return
    setAgentModeOverride(presetMeta?.role ? MODE_OF_ROLE[presetMeta.role] : null)
  }, [preset, presetMeta, setAgentModeOverride])
  /** 预设编辑器开关 + 保存后让下拉重读文件的计数 */
  const [presetEditorOpen, setPresetEditorOpen] = useState(false)
  const [presetImportOpen, setPresetImportOpen] = useState(false)
  /** 待确认撤销的导入（第 54 批）：菜单只负责把撤销点交出来，确认归单独对话框 */
  const [undoTarget, setUndoTarget] = useState<PresetUndoState | null>(null)
  const [presetEpoch, setPresetEpoch] = useState(0)
  /** 导出预设：写盘在主进程，这里只负责把结果说清楚；用户取消不算错误 */
  const handleExportPresets = useCallback(async (): Promise<void> => {
    if (!projectPath) return
    try {
      const res = await window.qqbat.ai.exportPresets(projectPath)
      if (res.ok) {
        toast.success(
          t('ai.preset.exportResult', {
            n: String(res.data.count),
            filePath: res.data.filePath,
          }),
        )
      } else if (res.error !== '用户取消') {
        toast.error(res.error)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [projectPath])
  const setFullAccess = useAiStore(s => s.setFullAccess)
  /**
   * 「以后别再问」的已记住规则：这些动作现在**不问就直接执行**，
   * 所以必须在这里列出来、能删单条、能清空（撤销口见 services/ai/allowRules.ts）。
   */
  const allowRules = useAiStore(s => s.allowRules)
  const loadAllowRules = useAiStore(s => s.loadAllowRules)
  const removeAllowRule = useAiStore(s => s.removeAllowRule)
  const clearAllowRules = useAiStore(s => s.clearAllowRules)
  const [rulesOpen, setRulesOpen] = useState(false)
  /** 插话：把输入框里的这句话塞进**正在跑**的那一轮（不新开一轮） */
  const steer = useAiStore(s => s.steer)
  /** 上次失败的尝试（进日志、不进模型历史；只在面板上提示一次） */
  const lastAttempt = useAiStore(s => s.lastAttempt)
  const clearLastAttempt = useAiStore(s => s.clearLastAttempt)
  const stopStreaming = useAiStore(s => s.stopStreaming)
  /** 主进程是否真有请求在飞 —— 「停止」按钮该看它（本地 streaming 可能是 false 而主进程还在跑工具） */
  const mainProcessRunning = useAiStore(s => s.mainProcessRunning)
  /** 待批准的工具调用（M1d）：主进程停在这儿等人 */
  const pendingApproval = useAiStore(s => s.pendingApproval)
  const resolvePendingApproval = useAiStore(s => s.resolvePendingApproval)
  /**
   * **创作模式 × 框架工作区**（P1-8）：创作模式用的是框架工作区的权限，
   * 没进去时它写不了任何东西 —— 这里必须**明确引导**，而不是让用户提完要求再看一串失败。
   */
  const fwEnabled = useFrameworkDevStore(s => s.enabled)
  const fwInWorkspace = useFrameworkDevStore(s => s.inWorkspace)
  const creatorStatus = creatorWorkspaceStatus(fwEnabled, fwInWorkspace)
  /**
   * 「先打开框架开发模式」那条路要打开对话框（总闸带警告，不该在输入框里一键开）。
   * ⚠️ 对话框**实例挂在顶栏**（它要用 useToast，散在组件树里会各自要求 ToastProvider）；
   * 这里只翻 store 里的那个标志 —— 见 frameworkDevStore 的 dialogOpen 说明。
   */
  const openFrameworkDevDialog = useFrameworkDevStore(s => s.setDialogOpen)
  /**
   * **本轮改动**（2026-10-15，用户说「这个也实装一下」）：每轮结束后列出改了哪些文件 + 多少行。
   * 数据来自轮次日志（本来就记着「动过哪些文件 + 改之前的内容」），缺的行数是主进程用 LCS 算的。
   */
  const [turnChanges, setTurnChanges] = useState<{
    userMessage: string
    changes: { path: string; kind: string; added: number; removed: number; exact: boolean }[]
    /** 来自轮次投影：工具次数 / 失败数 / 这一轮耗时（毫秒） */
    stats?: { fileCount: number; toolCount: number; failedTools: number; ms: number }
    /** 轨迹视图：这一轮跑过的工具（投影里已有） */
    tools?: Array<{ name: string; ok: boolean; ms: number }>
    /** 轨迹视图：这一轮动过的文件 */
    files?: Array<{ path: string; change: 'created' | 'modified' }>
  } | null>(null)

  /** 视图：对话（消息流）/ 轨迹（这一轮跑了什么：工具、耗时、动过的文件） */
  const [panelView, setPanelView] = useState<'chat' | 'trajectory'>('chat')
  /**
   * 是否贴着底部：用户上翻看历史时不打扰；离开底部才出现"回到最新"。
   * 与自动滚动同一个判据（80px），两处不各写一个阈值。
   */
  const [atBottom, setAtBottom] = useState(true)
  /** 当前 AI 配置（composer 右侧显示真实模型名；点击打开设置） */
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const attachRef = useRef<HTMLInputElement>(null)
  /** 已安装插件（只读清单；树内插件在模块加载时注册） */
  const [pluginsOpen, setPluginsOpen] = useState(false)
  /** 启停后会变，用 tick 触发重算（清单本身很小，直接同步读） */
  /** 插件数量（启停不影响总数；清单内容由 InstalledPluginsList 自己读） */
  const pluginCount = listPlugins().length

  /**
   * **就地编辑**（2026-10-15 用户提的）：点「编辑」在**那条消息原地**弹出编辑框，
   * 而不是把它塞回底部输入框（原做法，用户原话「编辑是在这个文本框里编辑的」）。
   * 保存 = 把改后的内容作为**一条新消息发出去** —— 记忆是追加式的，
   * 原地改历史会与模型记得的对不上（见下面编辑按钮那段注释）。
   */
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  /** 撤回**预览**：点「撤回这一轮」先摊开将要发生什么，确认后才真撤 */
  const [rollbackPreview, setRollbackPreview] = useState<{
    target: string
    turnId: string
    preview: {
      id: string
      userMessage: string
      restore: string[]
      remove: string[]
      data: boolean
    }
  } | null>(null)
  const init = useAiStore(s => s.init)
  const currentProposal = useAiStore(s => s.currentProposal)
  const applyProposal = useAiStore(s => s.applyProposal)
  const rejectProposal = useAiStore(s => s.rejectProposal)

  const [input, setInput] = useState('')
  const [inputCaret, setInputCaret] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atReference = useAtReference({
    value: input,
    caret: inputCaret,
    projectPath,
    onApply: ({ text, caret }) => {
      setInput(text)
      setInputCaret(caret)
      setTimeout(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(caret, caret)
      }, 0)
    },
  })
  /**
   * 这一轮要贴给模型看的图（data URL）。
   *
   * **只在内存里**：发出去之后清空，也不会进记忆（见 ChatMessage.images 的说明）。
   */
  const [images, setImages] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * 回合目录跳转落点的高亮下标（第 56 批）。
   *
   * 抽屉的 open / 当前视口在哪一轮都由 `TurnOutlineLauncher` 自己管；
   * 只有"刚跳到哪条"得留在这里 —— 它要作为 prop 传给消息流（AgentTranscript）。
   * 纯界面态，不进 store：换个窗口打开对话时该从头算。
   */
  const [outlineHighlight, setOutlineHighlight] = useState<number | null>(null)

  // 初始化监听器
  useEffect(() => {
    const cleanup = init()
    return cleanup
  }, [init])

  /**
   * 切换项目时**切换对话记录**（2026-10-01）。
   *
   * 在此之前 store 里只有一份全局 `messages`：切到别的项目，面板还显示上一个项目的对话；
   * 而别的项目正在跑的那轮事件会被直接丢弃。磁盘上的历史本来就按项目分
   * （`.qqbat/ai-history.jsonl`），只有界面这份不是 —— 现在对齐。
   */
  const switchConversation = useAiStore(s => s.switchConversation)
  useEffect(() => {
    if (projectPath) switchConversation(projectPath)
  }, [projectPath, switchConversation])

  /**
   * 再把**磁盘上的历史**读回这份对话（仅当它还是空的）。
   *
   * 内存态那份一重启就没了，而模型记得（记忆写在 `.qqbat/ai-history.jsonl`）——
   * 不读回来的话，界面空着、模型却接着说上一轮的事，用户会以为"历史被吞了"。
   */
  const loadHistoryFromDisk = useAiStore(s => s.loadHistoryFromDisk)
  /** 「清空」= **真的**清掉当前对话的记忆（界面 + 磁盘）；线程列表由 AiSidebar 负责 */
  const clearActiveThread = useAiStore(s => s.clearActiveThread)
  /**
   * **撤回最近一轮** AI 改动（它写过的文件 + 流程）—— 见主进程 `turnJournal.ts`。
   *
   * 为什么需要它：用户原话「他好像不能撤回对话任务」。此前撤销只覆盖 flow.json，
   * AI 写的代码（plugins/ai-xxx/index.js）撤不回来 —— 一轮不再是一个可撤销单元。
   *
   * ⚠️ 撤回后必须**重新打开项目**：主进程还原了 flow.json，但画布内存里还是旧的。
   */
  const [canRollback, setCanRollback] = useState(false)
  /** 刚复制过的那条下标 —— 静默成功 = 用户以为没复制上（真机原话「复制不了」） */
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  /**
   * 复制文本到剪贴板。
   *
   * 不能只用 navigator.clipboard：Electron 里它常常不可用（非安全上下文），
   * 而可选链 + catch 会让失败彻底静默。所以先试现代 API，失败退回 textarea + execCommand，
   * 并且**给出可见反馈**（按钮变「已复制」）。
   */
  const copyText = async (text: string, index: number) => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      ok = false
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopiedIndex(index)
      window.setTimeout(() => setCopiedIndex(cur => (cur === index ? null : cur)), 1500)
    }
  }
  /**
   * **真正执行撤回**（拿到 turnId 之后）。
   *
   * 拆出来是为了「先预览、再确认」：`rollbackLastTurn` 只负责取预览并弹窗，
   * 用户点确认后才走到这里。
   */
  const doRollback = async (target: string, turnId: string) => {
    // 带上当前线程：撤回要把**对话**也退回去（不是只还原文件/流程）
    const res = await window.qqbat?.ai?.rollbackAiTurn?.(
      target,
      turnId,
      useAiStore.getState().activeThreadId,
    )
    /**
     * ⚠️ **失败必须说出来**（P0-2，2026-10-15）。
     * 原来这里是 `if (!res?.ok) return;` —— 点「撤回这一轮」而 IPC 失败时界面**毫无反应**，
     * 用户只能得出「撤回了但没生效」（当天真机抱怨原文）。
     * 现在：弹 toast 说明原因，并且**不装作成功**（canRollback 与画布都不动）。
     */
    if (!res?.ok) {
      toast.error(t('ai.chat.rollbackFailed', { reason: res?.error ?? t('ai.chat.bridgeMissing') }))
      return
    }
    setCanRollback(false)
    /**
     * **把流程快照装回画布**（R3 修复，2026-10-15）。
     *
     * 主进程不再自己写 flow.json —— 它只交回快照；画布与落盘都由渲染层负责（flowStore 是唯一写入者）。
     * 以前这里是 `project.open(target)`（整项目重开）：那条路绕远，而且**主进程写完文件后**
     * 画布的自动保存会把旧图又写回去 —— 用户看到的就是「撤回了但没生效」。
     */
    /**
     * ★ **给用户一条可见反馈**（2026-10-15）：以前撤回完界面什么都不说，
     * 用户不知道撤掉了什么、数据有没有一起回去。
     */
    const meta = res.data?.result
    /**
     * **先把流程装回画布，再报回执**（2026-10-15 用户：『谁家撤回是这样的哈』）。
     *
     * 两个毛病一起修：
     *   ① 原来先报回执、后装快照 → 回执里根本不可能有流程的信息；
     *   ② 回执只数文件，而这一轮真正动的**是流程** → 用户看到「还原了 0 个文件」，
     *      以为撤回啥也没干（真机：删掉的那一个节点没提，玩家数据那句还是噪音）。
     * 现在：流程还原了多少节点、文件几个、数据有没有动，各说各的，没动的不提。
     */
    const snap = meta?.flowSnapshot ?? null
    let flowDelta: { from: number; to: number } | null = null
    let flowFailed = false
    const { useFlowStore } = await import('@renderer/stores/flowStore')
    const nodesBefore = useFlowStore.getState().nodes.length
    if (snap) {
      try {
        const parsed = JSON.parse(snap) as { nodes?: unknown[] }
        useFlowStore.getState().loadGraph(parsed as never, target)
        flowDelta = { from: nodesBefore, to: useFlowStore.getState().nodes.length }
      } catch (e) {
        flowFailed = true
        console.error('[rollback] failed to load flow snapshot back to canvas:', e)
      }
    }
    const fileCount = (meta?.restored?.length ?? 0) + (meta?.removed?.length ?? 0)
    useAiStore.getState().addMessage({
      role: 'system',
      content: t('ai.chat.rolledBack', {
        chat:
          (meta?.droppedMessages ?? 0) > 0
            ? t('ai.chat.rolledBackChat', { n: meta?.droppedMessages ?? 0 })
            : t('ai.chat.rolledBackChatNone'),
        flow: flowFailed
          ? t('ai.chat.rolledBackFlowFailed')
          : flowDelta && flowDelta.from !== flowDelta.to
            ? t('ai.chat.rolledBackFlow', { from: flowDelta.from, to: flowDelta.to })
            : t('ai.chat.rolledBackFlowNone'),
        files:
          fileCount > 0
            ? t('ai.chat.rolledBackFiles', { n: fileCount })
            : t('ai.chat.rolledBackFilesNone'),
        data: meta?.restoredData ? t('ai.chat.rolledBackDataYes') : '',
      }),
    })
    /**
     * ⚠️ **必须告诉模型「这轮被撤回了」**（2026-10-15 补）。
     *
     * 撤回把文件与流程真还原了，但记忆是**追加式**的、上面还留着「已确认并应用」——
     * 不补这条回执，模型下一轮会以为那些东西还在（典型错话：「我已经帮你建好了」，
     * 而磁盘上已经没了）。
     */
    void window.qqbat?.ai?.noteTurn?.(
      target,
      AI_NOTE_ROLLED_BACK,
      useAiStore.getState().activeThreadId,
    )
    void loadHistoryFromDisk(target)
  }

  /**
   * 读「最近一轮改了什么」。流式结束（streaming 由 true→false）后调一次。
   * 取不到就清空卡片 —— 宁可没有，也不显示上一轮的旧数据（那才是骗人）。
   */
  const loadTurnChanges = async (target: string) => {
    try {
      /**
       * 只读**投影**（listAiTurns），不再追加一次 previewAiTurn：
       * 以前两处各算一遍"这一轮改了什么"，迟早口径不一致；投影里已经有
       * 文件 + 行数 + 工具 + 耗时。
       */
      const listed = await window.qqbat?.ai?.listAiTurns?.(target)
      const latest = listed?.ok ? listed.data?.turns?.[0] : undefined
      /**
       * 以前"没有行数变化"就整个丢掉 —— 但**轨迹**要的恰恰是没有行数变化的那一轮
       * （纯查询：只跑了工具、什么都没改）。所以改成：拿得到这一轮就存，
       * 卡片自己按 changes.length 决定显不显示。
       */
      if (!latest) {
        setTurnChanges(null)
        return
      }
      setTurnChanges({
        userMessage: latest.userMessage,
        changes: latest.changes ?? [],
        stats: latest.stats,
        tools: latest.tools,
        files: latest.files,
      })
    } catch {
      setTurnChanges(null)
    }
  }

  /** 每轮结束就刷新一次（streaming 由 true→false）；挂载时也刷一次，能看到上一轮的结果 */
  useEffect(() => {
    if (streaming || !projectPath) return
    void loadTurnChanges(projectPath)
  }, [streaming, projectPath])

  /**
   * **↻ 重新生成**：把上一条 AI 回答对应的**那句用户消息再发一遍**。
   *
   * ⚠️ 我们的记忆是**追加式**的（只加不删），所以这里做不到 ChatGPT 的「截断后重跑」：
   * 模型会在记忆里**看到自己上一次的答案**。因此发之前必须先给它一条回执（AI_NOTE_REGENERATE）
   * 说明「上次作废」—— 否则它多半会回一句「我上面已经答过了」，而不是重做。
   *
   * `index` = 被重新生成的那条助手消息在 messages 里的下标（用来往前找用户那句话）。
   */
  const regenerate = async (index: number) => {
    if (!projectPath) return
    let userText: string | null = null
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        userText = messages[i].content
        break
      }
    }
    if (!userText) return // 前面没有用户消息（比如上一轮被撤了）→ 不猜，什么都不做
    void window.qqbat?.ai?.noteTurn?.(
      projectPath,
      AI_NOTE_REGENERATE,
      useAiStore.getState().activeThreadId,
    )
    await useAiStore.getState().sendMessage(projectPath, userText, undefined, effectiveAgentMode)
  }

  /**
   * **点「撤回这一轮」→ 先出预览**（2026-10-15，用户说「按照这个来」）。
   *
   * 参考的是主流做法（也是用户截图里那种）：**逐文件列出将要发生什么 + 确认按钮**。
   * 撤回是不可逆的破坏性操作，先摊开再动手 —— 用户不必凭记忆猜「会撤销掉什么」。
   */
  const rollbackLastTurn = async (target: string) => {
    const listed = await window.qqbat?.ai?.listAiTurns?.(target)
    const latest = listed?.ok ? listed.data?.turns?.[0] : undefined
    if (!latest) return
    const res = await window.qqbat?.ai?.previewAiTurn?.(target, latest.id)
    const preview = res?.ok ? res.data?.preview : undefined
    if (!preview) {
      // 取不到预览（轮次文件缺失等）→ 不猜，直接告诉用户为什么撤不了
      useAiStore.getState().addMessage({ role: 'system', content: t('ai.chat.rollbackNoPreview') })
      return
    }
    setRollbackPreview({ target, turnId: latest.id, preview })
  }

  /** 预览里点「确认撤回」→ 真的撤 */
  const confirmRollback = async () => {
    const pending = rollbackPreview
    setRollbackPreview(null)
    if (!pending) return
    await doRollback(pending.target, pending.turnId)
  }
  useEffect(() => {
    let alive = true
    if (!projectPath || mainProcessRunning) {
      setCanRollback(false)
      return
    }
    // ⚠️ 桥方法可能不存在（测试环境 / 老版本 preload）—— 用可选链，别把整个面板炸掉
    void Promise.resolve(window.qqbat?.ai?.listAiTurns?.(projectPath))
      .then(r => {
        if (alive) setCanRollback(Boolean(r?.ok && (r.data?.turns?.length ?? 0) > 0))
      })
      .catch(() => {
        if (alive) setCanRollback(false)
      })
    return () => {
      alive = false
    }
    // ⚠️ 依赖 mainProcessRunning，不是 messages.length：
    // 消息落地时主进程的 endTurn 还没跑完（轮次日志还没写），那时查是**空的** ——
    // 之前就是这么写的，于是按钮永远不亮（真机 2026-10-10 报「撤回不了」）。
    // 正确信号是「这一轮真的结束了」＝ 主进程不再有请求在飞。
  }, [projectPath, mainProcessRunning])
  useEffect(() => {
    if (projectPath) void loadHistoryFromDisk(projectPath)
  }, [projectPath, loadHistoryFromDisk])
  // 「以后别再问」的规则是**按项目**存的 —— 切项目要重新读，否则会显示上一个项目的
  useEffect(() => {
    if (projectPath) void loadAllowRules(projectPath)
  }, [projectPath, loadAllowRules])
  /** 读 AI 配置：composer 的模型名是真实信息（不是装饰），配置改了要刷新 */
  const reloadAiConfig = useCallback((): void => {
    // 测试/老主进程可能没有这个通道：有才读，没有就当"未配置"（不抛、不挂面板）
    const getConfig = window.qqbat?.ai?.getConfig
    if (typeof getConfig !== 'function') return
    void Promise.resolve(getConfig(projectPath))
      .then(res => {
        if (res.ok) setAiConfig(res.data ?? null)
      })
      .catch(() => setAiConfig(null))
  }, [projectPath])
  useEffect(() => {
    reloadAiConfig()
  }, [reloadAiConfig, settingsOpen])
  // 用户点了「以后别再问」之后（pendingApproval 收掉）规则表会变，这里跟着刷新
  useEffect(() => {
    if (projectPath && !pendingApproval) void loadAllowRules(projectPath)
  }, [projectPath, pendingApproval, loadAllowRules])

  // 自动滚动到底部：新消息强制滚动；流式 chunk/工具调用更新时仅当用户接近底部才跟随，
  // 避免用户上滑查看历史时被强制拉回底部。
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const isNewMessage = messages.length > prevMsgCountRef.current
    prevMsgCountRef.current = messages.length
    if (isNewMessage) {
      el.scrollTop = el.scrollHeight
      setAtBottom(true)
      return
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom <= 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, currentChunk, currentReasoning, toolCalls])

  /**
   * 粘贴图片（2026-10-09 用户：「输入框不能粘贴图片，我没办法给他看是怎么回事」）。
   *
   * 只处理**图片**：纯文本粘贴照旧走浏览器默认行为，不拦。
   */
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imagesFromClipboard(e.clipboardData)
    if (files.length === 0) return
    e.preventDefault()
    for (const file of files) {
      const url = await clipboardImageToDataUrl(file)
      if (!url) continue
      setImages(prev => (prev.length >= MAX_IMAGES ? prev : [...prev, url]))
    }
  }

  /** 附件按钮：选图片，走与粘贴同一条压缩/上限逻辑 */
  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // 同一个文件再选一次也要触发 change
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const url = await clipboardImageToDataUrl(file)
      if (!url) continue
      setImages(prev => (prev.length >= MAX_IMAGES ? prev : [...prev, url]))
    }
  }

  /**
   * **插话**（2026-10-18）：主进程正在跑时，这句话被塞进**当前这一轮**的下一个步边界，
   * 不新开一轮。没在跑（主进程拒绝）就给 toast —— 不能静默吞掉用户打的字。
   */
  const handleSteer = async (target: 'step' | 'turn') => {
    const msg = input.trim()
    if (!msg || !projectPath) return
    setInput('')
    const queued = await steer(projectPath, msg, target)
    if (queued) {
      // 用户那条消息先落在当前对话里（主进程那边稍后才会真正处理它）
      useAiStore.getState().addMessage({ role: 'user', content: msg })
      if (target === 'turn') toast.success(t('ai.chat.queued'))
    } else toast.error(t('ai.chat.steerFailed'))
  }

  const handleSend = async (text?: string) => {
    const msg = text ?? input.trim()
    // **不要求「必须先有项目」**：没有项目时就是「开荒模式」——
    // 用户第一次打开客户端最想说的就是「帮我做个 XX 机器人」，那时一个项目都没有。
    // **也不要求必须有文字**：只贴一张图直接发是常见用法（「你看这是怎么回事」）。
    if (!msg && images.length === 0) return
    const outgoing = images
    setInput('')
    setImages([])
    await sendMessage(projectPath ?? '', msg, outgoing, effectiveAgentMode)
  }

  /**
   * 创作模式的引导按钮（P1-8 要求④）：**复用 `FrameworkDevDialog` 里那套入口逻辑**
   * （同一条 `enterWorkspace()` 动作），不另写一套"进工作区"。
   *
   * 两种状态两个动作：
   *   · 框架开发模式没开 → 打开对话框（总闸必须带着警告开，不该在输入框里一键开）
   *   · 开了但没进工作区 → 直接进（这正是 `FrameworkDevDialog` 里那个按钮做的事）
   */
  const handleCreatorWorkspaceAction = async () => {
    if (creatorStatus === 'need-enable') {
      openFrameworkDevDialog(true)
      return
    }
    const { enterWorkspace, refresh } = useFrameworkDevStore.getState()
    const entered = await enterWorkspace()
    await refresh()
    if (entered) toast.success(t('ai.creator.entered'))
    else toast.error(t('ai.creator.enterFailed'))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (atReference.onKeyDown(e)) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (streaming) {
        // 流式中：仅停止流式（保留已生成内容为消息），不清空整个对话历史
        stopStreaming()
      } else {
        setInput('')
      }
    }
  }

  const isEmpty = messages.length === 0 && !streaming
  /**
   * 按轮切分（纯函数在 lib/ai/turnGrouping.ts），再算"每条消息落在第几轮" ——
   * 渲染时每条消息都要查一次，先算好，别在 map 里反复 findIndex。
   */
  const turns = useMemo(() => groupIntoTurns(messages), [messages])

  return (
    // ⚠️ `min-h-0` 不能省：flex 子项默认 `min-height:auto`（= 内容高度），
    // 于是消息区**撑到内容那么高**而不是变成滚动容器 —— 表现就是"历史多了翻不动"
    // （外层 overflow-hidden 把超出的部分裁掉，滚动条永远不出现）。2026-10-06 用户反馈。
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Agent 状态栏 */}
      <AgentStatusBar />
      {/* 多智能体阶段进度（侦察 → 规划 → 并行 → 执行）；没跑就整条不出现 */}
      <AgentStageStrip />

      {/**
       * ── 会话头（2026-10-18，朝 DSH 的会话视图靠的第一块）──────────────────
       * DSH 的会话页顶上是"会话标题 + 在场智能体 + 运行中"；我们这边先给
       * 项目名 + 消息/轮次计数 + 运行指示。都是已有数据，不新增采集。
       */}
      {/* 窄右栏（180px）下「消息数 + 界面插件」两个 shrink-0 小字会把项目名挤成 0 宽 →
          允许换行，项目名 flex-1 占第一行，小字不够宽就落到第二行（信息都在，只有行数变多）。 */}
      <div className="mx-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-zinc-800 pb-1.5 text-xs">
        <span
          className="min-w-16 flex-1 truncate font-medium text-zinc-200"
          title={projectPath ?? ''}
        >
          {projectPath
            ? (projectPath.split(/[\\/]/).filter(Boolean).pop() ?? '')
            : t('ai.chat.session')}
        </span>
        {/* 计数 / 运行指示 / 插件数归成一组：窄栏放不下时整组落到第二行，而不是让某一个小字
            单独掉下去（实测 869 档右栏内容宽 210，三者加起来 215 就会把插件数挤成孤儿行）。 */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="shrink-0 text-zinc-500">
            {t('ai.chat.sessionMeta', { n: String(messages.length), t: String(turns.length) })}
          </span>
          {agentStep && (streaming || mainProcessRunning) && (
            <span className="shrink-0 text-sky-300" title={t('ai.chat.sessionStepTitle')}>
              {t('ai.chat.sessionStep', {
                step: String(agentStep.step),
                max: String(agentStep.maxSteps),
              })}
            </span>
          )}
          {(streaming || mainProcessRunning) && (
            <span className="flex shrink-0 items-center gap-1 text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t('ai.chat.sessionRunning')}
            </span>
          )}
          {/**
           * **已安装插件**（对齐 DSH 的「内置插件」页，v0 = 只读清单）：
           * 数据来自 listPlugins()，展示清单与**声明的能力** —— 先让"装了什么、它能干什么"可见，
           * 不需要信任机制（现在只有树内插件，没有外部来源）。
           */}
          <button
            type="button"
            // 极窄右栏（<220px）下这一串会被挤成独占一行，先让位给项目名/消息数（插件清单的设置页仍有入口）
            className="hidden shrink-0 text-zinc-500 hover:text-zinc-300 @min-[220px]:inline"
            onClick={() => setPluginsOpen(true)}
            title={t('ai.chat.pluginsTitle')}
          >
            {t('ai.chat.plugins', { n: String(pluginCount) })}
          </button>
        </div>
      </div>

      <Modal
        open={pluginsOpen}
        onClose={() => setPluginsOpen(false)}
        title={t('ai.chat.pluginsTitle')}
      >
        <div className="space-y-2 text-xs">
          <InstalledPluginsList />
          <ExternalPluginsSection />
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" onClick={() => setPluginsOpen(false)}>
            {t('ai.chat.pluginsClose')}
          </Button>
        </div>
      </Modal>

      {/* 消息列表 */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-auto p-3 space-y-1"
        onScroll={e => {
          const el = e.currentTarget
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= 80)
        }}
      >
        {isEmpty && <ChatEmptyState mode={effectiveAgentMode} onAction={handleSend} />}

        {/*
         * 每条消息下面挂一排小操作（用户 2026-10-10 对着 ChatGPT 的样式提的）。
         * 目前落地两个真实动作：**复制** 与 **撤回这一轮**（后者复用 turnJournal，见本文件 rollbackLastTurn）。
         * 「删除单条消息」「转发出分支」暂不做 —— 对话记忆是**追加式的磁盘文件**（.qqbat/ai-history.jsonl），
         * 单独删中间一条会让界面与模型记得的东西对不上（比不提供更糟）。
         */}
        {/**
         * 视图切换（2026-10-18）：**轨迹** = 这一轮跑了什么。
         * 数据全部来自轮次投影（工具/耗时/动过的文件），不新增采集。
         */}
        <div className="mx-3 mb-1 flex gap-1 text-xs">
          {(['chat', 'trajectory'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setPanelView(v)}
              aria-pressed={panelView === v}
              className={
                panelView === v
                  ? 'rounded bg-zinc-700/70 px-2 py-1 text-zinc-100'
                  : 'rounded px-2 py-1 text-zinc-500 hover:text-zinc-300'
              }
            >
              {v === 'chat' ? t('ai.chat.tabChat') : t('ai.chat.tabTrajectory')}
            </button>
          ))}
        </div>

        {panelView === 'trajectory' && <TrajectoryPanel turnChanges={turnChanges} />}

        {panelView === 'chat' && (
          <>
            <AgentTranscript
              messages={messages}
              turns={turns}
              editingIndex={editingIndex}
              setEditingIndex={setEditingIndex}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              streaming={streaming}
              copiedIndex={copiedIndex}
              copyText={copyText}
              regenerate={regenerate}
              projectPath={projectPath}
              canRollback={canRollback}
              rollbackLastTurn={rollbackLastTurn}
              highlightIndex={outlineHighlight}
            />
            {/* 本轮改动卡：**在消息流末尾**（按时间顺序），不再钉在列表上方 */}
            <TurnChangesCard turnChanges={turnChanges} />
          </>
        )}
        {/* AI 提案卡片：等待用户确认是否应用 */}
        {currentProposal && (
          <ProposalCard
            key={currentProposal.id}
            proposal={currentProposal}
            onApply={ops => {
              void applyProposal(ops)
            }}
            onReject={() => {
              rejectProposal()
            }}
          />
        )}

        {/*
          正在跑的这一轮（2026-10-25 按 DSH 重排）：过程在前、正文在后、运行行收尾。
          过程来自 store 的瞬态字段（历史轮的同一份内容在消息的 reasoning / trace 里）。
        */}
        {streaming && (
          <>
            {(currentReasoning || toolCalls.length > 0) && (
              <TurnProcess running defaultOpen tools={toolCalls.length}>
                {currentReasoning && <ReasoningRow text={currentReasoning} running defaultOpen />}
                {toolCalls.map(tc => (
                  <ToolCallCard key={tc.id} call={tc} />
                ))}
              </TurnProcess>
            )}
            {currentChunk && <StreamingBubble text={currentChunk} />}
            <RunningLine elapsed={runElapsed} {...(runningLabel ? { label: runningLabel } : {})} />
          </>
        )}
      </div>

      {/* Batch 状态指示 */}
      {isBatchMode && (
        <div className="px-3 py-1 bg-yellow-900/40 border-t border-yellow-700/50">
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span>{t('ai.chat.batchMode')}</span>
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-zinc-800 p-3">
        {/*
          助手模式（2026-10-10）：**显示当前身份 + 一键切换**。
          默认跟当前页面走（低代码页=流程助手、代码页=代码助手）——那是产品事实；
          这里的按钮是给用户的**显式出口**（不想切页面又要它改代码时用）。
        */}
        {/*
          创作模式的前置条件提示（P1-8 要求④）：**没进框架工作区就写不了任何东西**。
          必须在输入框上方**一直显示**（不是一次性 toast）—— 用户随时可能忘了自己在哪个模式。
        */}
        {effectiveAgentMode === 'creator' && creatorStatus !== 'ready' && (
          <div className="mb-2 rounded border border-amber-600 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
            <div className="flex items-start gap-2">
              <span aria-hidden="true">⚠️</span>
              <div className="flex-1 space-y-1">
                <p className="font-semibold">{t('ai.creator.title')}</p>
                <p>
                  {creatorStatus === 'need-enable'
                    ? t('ai.creator.needEnable')
                    : t('ai.creator.needEnter')}
                </p>
                <button
                  type="button"
                  onClick={() => void handleCreatorWorkspaceAction()}
                  className="rounded border border-amber-500 bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-100 hover:bg-amber-500/30"
                >
                  {creatorStatus === 'need-enable'
                    ? t('ai.creator.openFrameworkMode')
                    : t('ai.creator.enterWorkspace')}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 角色 + 预设合成一个菜单（2026-10-25）：同一件事不再在两处选、也不再多一条"跟页面" */}
        <div className="flex items-center gap-1.5 mb-2 text-[11px]">
          <AgentPresetMenu
            projectPath={projectPath}
            override={agentModeOverride}
            preset={preset}
            threadId={activeThreadId}
            onSessionPreset={syncSessionPreset}
            onResolve={setPresetMeta}
            reloadKey={presetEpoch}
            disabled={streaming}
            onPickPage={() => {
              setAgentModeOverride(null)
              setPreset(null)
            }}
            onPickRole={m => {
              setAgentModeOverride(m)
              // 选角色 = 回到"只有角色"的权限边界，别让上一份收窄的预设继续压着它
              setPreset(null)
            }}
            onPickPreset={name => setPreset(name)}
            onEditPresets={() => setPresetEditorOpen(true)}
            onExportPresets={() => void handleExportPresets()}
            onImportPresets={() => setPresetImportOpen(true)}
            onUndoPresetImport={setUndoTarget}
          />
        </div>
        {/* 本轮边界：主进程真正生效的那几件事（收窄/审批/先计划）——默认态自己不渲染。
            角色不写在这里：上面那个选择器已经说了，重复一遍等于说两遍。 */}
        <TurnBoundary
          toolCount={presetMeta?.allowedTools?.length ?? null}
          pluginCount={presetMeta?.plugins?.length ?? null}
          approval={
            fullAccess ? 'full' : presetMeta?.permissionMode === 'full' ? 'full-preset' : 'ask'
          }
          planFirst={planFirst}
        />
        {/* 待发送的图：贴进来先看得见，能逐张撤掉 */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {images.map((src, i) => (
              <div key={i} className="relative group">
                <ZoomableImage
                  src={src}
                  className="h-14 rounded border border-zinc-700 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                  title={t('ai.chat.removeImage')}
                  aria-label={t('ai.chat.removeImage')}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-700 text-zinc-200 text-[10px] leading-none flex items-center justify-center hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/* 会话预设编辑：文件是唯一真源，保存后让下拉重读 */}
        <PresetEditor
          open={presetEditorOpen}
          projectPath={projectPath}
          onClose={() => setPresetEditorOpen(false)}
          onSaved={() => setPresetEpoch(n => n + 1)}
        />
        {/* 导入走两段式：选文件只出预览，确认才写盘（内置/同名都在主进程再拦一次） */}
        <PresetImportDialog
          open={presetImportOpen}
          projectPath={projectPath}
          onClose={() => setPresetImportOpen(false)}
          onImported={result => {
            setPresetEpoch(n => n + 1)
            if (result.unchanged) toast.info(t('ai.preset.importUnchanged'))
            else if (result.undoProblem)
              toast.warning(t('ai.preset.undoUnavailable', { reason: result.undoProblem }))
            else toast.success(t('ai.preset.importResult', { n: String(result.total) }))
          }}
        />
        {/* 撤销上次导入：撤销点已经由主进程记下，这里只确认「恢复到导入前」 */}
        <PresetUndoDialog
          open={undoTarget !== null}
          projectPath={projectPath}
          undo={undoTarget}
          onClose={() => setUndoTarget(null)}
          onUndone={() => {
            setUndoTarget(null)
            setPresetEpoch(n => n + 1)
            toast.success(t('ai.preset.undoDone'))
          }}
        />

        {settingsOpen && (
          <AIProviderConfig
            onClose={() => setSettingsOpen(false)}
            onSaved={() => setSettingsOpen(false)}
          />
        )}

        {/* 撤回预览：先摊开「将要发生什么」，确认后才动手（照主流做法） */}
        <Modal
          open={rollbackPreview !== null}
          onClose={() => setRollbackPreview(null)}
          title={t('ai.chat.rollbackPreviewTitle')}
          width="520px"
          footer={
            <ModalFooter
              onCancel={() => setRollbackPreview(null)}
              onConfirm={() => void confirmRollback()}
              cancelText={t('launch.common.cancel')}
              confirmText={t('ai.chat.rollbackConfirm')}
              confirmVariant="danger"
            />
          }
        >
          {rollbackPreview && (
            <div className="space-y-2 text-sm text-zinc-300">
              <p className="text-xs text-zinc-500">{rollbackPreview.preview.userMessage}</p>
              <div className="flex gap-4 text-xs">
                <span className="text-emerald-400">
                  ↩{' '}
                  {t('ai.chat.rollbackRestore', {
                    n: String(rollbackPreview.preview.restore.length),
                  })}
                </span>
                <span className="text-rose-400">
                  ✕{' '}
                  {t('ai.chat.rollbackRemove', {
                    n: String(rollbackPreview.preview.remove.length),
                  })}
                </span>
              </div>
              {rollbackPreview.preview.restore.length + rollbackPreview.preview.remove.length >
                0 && (
                <pre className="max-h-40 overflow-auto rounded bg-zinc-900/70 p-2 text-[11px] text-zinc-400">
                  {[...rollbackPreview.preview.restore, ...rollbackPreview.preview.remove].join(
                    '\n',
                  )}
                </pre>
              )}
              <p className="text-xs text-amber-300/90">
                {rollbackPreview.preview.data
                  ? t('ai.chat.rollbackPreviewDataYes')
                  : t('ai.chat.rollbackPreviewDataNo')}
              </p>
            </div>
          )}
        </Modal>

        {/**
         * **已记住的自动批准**（2026-10-18）：这些动作现在不问就直接执行。
         *
         * 没有这一块，用户点过一次「以后别再问」之后就再也看不见它 ——
         * 那正是本仓库反对的"默认开着却改不了的层"。列出来 + 能删单条 + 能清空。
         */}
        {allowRules.length > 0 && (
          <div className="allow-rules mb-2 rounded border border-zinc-700/60 bg-zinc-900/40 px-2 py-1.5 text-[11px] text-zinc-400">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left hover:text-zinc-200"
              onClick={() => setRulesOpen(v => !v)}
              aria-expanded={rulesOpen}
            >
              <span>{rulesOpen ? '▾' : '▸'}</span>
              <span>{t('ai.allowRules.title', { n: String(allowRules.length) })}</span>
            </button>
            {rulesOpen && (
              <ul className="mt-1 space-y-1">
                {allowRules.map(r => (
                  <li key={r.kind + ':' + r.match} className="flex items-center gap-2">
                    <span className="shrink-0 text-zinc-500">{t(RULE_KIND_KEY[r.kind])}</span>
                    <span className="truncate" title={r.match}>
                      {r.match}
                    </span>
                    <button
                      type="button"
                      className="ml-auto shrink-0 text-rose-400/80 hover:text-rose-300"
                      onClick={() => void removeAllowRule(r.kind, r.match)}
                      aria-label={t('ai.allowRules.remove')}
                    >
                      {t('ai.allowRules.remove')}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="text-amber-300/90 hover:text-amber-200"
                    onClick={() => void clearAllowRules()}
                  >
                    {t('ai.allowRules.clear')}
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}

        {/* 工具批准条（M1d）：主进程**真的停下来**等这里的决定 */}
        {pendingApproval && (
          <div className="approval-bar mb-2 rounded border border-amber-700/60 bg-amber-950/25 p-2">
            <div className="flex items-center gap-2 text-xs text-amber-200">
              <span>⏸</span>
              <span className="font-medium">
                {t('ai.approval.title', { tool: pendingApproval.toolName })}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-amber-300/90">{pendingApproval.hint}</p>
            {/* 完整参数：以前卡片只显示前 2 个、每个截 30 字，用户根本看不清要执行什么 */}
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-zinc-900/70 p-2 text-[11px] text-zinc-300">
              {JSON.stringify(pendingApproval.args, null, 2)}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void resolvePendingApproval('allow')}
              >
                {t('ai.approval.allow')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void resolvePendingApproval('always')}
              >
                {t('ai.approval.always')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void resolvePendingApproval('deny')}
              >
                {t('ai.approval.deny')}
              </Button>
            </div>
          </div>
        )}

        {/**
         * **上次没做完**（来自记忆日志的 attempt 行）：重启/重开面板后告诉用户为什么。
         * 不当对话气泡 —— 它不是谁说的话。
         */}
        {lastAttempt && lastAttempt.projectPath === projectPath && (
          <div className="mb-2 flex items-start gap-2 rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-300">
            <span className="shrink-0">⚠</span>
            <span className="min-w-0 flex-1 break-words">
              {lastAttempt.reason === 'cancelled'
                ? t('ai.chat.attemptCancelled')
                : t('ai.chat.attemptFailed')}
              {': '}
              {lastAttempt.content}
            </span>
            <button
              type="button"
              className="shrink-0 text-amber-400/70 hover:text-amber-200"
              onClick={clearLastAttempt}
              aria-label={t('ai.chat.attemptDismiss')}
            >
              ✕
            </button>
          </div>
        )}

        {/* 上翻看历史时给一个回到最新的入口（贴底时不出现） */}
        {!atBottom && (
          <div className="px-3 pt-1 text-right">
            <button
              type="button"
              className="rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1 text-[11px] text-zinc-400 shadow hover:border-zinc-500 hover:text-zinc-100"
              onClick={() => {
                const el = listRef.current
                if (!el) return
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
                setAtBottom(true)
              }}
            >
              ↓ {t('ai.chat.jumpLatest')}
            </button>
          </div>
        )}

        {/**
         * **任务清单**（2026-10-25，搬 DSH 的 todo 语义）：模型用 `todo_write` 写下的
         * 这几步做什么、做到哪了。放在输入区**正上方**而不是消息流里 —— 它是"现在的进度"，
         * 不是历史：每轮开始主进程会发一条空表把它清掉。
         */}
        {todos.length > 0 && (
          <div className="mx-3 mb-1 rounded-lg border border-zinc-700/60 bg-zinc-900/40 px-2 py-1.5 text-[11px]">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-zinc-500">
              <span className="shrink-0 text-zinc-400">{t('ai.todo.title')}</span>
              <span className="ml-auto shrink-0">
                {t('ai.todo.summary', {
                  done: String(todos.filter(x => x.status === 'completed').length),
                  total: String(todos.length),
                })}
              </span>
            </div>
            <ul className="space-y-0.5">
              {todos.slice(0, 6).map((todo, i) => (
                <li key={i} className="flex min-w-0 items-start gap-1.5">
                  <span
                    aria-hidden
                    className={
                      todo.status === 'completed'
                        ? 'shrink-0 text-emerald-500'
                        : todo.status === 'in_progress'
                          ? 'shrink-0 text-sky-400'
                          : 'shrink-0 text-zinc-600'
                    }
                  >
                    {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '▶' : '·'}
                  </span>
                  <span
                    className={
                      todo.status === 'completed'
                        ? 'min-w-0 break-words text-zinc-500 line-through'
                        : 'min-w-0 break-words text-zinc-300'
                    }
                  >
                    {todo.content}
                  </span>
                </li>
              ))}
            </ul>
            {todos.length > 6 && (
              <div className="mt-0.5 text-zinc-600">
                {t('ai.todo.more', { n: String(todos.length - 6) })}
              </div>
            )}
          </div>
        )}

        {/**
         * **输入区外壳**（2026-10-20，对齐 DSH composer）：一个圆角条 = 输入行 + 工具条。
         * 高频动作（发送/停止）在右侧圆形键；低频开关（循环模式/先计划/完全权限/预设/
         * 清空/撤回）收进左侧「模式」下拉 —— 面板一窄就不再堆成一列按钮。
         */}
        <div className="relative rounded-2xl border border-zinc-700/70 bg-zinc-900/50 px-2 pt-1.5 pb-1">
          {atReference.open && (
            <AtReferenceMenu
              items={atReference.items}
              activeIndex={atReference.activeIndex}
              loading={atReference.loading}
              error={atReference.error}
              unsupported={atReference.unsupported}
              query={atReference.query}
              onHover={atReference.hover}
              onPick={atReference.pick}
            />
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="max-h-40 min-h-[32px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-6 outline-none"
              rows={Math.min(6, Math.max(1, input.split('\n').length))}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                setInputCaret(e.target.selectionStart ?? 0)
              }}
              onSelect={e => setInputCaret(e.currentTarget.selectionStart ?? 0)}
              onPaste={e => void handlePaste(e)}
              onKeyDown={handleKeyDown}
              placeholder={
                projectPath ? t('ai.chat.placeholder') : t('ai.chat.placeholderOnboarding')
              }
              // 生成中也允许打字（排队下一句）；能不能发由发送键决定
            />
            {(streaming || mainProcessRunning) && input.trim() && (
              <div className="mb-1 flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => void handleSteer('step')}
                  title={t('ai.chat.steerTitle')}
                  aria-label={t('ai.chat.steer')}
                >
                  {t('ai.chat.steer')}
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => void handleSteer('turn')}
                  title={t('ai.chat.queueTitle')}
                  aria-label={t('ai.chat.queue')}
                >
                  {t('ai.chat.queue')}
                </button>
              </div>
            )}
            {/**
             * ⚠️ 生成中必须能**打断**（用户原话：「他还不能打断生成是不对的」）。
             * 圆形键：运行中 = 停止（■），空闲 = 发送（↑）。
             */}
            {streaming || mainProcessRunning ? (
              <button
                type="button"
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm text-zinc-200 transition-colors hover:bg-zinc-600"
                onClick={() => stopStreaming()}
                aria-label={t('ai.chat.stopAria')}
                title={t('ai.chat.stop')}
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!input.trim() && images.length === 0}
                onClick={() => handleSend()}
                aria-label={t('ai.chat.sendAria')}
                title={t('ai.send')}
              >
                ↑
              </button>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 pb-0.5">
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
              onClick={() => attachRef.current?.click()}
              title={t('ai.chat.attachImage')}
              aria-label={t('ai.chat.attachImage')}
              disabled={images.length >= MAX_IMAGES}
            >
              ＋
            </button>
            <input
              ref={attachRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => void handleAttach(e)}
            />
            <TurnOutlineLauncher
              messages={messages}
              scrollRef={listRef}
              onHighlight={setOutlineHighlight}
            />
            <details className="relative shrink-0">
              <summary className="cursor-pointer list-none whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
                {fullAccess ? t('ai.agentCore.fullAccessOn') : t('ai.agentCore.menu')} ▾
              </summary>
              {/* 菜单右缘贴住 summary：窄栏下 left-0 会让 240px 的菜单越过视口右边缘 */}
              <div className="absolute bottom-full right-0 z-20 mb-1 w-60 space-y-1 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs shadow-xl">
                <MenuToggle
                  label={t('ai.agentCore.plan')}
                  title={t('ai.agentCore.planTitle')}
                  on={planFirst}
                  disabled={streaming}
                  onClick={e => {
                    closeMenu(e.currentTarget)
                    setPlanFirst(!planFirst)
                  }}
                />
                <MenuToggle
                  label={t('ai.agentCore.fullAccess')}
                  title={t('ai.agentCore.fullAccessTitle')}
                  on={fullAccess}
                  disabled={streaming}
                  onClick={e => {
                    closeMenu(e.currentTarget)
                    setFullAccess(!fullAccess)
                  }}
                />
                <div className="my-1 border-t border-zinc-800" />
                <button
                  type="button"
                  className="w-full rounded px-1 py-1 text-left text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  disabled={!projectPath || streaming}
                  onClick={e => {
                    closeMenu(e.currentTarget)
                    if (projectPath) void clearActiveThread(projectPath)
                  }}
                  title={t('ai.chat.clearTitle')}
                >
                  {t('editor.action.clear')}
                </button>
                <button
                  type="button"
                  className="w-full rounded px-1 py-1 text-left text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  disabled={!projectPath || streaming || !canRollback}
                  onClick={e => {
                    closeMenu(e.currentTarget)
                    if (projectPath) void rollbackLastTurn(projectPath)
                  }}
                  title={t('ai.chat.rollbackTitle')}
                >
                  {t('ai.chat.rollbackLast')}
                </button>
              </div>
            </details>
            {presetMeta?.permissionMode === 'full' && !fullAccess && (
              <span
                className="shrink-0 whitespace-nowrap text-[11px] text-amber-300"
                title={t('ai.agentCore.fullAccessFromPresetTitle')}
              >
                {t('ai.agentCore.fullAccessFromPreset')}
              </span>
            )}
            {/**
             * **模型真下拉**：候选来自 llm-presets（唯一真相层），选中即写回 AI 配置；
             * 当前模型不在候选里（手填/已下线）也照样列在第一位，不假装它不存在。
             */}
            <details className="relative ml-auto min-w-0 max-w-full">
              <summary
                className="flex min-w-0 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 [&::-webkit-details-marker]:hidden"
                title={t('ai.chat.modelTitle')}
              >
                <span className="truncate">{aiConfig?.model ?? t('ai.chat.modelUnset')}</span>
                <span className="shrink-0 text-zinc-600">▾</span>
              </summary>
              <div className="absolute bottom-full right-0 z-20 mb-1 w-56 space-y-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs shadow-xl">
                {aiConfig ? (
                  [
                    ...new Set([
                      aiConfig.model,
                      ...(findLlmPreset(aiConfig.provider)?.models ?? []),
                    ]),
                  ].map(model => (
                    <button
                      key={model}
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-zinc-800"
                      onClick={e => {
                        closeMenu(e.currentTarget)
                        void window.qqbat.ai.setConfig({ ...aiConfig, model }).then(res => {
                          if (res.ok) reloadAiConfig()
                        })
                      }}
                    >
                      <span className="w-3 text-center text-zinc-400">
                        {model === aiConfig.model ? '✓' : ''}
                      </span>
                      <span className="truncate text-zinc-300">{model}</span>
                    </button>
                  ))
                ) : (
                  <p className="px-1 py-1 text-zinc-500">{t('ai.chat.modelUnset')}</p>
                )}
                <div className="my-1 border-t border-zinc-800" />
                <button
                  type="button"
                  className="w-full rounded px-1 py-1 text-left text-zinc-300 hover:bg-zinc-800"
                  onClick={e => {
                    closeMenu(e.currentTarget)
                    setSettingsOpen(true)
                  }}
                  title={t('ai.chat.modelTitle')}
                >
                  {t('ai.chat.modelSettings')}
                </button>
              </div>
            </details>
          </div>
          <AiSlot name="composer.toolbar" />
          <AiSlot name="composer.hint" />
        </div>
      </div>

      {/* 底部状态行：本轮统计（真实用量；厂商没回传的段整个不出现） */}
      <RunStatsBar />
    </div>
  )
})
