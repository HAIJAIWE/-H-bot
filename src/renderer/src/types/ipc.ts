// src/renderer/src/types/ipc.ts
import type { ProjectConfig, ProjectMeta, RecentProject } from '@shared/types/project'
import type { FlowGraph, NodeSpec } from '@shared/types/flow'
import type { NodeSpecV2 } from '@shared/types/nodeV2'
import type { BotLogEntry, ExecuteNodeEvent } from '@shared/types/runtime'
import type { AiAllowRule, AiConfig, AiRunStats, AiToolDefinition } from '@shared/types/ai'
import type { AgentPresetRoster, PresetSessionState } from '@shared/ai/presetRoster'
import type { PresetImportResult, PresetSharePick } from '@shared/ai/presetShare'
import type { PresetUndoResult, PresetUndoState } from '@shared/ai/presetUndo'
import type { Proposal } from '@shared/types/proposal'
import type { MetricSnapshot } from '../stores/metricsStore'
import type { PluginInfo, PluginPackage } from '@shared/types/plugin-sdk'
import type { AgentSdk } from '@shared/protocol/rpc/agentSdk'
import type { PreviewRequest, PreviewResult } from '@shared/types/preview'
import type { FlowIssue } from '@shared/nodes/flowNormalize'
import type { DebugState, Breakpoint, DebugVar } from '@shared/types/debug'
import type {
  DataSource,
  FieldSchema,
  TableSchema,
  QueryResult,
  SearchResult,
  DashboardStatus,
  TimelineItem,
  ConfigCategory,
  GroupInfo,
  FieldCategory,
} from '@shared/types/launch'
import type { ButtonPanel } from '@shared/types/buttonPanel'
import type { MarketInstallInfo, MarketInstallPlan, MarketListResult } from '@shared/plugins/market'
import type { WindowPackageScanResult } from '@shared/plugins/windowPackage'
import type { PluginSettingSpec, PluginSettingValues } from '@shared/plugins/settings'

export type { PluginSettingSpec, PluginSettingValues } from '@shared/plugins/settings'

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

// 工具呈现契约：形状定义在 shared（main/preload/renderer 共用一份，避免三处分叉）
import type { ToolPresentation } from '@shared/ai/toolPresentation'
export type { ToolPresentation } from '@shared/ai/toolPresentation'

/**
 * 框架开发模式的一个**回退点**（= `<框架根>/.dev-backups/<时间戳>/` 一个目录）。
 *
 * `entries[].existed === false` 表示那次写是**新建**文件 —— 回滚时会把它删掉，
 * 所以界面文案要能区分"恢复原内容"和"删掉新建的文件"。
 */
export interface FrameworkDevRevision {
  id: string
  createdAt: string
  kind: 'write' | 'restore' | 'unknown'
  /** 清单缺失/读不动 = 不完整（恢复会被服务端拒绝） */
  incomplete: boolean
  entries: Array<{ path: string; existed: boolean; bytes: number }>
}

/** 回退点占用（界面要能看见"它占了多少"，否则没人敢开这个模式） */
export interface FrameworkDevUsage {
  count: number
  bytes: number
  /** 保留上限（超出的最老回退点会被自动清掉） */
  limit: number
}

/**
 * 「本次会话动过的**护栏文件**」（2026-10-16 护栏可见性）。
 *
 * 清单在 `@shared/files/securityCriticalPaths`（改这些文件 = 改护栏本身）；
 * 这里只是"这次会话真的动过哪几个"的记录 —— 给界面提示用，不是审计日志。
 */
export interface SecurityCriticalWriteInfo {
  /** 框架根相对路径 */
  path: string
  /** 它为什么算护栏（来自清单） */
  why: string
  /** 最近一次写入时间（ISO） */
  at: string
}

/** `file:getDevMode` 的返回：开关 + 边界（框架根） + 能回滚到哪 + 占了多少 + 动过的护栏文件 */
export interface FrameworkDevState {
  enabled: boolean
  /** 框架根（"框架自己"的源码目录） */
  frameworkRoot: string
  backups: FrameworkDevRevision[]
  usage: FrameworkDevUsage
  /** 本次会话动过的护栏文件（最近一次在前） */
  securityCriticalWrites: SecurityCriticalWriteInfo[]
}

/** `file:restoreDevBackup` 的返回 */
export interface FrameworkDevRestoreResult {
  revisionId: string
  /** 恢复前自动落的那份回退点 —— 有了它，回滚本身还能再回滚 */
  rollbackPoint: string
  restored: string[]
  removed: string[]
}

/** QQ 上的一个指令面板（`GET /v2/panels` 的原样形状，只列界面用得到的字段） */
export interface RemotePanelInfo {
  panel_id: string
  scope?: string
  target_type?: string
  panel?: {
    items?: Array<{ type?: string; name?: string; desc?: string; link?: string }>
    remark?: string
    version?: number
  }
}

/** 能力自检的一项（`CapabilityItemResult` 的子集，够界面显示） */
export interface CapabilityItemInfo {
  id: string
  zhLabel: string
  verdict: string
  status: number
  note: string
}

/** 一次能力自检的结果 */
export interface CapabilityReportInfo {
  items: CapabilityItemInfo[]
}

/** 一次同步的结果（见 `services/project/panelSync.ts` 的 `ApplyPanelResult`） */
export interface ApplyPanelInfo {
  created: string
  updated: string
  deleted: string[]
  changed: boolean
  summary: string
}

/**
 * 表达式静态校验结果（`expression:checkSyntax`）。
 *
 * ⚠️ 这里的 `ok` 是**「语法通过」**，不是「IPC 调用成功」—— 与 `ApiResult.ok` 不是一个意思。
 * 判定在主进程做（渲染层 CSP 没有 unsafe-eval，`new Function` 在那边会被拒），
 * 渲染层的用法见 `lib/expression/exprSyntax.ts`。
 */
export type ExprSyntaxResult = { ok: true } | { ok: false; error: string }

export interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export interface ResourceSnapshot {
  cpuPercent: number
  memoryMB: number
  heapMB: number
  totalMemoryMB: number
  timestamp: string
}

export interface ResourceUsage {
  cpuPercent: number
  memoryMB: number
  memoryPercent: number
  uptime: number
}

export interface ResourceConfig {
  maxMemoryMB: number
  maxCPUPercent: number
}

export interface ResourceAlert {
  type: 'memory' | 'cpu'
  message: string
  timestamp: number
  value: number
  limit: number
}

export interface ResourceStatus {
  usage: ResourceUsage
  config: ResourceConfig
  lastAlert: ResourceAlert | null
}

/** Bot 管理器状态 */
export interface BotStatus {
  projectPath: string
  name: string
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  qq?: string
  adapter?: string
  error?: string
  startedAt?: string
  uptime?: number
  pid?: number | null
}

/** 历史采样点 */
export interface ResourceSamplePoint {
  cpuPercent: number
  memoryMB: number
  memoryPercent: number
  timestamp: number
}

/** 崩溃报告元数据（列表用） */
export interface CrashReportMeta {
  id: string
  timestamp: string
  type: 'uncaughtException' | 'unhandledRejection' | 'renderer' | 'captured'
  message: string
}

/** 完整崩溃报告 */
export interface CrashReportDetail {
  id: string
  timestamp: string
  type: 'uncaughtException' | 'unhandledRejection' | 'renderer' | 'captured'
  message: string
  stack: string
  version: string
  os: string
  extra?: Record<string, unknown>
}

export interface CrashExportResult {
  outputPath: string
  fileSize: number
}

export interface AuditEntry {
  id?: number
  time: string
  user: string
  table: string
  action: 'update' | 'insert' | 'delete'
  before: string | null
  after: string | null
}

/** Bot 管理列表项 */
export interface BotStatusInfo {
  projectPath: string
  name: string
  qq: string
  adapter: string
  status: 'stopped' | 'running' | 'crashed' | 'starting' | 'error'
  pid: number | null
  uptime: number | null
  startedAt?: string
}

/** AI Provider 信息（IPC 返回） */
export interface APIProviderInfo {
  providers: string[]
  current: string | null
}

/** 数据模板字段定义 */
export interface TemplateField {
  key: string
  label: string
  type: 'number' | 'boolean' | 'text' | 'date' | 'datetime' | 'json' | 'enum'
  default?: unknown
  auto?: boolean
  options?: { value: string; label: string }[]
  description?: string
  /**
   * 角色卡字段分类（可选）。声明后角色档案卡优先用此分类把字段归入对应簇展示。
   * 未声明时 fallback 到 dataBrowserConstants.FIELD_ALIASES 硬编码映射。
   * 允许自定义字段（如 '剑气' '灵力'）正确归入 combat/cultivation 等簇。
   */
  category?: FieldCategory
}

/** 数据模板分组 */
export interface TemplateGroup {
  id: string
  label: string
  icon: string
  fields: TemplateField[]
}

/** 数据模板（玩家初始化字段配置） */
export interface DataTemplate {
  version: number
  groups: TemplateGroup[]
}

/**
 * 基础数据回填的汇总结果（`launch:backfillPlayerBaseData` 的返回）。
 *
 * `skipped` 是**已经有过值**的 key 数 —— 回填幂等，`registered_at` 尤其不会被改写。
 */
export interface BaseDataBackfillSummary {
  /** 计划覆盖的玩家数 */
  players: number
  /** 实际写入的 key 总数 */
  written: number
  /** 因为已有值而跳过的 key 总数 */
  skipped: number
  /** 每个玩家的细节 */
  details: { uid: string; written: string[]; skipped: string[] }[]
}

/** 配置表字段定义（建表/改表时使用） */
export interface ConfigFieldDefinition {
  /** 英文字段名 */
  name: string
  /** 中文显示名 */
  label: string
  /** 字段类型 */
  type: 'integer' | 'real' | 'text' | 'boolean' | 'json' | 'enum' | 'ref'
  /** 描述 */
  description?: string
  /** 默认值 */
  defaultValue?: unknown
  /** 是否非空 */
  notNull?: boolean
  /** enum 选项 */
  enumValues?: string[]
  /** 最小值 */
  min?: number
  /** 最大值 */
  max?: number
  /** 引用字段：目标配置表名（type='ref' 时必填） */
  refTable?: string
  /** 引用字段：目标表里用作选项值与显示的字段（type='ref' 时必填） */
  refField?: string
}

/** 表结构变更选项 */
export interface AlterTableOptions {
  addFields?: ConfigFieldDefinition[]
  dropFields?: string[]
  updateFields?: ConfigFieldDefinition[]
}

/** 表结构变更结果 */
export interface AlterTableResult {
  addedFields: string[]
  droppedFields: string[]
  migratedRows: number
  rebuilt: boolean
}

export interface QqbatApi {
  /**
   * 智能体 SDK（第 61 批）：第三方插件驱动的**唯一稳定面**，见 `docs/ai/protocol-sdk.md`。
   *
   * 与 `ai:` 通道的区别：通道是实现细节（可重命名/拆分），这里是冻结契约 —— 改它要升
   * `src/shared/protocol/rpc/version.ts` 的版本号并按 `AGENT_METHODS` 登记。
   */
  agent: AgentSdk
  /** 智能体协议主版本（生态作者据此判兼容，见 shared/protocol/rpc/version.ts） */
  protocolVersion: number
  project: {
    create: (config: unknown) => Promise<ApiResult<ProjectMeta>>
    open: (path: string) => Promise<ApiResult<{ config: ProjectConfig; path: string }>>
    getMeta: (path: string) => Promise<ApiResult<ProjectMeta>>
    getConfig: (path: string) => Promise<ApiResult<ProjectConfig>>
    listRecent: () => Promise<ApiResult<RecentProject[]>>
    removeRecent: (path: string) => Promise<ApiResult<null>>
    pickDirectory: () => Promise<ApiResult<string>>
    saveConfig: (config: unknown, projectPath: string) => Promise<ApiResult<null>>
    updateTranslatorPort: (projectPath: string, port: number) => Promise<ApiResult<null>>
    /** 改机器人类型（只改这一个字段；建项目后也能改。类型不绑定节点） */
    updateBotType: (projectPath: string, botType: string) => Promise<ApiResult<null>>
    rename: (projectPath: string, newName: string) => Promise<ApiResult<null>>
    delete: (projectPath: string) => Promise<ApiResult<null>>
    move: (projectPath: string, offset: -1 | 1) => Promise<ApiResult<null>>
    openFolder: (projectPath: string) => Promise<ApiResult<null>>
    clone: (projectPath: string, newName: string) => Promise<ApiResult<ProjectMeta>>
  }
  flow: {
    load: (projectPath: string) => Promise<ApiResult<FlowGraph | null>>
    /** reason：触发这次保存的动作，只用于让 git 的自动提交说明能区分来源 */
    save: (
      projectPath: string,
      flow: FlowGraph,
      reason?: 'auto' | 'manual' | 'generate' | 'run' | 'other',
    ) => Promise<ApiResult<null>>
    /**
     * 本地测试：跑真解释器（临时克隆 + 记录型假 bot，无真实副作用）。
     * 结构定义见 src/shared/types/preview.ts（主进程与渲染层共用同一份）。
     */
    preview: (request: PreviewRequest) => Promise<ApiResult<PreviewResult>>
    /**
     * 运行前问题清单（不执行流程）：统一真相层的 normalize + validate。
     * 返回补全端口后的图，便于调用方按需回写。
     */
    validate: (
      projectPath: string,
      graph: FlowGraph,
    ) => Promise<ApiResult<{ issues: FlowIssue[]; normalizedNodes: number; graph: FlowGraph }>>
  }
  expression: {
    /**
     * 表达式静态校验（翻译 + 语法，**不执行**、不判未定义变量）。
     *
     * 注意返回值**不是** `ApiResult`：这里的 `ok` 含义是「语法通过」，
     * 不是「IPC 调用成功」。调用方请用 `lib/expression/exprSyntax.ts` 的 `checkExprSyntax`。
     */
    checkSyntax: (text: string) => Promise<ExprSyntaxResult>
  }
  codegen: {
    /**
     * @param version 版本信息三态：`undefined`=自动命名；`null`=**不打版本**（只生成）；
     *   对象 = 用命名面板里填的版号/名字。调试构建（debugMode）一律不打版本。
     */
    generate: (
      projectPath: string,
      flow: FlowGraph,
      debugMode?: boolean,
      version?: { name?: string; message?: string } | null,
    ) => Promise<ApiResult<{ version: string | null; versionError: string | null }>>
  }
  file: {
    read: (projectPath: string, relativePath: string) => Promise<ApiResult<string>>
    /**
     * 写文件。`data.securityCritical` 非空 = **这次写到了护栏文件**
     * （禁区/备份/模式值域那一类），界面要给与普通写入**不同**的警告；否则是 `null`。
     */
    write: (
      projectPath: string,
      relativePath: string,
      content: string,
    ) => Promise<ApiResult<{ securityCritical: SecurityCriticalWriteInfo | null }>>
    list: (
      projectPath: string,
      relativeDir?: string,
    ) => Promise<
      ApiResult<Array<{ name: string; path: string; isDirectory: boolean; size: number }>>
    >
    /**
     * `@` 引用的候选（第 58 批）。**只给路径与类型，不读内容** ——
     * 选中后插进输入的也只是 `@相对路径`，模型要看内容得自己调 `read_file`。
     */
    searchReferences: (
      projectPath: string,
      query: string,
      limit?: number,
    ) => Promise<ApiResult<{ references: Array<{ path: string; kind: 'file' | 'directory' }> }>>
    /** 框架开发模式：开关 + 框架根 + 现有回退点（**默认关**，主进程持有） */
    getDevMode: () => Promise<ApiResult<FrameworkDevState>>
    /**
     * 切开关。落盘失败时返回 ok:false（**状态不变**，fail-closed）；
     * `leftFrameworkWorkspace` = 关闭时主进程把"当前项目"从框架根上摘了下来，界面要退回普通项目。
     */
    setDevMode: (
      enabled: boolean,
    ) => Promise<
      ApiResult<{ enabled: boolean; persisted: boolean; leftFrameworkWorkspace: boolean }>
    >
    /** 从某个回退点恢复（会先把当前内容也备份一次，返回里的 rollbackPoint 就是那份） */
    restoreDevBackup: (
      revisionId: string,
      relativePath?: string,
    ) => Promise<ApiResult<FrameworkDevRestoreResult>>
  }
  official: {
    start: (projectPath: string) => Promise<ApiResult<null>>
    stop: (projectPath: string) => Promise<ApiResult<null>>
    status: (projectPath: string) => Promise<ApiResult<{ status: string }>>
    saveConfig: (
      projectPath: string,
      appId: string,
      appSecret: string,
      sandbox?: boolean,
      wsUrl?: string,
    ) => Promise<ApiResult<null>>
    getConfig: (
      projectPath: string,
    ) => Promise<
      ApiResult<{ appId: string; appSecret: string; sandbox: boolean; wsUrl: string } | null>
    >
    testConnection: (appId: string, appSecret: string) => Promise<ApiResult<{ connected: boolean }>>
    sendMessage: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      content: string,
      options?: Record<string, unknown>,
    ) => Promise<ApiResult<null>>
    uploadFile: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      fileType: number,
      url: string,
      fileName?: string,
    ) => Promise<ApiResult<null>>
    sendMedia: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      mediaUrl: string,
      fileType: number,
      fileName?: string,
      eventId?: string,
      msgId?: string,
    ) => Promise<ApiResult<null>>
    recallMessage: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      msgId: string,
    ) => Promise<ApiResult<null>>
    onStatusChange: (
      callback: (data: { projectPath: string; status: string }) => void,
    ) => () => void
    onMessage: (
      callback: (data: { projectPath: string; message: { type: string; data: unknown } }) => void,
    ) => () => void
    startTranslator: (projectPath: string, port: number) => Promise<ApiResult<null>>
    stopTranslator: (projectPath: string) => Promise<ApiResult<null>>
    getTranslatorStatus: () => Promise<ApiResult<{ running: boolean; port: number | null }>>
  }
  terminal: {
    create: (projectPath: string) => Promise<ApiResult<string>>
    write: (id: string, data: string) => Promise<ApiResult<null>>
    kill: (id: string) => Promise<ApiResult<null>>
    onData: (callback: (data: { id: string; data: string }) => void) => () => void
  }
  ai: {
    /** 用户侧的能力守卫设置（与 preload 的 ai.guardOptions 一一对应） */
    guardOptions: { allowDestructive: boolean; allowedTargets: string[] }
    /**
     * **agent-core 运行入口**（workspace-first 循环）。
     *
     * 这是**唯一**的对话入口（2026-10-25 起，旧助手链路 `ai:chat` 已删除）：
     * 跑到目标达成或轮数用尽，每个写盘动作都要过审批弹窗。回执**不是** `ApiResult`（没有 data 包一层），
     * 直接是 `{ ok, ... }` 判别联合 —— 形状定义在 `docs/ai/agent-core-wiring.md`。
     */
    agentCoreRun: (
      projectPath: string,
      requirement: string,
      /** 任务线程：这一轮记忆落哪条线程（不传 = 默认那份）。与 `chat` 同一个白名单 */
      threadId?: string,
      maxRounds?: number,
      /** 先计划：只给只读工具，不写盘、不跑命令（这一轮产出一份计划） */
      planFirst?: boolean,
      /** 完全权限：本次运行不再逐个审批（不落规则，重启失效） */
      fullAccess?: boolean,
      /** 本轮允许的工具名白名单（预设用；不传 = 注册表全量） */
      allowedTools?: string[],
      /**
       * 会话预设名（读 .qqbat/agent-presets.json；显式 allowedTools 优先）。
       * `null` = 明确跟页面；不传 = 没表态（空白线程会套项目默认，见第 51 批）。
       */
      preset?: string | null,
      /** 角色（界面模式）：按角色裁工具 + 角色提示词 */
      agentMode?: 'blocks' | 'code' | 'duo' | 'creator',
      /** 这一轮贴的图（data URL；只进这一轮，不进记忆） */
      images?: string[],
      /** 代码编辑器里打开的文件（项目内相对路径；只对 coder/duo 生效） */
      activeFilePath?: string,
    ) => Promise<
      | {
          ok: true
          finalText: string
          rounds: number
          phase:
            | { kind: 'idle' }
            | { kind: 'running'; step: number }
            | { kind: 'finished'; reason: 'completed' | 'max-rounds' | 'cancelled' }
          /** 每个工具调用：名字 + 参数 + 输出（界面把它映射成工具行） */
          toolResults: Array<{ name: string; args: Record<string, unknown>; output: string }>
          /**
           * 这条回答落盘的稳定 id（第 58 批）：消息反馈（👍/👎）挂在它上面。
           * 提案路径、空正文都没有（那时没有可反馈的落盘消息）。
           */
          messageId?: string
        }
      | { ok: false; error: string }
    >
    /** 设置项目默认预设（`null` = 跟页面；第 51 批） */
    setPresetDefault: (
      projectPath: string,
      preset: string | null,
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    /** 导出项目自定义预设（主进程弹保存对话框；取消报「用户取消」） */
    exportPresets: (
      projectPath: string,
    ) => Promise<
      | { ok: true; data: { filePath: string; count: number; warnings: string[] } }
      | { ok: false; error: string }
    >
    /** 选一个预设分享文件并回预览（只读；取消报「用户取消」） */
    pickPresetShare: (
      projectPath: string,
    ) => Promise<{ ok: true; data: PresetSharePick } | { ok: false; error: string }>
    /** 确认导入（写盘只在这里发生；sourceName 只用于撤销点展示） */
    importPresets: (
      projectPath: string,
      text: string,
      overwrite: boolean,
      sourceName?: string,
    ) => Promise<{ ok: true; data: PresetImportResult } | { ok: false; error: string }>
    /** 撤销最近一次导入（第 54 批）：恢复导入前的原始字节，导入后改过则拒绝 */
    undoPresetImport: (
      projectPath: string,
    ) => Promise<{ ok: true; data: PresetUndoResult } | { ok: false; error: string }>
    /** 读预设注册表（坏条目带 broken、字段被忽略带 notes；宿主侧唯一裁决） */
    getPresets: (
      projectPath: string,
      threadId?: string,
    ) => Promise<
      | {
          ok: true
          data: AgentPresetRoster & { session?: PresetSessionState; undo?: PresetUndoState }
        }
      | { ok: false; error: string }
    >
    /** 保存会话预设（整表覆盖；未知工具/插件以 warnings 返回，不拒绝） */
    savePresets: (
      projectPath: string,
      presets: Array<{
        name: string
        allowedTools?: string[]
        plugins?: string[]
        permissionMode?: 'ask' | 'full'
        description?: string
        /** 角色（builder / coder / duo / creator）：同时决定提示与写域 */
        role?: string
        /** 这一轮额外的要求（拼在角色说明之后；≤2000 字，超了截断） */
        prompt?: string
      }>,
    ) => Promise<ApiResult<{ saved: number; warnings: string[] }>>
    /**
     * **插话**：把一句话塞进正在跑的那一轮（下一个步边界注入）。
     * 没在跑时返回 `{ok:false}`（界面提示"先发新要求"，不要静默丢）。
     */
    agentCoreSteer: (
      projectPath: string,
      text: string,
      /** step = 插进当前这一轮；turn = 排到这一轮之后（默认 step） */
      target?: 'step' | 'turn',
    ) => Promise<ApiResult<{ queued: number; target: 'step' | 'turn' }>>
    /**
     * **真正**停下主进程里的 AI 请求。
     *
     * 缺了它，「停止」只是界面上的假动作：主进程照跑满 10 轮、工具照调、mutation 照累积。
     */
    cancelChat: (projectPath: string) => Promise<ApiResult<{ cancelled: boolean }>>
    /** 该项目此刻是否真有 AI 请求在飞（决定「停止」是否可用） */
    isRunning: (projectPath: string) => Promise<ApiResult<{ running: boolean }>>
    tools: () => Promise<ApiResult<AiToolDefinition[]>>
    /**
     * 工具结果上限（应用级设置）。
     *
     * `enabled: false` = 不裁剪。开着时超出 `thresholdChars`（码点）的工具结果会被裁剪，
     * 完整内容溢出到 `.qqbat/ai-spill/`，省略标记里带上那个路径。
     * 溢出失败时按 fail-open **不裁**（宁可上下文大一点，也不给没有出路的省略）。
     */
    getToolBudget: () => Promise<ApiResult<{ enabled: boolean; thresholdChars: number }>>
    /**
     * 「以后别再问」的规则表（撤销口）。
     *
     * 审批按钮点过「以后别再问」之后，同类动作会**不再弹窗直接执行** ——
     * 所以用户必须能看到现在有哪些，并且能删掉：看 / 删单条 / 清空。
     */
    getAllowRules: (projectPath: string) => Promise<ApiResult<{ rules: AiAllowRule[] }>>
    removeAllowRule: (
      projectPath: string,
      kind: AiAllowRule['kind'],
      match: string,
    ) => Promise<ApiResult<{ rules: AiAllowRule[] }>>
    clearAllowRules: (projectPath: string) => Promise<ApiResult<{ rules: AiAllowRule[] }>>
    setToolBudget: (setting: {
      enabled: boolean
      thresholdChars: number
    }) => Promise<ApiResult<{ enabled: boolean; thresholdChars: number }>>
    /**
     * 「测试」按钮：真的发一次最小请求。
     *
     * 返回值分两层：`ApiResult` 是 IPC 通不通，`data.ok` 是**模型**通不通 ——
     * 界面必须把两者分开显示，否则会把用户引去查错方向。
     */
    testConfig: (config: AiConfig) => Promise<
      ApiResult<{
        ok: boolean
        model?: string
        latencyMs?: number
        sample?: string
        error?: string
      }>
    >
    /** 读回该项目的磁盘对话记忆（界面那份是内存态，重启就没了）；threadId 不传 = 默认那一条 */
    getHistory: (
      projectPath: string,
      threadId?: string,
    ) => Promise<
      ApiResult<{
        entries: Array<{
          /**
           * 稳定 id（第 58 批）：消息反馈挂在它上面。
           * 老历史文件没有这个字段 → 界面不给反馈按钮（存不下就别给入口）。
           */
          id?: string
          role: 'user' | 'assistant' | 'attempt'
          content: string
          ts: string
          /** 仅 attempt：失败还是被取消 */
          reason?: 'error' | 'cancelled'
          ok?: boolean
        }>
      }>
    >
    /** 任务线程列表（按最后活动时间倒序）—— 一个项目可以有多条任务 */
    listThreads: (projectPath: string) => Promise<
      ApiResult<{
        threads: Array<{
          id: string
          title: string
          /** 标题来源（第 56 批）：fallback=首条需求推导；provider=AI 起的；user=用户改的（pin） */
          titleSource: 'fallback' | 'provider' | 'user'
          updatedAt: number
          messageCount: number
          /** 整条线程的规模（第 56 批）：轮/消息/字符/估算 token/时间跨度 */
          stats: {
            turns: number
            messages: number
            assistantMessages: number
            chars: number
            estimatedTokens: number
            durationMs: number
          }
        }>
      }>
    >
    /** **真的**清空某条线程的记忆（在此之前界面上的「清空」只清渲染层） */
    clearThread: (projectPath: string, threadId: string) => Promise<ApiResult<null>>
    /**
     * 给会话线程起名（第 56 批）。
     * 归一（剥控制序列、按 64 字节截断）在主进程；归一后为空 → {ok:false,error}。
     */
    renameThread: (
      projectPath: string,
      threadId: string,
      title: string,
    ) => Promise<ApiResult<{ title: string; source: 'user'; updatedAt: string }>>
    /**
     * 在**本项目**的线程里搜正文（第 57 批）。
     * 返回里每条线程都带 `hits`（片段前后文），界面拿到就能渲染，不用再查一次列表。
     */
    searchThreads: (
      projectPath: string,
      query: string,
      limit?: number,
    ) => Promise<
      ApiResult<{
        /** 归一后的查询（回显用） */
        query: string
        results: Array<{
          id: string
          title: string
          titleSource: 'fallback' | 'provider' | 'user'
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
          hits: Array<{
            index: number
            role: 'user' | 'assistant'
            before: string
            match: string
            after: string
            moreBefore: boolean
            moreAfter: boolean
          }>
        }>
      }>
    >
    /** 导出某条线程为 Markdown（主进程弹保存对话框并写盘；用户取消 = 明确错误） */
    exportThread: (
      projectPath: string,
      threadId: string,
    ) => Promise<ApiResult<{ filePath: string; bytes: number; entries: number }>>
    /**
     * 消息反馈（第 58 批）：整表读、逐条写。
     *
     * `items` 以**消息 id** 为键 —— 这个 id 由主进程在落盘时生成并随 `ai:response` 下发，
     * 位置派生的 `hist-i-k` **不能**用来挂反馈（压缩/重读后会变）。
     */
    getThreadFeedback: (
      projectPath: string,
      threadId: string,
    ) => Promise<
      ApiResult<{
        items: Record<
          string,
          {
            rating: 'positive' | 'negative'
            category?: string
            note?: string
            createdAt: string
            updatedAt: string
          }
        >
      }>
    >
    putMessageFeedback: (payload: {
      projectPath: string
      threadId: string
      messageId: string
      rating: 'positive' | 'negative'
      category?: string
      note?: string
    }) => Promise<
      ApiResult<{
        item: {
          rating: 'positive' | 'negative'
          category?: string
          note?: string
          createdAt: string
          updatedAt: string
        }
      }>
    >
    /** 撤回：点掉已选中的那档 = 删掉这条反馈（不存在时 removed:false，不报错） */
    deleteMessageFeedback: (
      projectPath: string,
      threadId: string,
      messageId: string,
    ) => Promise<ApiResult<{ removed: boolean }>>
    /** 已记录的 AI 轮次（新的在前）—— 「撤回这一轮」的候选 */
    /** 回工具批准决定（主进程在 ask 时会停下来等它） */
    resolveApproval: (
      callId: string,
      decision: 'allow' | 'deny' | 'always',
    ) => Promise<ApiResult<{ applied: boolean }>>
    /** 主进程在等某个工具调用的批准 */
    onApprovalRequest: (
      cb: (data: {
        projectPath?: string
        callId: string
        toolName: string
        args: Record<string, unknown>
        hint: string
        timeoutMs: number
      }) => void,
    ) => () => void
    onApprovalResolved: (
      cb: (data: {
        projectPath?: string
        callId: string
        decision: 'allow' | 'deny' | 'always'
      }) => void,
    ) => () => void
    /**
     * 最近若干轮的**投影**（一轮 = 一条用户消息 + 它改过的文件 + 跑过的工具 + 耗时）。
     *
     * 以前这里只有轮次元信息，界面想知道"这轮跑了几个工具"得自己再去读 trace —— 两处各算一遍。
     */
    listAiTurns: (projectPath: string) => Promise<
      ApiResult<{
        turns: Array<{
          id: string
          startedAt: string
          userMessage: string
          fileCount: number
          /** 这一轮动过的文件（created = 新建 / modified = 改已有） */
          files?: Array<{ path: string; change: 'created' | 'modified' }>
          /** 逐文件行数变化（oversize 时 exact=false，不猜） */
          changes?: Array<{
            path: string
            kind: 'added' | 'modified' | 'removed'
            added: number
            removed: number
            exact: boolean
          }>
          /** 这一轮动过玩家数据吗（data/ 快照会一起还原） */
          data?: boolean
          /** 这一轮跑过的工具（成功与否 + 耗时） */
          tools?: Array<{ name: string; ok: boolean; ms: number }>
          stats?: { fileCount: number; toolCount: number; failedTools: number; ms: number }
        }>
      }>
    >
    /** 撤回某一轮（文件回滚 + 流程还原）；调用方拿到结果后要重新加载画布 */
    /** 撤回**预览**（只读，不执行撤回） */
    previewAiTurn: (
      projectPath: string,
      turnId: string,
    ) => Promise<
      ApiResult<{
        preview: {
          id: string
          userMessage: string
          restore: string[]
          remove: string[]
          data: boolean
          /** 逐文件变更摘要（「本轮改动」卡用；行数由主进程用 LCS 算） */
          changes: {
            path: string
            kind: 'added' | 'modified' | 'removed'
            added: number
            removed: number
            exact: boolean
          }[]
        } | null
      }>
    >
    /** 从此处重开对话：回退这句之后的产物 + 记忆截断到这句之前 */
    rewindAiTo: (
      projectPath: string,
      messageText: string,
      threadId?: string,
    ) => Promise<
      ApiResult<{ kept: number; dropped: number; rolledBack: number; turnsFound: number }>
    >
    rollbackAiTurn: (
      projectPath: string,
      turnId: string,
      /** 撤回时连同**对话**一起退回（不传=默认线程） */
      threadId?: string,
    ) => Promise<
      ApiResult<{
        result: {
          turnId: string
          restored: string[]
          removed: string[]
          /** 这一轮开始时的 flow.json 原文（由渲染层装回画布；主进程不写文件） */
          flowSnapshot: string | null
          /** 玩家数据（data/）是否也一并还原了 */
          restoredData: boolean
          /** 顺带从对话记忆里退掉了多少条消息（撤回应回到那一轮之前） */
          droppedMessages?: number
        }
      }>
    >
    getConfig: (projectPath?: string) => Promise<ApiResult<AiConfig | null>>
    setConfig: (config: AiConfig) => Promise<ApiResult<null>>
    /** 把作者助手配置落盘到项目的 `.qqbat/project.json`（合并式写入，只覆盖 ai 字段） */
    saveProjectConfig: (
      projectPath: string,
      config: AiConfig,
    ) => Promise<ApiResult<{ saved: boolean }>>
    // ===== 智能体面板：两套 AI（全局 / 每项目）=====
    /** 全局智能体配置（应用级一份，开发所有项目共用） */
    /** Key 池（回退链）：只写它。一项 = provider + model + apiKey（上限 8，扁平不嵌套） */
    setAiFallbacks: (
      fallbacks: { provider: string; model: string; apiKey: string; baseUrl?: string }[],
    ) => Promise<ApiResult<{ saved: boolean }>>
    getAppConfig: () => Promise<ApiResult<AiConfig | null>>
    setAppConfig: (config: AiConfig) => Promise<ApiResult<{ saved: boolean }>>
    /** 某个项目自己的「AI 对话」配置；null = 跟随全局 */
    getProjectBotConfig: (projectPath: string) => Promise<ApiResult<AiConfig | null>>
    setProjectBotConfig: (
      projectPath: string,
      config: AiConfig | null,
    ) => Promise<ApiResult<{ saved: boolean }>>
    /** 面板要一次列出**所有项目**各自的实际配置（核心诉求：不用切项目就能配） */
    listProjectBotConfigs: () => Promise<
      ApiResult<{
        global: AiConfig | null
        projects: {
          projectPath: string
          name: string
          own: AiConfig | null
          effective: AiConfig | null
          followsGlobal: boolean
        }[]
      }>
    >
    /** 把"用户对计划的处置"写进项目记忆（应用 / 拒绝 / 回滚）—— 模型下一轮据此知道结果 */
    noteTurn: (projectPath: string, note: string, threadId?: string) => Promise<ApiResult<null>>
    /** 批处理是**按项目**的事务（切换项目不该串），所以都要带 projectPath */
    beginBatch: (projectPath: string) => Promise<ApiResult<null>>
    commitBatch: (projectPath: string) => Promise<ApiResult<null>>
    rollbackBatch: (projectPath: string) => Promise<ApiResult<null>>
    onChunk: (
      callback: (data: { projectPath?: string; text: string; kind?: 'reasoning' }) => void,
    ) => () => void
    /** 工具调用事件（主进程在开始/结束时各发一条）—— 面板用它渲染工具调用卡片 */
    onToolCall: (
      callback: (data: {
        projectPath?: string
        id: string
        name?: string
        args?: Record<string, unknown>
        /** 呈现契约（主进程带才有；缺省不带键） */
        presentation?: ToolPresentation
        /** 失败分类 + 建议动作（只在失败时带） */
        failure?: import('@shared/ai/toolFailure').ToolFailure
        status: 'running' | 'done' | 'error' | 'aborted'
        result?: string
        timestamp: number
      }) => void,
    ) => () => void
    /** 步边界：这一轮走到第几步（1-based，maxSteps 是本轮上限） */
    onAgentStep: (
      callback: (data: { projectPath?: string; step: number; maxSteps: number }) => void,
    ) => () => void
    /**
     * 任务清单变了（`todo_write` 写成功之后；每轮开始先发一条空的 = 清空）。
     * 整表覆盖：收到什么就整体替换界面上的清单。
     */
    onTodo?: (
      callback: (data: {
        projectPath?: string
        todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
      }) => void,
    ) => () => void
    /**
     * 循环内上下文被压缩（循环独有）。界面据此留一条"丢掉了什么"的痕迹，
     * 否则模型忽然忘了前面的事，用户只会觉得它变笨了。
     */
    onCompact?: (
      callback: (data: {
        projectPath?: string
        dropped: number
        tokensBefore: number
        tokensAfter: number
      }) => void,
    ) => () => void
    onResponse: (
      callback: (data: {
        projectPath?: string
        message: string
        /**
         * 这条回答在主进程落盘时的**稳定 id**（第 58 批）。
         * 只有真正写进记忆的正文才有；提案路径/空正文没有 → 界面不给反馈按钮。
         */
        messageId?: string
        toolCalls?: unknown[]
      }) => void,
    ) => () => void
    /**
     * 会话自动标题生成完成（第 56 批）：只在线程首轮成功后可能来一次，
     * 渲染层据此刷新线程列表（不改当前对话内容）。
     */
    onThreadTitle: (
      callback: (data: {
        projectPath?: string
        threadId: string
        title: string
        source: 'fallback' | 'provider' | 'user'
      }) => void,
    ) => () => void
    onClientInstruction: (
      callback: (data: {
        projectPath?: string
        requestId?: string
        instruction: { name: string; args: Record<string, unknown> }
      }) => void,
    ) => () => void
    /**
     * 回一条写指令的执行结果（P1-1）。requestId 来自 onClientInstruction；
     * 不回 = 主进程按超时判失败（宁可失败，也不许假成功）。
     */
    resolveInstruction: (result: {
      requestId: string
      outcome:
        | { status: 'applied'; detail?: string }
        | { status: 'rejected'; reason: string }
        | { status: 'failed'; reason: string }
    }) => Promise<ApiResult<{ applied: boolean }>>
    onAgentState: (
      callback: (data: {
        projectPath?: string
        state: 'idle' | 'thinking' | 'executing' | 'error'
        message?: string
        /** 多智能体阶段进度（侦察/规划/并行/执行）；没跑多智能体就不带 */
        stage?: {
          id: 'scout' | 'planner' | 'lanes' | 'execute' | 'verify'
          label: string
          status: 'start' | 'done' | 'skip' | 'fail'
          ms?: number
          detail?: string
        }
      }) => void,
    ) => () => void
    /**
     * **本轮统计**（状态条）：轮数 / 步数 / 厂商回传的 token / 缓存命中 / 上下文占用。
     * token 字段只有厂商回传了才有意义（`usageReported=false` → 界面不显示数字）。
     */
    onStats: (callback: (data: { projectPath?: string; stats: AiRunStats }) => void) => () => void
    onProposal: (
      callback: (data: { projectPath?: string; proposal: Proposal }) => void,
    ) => () => void
    /** 主进程侧的运行期错误（密钥错 / 断网 / 规划超时）——少了它错误对用户不可见 */
    onError: (callback: (data: { projectPath?: string; message: string }) => void) => () => void
    /** 主进程侧的警告（已取消 / 超时但有部分计划）—— 同样要能收尾 */
    onWarning: (callback: (data: { projectPath?: string; message: string }) => void) => () => void
    /** 并行工具调用数设置 */
    getParallelToolCalls: () => Promise<ApiResult<{ enabled: boolean; maxParallel: number }>>
    setParallelToolCalls: (
      enabled: boolean,
      maxParallel: number,
    ) => Promise<ApiResult<{ enabled: boolean; maxParallel: number }>>
    /** 每轮自动刷新会话标题设置（第 60 批）：off = 标题不动，auto = 每轮重写一次 */
    getThreadTitleRefresh: () => Promise<ApiResult<{ mode: 'off' | 'auto' }>>
    setThreadTitleRefresh: (mode: 'off' | 'auto') => Promise<ApiResult<{ mode: 'off' | 'auto' }>>
  }
  // 控制/状态统一走 botManager:*；这里只剩观测（日志/节点事件）与测试注入
  runtime: {
    onLog: (
      callback: (
        data:
          | { projectPath: string; entry: BotLogEntry }
          | Array<{ projectPath: string; entry: BotLogEntry }>,
      ) => void,
    ) => () => void
    onExecuteNode: (
      callback: (data: { projectPath: string; event: ExecuteNodeEvent }) => void,
    ) => () => void
    injectTestMessage: (
      projectPath: string,
      message: string,
      chatType?: 'group' | 'c2c',
      chatId?: number,
    ) => Promise<ApiResult<{ sent: boolean }>>
  }
  history: {
    list: (projectPath: string) => Promise<
      ApiResult<
        Array<{
          version: string
          timestamp: string
          fileName: string
          filePath: string
          size: number
        }>
      >
    >
    restore: (projectPath: string, fileName: string) => Promise<ApiResult<null>>
    read: (projectPath: string, fileName: string) => Promise<ApiResult<string>>
  }
  git: {
    init: (projectPath: string) => Promise<ApiResult<boolean>>
    log: (
      projectPath: string,
      maxCount?: number,
    ) => Promise<ApiResult<Array<{ hash: string; message: string; timestamp: string }>>>
    status: (
      projectPath: string,
    ) => Promise<
      ApiResult<{ branch: string; commitCount: number; clean: boolean; changes: string[] } | null>
    >
    diff: (
      projectPath: string,
      hash: string,
    ) => Promise<ApiResult<{ files: string[]; patch: string } | null>>
    /** 读档：把某个历史版本的 flow.json 取回来（会先备份当前文件，并追加一条 restore 提交） */
    restoreFlow: (
      projectPath: string,
      hash: string,
    ) => Promise<ApiResult<{ nodes: number; backupPath: string }>>
    /** 清空历史：.git 改名留存后重新 init */
    clearHistory: (projectPath: string) => Promise<ApiResult<{ archivedPath: string }>>
    /** 删除若干条提交：返回备份 ref（出问题可据此回滚）与工作区是否因此出现差异 */
    deleteCommits: (
      projectPath: string,
      hashes: string[],
    ) => Promise<
      ApiResult<{ rewritten: number; branch: string; backupRef: string; worktreeDirty: boolean }>
    >
    /** 重命名一条提交的说明 */
    rewordCommit: (
      projectPath: string,
      hash: string,
      message: string,
    ) => Promise<
      ApiResult<{ rewritten: number; branch: string; backupRef: string; worktreeDirty: boolean }>
    >
    /** 版本标签（tag）：与"提交"是两件事 —— 提交自动记每一步，标签是人为的里程碑 */
    listVersionTags: (projectPath: string) => Promise<
      ApiResult<{
        tags: Array<{ name: string; hash: string; message: string; timestamp: string }>
        next: string
        /** 当前 HEAD 的 hash：界面判断"这次有没有产生新提交 / 当前提交是否已有版本" */
        headHash: string | null
      }>
    >
    tagVersion: (
      projectPath: string,
      name?: string,
      message?: string,
    ) => Promise<ApiResult<{ name: string; hash: string; message: string; timestamp: string }>>
    renameVersionTag: (
      projectPath: string,
      oldName: string,
      newName: string,
    ) => Promise<ApiResult<null>>
    deleteVersionTag: (projectPath: string, name: string) => Promise<ApiResult<null>>
  }
  diagnostics: {
    export: (projectPath: string) => Promise<ApiResult<{ outputPath: string; fileSize: number }>>
    /** 渲染层把一行诊断写进主进程日志（仅开发环境使用） */
    rendererLog: (line: string) => Promise<ApiResult<null>>
    onProgress: (
      callback: (data: { phase: string; message: string; error?: string }) => void,
    ) => () => void
  }
  // 说明：`debugger:*`（源码级调试 / debugpy）的声明**已整个删除**（2026-09-30）——
  // 主进程从未注册那些通道，且它调试的 Python 运行时已被 ADR 移除。
  // 现存的是节点级调试：`debug: { ... }`。
  customNode: {
    scan: (projectPath: string) => Promise<
      ApiResult<
        Array<{
          name: string
          funcName: string
          inputs: string[]
          outputs: string[]
          icon: string
          description: string
        }>
      >
    >
    scanAiGenerated: (projectPath: string) => Promise<ApiResult<NodeSpecV2[]>>
    watch: (projectPath: string) => Promise<ApiResult<null>>
    unwatch: (projectPath: string) => Promise<ApiResult<null>>
    fork: (
      projectPath: string,
      builtinKind: string,
      newName: string,
    ) => Promise<{ success: boolean; newKind: string; error?: string }>
    onChanged: (callback: (data: { projectPath: string }) => void) => () => void
  }
  metrics: {
    start: () => Promise<ApiResult<null>>
    stop: () => Promise<ApiResult<null>>
    getHistory: () => Promise<ApiResult<MetricSnapshot[]>>
    getSnapshot: () => Promise<ApiResult<MetricSnapshot>>
    exportToCSV: () => Promise<ApiResult<{ success: boolean; filePath: string }>>
    exportToJSON: () => Promise<ApiResult<{ success: boolean; filePath: string }>>
    onSnapshot: (callback: (data: MetricSnapshot) => void) => () => void
  }
  crash: {
    getReports: (count?: number) => Promise<ApiResult<CrashReportMeta[]>>
    readReport: (id: string) => Promise<ApiResult<CrashReportDetail>>
    clearReports: () => Promise<ApiResult<null>>
    capture: (message: string, stack?: string, extra?: Record<string, unknown>) => void
    exportDiagnostic: () => Promise<ApiResult<CrashExportResult>>
    onShowCrashPanel: (callback: () => void) => () => void
  }
  // 说明：旧的 `resources`（resources:startMonitor / stopMonitor / getSnapshot / onSnapshot）
  // **已整个删除**（2026-09-30）—— 它早已被 `resourceMonitor:*` 取代，主进程那份标了
  // `@deprecated` 并写着"当所有调用方迁移完毕后可安全删除此文件"。本轮核对确认：
  // 渲染层零调用方、无人引用 `registerResourceIpc`，条件成立。
  // 其中 `onSnapshot` 订阅的 `resources:snapshot` **主进程从来不发**（是个永远不响的回调）。
  resourceMonitor: {
    start: (pid: number) => Promise<ApiResult<null>>
    stop: () => Promise<ApiResult<null>>
    getUsage: () => Promise<ApiResult<ResourceUsage>>
    getConfig: () => Promise<ApiResult<ResourceConfig>>
    setConfig: (config: {
      maxMemoryMB?: number
      maxCPUPercent?: number
    }) => Promise<ApiResult<null>>
    getHistory: () => Promise<ApiResult<ResourceSamplePoint[]>>
    onUsage: (callback: (data: ResourceUsage) => void) => () => void
    onConfig: (callback: (data: ResourceConfig) => void) => () => void
    onStatus: (callback: (data: ResourceStatus) => void) => () => void
    onAlert: (
      callback: (data: { type: string; message: string; timestamp: number }) => void,
    ) => () => void
  }
  stateStore: {
    set: (projectPath: string, key: string, value: unknown) => Promise<ApiResult<null>>
    get: (projectPath: string, key: string) => Promise<ApiResult<unknown>>
    delete: (projectPath: string, key: string) => Promise<ApiResult<boolean>>
    listKeys: (projectPath: string, prefix?: string) => Promise<ApiResult<string[]>>
    setSessionVar: (
      projectPath: string,
      sessionId: string,
      varName: string,
      value: unknown,
    ) => Promise<ApiResult<null>>
    getSessionVar: (
      projectPath: string,
      sessionId: string,
      varName: string,
    ) => Promise<ApiResult<unknown>>
    clearSession: (projectPath: string, sessionId: string) => Promise<ApiResult<null>>
    stats: (
      projectPath: string,
    ) => Promise<ApiResult<{ stateCount: number; sessionCount: number; dbSize: number }>>
    getAllStateEntries: (
      projectPath: string,
    ) => Promise<ApiResult<Array<{ key: string; value: unknown; updatedAt: number }>>>
    clearAll: (projectPath: string) => Promise<ApiResult<null>>
  }
  debug: {
    setBreakpoints: (breakpoints: Breakpoint[]) => Promise<ApiResult<null>>
    start: () => Promise<ApiResult<null>>
    stepOver: () => Promise<ApiResult<null>>
    stepInto: () => Promise<ApiResult<null>>
    stepOut: () => Promise<ApiResult<null>>
    continue: () => Promise<ApiResult<null>>
    pause: () => Promise<ApiResult<null>>
    stop: () => Promise<ApiResult<null>>
    getState: () => Promise<ApiResult<DebugState>>
    getVariables: () => Promise<ApiResult<DebugVar[]>>
    onStateChanged: (callback: (state: DebugState) => void) => () => void
  }
  plugin: {
    scan: (projectPath: string) => Promise<ApiResult<PluginInfo[]>>
    /** 新建可编辑的自定义节点骨架；返回写入的相对路径，便于界面直接打开 */
    createNode: (
      projectPath: string,
      name: string,
      label?: string,
    ) => Promise<
      ApiResult<{
        pluginName: string
        dir: string
        manifestRelPath: string
        entryRelPath: string
        kind: string
      }>
    >
    load: (pluginPath: string) => Promise<ApiResult<PluginPackage>>
    /** 装载 AI 插件（清单 ai:true）：返回插件 id；贡献的工具已在主进程注册 */
    loadAi: (pluginPath: string) => Promise<ApiResult<{ pluginId: string; name: string }>>
    unload: (pluginName: string) => Promise<ApiResult<{ name: string }>>
    install: (
      projectPath: string,
    ) => Promise<ApiResult<{ name: string; version: string; path: string }>>
    listInstalled: () => Promise<ApiResult<PluginInfo[]>>
    /** 外部窗口包（第 73 批）：<userData>/plugins/windows/ 下的声明式窗口清单 */
    listWindows: () => Promise<ApiResult<WindowPackageScanResult>>
    /** 宿主插件（应用级能力：工具/提示）只读清单 */
    listHost: () => Promise<
      ApiResult<
        Array<{
          id: string
          name: string
          version: string
          enabled: boolean
          source: 'builtin' | 'runtime'
          /** 它声明了哪些能力（tool / prompt） */
          permissions: string[]
          /** 用户可填参数声明；空 = 这个插件没有可配置项 */
          settings: PluginSettingSpec[]
          /** 它注册了哪些工具名（内置插件也有） */
          tools: string[]
          readOnlyReason?: 'management-required' | 'unaddressable' | 'not-removable'
        }>
      >
    >
    /** 启停宿主插件（builtin）：not-removable 的会被主进程拒绝 */
    setHostEnabled: (id: string, enabled: boolean) => Promise<ApiResult<null>>
    /** 读一个宿主插件的设置声明 + 当前值 */
    getSettings: (
      id: string,
    ) => Promise<
      ApiResult<{ id: string; settings: PluginSettingSpec[]; values: PluginSettingValues }>
    >
    /** 保存宿主插件设置（写盘 + 热更新，运行中的插件立即生效） */
    saveSettings: (
      id: string,
      values: Record<string, string | number | boolean>,
    ) => Promise<ApiResult<{ id: string; values: PluginSettingValues }>>
    setEnabled: (
      pluginName: string,
      enabled: boolean,
    ) => Promise<ApiResult<{ name: string; enabled: boolean }>>
    /** 插件市场清单：官方离线源 + 用户来源，含兼容性/安装状态 */
    marketList: () => Promise<ApiResult<MarketListResult>>
    marketAddSource: (source: string) => Promise<ApiResult<string[]>>
    marketRemoveSource: (source: string) => Promise<ApiResult<string[]>>
    marketInspect: (id: string) => Promise<ApiResult<MarketInstallPlan>>
    marketInstall: (id: string, expectDigest?: string) => Promise<ApiResult<MarketInstallInfo>>
    marketUninstall: (id: string) => Promise<ApiResult<{ id: string }>>
    getAllSpecs: () => Promise<ApiResult<NodeSpec[]>>
  }
  adapter: {
    list: () => Promise<ApiResult<string[]>>
    switch: (type: string) => Promise<ApiResult<string>>
    current: () => Promise<ApiResult<string>>
  }
  aiProvider: {
    list: () => Promise<ApiResult<APIProviderInfo>>
    test: (config: unknown) => Promise<ApiResult<{ response: string }>>
    switch: (provider: string, config: unknown) => Promise<ApiResult<{ provider: string }>>
    getConfig: () => Promise<ApiResult<{ current: string | null }>>
  }
  botManager: {
    list: () => Promise<ApiResult<BotStatus[]>>
    start: (projectPath: string) => Promise<ApiResult<null>>
    stop: (projectPath: string) => Promise<ApiResult<null>>
    restart: (projectPath: string) => Promise<ApiResult<null>>
    register: (projectPath: string) => Promise<ApiResult<null>>
    unregister: (projectPath: string) => Promise<ApiResult<null>>
    onStatusChanged: (callback: (data: BotStatus) => void) => () => void
    offStatusChanged: () => void
  }
  launchData: {
    listDataSources: (projectPath: string) => Promise<ApiResult<DataSource[]>>
    getSchema: (filePath: string) => Promise<ApiResult<TableSchema[]>>
    queryTable: (
      filePath: string,
      tableName: string,
      page: number,
      pageSize: number,
    ) => Promise<ApiResult<QueryResult>>
    updateRecord: (
      filePath: string,
      tableName: string,
      rowid: number,
      changes: Record<string, unknown>,
    ) => Promise<ApiResult<null>>
    insertRecord: (
      filePath: string,
      tableName: string,
      values: Record<string, unknown>,
    ) => Promise<ApiResult<number>>
    deleteRecord: (filePath: string, tableName: string, rowid: number) => Promise<ApiResult<null>>
    searchPlayer: (projectPath: string, query: string) => Promise<ApiResult<SearchResult[]>>
    /**
     * 把一个玩家并入另一个（存档 + 身份映射一起）。
     * 机器人运行时会被拒绝（翻译器的内存映射会覆盖改动）。
     */
    mergePlayers: (
      projectPath: string,
      fromUid: string,
      toUid: string,
    ) => Promise<
      ApiResult<{ moved: number; discarded: number; backups: string[]; mappingMoved: number }>
    >
    /** 只读检查身份一致性（见主进程 identityService） */
    checkIdentity: (projectPath: string) => Promise<
      ApiResult<{
        ok: boolean
        mappedCount: number
        dataPlayerCount: number
        issues: {
          kind: 'uid_collision' | 'orphan_data' | 'empty_mapping' | 'missing_mapping'
          uid: string
          detail: string
        }[]
      }>
    >
    /** 玩家存档的字段契约（见主进程 playerSchemaService） */
    getPlayerSchema: (projectPath: string) => Promise<
      ApiResult<{
        table: 'player'
        displayName: string
        fields: {
          key: string
          label: string
          type: string
          category: string
          isBaseData: boolean
          isEngineState: boolean
          source: 'declared' | 'observed' | 'manual'
          usage?: { modes: string[]; nodeCount: number; scope: string }
        }[]
      }>
    >
    /** 把当前契约落成文件（data/players/player.schema.json） */
    savePlayerSchema: (projectPath: string, schema: unknown) => Promise<ApiResult<null>>
    /** 删掉某个玩家的全部存档数据（不可逆；主进程会先备份该玩家的 db 文件） */
    deletePlayer: (
      projectPath: string,
      qq: string,
    ) => Promise<ApiResult<{ deleted: number; backups: string[] }>>
    listPlayers: (
      projectPath: string,
    ) => Promise<ApiResult<{ qq: string; recordCount: number; sources: string[] }[]>>
    queryPlayerTables: (
      filePath: string,
      qq: string,
    ) => Promise<
      ApiResult<{ table: string; fields: FieldSchema[]; rows: Record<string, unknown>[] }[]>
    >
    saveSchema: (
      projectPath: string,
      tableName: string,
      fields: Record<string, unknown>,
    ) => Promise<ApiResult<string>>
    // UID 映射
    getUidMapping: (
      projectPath: string,
    ) => Promise<ApiResult<{ nextUid: number; mapping: Record<string, number> }>>
    getPlayersWithUid: (projectPath: string) => Promise<
      ApiResult<
        Array<{
          uid: string
          openid: string | null
          nickname?: string
          recordCount: number
          sources: string[]
        }>
      >
    >
    updatePlayerUid: (
      projectPath: string,
      openid: string,
      newUid: number,
    ) => Promise<
      ApiResult<{
        oldUid: number | null
        success: boolean
        /** 迁移的存档行数（key 前缀 + qq 列一起改） */
        moved: number
        /** 冲突丢弃的行数（目标已有同字段，原值在备份里） */
        discarded: number
        backups: string[]
      }>
    >
    // 数据模板
    getDataTemplate: (projectPath: string) => Promise<ApiResult<DataTemplate>>
    /** 从项目自身推导一份模板（「恢复默认」用：默认内容 = 项目里真实声明/存在的字段） */
    deriveDataTemplate: (projectPath: string) => Promise<ApiResult<DataTemplate>>
    saveDataTemplate: (projectPath: string, template: DataTemplate) => Promise<ApiResult<boolean>>
    /** 还有几个玩家没有引擎基础数据（面板据此提示"可以初始化"） */
    countPlayersMissingBaseData: (projectPath: string) => Promise<ApiResult<number>>
    /**
     * 给历史玩家回填基础数据（注册时间/最后在线/消息计数）。
     * 幂等：已有值的 key 一律不动；值由存档的 `updated_at` 推断（天级精度）。
     */
    backfillPlayerBaseData: (projectPath: string) => Promise<ApiResult<BaseDataBackfillSummary>>
  }
  /**
   * 指令面板同步（本项目里**唯一会改动 QQ 线上状态**的路径）。
   *
   * `list` 只读；`apply` 先带 `dryRun: true` 拿"将会发生什么"给确认框，
   * 用户点确定后再不带 dryRun 调一次。
   */
  panelSync: {
    list: (projectPath: string, scope: string) => Promise<ApiResult<RemotePanelInfo[]>>
    /** 读当前自定义菜单（只读，GET /v2/menu） */
    menu: (projectPath: string) => Promise<ApiResult<{ version: number; menu: unknown }>>
    apply: (
      projectPath: string,
      payload: { scope: string; items: unknown[]; remark?: string; dryRun?: boolean },
    ) => Promise<ApiResult<ApplyPanelInfo>>
  }
  /** 能力自检（全程只发 GET） */
  capability: {
    probe: (projectPath: string) => Promise<ApiResult<CapabilityReportInfo>>
  }
  buttonPanel: {
    list: (projectPath: string) => Promise<ApiResult<ButtonPanel[]>>
    get: (projectPath: string, panelId: string) => Promise<ApiResult<ButtonPanel>>
    create: (
      projectPath: string,
      payload: { name: string; description?: string; keyboard?: unknown },
    ) => Promise<ApiResult<ButtonPanel>>
    update: (
      projectPath: string,
      payload: {
        panelId: string
        patch: Partial<Pick<ButtonPanel, 'name' | 'description' | 'keyboard'>>
      },
    ) => Promise<ApiResult<ButtonPanel>>
    delete: (projectPath: string, panelId: string) => Promise<ApiResult<boolean>>
    duplicate: (
      projectPath: string,
      panelId: string,
      newName?: string,
    ) => Promise<ApiResult<ButtonPanel>>
    listBuiltin: () => Promise<
      ApiResult<
        Array<{ templateId: string; name: string; description: string; buttonCount: number }>
      >
    >
    importBuiltin: (
      projectPath: string,
      templateIds?: string[],
    ) => Promise<ApiResult<ButtonPanel[]>>
  }
  launchConfig: {
    listCategories: (projectPath: string) => Promise<ApiResult<ConfigCategory[]>>
    getTable: (
      projectPath: string,
      category: string,
      page: number,
      pageSize: number,
    ) => Promise<ApiResult<QueryResult>>
    getSchema: (projectPath: string, category: string) => Promise<ApiResult<TableSchema[]>>
    updateRecord: (
      projectPath: string,
      category: string,
      rowid: number,
      changes: Record<string, unknown>,
    ) => Promise<ApiResult<null>>
    insertRecord: (
      projectPath: string,
      category: string,
      values: Record<string, unknown>,
    ) => Promise<ApiResult<number>>
    deleteRecord: (projectPath: string, category: string, rowid: number) => Promise<ApiResult<null>>
    // 表结构管理
    createTable: (
      projectPath: string,
      displayName: string,
      fields: ConfigFieldDefinition[],
    ) => Promise<ApiResult<{ tableName: string; filePath: string }>>
    dropTable: (projectPath: string, category: string) => Promise<ApiResult<null>>
    renameTable: (
      projectPath: string,
      oldCategory: string,
      newDisplayName: string,
    ) => Promise<ApiResult<{ oldName: string; newName: string }>>
    alterTable: (
      projectPath: string,
      category: string,
      options: AlterTableOptions,
    ) => Promise<ApiResult<AlterTableResult>>
    // 说明：previewConfigTables / listLayerTemplates 随模板库移除（无数据源可预览）
  }
  launchDashboard: {
    getStatus: (projectPath: string) => Promise<ApiResult<DashboardStatus>>
    getTimeline: (projectPath: string) => Promise<ApiResult<TimelineItem[]>>
    getGroups: (projectPath: string) => Promise<ApiResult<GroupInfo[]>>
  }
  audit: {
    log: (
      projectPath: string,
      entry: {
        user: string
        table: string
        action: 'update' | 'insert' | 'delete'
        before: string | null
        after: string | null
      },
    ) => Promise<ApiResult<null>>
    list: (
      projectPath: string,
      page: number,
      pageSize: number,
    ) => Promise<ApiResult<{ rows: AuditEntry[]; total: number }>>
    search: (projectPath: string, query: string) => Promise<ApiResult<AuditEntry[]>>
  }
  backup: {
    create: (
      projectPath: string,
      dbPath: string,
      description: string,
    ) => Promise<ApiResult<string | null>>
    list: (
      projectPath: string,
    ) => Promise<ApiResult<{ name: string; time: string; description: string; size: number }[]>>
    restore: (projectPath: string, backupName: string) => Promise<ApiResult<boolean>>
    snapshot: (projectPath: string, name?: string) => Promise<ApiResult<string>>
  }
  dataTransfer: {
    exportJson: (dbPath: string, tableName: string, outputPath: string) => Promise<ApiResult<null>>
    exportCsv: (dbPath: string, tableName: string, outputPath: string) => Promise<ApiResult<null>>
    importJson: (dbPath: string, tableName: string, jsonPath: string) => Promise<ApiResult<number>>
    importCsv: (dbPath: string, tableName: string, csvPath: string) => Promise<ApiResult<number>>
  }
  data: {
    notifyChange: (
      projectPath: string,
      table: string,
      action: string,
      qq?: string,
    ) => Promise<ApiResult<null>>
    registerBridge: (projectPath: string, port: number) => Promise<ApiResult<null>>
    unregisterBridge: (projectPath: string) => Promise<ApiResult<null>>
    startWatch: (projectPath: string) => Promise<ApiResult<null>>
    stopWatch: (projectPath: string) => Promise<ApiResult<null>>
  }
  panel: {
    listRegistered: (projectPath: string) => Promise<
      ApiResult<
        Array<{
          panelId: string
          label: string
          description: string
          dataSource: string
          tableName: string
          fields?: Record<string, unknown>
        }>
      >
    >
    getSchema: (
      projectPath: string,
      panelId: string,
    ) => Promise<
      ApiResult<{
        panelId: string
        label: string
        description: string
        dataSource: string
        tableName: string
        fields?: Record<string, unknown>
      }>
    >
    queryTable: (
      projectPath: string,
      panelId: string,
      page: number,
      pageSize: number,
    ) => Promise<ApiResult<{ rows: unknown[]; total: number; error?: string }>>
    savePanel: (
      projectPath: string,
      panel: {
        panelId: string
        label: string
        description?: string
        dataSource?: string
        tableName?: string
      },
    ) => Promise<ApiResult<unknown>>
  }
  docker: {
    export: (params: DockerExportParams) => Promise<ApiResult<DockerExportResult>>
    openFolder: (path: string) => Promise<ApiResult<null>>
    onProgress: (callback: (data: { phase: string; message: string }) => void) => () => void
  }
  ssh: {
    deploy: (params: SshDeployParams) => Promise<ApiResult<SshDeployResult>>
    testConnection: (
      params: SshTestConnectionParams,
    ) => Promise<ApiResult<{ connected: boolean; latency: number; fingerprint?: string }>>
    onLog: (callback: (data: { line: string }) => void) => () => void
  }
}

/** Docker 导出参数 */
export interface DockerExportParams {
  projectPath: string
  adapter: 'official'
  outputDir: string
  imageName?: string
  port?: number
}

/** Docker 导出结果 */
export interface DockerExportResult {
  success: boolean
  outputDir: string
  dockerfilePath: string
  buildCommand: string
  runCommand: string
  files: string[]
  error: string
}

/** SSH 部署参数 */
export interface SshDeployParams {
  projectPath: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  /**
   * 已固定的主机密钥指纹（TOFU）。
   * 留空 = 首次信任目标机并把指纹回报到部署日志里；填了 = 不一致就拒绝连接。
   */
  hostFingerprint?: string
  remotePath: string
  adapter: 'official'
  imageName?: string
  /** 容器对外端口（注意：与 host 端口同名，此处指容器端口） */
  containerPort?: number
  mode?: 'docker' | 'node'
}

/** SSH 部署结果 */
export interface SshDeployResult {
  success: boolean
  message: string
  logs: string[]
  error: string
  remoteId?: string
}

/** SSH 连接测试参数 */
export interface SshTestConnectionParams {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  /** 已固定的主机密钥指纹（留空 = 只探连接并回报指纹，不校验） */
  hostFingerprint?: string
}

declare global {
  interface Window {
    qqbat: QqbatApi
  }
}
