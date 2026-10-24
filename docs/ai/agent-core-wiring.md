# agent-core 接线（2026-10-18，已落地）

agent-core 的 workspace-first 循环（读/写/跑/校验）接到界面上了。本文记录**接口契约**
与**落地后的真实形状**，避免下次再重新设计、或各处各写一套。

## 1. 通道

```
ipc: ai:agentCoreRun
主进程: src/main/ipc/aiAgentCore.ts        （单独一个文件，见 §7.1）
请求: { projectPath: string; requirement: string; maxRounds?: number }   （aiAgentCoreRunSchema）
回复:
  | { ok: true; finalText: string; rounds: number;
      phase: { kind: 'idle' } | { kind: 'running'; step } |
             { kind: 'finished'; reason: 'completed' | 'max-rounds' | 'cancelled' };
      toolResults: Array<{ name: string; args: Record<string, unknown>; output: string }> }
  | { ok: false; error: string }
```

`toolResults` 里带 `args` 是刻意的：界面的工具行要显示"改的是**哪个文件**"，
只有输出看不出动作（2026-10-18 加）。

## 2. 审批（默认拒绝）

走**现有**那条链：`requestApproval` → `ai:approvalRequest` → 应用内弹窗 →
`ai:resolveApproval`。不新开一套 —— 同一个动作在两条路径上必须问同一个问题。

```
agent-core 的 kind      → 弹窗里的 toolName     args
write                   → write_file            { path: summary, ...detail }
command / irreversible  → run_command           { command: summary, ...detail }
```

语义不变：**没弹窗、没点同意、超时、取消，都不写盘**。`callId` 每轮唯一
（重复的 callId 会让上一次的等待按拒绝收掉，见 toolApproval.ts 的纪律 3）。

## 3. 取消与在飞状态

界面只有一个「停止」，所以两条链路必须都能停：

- `ai:cancelChat` → `cancelAiChat` **和** `cancelAgentCoreRun`（abort 传进循环的 signal）；
- `ai:isRunning` → 两条链路合流（漏一条 = 界面显示"没在跑"而循环还在写盘）。
- 同一项目**同时只允许一条循环**（第二条直接拒）：两条并行会各自弹审批、各自写盘。

## 4. 渲染层

- `types/ipc.ts`：`ai.agentCoreRun` 的判别联合；
- `aiStore`：`agentCoreEnabled`（默认 **false**）+ `setAgentCoreEnabled`；
  `sendMessage` 里按开关**互斥**分流（不叠加：叠加会让同一句话跑两遍、审批弹两次）；
- `ChatPanel`：输入框右侧「循环模式」开关（与「模式选择器」正交 —— 那个选角色，这个选跑哪条循环）；
- 回执 `toolResults` 映射成 `trace` 挂到助手消息上（与 `finalizeTurn` 同一形状，面板零改动）；
- 迟到的回执有**顶号**保护：停止后马上发下一句，上一轮的返回不会改新一轮的状态。

## 5. 验收

```
1. 输入框右侧打开「循环模式」
2. 说：给签到写个冷却节点
3. 期望：读文件 → 写（弹审批）→ 跑 → 报错 → 改 → validate_flow 通过 → 回答
4. 期间每次写盘都弹审批；拒绝则不落盘
5. 中途点「停止」→ 循环真的停（不再弹审批、不再写盘）
```

## 6. 回滚

开关默认 false。关掉 = 行为与接线前完全一致（旧链路一行没动）。

## 7. 落地时做的取舍（有据可查）

### 7.1 为什么单独一个 ipc 文件

`ai.ts` 接线前 793 行（fileGrowth 红线 800），而这条通道是**另一套循环**。
硬塞进去要压着红线走，正好是那条闸门要防的"没人做决定"。拆出来后 `ai.ts` 772 行。

### 7.2 还没做的（不是遗漏，是有意的下一步）

| 没做                   | 为什么现在不做                                                                          | 补的条件                                                     |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **审批规则跨轮持久化** | `always` 现在 = **本轮内**不再问该类别（§11）；跨轮要一张规则表**并且**要有撤销它的界面 | 与 `toolGuard` 的 allow 规则表一起做，同批补撤销入口         |
| **按线程分记忆**       | 载荷没有 `threadId`，循环用**默认线程**那份记忆                                         | 要按线程分就得动 schema + preload + 载荷契约三处（见 §10.3） |

（**流式**在 §9 落地、**跨轮记忆**在 §10 落地 —— 这两条原来都排在这张表里。）

### 7.3 闸门登记（改这里时四处要一起改）

```
tests/guards/ipcPayloadContract.test.ts   CONTRACTS 里 'ai:agentCoreRun' → aiAgentCoreRunSchema.shape
tests/guards/ipcReachability.test.ts      不在 UNREACHABLE_OK 里（已经真的可达）
docs/ai/ai-capability-layering-*.md       附录 A: ai.agentCoreRun = X（元域）+ 总表 ai = 42
node scripts/gen-capability-catalog.mjs   改完附录要重跑（生成物是派生物）
```

行为测试：`tests/main/ipc/aiAgentCore-ipc.test.ts`（7 例：schema 拦截、无配置、正常回执、
轮数透传、审批映射与 allow/deny、取消与单飞、收尾清登记）。

---

## 8. 真机验证（2026-10-18，接完当天）

单测全绿之后**真的跑了一遍**（打开开关 → 输入要求 → 看回执），抓到两处单测看不见的漏接。
两处都是**缺陷**，不是取舍 —— 记在这里是因为它们说明了一件事：
**假模型测不出"和真厂商的接口对不对得上"**。

| #   | 现象                                                                             | 根因                                                                                                     | 修法                                                            |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | 第一次调用直接 400：`the role in last message must be in [user, function, tool]` | `runAgentTurn` 收了 `requirement` 却**没放进对话** —— 循环从空 `messages` 起步                           | `LoopOptions.initialTurns` + `prompt.ts`（系统提示 + 用户要求） |
| 2   | 每轮都 `[工具失败] 未知工具: undefined`，跑满 12 轮                              | provider 回调的是**原始 OpenAI 形状**（`{id, function:{name, arguments}}`），类型上却声明成 `AiToolCall` | `modelAdapter` 复用 `toolMessages.normalizeToolCalls`           |
| 3   | 模型瞎猜参数名（`path` / `command`）                                             | 工具定义的 `parameters` 写死成空 `properties`                                                            | `CORE_TOOLS` 带真实 JSON Schema，适配器透传                     |

验证结果（RPG 测试项目，266 个节点）：

```
读 .qqbat/flow.json（ENOENT 的先试了一次 project.json）→ 3 轮 → completed
回执：项目名、节点数 266、37 个触发器、36 个分组 —— 与文件内容一致，全程没写盘
界面：一条 "🔧 1 次工具调用：read_file" 折叠行 + 正文，和助手那条链路同一套渲染
```

顺带确认的**性能事实**：这一轮在真机上花了约 150 秒（模型侧），
所以"循环模式没有流式"这件事在体感上很刺眼 —— 它现在是 §7.2 那张表里的第一优先级，
不是可选项。

---

## 9. 流式（2026-10-18 当天补上）

### 9.1 为什么**不新开通道**

渲染层已经有五条现成的 AI 事件通道，形状、收尾、错误分类、状态栏全都接好了：

```
ai:chunk       { projectPath, text }                           → 正文增量
ai:toolCall    { projectPath, id, name, args, status, result, timestamp } → 工具行
ai:agentState  { projectPath, state: 'thinking' | 'idle' | ... } → 状态栏
ai:response    { projectPath, message }                        → 收尾（提交正文+工具行）
ai:error       { projectPath, message }                        → 出错收尾（界面给"人话"）
```

agent-core 直接发这五条 = **渲染层一行监听都不用改**。新开通道只会多出三处登记
（载荷契约 / 可达性 / 能力台账）和一套重复的界面逻辑 —— 那是同一个问题的第二个答案。

**这份"共用"有闸门钉着**（`tests/guards/agentCoreEventContract.test.ts`）：主进程里每一条
`ai:` 事件发送（含循环的 `emit()` 包装）都必须在 preload 有监听，payload 必须带渲染层
真正要读的键（`text` / `id+status` / `state` / `message`），循环的工具事件还必须有
`name+args`。为什么单开一条：既有的 `ipcEventDelivery` 只认 `webContents.send('x'` ——
`emit('x', …)` 这种包装它**一行都扫不到**，循环发的事件其实是裸奔的。

### 9.2 循环侧的两个钩子

| 钩子                           | 位置                               | 用途                                            |
| ------------------------------ | ---------------------------------- | ----------------------------------------------- |
| `onTextChunk`                  | `modelAdapter` → `callLlm.onChunk` | 模型边吐字边发 `ai:chunk`                       |
| `onToolStart` / `onToolResult` | `runAgentLoop`                     | 工具开始先摆一行 running，结束更新成 done/error |

`runAgentLoop` 里**先报开始再执行**（连拼错的工具名也留一行），并且模型没给 `call.id`
时**当场补一个稳定 id** —— 开始/结束两条事件对不上，界面上就会多出一行永不结束的"运行中"。

### 9.3 两个不显眼但必须处理的细节

1. **轮间正文要隔开**：模型第一轮说"我先看看文件"、第二轮才是答案，直接拼起来会变成一句话。
   实现：工具开始 = 这一轮正文结束的信号，下一段正文前补 `\n\n`（只在这之前真的吐过字时补）。
2. **收尾只有一条路**：正常走 `ai:response`（渲染层把正文 + 本轮工具行合成一条消息），
   失败走 `ai:error`（渲染层 `classifyAiError` 给"人话"并收尾）。
   渲染层的 `runAgentCoreTurn` 只在**一条事件都没来**时才退回"跑完一次性回执" ——
   否则同一条回答会被提交两遍。

### 9.4 实测

```
发出去 2.5s：界面上已经有 "读取 / 读取 667 行 / .qqbat/flow.json" 这一行
            （以前：只有计时器在跳，150 秒里什么都看不到）
20s  ：正文开始流式出现
结束 ：工具行折叠成 "▶ 2 次工具调用：read_file ×2"，输入框回到「发送」
```

---

## 10. 跨轮记忆（2026-10-18 当天补上）

### 10.1 记忆就是助手那一份，不另起

循环读写的是**同一个** `.qqbat/ai-history.jsonl`（助手那条链的记忆文件）：

- 用户眼里只有"这个助手" —— 换个模式就失忆是最难解释的体验；
- 那份文件已经有**撕裂尾帧处理 / 按字节收敛 / token 预算裁剪 / 格式版本**，
  再写一份就是把踩过的坑重踩一遍（本仓库为"同一件事抄两份"付过多次代价）。

### 10.2 顺序（错了会重复）

```
读旧记忆 → 把这一轮的要求记下来 → 跑循环 → 把答案记下来
```

先读后写：反了的话本轮要求会在上下文里出现**两次**（一次当历史、一次当新要求）。
答案为空（没吐字）就不写 —— 存一条空 assistant 只会让下一轮看到一段莫名其妙的白。

预算沿用 `historyToMessages`（token 预算 + 保尾部 + `describeDropped` 交代省略），
被裁掉时把那句交代拼进**系统提示**：模型得知道"我不是第一次对话"，而不是以为自己失忆了。

### 10.3 线程（与助手共用同一个选择器）

`ai:agentCoreRun` 现在带可选的 `threadId`（白名单与 `ai:chat` 同一份）：
传了就读写**那条线程**的记忆文件（`threadFile` → `.qqbat/ai-history/<id>.jsonl`），
不传 = 默认那份老文件（升级前的历史不丢）。

界面侧边栏本来就有线程选择器，循环模式与助手共用它 ——
**「在这条对话里继续」对两种模式是同一件事**。

### 10.4 实测

```
第 1 轮：记住一个暗号：紫色海豚 → "收到"（1 轮，无工具）
第 2 轮：我刚才让你记住的暗号是什么？→ "紫色海豚"（1 轮，无工具）
文件里多出四行：user/assistant × 2，与 10-15 那些助手对话记录**在同一份文件里**
```

---

## 11. 审批的「别再问」：从"只在一轮内"做到真跨轮（2026-10-18）

### 11.1 原文案是过度承诺

按钮上写着「批准，**以后**别再问」，而两条链路都只做到"**本轮内**别再问"：

- 助手链路：`chatRun` 把工具名记在 `state.approvedTools`（本轮有效）；
- 循环链路：之前**一条都没记** —— 10 轮里改 10 个文件就要点 10 次。

现在的取舍是**把行为做到，而不是把话改小**。

### 11.2 规则表：按"动作"匹配，不按工具名

规则落盘在项目内 `.qqbat/ai-approvals.json`（`services/ai/allowRules.ts`）：

| kind      | match                     | 为什么                                                           |
| --------- | ------------------------- | ---------------------------------------------------------------- |
| `write`   | 项目内**相对路径**        | 存绝对路径的话，项目一搬家规则全失效；而且界面上难读             |
| `command` | **整条命令行**            | `run_command` 名字太宽：`pnpm test` 与 `git push` 是两种事       |
| `tool`    | 工具名 + **排序后的参数** | 助手侧的 `run_bot`/`run_test` 走这一类；参数顺序不同算同一个动作 |

上限 50 条（先按时间淘汰最旧的）；去重；**读不出来一律当"没有规则"**（退化成每次都问，
最安全的一侧）—— 审批这条路上不能因为一张便利表而把整轮对话挡死。

### 11.3 撤销口（没有它就不该有这张表）

三个通道 + 面板里的一块：

```
ai:getAllowRules    看        → ChatPanel「已记住 N 个动作」折叠区
ai:removeAllowRule  删单条    → 每条右边「删掉」
ai:clearAllowRules  全部清空  → 「全部清空（以后每次都问）」」
```

点过「以后别再问」之后，这些动作**不问就直接执行** —— 用户必须看得见、删得掉。
这与 `bot/policy.ts` 那条原则同源：默认开着却改不了的层，没人能判断它是对是错。

### 11.4 顺带补上的一个真洞：命令之前**不过闸**

做这一条时发现：循环里 `run_command` **从来没有审批** —— 只有写文件过闸。
而白名单里的 `git`/`npx` 能做的事比写文件更多（`git push`、`npx <任意包>`）。
现在命令也过闸（`kind: 'command'`），与写文件同一套弹窗、同一条"别再问"规则表。

测试：「跑命令也要过闸门」——拒绝时**根本不执行**（用 `node -v` 证明没跑）。

---

## 22. 失败尝试留痕（2026-10-18，对齐 assistant/attempt）

运行失败或被取消时，往**记忆日志**追加一条 `role: 'attempt'` 的记录（带 `reason: error|cancelled`、
`ok: false`）。它**不进模型历史**：`historyToMessages()` 在预算裁剪**之前**过滤掉 attempt ——
失败尝试不该占记忆预算，也不该被模型当对话内容记住。

为什么需要：以前失败只发 `ai:error`，界面一关、应用一重启，"上次为什么没做完"就查不到了。
现在日志里留着（`readHistoryForUi` 能读到），下一轮排查不用靠猜。

边界：

- **界面**：`loadHistoryFromDisk` 读到"最后一条是 attempt 且后面没有新对话"时，在输入框上方
  挂一条黄色提示（"上次运行失败了/被取消了：原因"，可关闭）。它不是对话气泡 —— 它不是谁说的话；
- 只在**运行失败**时写（正常收尾不写）；写失败只记 warn，绝不影响错误上报；
- 被取消（stop / AbortError）记 `cancelled`，与真失败区分；
- 老版本读到 attempt 行：`loadHistory` 对未知 role **跳过**（容错），降级使用不会炸；
  普通对话行**不带** attempt 字段（有测试钉住）。

## 21. 工具结果契约与超时（2026-10-18，对齐 dsh-tools 管线的两小块）

上游 `ToolDefinition` 的完整形态（canonical output + render + presentationMeta + timeoutMs +
isConcurrencySafe + pre/post waterfall）在我们这里只抄了两块**现在就有消费者**的：

### 21.1 结构化结果：`{ text, ok? }`

`Tool.run` 现在可以返回字符串（老形态）或 `{ text, ok }`。以前成败靠
`startsWith('[工具失败]')` 猜 —— 工具正常返回一句恰好以它开头的话就会被当成失败。
现在**显式 ok 优先**，没给才回退前缀（兼容老工具与老测试）。

链路：core 归一化 → trace 记 ok → `onToolResult(call, text, ok)` → 界面工具行按 ok 上色。

### 21.2 单工具超时：`Tool.timeoutMs`

模型点了一个会挂住的工具（网络、死循环、等一个永远不来的事件）时，以前只能靠用户点停止。
现在超时按失败返回 `[工具失败] 工具超时（Nms）`，整轮继续收尾。

### 21.3 没抄的（诚实清单）

- **canonical output schema + render**：我们的工具结果就是文本，没有"先校验结构化值再渲染"；
- **UI 呈现器**（presentCall / presentResult）：界面靠约定俗成的 args 读；
- **并发安全标记**：循环目前串行执行工具，标了也没有消费者（等真做并行再补）；
- **pre/post waterfall**：只有 `onToolStart/Result` 两条观测，没有"拦截并改写"的钩子。

**为什么只抄这两块**：上游那套是为"多消费方复用同一工具结果"设计的；我们只有一个消费方（一个模型

- 一个界面），先把**成败语义**和**卡死**这两个真问题解决，其余等有第二个消费方再说。

## 20. 「先计划」模式（2026-10-18，对齐 dsh-plan 的最小可用形态）

界面上「循环模式」旁边多一个「先计划」（只在循环模式出现）。打开后这一轮：

1. **工具集裁到只读**（`category: 'query'` 的四个：read_file / list_dir / search_text / validate_flow）——
   `write_file` 与 `run_command` **不在列表里**，模型调到只会得到"未知工具"。
   类别是 `Tool.category`，与旧链路 `AiToolDefinition.category` **同一套词汇**（迁移时逐字段映射）；
   **缺省视同 mutation**：新工具忘标类别，它在计划轮里就是不可用 —— 安全侧失败。
2. 系统提示追加一段计划说明（`prompt.ts` 的 `PLAN_ONLY_NOTE`），要求产出目标/步骤/风险。

**两层约束缺一不可**：只靠提示词写"不许写盘"，模型多试两次就绕过去了；只裁工具不交代任务，
模型会以为自己坏了。所以提示词说"要什么"，工具集保证"做不了坏事"。

排在后面的轮次（轮循环的 `turn` 队列）沿用同一个模式 —— 用户是按这个模式发的。

不做的东西：没有独立的"计划 → 批准 → 执行"状态机。用户看完计划，关掉「先计划」再发一句
"照这个做"即可 —— 比造一个跨轮状态机简单得多，而且执行阶段走的仍然是**有审批的正常路径**。

### 20.1 对齐盘点里的位置

DSH 的 `dsh-plan` 是一个可注册的**阶段插件**（planning → executing 的状态迁移由插件自己的
状态机负责）。我们只做了"计划轮次"这一半：能产出计划、物理上不能动手；没有状态机、没有
"计划被批准后自动进入执行"的迁移。所以盘点里 `plan` 一行从"缺/不同"改成"同构简化（仅计划轮次）"。

## 19. 轮次投影（2026-10-18，对齐 session-projection 的最小一块）

一轮到底发生了什么，以前要三处各查一遍：轮次日志（改了哪些文件）、trace（跑了哪些工具）、
轮次元信息（那句话是什么）。现在收进一份投影：

```ts
TurnProjection {
  id, startedAt, userMessage,
  files: [{ path, change: 'created' | 'modified' }],
  tools: [{ name, ok, ms }],
  stats: { fileCount, toolCount, failedTools, ms },
}
```

消费者：`ai:listTurns` 现在返回**投影**（多带 files / tools / stats），渲染层按需取用。

两处必须一起修，否则投影里永远是空的：

1. **trace 要带 `turnId`**：循环自己不知道"这是第几轮"（一次调用可连续跑多轮），
   由 ipc 层的 trace 回调补上 —— 契约层不反向依赖轮次日志；
2. **trace 要带真实耗时**：以前工具事件的 `ms` 写死 0，投影里的"耗时"就成了摆设；
   现在按工具实际执行计时。

真机验证：写一轮 `projection-test.txt`（批准一次）后，`listAiTurns` 第一条就是
`files:[{projection-test.txt, modified}]`、`tools:[write_file 1593ms, read_file 1ms, …]`；
撤回这一轮 → 文件回到 v1。投影里**不带文件原文**（还原只有一个入口）。

### 19.1 视图层现在读投影了（2026-10-18 同日）

「本轮改动」卡以前是 `listAiTurns` 拿轮次 id、再 `previewAiTurn` 算一遍行数 —— **同一件事两处各算**。
现在页面只读投影（一次 `listAiTurns`）：文件 + 行数 + 工具次数/失败数/耗时全在里面。
卡片因此多了一行 `N 次工具（M 次失败） · X.Xs`。

⚠️ 真机踩到的顺序坑（已修）：渲染层收到 `ai:response` 会**立刻**去读投影刷新卡片 ——
所以主进程必须**先 `endTurn()` 落盘、再发 response**。原来是先发 response 再 endTurn，
那一瞬间轮次文件还不存在，卡片查不到就当"没有改动"（用户看到的是一次成功的写却没有卡片）。
现在的顺序固定为：写记忆 → 收轮次（落盘）→ response / idle。

### 19.2 还没做的（投影层）

- 只投影**有改动的轮次**（轮次日志本来就只落这类；"查资料"的轮次不落盘）；
- 没有"可合并投影表"：DSH 能按需组合消息/工具/文件/统计，我们目前只有这一份投影，
  且消费方只有 listTurns —— 视图层还没改成读投影；
- 没有回放：投影是"看一下"，不是"重放一遍"。

## 18. 系统提示分段 + 沙箱提供者（2026-10-18，对齐 dsh-system-prompt / dsh-sandbox）

两件"缝"同批做了，都是**给以后换实现留口**，不是现在就多一个实现：

### 18.1 系统提示：段落注册

```ts
registerPromptSection({ id, order, render(ctx) })  // id 唯一、非法 id 直接拒
buildSystemPrompt(workspace)                        // 按 order 组装，空段落跳过
```

内置三段：`role`（工作区）/ `tools`（**从工具注册表取**）/ `rules`（六条规矩）。

为什么 `tools` 必须从注册表取：手抄一份工具清单，加了工具忘了改提示 —— 模型会以为它没有那个能力。
加一句项目约定（"包管理器用 pnpm"）现在是注册一段，不用改函数。

### 18.2 沙箱：提供者契约

```ts
SandboxProvider { name, run({command, cwd, timeoutMs}) }
localSandbox        // 白名单 + 禁元字符 + 超时 + 不走 shell（默认）
setSandboxProvider() // 换实现；null 恢复默认
```

循环只调 `runInSandbox()`。白名单与禁元字符**留在本地实现里**，不抬到契约层 ——
换沙箱不代表规则一样（容器里可以放开，受限账户可能要更严）。

测试证明：换一个假提供者后，`runCommand`、`run_command` 工具、循环里的工具调用**全都走它**，
循环一行没改。

> 注：`setSandboxProvider/getSandboxProvider` 目前在 deadExports 里登记为"缝"（生产暂无第二实现），
> 接容器时删掉登记。

## 17. 轮次日志与撤回（2026-10-18）

循环现在和助手链路**共用同一个 `turnJournal`**：每轮开始 `beginTurn()`（顺带快照 flow.json）、
写盘前 `recordFileBefore()` 记下文件原内容、收轮 `endTurn({hadChanges})` 落盘到
`.qqbat/history/turns/`。

为什么这是硬需求：循环会自己写文件，**写完却退不回去**是硬伤。接口、预览、撤回按钮全是现成的
（`ai:listTurns` / `ai:previewTurn` / `ai:rollbackTurn`），差的只是循环这边"记账"。

刻意的两条边界：

- **只有 `write_file` 记 before**：`run_command` 的副作用（git、构建产物）不记 ——
  做不到就不假装做得到；这种轮次会在列表里显示"改过"，但撤回只会还原**它记下的**文件；
- **写被拒（审批 deny）不记 before**：没发生的改动不该出现在撤回清单里。

真机验证：循环写 `rollback-test.txt`（审批点"批准"）→ `listAiTurns` 里出现这一轮
（`fileCount: 1`）→ `rollbackAiTurn` 返回 `removed: ["rollback-test.txt"]` → 文件确实没了。

### 17.1 这和"投影"差在哪

DSH 的 `session-projection` 是一张**可合并的投影表**：消息、工具、文件改动、运行统计各自是
一个投影，视图按需组合。我们的 `turnJournal` 只覆盖"文件改动"这一份投影，而且是给撤回专用的。
所以对齐盘点里"投影"仍标**缺** —— 这次补的是"撤回的依据"，不是"投影层"。

## 15. 工具注册表（2026-10-18，对齐 dsh-tools 的"缝"）

循环不再认具体的工具数组，只认一张表：

```ts
registerTool(tool) // 名字必须小写 snake_case、必须有 description、不许重名
listTools() // 循环默认从这里取（opts.tools 显式传参仍然优先）
```

内置的 6 个在模块加载时注册。要加工具（业务侧 / 测试 / 以后的插件）**不用改循环** ——
测试里那条 `echo_tool` 就是证明：注册之后，循环不认识它也能调通。

**现在只是缝，还没拆文件**：工具定义仍在 `core.ts` 里（那个文件 640 行，离 800 还有距离）。
等它接近红线时，把实现搬去 `tools.ts`、这里只留注册表 —— 契约不变，调用方一行不用改。
这件事写在这里是为了让下一个人不用重新判断"该不该拆"。

## 14. 中途插话（steering，2026-10-18）

循环跑到一半时用户想纠偏（"别改那个文件""先跑测试"）。以前只有两条路：等它跑完，或按停止
（把整轮作废）。现在加了一条：**插话** —— 不新开一轮，塞进**正在跑的**那一轮。

### 14.1 语义（对齐 DSH 的 inbox/next-step）

```
ai:agentCoreSteer  { projectPath, text }
  → 主进程把 text 放进该项目的插话队列（内存）
  → 循环每到一个**步边界**取一条，作为 [用户中途插话] 注入对话
  → 同时写进记忆（下一轮模型才知道用户中途纠偏过）
```

与「排队下一句」的区别说清楚：

|          | 插话（本节的）                                 | 排队下一句（原有）     |
| -------- | ---------------------------------------------- | ---------------------- |
| 生效时机 | **当前这一轮**的下一个步边界                   | 这一轮结束之后的新一轮 |
| 主进程   | 同一次运行内                                   | 新的运行               |
| 界面     | 输入框旁「插话」按钮（跑着且输入框有字时出现） | 普通「发送」           |

### 14.2 三条硬规矩（都有测试钉着）

1. **没在跑就拒**：主进程返回 `{ok:false}`，界面 toast 提示"直接发送" ——
   最糟的体验是"以为说进去了，其实躺在队列里等下一次运行"。
2. **没赶上不静默丢**：这一轮结束时队列里还有剩 → 发 `ai:warning`，
   把那几句原样念给用户听。
3. **插话进记忆**：注入时写一条 `[插话] …` 进记忆文件；否则下一轮模型以为
   用户中途什么都没说过。

### 14.3 两级队列（2026-10-18 补齐）

现在两个目标都有了，对应 DSH 的 `next-step` / `next-turn`：

| 目标           | 行为                                                       | 界面     |
| -------------- | ---------------------------------------------------------- | -------- |
| `step`（默认） | 下一个步边界注入**当前这一轮**                             | 「插话」 |
| `turn`         | 这一轮结束后**自动作为新的一轮**开始（一次调用连续跑多轮） | 「排队」 |

队列**落盘**（`.qqbat/agent-inbox.json`）：`step` 每次启动时清掉（上一轮的插话已过期），
`turn` 从盘上读回来接着跑 —— 应用崩了，用户排的那句也不会丢。

### 14.4 与 DSH 还差的一点

DSH 把队列存进 **session 事件流**（`agent/inbox/spliced`，带 start/removedCount/inserted 的
splice 语义），所以有完整历史、能回放、能校验"同一 id 不许重复排队"。
我们是一个独立 JSON 文件 + 数组操作：**够用，但没有历史**。
等做投影那一层时，这两份数据（history + inbox）应该合成一条事件流 —— 而不是再加第三个文件。

## 12. 工具集（2026-10-18 补了两个"找东西"的）

| 工具            | 只读？     | 用途                                                           |
| --------------- | ---------- | -------------------------------------------------------------- |
| `read_file`     | 是         | 读全文                                                         |
| `write_file`    | 否（过闸） | 整文件覆盖                                                     |
| `run_command`   | 否（过闸） | 白名单命令                                                     |
| `validate_flow` | 是         | 校验 `.qqbat/flow.json`                                        |
| `list_dir`      | 是         | 列目录（子目录带 `/`，跳过 node_modules/.git/dist/out/.qqbat） |
| `search_text`   | 是         | 按正则搜文本，返回 `文件:行号: 内容`，可加 `glob` 过滤         |

为什么要补后两个：只有 `read_file` 的时候，"X 定义在哪"只能一个个文件读 ——
这既是模型最常干的事，也是上下文烧得最快的地方。补上之后同一件事一次调用就够。

几处刻意的边界：

- **glob 很小**：`*` 不跨目录、`**` 跨、不含斜杠时只比文件名（与主流习惯一致），不引依赖；
- **正则写错不算工具失败**：把原因原样还给模型，它自己会改；抛异常只会白烧一轮；
- **有上限**：列目录 200 条、搜索命中 80 行、单文件 512KB、最多扫 4000 个文件 ——
  不给模型灌一屏（那和没给一样）；
- **只读也要过路径沙箱**：`list_dir('../')` 同样被拒。

### 12.1 工具结果的上下文预算（同批补的）

一个 3000 行的文件 ≈ 30k token，**一次 `read_file` 就能把上下文撑爆**，而模型的反应不是报错，
是开始胡说 + 忘掉前面的约束。以前循环这条路是裸的（助手链路早有 token 预算与溢出）。

现在的口径：**回灌给模型的单个工具结果上限 24k 字符**（≈8k token），超了就
**先把完整内容落盘**（与助手链路同一个 `spillStore`、同一个 `.qqbat/ai-spill/` 目录），
再给"头尾 + 路径 + 怎么读回来"；`toolResults`（界面/诊断）里仍是**原始**输出 ——
工具行要按真实行数统计，不能拿节选冒充。

配套的三件事缺一不可（缺哪件都会让那句指引变成谎话）：

1. **read_file 支持 `offset`/`limit`**：不然"分段读那份溢出文件"根本做不到，
   再读一次还是整份、还是被裁；
2. **search_text 能搜到 `.qqbat/ai-spill/`**：`.qqbat` 整体跳过是对的（state/记忆不该被瞎翻），
   但"去看这份溢出文件"是节选里明写的出路 —— 所以对 `ai-spill` 单独放行；
3. **fail-open**：落盘失败时**不裁**（原文给模型）。"没有出路的省略"比"上下文大一点"更糟 ——
   这条与 `spillStore.ts`、与 DSH 的 spill-policy 是同一条规则。
   例外：完全没有溢出存储的调用（脚本/测试）按上限裁，并如实说"这次没保存"。

## 13. 删掉的：`sessionLog`（会话事件日志层）

最早复刻主流 harness 时写过一层「只追加的事件日志」（seq / restore / fork），
**一直只有测试在用**。这轮删了，理由：

- 记忆的单一真源已经是 `.qqbat/ai-history.jsonl`（§10）；再挂一套日志 = 两份真相源；
- 工具事件的观测已经由 `trace`（`appendTrace`）落盘，不需要第三个写者；
- "写好了没接线"正是本仓库反复清理的中间态 —— 留着它比删掉更费人：下一个人要重新判断
  它到底该不该接。

要回放 / 分叉的话，正确做法是给 **history + trace** 这两份现有数据加读侧能力，
而不是再造一份写侧。

## 23. 循环内上下文压缩（2026-10-24，对齐 DSH 的 compaction）

§10 的跨轮记忆是**两次对话之间**的事；§12.1 限制的是**单条工具结果**的大小。
两件事都做了，循环**内部**仍然只增不减：每跑一次工具就多一条输出，12 轮 × 24k 字符
足够撑爆任何窗口 —— 而撑爆时厂商不会礼貌报错，它要么 400，要么悄悄截掉最前面那段
系统提示（那意味着模型开始忘了自己在改哪个项目）。

现在每轮**问模型之前**过一道闸门（`src/main/services/agent-core/contextGate.ts`）：

| 边界         | 规则                                   | 为什么                                     |
| ------------ | -------------------------------------- | ------------------------------------------ |
| 头部系统提示 | 永远保留 index 0                       | 那里是项目规则与路径                       |
| 任务那句     | 保住紧随系统提示的那条 user            | 90 字确定性摘要顶不上需求原文              |
| 尾部         | 保留最近 `keepRecentTurns`（默认 8）条 | 正在进行的推理链不能半剪                   |
| 中段         | 压成**一条 system 注记**               | 注记里写明「摘要非原文，要细节请重读文件」 |

- **就地 splice，不换数组**：调度器与调用方拿着同一个 `messages` 引用，换新数组会出现两份对话；
- **估 token 不再用 `length/3`**：ASCII 按 4 字符≈1 token、非 ASCII 按 1 字符=1 token，
  旧的除法对中文低估约 3 倍，预算永远对不上（`makeContextService` 也改成同一口径）；
- **摘要两档**：`QQBAT_CONTEXT_SUMMARY=model` 时先用模型（`makeTurnSummarizer`），
  抛错/空就退回确定性摘要 —— 压缩是每轮都要走的路，模型服务抖一下不能让整轮报错；
- **没有孤立工具结果的风险**：这个循环不把带 `tool_calls` 的 assistant 回合放进 `messages`
  （结果就是一条纯内容），所以不存在"结果配不上调用"；真正的风险是任务那句被压掉。
  这条也是最初设计走过弯路的地方：按"保留区不许以 tool 开头"往回让，会让 `dropped` 恒空、
  **压缩永远不触发**，只有测试能抓住它。

阈值与助手链路同源：`AUTHOR_PROFILE.conversationTokenBudget`（80k）。接线在
`src/main/ipc/aiAgentCore.ts`（`compaction.budgetTokens` + `onCompact` 打日志）。
同时把"单个工具结果给模型看多少"从 `core.ts` 拆成了 `toolOutput.ts`（`clampToolOutput` /
`modelFacingOutput`）：那是**策略**，和循环控制无关，拆分后 core 离 800 行红线也更远。
测试：`tests/main/services/agent-core/contextGate.test.ts`（16 例，含"就地改同一数组"）与
`loopCompaction.test.ts`（4 例，跑真循环看 messages 峰值回落、系统提示与任务句仍在）。

**还没做**：压缩发生时界面上没有提示（现在只有主进程日志）。要做就得开一个新事件并在
`tests/guards/agentCoreEventContract.test.ts` 的 emit 清单里登记，别偷偷加。

## 24. 角色进循环（2026-10-24，对齐 DSH 的 agent-preset）

**此前这里有个断层**：界面上四个角色按钮（流程助手 / 代码助手 / 双向 / 创作）只对**助手链路**
（`services/ai/index.ts`）生效，而项目一打开、正常的对话全走**循环链路** ——
于是"切了角色"在循环里等于没切：界面在演，主进程没接。

现在两条链路共用同一份映射（`src/shared/ai/roleDomains.ts` 是唯一真源），角色在这一轮干两件事：

| 层   | 落点                                             | 说明                                                          |
| ---- | ------------------------------------------------ | ------------------------------------------------------------- |
| 提示 | `runTurn` 的 `roleNote`                          | 角色强调句 + 预设附加要求，插在 `planOnly` 之后、历史交代之前 |
| 写域 | `approval` 回调最前面的闸                        | 按**路径**判，不按工具名                                      |
| 预设 | `.qqbat/agent-presets.json` 的 `role` / `prompt` | 预设显式写死优先于"跟着页面走"                                |

### 为什么写域按路径判，不能套工具白名单

循环的工具表是**通用文件族**（`read_file` / `write_file` / `run_command` / `validate_flow` /
`list_dir` / `search_text`）—— 拿 `AGENT_TOOLS` 那张按名字列的白名单来滤，会把整张表滤空。
所以边界落在**写盘的路径**上：`domainOfProjectPath` 把项目内相对路径归到与能力层同一套词
（界面 / 代码 / 数据 / 对外 / 观测 / 内部 / 工程），再由 `mayRoleWritePath` 判。

- `builder`：能写 `.qqbat/flow.json`、面板/模板、`data/`、工程文件；**不能**写 `src/`、`plugins/`、代码扩展名；
- `coder`：反过来 —— 能写代码，**不能**写 `.qqbat/flow.json` 与面板/模板；
- `duo` / `creator`：两边都放行。

归类刻意**粗**：新增一类目录时宁可先落进"工程"（共享），也不要造一张永远对不齐的大表。

### 越界为什么是 throw，不是 return false

`scheduler.ts` 的 `executeToolCall` 会 `catch` 所有异常并变成 `[工具失败] <message>` 回灌给模型；
而 `return false` 只得到一句"未通过闸门"。前者能带上"这是谁的活、怎么才能做"
（`rolePathBoundaryMessage`，含"不要换个路径再试"），模型才有可执行的下一步。

同理，越界**连弹窗都不弹**：让用户点"允许"来绕过角色边界，等于边界不存在。

### 四段强调句是给助手链路写的，循环里要补一句

`AGENT_ROLE_HINT` 的原文按**助手链路的工具名**写（`write_code` / `add_node` / `connect_nodes`…）：
「不要改源码文件（write_code / write_file 不在你的工具里）」。循环手上却是通用文件工具 ——
不补一句，模型要么以为 `write_file` 根本不存在，要么反过来不知道自己还有写域限制。

所以循环在角色说明与预设 `prompt` 之间还插一句 `LOOP_ROLE_GATE_NOTE`（`ipc/aiAgentCore.ts`）：
界面域 = `.qqbat/flow.json` 与面板/模板，代码域 = `src/` / `plugins/` / 代码文件，越界在弹审批前就被拒。

### 预设字段

`.qqbat/agent-presets.json` 在原有的 `allowedTools` / `plugins` 之外多两个字段：

- `role`：写死这一轮的角色（缺省 = 跟着页面走）。值不认识就当没写 —— 拼错不该让整条预设失效，也不能猜；
- `prompt`：这一轮的附加要求，接在角色说明后面（`PROMPT_MAX=2000`，超长截断）。

⚠️ 预设**只在循环链路解析**（`ai:agentCoreRun` 的 `preset` 参数）。助手链路（`ai:chat`）不读
`agent-presets.json`：它按页面角色 + 调用方传的 `allowedTools` 跑。这个差异是**有意的** ——
但界面上预设下拉在两条链路都显示，所以用户切了预设却发现助手那条没反应是可能的。
哪天要合，得先给 `ai:chat` 载荷加 `preset` 字段（那是 IPC 契约变更，要同步 preload / 渲染层 / 契约测试）。

`prompt` **只在提示层**，不是权限边界 —— 边界看 `allowedTools` / `plugins` / 角色写域三道闸。

测试：`tests/shared/ai/roleDomains.test.ts`（路径归类表 + 四角色矩阵 + 越界说明）、
`tests/main/ipc/aiAgentCore-ipc.test.ts`（builder 写 `src/` 被拒且不弹窗、coder 写流程被拒、
roleNote 透传与预设覆盖）、`tests/main/services/ai/presets.test.ts`（role/prompt 读写归一）。

**还没做**：`roleNote` 只进系统提示，界面上没有"当前角色已生效"的痕迹 —— 用户切了角色，
唯一能感知的地方是他自己读提示词。要补得先在 `agentCoreEventContract` 登记新事件。

## 25. 循环入口的两个「传了没读」开关（2026-10-25）

`schema` 收着 `planFirst` / `fullAccess` / `images` / `activeFilePath` 四个字段（注释就写着
「少收一个字段就等于静默丢功能」），而 `aiAgentCore.ts` 的 handler **一个都没读过** ——
界面按下去没反应，主进程照旧跑。这一节记补上的两个；`images` 与 `activeFilePath` 见 §26
（同一族问题的第二批，外加预设的 `permissionMode`）。

| 开关         | 落点                              | 语义                                                               |
| ------------ | --------------------------------- | ------------------------------------------------------------------ |
| `planFirst`  | `runTurn` 的 `planOnly`           | 提示追加 `PLAN_ONLY_NOTE`，**且**工具表只留 `category === 'query'` |
| `fullAccess` | `approval` 回调里、角色闸**之后** | 跳过「问人」，不跳过角色写域，也不写 `allowRules`                  |

### 为什么完全权限排在角色闸后面

顺序反过来就等于「点一下完全权限，角色边界消失」。写域闸是**角色的**边界，不是审批策略；
用户开关的是"要不要每次都问我"，不是"要不要受角色约束"。同理它也不落 `allowRules`：
界面文案就是「完全权限（本次运行）」，一次开关不该永久改变别的轮次的审批行为。

### 预设的工具表以前算完就丢

`turnTools`（注册表全量 → 插件集 → 白名单）在 handler 里算了很久，却从没交给 `runAgentTurn`：
选了预设照样拿全量工具，「权限配置」只在界面上好看。现在接通了，并且**系统提示里的可用工具
也换成同一份**——提示按注册表全量广告、模型照着调过去却是「未知工具」，一轮就白烧。

`runTurn` 因此把工具表**先算一次**（`effectiveTools`），提示与 `runAgentLoop` 共用；
`buildSystemPrompt(workspace, extraTools, { tools })` 的第三个参数传了就不再并注册表全量。

### 测试

- `tests/main/ipc/aiAgentCore-ipc.test.ts`：`planFirst` → `planOnly === true`（没开则不带键）；
  `fullAccess` 下 command / 界面域写盘直接放行且不弹窗、但 builder 写 `src/` 仍被拒；
  `allowedTools: ['read_file']` → 交出去的工具表只有这一项，没裁则不带 `tools` 键。
- `tests/main/services/agent-core/runTurn.test.ts`：工具表被裁后提示只广告裁过的那些、
  越界工具得到「未知工具」且文件没被写；`planOnly` 的提示里不再出现 `write_file`。

**还没做**：界面上仍然看不出「完全权限已生效」与「预设裁掉了哪些工具」（`images` /
`activeFilePath` 已在 §26 补齐）。

## 26. 剩下那三处「传了没读」（2026-10-25）

§25 补的是两个**开关**，这一节补剩下三处**数据**：贴图、当前打开的文件、预设的审批口径。
共同点是同一族问题：渲染层一路传到了 IPC、schema 也收着，断在主进程 handler 这一环。

| 字段                         | 断在哪                                                         | 现在落到哪                                                                             |
| ---------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `images`                     | `aiAgentCore` 从来没读过；循环的消息类型里也根本没有"图"这个位 | `ChatTurn.images` → `modelAdapter` → `ChatMessage.images` → provider 的 `apiContentOf` |
| `activeFilePath`             | 只有助手链路（`services/ai/index.ts`）读了                     | 循环的 `roleNote` 末尾（`activeFileHintFor`）                                          |
| `AgentPreset.permissionMode` | schema / preload / 渲染层都有，**服务层类型里没有这个字段**    | `presets.ts` 读写归一 + `approval` 的 `effectiveFullAccess`                            |

### 贴图：provider 早就支持，断在 ChatTurn 这一层

这一条值得单独说，因为**它不缺逻辑、缺的是类型**：`shared/types/ai-provider.ts` 的
`apiContentOf` 本来就会把 `ChatMessage.images` 翻成多段 content（`text` + `image_url`），
`tokenBudget` 也早把每张图按 1000 token 计入。唯独循环自己的 `ChatTurn` 没有 `images`
这个字段 —— 于是 `runTurn` 收到 `input.images` 也无处安放，只能默默丢掉。

所以这一轮的改动是**一路加位**而不是加逻辑：

- `ChatTurn.images?: readonly string[]`（`agent-core/core.ts`）；
- `RunTurnInput.images` → 只放进**第一轮**的 user 回合（`runTurn.ts`）；
- `modelAdapter` 原样转给 `ChatMessage`（空数组不写这个键 —— 写了等于告诉 provider
  "每条消息都带图"）；
- `contextGate.estimateTurns` 把图按 1000 token/张计入（与 `ai/tokenBudget` 同口径，
  但**不 import** 那个模块：循环不该为了一个常数把助手链路整包拉进来）。

**图只属于那一句**。循环里排队进来的下一句、或者插话续跑的那一轮，都不该把上一张图再发
一遍：贵（1000 token/张）而且会误导模型"新问题也配着这张图"。所以 handler 里是
`let pendingImages = images` + 每轮开头 `turnImages = pendingImages; pendingImages = undefined`。

记忆里只留一句（`withImageNote`，与助手链路逐字一致）：`（附了 N 张图，仅那一轮可见）`。
图本身**不落盘** —— 一张截图 base64 就几 MB，会撑爆 1MB 上限的 JSONL。

### 当前打开的文件：只对 coder / duo 说

`activeFileHintFor` 从 `services/ai/index.ts` 搬到了 `services/ai/promptHints.ts`（连同
`withImageNote`），原因是**加载面**：循环入口要它俩，而 import `services/ai/index.ts`
会把工具注册表 → 流程解释器 → 提案校验整条链拉进循环和它的单测。

规则没变（低代码/创作角色返回空串；空、绝对路径、带 `..`、含换行/反引号、>300 字符、
磁盘上不存在 —— 一律返回空串：提示里宁可不提，也不能提错）。

### 预设的 permissionMode：显式表态优先

`effectiveFullAccess = fullAccess ?? (preset?.permissionMode === 'full')`。

- **调用方显式 true/false 优先**，只有 `undefined` 才让预设补位。渲染层那边配合的正是这一条：
  界面开关关着时传 `undefined` 而不是 `false`（aiStore 的注释写过这个意图，只是主进程没接）。
- 语义与开关完全一致：只对**这一次运行**有效，不写 `allowRules`、不跨会话，
  并且仍然排在角色写域闸**之后**（预设不能把角色边界关掉）。

### 顺带查出的一个 zod 坑：不声明就是静默丢

`aiSavePresetsSchema` 里的 preset 对象**没有声明 `role` / `prompt`** —— zod 的 object 默认是
`strip`，于是渲染层把 role 一起传上来、schema 校验通过、服务层收到的对象里**没有这个字段**，
存盘后"预设绑定的角色"凭空消失，全程零报错。这一轮补上 `role` / `prompt` 两行。

教训：**IPC 载荷 schema 里的对象是白名单，不是过滤器** —— 新增字段只改类型不改 schema，
等于让主进程继续拿着旧对象跑。

### 测试

- `tests/main/ipc/aiAgentCore-ipc.test.ts`：图交给循环且在记忆里只留一句（断言 JSONL 里
  没有 `base64`）；非 data URL / 超 4 张被 schema 拒；代码页的 `roleNote` 含打开的文件、
  低代码页不含；预设 `permissionMode:'full'` 不弹窗，而显式 `fullAccess:false` 仍然弹。
- `tests/main/services/ai/promptHints.test.ts`：两个函数的"该加 / 不该加"清单（空、绝对路径、
  `..`、换行、反引号、超长、文件不存在）。
- `tests/main/services/agent-core/modelAdapter.test.ts`：`ChatTurn.images` → `ChatMessage.images`，
  无图的回合不写这个键。
- `tests/main/services/agent-core/contextGate.test.ts`：`estimateTurns` 每张图 +1000。
- `tests/main/services/ai/presets.test.ts`：`permissionMode` 读写归一（`'yolo'` 当没写）。

**还没做**：预设的表单化编辑
（现在仍然只能改 JSON）、以及"角色已生效"的界面痕迹。

## 27. 压缩发生时，界面留一条提示（2026-10-25，补齐 §23 没做的那一半）

§23 把压缩做进了循环里，但**只有模型知道**：它会在消息最前面收到一条「【本轮上下文已压缩…】」。
用户那边什么都不显示 —— 聊到一半，早先的回合就"凭空少了"，会以为是界面丢消息。这一节补的就是这条提示。

### 它不是"状态"，是一条事件

压缩发生在 `core.ts` 的循环体里、`opts.model(messages)` 之前，是**一次性的既成事实**，没有开始/结束、
没有进度可报。所以没有走"步骤 / 流式 chunk"那两条通道，而是新开一条 `ai:compact`：

```ts
emit('ai:compact', { projectPath, dropped, tokensBefore, tokensAfter })
```

一条新 IPC 通道要**四处登记**，少一处就是静默失效（§26 刚踩过同族的坑）：

| 位置                                 | 作用                                             |
| ------------------------------------ | ------------------------------------------------ |
| `src/main/ipc/aiAgentCore.ts`        | `emit`（`onCompact` 回调里，logger 之后）        |
| `src/preload/index.ts`               | `onCompact(cb)` → `ipcRenderer.on('ai:compact')` |
| `src/renderer/src/types/ipc.ts`      | `onCompact?` 类型（`?`：老窗口不崩）             |
| `src/renderer/src/stores/aiStore.ts` | `init()` 里订阅 + `cleanup` 里退订               |

另外三本账也要各加一行，否则闸门红：`docs/ai/ai-capability-layering-*.md` 的附录（`ai.onCompact = X`）、
分层表里 `ai` 那一行、以及 `node scripts/gen-capability-catalog.mjs` 重生成的两份 `.generated.ts`。
（那份文档有两张表：附录 / 分层表是**机器对账**用的，域汇总表是**给人看的历史口径**，后者别跟着动。）

### 落成"消息"，但只活在界面里

渲染层的做法是往当前会话 `messages` 里塞一条 `{ role: 'system', notice: 'compaction' }`：
这样它自然跟着时间线排序、跟着会话切换路由，不需要额外维护"提示列表"。

- `notice?: 'compaction'` 只是**界面标签**：不进记忆、不发模型、不写历史 JSONL；刷新后这条提示就没了
  （真实的早先回合仍在盘上的 `.qqbat/ai/*.jsonl` 里，压缩只影响"发给模型的那一份"）。
- 样式是**上方一条细线 + 居中 11px 灰字**，不是琥珀色警示横幅：这是"说明发生过什么"，不是"需要你处理"。
  为什么不是"文字两侧各一条线"那种经典分隔：右栏窄到 200px 时文字自己就把宽度吃满了，两条 `flex-1`
  的线会缩成 0，看着只是一段孤立的灰字；而 `break-all` 又会把 `91k` 劈成 `9 / 1k` —— 用 `break-words`
  只在词边界折行。这两个都是**真机 869 窗口下量出来**再改的，不是拍脑袋。
- 文案里的数字要能对得上：`dropped` 是省略的回合数，`tokensBefore/After` 是估算值，≥1000 时取整成
  `12k` 这种写法 —— 报 `118432 → 9120` 只会让人以为程序疯了。
- 事件里带 `projectPath` 才能正确路由：循环是**按项目**跑的，提示必须落进它那一个会话，
  不能落进用户此刻正在看的那个。

### 测试

- `tests/main/ipc/aiAgentCore-ipc.test.ts`：断言 `ai:compact` 载荷的四个键（`electron` 的 `send` 换成
  hoisted 稳定 mock + `beforeEach` 清账，否则前一个用例的 emit 会串进来）。
- `tests/renderer/stores/aiStoreCompactNotice.test.ts`：提示文案与取整、不碰流式状态、别的项目的压缩事件
  只进它自己的存档。

**还没做**：压缩前给用户一个"正在压缩"的即时反馈（压缩是同步的、通常几十毫秒，先不加）；把这条提示也
持久化进历史（那就得给 JSONL 加个不发给模型的消息类型，等真有人抱怨"重开看不到"再说）。

## 28. 会话预设：JSON 文本框 → 表单（2026-10-25）

### 为什么改

旧版只有一个整文件 JSON 的 textarea。问题不是「难用」，是**骗人**：字段拼错、枚举写成 `coder `
（多一个空格）、`allowedTools` 写成对象 —— 主进程 `readPresets` 一律当「没写」处理，而 `writePresets`
遇到没名字/重名的条目是**静默跳过**。用户看到「保存成功」、以为加了一道闸，实际什么都没生效。
表单把真实字段摆出来，改错当场报错 —— 与 §26「传了没读」是同一族问题：**界面说做了、主进程没做**。

### 表单只管它认识的键，别的原样带走

编辑对象就是文件里解析出来的**那个对象**（`type Draft = Record<string, unknown>`），
`setField(index, key, value)` 只动一个键，`value === undefined` 表示**把这个键删掉**。于是：

| 情况                                          | 结果                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| 文件里有人写了 `id` / `legacyNote` / 未来字段 | 保存时原样写回（表单不认识的键不受影响）                                    |
| 把描述清空                                    | `description` 键消失，而不是写一个空字符串                                  |
| 工具一个都不勾                                | `allowedTools` 键消失（空集 = 不限制，与 `scoping.ts` 语义一致），不是 `[]` |
| 权限模式选「默认」                            | `permissionMode` 键消失（等价于 `ask`），只有选「完全放行」才写 `full`      |

为什么纠结空串与不写：主进程两边的归一并不完全一样（`normalizePrompt` 会把空串当没写，
但 `allowedTools: []` 与缺键在 `scoping` 里是不同分支）。**写文件的一方按最保守的形式落盘**，
以后改归一逻辑也不会因为历史文件里的一堆空串而出现两种解释。

### 名字是唯一键：`PresetSelect` 从 id 改回 name 是**修 bug**

`src/main/services/ai/presets.ts` 的 `readPreset(projectPath, name)` 只按 `name` 查；而
`PresetSelect` 原来把文件里的 `id` 当下拉的 `value`。后果：任何写了 `id` 的预设，选中后主进程
查不到 → 工具白名单、角色、权限模式**全部静默失效**，界面看起来一切正常。现在 `parsePresetOptions`
按 `name` 建表、同名只留第一条、文件里的 `id` 不再参与选择。

### 保存路径没变，但界面先拦两道

仍然走 `ai:savePresets` → `writePresets`（唯一写盘入口，`.qqbat/agent-presets.json`），区别是：

- **空名字 / 重名在界面就拦**：主进程对这两种是静默跳过（重名还是后者覆盖前者），不拦的话保存成功是假的。
- **warnings 不关窗**：未知工具 / 未装载插件只回警告（预设允许先写、后装），`onSaved()` 先通知外面刷新列表
  （`ChatPanel` 的 `presetEpoch + 1`），窗口留着让人看警告。
- **坏文件不被覆盖**：解析失败时原样进 JSON 模式并报错；从 JSON 切回表单解析失败时**留在 JSON 模式**，
  用户刚写的文本一个字都不丢。
- **没有项目就不许假装能存**：`projectPath` 来自 `projectStore.currentProject?.path`，启动器还没选项目时是
  `undefined`。旧写法 `if (!projectPath) return` 让"保存"变成静默空转（点了没反应、不报错、列表还是空的）——
  现在开头就 `setError(presetNoProject)`、保存按钮 `disabled`，说明区和空态各显示一次「先打开一个项目」，
  也不去读盘（没项目就没有文件可读）。

### 刻意没做

- `plugins` 仍只有 JSON 模式：它的语义是「限定运行时主进程插件贡献的工具」（`pluginOwnedTools()` 跳过
  `builtin.*`），而 `plugin.listInstalled()` 返回的是**AI 节点插件** —— 两者不是一回事，做下拉等于给错清单。
  表单里发现该预设声明了 `plugins` 时只显示一行琥珀提示（去 JSON 模式改）。
- 没做预设预览（选中后显示它到底放开了哪些工具）：那要拉一遍注册表 + 角色写域，属于第二步。

### 测试

- `tests/renderer/components/ai/PresetEditor.test.tsx`（11 例）：列表/字段铺开、改角色+勾工具后写回且
  保留 `id`/`legacyNote`、清空字段删键、未勾工具不写 `allowedTools`、空名字与重名拒存、删除后少一条、
  有 warnings 不关窗但 `onSaved` 已触发、坏文件进 JSON 模式改好可存、JSON 解析失败不吞输入、
  没有 `projectPath` 时明说没地方存且保存禁用、不读盘。
- `tests/renderer/components/ai/PresetSelect.test.tsx`（7 例）：键用 name（写 id 也没用）、同名去重、
  未知 `role`/`permissionMode` 只丢字段不连坐整条、名字两端空白归一、非数组当空表、
  白名单/插件只留非空字符串并去重、**空数组当没写**（空集=不限制，不能让界面显示成「工具只留 0 个」）。

**还没做**：`plugins` 的表单化 —— 等运行时插件（`plugin.listHost()` 里可停用那些）真的会有第三方贡献工具再说。

## 29. 「本轮边界」一行：让主进程真正生效的边界在界面上留痕（2026-10-25）

### 问题：边界只活在主进程里

这一轮的权限边界由三处拼出来：

| 来源                                                            | 给了什么                             |
| --------------------------------------------------------------- | ------------------------------------ |
| 页面推断的角色（`resolveAgentMode(centerTab, override)`）       | 系统提示 + 写域闸                    |
| 会话预设 `role` / `allowedTools` / `plugins` / `permissionMode` | 角色、工具白名单、插件限定、审批口径 |
| 输入框菜单的「先计划」「完全权限」                              | 只读一轮 / 跳过问人                  |

界面上原来只有**角色按钮**会跟着预设高亮（`presetMeta.role → setAgentModeOverride`）。剩下的全都看不见：
预设把工具收窄到 2 个、预设授予完全放行、这一轮只读 —— 用户看到的是「我什么都没改」，
模型那边却拿着另一套权限。与 §26「传了没读」同一族，只是方向反过来：**主进程做了、界面没说**。

### 做法：只在「跟默认不一样」时出现

`src/renderer/src/components/ai/TurnBoundary.tsx` 是个纯组件（props 进、文字出，不做权限判断），
默认态（跟随页面 + 全部工具 + 逐次问 + 不是先计划）**直接返回 `null`** —— 常态下不留噪音。
一旦有差异就逐条列出来，用 `·` 分隔：

```
角色：代码助手（预设「只读巡检」）· 工具只留 2 个 · 插件限定 1 个 · 审批：完全放行（预设）· 先计划：本轮只读
```

- **角色来源三种**：跟随页面 / 手动 / 预设「名字」。主进程的优先级是 `preset.role ?? ROLE_OF_MODE[agentMode]`，
  所以界面这里也按同一顺序判（有 `presetMeta.role` 就是预设定的）。
- **审批三档**：`fullAccess ? 'full' : presetMeta?.permissionMode === 'full' ? 'full-preset' : 'ask'`。
  与主进程 `fullAccess ?? (preset?.permissionMode === 'full')` 一一对应（界面传的是 `true` / `undefined`，
  不传 `false`，见 §26）。「本次」和「预设」分开说，是因为前者重启即失效、后者跟着文件走。
- **工具数与插件数来自 `parsePresetOptions` 归一后的数组**（`PresetMeta.allowedTools` / `plugins`）。
  空数组合并成 `undefined`：主进程里空集=不限制，界面若显示「0 个」刚好说反。
- **先计划**多一条「本轮只读」：那一轮 `runTurn` 只把 `category === 'query'` 的工具交出去。

### 为什么不做成「设置面板」

边界是**这一轮**的属性，不是全局配置：换个预设、点一下「先计划」它就变。放在输入框正上方（角色 chips 下面）
才是它该在的位置 —— 写这句话的时候就能看见这句话会以什么权限被执行。

### 测试

`tests/renderer/components/ai/TurnBoundary.test.tsx`（4 例）：默认态不渲染（`queryByRole('status')` 为 null）、
预设三件事都说出来且不说「逐次问」、手动 + 先计划说对手动与只读且不说「完全放行」、
工具数 0 与 `undefined` 都不显示而 `n=3` / 插件 `n=2` 显示。

**还没做**：预设编辑器里的「预览这份预设会放开什么」（要拉一遍注册表 + 角色写域，见 §28）。
