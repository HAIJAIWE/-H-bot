# 旧链路迁移到 agent-core（2026-10-18，路线图 + 第一阶段）

> 对象：低代码页的「助手」链路（`processAiChat` → `authorRuntime` / `chatRun`，多角色 lanes + 规划器 + 工具注册表）
> 目标：**一套循环**。不是"两个能跑的引擎挑一个"，而是旧链路的编排、工具、审批最终都落到
> `agent-core`（`runAgentLoop` / `runTurn`）上，旧模块逐个删掉。

## 0. 为什么现在做

低代码页现在有两条能用的链路：

- **旧链路（默认）**：`processAiChat` → `authorRuntime`（scout → planner → lanes → verifier）
  → `ai/tools/*` 模板化工具。功能最全：能改流程、生成代码、跑机器人、MCP。
- **新链路（循环模式）**：`ai:agentCoreRun` → `runAgentLoop` + 6 个通用工具
  （read/write/run/search/list/validate）+ 审批 + 溢出 + 轮次日志 + 投影。

新链路的**机制**已经比旧链路完整（gate/spill/inbox/投影/提示分段/沙箱缝都是新层做的）；
旧链路的**能力**（工具集 + 多角色）比新链路完整。两条并存 = 每个新功能都要问"哪条链路"，
而实际已经有功能只在新链路里（插话、排队、先计划、投影、撤回循环改动）。

## 1. 现状盘点（2026-10-18）

| 模块 | 行数 | 职责 | 迁移去向 |
|---|---|---|---|
| `services/agent/authorRuntime.ts` | 628 | 多角色编排（角色表、计划阶段、复核） | 拆成"角色表 + 一个循环"，编排落 `runAgentLoop` |
| `services/ai/chatRun.ts` | 1075 | 单轮工具循环、审批、计划阶段出口 | 删：循环语义由 `runAgentLoop` 取代 |
| `services/ai/index.ts` | 890 | `processAiChat` 总入口、批量、历史 | 入口保留（IPC 契约不变），内部改调新层 |
| `services/ai/tools/registry.ts` | 851 | 模板工具（流程/代码/运行/MCP） | 逐个改写成 `Tool` 形态，进 `registerTool()` |
| `tools/defs.ts` + `execute.ts` + `capability*.ts` | 771 | 工具定义与执行 | 与 registry 一起迁，执行走 `ToolContext.gate` |
| `lanes.ts` / `verifier.ts` | 520 | 角色 prompt 与复核 | **保留语义**：作为注册的 prompt 段落 + 一个"复核轮" |
| `ai/prompts/*` | — | 意图 → 系统提示 | 迁到 `registerPromptSection()`（按意图注册） |

新层已有的、可以直接复用的：`runAgentLoop` / `runTurn`（含 history/historyNote）、
`ToolContext.gate` + allowRules、spill 链、turnJournal、trace(turnId)、`registerTool`、
`registerPromptSection`、SandboxProvider、TurnProjection。

## 2. 迁移顺序（每一步都可独立回滚）

### 阶段 0（已完成 2026-10-18）：对齐词汇，而不是先写代码

- `Tool` 增加 `category: 'query' | 'mutation'`，与 `AiToolDefinition.category` 同一套词；
- 「先计划」的工具过滤从"按名字排除两个"改成 `category === 'query'`；
- 缺省视同 mutation（新工具忘标 = 计划轮里不可用，安全侧失败）。

这一步的价值：阶段 1 的适配器不再需要"猜"哪些工具会改盘 —— 字段名和取值都已经一样。

### 阶段 1（已完成 2026-10-18）：适配器 + 诊断

- `ai/legacyToolAdapter.ts`：`AiToolDefinition → Tool`，执行器**注入**（适配器不知道 registry、
  不碰 BrowserWindow）；`category === 'mutation'` 的工具**先过 gate** —— 不然迁移进来的写工具等于绕过审批；
- 诊断（`tests/main/services/ai/legacyToolAdapter.test.ts`）：
  新循环真的能驱动旧形态工具（模型点名 → 执行 → 结果回灌）；
  mutation 被拒时执行器一次都没跑；query 不弹审批；
  **盘点**：`ALL_TOOL_DEFINITIONS` 全部 23 条都能适配（没有哪种形态漏掉）。

阶段 2 要接的正是那个注入位：把假执行器换成 `executeTool` + 真实上下文。

- 给 `ai/tools/registry.ts` 的工具加一层**适配器**：`AiToolDefinition → Tool`（name/description/parameters/run），
  `run` 内部把 `ToolContext` 的 gate 转给旧工具的审批回调；
- 一个**诊断入口**（不进 UI 主路径）：用旧工具集跑 `runAgentLoop`，对比"同一个需求，旧循环 vs 新循环"的输出与工具序列；
- 验收：诊断入口在真实项目上跑通"读流程 → 改一个节点 → 校验"，且 tool trace 与旧链路一致。
- 回滚：删掉适配器文件即可，旧链路一行未动。

### 阶段 2：总入口切换（按意图逐步放量）

- `processAiChat` 内部按意图分流：**只读意图**（查/问/解释/看看）→ `runAgentLoop`；
  会改动的意图继续走旧链路；
- 每个意图切换都带一个 eval（已有的 12 条任务级 eval 扩到同一批需求，两链路各跑一遍比结果）；
- 验收：只读意图连续 3 天无回退，`chatRun` 里对应的只读分支删除。
- 回滚：开关回到旧链路（与今天循环模式的开关同一机制）。

### 阶段 3：删除旧循环

- `chatRun` 的工具循环、计划阶段出口、`lanes` 的调用方全部变成 `runAgentLoop` 的一层"角色提示 + 工具子集"；
- 删 `chatRun.ts`、`tools/execute.ts` 的重复执行逻辑；`authorRuntime` 缩成"角色表 + 复核轮"；
- 验收：全部 eval 绿、`grep` 不到 `chatRun` 的调用点、文档里不再出现"两条链路"。

## 2.5 阶段 2a 的落点（2026-10-18 读过入口后的具体方案）

入口：`services/ai/index.ts:488 processAiChat`。已确认的顺序是：先 abort 旧请求 → 建 turnId
（`beginTurn`，:564）→ 冷启动读配置（:565）→ … → 进 `chatRun` 的工具循环。

**切点放在"配置就绪之后、chatRun 之前"**：那里 turnJournal 已经开好、项目已校验，
再往后就是旧循环自己的状态（`ChatRunState`、autoTx、proposal）—— 切点越往后，要兼容的事件越多。

**只读判定（三条同时成立）**：

1. 需求文本是"问"而不是"做"：没有 `加|做|改|建|新增|删除|删掉|接上|写|生成|替换|运行|跑` 这类动作词
   （旧链路 `shouldPlan` 里已有一份动作词表，复用同一份，别再抄）；
2. 当前角色（流程/代码/双向/创作）的**工具集里没有 mutation 类**被这一轮需要 —— 实际上只读意图
   根本不需要工具集全量，直接给 `category === 'query'` 的子集；
3. 用户在设置里没有强制"旧链路"（一个显式的引擎开关，默认 = 跟随判定）。

**切过去要维持的事件契约**（渲染层零改动的前提）：

- `ai:chunk` / `ai:toolCall` / `ai:agentState` / `ai:response` / `ai:error` 五条与现在同形；
- `ai:response.payload` 仍要带 `{ projectPath, message }`（渲染层按它合成消息）；
- turnJournal 的 before 记录继续由 `onBeforeWrite` 走（只读意图本来就不写，等于空转）。

**验收（先度量再放量）**：

- 同一批只读需求（来自 eval 里已有的 12 条）在两条链路各跑一遍，比较：最终文本是否回答了同一个问题、
  是否零工具改动、耗时差多少；
- 新链路连续 3 天无回退才删旧链路的只读分支。

**回滚**：路由是一个纯函数 + 一个开关，出问题把开关拨回"全走旧链路"，一行代码。

> 这一条现在只写到"方案 + 验收"，**没有动代码**：切点在 400 行的编排里，半接的状态比不接更危险
> （回滚开关、事件契约、turnJournal 三处必须同时对齐）。下一轮按上面的落点动手。

## 3. 三个必须现在定下来的决定

1. **多角色 lanes 保留吗？** 它们现在是"同一循环换提示 + 换工具子集"。
   **2026-10-18 按上游文档校正后的答案**：dsh 的形态是**一个 loop 驱动 + 多个 Agent 实例**
   （`core/agent` 的 live registry；每个 Agent 通过 `core/scope` 做**作用域内注册**，
   工具可见性是"注册在谁的作用域里"，不是"提示词里告诉它只能看这些"）。
   所以 lanes 应该迁成"多 Agent 实例共享一个 loop + 作用域化工具注册"，
   而不是把工具子集硬塞进提示词 —— 后者是提示词自律，前者是可见性约束。
2. **计划阶段归谁？** 旧链路有 env 开关的 plan phase（默认关），新链路有「先计划」轮次。
   迁移后只留一个：用户可见的那个（先计划），旧 env 开关删掉。
3. **MCP 工具**：`tools/capability*.ts` 依赖主进程 MCP server。迁到 `registerTool` 时要保持
   "工具结果 → spill → 投影"这条链不变，不要在 MCP 侧再写一份。

## 4. 风险与规避

| 风险 | 规避 |
|---|---|
| 旧工具依赖 `BrowserWindow`/`event.sender` 发事件 | 适配器把事件出口收敛成 `ToolContext` 的回调（新层本来就不碰 window） |
| 审批语义漂移（旧：工具名+参数；新：write/command 类别） | 阶段 1 先对齐：旧工具在适配器里**显式声明**它属于哪类动作 |
| 批量/撤回（`beginBatch/commitBatch`）依赖旧循环的边界 | 阶段 2 前先把"批"的边界挪到轮次（现在 turnJournal 已经是按轮记的） |
| 12 条 eval 是脚本化模型，换循环会错位 | 阶段 2 的每条意图切换都配一条 eval（同一需求两链路比结果） |

## 5. 现状一句话

**新层是机制，旧层是能力。** 迁移不是把旧层删掉，而是把旧层的能力**装进**新层的机制里；
每装一个，就删掉旧层里对应的一份编排。今天先做阶段 1（适配器 + 诊断入口），
旧链路保持不动，随时可回滚。
