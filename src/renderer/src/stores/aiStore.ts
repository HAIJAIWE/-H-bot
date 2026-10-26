// src/renderer/src/stores/aiStore.ts
import { create } from 'zustand'
import type { AiAllowRule, AiRunStats, ChatMessage } from '@shared/types/ai'
import type { AgentMode } from '@shared/ai/roleDomains'
import { classifyAiError } from '../components/ai/errorMessage'
import type { Proposal, ProposalOperation } from '@shared/types/proposal'
import type { FlowSnapshot } from './flowStore'
import { useFlowStore } from './flowStore'
import { beginHistoryBatch, endHistoryBatch, pushHistoryPoint } from './flowStore'
import { useProjectStore } from './projectStore'
// M5：发送时带上当前页面（低代码 / 代码），主进程据此分派专家角色
import { useUiStore } from './uiStore'
// P1-5：发送时带上**编辑器里当前打开的文件**，助手才有「这个文件」的指代对象
import { useEditorStore } from './editorStore'
import { createNode, createEdge } from '../lib/canvas/nodeFactory'
import { nodeDisplayLabel } from '../lib/node/nodeCatalog'
import { needsLayout, layoutFlow } from '../lib/canvas/autoLayout'
import { focusNode } from '../lib/canvas/reactFlowBridge'
// 工具"怎么展示"的呈现契约（IPC 载荷类型，见 types/ipc.ts）
import type { ToolPresentation } from '../types/ipc'
import {
  AI_BATCH_TIMEOUT_MS,
  AI_NOTE_APPLIED,
  AI_NOTE_REJECTED,
  AI_TURN_NOTE_PREFIX,
} from '@shared/types/ai'
import { t } from '../i18n'
// 能力执行的共享守卫：**主进程提案期**与**渲染层执行期**必须过同一个函数
import { executeCapability } from '@shared/ai/capabilityExecute'
import { isAppManagedReadOnly } from '@shared/files/readOnlyPaths'
import {
  insertCommandChain,
  insertConfigQueryChain,
  insertPresetTemplate,
} from '../lib/command/insertChain'
// 应用后自动校验：复用 `validate_flow` / `flow:validate` 的**同一套引擎**（统一真相层），
// 差分判据也复用提案生成处那份 —— 校验规则一行都不新写（见 applyProposal 的 P1-4）。
import { normalizeFlow, validateFlow } from '@shared/nodes/flowNormalize'
import type { FlowIssue } from '@shared/nodes/flowNormalize'
import { issueKey, issueKeySet } from '@shared/nodes/issueBaseline'

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted'
  /** 呈现契约（"怎么展示"）：主进程带才有；缺省按现状渲染 */
  presentation?: ToolPresentation
  /** 失败分类 + 建议动作（失败事件带才有） */
  failure?: import('@shared/ai/toolFailure').ToolFailure
  result?: unknown
  timestamp: number
}

/**
 * 一轮里用过的工具（**这一轮结束后**挂到对应那条助手消息上）。
 *
 * 为什么要有它（2026-10-06 用户："不知道他的工作干了什么？还有为啥完事后那个绿色会消失？"）：
 * 在此之前工具卡片只挂在**最新一条消息**上，而下一次发送会把 `toolCalls` 清掉 ——
 * 于是"它刚查了 8 个节点定义"这件事在界面上**消失得无影无踪**，用户既看不到过程、
 * 也回看不到做过什么。现在把它们随消息存下来，永远可见（可折叠）。
 */
export interface ToolTraceEntry {
  id: string
  name: string
  /** 调用参数（"查了哪个节点"比"查了一次"有用得多） */
  args: Record<string, unknown>
  status: ToolCallRecord['status']
  /** 呈现契约（随痕迹留下 —— 否则消息里的工具行又退回"猜工具名"） */
  presentation?: ToolPresentation
  result?: unknown
}

/** 渲染层自己的消息类型：比 `ChatMessage` 多一个"这一轮干了什么"的痕迹 */
export interface ChatMessageWithTrace extends ChatMessage {
  trace?: ToolTraceEntry[]
  /** 这一轮从发起到收尾的墙钟时长（毫秒）；缺省 = 不知道（老历史没有） */
  turnMs?: number
}

/**
 * 一条线程的规模（第 56 批）。
 *
 * 形状与主进程 `listThreads` 返回的 `stats` **逐字段一致**（`src/main/services/ai/threads.ts` 的 `statsOf()`）：
 * 这里不重新计算，只当列表提示的数据源 —— 统计口径只有主进程那一份。
 */
export interface ThreadStats {
  /** 用户消息数 = 回合数 */
  turns: number
  /** 全部消息数（含 attempt） */
  messages: number
  assistantMessages: number
  /** 正文字符数（用户 + 助手，不含工具痕迹） */
  chars: number
  /** 估算 token：ceil(chars / 4)，只用于提示量级 */
  estimatedTokens: number
  /** 第一条到最后一条的时间跨度（毫秒）；消息不足两条 = 0 */
  durationMs: number
}

/**
 * 线程列表项（第 56 批）：标题 + 标题来源 + 规模。
 *
 * `titleSource` 决定「用户 pin 的标题不会被 AI 覆盖」这条规则：
 * `fallback` = 首条需求推导、`provider` = AI 起的、`user` = 用户改的（pin）。
 */
export interface ThreadInfo {
  id: string
  title: string
  titleSource: 'fallback' | 'provider' | 'user'
  updatedAt: number
  messageCount: number
  stats: ThreadStats
}

/**
 * 一处正文命中（第 57 批）。
 *
 * 片段是**原文**（不是小写副本），`before`/`after` 已按码点裁到半径内；
 * 要不要加省略号看 `moreBefore`/`moreAfter` —— 这里不提前拼字符串，
 * 否则界面就没法把 `match` 单独高亮了。
 */
export interface ThreadSearchHit {
  index: number
  role: 'user' | 'assistant'
  before: string
  match: string
  after: string
  moreBefore: boolean
  moreAfter: boolean
}

/** 一条命中的线程 = 线程列表项 + 命中片段（形状来自主进程 `searchProjectThreads`） */
export interface ThreadSearchMatch extends ThreadInfo {
  hits: ThreadSearchHit[]
}

/** 把"这一刻的工具记录"压成可长期保存的痕迹（只留展示需要的字段） */
function traceOf(records: readonly ToolCallRecord[]): ToolTraceEntry[] {
  return records.map(tc => ({
    id: tc.id,
    name: tc.name,
    args: tc.args,
    status: tc.status,
    ...(tc.presentation ? { presentation: tc.presentation } : {}),
    ...(tc.result !== undefined ? { result: tc.result } : {}),
  }))
}

/**
 * 跑一遍**统一真相层**校验：`normalizeFlow` 补端口 → `validateFlow` 出问题清单。
 *
 * 复用 `validate_flow` 工具与 `flow:validate` IPC 的**同一套引擎**（`@shared/nodes/flowNormalize`）。
 * 本仓库最忌讳同一件事两处实现 —— 历史事故：两套校验引擎对同一张图同屏给出 61 与 43 两个数字。
 *
 * 只需要 `{ nodes, edges }`：`NormalizableGraph` 就声明这两个字段，systems / nodeGroups
 * 不参与校验（与 `flow:validate` 收到的那份图算出来的是同一份结论）。
 */
function collectFlowIssues(graph: { nodes: unknown[]; edges: unknown[] }): FlowIssue[] {
  const { graph: normalized } = normalizeFlow(
    graph as unknown as Parameters<typeof normalizeFlow>[0],
  )
  return validateFlow(normalized)
}

/**
 * 多智能体阶段（2026-10-18）。
 *
 * 主进程每进入/离开一个阶段就推一条，界面据此画「侦察 → 规划 → 并行 → 执行」的进度条。
 * label 由主进程给（渲染层不拼中文，绕开 i18n 硬编码闸门）。
 */
export interface AgentStageInfo {
  id: 'scout' | 'planner' | 'lanes' | 'execute' | 'verify'
  label: string
  status: 'start' | 'done' | 'skip' | 'fail'
  /** 该阶段耗时（毫秒）；只有 done/fail 才有 */
  ms?: number
  /** 一行补充（几条发现 / 几步计划 / 几条 lane） */
  detail?: string
}

export interface AgentState {
  state: 'idle' | 'thinking' | 'executing' | 'warning' | 'error'
  message?: string
  /** 本阶段的进度信息（只有多智能体跑过才有） */
  stage?: AgentStageInfo
}

/**
 * 把一条阶段事件并进列表：**同 id 覆盖**（start 被 done 替换），其余保持插入顺序。
 * 纯函数，便于单测（界面只负责渲染）。
 */
export function mergeAgentStage(
  list: readonly AgentStageInfo[],
  stage: AgentStageInfo,
): AgentStageInfo[] {
  const rest = list.filter(s => s.id !== stage.id)
  return [...rest, stage]
}

/**
 * **一个项目的对话记录**。
 *
 * ## 为什么要有它（2026-10-01）
 *
 * 这些字段以前是**全局一份**：切到别的项目，面板还显示上一个项目的对话；
 * 而别的项目正在跑的那轮事件会被 `filterProject` **直接丢弃**（记录也随之丢了）。
 * 磁盘上的历史本来就是按项目分的（`.qqbat/ai-history.jsonl`），只有界面这份不是。
 *
 * ## 扁平字段与它的关系
 *
 * 下面那些扁平字段（`messages` / `currentChunk` / …）仍然是**当前项目的视图** ——
 * 组件照旧读它们，一行都不用改。切换项目时把视图存回旧项目、装载新项目。
 * 不变式：**扁平字段 ≡ `conversations[conversationPath]`**（有闸门钉着）。
 */
/** 任务清单条（`todo_write` 的整表快照；主进程每轮开始发一条空的） */
export interface ConversationTodo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface ProjectConversation {
  messages: ChatMessageWithTrace[]
  streaming: boolean
  /** 主进程那边是否真有请求在飞（与 streaming 可能不一致：别的窗口发起 / 界面刚重载） */
  mainProcessRunning: boolean
  currentChunk: string
  /** 流式思考过程（厂商给 reasoning_content 才有；结束/中断时附件到最终消息并清空） */
  currentReasoning: string
  /** 这一轮开始的墙钟时间（0 = 没在跑）；界面据此说「工作了 N 秒」 */
  runStartedAt: number
  isBatchMode: boolean
  batchSnapshot: FlowSnapshot | null
  toolCalls: ToolCallRecord[]
  agentState: AgentState
  /** 步边界：这一轮走到第几步（1-based；null = 还没开始/已收尾） */
  agentStep: { step: number; maxSteps: number } | null
  /** 多智能体阶段进度（侦察/规划/并行/执行）；空 = 这一轮没跑多智能体 */
  agentStages: AgentStageInfo[]
  /** 任务清单（模型用 todo_write 写的）；空 = 这一轮没写 */
  todos: ConversationTodo[]
  currentProposal: Proposal | null
  /** 本轮统计（状态条）。**可选**：还没跑过 / 老会话就是 undefined → 状态条不显示 */
  stats?: AiRunStats
}

/** 空会话（新项目第一次打开时的样子） */
export function emptyConversation(): ProjectConversation {
  return {
    messages: [],
    streaming: false,
    /** 主进程是否真有请求在飞（初始 false；由 refreshMainRunning 与 stopStreaming 刷新） */
    mainProcessRunning: false,
    currentChunk: '',
    currentReasoning: '',
    runStartedAt: 0,
    isBatchMode: false,
    batchSnapshot: null,
    toolCalls: [],
    agentState: { state: 'idle' },
    agentStep: null,
    agentStages: [],
    todos: [],
    currentProposal: null,
  }
}

interface AiState {
  /** 当前项目的视图（≡ conversations[conversationPath]） */
  messages: ChatMessageWithTrace[]
  streaming: boolean
  currentChunk: string
  currentReasoning: string
  /** 这一轮开始的墙钟时间（0 = 没在跑） */
  runStartedAt: number
  isBatchMode: boolean
  batchSnapshot: FlowSnapshot | null
  toolCalls: ToolCallRecord[]
  agentState: AgentState
  /** 步边界：这一轮走到第几步（1-based；null = 还没开始/已收尾） */
  agentStep: { step: number; maxSteps: number } | null
  /** 多智能体阶段进度（侦察/规划/并行/执行）；空 = 这一轮没跑多智能体 */
  agentStages: AgentStageInfo[]
  /** 任务清单（模型用 todo_write 写的）；空 = 这一轮没写 */
  todos: ConversationTodo[]
  /** 本轮统计（状态条）；undefined = 还没跑过 */
  stats?: AiRunStats

  addMessage: (msg: ChatMessage) => void
  appendChunk: (text: string) => void
  finishStreaming: () => void
  /** 用户主动中断流式（Escape 键）：把已接收的 currentChunk finalize 为 assistant 消息，
   *  并标记 streaming:false。后端可能仍在生成，但 appendChunk 会因 streaming:false 而忽略后续 chunk。 */
  stopStreaming: () => void
  /**
   * 主进程那边是否真有 AI 请求在飞（`ai:isRunning`）。
   * 与本地 `streaming` 可能不一致：别的窗口发起、或界面刚重载过 —— 所以"停止"该看它。
   */
  mainProcessRunning: boolean
  /**
   * **待批准的工具调用**（M1d）：主进程判定 ask 时会**真的停下来等**它。
   *
   * 放在 store 级（不是 per-conversation）：批准是**瞬态**的，一次只可能有一个，
   * 而主进程本来就按项目串行。
   */
  pendingApproval: {
    callId: string
    toolName: string
    args: Record<string, unknown>
    hint: string
  } | null
  /** 回决定：allow 批准这次 / deny 拒绝 / always 批准并「以后别再问」 */
  resolvePendingApproval: (decision: 'allow' | 'deny' | 'always') => Promise<void>
  refreshMainRunning: () => Promise<void>
  clearMessages: () => void
  setMessages: (msgs: ChatMessage[]) => void

  /** 各项目的对话记录（切换项目时不再互相覆盖） */
  conversations: Record<string, ProjectConversation>
  /**
   * **任务线程**列表（一个项目可以有多条任务）。
   *
   * 由主进程**扫目录派生**（每个线程一个记忆文件），不建索引 —— 见
   * main/services/ai/threads.ts。在此之前一个项目只有一条无限长的对话，
   * 用户的原话是「他是同一个记忆的，那我怎么切换新的任务呢」。
   */
  threads: ThreadInfo[]
  /** 当前线程 id；`default` = 升级前的那条老记忆 */
  activeThreadId: string
  /**
   * **助手模式的人为覆盖**（2026-10-10）。
   *
   * null = 跟当前页面走（低代码页→流程助手、代码页→代码助手）；
   * 有值 = 用户显式选了，**以他为准** —— 这就是「模式选择器」。
   * 为什么不干脆只做手动选：页面是产品事实，站在画布上让模型改代码，改动会发生在用户看不见的地方。
   * 所以默认仍跟页面，覆盖只是给用户的**显式出口**。
   */
  agentModeOverride: AgentMode | null
  /**
   * **循环是唯一入口**（2026-10-20 合并双引擎第 3 步）。
   *
   * 有项目的对话一律走 `ai:agentCoreRun`（workspace-first 循环）；只有**没有项目**的
   * 开荒对话还走 `ai:chat`（循环要一个工作目录才能读/写/跑）。
   * 原来那个"智能体循环"开关已删 —— DSH 里根本没有这个开关，一个产品只该有一条循环。
   */
  /** 先计划：只给只读工具，先拿一份计划（这一轮不写盘） */
  planFirst: boolean
  setPlanFirst: (on: boolean) => void
  /** 当前线程选中的预设名（null = 不限制工具）；预设文件里定义的才有效 */
  preset: string | null
  /** `项目路径::线程 id` → 该线程选中的预设（内存态；线程 id 只在项目内唯一，必须带项目前缀） */
  presetByThread: Record<string, string | null>
  setPreset: (name: string | null) => void
  /** 完全权限：本次会话内不再逐个审批（不落规则，重启失效） */
  fullAccess: boolean
  setFullAccess: (on: boolean) => void
  /**
   * 「以后别再问」的已记住规则（跨轮、可撤销）。
   *
   * 这些动作现在**不问用户就直接执行**，所以界面上必须列出来、能删单条、能清空 ——
   * 没有撤销口的自动放行，本仓库明文反对（见 services/ai/allowRules.ts 文件头）。
   */
  allowRules: AiAllowRule[]
  /**
   * **插话**：把一句话塞进正在跑的那一轮（下一个步边界注入）。
   * 返回 false = 主进程说"这个项目现在没在跑"（界面据此提示，不静默吞）。
   */
  steer: (projectPath: string, text: string, target?: 'step' | 'turn') => Promise<boolean>
  loadAllowRules: (projectPath: string) => Promise<void>
  removeAllowRule: (kind: AiAllowRule['kind'], match: string) => Promise<void>
  clearAllowRules: () => Promise<void>
  /**
   * 列表读取失败的原因（null = 正常）。
   *
   * 为什么要留这个字段：这地方**静默失败过** —— IPC 没暴露 / 校验没过时，
   * 界面上只是「列表空着」，用户和我们都只能猜（2026-10-09 真机排查了整个来回）。
   * 失败必须可见，哪怕是内部状态。
   */
  threadsError: string | null
  /**
   * **按项目分组的对话**（工作区列表）。
   *
   * 为什么要有它（2026-10-09 用户：「我的建议抄，没必要一个项目切换」）：
   * DSH 的侧栏是「工作区 → 会话」两层，**不用先切工作区才能看别的会话**。
   * 这里对齐：一次把每个项目的对话都列出来，点哪条就进哪条（并自动切项目）。
   */
  allThreads: Array<{
    projectPath: string
    projectName: string
    threads: ThreadInfo[]
  }>
  /** 已知项目（渲染层从 botStore 喂进来；列表要按它遍历） */
  knownProjects: Array<{ path: string; name: string }>
  /** 上面那些扁平字段属于哪个项目 */
  conversationPath: string
  /** 切到某个项目的对话：存回旧项目、装载新项目 */
  switchConversation: (projectPath: string) => void
  /**
   * 把**磁盘上的记忆**读回该项目的对话（只在界面这份为空时）。
   *
   * 不覆盖已有内容：用户眼前的对话优先，历史只是"重启后别让界面空着"。
   */
  loadHistoryFromDisk: (projectPath: string, opts?: { force?: boolean }) => Promise<void>
  /**
   * 最近一次**失败尝试**（来自记忆日志的 attempt 行；进日志不进模型历史）。
   * 用途：重启/重开面板后告诉用户"上次为什么没做完"—— 只有主进程日志里查得到是不够的。
   */
  lastAttempt: { projectPath: string; content: string; reason: 'error' | 'cancelled' } | null
  clearLastAttempt: () => void
  /** 拉取线程列表（换任务/新建/清空后都要刷新） */
  loadThreads: (projectPath: string) => Promise<void>
  /** 设置已知项目并拉取全部项目的对话（工作区列表的数据源） */
  setKnownProjects: (projects: Array<{ path: string; name: string }>) => void
  /** 拉取**所有项目**的对话（并行），并同步当前项目那一组到 threads */
  loadAllThreads: () => Promise<void>
  /** 直接指定当前对话（跨项目选中时用：先切项目，再设它） */
  setActiveThread: (threadId: string) => void
  /** 设置助手模式覆盖；传 null = 回到「跟页面」 */
  setAgentModeOverride: (mode: AgentMode | null) => void
  /** 开一条**新任务**：新线程 + 清空界面（老线程留在磁盘上，可切回） */
  newThread: (projectPath: string) => void
  /** 切到某条线程（从磁盘读回它的记忆） */
  switchThread: (projectPath: string, threadId: string) => Promise<void>
  /** **真的**清空当前线程的记忆（界面 + 磁盘） */
  clearActiveThread: (projectPath: string) => Promise<void>
  /**
   * 改线程标题（第 56 批）。
   *
   * 归一（剥控制序列 / 按 64 字节截断）在主进程；成功后 **乐观更新** 列表标题
   * （`titleSource: 'user'` = pin，之后 AI 不会再覆盖），并返回结果给界面做提示。
   */
  renameThread: (
    projectPath: string,
    threadId: string,
    title: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * 搜某个项目的线程**正文**（第 57 批）。
   *
   * 标题过滤不在这里 —— 标题就在 `threads`/`allThreads` 里，本地 `includes` 零延迟。
   * 这条只补"别的线程正文不在内存里"的那一半：结果带命中片段，界面直接渲染。
   */
  searchThreads: (
    projectPath: string,
    query: string,
  ) => Promise<{ ok: true; results: ThreadSearchMatch[] } | { ok: false; error: string }>
  /**
   * 删除一条线程（= `ai:clearThread`，删的是记忆文件；第 57 批把入口接上界面）。
   *
   * 删**当前**线程时切回该项目的 `default`（老记忆文件）并清空界面；
   * 删别的线程只刷列表 —— 别顺手把用户正在看的对话清掉。
   */
  deleteThread: (
    projectPath: string,
    threadId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  /** images = 这一轮贴的图（data URL）；只作用于这一轮，不进记忆 */
  sendMessage: (
    projectPath: string,
    text: string,
    images?: string[],
    /** 角色（界面模式）：循环路径按它裁工具 + 提示词 */
    agentMode?: AgentMode,
  ) => Promise<void>
  init: () => () => void

  beginBatch: () => Promise<void>
  commitBatch: () => Promise<void>
  rollbackBatch: (projectPath?: string) => Promise<void>

  addToolCall: (call: ToolCallRecord) => void
  updateToolCall: (id: string, partial: Partial<ToolCallRecord>) => void
  clearToolCalls: () => void
  setAgentState: (state: AgentState) => void

  // ====== Proposal 累积与确认 ======
  currentProposal: Proposal | null
  setProposal: (p: Proposal | null) => void
  applyProposal: (ops: ProposalOperation[]) => Promise<void>
  rejectProposal: () => void
}

/**
 * 执行提案里的一条「能力调用」操作。
 *
 * 真正的链路（守卫 → 参数解析 → 找方法 → 调用 → 判失败）在
 * `@shared/ai/capabilityExecute` 里 —— 抽出去是为了**能测**：那一段原本是整条链上
 * 唯一既没测试、又没法靠闸门覆盖的一环，而它正是「用户点确认之后真正发生什么」。
 * 这里只做两件渲染层的事：把 `window.qqbat` 递进去、把失败翻成界面文案后抛出
 * （抛出才能走提案的失败回滚分支，不能吞）。
 *
 * 为什么必须由渲染层发起：主进程跑 IPC handler 需要 IpcMainInvokeEvent，
 * 而且 14 个 handler 依赖 event.sender 推进度事件。渲染层才是真实路径。
 */
async function invokeCapability(
  id: string,
  args: Record<string, unknown>,
  projectPath: string,
): Promise<void> {
  const bridge = (
    window as unknown as {
      qqbat?: { ai?: { guardOptions?: { allowDestructive?: boolean; allowedTargets?: string[] } } }
    }
  ).qqbat
  // 用户侧设置（preload 从 process.env 算好暴露的）—— 渲染层复检要用同一份
  const guardOptions = {
    allowDestructive: bridge?.ai?.guardOptions?.allowDestructive === true,
    allowedTargets: bridge?.ai?.guardOptions?.allowedTargets ?? [],
  }
  const result = await executeCapability(id, args, projectPath, bridge, guardOptions)
  if (result.ok) {
    /**
     * 开荒模式的收尾：**建完项目就带用户进去**。
     *
     * 否则会出现很怪的一幕：项目明明建好了，界面还停在"没有项目"的状态，
     * 用户以为没成功、又点一次。新建项目对话框当年就是这么做的（setCurrentProject + 刷新列表）。
     * 动态 import 是为了不与 botStore 形成静态循环依赖。
     */
    if (id === 'project.create') {
      const meta = (result.value as { data?: { path?: string } } | undefined)?.data
      if (meta?.path) {
        useProjectStore.getState().setCurrentProject(meta as never)
        const { useBotStore } = await import('./botStore')
        useBotStore.getState().loadBots()
        useBotStore.getState().selectBot(meta.path)
      }
    }
    return
  }
  throw new Error(t('ai.ops.capabilityFailed', { id, reason: result.reason }))
}
async function handleClientInstruction(instruction: {
  name: string
  args: Record<string, unknown>
}) {
  const { name, args } = instruction
  const flowStore = useFlowStore.getState()
  const aiStore = useAiStore.getState()

  switch (name) {
    case 'add_node': {
      const label = String(args.label || '')
      const nodeType = String(args.type || 'action')
      // 不安全断言改为运行时校验，避免后端下发不完整 position 时抛 TypeError
      const pos = args.position
      if (
        !pos ||
        typeof pos !== 'object' ||
        typeof (pos as { x?: unknown }).x !== 'number' ||
        typeof (pos as { y?: unknown }).y !== 'number'
      ) {
        throw new Error(t('ai.ops.invalidPosition'))
      }
      const node = createNode(nodeType, {
        x: (pos as { x: number; y: number }).x,
        y: (pos as { x: number; y: number }).y,
      })
      if (label) {
        node.data.label = label
      }
      flowStore.addNode(node)
      break
    }
    case 'update_node': {
      const nodeId = String(args.nodeId || '')
      if (args.config) flowStore.updateNodeConfig(nodeId, args.config as Record<string, unknown>)
      if (args.label) flowStore.updateNodeLabel(nodeId, String(args.label))
      break
    }
    case 'delete_node': {
      flowStore.removeNode(String(args.nodeId || ''))
      break
    }
    case 'connect_nodes': {
      const edge = createEdge(
        String(args.sourceId),
        String(args.sourceHandle || 'output'),
        String(args.targetId),
        String(args.targetHandle || 'input'),
      )
      flowStore.addEdge(edge)
      break
    }
    case 'begin_batch':
      await aiStore.beginBatch()
      break
    case 'commit_batch':
      await aiStore.commitBatch()
      break
    case 'rollback_batch':
      await aiStore.rollbackBatch()
      break
    case 'run_bot':
      // 控制通道已统一到 botManager（runtime:* 只剩日志/节点事件/测试注入）
      void window.qqbat.botManager.start((args.projectPath as string) || '')
      break
    case 'stop_bot':
      void window.qqbat.botManager.stop((args.projectPath as string) || '')
      break
    case 'write_code':
    case 'write_file': {
      const projectPath = String(args.projectPath || '')
      /**
       * ⚠️ **三个字段名都要认**（2026-10-16 补，P0-7 顺手发现的）：
       *
       * `write_code` 的**声明参数叫 `filePath`**、`write_file` 的叫 `path`，
       * 而这里原来只认 `filename || path` —— 于是 MCP 路径的 `write_code` **从来没有落到目标文件**
       * （它把空串当成路径写下去了），更糟的是：**主进程侧校验的字段（filePath）与
       * 这里真正写的字段（path）不是同一个** ⇒ 两个字段各写一个值就能错开绕过校验。
       * 现在按**同一个顺序**取出真正要写的那个路径，下面所有判据都只看它。
       */
      const filePath = String(args.filename || args.filePath || args.path || '')
      // 与 applyProposal 保持一致的路径校验，防止路径穿越/绝对路径写入项目沙箱外
      if (filePath.includes('..') || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
        throw new Error(t('ai.ops.pathOutsideProject', { path: filePath }))
      }
      /**
       * ⚠️ **应用自己管理的文件不许从这条通用写通道写**（P0-7）。
       *
       * 判据与**提案路径**（applyProposal 里那处同款检查、proposal.ts 的 write_code case）
       * 是**同一个函数、同一份清单**（`@shared/files/readOnlyPaths`）—— 这里再抄一张
       * 清单迟早与画布那边漂移（本仓库为"两份真源"付过代价）。
       *
       * 为什么它比路径穿越更要紧：`.qqbat/flow.json` 是画布的数据源，每次保存都被应用
       * **整体重写** —— 从这条通道改它既绕开了画布自己的保存与校验，下一次保存还会把
       * 改动冲掉（今晚真机丢数据的同一类形态）。
       *
       * 两种反馈都给：**界面** agentState 变红（复用提案路径拒绝时那条 i18n 文案，用户看得见）；
       * **调用方**抛错。MCP 那条路另在主进程侧**更早**拦一道，所以外部 IDE 拿到的是
       * 可执行的错误文本，而不是"已派发"的假成功。
       */
      if (isAppManagedReadOnly(filePath)) {
        const message = t('ai.ops.appManagedReadOnly', { path: filePath })
        useAiStore.setState({ agentState: { state: 'error', message } })
        console.error(`[handleClientInstruction] 拒绝写入应用管理的文件: ${filePath}`)
        throw new Error(message)
      }
      await window.qqbat.file.write(projectPath, filePath, String(args.content || ''))
      break
    }
    case 'read_logs': {
      // 通知用户查看日志面板
      break
    }
    default:
      // 未知指令不静默忽略，便于排查后端新增指令但前端未升级的情况
      console.warn(`[handleClientInstruction] 未知指令: ${name}`, args)
      throw new Error(`未知客户端指令: ${name}`)
  }
}

/** 当前打开的项目路径（批处理兜底用；`conversationPath` 为空时才会走到） */
function currentProjectPath(): string {
  return useProjectStore.getState().currentProject?.path ?? ''
}

/**
 * 界面侧 batch 横幅的收尾计时器（与主进程的自动提交同一个超时值）。
 * 模块级：同一时刻只可能有一个 batch（按项目隔离由 conversationPath 决定）。
 */
let batchTimer: ReturnType<typeof setTimeout> | null = null
function clearBatchTimer(): void {
  if (batchTimer !== null) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
}

/**
 * 生效的助手模式：用户显式切过就以他为准，否则跟当前页面（`code` 才是代码助手，其余一律流程助手）。
 *
 * 刻意导出成**纯函数**：组件要显示它、发送路径要用它，两处各写一份规则必然会漂。
 */
export function resolveAgentMode(centerTab: unknown, override: AgentMode | null): AgentMode {
  if (override) return override
  return centerTab === 'code' ? 'code' : 'blocks'
}

/**
 * **agent-core 一轮**（`ai:agentCoreRun`）：循环跑完才回执，所以这里不做流式。
 *
 * 回执里的 `toolResults` 直接映射成工具行挂到这条助手消息上 —— 与 `finalizeTurn`
 * 的收尾形状**同一套**（`trace`），面板那边一行都不用改就能显示"它干了什么"。
 *
 * 失败一律落到 `agentState = error` + 一条 system 消息：**不能只是安静地不回复**
 * （sendMessage 里那几条注释记着的教训：界面会永远转圈）。
 */
/**
 * 第几轮循环（**顶号**用）：用户点了停止之后还能马上发下一句，而上一轮的 IPC
 * 可能几秒后才回来 —— 那个迟到的回执**不能**把新一轮的流式态/消息状态改掉。
 */
let agentCoreTurnSeq = 0

async function runAgentCoreTurn(
  projectPath: string,
  text: string,
  agentMode?: AgentMode,
  /** 这一轮贴的图（data URL）：只进这一轮，不进记忆 */
  images?: string[],
  /** 代码编辑器里打开的文件：循环按角色判定后用上（见主进程 activeFileHintFor） */
  activeFilePath?: string,
): Promise<void> {
  agentCoreTurnSeq += 1
  const seq = agentCoreTurnSeq
  /** 这一轮还是"当前轮"吗（不是就丢回执：它已经过期了） */
  const current = (): boolean => seq === agentCoreTurnSeq
  const fail = (message: string): void => {
    if (!current()) return
    useAiStore.setState({
      streaming: false,
      currentChunk: '',
      currentReasoning: '',
      agentState: { state: 'error', message },
    })
    useAiStore.getState().addMessage({
      role: 'system',
      content: t('ai.agentCore.failed', { message }),
    })
  }
  /**
   * 空路径**不再是错误**（2026-10-25，双引擎收口）：没有项目 = 开荒，
   * 主进程按同一条循环的另一套装配跑（见 ipc/aiAgentCoreOnboarding.ts）。
   * 以前这里直接失败 —— 因为那时循环只会读写文件，没有工作目录就无从下手。
   */
  try {
    /**
     * 预设的**三态**（第 51 批）：这里不能 `preset ?? undefined` —— 那会把
     * 用户明确选的"跟页面"(null) 与"从没选过"(缺 key) 混成一件事，
     * 空白线程于是永远套不上项目默认。判据是 `presetByThread` 有没有这条键。
     */
    const store = useAiStore.getState()
    const presetKey = projectPath + '::' + store.activeThreadId
    const presetForRun = Object.prototype.hasOwnProperty.call(store.presetByThread, presetKey)
      ? store.presetByThread[presetKey]
      : undefined
    // 线程：与助手共用同一个选择器 —— 在这一条对话里继续，两种模式是同一件事
    const res = await window.qqbat.ai.agentCoreRun(
      projectPath,
      text,
      useAiStore.getState().activeThreadId,
      undefined,
      // 「先计划」在这一轮生效：只给只读工具，产出一份计划（写/命令这一轮不存在）
      useAiStore.getState().planFirst,
      // 完全权限：本次运行不再逐个审批（不落规则，重启失效）。
      // ⚠️ 关着时传 **undefined 而不是 false**：主进程只在"调用方没表态"时才让
      // 会话预设的 permissionMode:'full' 补位；传 false 等于明确拒绝，会把预设压掉
      // （见 ipc/aiAgentCore.ts 的 fullAccess 解析）。
      useAiStore.getState().fullAccess ? true : undefined,
      // allowedTools 不在这里传：预设由主进程按名字解析（显式白名单会盖过预设）
      undefined,
      presetForRun,
      agentMode,
      images,
      activeFilePath,
    )
    if (!current()) return
    if (!res.ok) {
      /**
       * 失败：主进程已经发过 `ai:error`，渲染层那条既有监听会**收尾并给一句人话**
       * （classifyAiError）。只有事件没到（老主进程 / 事件通道断了）才在这里兜底 ——
       * 两边各弹一次会让用户看到两句话。
       */
      if (useAiStore.getState().streaming) fail(res.error)
      return
    }
    /**
     * 正常路径：正文与工具行已经在 `ai:chunk` / `ai:toolCall` 里边跑边显示，
     * 收尾由 `ai:response` 那条既有监听完成（提交正文 + 本轮工具行）。
     * 走到这里还是 streaming，说明**收尾事件没到** —— 旧主进程、通道断，
     * **或者回执比事件先到**（2026-10-25 真机撞到：`ai:response` 与 invoke 的回执
     * 是两条独立消息，谁先到没有保证）。那就由这里收尾，至少让用户看到结果。
     *
     * ⚠️ 这条兜底**必须和 `ai:response` 那条长得一样**：同样带耗时、思考与工具痕迹。
     * 以前它只写正文 —— 于是同一个界面在两台机器/两种时序下，一轮的结算行有时是
     * 「工作了 5 秒」、有时是「已完成」，看起来像随机的。
     */
    if (!useAiStore.getState().streaming) return
    const s = useAiStore.getState()
    const trace: ToolTraceEntry[] = res.toolResults.map((r, i) => ({
      id: `agentcore-${i}`,
      name: r.name,
      args: r.args,
      status: 'done',
      result: r.output,
    }))
    const turnMs = s.runStartedAt ? Date.now() - s.runStartedAt : 0
    const msg: ChatMessageWithTrace = {
      role: 'assistant',
      content:
        res.finalText.trim() ||
        s.currentChunk.trim() ||
        t('ai.agentCore.emptyReply', { rounds: String(res.rounds) }),
      ...(s.currentReasoning ? { reasoning: s.currentReasoning } : {}),
      ...(trace.length > 0 ? { trace } : {}),
      ...(turnMs ? { turnMs } : {}),
    }
    useAiStore.setState({
      messages: [...s.messages, msg],
      streaming: false,
      currentChunk: '',
      currentReasoning: '',
      toolCalls: [],
      runStartedAt: 0,
      agentStages: [],
    })
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
}

export const useAiStore = create<AiState>((set, get) => {
  /** 把当前扁平字段打包成一份会话记录 */
  const viewOf = (): ProjectConversation => {
    const s = get()
    return {
      messages: s.messages,
      streaming: s.streaming,
      mainProcessRunning: s.mainProcessRunning,
      currentChunk: s.currentChunk,
      currentReasoning: s.currentReasoning,
      runStartedAt: s.runStartedAt,
      isBatchMode: s.isBatchMode,
      batchSnapshot: s.batchSnapshot,
      toolCalls: s.toolCalls,
      agentState: s.agentState,
      agentStep: s.agentStep,
      agentStages: s.agentStages,
      todos: s.todos,
      currentProposal: s.currentProposal,
      stats: s.stats,
    }
  }

  /** 把一份会话记录写进扁平字段（视图） */
  const viewPatch = (c: ProjectConversation): Partial<AiState> => ({ ...c })

  /**
   * 把一次会话更新应用到**指定项目**。
   *
   * · 目标就是当前项目（或没给 projectPath）→ 更新视图字段
   * · 目标是**别的项目** → 写进那个项目的存档，**不碰当前视图**
   *
   * 这一步取代了原先的 `if (filterProject(...)) return;` —— 那种写法的后果是
   * "别的项目正在跑的那轮记录直接丢掉"，切回去就只剩空白。
   */
  const routeTo = (
    projectPath: string | undefined,
    fn: (c: ProjectConversation) => ProjectConversation,
  ): void => {
    const s = get()
    /**
     * ⚠️ "当前项目"的判定是 `conversationPath || 当前打开的项目` ——
     * 不能只看 `conversationPath`：面板挂载前的第一帧它是空的，
     * 那时候**当前项目**的事件会被误判成"别的项目"，界面上就什么都不显示。
     */
    const current = s.conversationPath || currentProjectPath()
    if (!projectPath || !current || projectPath === current) {
      set({
        ...viewPatch(fn(viewOf())),
        // 第一次事件就把视图绑定到当前项目（维持"扁平字段 ≡ 该项目的视图"）
        ...(s.conversationPath ? {} : { conversationPath: current }),
      })
      return
    }
    const target = s.conversations[projectPath] ?? emptyConversation()
    set({ conversations: { ...s.conversations, [projectPath]: fn(target) } })
  }

  /**
   * 把"主进程已经收尾"的通知并进会话：提交半截文本 → 追加一条说明 → 复位流式态。
   *
   * ## 为什么必须收在一个函数里（2026-10-06 审查发现）
   *
   * 收尾有**四条**路径：response / proposal / error / warning。以前各写各的 ——
   * 其中 proposal（主进程在"有提案"时**只发 ai:proposal、不发 ai:response**）与
   * error/warning（preload 里连监听都没有）两条**忘了复位 streaming**。
   * 表现是：出过一次提案、或任何一次运行期报错之后，输入框**永久禁用**
   * （disabled 的控件不派发键盘事件，Escape 也救不回来，只能刷新页面）。
   */
  const finalizeTurn = (
    c: ProjectConversation,
    note: string | null,
    agentState: AgentState,
  ): ProjectConversation => {
    const trace = traceOf(c.toolCalls)
    const turnMs = c.runStartedAt ? Date.now() - c.runStartedAt : 0
    let messages = c.messages
    if (c.streaming && c.currentChunk) {
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: c.currentChunk,
          ...(c.currentReasoning ? { reasoning: c.currentReasoning } : {}),
          ...(trace.length ? { trace } : {}),
          ...(turnMs ? { turnMs } : {}),
        },
      ]
    } else if (trace.length > 0) {
      // 没有正文但用过工具（真机常见：查了一堆然后只说了句"现在开始…"）——
      // 也要留下"它干了什么"，否则这一轮在界面上就等于没发生。
      messages = [
        ...messages,
        { role: 'assistant', content: '', trace, ...(turnMs ? { turnMs } : {}) },
      ]
    }
    if (note) messages = [...messages, { role: 'system', content: note }]
    // toolCalls 移交给消息后清空：下一次发送不该再把它们挂到新消息上
    return {
      ...c,
      messages,
      streaming: false,
      currentChunk: '',
      currentReasoning: '',
      runStartedAt: 0,
      agentState,
      toolCalls: [],
    }
  }

  return {
    messages: [],
    // 与 conversations 里的同名字段互为镜像（streaming 也是这个模式）
    mainProcessRunning: false,
    agentStages: [],
    pendingApproval: null,
    streaming: false,
    currentChunk: '',
    currentReasoning: '',
    runStartedAt: 0,
    isBatchMode: false,
    batchSnapshot: null,
    toolCalls: [],
    agentState: { state: 'idle' },
    agentStep: null,
    todos: [],
    currentProposal: null,
    conversations: {},
    conversationPath: '',
    threads: [],
    activeThreadId: 'default',
    agentModeOverride: null,
    planFirst: false,
    preset: null,
    presetByThread: {},
    fullAccess: false,
    allowRules: [],
    threadsError: null,
    allThreads: [],
    knownProjects: [],

    switchConversation: projectPath => {
      const s = get()
      if (!projectPath || s.conversationPath === projectPath) return
      // 存回旧项目（conversationPath 为空 = 还没绑定过项目，不用存）
      const conversations = { ...s.conversations }
      if (s.conversationPath) conversations[s.conversationPath] = viewOf()
      set({
        conversations,
        conversationPath: projectPath,
        ...viewPatch(conversations[projectPath] ?? emptyConversation()),
      })
      // 预设也是项目/线程级视图：切项目后按"新项目 + 当前线程"恢复，别把旧项目的选择带过来
      const next = get()
      set({ preset: next.presetByThread[projectPath + '::' + next.activeThreadId] ?? null })
    },

    /**
     * 把磁盘上的对话记忆读回界面（2026-10-06）。
     *
     * 背景：主进程会把每轮写进 `<项目>/.qqbat/ai-history.jsonl`，而渲染层这份是内存态 ——
     * 重启之后出现最别扭的组合：**界面空白、模型却记得**，用户既看不到也翻不回去。
     */
    lastAttempt: null,
    clearLastAttempt: () => set({ lastAttempt: null }),
    loadHistoryFromDisk: async (projectPath, opts) => {
      if (!projectPath) return
      if (typeof window.qqbat?.ai?.getHistory !== 'function') return
      const existing = get().conversations[projectPath]
      const flatBelongs = (get().conversationPath || currentProjectPath()) === projectPath
      // 界面这份已经有内容 → 不覆盖（历史只是"别让界面空着"）
      // force = 刚切线程 / 刚清空：界面这份已经不是当前线程的 → 必须重新读
      if (!opts?.force && (existing?.messages.length || (flatBelongs && get().messages.length)))
        return
      try {
        const res = await window.qqbat.ai.getHistory(projectPath, get().activeThreadId)
        if (!res.ok || !res.data) return
        const entries: Array<{
          role: 'user' | 'assistant' | 'attempt'
          content: string
          ts: string
          reason?: 'error' | 'cancelled'
          /** 下面三样是**界面回看用的过程痕迹**（模型历史读侧不含，见 historyStore 的 includeUi） */
          reasoning?: string
          trace?: Array<{
            name: string
            args: Record<string, unknown>
            status?: 'done' | 'error'
            result?: string
          }>
          turnMs?: number
        }> = res.data.entries
        /**
         * **失败尝试**（attempt）不当对话气泡显示：它进日志是为了可追溯。
         * 只取"最后一条且后面没有新对话"的那条 —— 用户已经继续聊了就不该再挂旧报错。
         */
        let attemptAt = -1
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          if (entries[i].role === 'attempt') {
            attemptAt = i
            break
          }
        }
        const lastAttempt =
          attemptAt >= 0 && entries.slice(attemptAt + 1).every(e => e.role === 'attempt')
            ? entries[attemptAt]
            : null
        set({
          lastAttempt: lastAttempt
            ? {
                projectPath,
                content: lastAttempt.content,
                reason: lastAttempt.reason ?? 'error',
              }
            : null,
        })
        const loaded: ChatMessage[] = entries
          // `[系统回执] …` 是主进程写进记忆的"计划处置回执"（给模型看的），不该假冒用户说话
          .filter(e => e.role !== 'attempt' && !e.content.startsWith(AI_TURN_NOTE_PREFIX))
          .map((e, i): ChatMessageWithTrace => ({
            role: e.role === 'assistant' ? 'assistant' : 'user',
            // 记忆文件里那条 `[本轮提出的操作] N 个待确认操作` 是**给模型看的元信息**
            // （预算裁剪时它必须活下来）。显示在聊天气泡里像乱码，所以读回界面时去掉。
            content: e.content.replace(/\n*\[本轮提出的操作\][^\n]*/g, '').trim(),
            // 痕迹只在有值时挂：老历史没有这些字段，别塞空数组让每条消息都长出一条过程行
            ...(e.reasoning ? { reasoning: e.reasoning } : {}),
            ...(e.turnMs ? { turnMs: e.turnMs } : {}),
            ...(e.trace && e.trace.length > 0
              ? {
                  trace: e.trace.map((tr, k): ToolTraceEntry => ({
                    id: `hist-${i}-${k}`,
                    name: tr.name,
                    args: tr.args ?? {},
                    status: tr.status === 'error' ? 'error' : 'done',
                    result: tr.result,
                  })),
                }
              : {}),
          }))
          .filter(m => m.content.length > 0)
        if (loaded.length === 0) return
        routeTo(projectPath, c => ({ ...c, messages: loaded }))
      } catch (e) {
        // 读不回来就当"这次没有历史"：不该因为记忆读失败而挡住用户提问。
        // 日志用英文：这一层所在目录有"不许硬编码中文界面文案"的闸门（同 refreshMainRunning）
        console.error('[aiStore] failed to load conversation history', e)
      }
    },

    addMessage: msg => set(s => ({ messages: [...s.messages, msg] })),

    appendChunk: text =>
      // streaming:false 时忽略后续 chunk（用户按 Escape 中断后，后端可能仍在推送）
      set(s => (s.streaming ? { currentChunk: s.currentChunk + text } : s)),

    finishStreaming: () =>
      set(s => {
        // stopStreaming 已经把 streaming 置为 false 并清空 currentChunk，这里幂等返回
        if (!s.streaming) return s
        if (!s.currentChunk) return { streaming: false, currentChunk: '', currentReasoning: '' }
        const trace = traceOf(s.toolCalls)
        const turnMs = s.runStartedAt ? Date.now() - s.runStartedAt : 0
        const finalMsg: ChatMessageWithTrace = {
          role: 'assistant',
          content: s.currentChunk,
          ...(s.currentReasoning ? { reasoning: s.currentReasoning } : {}),
          ...(trace.length ? { trace } : {}),
          ...(turnMs ? { turnMs } : {}),
        }
        return {
          messages: [...s.messages, finalMsg],
          streaming: false,
          currentChunk: '',
          currentReasoning: '',
          toolCalls: [],
          runStartedAt: 0,
        }
      }),

    refreshMainRunning: async () => {
      const projectPath = get().conversationPath || currentProjectPath()
      if (!projectPath || typeof window.qqbat?.ai?.isRunning !== 'function') return
      try {
        const r = await window.qqbat.ai.isRunning(projectPath)
        if (r?.ok && r.data) set({ mainProcessRunning: r.data.running })
      } catch (e) {
        // 问不到就当"不知道"，不要据此改 UI（宁可多给一个能点的停止，也别假装没有在跑）
        // 日志用英文：这一层所在目录有"不许硬编码中文界面文案"的闸门
        console.error('[refreshMainRunning] failed to read main-process state', e)
      }
    },

    resolvePendingApproval: async decision => {
      const cur = get().pendingApproval
      if (!cur) return
      // 先把确认条收掉（点完立刻消失），再回主进程；主进程没生效会返回 applied=false
      set({ pendingApproval: null })
      try {
        const res = await window.qqbat?.ai?.resolveApproval?.(cur.callId, decision)
        if (res && res.ok === false)
          console.error('[approval] main process rejected the decision:', res.error)
      } catch (e) {
        console.error('[approval] failed to send decision:', e)
      }
    },

    stopStreaming: () => {
      /**
       * ⚠️ **先真的让主进程停下**，再收尾本地视图（2026-10-01 补）。
       *
       * 以前只做后半截：界面拼一句「已中断」、streaming 置 false —— 而主进程
       * 照跑满 10 轮（工具还在调、mutation 还在累积）。主进程取消入口的注释里
       * 描述的正是这个 bug，只是那句注释用的是过去时。
       */
      const projectPath = get().conversationPath || currentProjectPath()
      if (projectPath && typeof window.qqbat?.ai?.cancelChat === 'function') {
        void window.qqbat.ai
          .cancelChat(projectPath)
          .catch(e => console.error('[stopStreaming] 取消失败（主进程可能仍在跑）', e))
      }
      // 取消之后再问一次主进程的真实状态（`ai:isRunning`）—— 界面不该"以为停了"
      void get().refreshMainRunning()
      set(s => {
        if (!s.streaming) return s
        if (!s.currentChunk) {
          return { streaming: false, agentState: { state: 'idle' } }
        }
        const trace = traceOf(s.toolCalls)
        const turnMs = s.runStartedAt ? Date.now() - s.runStartedAt : 0
        const finalMsg: ChatMessageWithTrace = {
          role: 'assistant',
          content: s.currentChunk + t('ai.ops.interrupted'),
          ...(s.currentReasoning ? { reasoning: s.currentReasoning } : {}),
          ...(trace.length ? { trace } : {}),
          ...(turnMs ? { turnMs } : {}),
        }
        return {
          messages: [...s.messages, finalMsg],
          streaming: false,
          currentChunk: '',
          currentReasoning: '',
          toolCalls: [],
          runStartedAt: 0,
          agentState: { state: 'idle' },
        }
      })
    },

    clearMessages: () =>
      set({
        messages: [],
        currentChunk: '',
        toolCalls: [],
        agentState: { state: 'idle' },
        currentProposal: null,
        // 清空 = 回到"没在跑"的样子。漏掉 streaming 的后果是：流式中点清空，
        // 消息没了但仍显示"思考中"、输入框仍禁用（2026-10-06 审查发现）。
        streaming: false,
        isBatchMode: false,
        batchSnapshot: null,
      }),

    setMessages: msgs => set({ messages: msgs }),

    /**
     * 拉取任务线程列表。
     *
     * 列表由主进程**扫目录派生**（标题 = 每条线程第一条用户消息），
     * 所以这里不需要维护任何"本地名单" —— 磁盘上有什么就是什么。
     */
    setKnownProjects: projects => {
      set({ knownProjects: projects })
      void get().loadAllThreads()
    },

    // 切线程 = 恢复该线程当初选的预设（预设是"会话级"的，不该跟着项目全局漂）
    setActiveThread: threadId =>
      set(state => ({
        activeThreadId: threadId,
        preset: state.presetByThread[state.conversationPath + '::' + threadId] ?? null,
      })),

    setAgentModeOverride: mode => set({ agentModeOverride: mode }),

    setPlanFirst: on => set({ planFirst: on }),
    // 预设是**线程级**选择：写当前线程的槽位，扁平字段只做"当前视图"
    setPreset: name =>
      set(state => ({
        preset: name,
        presetByThread: {
          ...state.presetByThread,
          [state.conversationPath + '::' + state.activeThreadId]: name,
        },
      })),
    setFullAccess: on => set({ fullAccess: on }),

    steer: async (projectPath, text, target = 'step') => {
      if (!projectPath || !text.trim()) return false
      try {
        const res = await window.qqbat.ai.agentCoreSteer(projectPath, text, target)
        if (!res.ok) {
          console.error('[aiStore] steer failed', res.error)
          return false
        }
        return true
      } catch (e) {
        console.error('[aiStore] steer failed', e)
        return false
      }
    },

    loadAllowRules: async projectPath => {
      if (!projectPath) return
      try {
        const res = await window.qqbat.ai.getAllowRules(projectPath)
        if (res.ok && res.data) set({ allowRules: res.data.rules })
        else if (!res.ok) console.error('[aiStore] getAllowRules failed', res.error)
      } catch (e) {
        console.error('[aiStore] getAllowRules failed', e)
      }
    },

    removeAllowRule: async (kind, match) => {
      const projectPath = get().conversationPath || currentProjectPath()
      if (!projectPath) return
      try {
        const res = await window.qqbat.ai.removeAllowRule(projectPath, kind, match)
        if (res.ok && res.data) set({ allowRules: res.data.rules })
        else if (!res.ok) console.error('[aiStore] removeAllowRule failed', res.error)
      } catch (e) {
        console.error('[aiStore] removeAllowRule failed', e)
      }
    },

    clearAllowRules: async () => {
      const projectPath = get().conversationPath || currentProjectPath()
      if (!projectPath) return
      try {
        const res = await window.qqbat.ai.clearAllowRules(projectPath)
        if (res.ok && res.data) set({ allowRules: res.data.rules })
        else if (!res.ok) console.error('[aiStore] clearAllowRules failed', res.error)
      } catch (e) {
        console.error('[aiStore] clearAllowRules failed', e)
      }
    },

    /**
     * 拉取**所有项目**的对话（工作区列表）。
     *
     * 并行拉，但**结果按 knownProjects 的顺序排** —— Promise.all 的完成顺序不确定，
     * 直接用会让列表每次刷新都换位置。
     */
    loadAllThreads: async () => {
      const projects = get().knownProjects
      if (typeof window.qqbat?.ai?.listThreads !== 'function') {
        // preload 没更新（老窗口 / 没重启）—— 说清楚，别装作「没有对话」
        set({ threads: [], allThreads: [], threadsError: 'ipc-missing' })
        return
      }
      if (projects.length === 0) {
        set({ threads: [], allThreads: [], threadsError: 'no-project' })
        return
      }
      /**
       * 取当前项目要**容错**：它内部走 useProjectStore.getState()，
       * 那一下一旦抛（store 未挂 / 测试里的假 store），整个列表会**静默变空** ——
       * 而空列表看起来和「确实没有对话」一模一样（2026-10-09 排查了整个来回）。
       */
      let current = ''
      try {
        current = currentProjectPath()
      } catch {
        current = ''
      }
      const fetched = new Map<string, ThreadInfo[]>()
      let error: string | null = null
      await Promise.all(
        projects.map(async p => {
          try {
            const res = await window.qqbat.ai.listThreads(p.path)
            if (res.ok && res.data) fetched.set(p.path, res.data.threads)
            else error ??= res.error ?? 'unknown'
          } catch (e) {
            error ??= e instanceof Error ? e.message : String(e)
          }
        }),
      )
      const allThreads = projects.map(p => ({
        projectPath: p.path,
        projectName: p.name,
        threads: fetched.get(p.path) ?? [],
      }))
      set({
        allThreads,
        // 当前项目那一组同步到 threads（老调用点还在读它）
        threads: allThreads.find(g => g.projectPath === current)?.threads ?? [],
        threadsError: error,
      })
    },

    /** 兼容旧调用点：先把它记进 knownProjects，再整体刷新 */
    loadThreads: async projectPath => {
      const known = get().knownProjects
      if (projectPath && !known.some(p => p.path === projectPath)) {
        const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath
        set({ knownProjects: [...known, { path: projectPath, name }] })
      }
      if (!projectPath && get().knownProjects.length === 0) {
        set({ threads: [], threadsError: 'no-project' })
        return
      }
      await get().loadAllThreads()
    },

    /**
     * 改线程标题（第 56 批）。
     *
     * 为什么**乐观更新**而不是等 `loadThreads` 回来：标题是用户刚敲完的那句话，
     * 列表慢半拍才变会像"没生效"；落盘失败时返回 error 给界面提示，旧标题一个字没动。
     */
    renameThread: async (projectPath, threadId, title) => {
      if (typeof window.qqbat?.ai?.renameThread !== 'function') {
        return { ok: false, error: 'ipc-missing' }
      }
      try {
        const res = await window.qqbat.ai.renameThread(projectPath, threadId, title)
        if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'unknown' }
        const nextTitle = res.data.title
        const patch = (th: ThreadInfo): ThreadInfo =>
          th.id === threadId ? { ...th, title: nextTitle, titleSource: 'user' } : th
        set(st => ({
          threads: st.threads.map(patch),
          allThreads: st.allThreads.map(g =>
            g.projectPath === projectPath ? { ...g, threads: g.threads.map(patch) } : g,
          ),
        }))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    /**
     * 搜线程正文（第 57 批）。
     *
     * 为什么不把结果塞进 `threads`：搜索结果带"命中片段"，与列表项不是同一种东西
     * （列表项没有片段、也不该被搜索临时改写）。调用方自己持有结果，关掉搜索就丢掉。
     */
    searchThreads: async (projectPath, query) => {
      if (typeof window.qqbat?.ai?.searchThreads !== 'function') {
        return { ok: false, error: 'ipc-missing' }
      }
      try {
        const res = await window.qqbat.ai.searchThreads(projectPath, query)
        if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'unknown' }
        return { ok: true, results: res.data.results as ThreadSearchMatch[] }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    /**
     * 删一条线程（第 57 批：把一直没入口的 `ai:clearThread` 接上界面）。
     *
     * 删的是记忆文件，不可撤销 —— 界面上必须先问一次（行内二次确认），这里只负责删。
     * 删**当前**线程时切回 `default`：界面还停在一条已经不存在的线上，下一步发消息
     * 就会"接着一段已经被删掉的记忆"继续说，那是最难解释的状态。
     */
    deleteThread: async (projectPath, threadId) => {
      if (typeof window.qqbat?.ai?.clearThread !== 'function') {
        return { ok: false, error: 'ipc-missing' }
      }
      try {
        const res = await window.qqbat.ai.clearThread(projectPath, threadId)
        if (!res.ok) return { ok: false, error: res.error ?? 'unknown' }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      if (projectPath && get().activeThreadId === threadId) {
        await get().switchThread(projectPath, 'default')
      }
      if (projectPath) await get().loadThreads(projectPath)
      return { ok: true }
    },

    /**
     * 开一条**新任务**。
     *
     * 换任务 = 换线程：界面清空、后续消息写进新文件；**老线程留在磁盘上**，
     * 在列表里随时能切回去看（这正是"同一个项目切换 AI 上下文"要的东西）。
     */
    newThread: projectPath => {
      const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      // 走 setActiveThread 而不是直接 set：新线程的预设槽位也要跟着切（第 50 批）
      get().setActiveThread(id)
      get().clearMessages()
      if (projectPath) {
        set(st => ({
          conversations: { ...st.conversations, [projectPath]: emptyConversation() },
        }))
      }
    },

    /** 切到某条线程：从磁盘读回它的记忆（force 绕过"界面已有内容就不覆盖"的保护） */
    switchThread: async (projectPath, threadId) => {
      if (!projectPath) return
      // 同上：切换线程时恢复该线程的预设（第 50 批修掉"切线程后 preset 不跟"）
      get().setActiveThread(threadId)
      get().clearMessages()
      set(st => ({
        conversations: { ...st.conversations, [projectPath]: emptyConversation() },
      }))
      await get().loadHistoryFromDisk(projectPath, { force: true })
    },

    /**
     * **真的**清空当前线程的记忆（界面 + 磁盘）。
     *
     * 在此之前界面的「清空」只清渲染层 state，磁盘一个字没动 ——
     * 用户点完清空、下一轮助手照样把历史读回来（"它是同一个记忆的"）。
     */
    clearActiveThread: async projectPath => {
      if (!projectPath) return
      const threadId = get().activeThreadId
      try {
        if (typeof window.qqbat?.ai?.clearThread === 'function') {
          const res = await window.qqbat.ai.clearThread(projectPath, threadId)
          if (!res.ok) console.error('[aiStore] clearThread failed', res.error)
        }
      } catch (e) {
        console.error('[aiStore] clearThread failed', e)
      }
      get().clearMessages()
      set(st => ({
        conversations: { ...st.conversations, [projectPath]: emptyConversation() },
      }))
      await get().loadThreads(projectPath)
    },

    sendMessage: async (rawProjectPath, text, images, agentMode) => {
      /**
       * ── 项目对齐（P0：2026-10-06 真机事故）────────────────────────────
       *
       * AI 会话可能还停在**别的项目**（面板自己选项目 / 上次会话残留），而画布是另一个：
       * 于是模型读的是 A 的流程、提的计划基于 A、磁盘落盘也可能写到 A ——
       * 用户却看着 B，体感就是「**它不会生成节点**」（其实是它在另一个项目里生成）。
       *
       * 口径：**你说的项目 = 你看着的那个**。画布是 B 就以 B 为准，并明确告警。
       */
      const canvasPath = useProjectStore.getState().currentProject?.path
      let projectPath = rawProjectPath
      if (canvasPath && projectPath && canvasPath !== projectPath) {
        console.warn(
          '[aiStore] conversation project differs from the canvas project; aligning to the canvas',
          { conversation: projectPath, canvas: canvasPath },
        )
        projectPath = canvasPath
      }

      /**
       * ── 架构：**读盘前先冲刷**（单一事实源的屏障）────────────────────
       *
       * 编辑期的权威在**渲染层**（`flowStore` 的内存图），而主进程的 AI 链路读**磁盘**：
       * 上下文组装（`ai/context.ts`）、预览图（`ai/pendingContext.ts`）、
       * 提案校验基线（`ai/proposalValidation.ts`）、`read_flow` 全是。
       * 而自动保存有 **1.5s 防抖** —— 于是：
       *
       *     用户改完画布立刻问 AI → 主进程读到的是**上次保存时的图**
       *     → 它提出的改动、校验的基线，都与用户眼前的画布对不上
       *
       * 「运行」那条链**已经有屏障**（`saveNow(force: true)`），只是没用到 AI 这条链上。
       *
       * 用**非 force** 是刻意的：干净时它是 no-op（返回 true）、有改动才写、
       * 加载失败时拒绝落盘（防"空画布覆盖作品"）—— 不会为了同步引入新的数据丢失风险。
       * 冲刷失败不阻断对话（用户还是要能问问题），但会留下日志。
       */
      // ⚠️ 开荒模式（没有项目）**不要冲刷画布**：空路径可能拼出相对路径去写盘。
      // 没有项目 = 没有画布可冲，跳过是正确行为而不是省事。
      if (projectPath) {
        try {
          await useFlowStore.getState().saveNow(projectPath)
        } catch (e) {
          console.error('[aiStore] AI 对话前冲刷画布失败（AI 可能看到旧图）', e)
        }
      }

      /**
       * ⚠️ 顺序：**先切项目，再清工具卡**。
       *
       * 反过来的话（2026-10-06 审查发现）：clearToolCalls 清的是**上一个项目**的视图字段
       * ——此刻 conversationPath 还没换；紧接着 switchConversation 又把这份"已清空"的状态
       * 存档覆盖旧项目，而目标项目自己那几张旧卡被原样装载进来，挂在最新一条消息下面，
       * 看起来像本轮调用。副作用是"跨项目丢工具记录 + 旧卡串进新一轮"。
       */
      get().switchConversation(projectPath)
      get().clearToolCalls()
      const { addMessage } = get()
      addMessage({ role: 'user', content: text, ...(images?.length ? { images } : {}) })
      // 新一轮开始：清掉上一轮的多智能体阶段进度
      set({ streaming: true, currentChunk: '', agentStages: [], runStartedAt: Date.now() })
      /**
       * 用户当前在代码编辑器里打开的文件 —— 两条链路都要送（"帮我改这个文件"里的"这个"）。
       * 这里**不按页面过滤**：「哪些模式用得上它」是主进程的规则（角色 = 页面/模式），
       * 渲染层再判一次只会让两边漂移。没打开文件时是 undefined（schema 可选）。
       */
      const activeFilePath = useEditorStore.getState().activeFilePath
      /**
       * **循环是唯一入口**（2026-10-20 合并双引擎第 3 步；2026-10-25 收口开荒）。
       *
       * 有项目 → workspace-first 循环：自己读/写/跑/校验，每个写盘动作都过审批。
       * **没有项目 → 同一条循环的开荒装配**（工具只剩能力发现/提议，不碰磁盘）：
       * 用户第一句话"帮我做个 XX 机器人"从这里就开始积累同一种体验，
       * 而不是开荒一套 AI、进了项目又换一套。
       *
       * 渲染层只剩这一条路 —— 下一句在项目建好后自然还是它（projectPath 从空变有）。
       */
      /**
       * M5 按模式分专家：把**当前页面**一起送过去（低代码页 = 改流程，代码页 = 改代码）。
       * 页面边界是产品事实（用户眼前是什么），不该让模型从措辞里猜。
       *
       * 两条链路**都在这里**算一次：调用方显式给了角色就用它（界面下拉），
       * 没给就按页面推 —— 否则"从别处调 sendMessage"会静默丢掉角色（循环里就成了
       * "工具全开、没有角色提示词"，与助手链路的行为对不上）。
       */
      const centerTab = useUiStore.getState().centerTab
      const mode = agentMode ?? resolveAgentMode(centerTab, get().agentModeOverride)
      await runAgentCoreTurn(projectPath, text, mode, images, activeFilePath)
    },

    // ====== 事务性 batch 操作 ======

    beginBatch: async () => {
      const snapshot = useFlowStore.getState().snapshot()
      try {
        await window.qqbat.ai.beginBatch(get().conversationPath || currentProjectPath())
        // 仅在 IPC 成功后才标记本地 batch 模式，避免本地进入 batch 但后端未进入导致状态不一致
        set({ isBatchMode: true, batchSnapshot: snapshot })
        /**
         * 主进程 30 秒后会**自动提交**（防死锁），但它不会通知渲染层 ——
         * 于是界面横幅一直挂着"事务操作中…30 秒后自动提交"（真机截图里就是）。
         * 这里用**同一个超时常量**（@shared/types/ai）自己收尾，两边不会各说各话。
         */
        clearBatchTimer()
        batchTimer = setTimeout(() => {
          batchTimer = null
          if (get().isBatchMode) set({ isBatchMode: false, batchSnapshot: null })
        }, AI_BATCH_TIMEOUT_MS)
      } catch (e) {
        console.error('[beginBatch] IPC 调用失败，未进入 batch 模式', e)
        set({ agentState: { state: 'error', message: t('ai.ops.beginBatchFailed') } })
      }
    },

    commitBatch: async () => {
      try {
        await window.qqbat.ai.commitBatch(get().conversationPath || currentProjectPath())
      } catch (e) {
        console.error('[commitBatch] IPC 调用失败', e)
        set({ agentState: { state: 'error', message: t('ai.ops.commitBatchFailed') } })
      } finally {
        clearBatchTimer()
        set({ isBatchMode: false, batchSnapshot: null })
      }
    },

    rollbackBatch: async projectPath => {
      const { batchSnapshot } = get()
      try {
        if (batchSnapshot) {
          useFlowStore.getState().rollback(batchSnapshot)
        }
        // 主进程回滚**必须指名项目**：默认取"当前会话"会把别的项目的失败回滚到自己头上
        await window.qqbat.ai.rollbackBatch(
          projectPath || get().conversationPath || currentProjectPath(),
        )
      } catch (e) {
        console.error('[rollbackBatch] IPC 调用失败', e)
        set({ agentState: { state: 'error', message: t('ai.ops.rollbackBatchFailed') } })
      } finally {
        clearBatchTimer()
        set({ isBatchMode: false, batchSnapshot: null })
      }
    },

    addToolCall: call => set(s => ({ toolCalls: [...s.toolCalls, call] })),

    updateToolCall: (id, partial) =>
      set(s => ({
        toolCalls: s.toolCalls.map(tc => (tc.id === id ? { ...tc, ...partial } : tc)),
      })),

    clearToolCalls: () => set({ toolCalls: [] }),

    setAgentState: state => set({ agentState: state }),

    // ====== Proposal 累积与确认 ======

    setProposal: p => set({ currentProposal: p }),

    rejectProposal: () => {
      // ③ 变更回执：拒绝也要回 —— 否则它下一轮会把同一份计划再提一遍
      void window.qqbat.ai
        .noteTurn?.(
          get().conversationPath || currentProjectPath(),
          AI_NOTE_REJECTED,
          get().activeThreadId,
        )
        ?.catch((e: unknown) => {
          // 回执写失败 = 模型下一轮不知道计划被拒了，会把同一份再提一遍。
          // 不弹 toast（用户没做错事，弹窗只会吓人），但在对话里留一条可见说明 + 记日志。
          console.error('[ai] noteTurn failed:', e)
          get().addMessage({ role: 'system', content: t('ai.chat.turnNoteFailed') })
        })
      set({ currentProposal: null })
    },

    applyProposal: async ops => {
      // Issue 7: 空 ops 跳过 autoLayout
      if (ops.length === 0) {
        set({ currentProposal: null })
        return
      }
      /**
       * ⚠️ **画布必须属于这次会话的项目**（2026-10-15 P0 数据丢失事故的**主因**）。
       *
       * 真机现场：用户在 AI 对话页 / 代码页**切了项目** —— 而画布只在低代码页挂载时才重载，
       * 于是 flowStore 还握着**上一个项目**的图。此时在 B 项目里生成的提案被应用到 A 项目的
       * 画布上（本函数原来只校验「有没有项目」，不校验「画布是不是这个项目的」）→ 图变脏 →
       * 1.5s 防抖自动保存把 A 项目的图整份写回 A 项目。用户看到的是「我没动它，它却变了」。
       *
       * 主进程那道闸门（services/flow/flow.ts 的隐式保存校验）是**兜底**：它能拦住「写到没打开的
       * 项目」，却拦不住「写回本项目、内容却是别的项目的」。所以真正的判据在这里。
       */
      const canvasProject = useFlowStore.getState().loadedProjectPath
      const sessionProject = get().conversationPath || currentProjectPath()
      if (canvasProject && sessionProject && canvasProject !== sessionProject) {
        set({ currentProposal: null })
        console.error(
          '[ai] refusing to apply: canvas project differs from the conversation project',
          {
            canvasProject,
            sessionProject,
          },
        )
        get().addMessage({
          role: 'system',
          content: t('ai.apply.projectMismatch', {
            canvas: canvasProject,
            session: sessionProject,
          }),
        })
        return
      }

      /**
       * 这批操作**是否碰到图**（画布）。
       *
       * `write_code` / `generate_code` / `capability` 不改画布 —— 为它们跑流程校验，
       * 只会把项目里的**存量**问题当成"这次改坏的"报给用户（误伤）。见下面的 P1-4。
       */
      const touchesGraph = ops.some(
        op => op.kind !== 'write_code' && op.kind !== 'generate_code' && op.kind !== 'capability',
      )

      const flowStore = useFlowStore.getState()
      const snapshot = flowStore.snapshot()
      const refToId = new Map<string, string>()
      const diskOps: ProposalOperation[] = []
      const addedNodeIds: string[] = [] // 阶段 3：追踪本批新增节点，用于自动布局 + 聚焦

      // Issue 2: 两阶段执行 — Phase 1 流程操作（可回滚）
      // C 修复：批量抑制逐条历史——单个 op 不再各自压栈，整个 proposal 成功后在
      // 结束抑制时整体压一次批前快照（一个撤销单元）；失败回滚时 _past 未动，无幻影历史
      beginHistoryBatch()
      try {
        for (const op of ops) {
          if (op.kind === 'add_node') {
            const node = createNode(op.nodeKind, { x: 0, y: 0 })
            if (op.label) node.data.label = op.label
            // 备注：画布显示在节点名下方（AI 的意图写这里，而不是塞进标题）
            if (op.description) node.data.description = op.description
            if (op.config) node.data.config = { ...node.data.config, ...op.config }
            refToId.set(op.tempRef, node.id)
            addedNodeIds.push(node.id)
            flowStore.addNode(node)
          } else if (op.kind === 'connect') {
            // refToId 回退到原 ref 时，ref 可能是已存在节点的 ID，也可能是无效字符串。
            // 校验节点是否真实存在，避免创建悬空边（source/target 指向不存在的节点）。
            const sourceId = refToId.get(op.sourceRef) ?? op.sourceRef
            const targetId = refToId.get(op.targetRef) ?? op.targetRef
            const { nodes } = useFlowStore.getState()
            if (!nodes.some(n => n.id === sourceId)) {
              throw new Error(t('ai.ops.sourceRefMissing', { ref: op.sourceRef }))
            }
            if (!nodes.some(n => n.id === targetId)) {
              throw new Error(t('ai.ops.targetRefMissing', { ref: op.targetRef }))
            }
            flowStore.addEdge(createEdge(sourceId, op.sourcePortId, targetId, op.targetPortId))
          } else if (op.kind === 'apply_template') {
            // 套用片段：与界面「片段」按钮走同一条路（insertTemplate）
            const ids = insertPresetTemplate(op.templateId)
            if (!ids) throw new Error(t('ai.ops.unknownTemplate', { id: op.templateId }))
            addedNodeIds.push(...ids)
          } else if (op.kind === 'new_lookup') {
            // 新建查询：与界面向导走同一条路（含那条伪源配置绑定边）
            const ids = insertConfigQueryChain({
              command: op.command,
              table: op.table,
              dbPath: op.dbPath,
              field: op.field,
              matchField: op.matchField ?? '',
              reply: op.reply,
            })
            addedNodeIds.push(...ids)
          } else if (op.kind === 'new_command') {
            // 新建指令：与界面向导走同一条路（insertCommandChain）
            const ids = insertCommandChain({
              command: op.command,
              reply: op.reply,
              ...(op.dataMode ? { dataMode: op.dataMode } : {}),
              ...(op.dataKey ? { dataKey: op.dataKey } : {}),
            })
            addedNodeIds.push(...ids)
          } else if (op.kind === 'update_config') {
            // 三样都能改：配置 / 标题 / 备注（原先只应用 config，工具上的 label 白给）
            if (op.config) flowStore.updateNodeConfig(op.nodeRef, op.config)
            if (op.label) flowStore.updateNodeLabel(op.nodeRef, op.label)
            if (op.description) flowStore.updateNodeDescription(op.nodeRef, op.description)
          } else if (op.kind === 'delete_node') {
            flowStore.removeNode(op.nodeRef)
          } else if (
            op.kind === 'write_code' ||
            op.kind === 'generate_code' ||
            op.kind === 'capability'
          ) {
            // 磁盘操作 / 能力调用都延迟到 Phase 2（外部副作用不能夹在图操作中间）
            diskOps.push(op)
          } else {
            // Issue 10: 未知 kind
            throw new Error(t('ai.ops.unknownKind', { kind: (op as { kind: string }).kind }))
          }
        }
      } catch (e) {
        endHistoryBatch()
        flowStore.rollback(snapshot)
        // Issue 1: catch 路径清理 currentProposal + 透出错误
        set({ currentProposal: null })
        // 把**具体原因**带上：只说"失败了"用户没法判断是"AI 提的操作有问题"还是"程序坏了"。
        // （2026-10-06：`apply_template` 传了不存在的片段 id 时，用户只看到一句"已回滚"，
        //  完全不知道该让 AI 改什么。）
        set({
          agentState: {
            state: 'error',
            message: t('ai.ops.proposalRolledBackReason', {
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        })
        console.error('proposal 流程操作失败，已回滚', e)
        return
      }
      // 流程操作全部成功：批前快照作为单一撤销单元
      endHistoryBatch()
      pushHistoryPoint(snapshot.nodes, snapshot.edges)

      // ★ 阶段 3：AI 生成节点自动布局 + 聚焦
      // 新增节点都在 (0,0) 时跑全量布局，然后聚焦到第一个新节点让用户立刻看到 AI 生成了什么。
      if (addedNodeIds.length > 0) {
        const { nodes: latestNodes, edges: latestEdges, nodeGroups } = useFlowStore.getState()
        // 仅新增节点参与 needsLayout 判定（已有节点位置不动）
        const addedNodes = latestNodes.filter(n => addedNodeIds.includes(n.id))
        if (needsLayout(addedNodes)) {
          try {
            // 全量节点跑布局保证拓扑正确，但只对新增节点应用结果——
            // 已有节点的位置是用户手动排布的，不能被覆盖。
            // 必须把 nodeGroups 一起传进去：否则算出来的坐标系与画布上已有的
            // 分组布局不是同一套，新节点会落到不相干的位置。
            const positions = await layoutFlow(latestNodes, latestEdges, nodeGroups)
            const addedIdSet = new Set(addedNodeIds)
            // 只保留新增节点的位置，批量一次落地（不 pushHistory：AI 生成的布局
            // 是衍生物，撤销应回到 addNode 前（snapshot 已含））
            const addedPositions = new Map<string, { x: number; y: number }>()
            for (const [nodeId, pos] of positions) {
              if (addedIdSet.has(nodeId)) addedPositions.set(nodeId, pos)
            }
            useFlowStore.getState().updateNodePositions(addedPositions)
          } catch (e) {
            console.warn('[aiStore] AI 生成自动布局失败:', e)
          }
        }
        focusNode(addedNodeIds[0])
        // 阶段 6：高亮所有新增节点，让用户知道 AI 总共添加了哪些节点
        useFlowStore.getState().highlightNodes(addedNodeIds)
      }

      // ★ 阶段 7：AI 生成节点配置校验
      // AI 生成的节点可能配置不完整（必填字段缺失/端口未连接），应用后立即校验，
      // 若存在错误节点，通过 agentState 反馈给用户与 AI（可在后续对话中要求 AI 修正）。
      if (addedNodeIds.length > 0) {
        const st = useFlowStore.getState()
        st.validateAllNodes()
        const { errorNodeIds, nodeErrors } = useFlowStore.getState()
        const addedSet = new Set(addedNodeIds)
        const addedErrors = [...errorNodeIds].filter(id => addedSet.has(id))
        if (addedErrors.length > 0) {
          const details = addedErrors
            .map(id => {
              // 注意用 || 而不是 ??：nodeDisplayLabel 查不到节点时返回**空串**，不是 undefined
              const label =
                nodeDisplayLabel(useFlowStore.getState().nodes.find(n => n.id === id)) || id
              const msgs = nodeErrors[id] ?? []
              return `「${label}」: ${msgs.join('; ')}`
            })
            .join('\n')
          set({
            agentState: {
              state: 'warning',
              message: t('ai.ops.generatedNodesWithIssues', {
                count: addedErrors.length,
                details,
              }),
            },
          })
        }
      }

      // Issue 2: Phase 2 磁盘操作（两阶段备份回滚）
      if (diskOps.length > 0) {
        // Issue 8: projectPath 校验
        const projectPath = useProjectStore.getState().currentProject?.path ?? ''
        /**
         * 「必须有项目」只对**文件操作**成立。
         *
         * 能力调用（capability）不需要已有项目 —— 恰恰相反：**「新建项目」这个能力
         * 就是在没有项目时用的**。一刀切会把最自然的用法（第一次打开就让 AI 建项目）挡死。
         */
        const needsProject = diskOps.some(
          op => op.kind === 'write_code' || op.kind === 'generate_code',
        )
        if (needsProject && !projectPath) {
          flowStore.rollback(snapshot)
          set({ currentProposal: null })
          set({ agentState: { state: 'error', message: t('ai.ops.noProjectOpen') } })
          console.error('proposal 磁盘操作失败：未打开项目')
          return
        }

        // Issue 4: 校验所有 write_code filePath
        for (const op of diskOps) {
          if (op.kind === 'write_code') {
            // 应用管理的文件（画布数据/生成物）不许写 —— 与代码编辑器的只读口径同一份
            // （@shared/files/readOnlyPaths）。纵深防御：老提案/手搓提案也拦在这里。
            if (isAppManagedReadOnly(op.filePath)) {
              flowStore.rollback(snapshot)
              set({ currentProposal: null })
              set({
                agentState: {
                  state: 'error',
                  message: t('ai.ops.appManagedReadOnly', { path: op.filePath }),
                },
              })
              console.error(`拒绝写入应用管理的文件: ${op.filePath}`)
              return
            }
            if (
              op.filePath.includes('..') ||
              /^[A-Za-z]:[\\/]/.test(op.filePath) ||
              op.filePath.startsWith('/')
            ) {
              flowStore.rollback(snapshot)
              set({ currentProposal: null })
              set({ agentState: { state: 'error', message: t('ai.ops.proposalRolledBack') } })
              console.error(`filePath 不允许绝对路径或上级目录: ${op.filePath}`)
              return
            }
          }
        }

        // 备份原文件内容
        const backups: Array<{ filePath: string; originalContent: string | null }> = []
        for (const op of diskOps) {
          if (op.kind === 'write_code') {
            try {
              const result = await window.qqbat.file.read(projectPath, op.filePath)
              backups.push({
                filePath: op.filePath,
                originalContent: result.ok ? (result.data ?? '') : null,
              })
            } catch {
              // 文件不存在时备份标记为 null
              backups.push({ filePath: op.filePath, originalContent: null })
            }
          }
        }

        // 执行磁盘操作
        try {
          for (const op of diskOps) {
            if (op.kind === 'write_code') {
              await window.qqbat.file.write(projectPath, op.filePath, op.content)
            } else if (op.kind === 'generate_code') {
              await flowStore.generateCode(projectPath)
            } else if (op.kind === 'capability') {
              await invokeCapability(op.capabilityId, op.capabilityArgs, projectPath ?? '')
            }
          }
        } catch (e) {
          // 按备份逆序恢复磁盘文件
          const restoreFailures: string[] = []
          for (let i = backups.length - 1; i >= 0; i--) {
            const b = backups[i]
            if (b.originalContent !== null) {
              try {
                await window.qqbat.file.write(projectPath, b.filePath, b.originalContent)
              } catch (restoreErr) {
                // 恢复失败会导致文件不一致，收集失败列表便于用户排查
                restoreFailures.push(b.filePath)
                console.warn(`[aiStore] 恢复磁盘文件失败: ${b.filePath}`, restoreErr)
              }
            }
          }
          // 回滚流程状态（Phase 1 的流程操作全部撤销）
          flowStore.rollback(snapshot)
          set({ currentProposal: null })
          // 向用户显示明确的错误信息：包含恢复失败的文件列表
          const msg =
            restoreFailures.length > 0
              ? t('ai.ops.rolledBackRestoreFailed', {
                  files: restoreFailures.join(', '),
                })
              : t('ai.ops.proposalRolledBackReason', {
                  error: e instanceof Error ? e.message : String(e),
                })
          set({ agentState: { state: 'error', message: msg } })
          console.error('proposal 磁盘操作失败，已回滚', e)
          return
        }
      }

      set({ currentProposal: null })
      /**
       * ★ **给用户一个收尾**（2026-10-15 真机，用户原话「同意后就没了不知道干啥了」）。
       *
       * 在这之前这里**只把回执给模型**（下面的 noteTurn），界面上提案卡直接消失 ——
       * 用户完全不知道刚刚发生了什么、接下来该点哪里。
       * 所以补一条系统横幅：说清**做了什么** + **下一步的动作**。
       */
      get().addMessage({
        role: 'system',
        content: t('ai.ops.appliedNextStep', { count: String(ops.length) }),
      })

      /**
       * ★ P1-4 应用后自动校验（2026-10-15 真机事故）。
       *
       * 事故：助手用 `delete_node` 删掉节点、准备重建时模型额度耗尽中断 ——
       * 用户的流程少了节点，而**界面上没有任何提示**。只要它应用完自己的提案就跑一遍校验，
       * 当场就能发现"剩下的节点没人驱动了"。
       *
       * 三条刻意的取舍：
       *  · **复用**统一真相层（`normalizeFlow + validateFlow`，即 `validate_flow` /
       *    `flow:validate` 的同一套引擎）与提案生成处的差分判据（`issueKey`）——
       *    一行校验规则都不新写；
       *  · 只报**与改动前差出来的**问题：老项目一打开就有上百条存量债（实测 102 条），
       *    拿全量问题去刷屏只会让用户学会无视红色（同 proposalValidation.ts 的理由）；
       *  · **不只看 error**：本引擎把"没有任何入口、不会被执行"定级为 warning
       *    （`unreachable-node`）—— 那恰恰是"少了节点"的形态，只看 error 会漏掉事故本身。
       *    所以 info 以上的新增问题都算，error 单独计数以便说清严重性。
       */
      let validationNote: string | null = null
      if (touchesGraph) {
        try {
          // 基线取**应用前**的图（`snapshot` 是 structuredClone，没被后面的改动污染）
          const baseKeys = issueKeySet(collectFlowIssues(snapshot))
          const introduced = collectFlowIssues(useFlowStore.getState()).filter(
            i => !baseKeys.has(issueKey(i)),
          )
          const reportable = introduced.filter(i => i.severity !== 'info')
          if (reportable.length > 0) {
            const counts = {
              count: String(reportable.length),
              errors: String(reportable.filter(i => i.severity === 'error').length),
            }
            // 用户侧：一条系统消息，说清"几个问题" + 点哪里看
            get().addMessage({
              role: 'system',
              content: t('ai.ops.autoValidateFoundIssues', counts),
            })
            // 模型侧：并进"计划已应用"的回执（noteTurn 写的是**模型记忆**，界面不显示）
            validationNote = t('ai.ops.autoValidateFoundIssuesNote', counts)
          }
        } catch (e) {
          // 校验失败**不许静默**（tests/guards/silentFailure）：如果什么都不说，
          // 用户会把"这次没校验"当成"校验过了、没问题" —— 那正是事故的成因。
          console.error('[aiStore] post-apply validation failed', e)
          get().addMessage({
            role: 'system',
            content: t('ai.ops.autoValidateFailed', {
              error: e instanceof Error ? e.message : String(e),
            }),
          })
        }
      }

      // ③ 变更回执：告诉模型"计划落地了"（有新增问题时一并说清），它下一轮才不会原地重提
      void window.qqbat.ai
        .noteTurn?.(
          get().conversationPath || currentProjectPath(),
          validationNote ? `${AI_NOTE_APPLIED}\n${validationNote}` : AI_NOTE_APPLIED,
          get().activeThreadId,
        )
        ?.catch((e: unknown) => {
          // 回执写失败 = 模型下一轮不知道计划已落地，会把同一份再提一遍。
          // 不弹 toast（用户没做错事，弹窗只会吓人），但在对话里留一条可见说明 + 记日志。
          console.error('[ai] noteTurn failed:', e)
          get().addMessage({ role: 'system', content: t('ai.chat.turnNoteFailed') })
        })
    },

    init: () => {
      if (!window.qqbat?.ai) return () => {}
      // Issue 3: 过滤其他项目的 ai 事件（projectPath 不匹配时跳过）
      const getCurrentPath = () => useProjectStore.getState().currentProject?.path
      const filterProject = (projectPath: string | undefined) => {
        if (projectPath === undefined) return false // main 侧未加 projectPath 时不过滤
        return getCurrentPath() !== projectPath
      }

      /**
       * ⚠️ 这里**不再是"不是当前项目就丢弃"**（2026-10-01 改）。
       *
       * 丢弃的后果：在 B 项目跑着一轮，你切回 A 看两眼 —— B 那轮的回复与工具记录**直接丢了**，
       * 切回 B 只剩空白。现在改成**路由**：当前项目更新视图，别的项目写进它自己的记录。
       */
      /**
       * 工具调用事件 → `toolCalls`（面板的 `ToolCallCard` 靠它渲染）。
       *
       * 同一轮的多个工具用 `id` 归并：先 `running` 建卡，再 `done`/`error` 更新同一张。
       * （此前 `addToolCall`/`updateToolCall` 零调用点，卡片从来没渲染过 —— 零引用扫描发现。）
       */
      /**
       * ⚠️ **可选调用**：旧版 preload（或测试里的假桥）没有这个方法时，
       * **不能让整个 init() 抛错** —— 否则连消息流都接不上。缺了只是“没有工具卡片”。
       */
      /** 工具批准请求（M1d）：主进程停下来等人，界面弹确认条 */
      const unsubApprovalReq = window.qqbat.ai.onApprovalRequest?.(data => {
        set({
          pendingApproval: {
            callId: data.callId,
            toolName: data.toolName,
            args: data.args ?? {},
            hint: data.hint,
          },
        })
      })
      /** 批准已出结果（用户点了 / 超时 / 被取消）—— 把确认条收掉 */
      const unsubApprovalDone = window.qqbat.ai.onApprovalResolved?.(data => {
        const p = get().pendingApproval
        if (!p || p.callId === data.callId) set({ pendingApproval: null })
      })

      /** 步边界：只更新"这一轮第几步"；收尾时由 agentState=idle 清掉 */
      const unsubAgentStep = window.qqbat.ai.onAgentStep?.(data => {
        routeTo(data.projectPath, c => ({
          ...c,
          agentStep: { step: data.step, maxSteps: data.maxSteps },
        }))
      })

      /**
       * 循环内压缩（2026-10-25）：早先回合被换成摘要后，界面上留一条提示 ——
       * 否则模型忽然忘了前面的事，用户只会觉得它变笨了。
       * **不进记忆**（记忆里已有压缩注记，这里再存一份等于重复），重开对话就没了。
       */
      const compactTokens = (n: number): string =>
        n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))
      const unsubCompact = window.qqbat.ai.onCompact?.(data => {
        const note: ChatMessage = {
          role: 'system',
          notice: 'compaction',
          content: t('ai.chat.compacted', {
            dropped: String(data.dropped),
            before: compactTokens(data.tokensBefore),
            after: compactTokens(data.tokensAfter),
          }),
        }
        routeTo(data.projectPath, c => ({ ...c, messages: [...c.messages, note] }))
      })

      /**
       * 任务清单：整表覆盖。主进程每轮开始发一条空的（清掉上一轮的旧计划），
       * 之后每成功写一次 `todo_write` 发一条完整清单。
       */
      const unsubTodo = window.qqbat.ai.onTodo?.(data => {
        routeTo(data.projectPath, c => ({ ...c, todos: data.todos }))
      })

      const unsubToolCall = window.qqbat.ai.onToolCall?.(data => {
        routeTo(data.projectPath, c => {
          const idx = c.toolCalls.findIndex(t => t.id === data.id)
          if (idx >= 0) {
            const next = [...c.toolCalls]
            next[idx] = {
              ...next[idx],
              status: data.status,
              // 只增不减：结束事件没带契约时，别把开始事件拿到的丢掉
              ...(data.presentation ? { presentation: data.presentation } : {}),
              ...(data.failure ? { failure: data.failure } : {}),
              ...(data.result !== undefined ? { result: data.result } : {}),
            }
            return { ...c, toolCalls: next }
          }
          return {
            ...c,
            toolCalls: [
              ...c.toolCalls,
              {
                id: data.id,
                name: data.name ?? '',
                args: data.args ?? {},
                status: data.status,
                // 有才带键：渲染层用 `in` 判断"这个工具有没有呈现契约"
                ...(data.presentation ? { presentation: data.presentation } : {}),
                result: data.result,
                timestamp: data.timestamp,
              },
            ],
          }
        })
      })

      const unsubChunk = window.qqbat.ai.onChunk(data => {
        routeTo(data.projectPath, c => {
          if (!c.streaming) return c
          return data.kind === 'reasoning'
            ? { ...c, currentReasoning: c.currentReasoning + data.text }
            : { ...c, currentChunk: c.currentChunk + data.text }
        })
      })
      const unsubResponse = window.qqbat.ai.onResponse(data => {
        routeTo(data.projectPath, c => {
          if (!c.streaming) return c
          const trace = traceOf(c.toolCalls)
          const turnMs = c.runStartedAt ? Date.now() - c.runStartedAt : 0
          const messages = c.currentChunk
            ? [
                ...c.messages,
                {
                  role: 'assistant' as const,
                  content: c.currentChunk,
                  ...(c.currentReasoning ? { reasoning: c.currentReasoning } : {}),
                  ...(trace.length ? { trace } : {}),
                  ...(turnMs ? { turnMs } : {}),
                },
              ]
            : trace.length
              ? [
                  ...c.messages,
                  {
                    role: 'assistant' as const,
                    content: '',
                    trace,
                    ...(turnMs ? { turnMs } : {}),
                  },
                ]
              : c.messages
          return {
            ...c,
            messages,
            streaming: false,
            currentChunk: '',
            currentReasoning: '',
            toolCalls: [],
            runStartedAt: 0,
          }
        })
      })
      const unsubInstruction = window.qqbat.ai.onClientInstruction(data => {
        /**
         * **回执**（P1-1）：主进程发写指令时会带 requestId，并且真的在等结果。
         * 不回 = 主进程按 15s 超时判失败 —— 那会让一次成功的写操作被模型当成失败，
         * 于是它重试、重复建节点。所以每个分支都必须给一个明确结局。
         */
        const reply = (
          outcome:
            | { status: 'applied'; detail?: string }
            | { status: 'rejected'; reason: string }
            | { status: 'failed'; reason: string },
        ) => {
          if (!data.requestId) return // 老版本主进程：不需要回执
          const api = window.qqbat.ai.resolveInstruction
          if (!api) return // 老版本 preload：同样不需要
          void api({ requestId: data.requestId, outcome }).catch((e: unknown) =>
            // 控制台日志不进界面：保持 ASCII，别触发 i18n 硬编码扫描（它不是待翻译文案）
            console.error('[ai] instruction receipt failed', e),
          )
        }
        if (filterProject(data.projectPath)) {
          // 属于另一个项目/窗口：**必须回执**（否则主进程白等 15 秒才判失败）
          // 这条 reason 只进主进程日志/回灌，不出现在界面上 —— 同样保持 ASCII
          reply({ status: 'rejected', reason: 'instruction belongs to another project/window' })
          return
        }
        // Issue 12: 捕获 rejection，避免未处理 promise
        handleClientInstruction(data.instruction)
          .then(() => reply({ status: 'applied' }))
          .catch((e: unknown) => {
            console.error('instruction 失败', e)
            reply({ status: 'failed', reason: e instanceof Error ? e.message : String(e) })
          })
      })
      const unsubAgentState = window.qqbat.ai.onAgentState(data => {
        routeTo(data.projectPath, c => {
          /**
           * **出过错就别让 idle 把它抹掉**（2026-10-08 真机）。
           *
           * 主进程的契约是「每轮都发 idle」（有集成测试钉着 —— 界面不能卡在思考中）；
           * 但失败之后那一发 idle 会把 error 覆盖成「就绪」，用户只看到一个没人回的对话，
           * 于是以为「这东西没用」（实际是 403 额度用尽）。
           *
           * 口径：**错误要留到下一轮开始为止**。thinking 一来就正常覆盖 ——
           * 所以不会卡死，只是不再静默。
           */
          if (data.state === 'idle' && c.agentState.state === 'error') return c
          return {
            ...c,
            agentState: { state: data.state, message: data.message, stage: data.stage },
            // 收尾（idle）时清掉步进度，避免"第 3/10 步"停在界面上
            ...(data.state === 'idle' ? { agentStep: null } : {}),
            ...(data.stage ? { agentStages: mergeAgentStage(c.agentStages, data.stage) } : {}),
          }
        })
      })
      /**
       * 本轮统计（状态条）。**每轮都推**，所以这里只管覆盖 —— 不累加，累加在主进程做，
       * 免得界面上重连/重挂载时算出两份。
       */
      const unsubStats = window.qqbat.ai.onStats?.(data => {
        routeTo(data.projectPath, c => ({ ...c, stats: data.stats }))
      })
      /**
       * 提案 = 这一轮的收尾（主进程有提案时**只发 ai:proposal，不发 ai:response**）。
       * 所以这里必须走 finalizeTurn 复位 streaming，否则输入框永久禁用。
       */
      const unsubProposal = window.qqbat.ai.onProposal(data => {
        routeTo(data.projectPath, c => ({
          ...finalizeTurn(c, null, { state: 'idle' }),
          currentProposal: data.proposal,
        }))
      })
      // 运行期错误/警告：以前这两条事件**没有监听**（preload 里没有通道），
      // 错误既不可见、也照样把界面卡在 streaming。
      const unsubError =
        window.qqbat.ai.onError?.(data => {
          /**
           * **界面说人话，日志留原文**：原始错误（403 + 一整段 JSON）照样进 main.log，
           * 界面上给的是「该怎么办」—— 分类见 components/ai/errorMessage.ts。
           */
          const hint = classifyAiError(data.message)
          const friendly = t(hint.key, hint.params)
          routeTo(data.projectPath, c =>
            finalizeTurn(c, t('ai.ops.errorBanner', { message: friendly }), {
              state: 'error',
              message: friendly,
            }),
          )
        }) ?? (() => {})
      const unsubWarning =
        window.qqbat.ai.onWarning?.(data => {
          routeTo(data.projectPath, c =>
            finalizeTurn(c, t('ai.ops.warningBanner', { message: data.message }), {
              state: 'idle',
            }),
          )
        }) ?? (() => {})
      /**
       * 会话自动标题（第 56 批）：线程首轮成功后主进程推一条**新标题**。
       * 只动列表标题（title/titleSource），不碰消息 —— 标题不是对话内容。
       * `projectPath` 缺省 = 主进程没带（老版本），按当前项目处理。
       */
      const unsubThreadTitle = window.qqbat.ai.onThreadTitle?.(data => {
        const patch = (th: ThreadInfo): ThreadInfo =>
          th.id === data.threadId ? { ...th, title: data.title, titleSource: data.source } : th
        set(st => {
          let forCurrent = !data.projectPath
          if (!forCurrent) {
            try {
              forCurrent = (st.conversationPath || currentProjectPath()) === data.projectPath
            } catch {
              forCurrent = false
            }
          }
          return {
            threads: forCurrent ? st.threads.map(patch) : st.threads,
            allThreads: st.allThreads.map(g =>
              !data.projectPath || g.projectPath === data.projectPath
                ? { ...g, threads: g.threads.map(patch) }
                : g,
            ),
          }
        })
      })
      return () => {
        unsubToolCall?.()
        unsubAgentStep?.()
        unsubTodo?.()
        unsubCompact?.()
        unsubChunk()
        unsubResponse()
        unsubInstruction()
        unsubAgentState()
        unsubStats?.()
        unsubProposal()
        unsubError()
        unsubWarning()
        unsubThreadTitle?.()
      }
    },
  }
})
