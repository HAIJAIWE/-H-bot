# 智能体（Agent）架构评审

> 评审对象：H Bot 制造 / qqbat 仓库中与「智能体」直接相关的三层实现。
> 日期：2026-10-18。方法：只读代码审查（不跑构建、不改代码），四个子域并行深读后由主审汇总与交叉复核。
> 证据等级：✔ = 主审本次复核；△ = 子域审查提供、主审抽查未逐一复核。
> 规模：services/ai 12,905 行 / 52 文件；services/bot 2,937 行 / 12 文件；runtime 8,956 行 / 34 文件；mcp 800 行 / 5 文件；测试 532 个文件。

---

## 0. 结论摘要

1. **不需要重写整个代码库。** 主干设计（单一工具注册表 + 声明↔实现闸门 + 工具结果单一出口 + 提案式 HITL + 图解释器）是对的，且比多数自研 agent 正规。真正需要「重做」的只有 **主进程↔渲染层的写通道协议** 与 **机器人默认工具集/风险判据** 两块。
2. **两处必须立刻改（P0）**：机器人默认工具集里含一个可任意外呼的 HTTP 工具且不触发确认；作者助手的并行预取发生在审批闸门**之前**，使 run_test / invoke_capability 这类「声明 query、实际有副作用」的工具可以未批准先执行。
3. **八处结构性债务（P1）**：写通道单向无回执（「操作已提交」是假成功）、write_file 在助手路径被静默丢弃、MCP 可绕过提案直接改图、LLM 失败会丢弃已累积提案、机器人额度是死代码且失败对群友沉默、控制流靠提示词与启发式而非状态机、三本观测账串不起来、记忆整份重写非原子。
4. **架构形态**：不是「多智能体系统」，而是「一个单上下文 ReAct harness（作者助手）+ 一个精简 ReAct 循环（机器人）+ 一个图执行引擎（流程）」，三者共用工具层与节点 handler，但没有共用的 AgentRuntime。方向正确，缺的是把同一套纪律接到所有路径上。
5. **最该警惕的不是代码，是注释**：安全相关文件里有 10+ 处注释与代码相反（附录 A）。照文档评审会误判。

---

## 1. 三个「智能体」

| 代号 | 名称 | 代码位置 | 面向谁 | 关键事实 |
|---|---|---|---|---|
| **A** | 作者助手（AI 造机器人） | services/ai（+ ipc/ai.ts、renderer/stores/aiStore.ts） | 开发者本人 | 真 ReAct/FC 循环，MAX_ROUNDS=18，工具 31 个，mutation 走提案 |
| **B** | 机器人运行时 Agent | services/bot + builtinNodes/agentNodes.ts | 群里的人 | 真多轮工具循环（默认 3 轮），工具=画布节点，白名单制 |
| **C** | 流程引擎 / MCP 服务 | runtime + mcp | 事件驱动 / 外部 IDE | 图解释器 + 把 A 的工具表暴露成 MCP server |

三者不是分层关系，而是**并列的三条入口**，共用 L1（节点注册表 + handler）与部分 L2（工具结果漏斗）。这一点决定了后面所有「重复实现/边界错位」的问题。

---

## 2. 职责边界与数据流

### 2.1 三条调用链

**A. 作者助手**

```
renderer ChatPanel → ipc ai:chat (ipc/ai.ts:127)
  → processAiChat (services/ai/index.ts:492)                 [main]
     ├─ beginTurn 轮次日志 (index.ts:551)
     ├─ 角色→工具子集 (agents.ts:192-206)
     ├─ 记忆装载：线程 JSONL → token 留尾 (index.ts:604-609)
     ├─ buildSystemMessage：P0/P1/P2 分段按预算装配 (context.ts:58-313)
     ├─ while rounds < 18 (index.ts:801)
     │    └─ runOneRound (chatRun.ts:804) → callLlmWithFallback → provider
     │         └─ onToolCalls → dispatchToolCalls (chatRun.ts:389)
     │              ├─ query    → executeTool → handler（真执行、结果回灌）
     │              └─ mutation → toolCallToOperations → pendingOperations（不落盘）
     └─ 四种收尾：response / proposal / 上下文超限 / 轮数用尽
  → ai:proposal → renderer applyProposal (aiStore.ts:1078) → 写盘
  → renderer noteTurn (ipc/ai.ts:167) → 下一轮作为 [系统回执] 进历史
```

**B. 机器人运行时**

```
群消息 → FlowRuntime.handleMessage (runtime/FlowRuntime.ts:412, void 并发派发)
  → FlowInterpreter.dispatchEvent (:309) → triggerMatcher → execBlock
  → agent_chat handler (builtinNodes/agentNodes.ts:39)
     ├─ 策略闸（限流/额度）:107
     ├─ 两阶段确认（上一轮 pending 的「确认/取消」）:118-149
     ├─ 记忆装载:151-159
     ├─ mode=agent → callBotAgent (bot/llm.ts:394) 多轮 / mode=chat → callBotLlm
     │    └─ executeTool → runBotTool → getHandler(kind)（就是画布上那个节点）
     └─ recordTurn 回写记忆:264
  → 回复由下游 message_send 发送（agent_chat 自己不发消息）
```

**C. 编排 / 外部集成**

```
MCP client (外部 IDE) → mcp/server.ts CallTool
  ├─ 工具闸 + 审批 (server.ts:150-229)
  ├─ executeTool (server.ts:383)      ← 直接执行，不经过提案
  │    ├─ query    → 直接返回结果
  │    └─ mutation → needsClientExecution → ai:clientInstruction
  └─ → renderer handleClientInstruction (aiStore.ts:328) 立即应用，无二次确认
```

### 2.2 状态归属矩阵（谁拥有真源）

| 状态 | A 作者助手 | B 机器人 | C 流程引擎 |
|---|---|---|---|
| 会话/历史 | 盘上 threads + historyStore（JSONL） | 盘上 bot-memory（JSONL，按群/人隔离） | 无会话（事件级） |
| 图真源 | **渲染层 flowStore**（flow.json 由它回写） | 只读同源 | 读盘/预览副本 |
| 待确认 | 内存 pendingOperations → renderer 提案卡 | 盘上 bot/pending（5 分钟 TTL） | — |
| 等待/挂起 | 渲染层提案卡 | 盘上 pending | **进程内存 waitRegistry** |
| 事务 | main 的 batch 状态 + 渲染层历史栈 | 无 | 无 |
| 用量 | trace 文件（只写不读） | ai-calls.jsonl（只写不读） | metrics（数据不实） |

**这张表暴露的核心矛盾：A 的「写」真源在渲染层，C 的「等待」真源在内存，B 的「额度」真源不存在。**

### 2.3 四个交接面（流程断点）

1. **main → renderer 写指令（单向、无回执）**：chatRun.ts:693-700、mcp/server.ts:391-429 发出即认为成功；渲染层 aiStore.ts:1580-1585 只 console.error。✔
2. **renderer → main 处置回执（异步、自然语言）**：用户应用/拒绝后经 ai:noteTurn 写成一条 [系统回执] 用户消息（ipc/ai.ts:161-197）。模型要等下一轮才知道结果——把事件降级成了聊天内容。✔
3. **MCP 外部客户端 → 应用**：mutation 依赖 GUI 窗口存在（server.ts:392-408 会诚实拒绝），且落地不经用户确认（aiStore.ts:336-394）。✔
4. **agent_chat 失败 → 群友**：节点只返回 error 字段（agentNodes.ts:228-231），群内默认无兜底回复。△

---

## 3. 问题清单

编号：**P0 = 现在就有安全/数据风险；P1 = 结构性；P2 = 建议/可选。**

### P0-1 机器人默认工具集里有一个「无副作用」的任意外呼工具（致命）

- **证据**：actionGeneric.ts:69-80 把 http_request 声明为 type=action、sideEffects=[] ✔；bot/tools.ts:55-63 默认集判据正是「action 且 sideEffects 为空」✔；agentNodes.ts:87 工具留空即用默认集 ✔；agentNodes.ts:181-190 风险确认只看 sideEffects.length > 0 ✔；netNodes.ts 真发 HTTP（无域名/内网限制）△。
- **为什么是问题**：群友文本以 user role 直接进 prompt（bot/llm.ts:241-246，无注入防护）→ 模型可让机器人 POST 到任意 URL。这条路径既不需要用户确认，也不受「白名单外」限制——它就在默认白名单里。tools.ts:16-19 注释「sideEffects 空 = 不发网络请求」被代码直接证伪。
- **最小改法**（半天）：① 修 http_request 的 sideEffects；② 默认工具集改为**显式白名单**，不按元数据推导；③ 确认判据从 sideEffects 升级为**能力域**（net / write / msg 一律确认）。
- **优先级**：必须改。影响面：所有 agent_chat(mode=agent) 且未显式列工具的线上机器人。

### P0-2 并行预取发生在审批闸门之前（致命，概率中低）

- **证据**：chatRun.ts:467-474 在进入循环体前就把整批 query 调用 executeTool 出去；审批在 chatRun.ts:567-627 才发生 ✔；shouldParallelizeTools（chatRun.ts:220-234）只按 category===query 判定 ✔；run_test（registry.ts:140-183）在 handler 内真的注入消息并跑流程 ✔、invoke_capability（capabilityInvoke.ts）可执行有副作用的能力 △，两者都声明为 query ✔。
- **为什么是问题**：模型一次发出 ≥2 个参数不同的 query 调用时，run_test / invoke_capability 会在用户看到审批框之前执行完。闸门被自己的优化绕过。注意 run_bot 不受影响（它只返回 clientInstruction，指令仍在审批后下发）——这是「部分工具可绕过」，不是全部。
- **最小改法**：预取前先跑 classifyTool，ask/deny 的调用不参与预取（或整批降级串行）；把 run_test / invoke_capability 从「可并行 query」显式排除。
- **优先级**：必须改。影响面：A 侧所有批量查询轮次；安全不变量失效。

### P1-1 写通道单向无回执：主进程和模型都在「假成功」

- **证据**：chatRun.ts:693-700 发完 ai:clientInstruction 即当成功；mcp/server.ts:391-429 直接回 status:dispatched；渲染层 aiStore.ts:1580-1585 只 console.error ✔；registry.ts:752-762 的 mutation handler 统一回「操作已提交」✔。
- **为什么是问题**：这是 P1-2 / P1-3 / MCP 语义错误的**共同根因**。渲染层写失败（权限、路径、并发）时，模型与外部 IDE 都仍认为已生效，用户什么都没得到。
- **最小改法**：给 clientInstruction 加 requestId，渲染层执行完回调 ai:instructionResult（ok/error/reason），主进程超时兜底；失败必须回灌成一条 tool error。
- **优先级**：必须改（它决定后面几项能否收敛）。影响面：A 的全部 query-副作用工具、MCP 全部 mutation、轮次事务正确性。

### P1-2 write_file 在助手路径被静默丢弃

- **证据**：files.ts:75-88 把 write_file 声明为 mutation ✔；toolCallToOperations 的 switch 没有 write_file case，落到 default: return []（proposal.ts:484-485）✔；chatRun.ts:724-738 不检查空 ops，直接回「操作已加入待确认计划」✔。
- **为什么是问题**：代码页说「把这个文件改一下」时，模型以为排上队了、用户看不到提案、磁盘没变——三方都不知道失败。而 agentEvals.test.ts 只断言「没落成 write_code / 磁盘没变」，假成功照样绿 △。
- **最小改法**：补 write_file case（path → filePath + 复用 app-managed/路径校验）；chatRun 对 ops.length===0 回明确错误；给 toolDefinitionDispatchSync 加同构闸门——每个 mutation 声明必须有转换分支。
- **优先级**：必须改。影响面：代码页/双向模式的所有文件写入。

### P1-3 MCP mutation 绕过提案，直接由渲染层落地

- **证据**：mcp/server.ts:383 直接 executeTool ✔；toolGuard.ts:83-95 把 add_node/update_node/delete_node/connect_nodes/write_* 归入 PROPOSAL_MUTATIONS → auto（不询问）✔；aiStore.ts:336-394 收到指令立即 flowStore.addNode / updateNodeConfig / removeNode / addEdge，无二次确认 ✔。
- **为什么是问题**：外部 IDE 可在没有用户确认的情况下改图；且两条入口语义不一致——A 侧同一个 add_node 一定走提案，MCP 侧一定直落。
- **最小改法**：二选一——(a) MCP 图 mutation 一律转提案（复用 mcpProposal 通道）；(b) 保留直落但强制 ask（改 toolGuard 的 MCP 模式基线）。
- **优先级**：必须改（对外集成前）。影响面：MCP/IDE 用户。

### P1-4 LLM 最终失败会丢弃已累积的提案

- **证据**：index.ts:1016-1034 的 catch 只发 ai:error ✔；对比两条降级路径——上下文超限（:976-989）与轮数用尽（:992-1008）都会 emitProposal 交部分成果 ✔。
- **为什么是问题**：十几轮、几十次工具调用的成本已付，一次 403/网络断，用户只拿到一句错，规划全丢。这与仓库自己「失败必须留痕、不丢已规划工作」的纪律冲突。
- **最小改法**：catch 内若 pendingOperations 非空，先 emitProposal（部分，因错误提前结束）再发 error，并补 rememberTurn。
- **优先级**：必须改。影响面：A 侧任务可完成性。

### P1-5 机器人策略层：日额度是死代码，失败对群友沉默

- **证据**：policy.ts:132-156 的 addDailyUsage 全仓只有测试引用，checkBotPolicy 读到的已用量恒 0 △；限流是内存态、重启清零 △；agentNodes.ts:228-231 失败只返回 error，回复依赖下游 message_send △。
- **为什么是问题**：策略层是「面向不受信用户」的最后一道成本闸，现在等于没开；任何失败（没配模型、超时、额度耗尽）群友看到的都是「机器人不理我」，无法归因。
- **最小改法**：agent_chat 拿到 usage 后记账（logBotCall 已在记 token）；额度要么接线要么从文档和 UI 删掉；给 agent_chat 一个可配置兜底话术。
- **优先级**：必须改。影响面：所有线上机器人。

### P1-6 控制流靠「提示词 + 启发式」，而不是状态机

- **证据**：MAX_ROUNDS=18、WRAP_UP_ROUNDS_BEFORE_END=4（chatRun.ts:147-150）、MAX_ANNOUNCE_KICKS=2（:191）、PLAN_PHASE_MAX_ROUNDS=3（:304）、looksLikeAnnouncement 文本启发式（:163）、shouldStayInPlanPhase（:372）✔；对应四条 nudge 常量（:194/199/312/323）✔；planPhase 与 autoTx 默认关（chatRun.ts:341-343、autoTx.ts:49-53）✔。
- **为什么是问题**：不是难看，而是**行为不可预测**：新增一种失败模式就要加一个 nudge + 一个常数 + 一条启发式，每条都可能与既有四条互相干扰。作者自己在注释里写了正确答案——「确定性的事要用结构保证」（index.ts:770），但目前只在「收窄工具表」这一处兑现。
- **最小改法**：把 plan → execute → wrap-up 做成显式状态机（三状态、每态一份工具表 + 一份退出条件），nudge 降级为状态进入说明；looksLikeAnnouncement 只作辅助。
- **优先级**：建议改（不要与 P0 一起做）。影响面：A 主循环 + 约 15 个用例。

### P1-7 观测三本账，串不起一次任务

- **证据**：trace.ts:20-43 条目没有 turnId/traceId △；trace 只有 A 侧在写（chatRun.ts:440,878）✔；B 侧 ai-calls.jsonl 只写不读（policy.ts:246-261）△；metrics.ts:78,87 用 ||1 兜底除零，消息率/错误率是假数 △；诊断包不收 trace/turns/metrics/waits △。
- **为什么是问题**：失败归因只能翻 main.log；「这 4.5 分钟花在哪」答不出来；这解释了为什么每次真机事故都只能靠人肉复现。
- **最小改法**：引入 runId（= turnId），trace/tool/审批/提案/回执/metrics 全部带上；给 runId 一个查询入口（诊断包 + CLI）。
- **优先级**：建议改。影响面：全部子域，但改动是加法。

### P1-8 记忆写入非原子 + 窗口裁剪不交代

- **证据**：historyStore.ts:416,469 收敛/截断时是 writeFile 整份重写，无 tmp+rename ✔；A 侧裁剪会生成「更早 N 条已省略」的交代（index.ts:411-412）△，B 侧直接丢掉（bot/llm.ts:156-161）△。
- **为什么是问题**：记忆是长期存活数据，重写时崩溃 = 全量历史归零；B 侧模型不知道自己在看被截断的对话。
- **最小改法**：tmp 文件 + rename 原子替换；B 侧复用 A 侧 describeDropped 文案。
- **优先级**：建议改。影响面：A/B 两侧记忆。

### P2（建议 / 可选）

| 编号 | 问题 | 证据 | 说明 |
|---|---|---|---|
| P2-1 | 机器人整段循环共用一个 20s 超时，工具无取消信号 | bot/llm.ts:408-412,47 △ | 3 轮默认配置实际不可达；超时后循环仍在后台跑（孤儿执行） |
| P2-2 | 等待/调度状态只在进程内存 | waitRegistry.ts:23-27 △ | 重启后等待链静默消失，定时可能重复/漏跑 |
| P2-3 | 权限策略是四张手写 Set + 角色两轨 | toolGuard.ts:36-95 ✔、agents.ts vs roleDomains.ts △ | 改一处会静默改变另一处语义；建议由声明生成一张策略表 |
| P2-4 | deny 是死状态 | toolGuard.ts:33,113-140 ✔ | 有分支无来源；要么加规则源，要么删掉 |
| P2-5 | 无上下文压缩，80k 硬闸直接收尾 | tokenBudget.ts:154、index.ts:819-822 ✔ | 是写明的取舍，但对「一条消息的大任务」是结构性差距 |
| P2-6 | 两套 LLM/配置/记忆链（A 与 B） | bot/llm.ts 文件头自述三个硬差别 ✔ | 结果漏斗已共用、上层未共用；抽 AgentRuntime 可消 |
| P2-7 | 角色分区不是多智能体 | agents.ts:11-14 ✔ | **不是缺陷**：单机产品收益低；唯一独立上下文是 verifierLlm |
| P2-8 | verifier fail-open、只降二次确认 | verifier.ts、ProposalCard.tsx:307 △ | 有意设计（不硬拦），但「评审无牙」要写进文档 |
| P2-9 | cron 的 DOM+DOW 是 AND 而非标准 OR | scheduler.ts:37-39 △ | 有意的简化，补一句文档即可 |

---

## 4. 与主流范式逐项对照

判定口径：达标 / 结构性 / 致命 / 优势。

| 范式 | 本仓现状 | 差距 | 判定 |
|---|---|---|---|
| **ReAct / Function Calling 循环** | A：流末聚合 tool_calls → 顺序分发 → 结果单出口回灌 → 18 轮；B：同构，默认 3 轮 | 无 | **达标**（结果漏斗做成单一出口，值得保留） |
| **Planner / Executor 分离** | 只有「只读计划阶段」（≤3 轮，默认关），无 Plan 产物、无重规划 | 计划不可断言、不可复用、不可审计 | **结构性**（P1-6） |
| **Maker-Checker / 验证者** | Verdict 类型 + 结构校验 + 可选 LLM 复核（≤2 轮，fail-open，不否决） | 评审无牙；复核工具表还混进了 run_test | **结构性** |
| **HITL / 审批** | A 侧提案 + 结构校验 + 轮次回滚（强于多数同类）；B 侧两阶段 pending；MCP 无确认 | MCP 与 write_file 是反例 | **部分优势、部分缺口** |
| **多智能体协作** | 单 agent + 角色工具子集；唯一独立上下文是 verifierLlm | — | **风格差异**（不建议补） |
| **RAG / 长期记忆** | 无检索；JSONL 短窗口；embedText 只是原语未接线 | 机器人侧无画像/无摘要 | **结构性**（B 侧） |
| **上下文压缩（compaction）** | 装载时留尾 + 轮内 80k 硬闸；无摘要、无中段压缩 | 长任务必失败 | **结构性**（P2-5） |
| **持久化工作流 / 可重放** | wait/lastFired 进程内存；无幂等键 | 重启即坏 | **结构性**（P2-2） |
| **可观测性（trace context）** | trace 有写无消费方；metrics 数据不实；无 runId | 不能归因 | **结构性**（P1-7） |
| **评估闭环** | tests/evals/agentEvals.test.ts 579 行，脚本化模型 + 真工具 + 客观断言；真机版需 EVAL_LIVE=1 且不进 CI | 有 eval，但不是回归门 | **结构性**（不是「没有」，别误判） |
| **工具协议（MCP）** | server 已接、有闸门 | 把 mutation 委托 UI 且无回执 | **结构性**（P1-3 / P1-1） |
| **能力安全（capability policy）** | 生成式能力策略 + 两进程共用守卫 + 两时点复检 | 超出多数同类 | **优势** |
| **单一注册表 + 声明↔实现闸门** | 31 定义 / 28 handler，CI 闸门钉死 | 闸门只覆盖 executeTool，不覆盖 mutation 转换 | **优势 + 一处缺口**（P1-2） |
| **Prompt 分层与预算** | P0 永不裁 / P1 / P2 + 缺口交代 + 能力索引 | 设计到位 | **优势** |

---

## 5. 哪些是致命、哪些只是风格（避免误判）

**致命（现在就有后果）**：P0-1（机器人外呼通道）、P0-2（审批可被预取绕过）。

**结构性但不必重写**：P1-1 ~ P1-8。共同形态是「同一个纪律只在一条路径上落地」——提案只在 A 侧、回执只有 noteTurn、闸门只有 executeTool、trace 只有 A 侧。

**只是实现风格（不要写进整改单）**：
- 角色 = 工具子集 + 一句话提示（agents.ts），而不是独立 agent；
- 没有向量库 / 没有多智能体 / 没有 LangGraph 式状态图；
- cron 简化语义、错误形状两种、trace 用文件而非 OTel；
- verifier fail-open 不硬拦（有意的产品取舍，写在注释里）。

**最容易被误判的三件事**：
1. 「没有审批」——错。chatRun.ts:560-566 的注释说 ask 只警告，但代码 :592-604 已真的 await 审批。✔
2. 「工具结果预算默认不生效」——错。默认走 CODING_AGENT_BUDGET，fail-open 只在 spill 写失败时发生。△
3. 「没有 eval / 没有测试」——错。532 个测试文件、agentEvals 579 行、33 个 guards 进 CI；缺的是真模型进 CI 与跨进程回执的测试（因为协议还不存在）。

---

## 6. 目标分层架构（文字描述）

```
L6 适配层      IPC(ipc/ai.ts)          MCP(mcp/server.ts)        机器人节点(agentNodes.ts)
                    │                        │                          │
L5 观测与评估  Run Ledger(runId) ── trace / tool calls / approvals / metrics / evals
                    │                        │                          │
L4 事务与写入  TurnJournal + AutoTx + GraphMutator（main 侧）  ←── 唯一写入口，带回执
                    │
L3 决策制品    Plan ── Verdict ── Proposal ── Receipt   （结构化、可断言、可 trace）
                    │
L2 AgentRuntime  Session/Transcript · ContextAssembler · Budget · Cancel · ApprovalGate · ToolExecutor · Loop
                    │                           ↑  A 与 B 共用，差异用 PolicyProfile 表达
L1 领域内核    NodeRegistry · HandlerRegistry · FlowInterpreter/controlFlow · CapabilityCatalog
                    │
L0 宿主        Electron main/renderer · 文件系统 · SQLite · 进程管理
```

**四条设计原则**（比分层本身更重要）：

1. **意图与效果分离**：工具调用的返回值必须是 effect receipt（applied | rejected | pending | failed + reason），不能是「操作已提交」这种自由文本。这一条同时解决 P1-1 / P1-2 / P1-3 与 MCP 语义。
2. **写入口收敛到 main**：renderer 只负责渲染与交互；图变更由 main 的 GraphMutator 落盘并广播。做不到全收时，至少建立双向回执协议（requestId + result）。
3. **一个真源**：审批策略、工具清单、角色能力都从声明生成（节点/工具上已有 sideEffects、category、exposedAsTool），不再维护四张手写 Set。
4. **结构优先于提示词**：plan/execute/wrap-up 用状态机表达，nudge 只是状态说明；只有「模型必须自己判断」的事才交给提示词。

---

## 7. 分阶段重构路线图

### 阶段 0：止血（1–2 天，只改判据与常量）

| 项 | 改动 | 验收 | 回滚 |
|---|---|---|---|
| P0-1 | http_request 补 sideEffects；默认工具集改显式白名单；确认判据按能力域 | 单测：默认集不含 net/write/msg 类；真机：留空 tools 的 agent 无法外呼 | 改回常量 |
| P0-2 | 预取前跑 classifyTool，ask/deny 不预取 | 新用例：run_test + read_logs 批量调用时先弹审批 | 关掉并行预取（一行） |
| P1-4 | catch 内交部分提案 | 用例：第 3 轮抛 403，仍收到 proposal + error | 保留旧分支 |

风险极低；这三项不需要动任何协议。

### 阶段 1：打通回执（3–5 天，改协议，收益最大）

| 项 | 改动 | 验收 |
|---|---|---|
| P1-1 | clientInstruction 加 requestId；渲染层回调 ai:instructionResult；主进程超时兜底 | 伪造一次写失败，模型收到 tool error、用户看到红字 |
| P1-2 | 补 write_file 转换 + ops=[] 报错 + mutation 转换闸门 | 代码页「改这个文件」→ 提案卡出现 → 应用后磁盘变 |
| P1-3 | MCP 图 mutation 转提案（复用 mcpProposal）或强制 ask | 外部 IDE add_node → 面板出现待确认提案 |
| P1-8 | writeFile 改 tmp+rename | 单测：写入中断后旧文件完好 |

**为什么排第二**：它同时消掉三处假成功，是所有后续观测与评估的前提。若只能做一件事，做这个。

### 阶段 2：结构收口（1–2 周）

1. **AgentRuntime 抽取**：把 A 的 chatRun 循环与 B 的 callBotAgent 合并成一个 runtime（Loop/Context/Tool/Budget/Cancel/Policy 五个策略点），agent_chat 退回薄适配器，processAiChat 只做参数解析与事件上报。
2. **控制流状态机**：plan → execute → wrap-up 三态，删除 4 条 nudge 中的 3 条（保留文案，降级为状态说明）。
3. **审批策略单一真源**：由工具/节点声明生成 {mode, category, sideEffects, exposedAsTool} → verdict，删掉四张手写 Set 与两轨角色表。
4. **策略记账闭环**：addDailyUsage 接线；额度要么生效要么删。
5. **翻默认值**：QQBAT_PLAN_PHASE / QQBAT_AUTO_TX 默认开——但先补齐阶段 3 的 eval 门，否则会撞现有「数事件」的用例（这正是它们现在默认关的原因）。

### 阶段 3：长期（2–4 周，按需）

1. **Run Ledger**：runId 串起 trace/tool/approval/proposal/receipt/metrics；诊断包一键导出。
2. **持久化等待**：wait/lastFired 快照到 .qqbat，恢复时校验节点存在。
3. **上下文压缩**：80k 前先做一次「摘要 + 保留最近 N 轮 + 保留所有 mutation 意图」，而不是直接终止。
4. **评估常态化**：脚本化 evals 进 CI（已是）；真模型 evals 做成夜间任务，失败只报警不阻塞。
5. **机器人记忆**：先补「裁剪交代」与「摘要」，再谈 RAG——embedText 已就位，缺的是检索与写回策略。

### 不建议做（负收益）

- 拆成多智能体（成本/延迟换不来收益）；
- 引入 LangGraph / 第三方编排框架（自研解释器已更贴合图模型）；
- 重写 ToolRegistry / capability 层（这两块是全仓最好的部分）。

---

## 8. 是否需要重写全部代码？

**不需要。**

| 层 | 结论 | 理由 |
|---|---|---|
| L1 领域内核（注册表、解释器、控制流） | 保留 | 拆分边界清楚，历史坑已修且有真解释器用例 |
| L2 Agent 循环 | **改造，不重写** | 骨架正确（可测步骤、依赖显式注入、结果单出口）；问题在判据与状态机 |
| L3 决策制品 | 补 2 个 | Plan 缺类型；Receipt 不存在 |
| L4 写通道 | **重写协议** | 单向、无回执、真源在渲染层——唯一「重写比修补便宜」的地方 |
| L5 观测 | 加法 | 缺 runId，不缺结构 |
| L6 适配层 | 保留 + 收薄 | agent_chat 内联了策略/记忆/待确认，应退回适配器 |

**什么时候才该重写**：如果产品目标变成 ① 无 GUI 的 headless 运行、② 多租户/多人协作同一项目、③ 真正的多智能体分工——那么 L2 与 L4 需要重做，L1 仍可留。当前目标（单机、单用户、低代码）下，重写是负收益。

---

## 附录 A：注释/文档漂移清单（会直接误导评审）

| # | 位置 | 注释说 | 实际是 |
|---|---|---|---|
| 1 | chatRun.ts:560-566 | ask 只发警告后照常执行，M1d 未上线 | 已真阻塞等待审批（:592-604）✔ |
| 2 | chatRun.ts:86-87 | approvedTools 未接，恒为空 | 已在 :620-625 写入 ✔ |
| 3 | mcp/server.ts:2-4 | 第一版直接执行、不经过提案 | 已有闸门 + 组合类转提案（:150-229, 232）✔ |
| 4 | tools/execute.ts:3 | 22 个工具的 switch 分发 | 已迁到 registry，execute 只剩闸门（851 行 vs 注释「~1100 行」）✔ |
| 5 | bot/tools.ts:16-19 | sideEffects 空 = 不发网络请求 | http_request 反例（P0-1）✔ |
| 6 | builtinNodes/agentNodes.ts:3 | 从 builtinNodes.ts 抽出来的消息域 | 这是 agent 域；文件头复制错了 ✔ |
| 7 | bot/llm.ts 文件头 | 第一步不传 tools | 已有 callBotAgent 多轮工具 ✔ |
| 8 | toolResultBudget.ts:329 | 默认不裁剪 | 默认 CODING_AGENT_BUDGET △ |
| 9 | toolGuard.ts:8-9 | deny 在任何模式都生效 | classifyTool 无返回 deny 的分支 ✔ |
| 10 | 工具计数（21/22/23/26/115/248） | — | 31 定义 / 28 handler / 261 能力 △ |

## 附录 B：既有评审台账（去重）

docs/ai/ 下已有五份评审（harness-review 50KB、dsh-alignment 101KB、capability-review、bot-agent、学习地图）。本次确认**仍开放**的：

1. wait 挂起表持久化（pending-design.md）；
2. 机器人侧四项：前置策略 / 记忆迁移 / 分层上下文 / 后台任务（bot-agent-architecture-from-dsh.md §五）；
3. 单循环天花板与 LLM 侦察者（harness-review §2.3#7）；
4. 进度可见性、reasoning 丢弃（dsh-alignment §12.5）；
5. 能力层真机验收（capability-review §七）；
6. 默认开关待拍板（交接-2026-10-17 §4#8）。

**本次新增**（上述文档未覆盖）：P0-1 默认工具集外呼、P0-2 预取绕过审批、P1-2 write_file 静默丢弃、P1-3 MCP 直落、P1-1 无回执协议。

## 附录 C：一句话

> 这个仓库最擅长的能力是「用结构消灭不确定性」（收窄工具表、单一结果出口、闸门钉死声明↔实现）。本次几乎所有 P0/P1，都是这条纪律**还没铺到的那几段路**——写通道、MCP、write_file、额度、观测。继续铺，不要换赛道。
