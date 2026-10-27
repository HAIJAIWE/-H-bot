# 与 DSH 的对齐盘点（2026-10-18）

> 这份表回答一个问题：**qqbat 的智能体架构，跟 DSH（DeepSeek Harness）还有多少不一致？**
> 判据只认**代码里真的接上了什么**，不认"设计上打算做什么"。
> **2026-10-18 校正**：DSH 现在有公开仓库（github.com/deepseek-ai/deepseek-harness，MIT），
> 本文档 §四 是按上游 `docs/architecture.md` / `docs/subsystems/*.md` 重读后的结论 ——
> 之前只读打包产物，漏掉了 Cordis 插件树、作用域注册、turn/step 状态机细节、会话代际与工具管线。
>
> DSH 侧的依据是打包产物里的源码（`app.asar/dsh/node_modules/@deepseek-ai/dsh-*`，
> 逐模块读过：agent / agent-loop / tools / session / session-projection / session-persistence /
> system-prompt / sandbox / subagent / spill / spill-local / spill-policy / output-retention /
> llm / scope / client-store / client-ui-chat）。
>
> 明确一句：**我们不抄代码**。DSH 是 MIT，但这里复刻的是**分层与契约**，实现、命名、
> 数据格式都是本项目自己的（对不上的地方本文会写清楚）。

## 一、总表

判据分四档：

- **对等**：职责、边界、关键语义都对得上（实现是另写的）；
- **同构简化**：关键语义对得上，但少了一层通用化（多见于"只有一个实现，所以没抽接口"）；
- **缺**：DSH 有、我们没有；
- **不同**：目标相近，但走的是另一条路（且是刻意的）。

| # | DSH 的层 | 我们的对应物 | 判定 | 差在哪 |
|---|---|---|---|---|
| 1 | `dsh-agent-loop`（turn/step、Phase、inbox、tool 分发） | `agent-core/core.ts` + `runTurn.ts` | **对等** | inbox 只做了 `next-step`；没有 turn/step 两级、没有 durable inbox projection |
| 2 | `dsh-llm`（provider 无关的 LLM 服务） | `agent-core/modelAdapter.ts` + `ai/llm.ts` + provider 注册表 | **对等** | 无 thinking 流、无 tool_call 增量拼接（一次性拿全量） |
| 3 | `dsh-tools`（工具注册 + 执行管线） | `CORE_TOOLS` + `ToolContext.gate` | **同构简化** | 6 个内置工具写死在数组里；没有插件注册表、没有 per-tool 策略表 |
| 4 | `dsh-session` + `session-persistence` + `session-projection`（事件溯源 + 投影） | `ai/historyStore.ts`（JSONL）+ `ai/threads.ts` + `ai/trace.ts` | **同构简化** | 我们是"消息数组 + 追加日志"，不是事件溯源；没有投影表（render/context 各一份视图是靠现场算的） |
| 5 | `dsh-spill` + `spill-local` + `spill-policy` + `output-retention` | `ai/spillStore.ts` + `core.ts/clampToolOutput` | **对等** | 我们一个文件搞定三段；没有 session 级目录隔离、没有 0600 独占写 |
| 6 | `dsh-system-prompt`（段落注册 + 组装） | `agent-core/prompt.ts`（单段 + 历史交代） | **同构简化** | 没有段落注册表，加一段就得改函数 |
| 7 | `dsh-guard`/`dsh-interaction`（审批 + 规则） | `ai/toolGuard.ts` + `ai/toolApproval.ts` + `ai/allowRules.ts` + 面板撤销口 | **对等（局部更强）** | 我们多一层"跨轮规则表 + 可视撤销"；缺 `always` 的规则模板/作用域 |
| 8 | `dsh-sandbox`（进程沙箱 provider 契约） | `resolveInWorkspace` + 命令白名单 + 审批 | **同构简化** | 没有独立进程/工作区隔离提供者；靠白名单 + 路径沙箱 + 人工放行 |
| 9 | `dsh-telemetry`（span / metrics / 成本） | `ai/trace.ts` + `runStats` + 状态条 | **同构简化** | 只有"一轮一行"的 trace 与厂商 token 数；没有 span 树 |
| 10 | `dsh-agent`（Agent 注册表 / 多 agent）+ `dsh-subagent` | 旧链路 `ai/scout/planner/lanes` + `agent/authorRuntime` | **不同** | 我们的多智能体是"固定阶段"（侦察→规划→并行），DSH 是"可注册的 agent + subagent 提供者" |
| 11 | `dsh-client-ui-chat`（Conversation/节点/渲染器/详情） | `ai/ChatPanel.tsx` + `ToolRows.tsx` + 按轮折叠 + 事件契约闸门 | **同构简化** | 形态对齐（节点式工具行、按轮分组、流式状态），但没有可注册的节点类型/渲染器 |
| 12 | `dsh-client-store`（按 key 的 observable store） | zustand `aiStore`（整棵状态 + 选择器） | **不同** | 我们是单 store，切一个字段会惊动订阅者；DSH 是 keyed store + `useChatNode(key, selector)` |
| 13 | `dsh-session-projection` 的"可合并投影" | 无 | **缺** | 直接影响：轮次撤回/回放/视图重组得各写一遍 |
| 14 | `dsh-plan` / `dsh-scope`（计划阶段、作用域事件） | 部分在 `ai/planPhase`（P1-6 未启用） | **缺/不同** | 计划阶段有代码但没接；scoped event dispatch 没有对应物 |

### 一句话结论

**同构的地方（1–9、11）已经和 DSH 走一条路**：循环 / 模型缝 / 工具 / 会话 / 溢出 /
提示 / 审批 / 沙箱 / 遥测 / 聊天渲染 —— 十个位置**九个在同一条设计线上**，其中 1、2、5、7 是
"对等"，其余是"只有一个实现所以没抽接口"。

**真正还差的是"每层可被替换 + 注册可回收"**：DSH 的每一层都是 Cordis 插件（注册即副作用、
卸载即回收），我们的每一层都直接 new 出来。这不是功能缺口，是**扩展性缺口**。
⚠️ 2026-10-18 按上游文档校正：详见 §四 —— 之前把 scope 理解成"事件分发"是错的，
真实形态是"按 agent 的作用域注册 + 生命周期"；插件运行时**不作为内核形态照搬**（代码可以吸收，见 §五-1），该抄的是纪律。

**刻意不同的是** 10（多智能体形态）和 12（状态管理）：前者是我们已有的资产，后者换 store
的成本远大于收益。

## 二、"复刻上"的顺序（按性价比）

1. ~~**`next-turn` 与 durable inbox**（对应 DSH 的 `ReactLoopInbox`）~~：**已完成（2026-10-18）**
   —— 两级队列（step/turn）+ 落盘 `.qqbat/agent-inbox.json`，turn 跨崩溃可续跑。
   剩下的差异只有"存的是数组不是事件流"（见 §14.4）。
2. ~~**工具注册表**（`dsh-tools`）~~：**已完成（2026-10-18）** —— `registerTool()/listTools()`
   已接进循环，测试证明"注册即被调到"。还剩一半：把实现搬出 `core.ts`（不急，见该文件注释）。
3. ~~**投影**（`session-projection`）~~：**已完成（2026-10-18）** —— `flow/turnProjection.ts`，
   `listTurns` 与「本轮改动」卡都读它。还剩：可合并投影表、回放。
4. ~~**系统提示分段**（`system-prompt`）~~：**已完成（2026-10-18）** —— `registerPromptSection()`。
5. ~~**沙箱 provider**~~：**已完成（2026-10-18）** —— `SandboxProvider` + `localSandbox`。
6. **（新，按上游校正后）** 会话日志代际/迁移（§4.4）与工具管线输出契约/呈现器（§4.6）——
   这两条比"scope 事件"更值得做。


## 四、上游实际架构（2026-10-18 按 GitHub 文档校正 —— 之前漏了什么）

之前几版盘点只读了打包产物里的包名，把 dsh 当成"一组可替换模块"。**上游的真实图景是 Cordis 插件树**，
很多判断因此偏了。以下按仓库文档校正（来源见每小节链接）。

### 4.1 编排方式是插件，不是模块

- 仓库标题就是 *Everything is a Plugin*，底座是 Cordis：插件向**共享 context** 里贡献服务、
  类型化事件和**可回收（disposable）副作用**；每一层（模型适配、工具注册表、会话日志、甚至
  agent loop 本身）都是插件，所以都能被配置替换。`docs/architecture.md`
- 一次运行 = 启动时按**层**拼出的插件树：profile（命名组合）→ bundles → `cordis.patch.yml` → home patch → `--patch`；
  每行都能被上层 patch 替换。没有"特权核心可打补丁"。
- 推论（我们之前的偏差）：**"注册表 + 缝"只抄了一半**。dsh 的取代能力来自"注册即副作用、卸载即回收"，
  不是"留一个 setXxxProvider 的口子"。我们的 gate/spill/registry 方向对，但没有生命周期与作用域。

### 4.2 scope 不是"事件分发"，是**按 agent 的作用域注册**

- `core/scope` 是**库**（不是服务）：`ScopeKey` 是不透明对象身份（默认就是 Agent 对象本身），
  提供"同一份注册既表示 per-agent 可见性、又表示共享生命周期"的词汇；`Scope` 带两条释放路径
  （`rawDispose` 给有序组合副作用，`dispose()` 是共享静默边界）。`docs/subsystems/scope.md`
- 我们之前把 scope 写成"缺：按作用域的事件分发" —— **这个理解是错的**。缺的是
  "注册的作用域 + 卸载回收"，不是事件分发。

### 4.3 turn / step 是明确的状态机，且全是事件

- **step = 一次模型请求 + 它调的工具有；turn = 零或多个 step**（第一次输入被 claim 前打开，
  没有欠账时关闭）。
- 流程点名的扩展点：`turn/start` → claim（next-step + 一条排队消息）→ 组装 prompt/tool schema →
  `agent/pre-step`（waterfall，可改写或拒绝；拒绝/空 → 无 step 收尾）→ `step/start` →
  `agent/request`（waterfall，`prepareCall` 解析真实路由）→ 提交 system/user → 派生并冻结历史 →
  `llm/stream` → `tool/call*` → `tools/pre-execute` → `tools/execute` → `tools/post-execute` →
  `step/end` → （还欠请求或又来 next-step → 继续 claim）→ `agent/turn-stopping`（串行、无 next）→ `turn/end`。
- **四个 waterfall**（`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*`）都要求监听者调 `next()`
  才继续；这是"拦截而不独占"的机制。`docs/architecture.md` §Turn flow
- 我们对照：`runAgentLoop` 有两级 inbox，但没有 pre-step 的**改写/拒绝**语义、没有 request 阶段的路由
  与取消提交规则、没有 turn-stopping 串行点。这些不是名字问题，是"何时可以改变主意"的边界。

### 4.4 会话日志是**事件溯源 + 版本化代际**

- `core/session` 拥有 `SessionEvent` 日志；`deriveMessages()` 从日志**投影**模型历史。
  每个 `assistant/message` 内嵌产生它的紧凑流；`assistant/attempt` 保留失败/重试/取消的尝试但不进模型历史。
- 存储是 JSONL：v0 = `session.jsonl`，v1+ = `session.vN.jsonl`（可 zstd）；打开时选最高**代际**，
  读旧格式要么就地翻译、要么"解码 + 相邻迁移链"一次，校验后返回当前事件；写打开先编码、校验、
  **独占发布**新代际，旧代际永不改名/替换/删除。中断尾部的修复是句柄消费者的责任。
  `docs/architecture.md` §Session log
- 我们对照（2026-10-18 复核，**上次这条写错了**）：
  我们**已经有**版本化头（`{"__v":1,"kind":"ai-history"}`，`historyStore.ts:188`）、
  打开时识别版本（`readHistoryFormatVersion`：无头=0、坏头=0、未来版本保留）、
  破坏性重写（压缩）前**拒绝改写未来版本**、压缩时把 v0 顺手升到当前版本 ——
  三条语义都有测试钉住（`tests/main/services/ai/historyFormat.test.ts`、`historyReadback.test.ts`）。
  真正缺的只有两件：
  1. **迁移链**：现在"升版本"是就地重写（因为 v0→v1 的条目形状相同，不需要变换）；
     一旦 v2 改条目形状，没有"每个版本一步 transform"的注册处。**今天没有迁移可写，
     所以不造这个空壳** —— 等真的改形状时再补，别提前造脚手架。
  2. **attempt 语义**：失败/重试/取消的尝试没有单独记录（上游 `assistant/attempt` 进日志但不进模型历史）；
     我们失败时直接 `ai:error`，重启后无从追溯。这条比"代际"更值得做，因为它影响**可观测性**。
  结论：会话日志这一层介于"同构简化"与"对等"之间 —— 代际语义在，attempt 不在。

### 4.5 系统提示是"表面节点"，不是字符串

- 提示作为 `system/message` 历史传递；"能缓存的路由"在缓存历史后**追加非空更新**，
  "不能缓存/新请求序列"则在第一个 system 节点合并；空渲染会清空所有活动 system 节点。
  `docs/architecture.md` §Turn flow
- 我们对照：`buildSystemPrompt()` 一次性拼字符串 + `PLAN_ONLY_NOTE` 追加。够用，但**没有"更新/清空"的语义**，
  长会话里提示变化只能靠重发全文。

### 4.6 工具管线比"注册 + 调用"深

- `ToolDefinition` = 模型侧 `ToolSchema` + **强制 canonical output 声明**（`schema` + `render` +
  `presentationMeta`）+ `execute` + 宿主调度元数据（`timeoutMs`、`isConcurrencySafe`）+
  UI 呈现器（`presentCall`/`presentResult`）+ `projectContent`/`finalizeContent`。
- `schemas()` 用显式 allowlist 生成模型可见 schema：`output/execute/projectContent/...` **永不泄漏**给模型。
- 执行有 `tools/pre-execute`、`tools/post-execute` 两个 waterfall，外加取消信号（`exec.signal`）契约。
  `docs/subsystems/tools.md`
- 我们对照：`Tool` 只有 name/description/parameters/category/run。缺：输出契约、UI 呈现器、
  并发安全标记、超时、pre/post 钩子。这决定了"同一个工具能不能既给模型看、又给界面渲染"。

### 4.7 桌面端：同一个 Web 运行时 + 宿主壳

- Electron 桌面不另写一套：打包**同一份** dsh 生产运行时，由 Desktop Host 调共享 CLI profile runner
  和完整 Web 应用；window 先加载打包的 Web 资产，等 boot injections 再激活客户端插件。
  Web 拥有 RPC 与流；桌面壳只做"把本地页面接到已认证的 Host"。`docs/architecture.md` §Desktop application
- 我们对照：Electron 主进程直接持有业务（IPC handler + 服务）。形态不同，但**"UI 与运行时同源"**这条
  值得学：我们的循环逻辑不该只存在于主进程的一堆 handler 里。

## 五、校正后的结论

1. **内核实现不照搬 Cordis（2026-10-18 初判；2026-10-25 修订）**：不把 DI 容器/插件树当作**内核的组织方式**——我们是 Electron + IPC 的单体，抄插件运行时的代价（262 包的依赖树、生命周期、双运行时同步）远大于收益。
   **但"不照搬"只约束内核的实现形态，不约束吸收上游代码**：2026-10-25 用户已解除「别照搬」约束（见 `dsh-source-adaptation-2026-10-24.md:80`），此后我们已 vendor 10 个子系统约 2028 行（`src/main/vendor/dsh/**`、`src/shared/vendor/dsh/**`，provenance 头保留）。
   要抄的是**"每层可被替换 + 注册即副作用可回收"的纪律**，落点就是我们已有的几个缝
   （工具注册、提示段落、沙箱、spill、审批规则）。
   适配是双向的：我们既可以**作为插件被 DSH 宿主驱动**，也可以**把 DSH 运行时包进我们的宿主**——两条路都走协议/SDK 面，而不是把 Cordis 塞进内核（第 61 批的 `window.qqbat.agent` 与 P1 的 Electron-free runtime 就是为此铺路）。
2. **scope 重新定义**：不是事件分发；如果要做，做"按会话/按 agent 的工具可见性与生命周期"，
   而不是再造一套事件总线。
3. **优先级重排**：会话日志代际/迁移 与 工具管线的输出契约/呈现器，比"scope 事件"更值得做。
4. **迁移计划相应调整**：lanes 不应迁成"同一循环 + 提示子集"那么简单 —— 上游的形态是
   **一个 loop 驱动 + 多个 Agent 实例（各自具名、各自作用域内注册工具）**；我们的 lanes 应该迁成
   "多 Agent 实例共享一个 loop"，工具可见性走作用域，而不是提示词里说"你只能看这些"。

## 六、这张表怎么用

- **不是完成度竞赛**：第 10、12 两条我们永远不会"对齐"，也不该对齐；
- **每次动 agent-core 之前**先看这张表：改的是哪一层、这一层的契约在哪、改完要不要同步闸门；
- 表里每一行的"我们"都必须能在代码里找到（找不到就说明写的是愿望，不是事实）。
