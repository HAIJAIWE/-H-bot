# 第 55 批交接：DSH 小件快搬（工具超时语义 / 时间上下文 / 文件观察门）

> 2026-10-26。依据 `docs/ai/dsh-source-adaptation-2026-10-24.md` 的 D1/D2 决策，
> 从上游快照 `E:\H Bot 制造\deepseek-harness-master\deepseek-harness-master`
> （@deepseek-ai/dsh-root 0.2.1-rc.3）继续搬**小件**：本批 3 项落地、3 项说明为什么暂不搬。
> 文档自包含：按 §3/§4/§5 的顺序实现即可，不需要回读上游源码。

## 0. 一页速览

| #   | 上游包                       | 行数 | 本批动作                                                    | 落点                                                                                                                                 |
| --- | ---------------------------- | ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `guard/timeout-policy`       | 81   | **适配**：保留硬停兜底，补 deadline signal + 结构化 timeout | `src/main/services/agent-core/toolTimeout.ts`、`scheduler.ts`、`core.ts`、`legacyTools.ts`                                           |
| 2   | `context/time-context`       | 377  | **适配**：每轮一次采样，注进 system 尾                      | `src/main/services/ai/timeContext.ts`、`runTurn.ts`、`ipc/aiAgentCore.ts`                                                            |
| 3   | `fs/fs-observation-policy`   | 159  | **适配**：覆盖既有文件前必须"这一轮读过"                    | `src/main/services/agent-core/fsObservation.ts`、`toolGate.ts`、`core.ts`、`runTurn.ts`、`ipc/aiAgentCore.ts`                        |
| -   | `mcp/mcp-resources`          | 217  | **不搬**                                                    | 角色反向：上游是 MCP **client** 的资源工具；本仓 `src/main/mcp` 是 MCP **server**（对外暴露工具），没有"消费别人的 MCP 资源"这条链路 |
| -   | `compaction/command-compact` | 108  | **不搬**                                                    | 本仓没有斜杠命令框架；且 `applyCompaction` 只在循环内用，没有"跨轮/手动压缩"入口，/compact 需要先造一个手动压缩 API，超出本批范围    |
| -   | `preset/persona`             | 75   | **不搬**                                                    | persona 要进 `AgentPreset` schema 与分享格式（第 53/54 批刚定稿），动它会连带改导入导出/撤销的兼容性；留到预设批次                   |

**不新增 IPC 通道** → 能力台账维持在 279，`capabilityLayering` / `ipcPayloadContract` 不应有新增登记；
新增文件都不写盘（只 `stat`/纯函数），`projectWritesViaFileOps` 的 counts 不变。

## 1. 前提与环境

- 仓：`E:\H Bot 制造`，主分支 `main`，本批基于 HEAD `0971ed0`（第 54 批提交），工作树干净。
- Node/Electron 由 Electron 运行时提供；测试用仓库自带 vitest（`node node_modules/vitest/vitest.mjs`）。
- 全量基线：**280 文件（278 passed | 2 skipped）/ 3525 例（3518 passed | 7 skipped）**。
- guards 基线：15 文件 / 107 例全绿（`node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2`）。
- 页面/真机：`Remove-Item Env:ELECTRON_RUN_AS_NODE; $env:QQBAT_CDP_PORT='1'; node node_modules/electron-vite/bin/electron-vite.js dev`，CDP 43191；探针脚本在 `_recovery/`（gitignore）。

## 2. 当前行为与缺口（本批为什么值得做）

### 2.1 工具超时

- `core.ts:98` 声明 `Tool.timeoutMs`，注释写着"不写就用调用方默认值"，但 **`CORE_TOOLS` 里 6 个内置工具一个都没声明**，调用方也没有默认值 —— 也就是说这个字段目前只在测试里的临时工具上生效。
- `scheduler.ts:78-80` 是唯一使用点：`tool.timeoutMs ? withTimeout(tool.run(...), tool.timeoutMs) : tool.run(...)`。`withTimeout`（`core.ts:622`）是 Promise.race：到点 reject `工具执行超时（Nms）`，但**工具拿不到任何信号**——它不知道该收手，如果一个工具正在读大目录/写大文件，它会在后台继续跑，占着文件句柄。
- 旧域工具（`ALL_TOOL_DEFINITIONS` → `adaptLegacyTools`）**没有任何超时**：一个卡住的应用侧指令（`dispatchInstruction` 自己有 15s 超时，但 `executeTool` 那一路没有）能把一整轮拖死。

### 2.2 时间上下文

- 循环的系统提示只由 `prompt.ts` 的三段（role/tools/rules）拼成；`ipc/aiAgentCore.ts` 另加 roleNote/historyNote。
- `agent-core/prompt.ts` 里没有任何"当前时间"命中。模型的"今天/现在/多久以前"全靠猜：历史条目 **有 `ts` 字段**（`historyStore.ts` 的 `HistoryEntry`），但只落盘、不进提示。
- 缺了它，用户问"现在几点""这个报错是刚才那次改的吗"时，模型要么答不知道，要么编。

### 2.3 文件观察门

- 循环的文件工具只有 `read_file` / `write_file`（`core.ts:231/:259`），`write_file` 是整文件覆盖，**不检查模型这一轮有没有读过目标文件**。
- 真机后果：模型在长任务里凭记忆"重写"一个只看到过一部分的文件，覆盖掉它没读到的后半段；或者用户在两次工具调用之间手动改了文件，模型用旧内容覆盖用户的新改动。两种都不可撤销（撤回只能回到轮次开始）。
- 本仓**没有 `edit_file` 工具**，所以策略落点只有一个：`write_file` 覆盖既有文件前，必须"这一轮读过它，且读完之后磁盘没再变过"。

## 3. 语义定案（实现时不要改）

### 3.1 工具超时（适配上游 timeout-policy）

上游语义：工具声明 `timeoutMs` → 执行时用 `deadline(exec.signal, timeoutMs)` 派生 signal 并**临时替换** `exec.signal`，调用结束若超时则把结果改写成 `Error: tool call timed out after Nms`（不竞速、不丢弃 promise，等工具在 signal 下静止）。

本仓适配（差异写进 §7）：**两件事都做** ——

1. **派生 deadline signal**：声明了 `timeoutMs` 时，工具的 `ctx.signal` 换成 `AbortSignal.any([父signal, AbortSignal.timeout(ms)])`，工具可以（也应该）在 signal abort 时收手；
2. **保留硬停兜底**：`withTimeout` 仍然在**同一个 ms** 到点 reject —— 本仓大量工具（含旧域工具、插件工具）根本不看 `signal`，只靠 signal 会让一次超时挂死整轮。硬停后工具 promise 在后台继续（无法回收，写进 §10 风险），但循环不再等它。

超时的**结果形状**（模型/界面/失败分类都靠它）：

- 文本：`[工具失败] 工具执行超时（Nms）`（`[工具失败] ` 前缀由调度器统一加，见 `scheduler.ts:91`）；
- 失败分类：`classifyToolFailure` 按"超时"命中 → `{ code: 'timeout', actions: ['retry'] }`；不需要在工具里返回显式 error。
- 工具自己抛的其它错误**原样保留**（不能因为顺手加了超时就把真实错误吞成 timeout）。

默认值（**只加在声明处，不在调度器里兜底**——隐式默认会让"忘了声明"继续隐形）：

| 工具                                  | timeoutMs | 理由                                                                              |
| ------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `read_file`                           | 30_000    | 单个工作区文件；再大也只是慢盘                                                    |
| `write_file`                          | 30_000    | 覆盖写                                                                            |
| `list_dir`                            | 15_000    | 单层目录                                                                          |
| `search_text`                         | 60_000    | 最多扫 4000 个文件（`MAX_SEARCH_FILES`）                                          |
| `validate_flow`                       | 30_000    | 读+解析                                                                           |
| `run_command`                         | 90_000    | 沙箱自身超时上限 60s（`sandbox.ts`），外层给 1.5 倍余量                           |
| 旧域 query 工具（`adaptLegacyTools`） | 120_000   | `executeTool` 无内部超时；`dispatchInstruction` 自己 15s 超时，外层 120s 不会误杀 |

外部取消的语义**不变**（`toolPipeline.dispatch` 的既有规则）：body 已经开始就等它结束再改判 cancelled；超时是**另一个**时钟，先到者说了算。

### 3.2 时间上下文（适配上游 time-context）

上游：`agent/pre-step` 钩子注入一条 source 归因的 user message，按 `refreshIntervalMs`（默认 10 分钟）节流，格式含 turn/step、浏览器时区、距上一条消息的耗时。

本仓适配：**一轮一次采样**，拼进 system 提示尾部（不是新 message，避免污染历史/工具配对）：

- 采样点：`runAgentTurn` 组装 system 时；`ipc/aiAgentCore.ts` 在**每轮循环开始前**算好 `timeNote` 传进来（多轮续跑时每轮都重算，符合"步边界"精神）。
- 输入：`now`（默认 `new Date()`）、`timeZone`（默认进程时区 `Intl.DateTimeFormat().resolvedOptions().timeZone`）、`previousMessageAt`（本轮 `past` 历史最后一条的 `ts`；第一轮无历史 = 第一条消息）。
- 格式（**逐字**）：
  ```
  时间：2026-10-26 07:52:31（Asia/Shanghai，周一）
  距上一条消息：约 8 分钟前
  ```
  - 无历史时第二行：`距上一条消息：这是本次对话的第一条消息`
  - `previousMessageAt` 非法时第二行：`距上一条消息：上一条消息没有时间记录`
  - elapsed 规则：<60s → `不到 1 分钟前`；<60min → `约 N 分钟前`；<24h → `约 N 小时 M 分钟前`（M=0 时省略）；≥24h → `约 N 天 M 小时前`（M=0 时省略；超过 30 天只给天数）。
  - `timeZone` 非法（Intl 抛 RangeError）→ 退回 `UTC`。
  - 星期用中文：周日/周一/…/周六。
- **不做**"每步刷新/按 interval 节流"：一轮最长几分钟，一次采样足够；每步注入会改变 `messages` 长度、干扰上游缓存与压缩判定（写进 §7 差异表）。

### 3.3 文件观察门（适配上游 fs-observation-policy）

上游：`ObservedStateGate` 用 `WeakMap<owner, Map<targetKey, FsObservation>>` 记录观察；write-intent 未观察→`createIfAbsent`、已观察→`replaceIfVersion(prior.version)`；edit-intent 未读→`FS_NOT_OBSERVED`、不存在→`FS_NOT_FOUND`、存在→版本 CAS。

本仓适配（**没有 edit_file，只有整文件覆盖**）：

- 门的作用域 = **一次运行**（`runAgentTurn` 的这次 loop），不是跨轮持久：`LoopOptions.fsObservation?: boolean` 开，`runAgentLoop` 内部 `new FsObservationGate()` 并挂到 `ToolContext.fsGate`。默认**关**（脚本/测试/`runAgentLoop` 裸调用行为不变）。
- 版本 = `{ mtimeMs, size }`（`stat`）。`read_file` 成功后 `noteRead(abs)`；`write_file` 写前 `assertWritable(abs)`、写后 `noteWrite(abs)`。
- 判定（**逐字文案**，抛出后由调度器加 `[工具失败] ` 前缀）：
  - 这一轮没观察过 + 文件**不存在** → 允许（新建文件）；
  - 这一轮没观察过 + 文件**存在** → 拒：`文件已存在，但这一轮还没读过它 —— 先用 read_file 读一遍，确认要改什么再覆盖。`
  - 观察过 + 文件**已不存在** → 允许（读过之后被删了，重建由模型内容决定）；
  - 观察过 + 磁盘 `{mtimeMs,size}` 与观察不同 → 拒：`文件在你读过之后又变了（磁盘上的版本和当时不一样）—— 先重新读一遍，再写。`
  - 观察过 + 磁盘未变 → 允许。
- `read_file` 分块读（offset/limit）也算"读过"——门只记版本，不管读了多少行；这条写进 §10 风险（模型仍可能用部分内容覆盖整文件，但至少它看过当前版本，且用户手改会被拦）。
- `onBeforeWrite`（轮次日志的 before 快照）只在**门通过之后**调用：被门拒绝的写没有改盘，记了反而会让撤回多删一个文件（与现有注释同一理由，`core.ts:277-278`）。

## 4. 数据形状

### 4.1 `src/main/services/agent-core/toolTimeout.ts`（新）

```ts
/** 给一次工具调用套上"deadline signal + 硬停兜底"；未声明 timeoutMs 时原样调用 */
export function runToolWithDeadline(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string | ToolRunOutcome>

/** 工具超时文案（唯一真源，测试断言与这里同源） */
export function toolTimeoutMessage(ms: number): string // `工具执行超时（Nms）`
```

实现骨架（**照抄语义，不照抄代码**）：

```ts
export async function runToolWithDeadline(tool, args, ctx) {
  const ms = tool.timeoutMs
  if (!ms || ms <= 0) return tool.run(args, ctx)
  const deadline = AbortSignal.timeout(ms)
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline
  try {
    return await withTimeout(tool.run(args, { ...ctx, signal }), ms)
  } catch (e) {
    // 超时优先：工具可能自己 abort 后抛 DOMException/自定义错
    if (deadline.aborted) throw new Error(toolTimeoutMessage(ms))
    throw e // 外部取消 / 工具真实错误：原样上抛
  }
}
```

注意：`AbortSignal.timeout` 自带 unref，不需要清计时器；父 signal 已 aborted 时 `AbortSignal.any` 立即 aborted（上游同样语义）。

### 4.2 `src/main/services/ai/timeContext.ts`（新）

```ts
export interface TimeContextInput {
  now?: Date
  timeZone?: string
  /** 上一条（模型可见的）消息时间，ISO 字符串；没有/非法都行 */
  previousMessageAt?: string | null
}
export function buildTimeContext(input?: TimeContextInput): string
```

纯函数，无 IO。内部拆两个可测函数：`formatClock(now, timeZone)`（→`2026-10-26 07:52:31`）、
`formatElapsed(ms)`（→`约 8 分钟前`），以及 `WEEKDAYS = ['周日','周一',…]`。

### 4.3 `ToolContext` 扩展（`toolGate.ts`）

```ts
/** 文件观察门（第 55 批）：不传 = 不检查（脚本/测试的默认） */
fsGate?: FsObservationGate
```

### 4.4 `LoopOptions` / `RunTurnInput` 扩展

```ts
// core.ts LoopOptions
/** 文件观察门：开了才在 write_file 覆盖既有文件前要求"本轮读过"（默认关） */
fsObservation?: boolean
// runTurn.ts RunTurnInput
/** 时间上下文块（由调用方算好；不传 = 不加）。见 ai/timeContext */
timeNote?: string
/** 文件观察门（生产传 true；默认关） */
fsObservation?: boolean
```

`runAgentLoop` 里：`ctx.fsGate = opts.fsObservation ? new FsObservationGate() : undefined`。
`runAgentTurn` 里：system 内容在 `historyNote` 之后追加 `input.timeNote`；`fsObservation` 原样传给 `runAgentLoop`。

### 4.5 `src/main/services/agent-core/fsObservation.ts`（新）

```ts
export interface FsObservation {
  mtimeMs: number
  size: number
}

export class FsObservationGate {
  /** 读成功后记录（stat 失败就跳过：读都成功了，别因为 stat 把正常读变失败） */
  async noteRead(absPath: string): Promise<void>
  /** 写前校验；不满足就 throw（文案见 §3.3） */
  async assertWritable(absPath: string): Promise<void>
  /** 写成功后记录新版本 */
  async noteWrite(absPath: string): Promise<void>
  /** 测试/诊断：当前记录的版本 */
  versionOf(absPath: string): FsObservation | undefined
}
```

`stateOf(abs)`：`stat` → `{mtimeMs,size}`；`ENOENT` → `null`；其它错误上抛（它决定写不写，不能静默放行）。

## 5. 文件级方案

### 5.1 `src/main/services/agent-core/toolTimeout.ts`（新增，~55 行）

按 §4.1。头注释写清"上游 guard/timeout-policy 的语义与本仓为什么两件事都做"。

### 5.2 `src/main/services/agent-core/scheduler.ts`（改 3 行）

`executeToolCall` 里把：

```ts
const raw = await (tool.timeoutMs
  ? withTimeout(tool.run(call.args, ctx), tool.timeoutMs)
  : tool.run(call.args, ctx))
```

换成：

```ts
const raw = await runToolWithDeadline(tool, call.args, ctx)
```

imports：从 `./toolTimeout` 引入 `runToolWithDeadline`；`withTimeout` 的实现已整体搬去 `toolTimeout.ts` 且 core 不再导出（scheduler 是原唯一使用方；删除导出可避免 deadExports 守卫误报"没人用"）。

### 5.3 `src/main/services/agent-core/core.ts`（改）

1. `CORE_TOOLS` 每个工具加 `timeoutMs`（值见 §3.1 表）。
2. `read_file.run`：`const raw = await readFile(abs, 'utf-8')` 之后加 `await ctx.fsGate?.noteRead(abs)`（**要 await**：见 §6.3；`noteRead` 内部自己吞 stat 错误，await 不会抛）。
3. `write_file.run`：`const abs = ...` 之后、`onBeforeWrite` 之前：`await ctx.fsGate?.assertWritable(abs)`；`writeFile` 之后：`await ctx.fsGate?.noteWrite(abs)`（同样是为了让"连续覆盖同一文件"的顺序确定）。
4. `LoopOptions` 加 `fsObservation?: boolean`；`runAgentLoop` 构造 `ctx` 时 `...(opts.fsObservation ? { fsGate: new FsObservationGate() } : {})`。
5. 头注释补一句：文件工具的超时与观察门是"第 55 批，语义对齐上游"。

### 5.4 `src/main/services/agent-core/toolGate.ts`（改）

`ToolContext` 加 `fsGate?: FsObservationGate`（type-only import，避免运行期环）。

### 5.5 `src/main/services/agent-core/legacyTools.ts`（改）

`adaptLegacyTool` 的返回对象加一行：

```ts
// 旧域工具没有内部超时；给执行路径一个上限（dispatchInstruction 自己还有 15s 超时）
timeoutMs: 120_000,
```

**只对 query 工具给**：mutation 工具在本仓只攒提案、立即返回，给超时没有意义且会让"攒提案"看起来可能失败。

### 5.6 `src/main/services/ai/timeContext.ts`（新增，~110 行）

按 §4.2。头注释写清上游 `context/time-context` 的对照与本仓"一轮一次"的适配理由。

### 5.7 `src/main/services/agent-core/runTurn.ts`（改）

1. `RunTurnInput` 加 `timeNote?: string` 与 `fsObservation?: boolean`（注释指向 §3.2/§3.3）。
2. system 内容追加：`(input.timeNote ? '\n\n' + input.timeNote : '')`，位置在 `historyNote` 之后（顺序：base prompt → planOnly → roleNote → historyNote → timeNote）。
3. `runAgentLoop({...})` 里加 `...(input.fsObservation ? { fsObservation: true } : {})`。

### 5.8 `src/main/ipc/aiAgentCore.ts`（改）

1. `loadHistory` 之后（`:332` 附近）：
   ```ts
   let lastMessageAt = past.length > 0 ? (past[past.length - 1].ts ?? null) : null
   ```
2. 每轮 `for (;;)` 内、`runAgentTurn` 之前：
   ```ts
   const timeNote = buildTimeContext({ previousMessageAt: lastMessageAt })
   ```
3. 把 `appendHistoryEntries` 的 ts 提出来复用（现在 :592 内联 `new Date().toISOString()`）：
   ```ts
   const turnTs = new Date().toISOString()
   ... ts: turnTs ...
   lastMessageAt = turnTs
   ```
4. `runAgentTurn` 参数加：`timeNote`、`fsObservation: true`。

### 5.9 测试计划

**新增 `tests/main/services/agent-core/toolTimeout.test.ts`（≈6 例）**

1. 声明 `timeoutMs: 20` 且挂起 → 结果含 `超时`、`failure.code === 'timeout'`、`phase = 'finished'`；工具收到的 `ctx.signal` 在结束时 `aborted === true`；
2. `timeoutMs: 50` 的工具 10ms 返回 → 正常结果、无 failure、`signal.aborted === false`；
3. 未声明 `timeoutMs` → 传给工具的 `ctx.signal` **就是**外部 signal（同一个对象/引用）；
4. 工具在超时前抛自己的错 → 原错误文案保留（不被改写成超时）；
5. 父 signal 已 aborted + 无 timeoutMs → 原样传递 aborted signal（取消语义不因本批改变）；
6. `toolTimeoutMessage(30)` 与调度器实际输出同源（断言 `[工具失败] ` + 它）。

**新增 `tests/main/services/agent-core/fsObservation.test.ts`（≈9 例）**

- 门单元（4）：`noteRead` 记录版本；未读+存在→抛"还没读过"；读过未变→放行；读过但 `mtimeMs/size` 变了→抛"又变了"；未读+不存在→放行。
- 循环集成（5，用假模型 + 真 fs 临时目录）：默认关时未读覆盖成功（回归）；开启后未读覆盖被拒且文件内容不变；`read_file` 后覆盖成功；read 之后外部改文件再写被拒；写新文件直接成功。

**新增 `tests/main/services/ai/timeContext.test.ts`（≈8 例）**

固定 `now` 与 `timeZone` 断言：格式 `时间：YYYY-MM-DD HH:mm:ss（Asia/Shanghai，周一）`；UTC 时区；周日；无历史文案；非法 `previousMessageAt`；elapsed 40s/8min/2h5m/1d3h；未来时间（负 elapsed）→ `不到 1 分钟前`。

**改 `tests/main/services/agent-core/runTurn.test.ts`（+1 例）**

假模型捕获 messages：`timeNote: '时间：…'` 出现在 system 内容里、且在 `historyNote` 之后；不传时不出现。

**改 `tests/main/services/agent-core/core.test.ts`（+1 例）**

`CORE_TOOLS` 6 个内置工具都声明了 `timeoutMs > 0`（防"字段又变成装饰"）。

**改 `tests/main/services/agent-core/legacyTools.test.ts`（+1 例）**

`adaptLegacyTool` 产出的 query 工具有 `timeoutMs = 120_000`，mutation 工具没有。

### 5.10 守卫 / 能力台账 / 文档

- 不新增 IPC 能力 → `docs/ai/ai-capability-layering-2026-10-08.md` **不改**，生成脚本不跑。
- `tests/guards/projectWritesViaFileOps.test.ts` 的 `src/main/services/agent-core/core.ts` 条目 counts **不变**（只加 `stat`，不是写/删/搬）。
- 新增三个文件都不在 `src/main/**` 写盘点范围里踩线（`fsObservation.ts` 只读 stat，`timeContext.ts` 纯函数，`toolTimeout.ts` 不碰 fs）。
- `docs/ai/agent-core-wiring.md` 追加 §55（结构照 §53/§54：55.1 为什么搬这三件、55.2 超时语义与默认值表、55.3 时间上下文格式、55.4 文件观察门判定表、55.5 接线点、55.6 测试与闸门、55.7 明确不搬的三件、55.8 涉及文件）。
- `docs/ai/dsh-source-adaptation-2026-10-24.md` §14 变更记录追加一行（第 55 批：三个小件语义适配）。

## 6. 关键实现细节

### 6.1 为什么超时默认值放在声明处而不是调度器兜底

`scheduler` 里写 `tool.timeoutMs ?? DEFAULT` 会让所有插件/旧域工具**静默继承**一个默认值——出问题时没人知道这个数字从哪来，也没法按工具调。声明处写死，配合 core.test 的"6 个内置工具都声明了"回归用例，才能保证"字段不是装饰"。

### 6.2 `AbortSignal.any` 与父 signal 的时序

`AbortSignal.any([parent, deadline])` 在 parent 已 aborted 时**立即** aborted，且 reason 取 parent 的 reason；`deadline.aborted` 单独存在，所以"是超时还是外部取消"永远分得清：

- `deadline.aborted === true` → 超时（即使工具抛的是 abort DOMException）；
- `deadline.aborted === false` 且外部 signal aborted → 取消，原错误上抛（调度器 → 取消语义）。

### 6.3 `noteRead` 要 await（实现时修正）

最初打算 `void` 丢出去（记录观察不该拖慢读），写集成测试时发现**真会错**：`read_file` 与 `write_file` 跨轮时，模型回调可能快到 `noteRead` 的 `stat` 还没落定，下一次写就被判成"还没读过"。这是模型"读完立刻改"的最常见路径，不能靠"生产里模型有延迟"赌。

`noteRead` / `noteWrite` 内部已保证不抛（stat 失败 = 删记录 = fail-closed），所以 await 的代价只是多一次 `stat` 的等待，收益是顺序确定。上游是同步写 WeakMap（没有 IO），没有这个竞态；本仓的版本号要靠 `stat`，只能 await。

### 6.4 时间上下文与"历史里已有 ts"

`past` 是本次 `ai:agentCore` 调用开始时读的（`loadHistory`），循环里每轮 append 的条目不会回写 `past`。所以 `lastMessageAt` 在循环里手动推进（§5.8 第 3 步）；否则第二轮续跑会重复说"这是第一条消息"。

### 6.5 门只在生产开

`runAgentTurn` 的默认是关，`ipc/aiAgentCore.ts` 显式传 `true`。理由：`runTurn` 还被脚本/评测/测试直接调用，默认开会改变它们的行为（尤其是"直接用 write_file 造夹具"的测试）；生产侧只有这一个入口，显式传就够了。

## 7. 与上游差异（要写进 §55 文档）

| 项           | 上游                                                        | 本仓                                               | 原因                                                          |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| 超时落点     | 只派生 deadline signal，等工具静止后改写结果                | deadline signal + 同毫秒硬停兜底                   | 本仓大量工具不读 signal；只等会让一次超时挂死整轮             |
| 超时文案     | `Error: tool call timed out after Nms`                      | `工具执行超时（Nms）`（带 `[工具失败] ` 前缀）     | 与既有失败前缀/分类同源（`classifyToolFailure` 按"超时"分类） |
| 时间注入     | pre-step 钩子，按 `refreshIntervalMs` 节流注入 user message | 每轮一次采样，拼进 system 尾                       | 不污染 messages 长度（压缩/缓存判定依赖它）                   |
| 时间格式     | `Time sampled while preparing turn …` 英文                  | 中文两行（时间/距上一条消息）                      | 本仓提示词与用户语言是中文                                    |
| 观察门 owner | session 级 WeakMap                                          | 一次运行一个 gate                                  | 本仓没有跨轮 session 对象；跨轮"读过"会过期，反而危险         |
| write-intent | `createIfAbsent` / `replaceIfVersion`                       | 同一判定，落在 `write_file`                        | 本仓无 edit_file                                              |
| fs 观察事件  | 提供方在 `fs/observed` 事件记录权威观察                     | 只有 read_file / write_file 两个记录点，且都 await | 没有第三个写盘入口；版本靠 `stat`，`void` 会有竞态（见 §6.3） |

## 8. 分阶段执行（建议 2 个提交，可拆 4 步）

### Phase A：文件观察门

1. 新增 `fsObservation.ts`；
2. `toolGate.ts` 加 `fsGate`；`core.ts` 接入 read/write + `LoopOptions.fsObservation`；
3. `runTurn.ts` 传递 + `ipc/aiAgentCore.ts` 传 `true`；
4. 新增 `fsObservation.test.ts` → `tsc node` + 定向 vitest。

### Phase B：工具超时

1. 新增 `toolTimeout.ts`；`scheduler.ts` 换用；
2. `core.ts` 6 个工具加 `timeoutMs`；`legacyTools.ts` query 默认 120s；
3. 新增 `toolTimeout.test.ts`；core/legacy 测试补声明断言 → `tsc node` + 定向 vitest。

### Phase C：时间上下文

1. 新增 `timeContext.ts`；
2. `runTurn.ts` 加 `timeNote`；`ipc/aiAgentCore.ts` 接线（含 `lastMessageAt`）；
3. 新增 `timeContext.test.ts`；runTurn 测试 +1 → `tsc node` + 定向 vitest。

### Phase D：文档 / 全量 / 真机 / 提交

1. `docs/ai/agent-core-wiring.md` §55、适配文档 §14 一行；
2. prettier 只格式化改动文件；
3. `tsc node` / `tsc web`；guards；全量 vitest；
4. 真机（§9.2）；提交。

提交信息建议：`feat(agent-core): DSH 小件快搬（工具超时语义、时间上下文、文件观察门）`

## 9. 闸门与真机

### 9.1 命令

```bash
# 类型
node node_modules/typescript/bin/tsc -p tsconfig.node.json
node node_modules/typescript/bin/tsc -p tsconfig.web.json
# 定向
node node_modules/vitest/vitest.mjs run tests/main/services/agent-core/toolTimeout.test.ts tests/main/services/agent-core/fsObservation.test.ts tests/main/services/ai/timeContext.test.ts tests/main/services/agent-core/runTurn.test.ts tests/main/services/agent-core/core.test.ts tests/main/services/agent-core/legacyTools.test.ts tests/main/services/agent-core/toolScheduling.test.ts --maxWorkers=2
# 守卫
node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2
# 全量（提交前一次）
node node_modules/vitest/vitest.mjs run --maxWorkers=2
```

预期：全量在 3525 例基础上 +≈25（新增 3 个文件 23 例 + 两处 +1）；`tsc web` 应保持 0（本批不碰渲染层）。

### 9.2 真机探针

1. 起 dev（命令见 §1），CDP 43191 连上 `http://localhost:5173/`；
2. **时间上下文**：在「还原验证项目」里问助手"现在几点？今天星期几？"，回答必须与本地时间/星期一致（截图）；
3. **文件观察门**：先手工在项目里放一个 `_probe55.txt`（内容 `old`），然后对助手说"不要读 `_probe55.txt`，直接把它整份覆盖成 new-content" —— 工具行应出现 `[工具失败] 文件已存在，但这一轮还没读过它…`，磁盘内容仍是 `old`（Node 读文件核对）；再说"读一下 `_probe55.txt` 再改成 new-content" —— 应成功，磁盘变 `new-content`；
4. 清理探针文件与临时改动；停 dev、放 43191；
5. 收尾确认 `git status` 只有本批改动。

### 9.3 不做的真机项（并在 §55 文档里说明）

- 工具超时：内置工具的正常耗时都远小于默认值，造一个"超时"的真实场景（大文件/慢盘）不可控；以定向单测（硬停 + signal + 分类）为准。
- 跨轮时间（多轮续跑）：单测覆盖 `lastMessageAt` 推进逻辑；真机只能看到模型答对时间。

## 10. 风险与坑

1. **硬停后工具仍在后台跑**：`withTimeout` 只能让循环不等它，不能收回文件句柄/子进程。写文件工具通常毫秒级完成；`run_command` 由沙箱自身 60s 超时兜底。这是"不照搬上游只等不杀"付出的代价，写进文档。
2. **超时误杀**：`search_text` 扫 4000 个文件在机械盘可能接近 60s；`read_file` 读超大文件可能 >30s。真机若遇到，按"声明值可调"处理（先改常量+测试，不引入运行时配置）。
3. **门对旧域工具不生效**：`adaptLegacyTools` 产出的 `write_code`/`write_file` 是提案制，不经过 `write_file.run`，不进门。它们的写盘发生在用户确认提案之后，属于另一条链路（本批不动）。
4. **`mtimeMs` 精度**：部分文件系统毫秒精度足够（两次写间隔远大于 1ms）；size 作为第二判据。读到"同 mtime 同 size 但内容变了"的理论场景不覆盖（需要 content hash，代价不值）。
5. **`noteRead` 的 stat 失败被吞**：读成功但 stat 失败的情形几乎只有权限抖动，这时门记不到观察，后续写会被"还没读过"拦下——**fail-closed**，符合安全方向。
6. **时间上下文影响提示词缓存**：system 每分钟变一次，轮与轮之间的前缀缓存可能失效。本仓目前没有显式前缀缓存策略，可接受；若将来加缓存，把 `timeNote` 挪到最后一条 user 消息（上游做法）即可。
7. **测试计时**：`toolTimeout.test.ts` 用 20–50ms 的真实计时器，CI 慢机器上 `timeoutMs: 50` 的工具 10ms 完成可接受；避免用 1ms 级取值。

## 11. 明确不做

- `mcp/mcp-resources`：角色反向（上游 client 侧资源工具 vs 本仓 MCP server），没有消费面；
- `compaction/command-compact`：没有斜杠命令框架，也没有跨轮/手动压缩入口；
- `preset/persona`：要改 `AgentPreset` schema 与分享格式，留到预设批次；
- 不做工具级运行时超时配置、不做 `edit_file`、不改 MCP server 的 capabilities、不动渲染层。

## 12. 验收清单

- [ ] 6 个内置工具都声明 `timeoutMs`，且 `toolTimeout.test.ts` 覆盖"硬停 / signal / 分类 / 不误吞错误"；
- [ ] 旧域 query 工具有 120s 上限，mutation 没有；
- [ ] `buildTimeContext` 输出逐字符合 §3.2，`runTurn` 把它拼在 system 尾；
- [ ] `aiAgentCore` 每轮算 `timeNote`，多轮续跑时 `lastMessageAt` 推进；
- [ ] 生产传给 `runAgentTurn` 的 `fsObservation: true`；未读覆盖被拒（文案逐字）、读后覆盖成功、读后外部改动被拒；
- [ ] tsc node/web 均 0；guards 107 例不变；全量 3525 + ≈25 全绿；
- [ ] 真机两项（时间问答、未读覆盖拒绝）有截图；CDP 43191 已放；
- [ ] §55 文档 + 适配文档 §14 一行；提交信息按 §8。

## 13. 参考坐标（HEAD 0971ed0）

- `src/main/services/agent-core/core.ts`（784 行）：Tool 接口 :73-105（`timeoutMs` :98）；CORE_TOOLS :229-425（read_file :231、write_file :259、run_command :290、validate_flow :314、list_dir :348、search_text :374）；LoopOptions :465-532；normalizeToolOutcome :560-616；withTimeout :622-636；runAgentLoop :651-768（ctx 构造 :659）。
- `src/main/services/agent-core/scheduler.ts`（196）：executeToolCall :66-101（唯一 timeoutMs 使用点 :78-80）。
- `src/main/services/agent-core/toolGate.ts`（101）：ToolContext :29-50。
- `src/main/services/agent-core/toolPipeline.ts`（305）：dispatch :247-255（取消语义；本批不动）。
- `src/main/services/agent-core/runTurn.ts`（262）：RunTurnInput :31-122；runAgentTurn :134；system 拼接 :206-218；LoopOptions 传递 :199-248。
- `src/main/services/agent-core/legacyTools.ts`（150）：adaptLegacyTool；withSignal :133-139。
- `src/main/services/ai/historyStore.ts`（399，@ts-nocheck）：HistoryEntry 含 ts；loadHistory :156。
- `src/main/ipc/aiAgentCore.ts`（964）：past/history :332-333；historyNote :344-349；roleNote :521；runAgentTurn 调用 :621-717；appendHistoryEntries :588-598。
- 测试坐标：`tests/main/services/agent-core/{core,toolScheduling,runTurn,legacyTools}.test.ts`；`tests/main/services/ai/`；`tests/guards/`。
- 上游坐标：`packages/guard/timeout-policy/src/index.ts`（81）、`packages/context/time-context/src/**`（377）、`packages/fs/fs-observation-policy/src/**`（159）。

## 14. 一句话

把"工具会超时、模型知道现在几点、覆盖文件前必须真的看过"这三件 DSH 里已经被验证过的小事搬过来，用本仓的硬停/中文提示/单次运行语义做适配 —— 不新增任何 IPC 能力，只让循环更不容易犯"看不见的错误"。
