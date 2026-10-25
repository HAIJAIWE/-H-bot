# 设计：把上游 `ToolExecutionPipeline` 搬进我们的循环（第 45 批）

> **这份文档是给"新会话"看的**：写的时候当前会话已经跑了两百多轮，上下文快满了。
> 文档自包含 —— 仓库位置、上游出处、现状代码形状、要改哪些文件、每一步跑什么命令、
> 怎样算做完。**不需要读旧会话**。
>
> 产出时间：2026-10-25；基于提交 `ce71987`（分支 `main`）。

---

## 0. 一页速览

| 项       | 内容                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 搬什么   | 上游 `packages/core/tools/src/pipeline.ts`（**772 行**）里的**执行语义**                                                                    |
| 搬到哪   | `src/main/vendor/dsh/tool-pipeline/pipeline.ts`（纯算法）+ `src/main/services/agent-core/toolPipeline.ts`（适配层）                         |
| 改谁     | `src/main/services/agent-core/scheduler.ts`（把内联的 pipeline 对象挪出去）、`core.ts`（`Tool` 加一个可选 `isConcurrencySafe`）             |
| 不动谁   | `vendor/dsh/tool-batch/batch.ts`（调度算法已搬好，**合同不变**）、消息顺序语义、repeatGuard / todo / spill / compaction                     |
| 预计     | 6 个阶段、6 次提交；代码量 vendor ~200 行 + 适配 ~230 行，测试 ~16 例                                                                       |
| 验收     | `tsc` 双 0；`guards` 全绿；全量 vitest ≥ 269 文件 / 3371 例；`vendor:audit` OK；真机 `ERRORS=0` + 一轮真实回合有过程行                      |
| 做完记账 | `docs/ai/agent-core-wiring.md` **§45**；`src/main/vendor/dsh/MANIFEST.json` +1 条；`README.md` 目录表 +1 行；`THIRD_PARTY_NOTICES.md` +1 行 |

---

## 1. 前提（新会话开场先确认这些）

- **真仓**：`E:\H Bot 制造`（分支 `main`，HEAD 应为 `ce71987` 或其后）。
  ⚠️ 运行时的 `cwd` 常常是 `D:\QQ bot`，那是**空目录**，不是仓库。所有 `tools.pwsh` 都要显式传 `workdir: 'E:/H Bot 制造'`。
- **上游快照就在仓库里**（不用联网、不在 app.asar 里）：
  `E:/H Bot 制造/deepseek-harness-master/deepseek-harness-master/`
  本次要读的文件：`packages/core/tools/src/pipeline.ts`（772 行）、同目录 `batch.ts`、`contracts.ts`、`json-schema.ts`。
- **许可**：上游 MIT（`Copyright (c) 2026 DeepSeek`）。规矩没变：**搬算法、写清改动、登记台账**，不要整段抄带 Cordis 的装配层。
- **基线**（开工前先跑一遍，确认自己没从别人的半成品上起步）：

```powershell
cd 'E:\H Bot 制造'
git status --short          # 应为空
git log --oneline -3        # 期望看到 ce71987（spill-local）
```

---

## 2. 为什么要搬（我们现在缺什么）

现在的调度已经搬过 `batch.ts`（独占屏障 / 有界滚动池 / 按模型顺序提交 / 取消补合成结果），
但**"一次调用的生命周期"只做了中间一段**。上游把这段拆成五步，我们只有两步：

| 上游阶段      | 上游做什么                                                                           | 我们现在                                                                | 后果（真机上能看见）                                                                       |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `start`       | 落 `tool/call` 事件、定 callId                                                       | 有：补 `call-<round>-<idx>` + `onToolStart`                             | —                                                                                          |
| **`prepare`** | 参数快照 → `tools/pre-execute` 钩子（参数检查/策略）→ 审批（allow/deny/ask）→ guards | **空实现** `async () => ({kind:'dispatch'})`                            | 审批只能靠每个工具自己在 `run` 里调 `ctx.gate`：漏写一个就是**静默放行**；插件也没地方插手 |
| `dispatch`    | 合并 caller/wrapper 两个 AbortSignal；`bodyInvoked` 记账；跑完若已取消则改判 ABORTED | 有：`executeToolCall`（`withTimeout` + `normalizeToolOutcome`，永不抛） | 中途取消时工具"跑完了就是成功"，取消只影响还没派发的调用                                   |
| `complete`    | 结果投影 → `tools/post-execute` 钩子（可以 block / 换 content / 换 value）           | 有落盘/落界面/回灌，**没有钩子**                                        | 结果过滤只能改工具内部；策略无法集中                                                       |
| `finish`      | 冻结果、发 `tools/result` 观测事件（listener 抛错只 warn）                           | trace 一行                                                              | 观测只有固定一条，扩展要改调度器                                                           |

还有两个零碎但实在的缺口：

1. `toolErrorMessage(error)` —— 上游有统一的"把任何抛出物变成一句话"；我们只写 `e instanceof Error ? e.message : String(e)`，
   `throw {message:'x'}`、`throw Symbol()`、`Object.create(null)` 都会变成 `[object Object]` / 抛二次错。
2. `failureMessageFromContent(content)` —— 拒绝回执统一措辞；我们每个拒绝点自己拼字符串。

---

## 3. 上游解剖（772 行，逐段）

> 读的时候记住：`extends Service` **0** 处、`static inject` **0** 处、`ctx.on` **0** 处 ——
> 这个文件**没有自己的生命周期**，只是被调度器 `new` 出来的执行器。dsh import 7 处全是**类型/工具函数**。

### 3.1 导出面

```ts
export class ToolExecutionPipeline                      // :62
export function toolErrorMessage(error: unknown): string // :648
export { executeToolBatch } from './batch.ts'           // :771（我们已经搬过）
```

构造：`constructor(private readonly ctx: Context, private readonly source: ToolExecutionSource = {})`，
`ToolExecutionSource = { get?(name, scope?, toolSet?); reject?(name, nested): Error | undefined }`
—— 就是"工具从哪查"和"这个工具是不是被策略整类禁了"，**两个函数**。

### 3.2 四个方法（调度器只调这些）

```ts
executionMode(exec): ToolExecutionMode                    // 同步，必须便宜
prepare(exec): Promise<ScheduledToolPreparation>          // {kind:'dispatch',exec} | {kind:'final-result',result}
dispatch(exec): Promise<ScheduledToolDispatch>
complete(exec, outcome): Promise<ToolExecutionResult>
```

- **`executionMode` 是 fail-closed 的**：只有 `tool.isConcurrencySafe` **存在**且**实测返回字面 `true`** 才 parallel；
  未知工具、没声明、抛异常 —— 一律 `exclusive`。我们现在的规则是"按 `category === 'query'` 推断"，
  **比上游激进**（分类写错就并发出事）。这一条值得照搬成"两种规则并存，显式声明优先"。
- **`prepare`** 的顺序很关键，且每一步的失败都有固定形状：
  1. `createExecution`：mint `token = Symbol('dsh.tool.execution')`（防伪造），
     `snapshotJsonValue(exec.arguments)` 之后 `deepFreeze`（工具改不了自己收到的参数）；
     快照失败 → `toolErrorResult`。
     被 `source.reject` 整类禁掉、且没被取消 → `{kind:'final-result'}`；
     **取消优先于拒绝**（已经取消了就别再问"允不允许"）。
  2. `ctx.waterfall(carrier, 'tools/pre-execute', exec, () => ({kind:'allow'}))` ——
     插件链可以返回 `allow` / `ask` / `deny`。
  3. `ask` 走 `serviceAsk`：`approval.request({agent,toolName,callId,reason?,displayReason?,signal})`，
     四种回答各有一条固定文案 —— `allowed-once` → allow；`rejected` → `the user rejected tool "X"`；
     `cancelled` → deny + `approvalCancelled`；`unavailable` → `no approval channel is available`。
     **没有 approval 服务 = deny**（不是 allow）：`requires approval (not yet supported)`；没有 agent = deny。
  4. `checkGuards` 只在 `allow` 分支上跑。
  5. 被拒 → 走 `post-result` 通道，结果是
     `{content:[{type:'text',text:'Error: '+reason}], isError:true, error:{message, info?}}`。
- **`dispatch`**：
  - `ctx.waterfall(…, 'tools/execute', mutableExec, () => this.dispatchToolBody(...))`
  - `fuseToolSignals(callerSignal, wrapperSignal)`：**不嵌套 `AbortSignal.any`**（会泄漏 listener），
    在 dispatch 作用域里挂 listener、settle 时 dispose。
  - `state.bodyInvoked = true` 之后才 `await tool.execute(args, exec)` —— 这个标志全文件只为一件事：
    **区分"没开始就取消"和"跑起来了才取消"**。
  - 成功结果要 `snapshotToolValue` → `validateJsonSchemaValue(tool.output.schema, …)` → `tool.output.render(args, value)`，
    全部再 snapshot + freeze。
  - **跑完之后**若 caller signal 已经 abort 且结果不是 error → 换成 `toolAbortedResult`（保留 `additionalContexts`）。
  - `finally` 把 `exec.signal` 复位成 wrapperSignal（不把内层的 signal 泄漏给下一个钩子）。
- **`complete`**：`final-result` 直接 finish；否则 `contentProjectors`（= `tool.projectContent`）→
  `tools/post-execute` 钩子 → `finish`。钩子有两个出口：
  - `block`：`content = decision.feedback`、`isError: true`，**只保留 block 自己给的 additionalContexts**；
  - `accept`：可以换 `content` **或** `value`，两个都给抛
    `TypeError('tools/post-execute accept decision cannot replace both value and content')`；
    给 `value` 但原结果 isError 抛
    `TypeError('tools/post-execute cannot replace the value of a failed result')`。
- **`finish`**：materialize（snapshot + freeze，失败 → toolErrorResult）→ `applyFinalContent` → 再 materialize →
  `notifyResult`：`Object.freeze(exec)` 后 `ctx.events.dispatch('emit', [carrier,'tools/result',exec,result])`，
  **每个 listener 的错误只 warn**（观测者不许弄坏主流程）。

### 3.3 取消语义（最值钱的一段）

```
已取消 & bodyInvoked === false → 'Error: tool call aborted before dispatch'
已取消 & bodyInvoked === true  → 'Error: tool call aborted'
```

`error.info = {name:'AbortError', code: TOOL_ABORTED | TOOL_ABORTED_BEFORE_DISPATCH}`，
并**保留 prior 结果里的 `additionalContexts`**。已开始的 body **绝不放弃** —— 先跑完、再改判。

### 3.4 工具函数（都能单独搬）

| 函数                                      | 行为                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `toolErrorMessage(error)`                 | `Error` → `.message`；有 string `message` 的对象 → 它；其它 `String()`；再兜底 `'<unprintable thrown value>'` |
| `failureMessageFromContent(content)`      | text 块取 text，非 text 写 `[<type> content]`，换行连接；空 → `'tool result blocked by post-execute policy'`  |
| `snapshotJsonValue` / `snapshotToolValue` | 深拷贝成 JSON 值；失败抛                                                                                      |
| `errorInfo(error)`                        | `error instanceof HarnessError → {name, code}`（我们换成"有 name/code 字段就用"）                             |
| `isAborted` / `fuseToolSignals`           | 见上                                                                                                          |
| `assertNever` / `deepFreeze`              | dsh-util-values 的，自己写 10 行                                                                              |

### 3.5 内部状态：全是 WeakMap/WeakSet

`deferredContexts` / `concludingExecutions` / `cancellationStates` / `contentFinalizers` /
`contentProjectors` / `canonicalResults` —— **没有字段挂在 exec 上**（exec 最后会被 freeze）。
我们照这个做：状态用 `WeakMap<Exec, …>`，不要往 `PlannedExec` 上加可变字段。

### 3.6 不能搬的（列清楚，别在里面耗时间）

| 上游                                                                                              | 为什么                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `type Context`（cordis）、`ctx.tools` / `ctx.get` / `ctx.waterfall` / `ctx.events` / `ctx.logger` | 我们的"内核"是 `plugins/kernel.ts`，没有 waterfall 事件总线。**用本地 hooks 数组复刻语义**，不引入 cordis。      |
| `scopeTarget` / `ScopeKey`（dsh-scope）                                                           | 我们没有 scope 概念；工具表按项目/预设过滤，在 `runTurn` 与 `scopeToolsByPlugins` 里做完。                       |
| `ContentBlock` / `UserMessage`（dsh-llm/dsh-session）                                             | 我们的工具回执是 `string`（`ToolRunOutcome.text`），会话是 `ChatTurn`。**保持 string**，不要为了搬去改消息模型。 |
| `HarnessError`                                                                                    | 我们没有这个错误基类，用鸭子类型读 `name`/`code`。                                                               |
| `validateJsonSchemaValue`（json-schema.ts 610 行）                                                | 我们 `Tool` 没有 `output.schema`，没有消费方。**本批不做**（见 §9）。                                            |

---

## 4. 目标形状

三层，**`BatchPipeline` 合同一个字都不改**（`batch.ts` 已搬好，继续用）：

```
core.runAgentLoop
  └─ scheduler.runToolGroup(calls, from, round, deps)
       ├─ 组装 execs（PlannedExec）+ 保持 complete/skip 的落盘/落界面语义（宿主职责，不动）
       └─ toolPipeline.createToolPipeline({...deps, hooks})
            ├─ executionMode(exec)  → 显式声明优先 + fail-closed
            ├─ prepare(exec)        → 未知工具/钩子 deny 都变成 settled slot
            ├─ dispatch(exec)       → 取消语义 + toolErrorMessage + 永不抛
            └─ complete(exec, slot) → 宿主落地（由 scheduler 给，pipeline 只转交 + 插 afterExecute）
       → executeToolBatch({execs, signal, maxParallel}, pipeline)   // vendor，已搬
```

**关键取舍**（动手前先认可，否则会返工）：

1. **审批不上移**。上游把审批放在 `prepare`；我们现在的审批散在每个工具的 `run` 里（`ctx.gate`），
   搬上来等于同时改"所有工具 + 审批 UI + 记忆规则"。本批只**预留** `beforeExecute` 钩子，
   审批仍在工具内；迁移写进 §45 的"下一步"，不进本批。
2. **钩子面只做宿主自己用的**：一条 `beforeExecute`、一条 `afterExecute`，顺序执行、可短路。
   不做插件注册表（插件要挂钩子，等真有人需要再接 `plugins/kernel`）。
3. **回执保持 `[工具失败]` 前缀**。上游是 `'Error: tool call aborted'`，我们沿用
   `'[工具失败] Error: tool call aborted before dispatch'`（`scheduler` 的 `ABORTED_TEXT` 已在生产用它，
   渲染层 `output.startsWith('[工具失败]')` 判 error，改了会连锁）。
4. **`ContentBlock` 换成 string**：`failureMessageFromContent` 的签名收窄成
   `failureMessageFromText(text: string): string`（空 → `'tool result blocked by post-execute policy'`）。
   保留上游那条 610 行的 JSON Schema 校验器 **不做**。

---

## 5. 文件级方案

### 5.1 新建 `src/main/vendor/dsh/tool-pipeline/pipeline.ts`（约 200 行）

纯函数 + 常量，**不 import 任何 `src/main/services/**`**。头注释照既有格式
（第一行仓库相对路径 / `@license MIT` / `@copyright Copyright (c) 2026 DeepSeek` /
`@upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3` / `@upstream packages/core/tools/src/pipeline.ts` /
URL / `// 本仓库改动（2026-10-26）：` + 编号条目）。**头注释 ≤ 20 行**（styleContract 闸门）。

导出（名字尽量与上游一致，便于以后对账）：

```ts
export type ToolExecutionMode = 'parallel' | 'exclusive'

/** 上游 executionMode 的核心：只有字面 true 才并行，其余（含抛错）一律独占 */
export function failClosedMode(
  isConcurrencySafe: ((args: unknown) => boolean) | undefined,
  args: unknown,
): ToolExecutionMode

export const TOOL_ABORTED_TEXT = 'Error: tool call aborted'
export const TOOL_ABORTED_BEFORE_DISPATCH_TEXT = 'Error: tool call aborted before dispatch'
/** bodyInvoked 决定给哪一句（上游 cancellationResult） */
export function cancellationText(bodyInvoked: boolean): string

/** 上游 :648，语义一字不改 */
export function toolErrorMessage(error: unknown): string

/** 上游 failureMessageFromContent 的 string 版 */
export function failureMessageFromText(text: string): string

/** 上游 fuseToolSignals：不嵌套 AbortSignal.any，返回 dispose */
export function fuseToolSignals(caller: AbortSignal | undefined, wrapper: AbortSignal): () => void

export function isAborted(signal: AbortSignal | undefined): boolean

/** 复刻 ctx.waterfall 的语义：hooks 顺序执行，每个都能调 next 或短路 */
export type Waterfall<T, R> = (value: T, next: () => Promise<R>) => Promise<R>
export function composeWaterfall<T, R>(
  hooks: readonly Waterfall<T, R>[],
  terminal: () => Promise<R>,
): () => Promise<R>
```

`composeWaterfall` 的实现只有一个技巧：**从右往左折叠**，每个 hook 的 `next` 是后一个的组合
（否则短路语义写不对）。写完配一条"第二个 hook 不调 next → 第三个不执行"的测试。

### 5.2 新建 `src/main/services/agent-core/toolPipeline.ts`（约 230 行）

适配层：把我们的 `Tool` / `ToolContext` / `ToolGroupDeps` 翻成 `BatchPipeline<PlannedExec, ToolSlot>`。

```ts
export interface PreExecuteInput {
  callId: string
  name: string
  args: Record<string, unknown>
}
export type PreExecuteDecision =
  { kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string } // 预留：审批（本批不产生）

export interface PostExecuteInput {
  name: string
  output: string
  ok: boolean
}
export type PostExecuteDecision =
  { kind: 'accept'; content?: string } | { kind: 'block'; feedback: string }

export interface ToolPipelineHooks {
  beforeExecute?: readonly Waterfall<PreExecuteInput, PreExecuteDecision>[]
  afterExecute?: readonly Waterfall<PostExecuteInput, PostExecuteDecision>[]
}
```

要点：

- `executionMode(exec)`：`tool.isConcurrencySafe` 存在 → `failClosedMode(...)`；
  否则退回现有规则（`executionMode` 显式值 → `category === 'query'` → 否则 exclusive），
  **并保留 `executionModeOf` 的导出**（它有测试与别的引用）。
- `prepare(exec)`：
  1. 找不到工具 → `{kind:'settled', slot: deniedSlot('未知工具: ' + name)}`（**不要 throw**：
     模型拼错工具名应该是"一条失败结果"，不是整轮崩）。
  2. `beforeExecute` 链 → `deny` → `deniedSlot(reason)`；`allow` / 无钩子 → `{kind:'dispatch'}`。
  3. **参数快照**：`snapshotArgs(exec.call.args)`（`structuredClone` + 失败落回原值），
     存进 WeakMap（拒绝回执与 trace 要用）；**不 freeze**（见 §9 风险）。
- `dispatch(exec)`：把 §5.3 的取消语义包在 `executeToolCall` 外面（`executeToolCall` 本身不动）。
- `complete(exec, slot)`：**继续由 scheduler 提供**（落 `results`/trace/session/`onToolResult`/回灌 messages）。
  pipeline 只在中间插 `afterExecute`：`block` → 换 `slot.output = '[工具失败] ' + feedback`、`ok=false`；
  `accept` 给了 `content` → 换输出。**顺序敏感**：钩子在 `onToolResult` 之前还是之后，
  必须在测试里钉死一条（建议**之前**：界面显示的就是最终喂给模型的那句话）。
- `start` / `skip`：**原样从 scheduler 搬过来**（它们已经是上游语义：补 callId、取消补合成结果、
  不报 `onToolStart`/`onToolResult`、不进 trace）。

### 5.3 取消语义（本批唯一的行为变化，要单独写测试）

```
dispatch 前已 abort                          → '[工具失败] ' + TOOL_ABORTED_BEFORE_DISPATCH_TEXT
dispatch 跑完了、结果 ok、但 caller 已 abort  → '[工具失败] ' + TOOL_ABORTED_TEXT   ← 新增
dispatch 跑完了、结果本来就是失败            → 保留工具自己的失败文案（不覆盖）
```

⚠️ 现在 `skip` 用的就是"before dispatch"那一句；改完要拆成两个常量，
但 **`skip` 的文案不许变**（有测试与历史日志对账）。

### 5.4 修改 `src/main/services/agent-core/scheduler.ts`（209 → 约 110 行）

- 删掉内联的 `pipeline` 对象，改成：

```ts
const pipeline = createToolPipeline({
  tools: deps.tools,
  ctx: deps.ctx,
  complete: async (exec, slot) => commitSlot(exec, slot, deps), // 原来 complete 的体
  hooks: deps.hooks,
})
return executeToolBatch({ execs, signal: deps.ctx.signal, maxParallel: deps.maxParallel }, pipeline)
```

- `ToolGroupDeps` 加 `hooks?: ToolPipelineHooks`（不传 = 无钩子，行为与今天一致）。
- `executionModeOf` 与 `executeToolCall` **留在 scheduler，不迁**（改动面小）；
  但 `executeToolCall` 的 catch 分支要改用 vendor 的 `toolErrorMessage(e)`。

### 5.5 修改 `src/main/services/agent-core/core.ts`（793 行，只剩 7 行余量）

- `Tool` 加一个可选字段（**写清 docblock**）：

```ts
/**
 * 这次调用的实参能不能和同批其它调用并跑（上游 isConcurrencySafe）。
 * 不声明 = 按 category 推断；声明了必须**返回字面 true** 才并行（fail-closed）。
 */
isConcurrencySafe?: (args: Record<string, unknown>) => boolean
```

- ⚠️ `core.ts` 已经 793 行，**fileGrowth 闸门要 ≤799**。加这段 docblock 前先量行数，
  超了就把 `executeToolCall` 的 docblock 压两行（历史上这么干过两次），别去动主循环。

### 5.6 测试

| 文件                                                        | 例数 | 断什么                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/main/vendor/tool-pipeline.test.ts`（新）             | 9    | ① `failClosedMode` 只认字面 true（`1` / `'true'` / 抛错 → exclusive）；② `toolErrorMessage`：Error / `{message}` / 数字 / null / `Object.create(null)`；③ `failureMessageFromText` 空与非空；④ `composeWaterfall` 顺序 + 短路；⑤ `fuseToolSignals` 任一 abort 生效、dispose 后不再传播；⑥ `cancellationText` 两态；⑦ 常量文案逐字                                    |
| `tests/main/services/agent-core/toolPipeline.test.ts`（新） | 7    | ① 未知工具 → settled 且模型拿到 `[工具失败] 未知工具: x`；② `beforeExecute` deny → settled + 文案，且**不调** `tool.run`；③ deny 时 `onToolResult` 收到 ok:false（界面看得见）；④ dispatch 前 abort → before-dispatch 文案；⑤ 跑完才 abort 且 ok → 改判 ABORTED；⑥ 跑完才 abort 但本来失败 → **不改写**；⑦ `afterExecute` block → 喂模型的是 `[工具失败] <feedback>` |
| `tests/main/services/agent-core/scheduler.test.ts`（改）    | +2   | 现有用例全绿；新增"没有 hooks 时行为与旧版一致"与"skip 文案仍是 before-dispatch"                                                                                                                                                                                                                                                                                     |

---

## 6. 分阶段实施（每阶段一个提交，绿了再往下）

> 铁律：**任何阶段红灯都不许进下一阶段**。历史上靠"先跑起来再补测试"翻过两次车（工具表两处断裂）。

| 阶段                     | 内容                                                                                                            | 跑什么                                                                        | 提交信息（建议）                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **0 基线**               | 只读 + 跑一遍闸门，记录数字                                                                                     | `tsc`×2、`guards`、全量 vitest                                                | 不提交                                                                                   |
| **1 vendor 纯函数**      | 新建 `vendor/dsh/tool-pipeline/pipeline.ts` + 9 例测试                                                          | 定向 `tests/main/vendor`                                                      | `feat(ai): 搬 DSH 的 tool-pipeline 纯函数（fail-closed 并行判定 / 取消文案 / 错误归一）` |
| **2 适配层（不改接线）** | 新建 `toolPipeline.ts`（prepare/dispatch 钩子面 + 取消语义），`scheduler` 暂不调用 + 7 例测试                   | 定向 `tests/main/services/agent-core`                                         | `feat(ai): 工具执行拆出 prepare/dispatch 两段，留出前后钩子`                             |
| **3 接线**               | `scheduler.runToolGroup` 切到新 pipeline；`Tool` 加 `isConcurrencySafe`；`ToolGroupDeps` 加 `hooks`             | 定向 + `tests/guards`                                                         | `refactor(ai): 调度器改用 toolPipeline（行为不变，取消语义补全）`                        |
| **4 台账与文档**         | MANIFEST +1、README +1 行、NOTICES +1 行、`docs/ai/agent-core-wiring.md` §45、`dsh-source-adaptation` §14 +1 行 | `node scripts/vendor-audit.mjs --update` → 再 `node scripts/vendor-audit.mjs` | `docs(ai): tool-pipeline 搬运台账（§45）`                                                |
| **5 全量 + 真机**        | 全量 vitest、起 dev、探针、截图                                                                                 | 见 §8                                                                         | 可 amend 进阶段 3                                                                        |

阶段 3 完成时**行为应该完全等价**（除了"跑完才取消"那条新语义）。等价性最好的证据：
全量测试数字与阶段 0 相比只多不少、真机一轮真实回合仍有过程行。

---

## 7. 闸门与命令（照抄即可）

```powershell
cd 'E:\H Bot 制造'

# tsc —— 必须分两条跑（连一起会 OOM：NewSpace::EnsureCurrentCapacity）
$env:NODE_OPTIONS = '--max-old-space-size=4096'
node node_modules/typescript/bin/tsc -p tsconfig.node.json --pretty false; "NODE=$LASTEXITCODE"
node node_modules/typescript/bin/tsc -p tsconfig.web.json  --pretty false; "WEB=$LASTEXITCODE"

# 闸门（15 文件 / 107 例是 ce71987 的基线）
node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2

# 定向
node node_modules/vitest/vitest.mjs run tests/main/vendor tests/main/services/agent-core --maxWorkers=2

# 全量（~170-200s；基线 269 files / 3371 passed / 7 skipped）
node node_modules/vitest/vitest.mjs run --maxWorkers=2

# 格式化（先格式化，再更新 vendor 台账！）
node node_modules/prettier/bin/prettier.cjs --write <改动文件...>

# vendor 台账
node scripts/vendor-audit.mjs --update
node scripts/vendor-audit.mjs
```

需要重生成基线时：

```powershell
node scripts/update-file-size-baseline.mjs   # fileGrowth 的 >=800 行登记表
node scripts/update-style-baseline.mjs       # styleContract 的头注释预算表（不许有幽灵条目）
```

**不许裸跑 `pnpm`**：这台机器的 `node_modules` 与 lockfile 版本不一致，`pnpm` 会想 purge 重装，
无 TTY 直接 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`（表现为 EXIT=1 + 零输出）。
一律 `node node_modules/vitest/vitest.mjs` / `node scripts/…`。

---

## 8. 真机验证

```powershell
cd 'E:\H Bot 制造'
# 1) 先收工：dev 在跑时改源码会 ReplaceFileW EIO (Win32 32)
Get-NetTCPConnection -LocalPort 43191 -State Listen | Select -First 1 -ExpandProperty OwningProcess | Stop-Process -Force
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'E:\H Bot 制造*' } | Stop-Process -Force

# 2) 起重（后台 job，日志落 _recovery）
Remove-Item Env:ELECTRON_RUN_AS_NODE
$env:QQBAT_CDP_PORT = '1'
node node_modules/electron-vite/bin/electron-vite.js dev *> _recovery/dev-tool-pipeline.log
```

```powershell
node _recovery/cdp-smoke-role.mjs                          # 期望 ERRORS=0 + chatMount=true
node _recovery/cdp-eval.mjs _recovery/ex-tools-number.js   # 期望 {ok:true,count:35,...}
node _recovery/cdp-eval.mjs _recovery/ex-ui-compose3.js    # 用真实入口发一轮（只调一次 list_dir）
node _recovery/cdp-eval.mjs _recovery/ex-ui-check.js       # 期望 turnProcess >= 1、"工作了 N 秒1 次工具"
```

截图期望：`_recovery/ui-tool-pipeline.png`（1365x1009），过程行在正文之上、无头像、轮尾图标操作。

探针文件都在 `_recovery/`，**不要重写**：`cdp-eval.mjs` 会 `awaitPromise`；
`ex-ui-compose3.js` 用原生 value setter + `input` 事件填 composer，再点 `aria-label="发送消息"`
（直调 `window.qqbat.ai.agentCoreRun` **不落界面** —— 收尾处理器都带 `if (!c.streaming) return`，别拿它验排版）。

---

## 9. 明确不做（scope guard）

- **不搬 `validateJsonSchemaValue`**：我们没有 `Tool.output.schema`，没有消费方。要做得连
  `json-schema.ts`（610 行）+ `Tool` 接口一起改，不属于本批。
- **不 deepFreeze 参数**：上游冻结实参，我们 35 个工具里可能有的会就地改 `args`（没逐个核过），
  先只做"快照"，冻结作为后续可选项（`freezeArgs?: boolean`，默认 false）。
- **不把审批搬进 prepare**：见 §4 取舍 1。
- **不引入 cordis 的 `ctx.waterfall` / `ctx.events`**：用本地 `composeWaterfall` 复刻语义。
- **不改消息顺序、不改 `[工具失败]` 前缀、不改 `skip` 的文案**。
- **不动 repeatGuard / todo / spill / compaction / modelAdapter** —— 它们各自有闸门盯着。

---

## 10. 风险与坑（本仓已踩过的，逐条对应解法）

| 坑                | 现象                                                                      | 解法                                                                 |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 行数闸门          | `fileGrowth` 用 `split('\n').length` 计数，**>=800 就红**                 | 新文件控制在 300 行内；`core.ts`（793）加字段前先量                  |
| 文件头            | `styleContract` 限 20 行                                                  | 头注释压到 12-19 行，细节写进文档                                    |
| 幽灵条目          | 基线表里有已合规/已删除的文件 → 反向断言失败                              | 改完跑 `update-file-size-baseline.mjs` / `update-style-baseline.mjs` |
| vendor 哈希漂移   | `vendor-audit` 报"目标文件被手改过"                                       | **先 prettier，后 `--update`**，再 audit                             |
| 死出口            | `deadExports` 报"仅测试引用"                                              | 要么真接线，要么登记理由                                             |
| tsc OOM           | `NewSpace::EnsureCurrentCapacity Allocation failed`，exit 134             | 两条 tsc 分开跑 + `NODE_OPTIONS`                                     |
| vitest 内存 flake | `terminal.test.ts` 两例红 + `Worker exited unexpectedly`                  | 先看空闲内存（<8GB 必炸），杀残留 dev Electron 后整套重跑            |
| dev 占锁          | `ReplaceFileW EIO (Win32 32)` / Vite `EBUSY`                              | 改源码前停 dev + 杀 electron + 释放 43191                            |
| 目录列举          | `tools.glob` 对 E 盘返回空                                                | 一律 `Get-ChildItem`，且显式 `workdir`                               |
| 编辑              | `file changed since it was read` / `has not been read`                    | `tools.read` 之后才能 `tools.edit`（pwsh Get-Content 不算）          |
| no-op edit        | 整段 `run_code` 抛 `old_string and new_string must differ` 并截断后续编辑 | 编辑前先 grep 落盘状态；批量改动用 node 脚本 + 一次写回              |
| pwsh              | 漏 `description` 直接报 required property                                 | 每次都带                                                             |

---

## 11. 做完的验收清单

- [ ] `tsc` node 0 / web 0
- [ ] `tests/guards`：15 文件 / 107 例全绿（若新增白名单条目，数字会变，**写明差值**）
- [ ] 全量 vitest：≥ **269 files / 3371 passed / 7 skipped**，`EXIT=0`
- [ ] `node scripts/vendor-audit.mjs`：`vendored 16 个文件，适配层 2 个 … OK`（当前 15 + 1）
- [ ] 真机：`ERRORS=0`、35 个工具、一轮真实回合出现过程行、截图存档
- [ ] `docs/ai/agent-core-wiring.md` §45（含"搬了什么/没搬什么/钩子为什么只做宿主自己用的/取消语义两条/测试与数字"）
- [ ] `MANIFEST.json` 新条目（`kind:"vendored"`、`sourcePath:"packages/core/tools/src/pipeline.ts"`、
      `targetPath:"src/main/vendor/dsh/tool-pipeline/pipeline.ts"`、两条 sha256、`adaptedNotes` 至少 4 条）
- [ ] `src/main/vendor/dsh/README.md` 目录表 + "怎么用" + "搬不动的清单" 各 +1 行
- [ ] `THIRD_PARTY_NOTICES.md` 取用清单 +1 行
- [ ] `git status` 干净、提交在 `main`

---

## 12. 参考索引

**上游**（`E:/H Bot 制造/deepseek-harness-master/deepseek-harness-master/`）

| 文件                                     | 行数 | 用途                                                                 |
| ---------------------------------------- | ---- | -------------------------------------------------------------------- |
| `packages/core/tools/src/pipeline.ts`    | 772  | 本批主体（:62 class / :648 toolErrorMessage / :771 re-export batch） |
| `packages/core/tools/src/batch.ts`       | 264  | 已搬（`src/main/vendor/dsh/tool-batch/batch.ts`，229 行）            |
| `packages/core/tools/src/contracts.ts`   | 363  | 类型来源（`TOOL_ABORTED` 等）                                        |
| `packages/core/tools/src/json-schema.ts` | 610  | 本批**不搬**                                                         |

**本仓**

| 文件                                        | 行数 | 角色                                                                    |
| ------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `src/main/services/agent-core/scheduler.ts` | 209  | 要拆的对象（内联 pipeline + complete/skip 宿主语义）                    |
| `src/main/services/agent-core/core.ts`      | 793  | `Tool` 接口 + `runAgentLoop`（加 `isConcurrencySafe`）                  |
| `src/main/vendor/dsh/tool-batch/batch.ts`   | 229  | 合同：`BatchPipeline.prepare/dispatch/complete/start/skip`              |
| `src/main/services/agent-core/contracts.ts` | 99   | `ApprovalService` / `TraceSink` 等五个服务                              |
| `src/main/services/ai/toolApproval.ts`      | —    | 审批（`ai:approvalRequest` / `ApprovalDecision`）                       |
| `docs/ai/agent-core-wiring.md`              | —    | §38（tool-batch）、§44（spill-local）是最近两批的记账格式，§45 照抄结构 |
| `src/main/vendor/dsh/MANIFEST.json`         | —    | 台账（当前 15 条 vendored + 2 条 adaptation）                           |

---

## 13. 一句话

**batch.ts 管"这一批怎么排"，pipeline.ts 管"这一次怎么活"。**
第二半现在只写了中间一段，把它补齐之后，取消、拒绝、钩子、错误归一才算真的有了落点。
