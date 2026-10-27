// src/shared/protocol/rpc/agentSdk.ts
//
// 智能体 SDK 契约（第 61 批）—— 第三方驱动本程序智能体的**唯一稳定面**。
//
// `ai:agentCoreRun` 这类通道名是**实现细节**（本仓已删过两次引擎、改过多轮载荷），
// 插件不该依赖它们。SDK 冻结方法名/入参/语义；通道怎么变由 `src/preload/agentSdk.ts` 吸收。
//
// `AGENT_METHODS` 是机器可读的那份契约：闸门 `tests/guards/protocolContract.test.ts`
// 用它核对「SDK 方法 ↔ preload 真实通道 ↔ 主进程 zod schema」三者不漂移；新增方法
// 必须三处同时登记，否则闸门红。版本见 `./version.ts`（加方法 = 次版本；改签名 = 主版本）。
//
// 信任边界：SDK 只是**调用面**，能不能调由主进程（角色 / 预设 / 审批）裁决；返回的 Promise
// 可能被拒，插件必须处理失败。
import type { FeedbackCategory, FeedbackRating } from '../../ai/messageFeedback'

/** 发一轮对话（等价于界面上按回车）：`projectPath` 允许空串 = 开荒 */
export interface AgentSendInput {
  projectPath: string
  requirement: string
  threadId?: string
  maxRounds?: number
  /** 先计划：只给只读工具，写/命令这一轮不存在 */
  planFirst?: boolean
  /** 本轮不逐个审批（不落规则，重启失效） */
  fullAccess?: boolean
  allowedTools?: string[]
  /** 预设名；`null` = 明确跟页面；不传 = 没表态（空白线程套项目默认） */
  preset?: string | null
  agentMode?: 'blocks' | 'code' | 'duo' | 'creator'
  /** 用户贴的图（data URL；只进这一轮，不进记忆） */
  images?: string[]
  activeFilePath?: string
}

/** 插话：把一句话塞进正在跑的那一轮（step = 本步之前，turn = 本轮结束后排队） */
export interface AgentSteerInput {
  projectPath: string
  text: string
  target?: 'step' | 'turn'
}

export interface AgentProjectRef {
  projectPath: string
}

export interface AgentThreadRef extends AgentProjectRef {
  threadId: string
}

export interface AgentHistoryInput extends AgentProjectRef {
  /** 不传 = 默认那条线程 */
  threadId?: string
}

export interface AgentRenameThreadInput extends AgentThreadRef {
  title: string
}

export interface AgentSearchThreadsInput extends AgentProjectRef {
  query: string
  limit?: number
}

export interface AgentMessageFeedbackInput extends AgentThreadRef {
  messageId: string
}

export interface AgentPutFeedbackInput extends AgentMessageFeedbackInput {
  rating: FeedbackRating
  category?: FeedbackCategory
  note?: string
}

/** 一轮（一个可撤销单元）：撤回/预览按 turnId 定位 */
export interface AgentTurnRef extends AgentProjectRef {
  turnId: string
  threadId?: string
}

/** 编辑后从此处重开对话：回退这句之后的产物 + 截断记忆 */
export interface AgentRewindInput {
  projectPath: string
  messageText: string
  threadId?: string
}

export interface AgentNoteTurnInput extends AgentProjectRef {
  note: string
  threadId?: string
}

export interface AgentApprovalInput {
  callId: string
  decision: 'allow' | 'deny' | 'always'
}

export interface AgentSetParallelInput {
  enabled: boolean
  maxParallel: number
}

export interface AgentTitleRefreshInput {
  /** off = 标题不动，auto = 每轮重写一次 */
  mode: 'off' | 'auto'
}

export interface AgentConfigInput {
  /** 不传 = 全局配置 */
  projectPath?: string
}

/**
 * 第三方可见的智能体调用面。
 *
 * 刻意全部返回 `Promise<unknown>`：**回执形状是主进程的实现细节**（workflow 会随批次变）。
 * 插件要拿稳定结构就自己去窄化，或在 `docs/ai/protocol-sdk.md` 里提出要冻结哪几个。
 */
export interface AgentSdk {
  send(input: AgentSendInput): Promise<unknown>
  steer(input: AgentSteerInput): Promise<unknown>
  /** 真的停下主进程里这个项目的这一轮（不只是界面收尾） */
  stop(input: AgentProjectRef): Promise<unknown>
  isRunning(input: AgentProjectRef): Promise<unknown>
  /** 当前注册表里的工具（名字 + 描述） */
  listTools(): Promise<unknown>
  listThreads(input: AgentProjectRef): Promise<unknown>
  getHistory(input: AgentHistoryInput): Promise<unknown>
  clearThread(input: AgentThreadRef): Promise<unknown>
  renameThread(input: AgentRenameThreadInput): Promise<unknown>
  searchThreads(input: AgentSearchThreadsInput): Promise<unknown>
  exportThread(input: AgentThreadRef): Promise<unknown>
  getThreadFeedback(input: AgentThreadRef): Promise<unknown>
  putMessageFeedback(input: AgentPutFeedbackInput): Promise<unknown>
  deleteMessageFeedback(input: AgentMessageFeedbackInput): Promise<unknown>
  listTurns(input: AgentProjectRef): Promise<unknown>
  previewTurn(input: AgentTurnRef): Promise<unknown>
  rollbackTurn(input: AgentTurnRef): Promise<unknown>
  rewindTo(input: AgentRewindInput): Promise<unknown>
  noteTurn(input: AgentNoteTurnInput): Promise<unknown>
  getConfig(input?: AgentConfigInput): Promise<unknown>
  getAppConfig(): Promise<unknown>
  /** 回工具批准决定（与界面上的确认条是同一个口子） */
  resolveApproval(input: AgentApprovalInput): Promise<unknown>
  getParallelToolCalls(): Promise<unknown>
  setParallelToolCalls(input: AgentSetParallelInput): Promise<unknown>
  getThreadTitleRefresh(): Promise<unknown>
  setThreadTitleRefresh(input: AgentTitleRefreshInput): Promise<unknown>
}

/** 一条 SDK 方法在真实实现里的落点（机器契约，闸门直接读这张表） */
export interface AgentMethodSpec {
  /** `AgentSdk` 上的方法名 */
  sdk: keyof AgentSdk
  /** preload 里真实存在的 IPC 通道 */
  channel: `ai:${string}`
  /** 主进程校验整份载荷用的 schema 名（`@main/schemas/ai` 的导出）；null = 无 / 语义不同 */
  schema: string | null
  /** 为什么是这个映射（给人看的，闸门不解析） */
  note: string
}

export const AGENT_METHODS = [
  {
    sdk: 'send',
    channel: 'ai:agentCoreRun',
    schema: 'aiAgentCoreRunSchema',
    note: '对象入参在这里摊成位置参数（preload 适配），通道载荷是全字段对象',
  },
  {
    sdk: 'steer',
    channel: 'ai:agentCoreSteer',
    schema: 'aiAgentCoreSteerSchema',
    note: '插话只在本轮在跑时有意义，没在跑时主进程直接拒绝',
  },
  { sdk: 'stop', channel: 'ai:cancelChat', schema: 'aiProjectPathSchema', note: '按项目取消' },
  { sdk: 'isRunning', channel: 'ai:isRunning', schema: 'aiProjectPathSchema', note: '按项目查询' },
  { sdk: 'listTools', channel: 'ai:tools', schema: null, note: '无载荷；回执是工具注册表快照' },
  {
    sdk: 'listThreads',
    channel: 'ai:listThreads',
    schema: 'aiProjectPathSchema',
    note: '按最后活动倒序',
  },
  {
    sdk: 'getHistory',
    channel: 'ai:getHistory',
    schema: 'aiHistorySchema',
    note: '读回磁盘对话记忆（可选 threadId）',
  },
  {
    sdk: 'clearThread',
    channel: 'ai:clearThread',
    schema: 'aiThreadSchema',
    note: '真的清空：界面与磁盘一起清',
  },
  {
    sdk: 'renameThread',
    channel: 'ai:renameThread',
    schema: 'aiRenameThreadSchema',
    note: '标题在主进程归一后落盘；空标题被拒',
  },
  {
    sdk: 'searchThreads',
    channel: 'ai:searchThreads',
    schema: 'aiSearchThreadsSchema',
    note: 'query 归一与截断在 shared；limit 上限 12',
  },
  {
    sdk: 'exportThread',
    channel: 'ai:exportThread',
    schema: 'aiExportThreadSchema',
    note: '主进程弹保存框并写盘；用户取消 = 明确错误',
  },
  {
    sdk: 'getThreadFeedback',
    channel: 'ai:getThreadFeedback',
    schema: 'aiThreadFeedbackSchema',
    note: '整表拉一次（一轮可能几十条消息）',
  },
  {
    sdk: 'putMessageFeedback',
    channel: 'ai:putMessageFeedback',
    schema: 'aiMessageFeedbackPutSchema',
    note: '载荷键名在 preload 里摊成字面量（载荷契约闸门靠静态抠键）',
  },
  {
    sdk: 'deleteMessageFeedback',
    channel: 'ai:deleteMessageFeedback',
    schema: 'aiMessageFeedbackDeleteSchema',
    note: '撤回反馈；不存在时 removed:false，不报错',
  },
  {
    sdk: 'listTurns',
    channel: 'ai:listTurns',
    schema: 'aiProjectPathSchema',
    note: 'preload 里的方法名是 listAiTurns（历史命名），通道名才是契约',
  },
  {
    sdk: 'previewTurn',
    channel: 'ai:previewTurn',
    schema: 'rollbackTurnSchema',
    note: '只读预览，复用撤回载荷（不回退任何东西）',
  },
  {
    sdk: 'rollbackTurn',
    channel: 'ai:rollbackTurn',
    schema: 'rollbackTurnSchema',
    note: '文件回滚 + 流程还原；调用方须重载画布',
  },
  {
    sdk: 'rewindTo',
    channel: 'ai:rewindTo',
    schema: 'rewindToSchema',
    note: '传原句而不是下标（界面下标与磁盘条目不一一对应）',
  },
  {
    sdk: 'noteTurn',
    channel: 'ai:noteTurn',
    schema: 'aiNoteTurnSchema',
    note: '把「用户对计划的处置」写进记忆，模型下一轮据此知道结果',
  },
  {
    sdk: 'getConfig',
    channel: 'ai:getConfig',
    schema: null,
    note: 'projectPath 可省略（schema 是 min(1)，语义不同，见载荷契约闸门 EXEMPT）',
  },
  {
    sdk: 'getAppConfig',
    channel: 'ai:getAppConfig',
    schema: null,
    note: '无载荷；全局配置（含 fallbacks 池）',
  },
  {
    sdk: 'resolveApproval',
    channel: 'ai:resolveApproval',
    schema: 'approvalDecisionSchema',
    note: '与界面确认条同一口子；没人点会超时按拒绝',
  },
  {
    sdk: 'getParallelToolCalls',
    channel: 'ai:getParallelToolCalls',
    schema: null,
    note: '无载荷',
  },
  {
    sdk: 'setParallelToolCalls',
    channel: 'ai:setParallelToolCalls',
    schema: 'aiSetParallelToolCallsSchema',
    note: '载荷 { enabled, maxParallel }',
  },
  {
    sdk: 'getThreadTitleRefresh',
    channel: 'ai:getThreadTitleRefresh',
    schema: null,
    note: '无载荷（第 60 批）',
  },
  {
    sdk: 'setThreadTitleRefresh',
    channel: 'ai:setThreadTitleRefresh',
    schema: 'aiSetThreadTitleRefreshSchema',
    note: '载荷 { mode }（第 60 批）',
  },
] as const satisfies readonly AgentMethodSpec[]
