# Agent 运行时边界：把 `createAgentRuntime` 从 Electron 主进程里抽出来

> 审计时间：2026-10-28 · 审计对象：`src/main/services/agent-core/**`、`src/main/ipc/aiAgentCore*.ts`、
> `src/main/ipc/ai.ts`、`src/preload/index.ts`、`src/main/services/ai/{toolApproval,threadTitles,instructionBridge,appAiConfig,parallelToolCallsSettings,threadTitleSettings}.ts`、
> `src/main/services/infra/{logger,paths,safeStorage}.ts`、`src/main/services/plugins/kernel.ts`。
> 结论以仓库现状为准；每一条都能按「文件:行号」核对。

## 结论摘要

1. **循环层已经是干净的**：`src/main/services/agent-core/**` 全目录 grep 不到任何 `from 'electron'`；`runTurn.ts`、`core.ts` 的入口参数已全部注入（见 §1.1）。真正要抽的东西不在循环里，而在装配层。
2. **Electron 耦合只有 6 类 API、集中在 4 个文件**：`src/main/ipc/aiAgentCore.ts`、`src/main/ipc/aiAgentCoreApproval.ts`、`src/main/ipc/aiAgentCoreOnboarding.ts`、`src/main/services/ai/instructionBridge.ts`，外加“运行时输入”三个读 userData 的模块。`shell` / `Notification` / `clipboard` 在 agent 链路里**零调用**（见 §1.3）。
3. **最难拆的是“工具面”，不是事件出口**：`emit` 是单点回调（`src/main/ipc/aiAgentCore.ts:276-278`），一次注入即可；但工具集是**每轮动态构造**的，其中 `legacyBridge` 会把工具执行**派发回渲染层**（`src/main/ipc/aiAgentCore.ts:482-498` → `src/main/services/ai/instructionBridge.ts:44-91,82`）。纯 Node 运行时无法替渲染层执行这些工具，所以工具集必须变成 `tools(ctx) => Tool[]` 的按轮 provider，而不是一个静态数组。
4. **建议第一刀**：把 `src/main/ipc/aiAgentCore.ts:240-961`（一轮运行的全部业务，不含 IPC 注册与参数解析）整段搬进新目录 `src/main/services/agent-runtime/`，用 `emit` / `approval` 两个回调注入，`win` 一步都不进新文件。这一刀**不改任何行为、不改任何测试断言**，`aiAgentCore-ipc.test.ts` 的 48 个用例就是验收标准。
5. **第二刀再切 Electron**（审批面板、userData 设置、标题生成、开荒分支、工具装配）；**第三刀固化边界**（electron-free 守卫测试 + `dispose()` 收终端）。

---

## 耦合清单

### 1.1 先划清：循环层没有 Electron 耦合

证据（全目录逐文件 grep，命令可复跑）：

```
Get-ChildItem src/main/services/agent-core -Recurse -Filter *.ts | Select-String -Pattern "electron"
→ 0 命中（只有 terminal.ts:40、terminalTools.ts:72,122 出现字符串 'powershell.exe'）
```

这不是巧合，是设计使然：

- `src/main/services/agent-core/contracts.ts:104-110` 已定义 `AgentServices{sandbox,approval,context,session,trace}`，五个服务全部注入；
- `contracts.ts:63-65` 的 `ApprovalService.request(req, signal?): Promise<boolean>` 就是审批通道的抽象，**并且已经允许抛错表达“带原因的拒绝”**（迁移时直接复用这个契约，不要另造 boolean 之外的形状）；
- `src/main/services/agent-core/runTurn.ts:31-160` 的 `RunTurnInput` 把 config / call / signal / tools / approval / trace / session / spill / inbox / onStep / onTextChunk / onToolEnd / compaction 全部做成入参；
- 默认值刻意做成**无副作用**：`approval` 默认拒绝（`runTurn.ts:175`）、`session` 默认 no-op（`runTurn.ts:183-184`）、`trace` 默认 no-op（`runTurn.ts:186`）；
- `modelAdapter.ts:68` 已经支持 `opts.call ?? callLlm`，模型传输可替换；`adapters.ts:27-110` 已给出五个服务的装配函数。

所以“抽出运行时”的实际工作量 ≈ **把 aiAgentCore 的装配逻辑搬家 + 把 6 类 API 换成回调**，不是重写循环。

### 1.2 装配层逐函数（核心表格）

| # | 文件:行号 | 调用点（现状） | 为什么耦合 | 目标去向（§2 字段） |
|---|---|---|---|---|
| 1 | `src/main/ipc/aiAgentCore.ts:19` | `import { ipcMain, BrowserWindow } from 'electron'` | handler 注册面本身必须留在 Electron | 留在 adapter，不进 runtime |
| 2 | `src/main/ipc/aiAgentCore.ts:124` | `registerAiAgentCoreIpc()` 注册 `ai:agentCoreRun`(:205)、`ai:agentCoreSteer`(:970) 等 | `ipcMain` 是 Electron API | `AgentRuntime.run()/steer()`，由 adapter 注册 |
| 3 | `src/main/ipc/aiAgentCore.ts:235` | `const win = BrowserWindow.fromWebContents(event.sender)` | 唯一窗口句柄来源，向下传给 emit/审批/指令桥/开荒 | `CreateAgentRuntimeInput.emit` + `approval` + `tools(ctx)`；runtime 零窗口 |
| 4 | `src/main/ipc/aiAgentCore.ts:276-278` | `const emit = (channel, payload) => win?.webContents.send(channel, payload)` | 整个主链路唯一事件出口 | `emit(event)` / `emit(channel, payload)` 入参 |
| 5 | `src/main/ipc/aiAgentCore.ts:246-247` | `projectPath.trim() === '' → runOnboardingTurn({win, requirement, images})` | “开荒还是正常跑”是 UI/产品决策，不在循环里 | adapter 决策：`projectPath===''` 时用同一 runtime + 开荒工具集 |
| 6 | `src/main/ipc/aiAgentCore.ts:280-284` | `resolveAuthorAiConfig(projectPath)`，无配置 `emit('ai:error')` | 读 `%APPDATA%` 下的配置 + `safeStorage` 解密 | `config.resolveLlm()` |
| 7 | `src/main/ipc/aiAgentCore.ts:482-498` | `legacyBridge{ dispatch: (ins) => dispatchInstruction(win, …) }`（dispatch 在 :491） | **工具执行派发到渲染层**，Node 侧无执行者 | `tools(ctx) => Tool[]` + `ctx.dispatchToClient`（仅 adapter 提供） |
| 8 | `src/main/ipc/aiAgentCore.ts:614-624` | `createApprovalGate({ projectPath, role, effectiveFullAccess, allowRules, approved, window: win, addRule })` | 审批面板是窗口弹窗 | `CreateAgentRuntimeInput.approval(req, signal?)` |
| 9 | `src/main/ipc/aiAgentCore.ts:666` | `maxParallelToolCalls: effectiveMaxParallelToolCalls()` | 每次运行读 `electron.app` 的 userData 设置 | `settings.maxParallelToolCalls()` provider |
| 10 | `src/main/ipc/aiAgentCore.ts:881` | `threadTitleAutoRefreshEnabled()` | 同上，userData 设置 | 标题生成整体移出 runtime（见 #11） |
| 11 | `src/main/ipc/aiAgentCore.ts:869-895` | `maybeGenerateThreadTitle` / `maybeRefreshThreadTitle`（fire-and-forget + `emitThreadTitle` :543-550） | 线程标题是**UI 产品功能**，headless 运行时不该有 | adapter 在 `run()` resolve 之后触发（顺序与今天一致：正文之后） |
| 12 | `src/main/ipc/aiAgentCore.ts:100-122` | `RUNNING: Map<projectPath, AbortController>`、`isAgentCoreRunning`、`cancelAgentCoreRun` | 进程级 Map + 跨 handler 共享 | runtime 实例状态：`cancel()` / `isRunning()`；adapter 按 projectPath 缓存实例 |
| 13 | `src/main/ipc/aiAgentCore.ts:109,256-266,970-987` | `STEER` Map + `loadInbox`/`saveInbox` + steer handler | 进程级 Map；steer 依赖运行实例活着 | `runtime.steer()` + runtime 内部 inbox（持久化仍是 `.qqbat/agent-inbox.json`，见 §1.3） |
| 14 | `src/main/ipc/aiAgentCoreApproval.ts:9,115,170-173,184` | `import type { BrowserWindow }`；`window: BrowserWindow \| null`；无窗口/已销毁 `throw '没有可用的审批通道…'`；`emit: (ch,p) => win?.webContents.send(ch,p)` | 依赖窗口存活判断 | 闸门逻辑留在 adapter；runtime 只调用注入的 `approval()`（抛错语义保留） |
| 15 | `src/main/ipc/aiAgentCoreOnboarding.ts:29-34,52-54` | `OnboardingTurnInput{win: BrowserWindow\|null,…}` + 第二份 `emit = win?.webContents.send` | 第二处窗口依赖 + 第二份事件出口 | 同一 runtime，`projectPath: ''`，工具集由 adapter 注入（`ONBOARDING_TOOLS`） |
| 16 | `src/main/services/ai/instructionBridge.ts:16,44-58,82` | `dispatchInstruction(win, req, opts)`；无窗口 `failed('没有可用的应用窗口来执行这条指令')`；`win.webContents.send('ai:clientInstruction', payload)` | 工具执行绕道渲染层 | adapter 内实现 `ctx.dispatchToClient`；runtime 不 import 本模块 |
| 17 | `src/main/services/ai/parallelToolCallsSettings.ts:17,39-42,48-55,111-113` | `import * as electron`；`userDataPathOrThrow('aiParallelToolCalls', electron.app)` | 每轮读 userData | `settings.maxParallelToolCalls()`（adapter 提供，内部仍走本模块；纯 Node 侧可传常量） |
| 18 | `src/main/services/ai/threadTitleSettings.ts:17,42,48-55,111-113` | `import * as electron`；`userDataPathOrThrow('aiThreadTitleRefresh', electron.app)` | 每轮末读 userData | 随 #11 一起移出 runtime |
| 19 | `src/main/services/ai/appAiConfig.ts:21,24,50,54,178` | `userDataPath('aiConfig')` + `safeStorage` + `resolveAuthorAiConfig` | 配置解密依赖 Electron `safeStorage` | `config.resolveLlm()`；本模块**保持只被 adapter 引用** |
| 20 | `src/main/services/infra/safeStorage.ts:2,5,12,20` | `import { safeStorage } from 'electron'` | 系统密钥库 | 不进 runtime |
| 21 | `src/main/ipc/ai.ts:6,139` | `import * as electron`；`registerAiIpc` 注册全部 `ai:*` handler | IPC 面 | 不动；`ai:cancelChat`(:891-911) / `ai:isRunning`(:919-930) 改为调 runtime 实例 |
| 22 | `src/main/ipc/ai.ts:716,718-719,940` | `BrowserWindow.fromWebContents` + `dialog.showSaveDialog`（导出线程）、`beginBatch` 取窗口 | 交互式 UI | 不进 runtime（导出/批处理本来就是 UI 事务） |
| 23 | `src/main/services/ai/index.ts:10,59-64,85-102` | `import { BrowserWindow }`；`BatchState.win` 字段（:62-63 注释“保留给将来”） | 类型引用 + 一个从不读的字段 | 直接从 `BatchState` 删掉 `win`（`beginBatch` 的 `win` 参数一并删），解掉一处无谓耦合 |
| 24 | `src/main/services/infra/logger.ts:29-30,41-49,52-61` | `require('electron')?.app`、`require('electron-log')`，都已 try/catch，纯 Node 返回 null（`getLogPath` 为空串） | 不是阻塞耦合，但 logger 的初始化属主进程 | runtime 只**使用** logger，不 init；init 留在 adapter（`src/main/index.ts` 侧） |
| 25 | `src/main/services/infra/paths.ts:108-121,137-148` | `resolveRoot()` 惰性 `require('electron')`，失败回退 `QQBAT_USER_DATA_DIR`(:119) | 已有纯 Node 逃生口，但靠环境变量 | 若 runtime 仍需 userData，显式注入 `paths.userDataDir`，禁止依赖 env |
| 26 | `src/main/mcp/server.ts:16,182,204,244,372,394` | `import * as electron`；`getAllWindows()[0]`；复用 `dispatchInstruction` / `requestApproval` | **第二处“想复用 AI 能力”的入口**，形态是复制而非复用 | 长期目标：MCP 侧改调 `createAgentRuntime`；短期不改 |

### 1.3 六类 API 的现场统计

- `webContents.send`（AI 链路只有 4 处）：`src/main/ipc/aiAgentCore.ts:277`、`src/main/ipc/aiAgentCoreApproval.ts:184`、`src/main/ipc/aiAgentCoreOnboarding.ts:53`、`src/main/services/ai/instructionBridge.ts:82`（其余 15+ 处在 metrics/terminal/runtime 等无关通道）。
- `BrowserWindow`：`aiAgentCore.ts:19,235`、`aiAgentCoreApproval.ts:9,115`、`aiAgentCoreOnboarding.ts:13,30`、`ai.ts:716,940`、`aiPresets.ts:16,29-30`、`mcp/server.ts:182,244,372`。
- `app.getPath`（AI 链路）：`parallelToolCallsSettings.ts:48-55`、`threadTitleSettings.ts:48-55`、经 `paths.ts:111-114` 的 `appAiConfig.ts:50,54`（另外 `logger.ts:43` 只取 app 判断日志目录）。其余 `crashReporter`/`diagnostics`/`templates` 与 AI 链路无关。
- `ipcMain`：`aiAgentCore.ts:19,124+`、`ai.ts:6,139+`，迁移后都由 adapter 持有。
- `dialog`：AI 链路上只有 `ai.ts:718-719`（导出线程选路径）；`aiPresets.ts:16` 引了但用不上运行时不关心。
- `shell`：AI 链路**零调用**；`services/pathGuard.ts:139,148,152` 只在注释里提 `shell.openPath`，实调用在 `ipc/dockerExport.ts:58`、`ipc/project.ts:146`、`main/window.ts:165`。
- `Notification`：只在 `services/crashLogger.ts:2,88-103`（崩溃通知），AI 链路零调用。
- `clipboard`：`src/main/**` 零命中。

**结论**：需要从运行时里拿掉的只有 `webContents.send` / `BrowserWindow` / `app.getPath` / `ipcMain` / `dialog`（仅导出功能，不在链路）五类；`shell` / `Notification` / `clipboard` 无需处理。

### 1.4 运行时直接 import 的项目内模块（是否需要注入的判据）

`src/main/ipc/aiAgentCore.ts:20-91` 一共 import 了四十余个模块。逐个核对过：**除了上表的 #17/#18/#19/#24/#25 之外，全部无 Electron 依赖**，可在纯 Node 下直接 import：

- 纯项目内文件读写（无 electron）：`services/ai/trace.ts`（`.qqbat/ai-trace.jsonl`，`trace.ts:58-60`）、`spillStore.ts`（`.qqbat/ai-spill`，`spillStore.ts:26,80`）、`inboxStore.ts`（`.qqbat/agent-inbox.json`，`inboxStore.ts:24-25,34,45`）、`historyStore.ts`、`threads.ts`（`.qqbat/ai-history`，`threads.ts:18`）、`flow/turnJournal.ts`（`.qqbat/history/turns`，`turnJournal.ts:168`）、`presets.ts`（`.qqbat/agent-presets.json`，`presets.ts:32,36`）、`presetLock.ts`、`presetUndo.ts`、`allowRules.ts`、`summaryLlm.ts`、`contextDigest.ts`、`promptHints.ts`、`timeContext.ts`、`proposalValidation.ts`、`verifier.ts`、`fileReference.ts`、`agent-core/todoStore.ts`、`plugins/host.ts`、`plugins/scoping.ts`、`agent-core/{legacyTools,toolCatalog,uiTrace,contextGate}`。
- 建议在 §2 里显式列一个**白名单**，并配 §3 批次 3 的守卫测试（任何新 import 出白名单即失败），这是把“纯 Node”变成可维护约束的唯一低成本的硬办法。

---

## 目标接口

### 2.1 签名草稿

放在新目录 `src/main/services/agent-runtime/`，`types.ts` + `createAgentRuntime.ts`：

```ts
// src/main/services/agent-runtime/types.ts
import type { LlmConfig } from '../ai/llm'
import type { Tool } from '../agent-core/core'
import type { PendingInbox } from '../ai/inboxStore'
import type { AgentServices } from '../agent-core/contracts'

/** 事件通道：与 preload 的监听面一一对应，见 src/preload/index.ts:552-774 */
export type AgentRuntimeChannel =
  | 'ai:chunk'
  | 'ai:compact'
  | 'ai:toolCall'
  | 'ai:agentStep'
  | 'ai:todo'
  | 'ai:response'
  | 'ai:threadTitle'
  | 'ai:agentState'
  | 'ai:stats'
  | 'ai:proposal'
  | 'ai:error'
  | 'ai:warning'

/** 事件回调：替代 win?.webContents.send，runtime 只描述“发生了什么” */
export type AgentRuntimeEmit = (channel: AgentRuntimeChannel, payload: unknown) => void

/**
 * 审批回传通道：与 contracts.ts:63-65 同形。
 * · true  = 放行
 * · false = 拒绝（调用方已在拒绝路径写好人话）
 * · throw = 带原因的拒绝/不可用（必须保留这个语义，四结局话术挂在异常上，见 §4）
 */
export type AgentRuntimeApproval = (
  req: { kind: 'write' | 'command' | 'irreversible' | 'tool'; summary: string; tool?: string; detail?: unknown },
  signal?: AbortSignal,
) => Promise<boolean>

/** 按轮构造工具集：工具面不是静态数组（legacy 工具要回跳渲染层执行） */
export interface AgentToolContext {
  workspace: string
  round: number
  signal: AbortSignal
  /** 本轮待提交操作（现 aiAgentCore.ts:561 每轮清空的那个数组） */
  pendingOperations: unknown[]
  /** 仅 Electron adapter 提供；纯 Node 下为 undefined → 依赖它的工具在装配期被剔除 */
  dispatchToClient?: (instruction: { name: string; args: Record<string, unknown> }) => Promise<unknown>
}

export interface CreateAgentRuntimeInput {
  /** '' = 开荒（语义与 prompt.ts:70-80、:95-104 的“空 workspace”一致） */
  projectPath: string
  threadId?: string

  /** ① 事件回调：原 aiAgentCore.ts:276-278 */
  emit: AgentRuntimeEmit

  /** ② 审批回传通道：原 createApprovalGate（aiAgentCoreApproval.ts:126） */
  approval: AgentRuntimeApproval

  /** ③ 模型配置：原 resolveAuthorAiConfig（aiAgentCore.ts:280） */
  config: {
    resolveLlm(): Promise<LlmConfig | null>
    resolveSummaryLlm?(): Promise<LlmConfig | null>
    /** 可替换传输；缺省走 llm.ts（modelAdapter.ts:68 已有该注入点） */
    callLlm?: unknown
  }

  /** ④ 每轮读取的运行时设置：原 effectiveMaxParallelToolCalls（aiAgentCore.ts:666） */
  settings: {
    maxParallelToolCalls(): number
    /** 仅 Electron adapter 需要；纯 Node 可恒为 false */
    threadTitleAutoRefresh?(): boolean
  }

  /** ⑤ 工具集：原 listTools + legacyBridge + 插件裁剪（aiAgentCore.ts:482-509） */
  tools: (ctx: AgentToolContext) => Tool[]
  /** 开荒专用工具集（原 ONBOARDING_TOOLS 过滤，aiAgentCoreOnboarding.ts:81-113） */
  onboardingTools?: Tool[]

  /** ⑥ 取消：runtime 内部持有 AbortController，外部 signal 可级联 */
  signal?: AbortSignal

  /** 复用已有注入面：sandbox/context/session/trace（contracts.ts:104-110） */
  services?: Partial<AgentServices>
  /** 可测时钟（timeNote 用，现 buildTimeContext 在 aiAgentCore.ts:569） */
  now?: () => number
}

export interface AgentRunInput {
  requirement: string
  images?: string[]
  maxRounds?: number
  planFirst?: boolean
  approvalMode?: 'ask' | 'never'
  activeFilePath?: string
  fullAccess?: boolean
}

export type AgentRunResult =
  | { ok: true; finalText: string; rounds: number; messageId?: string; toolResults: unknown[] }
  | { ok: false; error: string }

export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>
  steer(input: { text: string; target: 'step' | 'turn' }): Promise<boolean>
  isRunning(): boolean
  cancel(): void
  /** 收尾：终端会话 / 审批挂起 / 定时器。现进程级状态见 §4 */
  dispose(): Promise<void>
  /** 供 adapter 做持久化恢复（原 aiAgentCore.ts:256-266） */
  drainInbox(): Promise<PendingInbox>
}

export function createAgentRuntime(input: CreateAgentRuntimeInput): AgentRuntime
```

### 2.2 每个耦合点 → 目标字段对照

| 现状耦合点 | 目标字段 | 迁移时保持什么 |
|---|---|---|
| `aiAgentCore.ts:276-278` `emit=(ch,p)=>win?.webContents.send` | `input.emit` | 通道名与 payload 形状**逐字段不变**（preload 侧 `src/preload/index.ts:552-774` 不动） |
| `aiAgentCoreApproval.ts:126` `createApprovalGate({window})` | `input.approval` | 四结局话术仍在 adapter（`approvalDeniedText`，`aiAgentCoreApproval.ts:73-97`）；runtime 只透传异常 → `toolPipeline.ts:140-145` 转成 `[工具失败] <原因>` |
| `aiAgentCore.ts:280-284` `resolveAuthorAiConfig` | `config.resolveLlm` | 无配置时 runtime 返回 `{ok:false,error}`，adapter 照旧 `emit('ai:error')`（文案不变） |
| `aiAgentCore.ts:666` `effectiveMaxParallelToolCalls()` | `settings.maxParallelToolCalls` | **每轮调用一次**（不是构造时一次），保持“设置改了下轮生效” |
| `aiAgentCore.ts:881` `threadTitleAutoRefreshEnabled()` | `settings.threadTitleAutoRefresh` | 若保留在 runtime，必须每轮末调用；推荐随 #11 移出 |
| `aiAgentCore.ts:869-895` 标题生成 | 移出 runtime | 顺序不变：`ai:response` 之后、`ai:agentState idle` 之后；adapter 用 `run()` 返回值触发 |
| `aiAgentCore.ts:482-509` 工具合并/插件裁剪/白名单 | `input.tools(ctx)` | 白名单过滤（`:506-509`）仍在 adapter 的 provider 里做；runtime 不感知预设/插件 |
| `aiAgentCoreOnboarding.ts:52-54` 第二份 emit | 同一 `input.emit` | 事件形状与主链一致（`aiAgentCoreOnboarding.test.ts:139` 已断言） |
| `aiAgentCore.ts:235` win | 从 runtime 输入中**完全消失** | adapter 内 `win` 只出现在 emit/approval/dispatchToClient 三个闭包里 |
| `aiAgentCore.ts:100-122` RUNNING/STEER | runtime 实例状态 | adapter 建 `Map<projectPath, AgentRuntime>`；`ai:isRunning`(:919-930)/`ai:cancelChat`(:891-911) 改查实例 |
| `parallelToolCallsSettings.ts:48-55` / `threadTitleSettings.ts:48-55` | 由 adapter 提供 provider 函数 | 这两个模块继续 `import * as electron`，但**只被 adapter 引用** |
| `appAiConfig.ts:50,54` + `safeStorage.ts:2` | `config.resolveLlm` | 解密/回退逻辑一行不改，只是调用点从 runtime 挪到 adapter |
| `paths.ts:119` `QQBAT_USER_DATA_DIR` | 不注入则删除该依赖 | 若 runtime 需 userData，改显式 `paths.userDataDir`；纯 Node 测试用临时目录 |
| `runTurn.ts` / `core.ts` | **不改签名** | 二者是稳定层：`tests/` 里有 60+ 处直接构造 `RunTurnInput`/`LoopOptions`（见 §5），改签名纯属自伤 |

### 2.3 与 `plugins/kernel.ts` 的关系

`kernel.ts:17-25` 的 `PluginKernelContext{requireService,provideService,effect(dispose)}` 与 `:188-204` 的“逆序 effect 回收”正好是 AgentRuntime 需要的生命周期语义（审批挂起、终端会话、定时器）。建议 `dispose()` 内部就采用**注册式 effect**：runtime 创建一个内部 `effects: Array<() => void>`，`dispose()` 逆序执行（对齐 `kernel.ts:6-15` 的四条语义），而不是在 `finally` 里硬编码清理列表。

---

## 迁移顺序

> 三批都可独立提交、独立回滚；每批结束跑 `node scripts/typecheck.mjs` + 表中列出的 vitest 文件（不跑全量）。

### 批次 1：纯搬家（新目录 + 事件回调注入，行为零变化）

**涉及文件（写作用域）**
- 新增 `src/main/services/agent-runtime/types.ts`、`src/main/services/agent-runtime/agentRuntime.ts`
- 改 `src/main/ipc/aiAgentCore.ts`（瘦身：只留 `registerAiAgentCoreIpc`、schema 解析、`win` 获取、adapter 装配、`Map<projectPath, AgentRuntime>`）
- 不动 `src/main/services/agent-core/**`、不动 preload、不动测试

**具体动作**
1. `aiAgentCore.ts:240-961` 整段（一轮运行体：配置解析、历史、预设、工具装配、轮循环、收尾、catch/finally）搬进 `agentRuntime.run()`；逐行搬运，注释一并搬（`:761-768` 的收尾顺序注释是行为说明，不能丢）。
2. `RUNNING`/`STEER`（`:100-122`）改为 runtime 实例内部状态；`aiAgentCore.ts` 保留 `Map<projectPath, AgentRuntime>` 与两个薄壳 `getRuntime(projectPath)`。
3. 此时仍允许 runtime **直接 import** 那 25 个模块（§1.4 已确认它们无 electron），并把 `resolveAuthorAiConfig`/`effectiveMaxParallelToolCalls`/`threadTitleAutoRefreshEnabled`/标题生成先**原样**留在 runtime 内（由 adapter 通过 `config`/`settings` provider 传入，或本批先以 runtime 内 import 过渡——推荐前者，因为一步到位）。
4. `emit` 以闭包 `(channel,payload) => win?.webContents.send(channel,payload)` 注入；`approval` 直接传 `createApprovalGate({…, window: win, …})`（`aiAgentCoreApproval.ts:126` 不改）。

**风险**
- 700 行级搬迁最怕“抄漏一个字段”：`inbox` 恢复（`:256-266`）、`pendingOperations` 每轮清空（`:561`）、`traceTurnId`（`:553`）、`runRequirements`（`:538`）、`lastMessageAt` 更新（`:303`）这些散落状态最容易漏。建议搬运时用 `git diff -U0` 对照，逐段勾销。
- 事件顺序（`:776-853`：assistant 落盘 → endTurn → 提案 → 正文 → idle）是硬约束，搬迁后必须顺序不变。
- `finally` 里 `RUNNING.delete`/`STEER.delete`（`:958-961`）要变成实例状态复位；漏了会让“停止后永远 running”。

**可验收断言**（全部不改测试代码，只跑）
```
npx vitest run tests/main/ipc/aiAgentCore-ipc.test.ts \
  tests/main/ipc/aiAgentCoreApproval.test.ts \
  tests/main/ipc/aiAgentCoreOnboarding.test.ts \
  tests/main/ipc/ai-ipc.test.ts
```
- `aiAgentCore-ipc.test.ts` 48 个用例全绿（含审批/提案独发/预设 fail-closed/标题/贴图/compact/角色写域/messageId 一致）
- `aiAgentCoreOnboarding.test.ts:139` 的“事件形状 thinking→step→chunk→toolCall→response→idle”仍绿
- `ai-ipc.test.ts:203` 的取消三步（`cancelAgentCoreRun`+`cancelApprovalsFor`+`settleInstructionsFor`）仍绿

### 批次 2：切 Electron（审批面板 / userData 设置 / 标题 / 开荒 / 工具 provider）

**涉及文件**
- `src/main/ipc/aiAgentCore.ts`（adapter 化：emit/approval/config/settings/tools provider/标题触发）
- `src/main/ipc/aiAgentCoreApproval.ts`（`window` 参数改为最小接口 `{ webContents: { send(ch, p): void }; isDestroyed(): boolean }`，去掉 `import type { BrowserWindow }`）
- `src/main/ipc/aiAgentCoreOnboarding.ts`（删除第二份循环与第二份 emit，退化为“开荒装配 + 调 runtime”的薄壳；`runOnboardingTurn` 保留签名以兼容测试）
- `src/main/services/agent-runtime/**`（去掉 `threadTitles`、`threadTitleSettings`、`appAiConfig`、`parallelToolCallsSettings` 的 import，改走 provider）
- `src/main/services/ai/index.ts`（删 `BatchState.win` 与 `beginBatch` 的 `win` 参数；`ipc/ai.ts:942` 同步）

**具体动作**
1. 标题生成移回 adapter：`run()` resolve 之后照现在顺序调 `maybeGenerateThreadTitle`（首轮）/`maybeRefreshThreadTitle`（`threadTitleAutoRefreshEnabled()` 为真时），仍 fire-and-forget + `emitThreadTitle`（`:543-550` 的实现搬到 adapter）。
2. `resolveAuthorAiConfig` 移回 adapter，runtime 只拿到 `LlmConfig`；无配置 → `run()` 返回 `{ok:false}`，adapter `emit('ai:error')`。
3. `settings.maxParallelToolCalls` 由 adapter 提供（内部 `effectiveMaxParallelToolCalls()`，`parallelToolCallsSettings.ts:111-113`）。
4. 工具 provider：adapter 在 `(ctx) => mergedTools → scopeToolsByPlugins → 白名单` 里构造 `legacyBridge{projectPath, signal: ctx.signal, role, pendingOperations: ctx.pendingOperations, dispatch}`；`dispatch` 仍走 `dispatchInstruction(win, …)`（`instructionBridge.ts:44-91`）。**纯 Node 装配时不传 `dispatchToClient`，只保留 `CORE_TOOLS + TERMINAL_TOOLS + session search`**（它们全在进程内，见 §1.1）。
5. 审批闸门 `createApprovalGate` 留在 adapter，`requestApproval` 的 `emit` 仍 `win?.webContents.send`（`aiAgentCoreApproval.ts:184`）。

**风险**
- 标题触发点从 runtime 移到 adapter 后，**首轮判定**（`isFirstTurn`）与 `historyNote` 的来源要一并搬过去，否则首轮标题会失灵（`aiAgentCore-ipc.test.ts:877` 附近用例会抓到）。
- `aiAgentCoreOnboarding.test.ts:121` 断言“只给能力层三个工具、轮数上限 8、roleNote 是开荒强调句”——开荒工具集与 `roleNote` 的构造点必须留在可注入位置。
- 审批窗改最小接口后，`aiAgentCoreApproval.test.ts` 里的假窗口（`window: { webContents: { send } }`）要能被该接口接受；`isDestroyed` 判定的两处文案（`:170-173`）不能变。

**可验收断言**
- 与批次 1 相同的 4 个测试文件全绿（**断言零改动**）；
- 新增 `tests/main/services/agent-runtime/agentRuntime.test.ts`（node 环境，fake emit/approval/fake model）：断言默认拒绝、`ai:toolCall` 失败判定前缀、事件序列；
- `npx vitest run tests/main/services/ai/threadTitles.test.ts tests/main/services/ai/threadTitleSettings.test.ts tests/main/services/ai/parallelToolCallsSettings.test.ts`

### 批次 3：边界固化（守卫测试 + dispose + 终端生命周期）

**涉及文件**
- 新增 `tests/main/services/agent-runtime/electronFree.test.ts`、`tests/main/services/agent-runtime/agentRuntime.test.ts`
- `src/main/services/agent-runtime/agentRuntime.ts`（`dispose()` 逆序 effect）
- `src/main/services/agent-core/terminalTools.ts`（把 `killAllAgentTerminals`（:40-49，现在**无人调用**）接到 `dispose()`，或按 workspace 关会话）
- 可选：`src/main/runtime/cli.ts`（headless 入口，真正证明“纯 Node 可跑”）

**具体动作**
1. `electronFree.test.ts`：用 `node:fs` 读 `src/main/services/agent-runtime/**` 每个 `.ts`，断言不含 `from 'electron'` / `require('electron')`；并断言 import 白名单（§1.4）。这是**唯一**能防止边界慢慢烂掉的自动检查。
2. `dispose()`：`killAllAgentTerminals()` 语义按 workspace 收（模块级 `sessions` Map 在 `terminalTools.ts:24`，跨项目存活，见 §4）。
3. headless 冒烟：`createAgentRuntime({ projectPath, emit: console.log, approval: async () => false, config: {resolveLlm: async () => cfg}, tools: () => CORE_TOOLS, settings: {maxParallelToolCalls: () => 1} })` 在纯 Node 下跑一轮 fake model。

**风险**
- `terminalTools.ts:24` 的 `sessions` 是**模块级**状态：同进程内两个 runtime（Electron 主链 + MCP/headless）会共享终端会话，`workspace` 隔离（`:93-99`、`:159`、`:326`）能挡住大部分，但**关闭语义**会串（一个 runtime dispose 会杀另一个的终端）。批次 3 若引入 headless 入口，必须先把会话表改成实例级，或让 `killAllAgentTerminals` 接受 workspace 过滤。
- `electronFree.test.ts` 初期可能被 `import type { … } from 'electron'` 卡住：类型导入运行期被擦除，但**约束要严**——运行时目录里连 type-only 都不建议留（审批窗最小接口见批次 2）。

**可验收断言**
- `npx vitest run tests/main/services/agent-runtime/`（node 环境）
- `npx vitest run tests/main/services/agent-core/terminalTools.test.ts`（确保没改坏）
- `node scripts/typecheck.mjs`

---

## 不变量与风险

> 下列每一条都是迁移时必须保持的外部可观测行为；“覆盖”指现有测试是否已经在断言它。

| # | 不变量 | 依据（文件:行号） | 现有测试覆盖 | 缺口 / 迁移注意 |
|---|---|---|---|---|
| 1 | **审批四结局话术**：用户拒绝 / 超时（5 分钟）/ 被取消 / 没有可用审批通道，四句不同 | `src/main/ipc/aiAgentCoreApproval.ts:73-97`；提示词侧 `src/main/services/agent-core/prompt.ts:129-150` | `tests/main/ipc/aiAgentCoreApproval.test.ts:58,60,65,68,108`；`tests/main/services/agent-core/prompt.test.ts:101`；`runTurn.test.ts:71` | 真实 5 分钟超时值（`toolApproval.ts:63`）在测试里都是 mock 的 `timeoutMs`，没有真时钟用例 |
| 2 | **默认拒绝**：没有审批通道/审批抛错 → 工具不执行、返回 `[工具失败] …` | `runTurn.ts:175`；`toolPipeline.ts:134-139`（无 gate）、`:140-145`（gate 抛错） | `aiAgentCoreApproval.test.ts:60,68`（文案）；`toolPipeline.test.ts` 覆盖取消/拒绝文案但**未见**“无 gate”分支的直接断言 | 迁移时若把 `gate` 改成可空，务必保留 `askGate` 的两条失败文案 |
| 3 | **角色写域**：builder 写 `src/` 直接抛，不弹窗，点“允许”也不能绕过 | `aiAgentCoreApproval.ts:149-155`（throw 而非 false） | `aiAgentCoreApproval.test.ts:124,130` | 依赖“用异常表达拒绝”的协议，接口草案里 `approval` 必须允许 throw（§2.1 已注明） |
| 4 | **收尾顺序**：assistant 消息先落盘 → `endTurn` → 提案（有则只发提案）→ 正文 → idle → 标题 → 队列续跑 | `aiAgentCore.ts:761-768`（注释）、`:776-793`、`:801-805`、`:816-852`、`:853`、`:869-895`、`:900-903` | `aiAgentCore-ipc.test.ts`（提案独发、`messageId` 一致）；`aiAgentCoreOnboarding.test.ts:139,197`（事件序列） | **没有一条断言覆盖完整跨事件顺序**；建议批次 1 顺手加一条 emit 序列断言（新测试，不改旧断言） |
| 5 | **标题刷新去抖**：首轮生成；非首轮只在设置开启时刷新；两路不同时发 | `aiAgentCore.ts:869-895`；`threadTitles.ts:306`（生成）、`:350`（inflightKey）、`:380`（刷新）；`threadTitleSettings.ts:111-113` | `tests/main/services/ai/threadTitles.test.ts`；`aiAgentCore-ipc.test.ts:860`（开关关着不刷新）、`:877`（首轮只 generate 不 refresh） | 并发两次触发同一线程的去抖没有 ipc 级断言；标题移出 runtime 后这两条用例的 mock 面（`aiAgentCore-ipc.test.ts:64-105` 已 mock `threadTitles`/`threadTitleSettings`）必须保持不变 |
| 6 | **终端生命周期**：进程级 `sessions` Map、每 workspace 最多 4 个、跨项目按 workspace 隔离、会话跨轮次存活 | `terminalTools.ts:24`（Map）、`:21`（MAX 4）、`:93-99`、`:159`、`:326`；`terminal.ts:27-212`（`ShellSession`，`start` :37-47 且 :40 用 `'powershell.exe'`，RETAIN 1MB :33） | `terminalTools.test.ts:43,83,140` | `killAllAgentTerminals`（`:40-49`）**没有任何调用者**：进程退出兜底，runtime 重启不清理 → `dispose()` 必须补；同进程多 runtime 共享会话的风险见批次 3 |
| 7 | **trace 落盘**：`.qqbat/ai-trace.jsonl` 一行 JSON、超过 1MB 只留最近、写失败静默、`turnId` 串联一次运行 | `trace.ts:54-60,67-93`；`aiAgentCore.ts:627-631`（补 turnId）、`:553`（traceTurnId） | `tests/main/services/ai/trace.test.ts:75`（只测 `appendTrace` 的 turnId 筛选） | ipc 层“一次运行的所有行同 turnId”没有断言；开荒 `projectPath=''` 时 `trace.ts:59` 的 `join('', '.qqbat', …)` 会退化成**相对进程 cwd** 的路径 —— 迁移时必须保持 adapter 传真实路径或禁写（见 §4.1 第 2 条） |
| 8 | **并发工具数上限**：默认 10，设置可降到 1（全串行） | `core.ts:62`、`:667-670`；`scheduler.ts:165-196`（`executeToolBatch` 的 `maxParallel`）；`parallelToolCallsSettings.ts:111-113` | `toolScheduling.test.ts:99`（maxParallel=1）、`:163` 取消语义 | “每轮重新读设置”（现 `aiAgentCore.ts:666`）没有测试；改成构造期一次会静默改变行为 |
| 9 | **inbox / steer**：插话落盘 `.qqbat/agent-inbox.json`，step/turn 两档，立即 `saveInbox` | `inboxStore.ts:24-25,34,45`；`aiAgentCore.ts:256-266`（恢复）、`:716-729`（轮间消费）、`:910-922`（leftover 警告）、`:970-987`（steer） | **无行为测试**：全仓只有 schema 契约 `tests/guards/ipcPayloadContract.test.ts:83-84`；`inboxStore.ts` 没有单测 | 这是迁移中最容易“搬掉就没了”的一块：恢复→消费→续跑、step vs turn 两档、立即落盘都无断言；批次 1 必须补一条（见 §5.3） |
| 10 | **取消是真拦**：signal 传到底、审批挂起一起收、指令桥 settle、批处理收尾 | `aiAgentCore.ts:117-122`、`:698`；`ai.ts:891-911`；`toolPipeline.ts:249,253`；`toolApproval.ts:112,124-128` | `ai-ipc.test.ts:203`；`toolScheduling.test.ts:163,197`；`toolPipeline.test.ts:163,185,205` | 取消时**补合成结果防 tool_calls 悬空**（`toolPipeline.ts:287-303` 的 `skip`）覆盖较好；但“取消后标题/续跑不再触发”没有断言 |
| 11 | **开荒语义**：`projectPath=''` 表示没有项目；提示词、规则、`trace/session` 的路径都随之变化 | `prompt.ts:70-80,95-104`；`runTurn.ts` 的 `projectPath` 直传；`core.ts:759,762`（trace/session 用 workspace 当 projectPath） | `aiAgentCoreOnboarding.test.ts:110,121,139,225,235,247` | `''` 作为路径前缀写盘的行为**没有测试**；纯 Node 运行时跑开荒时要么注入真实 userData 路径，要么禁写 |
| 12 | **提案/正文互斥**：有提案只发 `ai:proposal`，不发 `ai:response` | `aiAgentCore.ts:816-852`（`proposalSent` 判断） | `aiAgentCore-ipc.test.ts`（提案独发）；`aiAgentCoreOnboarding.test.ts:197` | 迁移顺序风险低，但若把收尾拆到 adapter 两处（runtime 只管正文、adapter 管提案），互斥会破；**收尾必须整体留在 runtime** |

### 4.1 三个高风险点（按痛苦指数）

1. **工具面 → 渲染层回跳**（最难）：`legacyBridge.dispatch`（`aiAgentCore.ts:491`）把工具执行交给渲染层，`instructionBridge` 用 15 秒超时 + 迟到回执丢弃（`:21`、`:97-107`）。纯 Node 运行时**根本不存在**这个执行者。因此接口必须承认“工具集由宿主决定”：`tools(ctx)` 里 Electron 宿主给全量（含 legacy），headless 宿主只给进程内工具。任何试图把 `dispatchInstruction` 变成 runtime 内部实现的做法都会把 Electron 又拉回来。
2. **开荒 `projectPath=''` 的路径退化**：`trace.ts:59`、`spillStore.ts:26`、`turnJournal.ts:168` 都直接 `join(projectPath, …)`；`''` 时变成相对 cwd 的 `.qqbat/…`。现在之所以没炸，是因为开荒分支（`aiAgentCoreOnboarding.ts:81-113`）没有注入 `trace` / `session` / `spill`（对比主链路 `aiAgentCore.ts:627-638`），所以 `''` 从未真正落到这些 `join` 上。一旦 runtime 化后开荒统一走同一套 services，就会写出一个“当前工作目录下的 .qqbat”。**迁移前必须先决定**：开荒用一个显式的运行时 workdir，还是开荒禁写这些文件。
3. **模块级可变状态**：`terminalTools.ts:24` 的 `sessions`、`toolApproval.ts:60` 的 `PENDING`、`aiAgentCore.ts:100,109` 的 `RUNNING/STEER`。前两个已经是模块级（跨项目），第三个是装配层级的。抽成多实例后，“一个进程里两个 runtime”的语义（终端串、审批 callId 冲突、取消误伤）必须先写清楚，否则 headless + Electron 双跑会互相干扰。

### 4.2 其它注意

- `paths.ts:119` 的 `QQBAT_USER_DATA_DIR` 是现有唯一纯 Node 逃生口；`logger.ts:41-49` 也已 try/catch。两者说明“纯 Node 运行”并非全新领域，但**靠环境变量/隐式回退**不是接口，迁移时应收敛成显式注入。
- `mcp/server.ts:182,204,244,372` 已经在用 `getAllWindows()[0]` + `requestApproval` + `dispatchInstruction` 复制一套审批/指令链 —— 这是“第二个消费者”的现成证据，也是未来验证 `createAgentRuntime` 设计是否正确的试金石（如果 MCP 侧能零 Electron 调它，说明边界切对了）。
- 文档层面：`src/main/ipc/aiAgentCore.ts:6` 明确写“接口钉在 `docs/ai/agent-core-wiring.md`，改形状先改那份文档”。本次新增 `createAgentRuntime` 属于形状变更，实施时应同步更新 `agent-core-wiring.md` 的接口章节，避免两份文档打架。

---

## 测试影响

### 5.1 结论：目标接口是**新增**，所以 `agent-core` 的 60+ 处构造点不用改

`tests/main/services/agent-core/**` 里直接构造 `RunTurnInput`/`LoopOptions` 的用例很多，任何改 `runTurn.ts`/`core.ts` 签名的方案都会把它们全部拖下水：

- `runAgentTurn(`：`tests/main/services/agent-core/runTurn.test.ts`（15 处，:18,:38,:62,:74,:93,:118,:142,:167,:194,:220,:245,:275,:302,:324,:349）
- `runAgentLoop(`：`core.test.ts`（23 处）、`toolScheduling.test.ts`（7 处）、`loopCompaction.test.ts`（4 处）、`repeatGuard.test.ts`（2 处）、`stepEvents.test.ts`（2 处）、`toolFailureLoop.test.ts`（2 处）、`fsObservation.test.ts`（2 处）、`sandbox.test.ts`、`toolTimeout.test.ts`、`legacyToolAdapter.test.ts:71`

**这些文件在本次方案里一处都不用改**——`createAgentRuntime` 是包在 `runAgentTurn` 之上的装配层，签名兼容旧入口。这条本身就是批次 1 的验收条件（跑它们应全绿且零 diff）。

### 5.2 会因“实现搬走”而需要动的测试

| 测试文件 | 为什么受影响 | 最小改法 |
|---|---|---|
| `tests/main/ipc/aiAgentCore-ipc.test.ts`（958 行） | 它 mock 的是**旧路径**的模块：`vi.mock('electron')`（:52-62）、`runAgentTurn`/`requestApproval`/`threadTitles`/`threadTitleSettings`/`appAiConfig`/`legacyTools` 等（:64-105）。批次 1 把调用点搬进 runtime 后，若 mock 目标仍是这些模块路径且 runtime 也 import 同一路径，则 mock 继续生效（Vitest 按模块路径 mock，不看调用文件）→ **理想情况零改动**。 | 首选：保持旧模块路径不变（§2.1 里 runtime 仍 import 同路径的 `historyStore`/`inboxStore` 等），只把 `runAgentTurn` 的 mock 目标换成 runtime 内部的实际导入点。若批次 2 把标题/配置移出 runtime 到 adapter，mock 面**完全不用动**（因为改回 adapter 直接 import，与今天一致）。 |
| `tests/main/ipc/aiAgentCoreApproval.test.ts`（9 个 it） | 批次 2 把 `window: BrowserWindow` 改成最小接口 | 只改假窗口对象的类型断言（`window: { webContents: { send }, isDestroyed: () => false }`），**断言文案一字不改**（:58-130 覆盖四结局/越权/always） |
| `tests/main/ipc/aiAgentCoreOnboarding.test.ts`（8 个 it） | 批次 2 删除第二份循环 | 保留 `runOnboardingTurn` 导出签名；mock 面改指向同一个 runtime。`:121`（工具表/轮数/roleNote）、`:139`（事件形状）、`:225/:235/:247`（错误路径）断言不改 |
| `tests/main/ipc/ai-ipc.test.ts:203` | `ai:cancelChat` 从调 `cancelAgentCoreRun` 改为调 runtime 实例 | mock 目标替换为 `getRuntime(projectPath).cancel`；三步语义（`ai.ts:891-911`）断言不改 |
| `tests/main/services/ai/threadTitles.test.ts`、`threadTitleSettings.test.ts`、`parallelToolCallsSettings.test.ts` | 批次 2/3 后这些模块只由 adapter 调用 | **不改**（它们测的是模块自身）；只确保 adapter 仍调用它们 |
| `tests/main/services/ai/trace.test.ts`、`spillStore.test.ts` | 不变 | 不改 |

### 5.3 需要新增的测试（每批一条，都是“能指到文件:行号”的硬断言）

1. `tests/main/services/agent-runtime/agentRuntime.test.ts`（批次 2）——`// @vitest-environment node`（`vitest.config.ts:5-12` 全局是 `jsdom`，单文件覆盖即可，不要改全局配置）：
   - 默认拒绝：不传 `approval` 或 `approval: async () => false` → 工具不执行，`ai:toolCall` 状态为 error；
   - 事件序：`ai:agentState(thinking) → ai:agentStep → ai:chunk → ai:response → ai:agentState(idle)`；
   - `steer` 在未运行时返回 false、运行中命中 step/turn（**当前零行为测试**，属净新增）；
   - `inbox` 恢复/落盘：预置 `.qqbat/agent-inbox.json` 后 `drainInbox()` 能取回，leftover 触发 `ai:warning`（当前零行为测试）；
   - `config.resolveLlm` 返回 null → `{ok:false}` 且不调用模型。
2. `tests/main/services/agent-runtime/electronFree.test.ts`（批次 3）——读目录内容断言无 `electron` 字样 + import 白名单；这是对未来最划算的一条防线。
3. 批次 1 建议加一条 `aiAgentCore-ipc.test.ts` 的**补充**用例（只加不改）：断言一次成功的运行产生的事件序列满足 §4 第 4 条顺序（当前没有任何用例守这个）。

### 5.4 不跑的东西（按任务纪律）

- 不跑 `vitest` 全量（tests 下 258 个 `.ts`，`testTimeout` 30s，见 `vitest.config.ts`）；
- 不跑全仓 prettier；
- 只跑上述精确文件 + `node scripts/typecheck.mjs`。

---

## 附：落地检查清单（实施时逐条勾）

- [ ] `src/main/services/agent-runtime/**` 内 `grep -r "electron"` 为 0（批次 3 由测试守）
- [ ] `src/main/ipc/aiAgentCore.ts` 只剩 IPC 面 + adapter（目标 < 250 行）
- [ ] `src/main/ipc/aiAgentCoreOnboarding.ts` 不再有第二份 emit / 第二份循环
- [ ] `src/main/services/ai/index.ts` 的 `BatchState` 无 `win`
- [ ] `aiAgentCore-ipc.test.ts` / `aiAgentCoreApproval.test.ts` / `aiAgentCoreOnboarding.test.ts` / `ai-ipc.test.ts` 断言零改动全绿
- [ ] `dispose()` 会收终端会话（`terminalTools.ts:40-49` 不再是无调用者的死代码）
- [ ] `docs/ai/agent-core-wiring.md` 的接口章节同步更新
