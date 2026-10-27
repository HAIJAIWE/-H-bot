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

### 2026-10-25 晚：**角色那一项删掉了**

上面这段文字里有一条「角色：代码助手（预设「只读巡检」）」—— 与角色/预设合并后的选择器（§30）说的是同一件事，
用户看到的是同一屏上把角色说了两遍。所以现在 `TurnBoundary` 只留**差异**：工具收窄、插件限定、审批口径、先计划；
角色归选择器说。默认态的判定也相应简化成 `approval === 'ask' && !scoped && !plugins && !planFirst`。

## 30. 角色与预设合成一个菜单（2026-10-25，对齐 DSH 的 `ui-agent-preset`）

### 问题：同一件事在两处选

原来输入框上方是「角色：🧩流程助手 📝代码助手 🔀双向 ✨创作 **跟页面**」一排按钮（`RoleChips`），
再往下的「本轮 ▾」菜单里还有一份自定义预设下拉（`PresetSelect`）。两处都在决定「这一轮以什么身份、什么权限跑」，
而且互相**不认识的优先规则**：点角色会把预设清掉，选预设又会把角色按钮顶掉，界面上还多一条带下划线的「跟页面」。
用户原话：「原来的这个你可以重写 dsh 的那种吧」。

### DSH 那种是什么形状

`deepseek-harness-master/packages/client/ui-agent-preset`（快照在仓库根，MIT）：

| 文件                       | 干的事                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `AgentPresetSeat.tsx`      | 选择器的座位（放在输入框附近），只负责把状态往上抛              |
| `AgentPresetSection.tsx`   | 分组列表：内置项与自定义项分开列，**当前项高亮**                |
| `AgentPresetLabel.tsx`     | 一行"现在是谁"的标签（不带权限细节）                            |
| `CreatePluginMenuItem.tsx` | 「新建预设」是菜单里的一项，点了进创建流程，不在这里内联编辑    |
| `README.zh.md`             | 语义：选择结果 `applied/staged/unchanged/refused`；查看配置只读 |

要点不是长相，而是**一处选、一处说**：选择器是唯一的真源，别的地方不再复述它。

### 我们的做法

一个新的纯组件 `src/renderer/src/components/ai/AgentPresetMenu.tsx`（`<details>` 触发器 + 一个面板）：

```
预设 跟页面 ▾
──────────────────────────────
✓ 跟页面                 按页签
角色
  流程助手 / 代码助手 / 双向 / 创作
──────────────────────────────
我的预设
  只读巡检（角色：代码助手（预设固定））
  全放行
──────────────────────────────
  编辑预设…
```

- **三种取值落到同一件事**（主进程只认「角色 + 预设名」）：
  跟随页面 = 不覆盖角色 + 不带预设；内置角色 = 覆盖角色 + 不带预设；我的预设 = 带预设名（角色由预设的
  `role` 决定，没写就跟页面走）。菜单里这三组互斥，`aria-pressed` 只亮一处。
- **当前项高亮**用 `aria-pressed` + 一个 ✓（`w-3` 占位保持文字左对齐，不用绝对定位）。
- **编辑是另一个入口**：菜单最后一项「编辑预设…」开 `PresetEditor` 弹窗（与 DSH 的「新建预设」同一思路：
  菜单只负责选，不就地改）。
- **预设列表仍是文件真源**：`window.qqbat.file.read(projectPath, PRESETS_FILE)` → `parsePresetOptions`。
  保存后由 `ChatPanel` 的 `presetEpoch + 1` 触发重读（`reloadKey`），菜单不缓存。
- **元信息回抛** `onResolve(meta | null)`：`ChatPanel` 拿它喂 `TurnBoundary` 的工具数/插件数/审批口径。
  主进程仍然自己重读预设 —— 界面这份只用于显示，**不参与权限判断**。

### 三处必须跟着改的地方（错一处就静默失效）

1. **`role` 与 `mode` 是两个类型**：预设里写的是 `AgentRole`（`builder/coder/duo/creator`），
   按钮表用的是 `AgentMode`（`blocks/code/duo/creator`）。菜单里显示预设的固定角色必须先 `MODE_OF_ROLE[role]`
   再查按钮表 —— 直接拿 role 比 mode 的后果是四行全落到默认的「流程助手」，看起来"没写一样"。
2. **预设没写 `role` 时必须把 override 清回 `null`**：原来那条 effect 是
   `if (presetMeta?.role) setAgentModeOverride(...)` —— 从「只读巡检（coder）」切到「全放行（没写 role）」时，
   角色会**留在上一次的 code**，而主进程算的是「跟页面」。现在是
   `if (!preset) return; setAgentModeOverride(presetMeta?.role ? MODE_OF_ROLE[...] : null)`，
   同一条 effect 也负责"没选预设时什么都不做"（否则手动点的角色会被洗回 null）。
3. **`TurnBoundary` 不再写角色**（见 §29 末尾追加的那段）：角色归选择器说。

### 删掉的东西

| 删掉                                                                                                                          | 为什么                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/renderer/src/components/ai/RoleChips.tsx`                                                                                | 合并进选择器，留着就是第二处真源                                                                                   |
| `src/renderer/src/components/ai/PresetSelect.tsx`                                                                             | 同上；**解析规则**搬到 `presetOptions.ts`（`PRESETS_FILE` / `PresetMeta` / `PresetOption` / `parsePresetOptions`） |
| `tests/renderer/components/ai/RoleChips.test.tsx`                                                                             | 由 `AgentPresetMenu.test.tsx` 覆盖                                                                                 |
| `PresetSelect.test.tsx` → `presetOptions.test.ts`                                                                             | 规则没变，只改 import 与文件名                                                                                     |
| i18n：`ai.mode.label`、`ai.boundary.role/sourcePreset/sourcePresetNoName/sourceManual/sourcePage`、`ai.agentCore.presetTitle` | 组件删了，键就是残留（孤儿键闸门会拦）                                                                             |

新增 i18n：`ai.preset.trigger/title/pageHint/followPageHint/groupRole/groupMine/empty/roleFixed/roleFollow`（中英各 9 个）。

### 测试

- `tests/renderer/components/ai/AgentPresetMenu.test.tsx`（8 例）：默认只亮「跟页面」、
  点角色回调 **mode**（`'code'` 而不是 `'coder'`）、预设从文件读出且回调收到**名字**（不是 `id`）、
  选中预设时只有它亮且触发器显示预设名、选中预设把元信息抛给 `onResolve`、「编辑预设…」回调、
  没有项目时不去读盘并说「还没有预设」、坏 JSON 当空表不崩。
- `tests/renderer/components/ai/TurnBoundary.test.tsx`（4 例，按新 props 重写）：默认态不渲染、
  收窄 + 预设放行两条都说出来**且不再出现角色文案**、先计划不说「完全放行」、0 与 `undefined` 都不显示。
- `tests/renderer/components/ai/presetOptions.test.ts`（7 例）：规则与 §28 完全相同，只换了文件名与 import。

### 还没做

- 菜单里没有「查看配置（只读）」—— DSH 那边是把预设当 YAML 展示。我们的预设就在 `.qqbat/agent-presets.json` 里，
  点「编辑预设…」能直接看，暂不另做只读视图。
- 选择结果没有 `applied/staged/unchanged/refused` 四态：我们的预设一选就生效（下一轮），没有"暂存"这一步。

## 31. 预设「这一轮会放开什么」+ 工具表改成说真话（2026-10-25）

### 为什么加预览

预设里那几个字段（角色 / 白名单 / 审批 / 插件）**每一个都影响权限**，但界面上它们只是控件：
勾一个 `add_node` 到底换来什么、「代码助手」能不能改流程，用户只能靠猜。DSH 那边预设是 YAML 直读，
我们这套是表单，更需要一句话翻译。

新组件 `src/renderer/src/components/ai/PresetImpact.tsx`，props 只收真源字段（`role` / `allowedTools` /
`tools` / `permissionMode` / `plugins`），渲染在预设编辑器「角色 / 审批」两列之后、工具白名单之前。

**它不做判断，只做翻译：**

- 「能改什么」调 `mayRoleWritePath`（`@shared/ai/roleDomains`）—— 与主进程弹审批前那道闸**同一个函数**。
  两份规则一定会漂：一边加了路径、另一边忘了，界面就会显示「能写」而实际被拒。
- 只判两个代表路径：`.qqbat/flow.json`（界面域）与 `src/main/services/agent-core/runTurn.ts`（代码域）。
  不列全表 —— 列全表既看不出重点，也会随目录变动过时。
- 工具统计：`全部 N 个` / `只留 N 个`，再按 `category` 拆 `改 m · 查 q`；白名单里**注册表不认识**的名字
  单独点名（那说明预设写错了，或者工具随插件被卸了）。
- 审批两档（逐次问 / 完全放行）；`plugins` 非空时单独一行。
- 常驻一句：「白名单只收窄工具…路径边界在弹审批之前就生效，完全放行也绕不过去」—— 这本来就是两道闸，
  用户最容易当成同一道。

i18n `ai.preset.impact.*` 共 20 键（中英各一份，两文件 3216 键对齐）。

### 预览立刻暴露的真问题：它在说另一张表

第一次真机打开预览，看到「白名单里 1 个不认识：list_dir」—— 而 `list_dir` 是循环里**确实有**的工具。
查下去是两处口径不同：

| 地方                                               | 给的什么                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/main/ipc/ai.ts` 的 `ai:tools`（旧）           | `ALL_TOOL_DEFINITIONS`：助手链路 27 个领域定义（`add_node` / `read_flow` / …） |
| `src/main/ipc/aiAgentCore.ts:345` 预设白名单过滤的 | `scopeToolsByPlugins(listTools(), …)` —— **循环注册表**                        |

循环注册表只有 6 个：`read_file` / `write_file` / `run_command` / `validate_flow` / `list_dir` / `search_text`
（`src/main/services/agent-core/core.ts:231-369`，`CORE_TOOLS` 在 `:449` 注册），另外是插件市场装进来的工具。于是：

- 界面上勾 `add_node` 这种**从来没在循环里存在过**的工具 → 拦不住任何东西（它本来也不会被调用），用户却以为收紧了；
- 循环里真能用的 `list_dir` 反倒被标成「不认识」。

本轮修法：`ai:tools` 改为返回 `listTools()` 映射出来的工具定义（缺 `category` 按 `mutation`、缺 `parameters` 补 `{}`）。
**工具表只广告真正能执行的** —— 这条对界面同样成立。测试跟着改：`tests/main/ipc/ai-ipc.test.ts` 与
`tests/main/ipc/remaining-ipc-1.test.ts` 的 mock 从 `@main/services/ai/tools/defs` 换成 `@main/services/agent-core/core`。

### 这件事背后的更大一笔：旧 27 个工具根本没进循环

`src/main/services/agent-core/legacyTools.ts:102` 的 `adaptLegacyTools` 是「合并双引擎第 2 步」的产物
（把旧 27 个定义包成循环的 `Tool`：query 走 `executeTool` + 渲染层回执，mutation 转提案攒进 `pendingOperations`），
**全仓零调用点**。所以今天循环里的模型看不见 `add_node` / `read_flow`，只能读写文件、跑命令、校验流程。

本轮没有顺手接它：接它要同时提供 `dispatch`（渲染层指令通道）、`pendingOperations`（轮末发提案）与 `context`
（预览图），也就是「单循环统一双引擎」的正身。本轮只把**界面说的话改成真的**（老实列 6 个），账记在这里：
真接上之后 `ai:tools` 应该返回合并表，预设白名单才有 27 个可勾。

### 测试

- `tests/renderer/components/ai/PresetImpact.test.tsx`（9 例）：builder 能改界面不能写代码、coder 反过来、
  duo 两边都能、`role: null` 说「跟着页签」、工具全量/收窄统计、未知工具点名、完全放行徽标、plugins 分行、常驻提醒。
- `tests/main/ipc/ai-ipc.test.ts` / `tests/main/ipc/remaining-ipc-1.test.ts`：`ai:tools` 的 mock 换成循环注册表，
  断言字段被补全（`category` 缺省 mutation、`parameters` 缺省 `{}`）。
- 真机：`_recovery/cdp-preset-verify.mjs` 打开「编辑预设…」，impact 块 w=538 h=114；文本
  「能改：界面…不能写 · 代码…能写 / 工具 只留 2 个 · 改 0 · 查 1 · 白名单里 1 个不认识：list_dir / 审批 逐次问」，
  改完 `ai:tools` 后那句「不认识」消失。

## 32. 旧 27 个工具真正进循环了（2026-10-25）

上一节记的账（`adaptLegacyTools` 零调用点）这轮还掉：循环现在把**两半工具表**接在一起，
模型能直接看见、直接调 `add_node` / `read_flow` 这类领域工具，而不再只会读写文件。

### 32.1 形状：一个 per-run 的 bridge，一个 per-turn 的账本

`src/main/ipc/aiAgentCore.ts` 在算出 `role` 之后建两样东西：

```ts
const pendingOperations: ProposalOperation[] = []
const legacyBridge: LegacyToolBridge = {
  projectPath,
  signal: ctrl.signal,
  role,
  pendingOperations,
  context: () => buildPendingContext(projectPath, pendingOperations),
  dispatch: async instruction => {
    const res = await dispatchInstruction(win, {
      name: instruction.name,
      args: instruction.args,
      projectPath,
    })
    return res.outcome
  },
}
const mergedTools = mergeTools(listTools(), adaptLegacyTools(legacyBridge))
```

三处取舍：

- **`pendingOperations` 在每一轮 `for (;;)` 开头清空**（`pendingOperations.length = 0`，原地清、不换数组 ——
  bridge 闭包里抓的是同一个引用）。提案是**这一轮**的产物；不清空的话第二轮会把上一轮攒的操作再发一次。
- **`dispatch` 永不 reject**：`dispatchInstruction` 返回 `{ requestId, outcome }`，适配层要求 query 工具的
  `outcome.status === "applied"`，否则按失败回灌模型。
- **`context` 是惰性的**：`buildPendingContext` 要读 pendingOperations 的当前快照（生成「确认后长什么样」的预览），
  所以是 `() => Promise<...>` 而不是值。顺带修掉一个洞：`legacyTools.ts` 的默认执行器以前只把 `signal` 交给
  `executeTool`、**`bridge.context` 从来没被 await 过**（`ctxOf()` 只返回 `{ signal }`）—— 现在先 await context 再并上 signal。

### 32.2 同名冲突：循环版优先（规则只有一份）

两半里有三个重名：`read_file` / `write_file` / `validate_flow`。合并规则写在新文件
`src/main/services/agent-core/toolCatalog.ts` 的 `mergeTools(loopTools, legacyTools)`：**同名时第一半（循环版）优先**，
顺序保持稳定。理由不是「新的更好」，而是**闸门**：循环版认工作区相对路径、写盘要过审批；旧版直接执行、不认这套边界。
留错那一份 = 同一个名字在两条路径上遵守两套规则。

规则放在一个函数里，是因为**有两处必须按同一条合并**：

| 调用点                             | 用途                                              |
| ---------------------------------- | ------------------------------------------------- |
| `src/main/ipc/aiAgentCore.ts`      | 真正交给循环的可执行工具（走 `adaptLegacyTools`） |
| `src/main/ipc/ai.ts` 的 `ai:tools` | 界面上预设白名单能勾的那张表                      |

两边各写一遍 `[...a, ...b.filter(不在 a 里)]`，迟早有一边漏掉某个名字 —— §31 那次的
「勾了拦不住 / 真能用的被标不认识」就是这么来的。现在 `ai:tools` 也广告合并表（`listTools()` 映射 +
`ALL_TOOL_DEFINITIONS` 映射，交给同一个 `mergeTools`），界面上勾 `add_node` 才第一次是真收紧。

### 32.3 提案口径：发 `ai:proposal` 就不发 `ai:response`

轮末（`last = result` 之后、`emit("ai:response")` 之前）：

```ts
const validation = await validateProposalOperations(projectPath, pendingOperations)
const verdict = buildVerdict(pendingOperations, validation) as unknown as Verdict
const proposal = createProposal(currentRequirement, pendingOperations, validation, verdict)
emit('ai:proposal', { projectPath, proposal })
```

- **有提案就只发 `ai:proposal`**，正文不发。这是助手链路既有口径（`aiStore.ts` 两处注释：
  「主进程有提案时只发 ai:proposal、不发 ai:response」），两条都发界面上会长出两份尾巴。
- **组装失败（校验抛错）退回正文**：`try/catch` 里 `logger.warn` + 照常发 `ai:response`。
  宁可少一个提案面板，不能因为校验炸掉就让这一轮彻底没有回复。
- `as unknown as Verdict` 的强转写在注释里：`verifier.ts` 是还原文件、参数没有类型，
  `issues[].severity` 被推成 `string`，与 `Verdict` 的 `"error" | "warn"` 不兼容。**不改那个文件** ——
  改它等于整篇重排（本仓库还原文件一律不打散重排）。
- 事件契约跟着登记：`tests/guards/agentCoreEventContract.test.ts` 的 `REQUIRED_KEYS` 加
  `"ai:proposal": ["projectPath", "proposal"]`，`aiAgentCore.ts` 的期望 emit 列表加一条（13 → 14）。

### 32.4 还没做的（记清楚，别当成已经有）

- **模型复核**：助手链路 `emitProposal` 里有 `shouldReviewWithModel` / `verifyPlanWithModel`（让模型再审一遍计划），
  循环这边只走「结构校验 + `buildVerdict`」。想加得先决定用哪个模型、算谁的 token。
- **lanes / runSummary**：助手链路那套分流与轮次摘要，循环里没有。
- **提案被拒后的回灌**：助手链路会把用户对提案的处置写成 system 注记喂回下一轮；循环目前只管发。

### 32.5 测试

- `tests/main/services/agent-core/legacyTools.test.ts`（11 例）新增 2 例：**默认执行器要并上 context**，以及
  「没有 context 时 `toEqual({ signal })`」。
- `tests/main/ipc/aiAgentCore-ipc.test.ts`（20 例）新增/改 4 例：旧工具真进循环表且同名让位循环版；
  mutation 只攒提案、**只发 `ai:proposal` 不发 `ai:response`**；组装失败退回正文；白名单收窄到只剩勾中的那个。
- `tests/main/ipc/ai-ipc.test.ts` / `remaining-ipc-1.test.ts`：`ai:tools` 的断言从前两条精确相等改成
  「前两条是循环版 + 表里有旧定义 + 同名只出现一次」。

## 33. 开始搬 DSH 源码：token-meter + tool-result-pruner（2026-10-25）

§32 之前所有「对齐 DSH」都只借了**语义**。用户 2026-10-25 明确解除「别照搬」约束后，
`src/main/vendor/dsh/` 下开始放**真正的上游代码**（MIT：许可全文 + 逐文件来源头 + MANIFEST 哈希 +
`THIRD_PARTY_NOTICES.md`）。第一批挑的是两块「算法密集、与运行时无关」的：

| 上游                                                                            | 我们这里                                                | 改了什么                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/llm/token-meter/src/estimate.ts`                                      | `vendor/dsh/token-meter/estimate.ts`                    | 类型换本地垫片、字符计量改 `./measure`、导出常量、删 `estimateToolsTokens` |
| `packages/compaction/compaction-tool-result-pruner/src/{config,types,index}.ts` | `vendor/dsh/tool-result-pruner/{config,types,prune}.ts` | 去掉 Cordis Service 外壳，两个方法提成纯函数；`deepFreeze` 换本地实现      |

为什么挑这两块：它们**不 import 任何上游服务**（连 Cordis 都不需要），搬过来是纯函数，
接上就能用；而 `compaction-basic`（22 个内部 import、`region.ts` 601 行绑 `SessionSeq`）
照搬等于把上游运行时一起搬进来 —— 那件事没做，理由写在 `dsh-source-adaptation-2026-10-24.md` §5。

### 33.1 先剪工具结果，再考虑压回合

循环的上下文闸门原来是「超预算 → 把中段回合压成一条注记」。现在多了一步，顺序是：

```
planCompaction()  ──判定哪段可压（保 index 0 系统提示 + 紧跟的 user + 尾部 keep 条）
      ↓
pruneToolTurns() ──把这段里 role=tool 的结果按 4096/1024 保头保尾，中间插标记
      ↓
retry = planCompaction() ──剪完可能就够了
      ↓   还不够才摘要压缩（老路径）
```

- **为什么先剪**：工具结果的中间段几乎从不再被引用（模型要的是「文件里有什么」而不是
  「第 5000 个字符是什么」），剪掉它比丢掉整个回合便宜得多；剪完不超预算就不摘要、
  也不加「上下文已压缩」注记 —— 用户看到那条注记意味着真的丢了回合。
- **`pruned` 与 `dropped` 分开计**：`CompactionOutcome` 现在有 `pruned: number`，
  `applyCompaction` 只有真的丢了回合才 `dropped > 0`。`aiAgentCore` 的 `onCompact` 因此加了一句
  `if (info.dropped <= 0) return` —— 只剪未压时**不发 `ai:compact`**，否则界面会写「省略 0 条」。
- **`pruneToolResults: false`** 可以关掉这一步（测试用，也让将来「只压缩不剪」有入口）。
- **就地改**：`pruneToolTurns` 直接改传进去的 `messages` 数组（与 `applyCompaction` 同一约定），
  测试用 `expect(messages).toBe(before)` 钉住这件事。

### 33.2 token 口径：上游密度 × 中文校正

上游是 `text.length / 4`（英文字符密度）。中文照这个算会低估约 4 倍，所以字符计量走
`vendor/dsh/token-meter/measure.ts`：**ASCII 记 1，其余 code point 记 4**。于是
「4 个 ASCII = 1 token」「1 个汉字 = 1 token」—— 与本仓库旧 `estimateTokens` 完全等值，
换的只是「谁定义块开销与角色框」。

块价：文本/推理 `ceil(chars/4) + 4`、工具调用 `ceil(name/4) + ceil(args/4) + 4`、
图片按结构 JSON；每条回合再加 `ROLE_OVERHEAD = 4`（system 回合例外，走 `estimateSystemMessage`，
不加块开销）。所以 40 个 ASCII 的 user 回合 = `10 + 4 + 4 = 18`，比旧口径多 4（保守方向）。

### 33.3 对账：`pnpm vendor:audit`

`scripts/vendor-audit.mjs` 做三件事：许可原文在不在（含 `MIT License` 与上游版权行）、
每个目标文件在不在且 `targetSha256` 对得上、上游快照在的话连 `sourceSha256` 一起对。
合上游改动后跑 `--update` 重写哈希 —— **手改搬来的算法必须同时改 MANIFEST 的 `adaptedNotes`**。

### 33.4 测试

- `tokenEstimate.test.ts`（5 例）：ASCII 密度、中文 1 字 1 token、40 ASCII 回合 = 18、空回合、贴图 `+1000/张`。
- `toolResultPrune.test.ts`（5 例）：预算内不动、超长保头 4096 + 标记 + 保尾 1024、只剪 `tool` 回合、
  只剪指定区间、emoji 不出 lone surrogate。
- `contextGate.test.ts`：`estimateTurns` 期望 14 → 18；贴图两例改 `18+1000` / `18+2000`；
  新增「先剪工具结果，再考虑压回合」4 例（只剪不压 / 剪完还超才压 / `pruneToolResults:false` / 注记出现条件）。

### 33.5 还没做

- **`compaction-basic` 本体没搬**：它的可压缩区间选择绑 `SessionSeq` / `EpochHeader`，
  搬它等于搬会话模型；目前区间选择仍是本仓库 `planCompaction`。
- **`pruneSession()` 没搬**：要上游 Session 与 shadow-price 事件协议。
- **图片价仍是 1000/张的粗估**：上游图像 offload 后按引用价算，那是 route 的账。

## 34. 第二批：`todo_write` —— 模型自己的多步清单（2026-10-25）

第一批（§33）之后，按「算法密集、与运行时无关」重新过了一遍上游剩下的候选，结论是只有 todo 值得搬：

| 候选                                           | 结论   | 为什么                                                                                                                           |
| ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/todo/tool-todo`                      | **搬** | 纯函数（描述文案 / 校验 / 计数）+ 一个工具 + 一条界面清单条；我们循环缺「多步任务清单」，长任务容易跑偏                          |
| `packages/plan/plan-mode`                      | 不搬   | `PlanModeController extends Service` + `inject = ['tools','systemPrompt','sessionProjections','agents']`，452 行全绑 Cordis 会话 |
| `packages/preset/agent-preset-registry`        | 不搬   | 只认 DSH 那四个预设 id 与 Cordis YAML 插件行，换不到我们的「角色 / 预设」语义                                                    |
| `packages/compaction/compaction-image-offload` | 不搬   | 我们循环里的图只挂在当轮首个 user 回合、且不落盘，历史里没有旧图可 offload                                                       |
| `packages/llm/llm-retry` + `retry-policy.ts`   | 不搬   | 已有 `services/ai/llmRetry.ts`，口径相同（5 次、500ms 起、指数 + 抖动）                                                          |
| `packages/util/output-retention`               | 暂不搬 | 429 行，处理的是上游 worktree / 快照保留，我们没有对应物                                                                         |

### 34.1 搬了什么

| 上游                                   | 我们这里                       | 改了什么                                                                                            |
| -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/todo/tool-todo/src/types.ts` | `vendor/dsh/todo/types.ts`     | 删两个 `declare module`（会话事件 / 投影扩展），补 `TodoStatus` / `TodoCounts` 具名类型             |
| `packages/todo/tool-todo/src/index.ts` | `vendor/dsh/todo/todo-list.ts` | 只取纯函数：四段描述文案、`describeTodoTool`、`toTodoList`；新增 `countTodos` / `formatTodoSummary` |

没搬：`apply()` / `defineTool` / `ctx.sessionProjections` 投影（要上游 Session 重放）、`zod` / `schemastery` 依赖。

### 34.2 为什么只搬「清单」不搬「计划」

上游这两件事是分开的：**plan** 是给人看的关卡（进入/审阅/退出，绑会话与系统提示），
**todo** 是模型自己的脚手架（整表替换、后写覆盖、每轮清空）。我们的「先计划」开关（§20）已经
承担了前者的一半，缺的正是后者 —— 所以只搬 todo，不动 plan-mode。

### 34.3 接线四处

1. **工具注册**：`core.ts` 在 `for (const builtin of CORE_TOOLS) registerTool(builtin)` 之后单独
   `registerTool(TODO_TOOL)` —— **不能**塞进 `CORE_TOOLS`：`builtinHostPlugins` 有一道防御，
   任何没被 `FILES_TOOLS / RUNTIME_TOOLS / FLOW_TOOLS` 认领的 `CORE_TOOLS` 都会让插件注册直接 throw。
2. **存储**：`agent-core/todoStore.ts` 是进程内 `Map`，键 `resolve(workspace)` —— 两个项目各一份。
   读/写都返回副本，调用方改不到内部状态。
3. **事件**：`ai:todo { projectPath, todos }`。每轮开始先 `clearTodos` 再发一张空表（清单是这一轮的
   脚手架，不继承上一轮）；工具完成时**复用唯一的 `onToolEnd` 钩子**（`call.name === 'todo_write'`
   且输出不以 `[工具失败]` 开头才发），没有新开订阅。
4. **界面**：`ChatPanel` 输入框上方一条清单（只列前 6 条 + 「还有 N 条」，完成项划线），
   文案在 `ai.todo.*`。清单为空时整条不渲染。

### 34.4 校验口径（与上游一字不差）

- `invalid todo: \`content\` must be a non-empty string`（trim 后为空）；
- `invalid todos: duplicate content "…"`（trim 后重复）；
- `invalid todos: at most one task may be in_progress (got N)`（只在 `!allowParallel` 时可能触发）。

`ALLOW_PARALLEL_IN_PROGRESS = true`：我们的调度器本来就能并行跑工具（§7 的 `runToolGroup`），
上游这里也是**部署选择**而不是模型开关，所以固定成允许并行，描述里就写「几个同时做」。

### 34.5 为什么不落盘

清单是「这一轮打算怎么做」，不是历史真相；真要留痕，历史里已有 `todo_write` 的调用与回执。
代价说清楚：**重启应用后清单条消失**（重放历史还能看到最后一次写入）。要持久化的话，正确做法是
往 `.qqbat/ai-history.jsonl` 落一条专用事件，而不是把 Map 序列化到磁盘 —— 本批没做。

### 34.6 测试与闸门

- `tests/main/services/agent-core/todoTool.test.ts`（8 例）：描述只差一句、trim/空串/重复、
  并行活跃数、计数与回执文案、已注册进 `listTools()`、按工作区隔离、非数组直接拒、校验失败不覆盖上一份。
- `agentCoreEventContract`：`REQUIRED_KEYS` 加 `'ai:todo': ['projectPath','todos']`，agent-core 的
  通道期望 +2 条 `ai:todo`。
- 能力台账：附录 A 加 `ai.onTodo = X`；总表 `ai` 行 50 / X 50、小计 268、出口 X+⛔ = 70；
  `node scripts/gen-capability-catalog.mjs` 重生成两份目录。
- `node scripts/vendor-audit.mjs`：vendored 6 + 适配层 2，上游快照可对账。

### 34.7 教训：这台机器上别裸跑 `pnpm`

`pnpm vendor:audit` / `pnpm -s vitest …` 会先做 deps-status 检查，发现 `node_modules` 与 lockfile
不一致就想 **purge 重装**；无 TTY 时直接 abort（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`），
表现为「EXIT=1 且零输出」。闸门一律走二进制：

```powershell
node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2
node scripts/vendor-audit.mjs
```

## 35. 工具表两处断裂：广告的不一定能调，调完模型还不知道那是它的结果（2026-10-25）

插件工具接上之后在真机上验一次，模型连着两次拒绝：「这个工具没有挂在我这个会话上，我实际能调的只有
read_file、write_file、run_command、validate_flow、list_dir、search_text」。它把提示里的工具清单**原样抄了 36 个**
（含插件工具 verify_greet 与 todo_write），然后准确指出只有 6 个发得出去。

### 断裂一：适配器自己写死了 CORE_TOOLS

§31 把 `ai:tools`（界面）与系统提示都改成"只说真话"，但那只是**提示侧**。厂商 function-calling 表由
`src/main/services/agent-core/modelAdapter.ts` 生成，而它是这一行：

```ts
const tools = CORE_TOOLS.map(t => toDef(t.name, t.description, t.parameters))
```

于是同一次请求里：系统提示广告 36 个，`tools` 参数只有 6 个。模型看得见名字、发不出调用，只能回一句"没挂上"。

两处补：

- `modelAdapter` 收 `tools?: readonly Tool[]`（不传仍回退 CORE_TOOLS，脚本/测试的保守默认）；
- `runTurn` 把 `effectiveTools ?? listTools()` 交进去 —— 与它给循环、给系统提示的那一份**同一个变量**。

### 断裂二：循环从不记录"自己发出过调用"

修完断裂一，真机立刻换了一种病：模型能调 verify_greet 了（说明插件工具确实执行、还读到了热更新的设置值
——回执是 `来自界面 来自界面 来自界面`），但它**同一调用连发 12 轮、一个字都不收尾**。

原因在 `runAgentLoop`：它只把工具结果 `push` 回 `messages`，从不 push 那条 assistant 回合。第二轮模型看到的是

```
user: 只调用一次 verify_greet …
user: [工具 verify_greet] 来自界面 来自界面 来自界面
```

—— 一段来历不明的结果，认不出是自己刚发起的调用，于是重发。厂商协议本来就要求
`assistant(tool_calls)` → `tool(tool_call_id)` 成对，这里补成对：

| 位置                         | 改动                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.ts` `ChatTurn`         | 新增 `toolCalls?: ToolCall[]`、`toolResult?: string`                                                                                                            |
| `core.ts` 循环               | 拿到 `calls` 后先 push `{ role:'assistant', content, toolCalls: calls }` 再执行                                                                                 |
| `scheduler.ts` `commitReady` | 工具结果带 `toolResult`（同时保留 `[工具 X]` 前缀，走回退路径时模型也知道这是数据）                                                                             |
| `modelAdapter.ts`            | assistant 透传 `toolCalls`；tool 回合带 `toolResult` → provider 的 `mapChatMessages` 会翻成 `role:'tool'` + `tool_call_id`（`src/shared/types/ai-provider.ts`） |

### 测试

- `tests/main/services/agent-core/runTurn.test.ts`：**广告 == 调用表** —— 系统提示里那行工具名与 provider 收到的
  `defs` 必须完全相同（旧代码固定 6 个，这条会红）。
- `modelAdapter.test.ts`：① 给了 `tools` 就只发那些（不再出现 read_file）；② assistant 的 `toolCalls`、
  tool 的 `toolResult` 原样透传（配对靠 id）。
- `loopCompaction.test.ts`：消息形状从 `[1,2,3]` 变 `[1,3,5]`（每轮 assistant + tool 两条），
  压缩的判据改成"同一段对话带压缩/不带压缩各跑一遍，峰值必须更低" —— 相邻两轮比大小会被成对追加的净增盖住。

### 真机现状（如实记）

- 断裂一有过硬证据：修前 36 个广告 / 6 个可调；修后模型**真的发出了** `verify_greet`，且回执里带着
  设置面板里刚改的值。
- 断裂二的端到端复验被厂商额度挡住了：这轮跑完紧接着返回
  `403 AllocationQuota.FreeTierOnly`（"Free quota exhausted"）。协议配对由上面三条单测钉住，
  等额度恢复要再跑一次 `_recovery/ex-pair-verify.js` 看它是否一轮收尾。

## 36. 上游已经有成熟实现，别再手写：先搬 `repeat-tool-reminder`（2026-10-25）

§35 修完「工具的广告/调用/配对」之后，有一件事被摆到桌面上：这几处都是我**手写**的，
而上游 DSH 里本来就有成熟版本。当时的说法是「dispatch / pendingOperations 是我们自己的接口」——
这话只对一半：**它们只是我们那一层的接线，通用算法上游其实都有。** 把候选摊开量一遍：

| 上游包                                                    | 行数                 | 耦合（`extends Service` / `static inject`） | 我们能拿到的部分                                                                      |
| --------------------------------------------------------- | -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `guard/repeat-tool-reminder/src/index.ts`                 | 219                  | **0 / 0**（只有 `ctx.on` 两处）             | 全是纯算法：规范化参数、通配符、阈值校验、两段提醒文案                                |
| `llm/llm/src/assembler.ts`                                | 194                  | 0 / 0                                       | delta → 消息块的**唯一**组装算法（text / reasoning / tool_calls / interruptedBlocks） |
| `llm/llm/src/assistant-stream.ts`                         | 501                  | 0 / 0                                       | 无损流记录 + 回放读取（依赖 `assembler`）                                             |
| `core/agent-loop/src/agent.ts`（`ReactLoopAgent`）        | 703                  | 1 / 1                                       | 循环状态机：准备步、工具批、收尾、取消                                                |
| `core/tools/src/{pipeline,batch,executor,json-schema}.ts` | 720 / 264 / 94 / 610 | 1 / 1                                       | 工具流水线、批调度、参数校验                                                          |
| `interaction/user-approval/src/index.ts`                  | 307                  | 1 / 1                                       | 审批决策记录与「批一次还是每次问」                                                    |
| `util/output-retention/src/index.ts`                      | 429                  | 待查                                        | 上游 worktree/快照保留，暂无对应物                                                    |

结论：**Service 只有一处，纯算法在 Service 里面。** 所谓「搬不动」指的是那一层接线，不是算法。
所以从这一节开始改成：**能用上游的就先搬上游，搬不动的写清为什么**（不再默认手写）。

### 36.1 这一批搬的是什么

`src/main/vendor/dsh/repeat-tool-reminder/detector.ts`（96 行）：
`sortJsonValue` / `canonicalizeArguments`（深键排序 —— 模型给的参数是无序对象）、
`wildcardToRegExp`（`*` 通配、其余按字面）、`previewArguments`（头部截断 + 省略字数）、
`validateThresholds`（空表 / 非整数 / 小于 2 / 重复，全部抛错不静默回退）、
`GENTLE_REMINDER` 与 `detailedReminder` —— **文案一字不改**。

接线 `src/main/services/agent-core/repeatGuard.ts`（`RepeatGuard`）：上游的链是
`WeakMap<Agent, Chain>`，我们是**一次 `runAgentLoop` 一条链**；`observe(name, args)` 命中阈值返回文本，
循环在**这一组工具结果之后**把它当成一条 user 回合推进对话（先事实、后判断）。

三条与上游一致的语义，别改：

1. **只对连续相同的调用计数**：任何一次不同的调用把链清零；
2. **失败/被拒的调用也计数** —— 模型反复锤同一个被拒调用正是最该点破的循环；
3. **用户插话重置链**（`inbox` 推进一条 user 回合后 `reset()`）：跨插话的重复不算空转。

### 36.2 为什么提醒是 user 回合，而不是硬拦

上游的注释写得很清楚：这是 _advisory_ —— 它只**富化**下一次请求的上下文，不否决、不改写调用。
我们照做：`repeatGuard: false` 可关，默认阈值为 `[3, 5, 8]`（第 3 次温和，第 5/8 次点名工具与次数）。
真正的拦截在审批闸（写盘/命令）那一层，两者不混。

### 36.3 测试

- `tests/main/services/agent-core/repeatGuard.test.ts`（8 例）：键序不同仍算同一次、换参数清零、
  温和 → 点名升级、include/exclude 通配透明、`reset` 重来、参数预览上限与省略标注、
  四条非法配置抛错、循环集成（第 3 次相同调用后**下一轮请求里**出现提醒 user 回合，`rounds === 4`）、
  `repeatGuard: false` 时一次都不插。
- 闸门：`tsc -p tsconfig.node.json` 0；`node scripts/vendor-audit.mjs` → vendored **7** + 适配层 2，OK
  （顺手发现 §34 那批 todo 文件被 prettier 重排过、哈希对不上，已 `--update` 修正）。

### 36.4 下一步（按同一原则，不再手写）

1. `llm/llm/src/assembler.ts`（194 行，纯）：替掉 `src/shared/types/ai-provider.ts` 里手写的两条流解析
   （text / reasoning / tool_calls 增量与 id 分配）——我们那版是照着厂商 delta 猜的；
2. `core/agent-loop/src/agent.ts` 的循环状态机：把 `core.ts` 的 `while` 换成它的阶段流转
   （准备步 → 工具批 → 收尾），我们只留「工具注册表 = 我们的工具 / 模型 = 我们的 provider」这层适配；
3. 之后才是 §32 记的那笔账：旧 27 个工具并进同一张表（统一双引擎）。

## 37. 搬 DSH 的流组装器：三家 provider 不再各写一遍（2026-10-25）

§36.4 列的第一项落下来了：`llm/llm/src/assembler.ts`（194 行，0 处 `extends Service` / 0 处 `static inject`）替掉了三家 `chat()` 里手写的 SSE 循环。

### 37.1 为什么先搬它（手写那版有真 bug）

旧的 `GLMProvider.chat` / `OpenAICompatibleProvider.chat` / `OllamaProvider.chat` 各自手写同一件事：按行切帧、拼正文、按 `index` 攒 `tool_calls`、最后回调。三份实现三份细节，而且**都不知道自己被截断了**：

- `finish_reason === 'length'`（max-tokens）时，攒到一半的工具调用**照样被当成可执行调用交出去** —— half JSON 交给执行器等于乱执行；
- 思考内容（`reasoning_content` / `thinking`）三个实现**全部丢弃**，界面的「思考过程」对这三家等于没有；
- 「`index` 长什么样」三家不一样，每份实现各自猜一遍。

这些问题上游的组装器都已经处理过，所以这一批不是"重写"，是**换实现**。

### 37.2 文件放哪：shared 也有一个 vendor 根

`src/shared/vendor/dsh/llm-assembler/{assembler,types}.ts`，而不是 `src/main/vendor/dsh/`。理由是编译边界，不是口味：

- 唯一消费方是 `src/shared/types/ai-provider.ts`（全仓 main 侧 6 处 import 它；renderer 不 import）；
- `tsconfig.web.json` 的 paths 只有 `@shared/*` / `@renderer/*`，**没有 `@main`** —— shared 里一旦 import `@main/*`，web 侧 tsc 立刻红。

两处文件登记在同一个 `src/main/vendor/dsh/MANIFEST.json`（`targetPath` 是仓库相对路径，不限目录），`vendor:audit` 一起对账。

### 37.3 搬了什么、改了什么

`src/shared/vendor/dsh/llm-assembler/assembler.ts`（167 行）逐条照搬上游 `BlockAssembler` 的状态机，语义一条没改：

| 上游判断                                                   | 为什么不能简化                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `block-end` **首次关闭为准**，关闭后同 index 的 delta 忽略 | 坏流不能撑爆内存，也不能改写已完成的块；否则流式输出与最终块不一致 |
| 首见 index 建块（delta-only 协议也要能拼）                 | Ollama / 部分兼容端点没有 block-start/end                          |
| `finish === 'max-tokens'` 时 **丢掉所有 tool-call 块**     | 被截断的调用不能交给执行器                                         |
| `interruptedBlocks()` 只留**非空白**的正文/思考            | 中断时工具调用不保留 —— 保留就得编造结果                           |
| 缺 id 退回 `call-<index>`                                  | 没有 id 的执行结果无法配对回消息                                   |

改动四处（都写进了 MANIFEST 的 `adaptedNotes`）：去掉 `brandString` / `assertNever`（未知 chunk 忽略，不让一帧坏数据打断整条流）、去掉 replay 信封、去掉 `message()`，以及 **id 只在非空时覆盖**：OpenAI 协议只在首个 delta 给 id，我们的适配层把缺失的 id 传成空串，照搬"无条件覆盖"会把已拿到的 id 擦掉（测试抓到过）。

`src/shared/ai/streamAssembler.ts`（231 行）是**协议翻译**，不是算法：把厂商帧翻成上游的 `StreamChunk`，再按上游规则取块。

- 固定块 index：正文 `0`、思考 `1`、工具调用从 `2` 起（$ 正文流到一半来工具调用不能串块）；
- 推理字段只在这一处分叉：`delta.reasoning_content ?? delta.reasoning`、Ollama 的 `message.thinking ?? thinking`；
- `finish_reason`：`length` → `max-tokens`、`tool_calls`/`function_call` → `tool-calls`、其它 → `stop`；
- 用量**不在这里归一**：各家字段名不同，`AssembleOptions.mapUsage` 注入 provider 原有的 `normalizeUsage`；
- 回调形状保持旧样：`onToolCalls` 交的仍是原始 OpenAI 形状 `{index,id,type,function:{name,arguments}}`，因为 `src/main/services/ai/toolMessages.ts` 的 `normalizeToolCalls` 只认 `function.name` / `function.arguments`。

### 37.4 测试抓到的两件事

1. **厂商不发 `index` 时不能按"本帧数组下标"顶替** —— 每个分片都从 0 开始，两个调用分两帧到达会被并成同一个块。旧实现用"已见调用数"兜住了，新适配层必须照旧（带 id/name 的帧算新调用，只有参数片的算上一个调用的续片）。已有的 `tests/shared/types/ai-provider-toolcalls.test.ts` 当场红，补上分配规则后绿。
2. **prettier 之后哈希会漂**：vendor 文件一旦被格式化，`vendor:audit` 就报"目标文件被手改过"。这是流程性事实，处理办法只有一个：`node scripts/vendor-audit.mjs --update`，不是去改校验。

测试：`tests/shared/vendor/llm-assembler.test.ts`（7 例，首关为准 / delta-only / 参数累加与缺 id / 截断丢调用 / 中断只留非空白 / 默认 stop 与 usage）+ `tests/shared/ai/streamAssembler.test.ts`（6 例，思考+正文+两个调用交错 / `length` 丢调用 / 帧被切断仍能拼回 / 坏帧跳过 / 用量注入 / Ollama NDJSON 与尾巴冲刷）。
「厂商不发 `index` 时两个调用不能合并」由既有 `tests/shared/types/ai-provider-toolcalls.test.ts`（6 例）守住 —— 它当场抓到过适配层的新 bug。

### 37.5 闸门

- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 0（adapter 在 shared，web 侧也能过 —— 反过来证明没有 `@main` 依赖）；
- `tests/guards` 15 文件 / 107 例：新 vendor 头注释压回 20 行；`ai-provider.ts` 换掉三份循环后 892 → 870，
  prettier 重排后会回涨一截，仍超 800 行，所以 `file-size-baseline.json` 留着并按 870 登记（这个文件同时放着
  四家 provider 与消息映射，拆分留到后续）；
- `node scripts/vendor-audit.mjs` → vendored **9** + 适配层 2，OK。

### 37.6 下一步

`core/agent-loop/src/agent.ts` 的 `ReactLoopAgent`（703 行，1 / 1）替 `core.ts` 的 `while`；之后才是旧 27 个工具并表。

## 38. 搬 DSH 的 tool-batch：取消不再留下悬空的工具调用（2026-10-25）

### 38.1 想搬 ReactLoopAgent，量完发现整类搬不动

`packages/core/agent-loop/src/agent.ts` **738 行**，`extends Service = 0`、`static inject = 0`，看起来"能搬"；但细看是
`ctx. ` **9 处**、`@deepseek-ai/dsh-` **13 个 import**、**`Session` 47 处**。`step()` 里每一次请求都从 **session log** 派生：
`session.append('assistant/message' | 'tool/call' | 'request/header' | 'turn/end')`、epoch surface、`requestHeader()`、
`toolSet.dispose()`。去掉 Session 之后剩下的真算法只有 ~40 行。

所以这一批换目标：不搬壳，搬**壳里可分离的调度算法** —— `packages/core/tools/src/batch.ts`（285 行，svc 0 / inj 0 / ctx 0）。
整类搬运要连会话重放一起搬，那是另一个量级的事；结论写进 vendor README 的"搬不动"清单。

### 38.2 我们旧调度器的真 bug：取消会留下悬空调用

旧 `scheduler.ts` 在取消时"不再起新的、已起的跑完"，但没有给**没派发**的调用任何结果。于是下一轮消息里
`assistant(tool_calls)` 列了 N 个 id、`tool` 回合只有 M 个（M < N）—— 厂商侧要么直接 400，要么模型开始胡猜。
上游 `BatchSettlement.skip` 的做法是**给每个没派发的调用补一条合成失败结果**：
`Error: tool call aborted before dispatch`（code `TOOL_ABORTED_BEFORE_DISPATCH`），这样重放永远成对。

### 38.3 搬了什么、改了什么

- `src/main/vendor/dsh/tool-batch/batch.ts`（230 行）：`executeToolBatch` / `runGroup` 的调度结构原样保留 ——
  独占调用是屏障、并行组走有界滚动池、**启动前重读 executionMode**（注册表变化能插出屏障）、
  结果按模型顺序提交（`commitReady` 只推进连续槽位）、调度器内部失败先 `allSettled` 排空再抛。
  去掉 Session / SessionSeq / `createToolResultMessage` / `BatchSettlement`；泛型化成 `BatchPipeline<Exec, Slot>`。
- `src/main/services/agent-core/scheduler.ts` 变成适配层：对外仍是 `executionModeOf` 与
  `runToolGroup(calls, from, round, deps) → {consumed, aborted, concluded}`，内部把"怎么执行一个调用"
  （`executeToolCall` → `withTimeout` → `normalizeToolOutcome` → 错误分类）填进 `dispatch`，
  把"结果落地"（results → trace → appendSession → onToolResult → modelFacing → messages）填进 `complete`。
  缺 id 的调用在 `start` 里补 `call-<round>-<index>`；`skip` 只写结果与消息，**不报 onToolStart/onToolResult**
  （界面不该给没跑过的工具画"已完成"）。
- `core.ts`：`ToolRunOutcome` 加 `concludesTurn`（上游语义：这条结果一落地本轮就结束），
  循环里 `runToolGroup` 拿到 `concluded` 就 `phase = { kind: 'finished', reason: 'completed' }` 并跳出 ——
  不必再多问模型一轮。

### 38.4 测试

- `tests/main/services/agent-core/toolScheduling.test.ts`：取消用例改断言"两个结果都在"——真跑过的第一个
  `failure === undefined`，没派发的第二个 `failure.code === 'cancelled'` 且文案含 `aborted before dispatch`；
  新增两例：直接调 `runToolGroup` 验证 **tool 回合与 assistant 的 toolCalls 一一配对**、`concludesTurn` 让本轮只问一次模型。
- 闸门顺手修两处：`core.ts` 加完 `concluded` 分支到 803 行 → 精简 `ChatTurn.toolCalls` 与工具注册表两处长注释压回 800 以内；
  `batch.ts` 头注释 25 行 → 压到 20 行（`styleContract` 上限）。
- 数字：`tests/main/services/agent-core` **20 文件 / 156 例**；`tests/guards` **15 文件 / 107 例**；
  `node scripts/vendor-audit.mjs` → vendored **10** + 适配层 2。

### 38.5 下一步

旧 27 个工具并进同一张表（单循环统一双引擎，§32）；`ReactLoopAgent` 只作参考，不再尝试整类搬运。

## 39. 开荒也走同一条循环：双引擎时代到此结束（2026-10-25）

### 39.1 最后一条分叉

§32 之后，"有项目"的所有对话都走 `ai:agentCoreRun`。只剩一种情况还在旧助手链路：
**用户还没有任何项目**。`aiStore.sendMessage` 里写着 `if (projectPath) { runAgentCoreTurn } else { window.qqbat.ai.chat }` ——
后者经 `ipc/ai.ts` 进 `services/ai/index.ts` 的 `processAiChat`（`chatRun.ts`）。

于是同一个应用里有两套行为：

|          | 旧开荒链路                                                | 循环                                |
| -------- | --------------------------------------------------------- | ----------------------------------- |
| 工具表   | `toolsForOnboarding`：3 个（search / describe / propose） | 34 个（§32 之后旧 27 个也并进来了） |
| 提示     | `ONBOARDING_HINT` 拼在助手提示里                          | `buildSystemPrompt` 的 workspace 段 |
| 提案     | `chatRun.emitProposal`                                    | 循环回执 → handler 出卡片           |
| 失败文案 | `ai:error` 之外还有 `sendFailed` 横幅                     | `ai:error`，渲染层统一一条 listener |

用户看到的就是"一开荒就变了个 AI"。

### 39.2 判断：没有工作区也是一个工作区

循环本身**不假设磁盘存在** —— 会假设的是**适配器**：工具会读文件、提示要写"工作区：<路径>"、审批要按路径判作用域。
开荒这一段的工具全是 query / 提议（不落地），提示本来就有 workspace 为空的分支，审批根本轮不到。
所以这里不该"再写一条循环"，只该**换装配**：

- 工具 = `adaptLegacyTools({ projectPath: '', role: 'builder', pendingOperations })` 后按
  `ONBOARDING_TOOLS` 过滤 → 只剩 `search_capabilities` / `describe_capability` / `propose_capability`；
- 提示 = `buildSystemPrompt('')`（`prompt.ts` 的 workspace 空分支）+ `ONBOARDING_HINT`；
- 提案 = 旧工具攒进 `pendingOperations` 的 capability 操作，`createProposal` 原样出卡片；
- **记忆 / 轮次日志 / 插话 / 预设 / trace / spill / compaction 全部跳过** —— 它们都以 `projectPath` 为键，
  拿空串去 `resolve` 就是往 cwd 里写东西（本仓库为这类事付过代价）。

### 39.3 改了什么

| 位置                                                  | 变化                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/ipc/aiAgentCore.ts:185-186`                 | `projectPath.trim() === ''` → 早返回 `runOnboardingTurn({ win, requirement, images? })`；放在 `RUNNING` 登记**之前**（开荒不与项目内运行互斥） |
| `src/main/ipc/aiAgentCoreOnboarding.ts`（新，137 行） | `ONBOARDING_MAX_ROUNDS = 8`；装配 → `runAgentTurn` → 提案/正文二选一；事件形状与主链路逐字段一致                                               |
| `src/main/schemas/ai.ts`                              | `projectPath` 由 `.min(1)` 改 `.max(500)` —— **空串 = 开荒**是合法输入，不再被 schema 挡在门外                                                 |
| `src/main/services/agent-core/prompt.ts`              | `role` / `rules` 两段改成 workspace 感知：空 → "用户还没有打开任何项目 / 这一阶段没有文件可读可写" + 5 条开荒规矩                              |
| `src/renderer/src/stores/aiStore.ts`                  | 删掉 `if (!projectPath) fail(needProject)` 与整个 `ai.chat` 分支 → 一行 `await runAgentCoreTurn(...)`                                          |
| i18n `zh-CN.json` / `en-US.json`                      | 删 `ai.agentCore.needProject`、`ai.ops.sendFailed`、`ai.ops.sendFailedBanner`（orphanKeys 闸门要求）                                           |

轮数上限比项目内的 12 小：开荒的产出是**一张提案卡片**，不是把活干完 —— 问清需求 → 查能力 → 提议，三步就该收。

### 39.4 事件形状：为什么 `projectPath` 要显式写空串

渲染层 `routeTo(projectPath)` 对空串的语义是"当前视图"，这正是开荒要的（没有项目可路由）。
所以每一个 emit 都把 `projectPath: ''` **写在字面上**，而不是省略兜底；`ai:toolCall` 的 `status`
仍按 `output.startsWith('[工具失败]')` 判 error（循环里失败是返回值，不是异常）。
收尾只有两种：有 `pendingOperations` 就发 `ai:proposal`、不发 `ai:response`（两条都发会让同一轮长出两份尾巴）。

单独一个文件也是**闸门逼出来的**：`tests/guards/agentCoreEventContract.test.ts` 第一例钉死了
`aiAgentCore.ts` 里 16 条 `ai:*` 发送的**顺序**，往里塞第四种状态只会让那条断言越来越脆；
新文件的事件顺序由它自己的测试钉。

### 39.5 测试

- `tests/main/ipc/aiAgentCoreOnboarding.test.ts`（**8 例**）：schema 允许空串且仍限长；只给 3 个工具 + 8 轮 + `ONBOARDING_HINT`
  且**不传** history/session/spill/inbox/compaction/approval；事件通道顺序与载荷键；`[工具失败]` → status error；
  有提议只发提案（validation/verdict 缺省即"未校验"）；没有模型配置；工具表为空要**明确报装配错**；循环抛错 → `ai:error` + idle。
- `tests/main/ipc/aiAgentCore-ipc.test.ts` 加 1 例「`projectPath` 为空 = 开荒装配」：断言走 `runOnboardingTurn`，
  项目内那条路的 trace / 审批一步都没碰。
- 定向：`tests/guards` + `agent-core` + `renderer` + 这两个 ipc 文件 → **16 文件 / 115 例**（`tests/guards` 单独 15 / 107）。
- `tsc -p tsconfig.node.json` 与 `tsconfig.web.json` 均 **EXIT=0**；全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`：
  **273 文件（269 passed / 4 skipped）、3401 例（3391 passed / 10 skipped）、EXIT=0**。
- 真机：**只有 mock 钉着** —— 厂商额度 403（`Free quota exhausted`）还没恢复，开荒没有真实模型跑过一轮；
  这一条如实记在这里，不要等它变成"曾经验证过"。

### 39.6 还没做完：旧引擎的物理删除

`processAiChat` / `chatRun.ts` / `ai:chat` 通道 / preload 的 `ai.chat` 都还在 —— **渲染层已无调用方**
（`grep '\.ai\.chat\('` 只剩 ipc 与 services），但删不掉的原因不是"舍不得"：

- `src/main/services/ai/lanes.ts:221`、`scout.ts:112`、`verifierLlm.ts:118` 都还在用
  `chatRun.ts` 的 `runOneRound` 当**单轮 harness** —— 并行子代理与提案复核靠它，不是助手链路的一部分；
- 约 15 个测试文件（`ai-ipc.test.ts`、evals、projectPathGuard …）还在断言这条通道。

所以下一步是**先把 `runOneRound` 抽成一个独立的单轮执行器**（从 `chatRun` 里剥出来，不依赖 `state` 的助手语义），
再把 `processAiChat` 与通道一起删。在那之前，旧引擎留着但没有任何 UI 入口 —— 这一条要写在注释里，别让人以为它还在用。

> **2026-10-25 更新**：最后**没有**抽 `runOneRound`，而是把三个消费方整块删了（`lanes` / `scout` / `verifierLlm` 都只能从旧助手链路到达，`plan_task` 在这个构建里从来没移植过）。见 §40。

---

## 40. 旧引擎的葬礼：删了什么、为什么删（2026-10-25）

上一节说"下一步先把 `runOneRound` 抽出来，再删 `processAiChat`"。**实际做的比这句更狠，也更干净**：
三个"还需要 `runOneRound`"的消费方，本来就是旧助手链路**专属**的零件 ——
它们不是独立功能，而是那条链路的并行子代理、侦察与提案复核。跟着宿主一起删，才是删干净。

### 40.1 删除面（对照表）

| 删掉的东西                                                                                       | 它在旧世界里干什么                                | 为什么可以直接删                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/services/ai/chatRun.ts`                                                                | 助手链路的 ReAct 循环（`runOneRound` 是它的单轮） | 对话已全走 agent-core；`runOneRound` 的三个消费方一并删（见 40.3）                                                                                                                                   |
| `src/main/services/ai/autoTx.ts`                                                                 | 每轮自动事务 + 失败发 `ai:needRollback`           | 审批/回滚改由「提案 → 用户确认 → 应用」承担，事务不再隐式开启                                                                                                                                        |
| `src/main/services/ai/lanes.ts`                                                                  | 并行子代理（读/写/校验分道）                      | 只从 `chatRun` 的规划分支到达；循环里工具本身已经能并行（tool-batch）                                                                                                                                |
| `src/main/services/ai/scout.ts`                                                                  | 侦察（"项目里已有什么"）                          | 只被旧提案复核与**未移植**的 MCP `plan_task` 使用（见 40.3）                                                                                                                                         |
| `src/main/services/ai/verifierLlm.ts`                                                            | 用模型复核提案风险                                | 提案复核改由确定性校验（`verifier.ts` 的 buildVerdict）承担                                                                                                                                          |
| `processAiChat` / `loadAuthorMemory` / `rememberTurn` / `notifyRollbackIfBatch` / `runningChats` | 助手链路的入口与记忆                              | 记忆/轮次由 `aiAgentCore` 的 historyStore + turnJournal 负责                                                                                                                                         |
| `ai:chat` 通道 + `aiChatSchema`                                                                  | 第二条对话入口的载荷                              | 唯一的对话入口是 `ai:agentCoreRun`                                                                                                                                                                   |
| preload `ai.chat` / `types/ipc.ts` 的 `chat`                                                     | 渲染层的第二条调用                                | 渲染层早已只调 `agentCoreRun`（§39）                                                                                                                                                                 |
| `ai:needRollback` 监听                                                                           | 旧自动事务失败时的提示                            | 只有 `autoTx` 发它；删了发送方，监听就是永不触发的死码                                                                                                                                               |
| 12 个测试文件                                                                                    | 断言旧链路行为                                    | 见 40.6：`chat-steps` / `integration` / `react-loop` / `parallelDecision` / `traceTurnIdWiring` / `autoTx` / `lanes` / `scout` / `liveModel.e2e` / `aiChatSchema` / `agentEvals` / `multiAgentEvals` |

`src/main/services/ai/index.ts` 从 **1150 行缩到约 150 行**：只剩配置读写、批处理状态机与清空历史。

### 40.2 两处不是"删"，而是"搬家"

- **`ai:stats` 搬进循环**。它喂状态条（`ChatPanel.tsx` 的轮数/工具数/token/缓存命中/上下文占用，
  经 `runStats.ts` 的 `formatRunStats` 渲染），而发送方只有旧链路。直接删 = 状态条永远空 —— 这是
  **静默丢功能**，不是删代码。现在由 `runTurn.ts` 记账、`ipc/aiAgentCore.ts` 的 `onStats` 转发：
  - `modelAdapter.ts` 新增 `onUsage` / `onLatency` / `onContext` 三个出口（只透传，归一仍在 provider 的 `normalizeUsage`）；
  - `runTurn.ts` 维护一份 `AiRunStats`：`onStep` 更新 `rounds`、`onToolResult` 累加 `steps`、
    `onUsage` 累加 token（**没回传就 `usageReported: false`，界面显示"—"，一个数都不许估算**）、
    `onContext` 记发请求前的上下文估算，收尾时再推一次并与返回值同源；
  - `contextBudget` 取本轮压缩上限，没传压缩就用 `LOOP_TOKEN_BUDGET_DEFAULT`。
- **`ai:rollbackBatch` 保留**。它不再是"事务失败自动回滚"，而是用户点界面按钮时的显式回滚
  （`aiStore` 的撤回一轮）；取消对话时若正处在批处理模式，`ai:cancelChat` 会顺手 `commitBatch`
  ——取消 = 这一轮结束了，30 秒定时器不该继续跑。

### 40.3 三个消费方去哪了（诚实记录）

- `lanes` / `scout` / `verifierLlm` 都**只**从旧助手链路到达（`grep` 过：`src` 里没有第二个进口）。
- 唯一"对外"的牵连是 MCP 的 `plan_task`：它从 10/18 构建起就**从未移植**
  （`tests/main/mcp/planTask.test.ts` 一直是 `describe.skip`，文件头写着"本构建没有 plan_task"）。
  所以删 `scout` 不是砍掉一个在用的功能，而是不再为一条没接上的路保留零件。
- 代价写在这里：**并行子代理 / 侦察 / 模型复核这三样能力在界面上不存在了**。要复活其中任何一个，
  应当按"先搬上游"的原则重做（agent-core 的工具并行已经覆盖了 lanes 的主要价值），
  而不是把 `chatRun` 挖回来。

### 40.4 过时注释一起清掉

`mcpToolGuard.ts` / `mcp/server.ts` / `aiAgentCore.ts` / `aiAgentCoreOnboarding.ts` /
`ToolRows.tsx` / `toolCatalog.ts` / `legacyTools.ts` / `promptHints.ts` / `roleHints.ts` / `aiStore.ts`
里"助手链路 / chatRun / processAiChat / 两条链路"的说法都改了。**留着旧注释比留着旧代码更坏**：
下一个人会以为那条路还在，照着它写第二套实现。

### 40.5 能力台账怎么对账

删了两个 preload 成员（`ai.chat`、`ai.onNeedRollback`），台账三处必须同步，否则 `capabilityLayering` 直接红：

1. 附录 A 删两行（`ai.chat = X`、`ai.onNeedRollback = X`）→ 附录共 **272** 条；
2. `## 二、总表` 的 `ai` 行 50 → **48**，小计按实际重算为
   R 0 · Q 84 · M 104 · P 8 · ⛔ 3 · X 73（合计 **272**）；
3. `node scripts/gen-capability-catalog.mjs` 重生成两份生成文件（272 条）。

> 教训：这套台账里有**三个不同的数**（preload 成员数、附录条数、总表行数），它们只在
> `capabilityLayering` 的断言里对齐；改一处不跑闸门，另外两处就会以"看起来对"的样子漂掉。

### 40.6 测试与闸门

删掉 12 个测旧链路的文件后，**剩下的测试仍然要能证明"没有第二条路"**，所以这一批改的是断言，不是缩断言：

- `tests/guards/ipcPayloadContract.test.ts`：删 `ai:chat` 契约与 `aiChatSchema` 导入；三条"反向对照"改用
  `ai:agentCoreRun`（11 个键）—— 闸门本身的自检不能跟着通道一起消失。
- `tests/guards/agentCoreEventContract.test.ts`：`REQUIRED_KEYS` 增 `ai:stats: ['projectPath','stats']`，
  `aiAgentCore.ts` 的期望发送序列在 `ai:response` 与 `ai:todo` 之间插 `ai:stats`（16 → 17 条）。
- `tests/guards/capabilityLayering.test.ts`：靠台账三处对齐（40.5），不是靠加白名单。
- `tests/guards/fileGrowth` / `projectWritesViaFileOps`：删掉 `ai/index.ts` 的行数登记与
  `verifierLlm.ts` 的写盘白名单（僵尸条目）。
- `tests/main/ipc/ai-ipc.test.ts`：取消用例改为断言 `cancelAgentCoreRun` + `cancelApprovalsFor` +
  `settleInstructionsFor`，并新增"批处理里取消要顺手 `commitBatch`"；`ai:isRunning` 改断 `isAgentCoreRunning`；
  注册面断言 **`ai:chat` 不许回来**。
- `tests/main/ipc/projectPathGuard.test.ts`：第三条越界用例从 `ai:chat` 换成 `ai:getHistory`（读接口同样不放过）。
- `tests/main/services/agent-core/runTurn.test.ts`：新增 2 例 —— ① 两轮各回传用量要**累加**、
  `steps` 跟工具数、`contextBudget > 0`、最后一次推送 == 返回值；② 厂商没回传用量时 `usageReported === false`。

数字：

- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **EXIT=0**；
- 定向（`tests/guards` + `tests/main/ipc` + `agent-core` + `shared` + `services/ai` + `mcp`）：
  **106 文件（105 passed / 1 skipped）、1276 例（1273 passed / 3 skipped）**；
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`：
  **261 文件（259 passed / 2 skipped）、3320 例（3313 passed / 7 skipped）、EXIT=0**（166.00s）；
  上一批是 273 文件 / 3401 例 —— 差的就是被删掉的 12 个文件与它们断言的旧行为；
- `node scripts/vendor-audit.mjs`：**vendored 10 / 适配层 2，OK**（本批没动 vendor）。

### 40.7 真机冒烟：删完之后界面还活着

- 起 dev（job `pwsh-2edf95cd3cb8478d`，日志 `_recovery/dev-single-engine.log`）：
  `[bootstrap] SQLite 引擎：better-sqlite3`、`CDP 已开启：127.0.0.1:43191`、无 error。
- `node _recovery/cdp-smoke-role.mjs` → `INFO={"w":869,"h":861,"title":"H Bot 制造","roleLabel":false,"chatMount":true}`、**ERRORS=0**。
- `_recovery/ex-tools-number.js` → `{ok:true, count:35, hasTodo:true, hasOnboarding:true}`（工具表没因为删引擎而缩水）。
- 新增 `_recovery/ex-engine-surface.js` 直接验 preload 表面：
  `chatType:"undefined"、onNeedRollbackType:"undefined"、onStatsType:"function"、agentCoreRunType:"function"`
  —— **通道真的没了**，不是"没人调"；`onStats` 仍在（40.2 的搬家生效）。
- 真实模型回合仍被额度挡着（403 `AllocationQuota.FreeTierOnly`，自 §36 起未变），所以
  `ai:stats` 的数值链路由 `runTurn.test.ts` 的两条单测钉住，端到端等额度恢复后补。

---

## 41. 工具回执留多少：搬上游 output-retention（2026-10-25）

### 41.1 为什么这批不是"再写一个截断函数"

旧实现里有两处**手写的截断**，都带着同一个毛病 —— 截断是**静默**的，而且切错了方向：

- `sandbox.ts`：`stdout.slice(0, 8000)` / `stderr.slice(0, 8000)`
  - **只留开头**。命令失败的原因几乎都在结尾（最后几行报错 / 堆栈 / 汇总行），模型拿到"开头 8k"常常正好看不到那一句；
  - 而且是**收集完整个输出之后**才切（`stdout += String(d)` 一路累加），一条刷屏命令能把这 8k 之外的所有字节先塞进内存；
  - 切了也**不说**。模型以为命令就输出这么多，接着按"输出很短所以没问题"往下推。
- `core.ts` 的 `list_dir`：`.slice(0, 200)` 之后那句"还有 N 个没列"，N 是拿**未过滤**的 `entries.length` 减保留数算的 —— 噪音目录（`node_modules` 等）也算进了"还有"。

这三件事（留哪一头、内存、有没有说）都是**机械问题**，上游 `output-retention` 已经写好了，
而且它的模块注释第一句就是这个库的边界：_"The library owns ONLY the mechanical question 'what did we keep, what did we omit?'"_。

### 41.2 搬了什么（`src/main/vendor/dsh/output-retention/index.ts`）

| 上游                                                      | 搬了吗  | 说明                                                                                           |
| --------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `ItemRetainer<T>`                                         | ✅ 逐字 | 有序条目留前 N；`push()` 回报 `kept`/`truncated`；`finish()` 给 `seen/kept/omitted`            |
| `TextRetainer`                                            | ✅ 逐字 | `head` / `tail` / `headTail` 三种策略；按**字节**计；suffix 只留窗口（旧块滑动丢弃，内存有界） |
| `trimTrailingPartialUtf8` / `trimLeadingContinuationUtf8` | ✅ 逐字 | 切点落在多字节字符中间时把半个字符裁掉，结果里不会出现替换符                                   |
| `finish()` 的省略量口径                                   | ✅ 逐字 | 按**实际返回的字节**报告省略（边界裁掉的半个字符也算省略），不是按预算算                       |
| `describeOmitted` / `formatRetentionNotice`               | ❌      | 把 "Omitted N items" 这类英文写死在库里；本项目工具回执是中文                                  |
| `truncateWithoutSplittingSurrogatePair`                   | ❌      | 面向 UTF-16 字符截断（会话日志场景），我们用不到                                               |
| `RetentionNotice`                                         | ❌      | 只有被删的 `formatRetentionNotice` 用                                                          |

> 原则仍是 §36 那句：**能搬上游就别手写**。但"文案"不是算法 —— 文案按本项目语言写，
> 算法一行不改。这个区分写进了 `src/main/vendor/dsh/README.md` 的「搬算法，不搬文案」一节。

### 41.3 落地两处

1. **`sandbox.ts`（命令输出）**：`stdout` / `stderr` 各一个 `TextRetainer({kind:'headTail', headBytes:4000, tailBytes:4000})`，
   `data` 事件里直接 `push`（**不再累加字符串**），`close`/`error` 时 `finish()`。
   `CommandResult` 新增可选 `stdoutOmitted` / `stderrOmitted`（`Omitted`），
   由 `toolRetention.streamOmittedNote()` 在 `run_command` 回执末尾拼一句中文：
   _"stdout 省了 N 字节：只保留开头与结尾。要看中间那段就把命令收窄 —— 加筛选条件，或让命令自己 head/tail"_。
   顺带删掉 `core.ts` 里**第二份** `CommandResult` 定义（2026-10-23 合并沙箱时漏的），改为从 `sandbox.ts` 导入。
2. **`core.ts` 的 `list_dir` / `search_text`**：
   - `list_dir`：先过滤/排序出 `rows`，再 `retainEntries(rows, MAX_LIST_ENTRIES)` —— "还有 N 个没列"变成**真数**；
   - `search_text`：仍是**扫到上限就停**（扫全仓太贵），所以它给不出"省了多少"这个数；
     措辞改成"命中数达到上限 80；后面还有没扫到的，把 pattern 或 glob 收窄" —— 不知道的数就**不说**，
     这比编一个 N 好。

### 41.4 测试

- `tests/main/vendor/output-retention.test.ts`（10 例）：条目上限的精确计数、`push` 决策、
  非法预算抛错；`head` / `tail` / `headTail` 三种策略；**切点落在"中"字中间时结果里不许有 `\uFFFD`**
  且省略数按实际返回字节算（3）；没超预算时**不许凭空造出省略**；一帧被切成两半仍能拼回。
- `tests/main/services/agent-core/toolRetention.test.ts`（6 例）：`retainEntries` 的真数提示、
  空表/未超限不许多一句、`streamOmittedNote` 两条路都报；
  以及**真跑一条刷屏命令**（临时目录写 `big.js`，`node big.js` 往 stdout/stderr 各写 16k）：
  断言开头与结尾都在（旧实现只有开头）、中间确实被省、提示接在回执后面、总长度远小于 32k。
  用脚本文件而不是 `node -e`，因为沙箱禁引号元字符 —— 这条测试同时证明了那个限制仍然生效。

### 41.5 测试与闸门

- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **EXIT=0**。
- guards **15 文件 / 107 例全绿**（首轮红在 `styleContract` 的「文件头注释不许超预算」：
  vendored 文件头 21 行 > 20 —— 压缩后 19 行；`fileGrowth` 超限 32 个已登记 32 个）。
- 定向 `tests/main/services/agent-core tests/main/vendor tests/shared` → **39 文件 / 346 例全绿**。
- 全量 → **261 passed | 2 skipped（263 文件）、3329 passed | 7 skipped（3336 例）、153.16s**，
  比上一批（261/3320）多 2 个文件 16 例，全来自这批的两个新测试。
- `node scripts/vendor-audit.mjs` → **vendored 11 个文件 + 适配层 2 个**，上游 `dsh-v0.2.1-rc.3` 可对账。
  这一批的哈希被 prettier 改了两轮（`--update` 后 guards 又修了一次文件头），
  所以台账要**在 prettier 之后**才 `--update`，顺序反了就必然 "目标文件被手改过"。

### 41.6 一句话总结这批的教训

上游把"什么留、什么省、省了多少"当成**可观测的机械量**（每个 retainer 的 `finish()` 都回报 `seen/kept/omitted`），
我们过去把同一件事写成一句 `slice` —— 丢了两头信息、丢了内存上限、也丢了"我丢了多少"这个事实。
搬这两百行比再写一遍 `slice` 便宜，也比让模型猜"输出是不是就这么点"稳。

## 42. 过程痕迹落盘：重启之后旧轮也要有「过程行」（2026-10-25）

### 42.1 缺口在哪儿

第 37 节把对话窗口按 DSH 重排之后，**新跑的一轮**有过程行（思考 / 工具行 / 结算行），
但**重启后再看同一轮就只剩正文**。原因不在界面：`<项目>/.qqbat/ai-history.jsonl` 里每条
assistant 只写了 `{ts, role, content}`（attempt 多 `reason/ok`），思考、工具痕迹、耗时**从来没落过盘**。
界面上那些东西只活在内存里，进程一退就没了。

DSH 那边同样是"两套账"：**会话记录**里存的是可回放的块（text / reasoning / tool-call / usage），
而渲染层另有自己的投影（过程行、结算行）。我们的口径这次按它对齐：
**痕迹落盘，但只给界面看** —— 模型历史读侧默认不取。

### 42.2 落盘的形状与三条上界

`src/main/services/ai/historyStore.ts`（10/18 编译产物风格，`@ts-nocheck`）加了三个字段：

```jsonc
{
  "ts": "…",
  "role": "assistant",
  "content": "看完了",
  "reasoning": "先 list_dir 看一眼根目录",
  "trace": [{ "name": "list_dir", "args": { "path": "." }, "status": "done", "result": "data/" }],
  "turnMs": 4200,
}
```

上界是**写侧**的（读侧不再二次裁剪）：`MAX_UI_TRACE_ENTRIES = 12`、
`MAX_UI_TRACE_RESULT_CHARS = 600`、`MAX_UI_REASONING_CHARS = 2000`。
记忆文件不是日志仓库 —— 一轮跑十几次工具、思考几千字，全量落盘会让"读历史"变成读日志。
空值不写字段（空串思考写进去，读侧会以为"有思考"）。

读侧一个开关：`loadHistory(projectPath, file, { includeUi })`，**默认 false**；
`readHistoryForUi()` 就是 `{ includeUi: true }` 那条路。于是
`historyToMessages()`（模型上下文）永远看不到这三样 —— 否则模型下一轮会读到上一轮的工具回执，
等于把日志当记忆，还要付几千 token 的预算。

### 42.3 写入侧：思考得自己攒（`RunTurnResult` 不带它）

`src/main/ipc/aiAgentCore.ts` 的轮循环里：

- `let reasoningForUi = ''`，`onReasoningChunk` 里 `reasoningForUi += text`（每轮开始清空）；
  `RunTurnResult` 只回 `finalText/rounds/phase/toolResults/stats`，**没有 reasoning** ——
  想让它落盘只能在接线层攒着。
- `const turnStartedAt = Date.now()` 放在每轮开头；`turnMs = Date.now() - turnStartedAt`。
  界面那侧本来也会从 `runStartedAt` 自己算，但**重启后就没了**，所以这个数必须落盘。
- 折成记录的那一步抽到 `src/main/services/agent-core/uiTrace.ts`（`assistantHistoryEntry()`）：
  工具失败在循环里是**返回值**（`"[工具失败] …"`）而不是异常，所以 `status` 只能按前缀判。
  抽出去还有个硬理由：`aiAgentCore.ts` 贴着 800 行闸门（见 42.5）。

### 42.4 读回侧：老历史不许长空过程行

`src/renderer/src/stores/aiStore.ts` 的 `loadHistoryFromDisk()` 把三条字段映射回
`ChatMessageWithTrace`：`reasoning` 原样、`turnMs` 原样、`trace` 补一个**读回时新造**的 id
（`hist-<消息序号>-<条目序号>`，历史文件里没有 id）。**有值才挂字段** ——
老历史没有这三样，塞空数组会让每条旧消息都长出一条内容为空的过程行。

### 42.5 闸门：越过 800 行的处理

这一批把 `src/main/ipc/aiAgentCore.ts` 从 779 行推到 **810 行**（split 计数，含空行），两条闸门同时红：

- `fileGrowth`「新文件 ≥ 800 行且没登记」→ 跑 `node scripts/update-file-size-baseline.mjs` 写快照（33 个）；
- `fileSize`「又长又热的优先队列必须已登记」→ 在 `tests/guards/fileSize.test.ts` 的 `BASELINE` 里写清理由。

理由（也写进了那条登记）：这是循环的 IPC 接线中枢 —— 轮循环、16 条 `ai:*` 事件、审批/记忆/提案。
拆的路径是把事件发射抽成 `agentCoreEvents.ts`，但 `agentCoreEventContract` 闸门**逐条盯着本文件里的 emit 列表**，
所以要拆得连闸门一起改。**不为这 10 行硬拆**，下次动它时再拆。

另外 `uiTrace.ts` 里 `traceOfToolResults` 保持**不导出**（只有同文件的 `assistantHistoryEntry` 用），
否则 `deadExports` 会要求登记一条"零引用导出"。

### 42.6 测试与闸门

- 新增 `tests/main/services/ai/historyUiTrace.test.ts`（4 例）：`includeUi` 能读回三样；
  **默认读不到**且 `historyToMessages` 只有 role/content；三条上界（12 / 600 / 2000）；
  空思考与空痕迹不写字段。
- 新增 `tests/main/services/agent-core/uiTrace.test.ts`（2 例）：失败按前缀记 `error`；
  没思考没工具不留字段。
- 新增 `tests/renderer/stores/aiStoreHistoryTrace.test.ts`（2 例）：历史 → 消息映射（含 `hist-1-0` 这个 id 形状）；
  老历史不挂空字段。
- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **EXIT=0**；guards **15 文件 / 107 例全绿**。
- 定向（三组新测试 + `historyAttempt`）**11 例全绿**。
- 全量 → **266 passed | 2 skipped（268 文件）、3345 passed | 7 skipped（3352 例）、180.34s、FULL_EXIT=0**
  （上一批 265 文件 / 3344 例；多的是这 3 个新测试文件 8 例）。

## 43. LLM 重试：搬上游的 retry-policy（2026-10-25）

### 43.1 旧实现欠了四笔账

`isRetryableLlmError` / `retryDelayMs` / `withLlmRetry` 一直是手写的，跑得住，但四条边界都是错的：

1. **退避不封顶**：`baseDelayMs * 2 ** (attempt - 1)`，只有 `maxAttempts` 兜着。`retryDelayMs` 是导出函数，
   谁传个 attempt=20 就会算出 500 秒 —— 没有任何一层拦住它。
2. **抖动是加性的**（`+ random * 25%`）：只会等得更久，永不更早。多个请求同时撞 429 时，
   大家的等待都往同一侧偏，退避的意义打折。
3. **判据写死在函数里**：`status === 429 || status >= 500` 加一串网络词正则。想关掉某一类、
   想给某个 provider 放宽，只能改代码。
4. **厂商 `Retry-After` 完全没用**：服务端说"20 秒后再来"，我们 500ms 就再撞一次，
   于是一个能自愈的限流被撞成硬失败。

### 43.2 搬了什么（`src/shared/vendor/dsh/llm-retry/`）

| 文件              | 上游                                   | 搬了什么                                                                                                                                                                          |
| ----------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retry-policy.ts` | `packages/llm/llm/src/retry-policy.ts` | `resolveRetryPolicy` 逐条一致：键白名单校验、默认值（5 次重试 / 500ms 起 / 封顶 10s / 抖动 0.1）、`Object.freeze`、全部错误文案；schemastery 的 `z` 已删                          |
| `delay.ts`        | `packages/llm/llm-retry/src/index.ts`  | `localDelay`（指数按 `min(retry-1, 1024)` 封顶 → 乘 `1±jitterRatio` → **再封顶一次**）、`cancellableDelay`；**新增** `plannedRetryDelay` = 上游 `recover` 里那段 Retry-After 判断 |

`plannedRetryDelay` 是这批唯一的"新函数"，但它不含任何新判断，只是把上游 `recover` 里的这段提出来：

- 厂商给了 `providerRetryAfterMs` 且 ≤ 上限 → **就用它**（本地退避让位）；
- 给了但超过上限 → 有界策略**直接放弃**（等不起就别等），无界策略退回本地退避；
- 没给 → 本地退避。

没搬的（Cordis 面）：`apply` / `inject = ['agents','sessionProjections']`、`llm/retry` 与
`llm/retry-started` 两条会话事件、`llmRetry` 投影、`RetryId` 品牌、`settleDownstream` 瀑布、
`always` 模式下"先问下游再决定"的那套委托。

### 43.3 我们这边怎么接（`src/shared/ai/retryRunner.ts`）

- **先归类，再判白名单**：`llmFailureCodeOf` 把错误翻成故障码 —— 429→`RATE_LIMIT`、≥500→`SERVER`、
  其它有状态码→`UNKNOWN`；**没有状态码才认字**（`TRANSPORT` / `TIMEOUT`）。判据是
  `policy.retryableCodes.includes(code)`，不是正则猜消息。
- **默认 3 次尝试**（`DEFAULT_MAX_ATTEMPTS`）：上游默认是 5 次**重试**（共 6 次请求），那是给长跑 agent 的；
  我们一次聊天超时 180s，6 次会把"卡住"放大成十几分钟。要改就传 `policy`。
- **不 import `ProviderHttpError`**：只读错误对象上的 `status` / `retryAfterMs` 两个字段。
  反过来 import 会形成 `ai-provider.ts ↔ retryRunner.ts` 的循环依赖。
- **`Retry-After` 从头上抓**：`ProviderHttpError` 多了第三个字段 `retryAfterMs`，9 个 4xx/5xx 抛出点
  统一走 `providerHttpError(response, message)`（原来都是 `new ProviderHttpError(response.status, …)`）。
  两种格式都认：秒数（`"3"`）与 HTTP 日期；认不出来**返回 undefined**，不臆造一个等待值。
- 四条"不许重试"保持原样：**已吐过内容**（流式重放会把答案写两遍）、**已取消**、次数用完、
  以及 `plannedRetryDelay` 返回 `undefined`。

### 43.4 行为对照

| 场景                      | 旧实现                              | 现在                                             |
| ------------------------- | ----------------------------------- | ------------------------------------------------ |
| 第 n 次重试等多久         | `500 * 2^(n-1) + 0~25%`，**不封顶** | 指数封顶 10s，再乘 `0.9~1.1`，**乘完再封顶一次** |
| 退避的抖动方向            | 只会更长                            | 前后对称（±10% 默认）                            |
| 429 带 `Retry-After: 3`   | 忽略，500ms 后再撞                  | 等 3 秒                                          |
| 429 带 `Retry-After: 120` | 忽略，500ms 后再撞                  | 超过 10s 上限 → **不重试**，把 429 原样抛给上层  |
| 哪些错误可重试            | 代码里写死（429/5xx/网络词）        | 默认白名单，可按策略改（`retryableCodes`）       |

### 43.5 测试

`tests/shared/ai/retryRunner.test.ts`（**11 例**）：策略默认值与六条坏配置文案、退避公式（`random()` 注入
0/0.5/1 三个点）、Retry-After 三种走向、故障码分类、`429` 后重试并回报故障码、`ProviderHttpError` 的第三个
字段真的变成等待时间、默认 3 次尝试、不可重试/已吐过内容/已取消都不重试、等退避时被取消抛"已取消"、
兼容入口 `retryDelayMs`。

搬完之后 `deadExports` 闸门又量出一条：`isRetryableLlmError` 与 `abortableSleep` **生产路径零调用**
（只有测试在用）—— 它们本来是 `@shared/types/ai-provider` 的老出口，我照抄着又导出了一遍。按闸门的规矩
（"写好了没接线"要接上或写理由）直接删掉这两个出口，不留基线条目：`isRetryableLlmError` 的判断已内联进
`withLlmRetry`（`policy.retryableCodes.includes(code)`），`abortableSleep` 的角色由 vendor 的
`cancellableDelay` 承担。顺带 `ai-provider.ts` 从 870 行降到 799 行，`fileGrowth` 的登记也随之删掉。

### 43.6 闸门与真机

- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **0**。
- `node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2` → **15 文件 / 107 例**绿。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`（日志 `_recovery/full-retry.log`）→
  **Test Files 267 passed | 2 skipped (269)、Tests 3356 passed | 7 skipped (3363)、176.98s、FULL_EXIT=0**
  （上一批 268 文件 / 3352 例，差的正是新增的 11 例与那 1 个测试文件）。
- `node scripts/vendor-audit.mjs` → `vendored 13 个文件，适配层 2 个；上游快照可对账（dsh-v0.2.1-rc.3）… OK`。
- 真机（CDP 43191，869x861）：`ERRORS=0`、工具表仍 **35 个**（`hasTodo/hasOnboarding` 都在）；
  用 composer 发真实一轮（只调一次 `list_dir`）→ 正常收尾，过程行 `▸工作了 5 秒1 次工具` ——
  说明新的 `withLlmRetry` 包在 `llm.chat` 上之后日常调用没有被改坏。
- 顺手记一条与本批无关的告警（以后查）：dev 日志里偶发
  `[ipc/aiAgentCore] 待办队列落盘失败: EPERM: operation not permitted, rename …agent-inbox.json.<pid>.tmp -> agent-inbox.json`
  —— 原子写的 `rename` 在 Windows 上被占用，属既有文件锁问题，不影响这一轮对话。

**一句话**：退避这种事上游写了 195 + 257 行、把「哪些错值得再试」「等多久」「厂商让你等多久」三件事分得干干净净；
我们原来那 60 行只做对了第一件的一半。搬完之后，多出来的是**可解释性** —— 每次重试都能报出故障码与本次等待。

---

## 44. 第七批 vendor：`spill-local` —— 溢出文件私密落盘、过期自清

### 44.1 我们手写的那 76 行有四个真缺陷

工具结果超长时会被溢出到 `<项目>/.qqbat/ai-spill/`（回执里给模型一条路径，正文只留头尾）。旧实现是一句
`writeFile(join(spillDir(p), `${stamp()}-${safeName(toolName)}.txt`), text, "utf-8")`，四个问题：

| 缺陷                                         | 后果                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| 文件名只有「毫秒时间戳 + 工具名」            | 同一毫秒内两次写同一个文件 → **后写覆盖前写**，模型拿到的路径指向别人的内容 |
| `mkdir` 不带 `mode`，`writeFile` 不带 `mode` | 目录/文件权限继承 umask，溢出内容可能含 `.env`、凭据、私聊正文              |
| 从不清理                                     | `.qqbat/ai-spill/` 只增不减，项目越用越大                                   |
| 工具名直接拼进路径                           | 目前工具名来自代码（安全），但「名字即路径」这条口子不该留着                |

### 44.2 搬了什么、没搬什么

| 上游                                                    | 落点                                         | 取舍                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/spill/spill-local/src/store.ts`               | `src/main/vendor/dsh/spill-local/store.ts`   | 取落盘机制：`saveTextFile`（`session-<sha256 前 12 位>` 子目录、`randomBytes(6)` 前缀、`open(path, "wx", 0o600)` 独占创建、目录 `0o700`）、`encodeSegment`、`isErrno`。删 `privateRoot`/`DEFAULT_ROOT_PREFIX`/`mkdtempSync`（我们不建临时根，根由项目路径决定）                         |
| `packages/spill/spill-local/src/cleanup.ts`             | `src/main/vendor/dsh/spill-local/cleanup.ts` | 取清扫算法：`sweepSpillRoots`、`resolveRoot`（拒绝符号链接、校验目录属主与权限、检查祖先目录不被他人可写）、`isTrustedDirectory`、`rootIdentity`、`sweepSessionDir`、`unlinkIdempotent`、`warnSafely`。删 `DEFAULT_ROOT_RE`/`discoverDefaultRoots`/`gatherSweepRoots`（我们只有一个根） |
| `packages/spill/spill-policy/src/{retention,notice}.ts` | —                                            | 没搬：`notice` 依赖我们没搬的英文文案层（`describeOmitted`），我们的提示本来就是中文                                                                                                                                                                                                    |
| `packages/spill/spill/src/index.ts`                     | —                                            | 没搬：52 行 Service 装配层，Cordis 专用                                                                                                                                                                                                                                                 |

### 44.3 接线三处

1. **适配层** `src/main/services/ai/spillStore.ts`（101 行）：`spillDir` + `stamp`/`safeName` 保留（文件名仍可读），
   写盘走 `saveTextFile({ root, sessionId: projectPath, ... })`；保留 **7 天**（`SPILL_RETENTION_DAYS`），写盘成功后
   `scheduleSweep` 节流 1 小时做一次后台清扫（fire-and-forget）；任何失败仍 fail-open（返回 `undefined` + warn，
   调用方保留原结果、不做不可恢复的裁剪）。
2. **同步版** `src/main/services/ai/tokenBudget.ts` 的 `spillSync`：它必须同步（在同步裁剪路径里），所以只剩
   「同步」这一件事自己做，其余对齐 —— 加 `randomBytes(3)` 后缀防撞名、`mkdirSync(..., { mode: 0o700 })`、
   `writeFileSync(..., { mode: 0o600 })`。
3. **目录形状变了**：`.qqbat/ai-spill/<时间>-<工具名>.txt` →
   `.qqbat/ai-spill/session-<12 位 hash>/<12 位随机>-<时间>-<工具名>.txt`。读白名单（`core.ts` 里 `.qqbat` 整体跳过、
   `ai-spill` 例外）是**前缀匹配**，所以模型仍能 `read_file` 到旧路径与新路径；回执里给的路径就是新路径。

### 44.4 闸门三处

- `tests/guards/projectWritesViaFileOps.test.ts`：删掉 `spillStore.ts` 的旧条目（它已经不直接写盘了），新增两条 ——
  vendor `store.ts` 记 **`open:write`**（`open(path, "wx", 0o600)` 命中 `WRITE_MODES`；`handle.writeFile` 不被识别为
  fs 的 `writeFile`），vendor `cleanup.ts` 记 `unlink: 1`（`unlinkIdempotent`）。
- `tests/guards/styleContract.test.ts`：`spillStore.ts` 头注释 31 行 → 12 行，预算表用
  `node scripts/update-style-baseline.mjs` 重生成（幽灵条目会被「预算表不许有幽灵」反向断言抓住）。
- `node scripts/vendor-audit.mjs`：MANIFEST 17 条（vendored 15 + 适配层 2）。

### 44.5 测试

- `tests/main/vendor/spill-local.test.ts`（**9 例**）：目录形状与回读、UTF-8 字节数、同名两次不覆盖（`wx`）、不同
  sessionId 分目录、`../../etc/passwd` 里的分隔符被编码、POSIX 下 0700/0600、清扫只删严格超期的普通文件、
  `session-backup` 与根下散落文件不动、会话内符号链接既不删也不跟随、根不存在时静默不创建。
- `tests/main/services/ai/spillStore.test.ts`（**6 例**）：落到 `session-*` 子目录并回读、空项目/空正文不建目录、
  `.qqbat` 被同名文件占住时 fail-open + 一次中文 warn、清扫删旧留新且保留 `ai-spill` 根、清空后的会话目录被删且
  下次写盘自动重建、项目不存在时返回 `undefined`。

- 定向：两文件 **15 例**绿；`tsc -p tsconfig.node.json` **0**。
- `node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2` → **15 文件 / 107 例**绿。
- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **0**（这台机器上跑时若两个 tsc 连在一条命令里会 OOM，
  用 `NODE_OPTIONS=--max-old-space-size=4096` 并逐个跑）。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`（日志 `_recovery/full-spill2.log`）→
  **Test Files 269 passed | 2 skipped (271)、Tests 3371 passed | 7 skipped (3378)、172.94s、FULL_EXIT=0**
  （上一批 267 文件 / 3363 例，多的正是这两个测试文件 15 例）。
- 首次全量跑时 `tests/main/services/agent-core/terminal.test.ts` 两例红 + 一次 worker
  `Worker exited unexpectedly`：同一时刻系统只剩 ~7.8GB 空闲（另有 WorkBuddy / python / Trae 在跑），
  关掉残留的 dev Electron 后单独重跑该文件即绿、整套重跑也绿 —— 记在这里，下次见到同样两例先怀疑内存。

- 真机（CDP 43191，1365x1009）：造一个 136,892 字节的 `big.txt` 让模型「只调用一次 `read_file`」，一轮正常收尾
  （过程行 `▸工作了 4 秒1 次工具`），落盘结果：
  `.qqbat/ai-spill/session-34f78b5ba095/a8647ed21f1f-20261025-173705-698-read_file.txt`（136,892 字节，与原文件逐字节相等）。
  模型原话：「完整内容因超长被截断**存到了溢出文件里**」—— 说明新路径真的写进了裁剪标记、模型读得懂；
  历史 JSONL 里这一轮的 `trace[0].name = "read_file"`、`status = "done"`，界面与磁盘两边一致。
  **一句话**：溢出文件是「工具结果的另一份副本」，它就该跟工具结果一样受管 —— 独占创建防覆盖、0700/0600 防泄漏、
  过期就删防膨胀；上游把这三件事各写成一个可读的小函数，我们原来只写了「写下去」半句。

## 45. 第八批 vendor：`tool-pipeline` —— 一次工具调用怎么走完

### 45.1 缺的是「一次调用」的中间段

§38 搬来了 `batch.ts`（「这一批怎么排」：独占屏障、有界池、启动前重分类、结果按模型顺序提交、取消时
给没派发的调用补合成结果），`scheduler.ts` 的 `runToolGroup` 因此只剩一层内联 pipeline。但「一次调用」
内部其实只有一句话：`prepare` 恒 `{kind:"dispatch"}`，没有前置钩子、没有审批面、没有 guards，`complete`
把结果落盘/落界面/回灌之后就结束，取消也只在派发前判一次。对照上游 `pipeline.ts`（772 行）：

| 环节     | 上游 `pipeline.ts`                                                          | 旧 `scheduler.ts`             | 后果                                                                 |
| -------- | --------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| prepare  | 参数快照 → `tools/pre-execute` 钩子 → 审批（allow/deny/ask）→ guards        | 空实现 `async () => dispatch` | 审批只能靠每个工具自己在 `run` 里调 `ctx.gate`：漏写一个就是静默放行 |
| complete | 结果投影 → `tools/post-execute`（可 block / 换 content / 换 value）→ finish | 有落盘/落界面/回灌，没有钩子  | 结果过滤只能改工具内部，策略无法集中                                 |

§38 的 `batch.ts` 管「这一批怎么排」，`pipeline.ts` 管「这一次怎么活」。本批就是补后一半。

### 45.2 搬了什么、没搬什么

| 上游                                                        | 落点                                                                                              | 取舍                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline.ts` 的纯函数                                      | `src/main/vendor/dsh/tool-pipeline/pipeline.ts`（109 行）                                         | 取 `failClosedMode`、`cancellationText` 与两条 `TOOL_ABORTED*` 文案、`toolErrorMessage`、`failureMessageFromText`、`fuseToolSignals`、`isAborted`、`Waterfall` / `composeWaterfall`。判定与文案逐字保留；`failureMessageFromContent` 收窄成只收字符串的 `failureMessageFromText`；`fuseToolSignals` 收 `AbortController` 作 wrapper 并返回 dispose；`composeWaterfall` 返回值收 `value` |
| `ToolExecutionPipeline` 的 prepare/dispatch/complete/finish | 不搬类，按本仓 `BatchPipeline` 合同重写：`src/main/services/agent-core/toolPipeline.ts`（219 行） | 上游类依赖 `Session` / 工具集 / 审批服务 / `render`；我们只保留 prepare → dispatch 两段 + complete 里的钩子位，落盘/界面/回灌仍由 scheduler 的 `commitSlot` 做                                                                                                                                                                                                                          |
| 参数快照 + `deepFreeze`                                     | 只 `structuredClone` 值快照（失败落回原值），不 freeze                                            | 本仓工具都是同进程手写函数，设计 §9 明确不做 `freezeArgs`                                                                                                                                                                                                                                                                                                                               |
| 审批 `serviceAsk` / `checkGuards` / `post-result`           | 不搬                                                                                              | 本仓审批仍留在工具内的 `ctx.gate`；`beforeExecute` 留了钩子面，等审批上移时再用                                                                                                                                                                                                                                                                                                         |
| `validateJsonSchemaValue` / `render` / `ContentBlock`       | 不搬                                                                                              | 我们的工具回执本来就是字符串，没有 JSON schema 渲染层                                                                                                                                                                                                                                                                                                                                   |
| 内部状态 `WeakMap` / `WeakSet`                              | 适配层自己的 `WeakMap` 持 `exec → args` 快照                                                      | `exec` 只留 `callId` / `name` / `call` / `index` / `startedAt`（对齐 `tool-batch` 的 `BatchExec` 合同）                                                                                                                                                                                                                                                                                 |

### 45.3 接线三处

1. **`scheduler.ts`（209 → 197 行）**：`executionModeOf` 与 `executeToolCall` 留在原地（`executeToolCall` 的
   catch 改用 `toolErrorMessage`，不再手写 `e instanceof Error ? e.message : String(e)`）；原来内联的 `complete`
   抽成 `commitSlot(exec, slot, deps)`（`results` / `trace` / `appendSession` / `onToolResult` / 回灌 `messages` 一处
   不少）；`runToolGroup` 变成 `createToolPipeline({ …, complete: commitSlot })` → `executeToolBatch(…)`，
   `ToolGroupDeps` 加可选的 `hooks?: ToolPipelineHooks`（不传 = 无钩子，行为与旧版完全一致，测试钉住）。
2. **`agent-core/toolPipeline.ts`**：`prepare`（未知工具 / `beforeExecute` deny → `settled` 失败槽；`ask` → 拒绝，
   理由与上游逐字一致「requires approval (not yet supported)」）、`dispatch`（取消两条，见 45.4）、`complete`
   （`afterExecute` 的 block / accept 换 content 之后再交给 `commitSlot`）、`start` / `skip`（从 scheduler 原样搬，
   `skip` 文案一个字没动）。
3. **`core.ts`（798 行，离 800 红线还有 2 行）**：`Tool` 加可选 `isConcurrencySafe?: (args: Record<string, unknown>) => boolean`。
   不声明 → 按原规则（显式 `executionMode` → `category === "query"` → 独占）推断；声明了 → 必须当场返回**字面 `true`**
   才并行（`failClosedMode`，抛错也独占）。

**钩子为什么只做宿主自己用的**：只留一条 `beforeExecute`、一条 `afterExecute`，顺序执行、可短路，不做插件注册表。
理由有两条：① 本批真正要挂的是宿主自己的策略（审批 / 回执 / 记忆），不是第三方插件；② 插件注册表得先有
`plugins/kernel` 的钩子协议，那要引第二套运行时 —— 上游这条链是 Cordis 插件的入口，我们只留形状。

### 45.4 取消语义两条（本批唯一的行为变化）

| 时机                                                  | 模型看到的结果                                                         | 与旧实现的关系                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `dispatch` 前 caller 已 abort                         | `[工具失败] Error: tool call aborted before dispatch`                  | 一致（`skip` 也用它，文案没动）                  |
| body 已开跑、跑完时 caller 已 abort，且结果本来 ok    | 改判 `[工具失败] Error: tool call aborted`（`failure.code=cancelled`） | **新增**：旧实现把这次调用当成功提交，取消被吞掉 |
| body 已开跑、跑完时 caller 已 abort，但结果本来就失败 | 保留工具自己的失败文案                                                 | 一致                                             |

共同规则（与上游一致）：**已经开始跑的 body 绝不中途放弃** —— 先跑完，再把结果改判为取消；
`additionalContexts` 等附加信息在改判时保留。`skip` 那条路（还没派发的调用）文案完全没变，
旧测试的逐字断言也原样保留。

### 45.5 闸门与测试

- 新增 `tests/main/vendor/tool-pipeline.test.ts`（**10 例**）：`failClosedMode` 未声明 / 返回 `1` / 返回 `"true"` /
  抛错全独占，返回字面 `true` 才 parallel；`toolErrorMessage` 的 `Error` / `{message}` / 数字 / `null` / `Object.create(null)`；
  `failureMessageFromText` 空串与非空；`composeWaterfall` 顺序与短路（第二个不调 `next` 第三个不执行）；
  `fuseToolSignals` 任一 abort 生效、dispose 后不再传播；`cancellationText` 两态；四条文案常量逐字。
- 新增 `tests/main/services/agent-core/toolPipeline.test.ts`（**9 例**）：未知工具 → settled；`beforeExecute` deny 且不调
  `tool.run`；deny 时 `onToolResult` 收 `ok:false`；派发前 abort 用 before-dispatch 文案且不调 `tool.run`；body 中 abort
  且 ok → 改判 aborted 且 `startedAt` 保留；body 中 abort 但本来失败 → 不改写；`afterExecute` block → 模型收到
  `[工具失败] <feedback>`；`isConcurrencySafe` 只认字面 `true`；`isConcurrencySafe` 抛错 → exclusive。
- `toolScheduling.test.ts`：更新「取消」用例（slow 跑完才取消的调用从「无 failure」变成 `failure.code=cancelled` 且文案逐字
  `[工具失败] Error: tool call aborted`）；新增 3 例 —— 不传 hooks 时 `runAgentLoop` 结果 / args / output / failure / phase
  与旧版一致、hooks 经 `runToolGroup` 生效、初始 abort 时 skip 文案逐字 before-dispatch。
- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **0**（两个 tsc 分开跑，`NODE_OPTIONS=--max-old-space-size=4096`）。
- `node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2` → **15 文件 / 107 例**绿。
- 定向 `tests/main/vendor tests/main/services/agent-core` → **26 文件 / 207 例**绿。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`（日志 `_recovery/full-tool-pipeline.log`）→
  **Test Files 271 passed | 2 skipped (273)、Tests 3393 passed | 7 skipped (3400)、157.55s、FULL_EXIT=0**
  （基线 269 / 3371 / 7；多的两个文件、22 例正是上面两个新测试文件 + `toolScheduling` 新增的 3 例）。
- 提交后在整仓（HEAD `3daa355`）复跑最后一遍闸门：`NODE=0`、`WEB=0`、guards **15 文件 / 107 例**、全量
  **271 passed | 2 skipped (273)、3393 passed | 7 skipped (3400)、181.29s、FULL=0**、vendor-audit OK —— 与上面阶段内的数字一致（耗时差是机器负载）。
- `node scripts/vendor-audit.mjs`：**vendored 16 个文件，适配层 2 个；上游快照可对账（dsh-v0.2.1-rc.3）；OK**。
- 闸门侧的代价：core.ts 798 行（红线 800，本批只加 5 行）；两个新文件都有 `@upstream` 头；`deadExports` 的临时登记全部撤掉，
  只剩 `fuseToolSignals` 一条（生产侧直接用 caller 的 signal，不另建 wrapper，保留给以后接内部取消源用）。

### 45.6 真机（CDP 43191，1365x1009）

真机（CDP 43191，视口 1365x1009）。dev 启动照 §8：先确认 43191 空闲、无 electron 残留，`Remove-Item Env:ELECTRON_RUN_AS_NODE`，
`$env:QQBAT_CDP_PORT='1'`，后台 `node node_modules/electron-vite/bin/electron-vite.js dev *> _recovery/dev-tool-pipeline.log`；
日志里出现 `CDP 已开启：127.0.0.1:43191`。探针按 §8 原样跑，没有改脚本，也没有直调 `window.qqbat.ai.agentCoreRun`：

| 探针                                                                                  | 结果                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `node _recovery/cdp-smoke-role.mjs`                                                   | `ERRORS=0`、`chatMount=true`（重载后页面正常挂载）                                     |
| `node _recovery/cdp-eval.mjs _recovery/ex-tools-number.js`                            | `{ok:true, count:35, hasTodo:true, hasOnboarding:true}`                                |
| `node _recovery/cdp-eval.mjs _recovery/ex-ui-compose3.js`                             | `"sent"`（真实入口：textarea 原生 setter + 发送按钮；指令「只调用一次 list_dir」）     |
| 30s 后 `node _recovery/cdp-eval.mjs _recovery/ex-ui-check.js`                         | `turnProcess=4`（含历史行），最新一行 `{"state":"done","text":"▸工作了 3 秒1 次工具"}` |
| `QQBAT_VIEWPORT=1365x1009 node _recovery/cdp-shot.mjs _recovery/ui-tool-pipeline.png` | 截图 1365x1009（100 068 字节）                                                         |

结论：**真机通过** —— 35 个工具在册、真实回合有过程行（「工作了 3 秒1 次工具」）、渲染层 `ERRORS=0`。
日志里另有一条主进程 warn：`[ipc/aiAgentCore] 待办队列落盘失败: Error: EPERM … agent-inbox.json`；
同样的 warn 在本批之前的 `_recovery/dev-agent-ui.log` / `dev-spill.log` / `dev-retry.log` 里都有（开发态文件占用的一过性问题），
与本批的工具链路无关。

## 46. 第九批：审批的单一入口（2026-10-26）

### 46.1 在这之前，闸门有三处，各问各的

| 动作                      | 谁问                                                         | 问成什么                                                      |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| 写文件                    | <code>write_file</code> 的 run 里内联 <code>ctx.gate</code>  | <code>{kind:"write",path}</code>                              |
| 跑命令                    | <code>run_command</code> 的 run 里内联 <code>ctx.gate</code> | <code>{kind:"command",command}</code>                         |
| **插件 / 宿主注册的工具** | **没有人问**                                                 | ——                                                            |
| 旧 27 个工具（适配器）    | 不问（提案制）                                               | 但审批那边把它当 <code>command</code>：拿**工具名**冒充命令行 |

前两行的文案逐字留着（模型和历史测试都对得上），问题在后两行：

1. **插件工具标着 mutation 却从不问人**。工具集里 <code>category</code> 一直有，闸门却只看"是不是内置那两件"——
   新装一个会写盘的工具（市场里那三个示例不走写盘，但协议允许）就是零审批执行。
2. **策略表分叉**。IPC 那边把审批请求折成 <code>kind: "write" | "command"</code> 两种规则键，
   工具名冒充 command 后，"以后别再问"记下的是一条**不存在的命令**。

所以本批不是"再加一类审批"，是**把审批从工具里搬出来，只留一个入口**。

### 46.2 入口：<code>toolPipeline.prepare</code>（不在工具里）

第 45 批搭好的 prepare 正好是那个位置 —— 它已经知道"这次调用是哪个工具、参数是什么、有没有被钩子拦"。
现在它多两段：

| 顺序 | 动作                                                        | 说明                                                                                |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ①    | 未知工具 → <code>settled</code> 失败                        | 没变                                                                                |
| ②    | <code>beforeExecute</code> 钩子                             | <code>deny</code> → 失败；<code>ask</code> → 走 <code>askGate({kind:"tool"})</code> |
| ③    | <code>approvalRequestOf(tool, args, ctx)</code>             | 显式声明优先；没声明按 <code>category</code> 推断（mutation 一律要问）              |
| ④    | <code>if (approval &amp;&amp; ctx.gate) askGate(...)</code> | 拒绝 → <code>settled</code> 失败，**不派发**                                        |

**没有闸门 = 不改变旧行为**（脚本、单测、宿主没接审批的形态：不问人，直接跑）。
一旦调用方接了闸门，声明要审批的调用就**必须**过 —— 这是本批唯一的语义变化，也是插件工具被补上的那道口子。

<code>askGate</code> 三条纪律（注释里也写了）：

1. **没有闸门 ≠ 放行**。钩子说 <code>ask</code> 而没人可问时 fail-closed：
   <code>[工具失败] 没有可用的审批通道，这次调用没有执行：工具 x</code>。
   （工具自己声明的审批在 prepare 里不会走到这条 —— 没闸门直接跳过，见上。）
2. **闸门抛异常 = 拒绝，但原因要留着**。角色写域就是这么拒的（<code>throw new Error("代码助手不能改 flow.json")</code>），
   变成 <code>[工具失败] &lt;原因&gt;</code> 回灌给模型，不吞成一句"未通过闸门"。
3. **拒绝文案按类别固定**：写 / 命令两条与搬之前**逐字相同**（历史断言不用改），工具那条新起：
   <code>[工具失败] 工具 market_coin 被拒绝（未通过闸门）</code>。

### 46.3 形状：<code>GateRequest</code> 三类 + 工具自己声明"问什么"

<code>GateRequest</code> 加了第三类 <code>tool</code>：

| kind                 | 谁产生                                                                       | 审批标题 / summary                   | "以后别再问"的匹配键                        |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| <code>write</code>   | <code>write_file.approval</code>（路径先过 <code>resolveInWorkspace</code>） | 路径                                 | 路径规则（<code>writeRuleMatch</code>）     |
| <code>command</code> | <code>run_command.approval</code>（trim 后的命令）                           | 命令                                 | 命令规则（<code>commandRuleMatch</code>）   |
| <code>tool</code>    | 没声明的 mutation（默认推断）/ 钩子 <code>ask</code>                         | 工具名 + 参数 JSON（&gt;160 字截断） | 工具名 + 参数（<code>toolRuleMatch</code>） |

工具这边只加一个可选声明（<code>Tool extends ApprovalTool</code>）：

<code>approval?: (args, ctx) =&gt; GateRequest | null</code>

- 返回 <code>null</code> = 这次不用问。**旧 27 个工具全走这条**：它们的 mutation 是提案制
  （界面点确认才落盘），prepare 再问一遍就是重复审批 —— <code>adaptLegacyTool</code> 里显式
  <code>approval: () =&gt; null</code>，而不是靠"忘了声明"。
- 不声明 = 按 <code>category</code> 保守推断。宁可多问一句，不要少问。
- 声明里抛异常（路径越界）也算拒绝：<code>settled</code> 失败，原因回灌。

### 46.4 新文件 <code>toolGate.ts</code>：不是拆着玩

三个理由叠在一起，正好都在这个文件上：

1. **循环依赖**：<code>toolPipeline.prepare</code> 要 <code>approvalRequestOf</code>，而它要 <code>Tool</code> 类型；
   <code>core.ts</code> 又要 prepare 的 <code>BatchPipeline</code> 类型。契约（<code>GateRequest</code> / <code>ToolContext</code>）
   和推断规则有自己的家，prepare 就不必反过来 import core。
2. **行数红线**：就地加完是 **854 行 &gt; 800**，<code>fileGrowth.test.ts:78</code> 与 <code>fileSize.test.ts:233</code> 两例当场红。
   搬走 <code>GateRequest</code> + <code>ToolContext</code> + <code>toApprovalRequest</code> + <code>approvalRequestOf</code>
   之后 **774 行**，两个守卫都绿 —— 不是登记豁免，是真搬走了。
3. **一个出处**：<code>Tool</code> 改成 <code>extends ApprovalTool</code>，审批字段与它的文档只有一份，不会再"改了一处忘了另一处"。

<code>core.ts</code> 保留 <code>export type { GateRequest, ToolContext } from './toolGate'</code>，其它模块照旧从 core 拿
（19 处 <code>ToolContext</code> 引用一行没改）。

顺带删掉 <code>src/main/services/ai/legacyToolAdapter.ts</code>：全仓零引用（阶段 1 的旧适配器），
<code>deadExports</code> 基线里那两条一起撤。

### 46.5 IPC：第四种 kind 要四处登记

<code>ApprovalRequest</code> 的 <code>kind</code> 从 <code>"write" | "command"</code> 变成三值，<code>tool?: string</code> 带上真名。

- <code>TOOL_NAME</code> 加 <code>tool: "tool"</code>；<code>toolNameOf(req)</code> 给弹窗标题用真名（不是工具名冒充的 summary）；
- <code>describeToolRequest</code>：<code>工具 x 想这样调用：{…}</code>，参数 JSON 超 160 字截断（弹窗不该被一个巨型参数撑爆）；
- <code>approvalArgs</code> 的 tool 分支：<code>{ tool, ...req.detail }</code> —— 规则匹配与"别再问"存的是同一份；
- <code>ruleKindOf</code> 返回三值；<code>matchOf</code> 的 tool 分支走 <code>toolRuleMatch(name, args)</code>。

**角色写域闸没动**：它仍是在 <code>write</code> 分支里 <code>throw</code>，靠 <code>askGate</code> 的 catch 变成
<code>[工具失败] &lt;原因&gt;</code>。也就是说这一次没有新增"能不能做"的判定，只是把"要不要问"收拢了。

### 46.6 测试

- <code>tests/main/services/agent-core/toolPipeline.test.ts</code> **+8 例**（9 → 17）：
  没声明的 mutation 也要过闸（并断言闸门收到 <code>{kind:"tool",tool,args}</code>）；
  mutation 被拒 → 不派发、文案逐字；<code>query</code> 不问人；
  显式声明优先（同是 mutation，报的是 <code>write</code> 而非默认 <code>tool</code>）；
  <code>approval: () =&gt; null</code> ⇒ 不问；闸门抛错 ⇒ <code>[工具失败] &lt;原因&gt;</code> 且不派发；
  没有闸门 ⇒ 旧行为照跑；声明自己抛错 ⇒ settled 失败。
- <code>tests/main/services/ai/legacyToolAdapter.test.ts</code> **+1 例**：适配出来的 query / mutation
  <code>approval()</code> 都返回 <code>null</code>（提案制已确认，别再问）。
- <code>tests/main/services/agent-core/core.test.ts</code>：四个闸门用例改走真实循环（<code>runOne</code> 走
  <code>runAgentLoop</code> + <code>CORE_TOOLS</code>）—— 闸门搬走之后再 <code>tool.run(...,{gate})</code> 已经不经过它，
  直接调工具断言"被拒"会变成断言空气。helper 返回 <code>{...entry, ok: !entry.failure}</code>，让断言读得懂。
- 定向：<code>tests/main/services/agent-core</code> + <code>legacyToolAdapter</code> → **24 文件 / 193 例**绿；
  guards → **15 文件 / 107 例**绿（两例行数红线随 774 行消失）。

### 46.7 闸门

- <code>tsc -p tsconfig.node.json</code> = **0**、<code>tsc -p tsconfig.web.json</code> = **0**（分开跑）。
- guards **15 文件 / 107 例**绿（§45 之后两例行数红线随 core.ts 回到 774 行自动消失，没登记豁免）。
- 全量 <code>node node_modules/vitest/vitest.mjs run --maxWorkers=2</code>（日志 <code>_recovery/full-gate-single-entry.log</code>）→
  **Test Files 271 passed | 2 skipped (273)、Tests 3402 passed | 7 skipped (3409)、FULL_EXIT=0**
  （基线 3393 → +9：toolPipeline 8 + adapter 1）。
- prettier 过了 10 个改动文件。

## 47. 第十批：安全压缩（compaction-basic 本体，2026-10-26）

### 47.1 之前的三个窟窿

| 窟窿                 | 现状（本批之前）                                                                 | 后果                                                                                 |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 保留区只数条数       | <code>planCompaction</code> 的 <code>end = turns.length - keep</code>，默认 8 条 | 一条 24k 字符的工具输出能顶掉几十条短消息；"至少留几条"跟"还剩多少预算"无关          |
| **工具配对完全没管** | 切口随手落在任意两条之间                                                         | 调用被丢进中段、结果留在尾部 → 厂商下一次请求 400，报错只有一个孤零零的 tool_call_id |
| 估算不计调用参数     | <code>estimateTurnTokens</code> 只算 <code>content</code> + 图片                 | <code>write_file</code> 的 content 上万字符不计价，压力被低估、闸门触发太晚          |

第二条尤其要说明：<code>contextGate.ts</code> 的头注释一直写着"循环不把带 tool_calls 的 assistant 回合放进 messages"，
所以"没有配不上的调用"。**这句从 2026-10-25 起就过时了** —— <code>core.ts:708</code> 推
<code>{ role: "assistant", content, toolCalls: calls }</code>、<code>scheduler.ts:147</code> 推
<code>{ role: "tool", content: facing, toolResult: facing }</code>。注释与现实分叉了两天才被发现。

### 47.2 对齐上游（<code>packages/compaction/compaction-basic</code>）的四条

| 上游                                                                                    | 本仓库                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| <code>surface[0]</code>（system）不参与压缩                                             | 头注释与逻辑都没动：<code>headEnd</code> + 紧随其后的任务句保住                              |
| 从尾部累加 token 到 <code>retainTokens</code>（<code>retainRatio</code> 默认 **0.16**） | 新增 <code>retainTokens</code>，默认 <code>budget × RETAIN_RATIO_DEFAULT</code>（16%）       |
| <code>while (!toolPairingBalancedBefore(surface[keepFromIdx])) keepFromIdx -= 1</code>  | <code>retreatToBalancedCut</code>：切口不配平就往回想（退 = 多留），退不到起点就放弃这次压缩 |
| 压完必须真的变小（最小收益）                                                            | 注记成本先算：<code>estimateTurns(dropped) &lt;= estimateTokens(note)</code> 就不落地        |

条数下限不是上游的东西，是这边的"现场"概念：<code>keepRecentTurns</code> 降级为**下限**，
与 token 保留区取**更宽**的那个（<code>max(条数下限, token 累计)</code>）。
上游没有下限、只有比例；只按比例的话，一小段预算可能把"刚刚发生了什么"整段抽走。

### 47.3 新文件 <code>toolPairing.ts</code>：配对是硬约束，坏数据不抛错

四个导出：

- <code>toolCallDelta(turn)</code>：assistant 每带一个调用 +N、tool 结果 −1、其余 0；
- <code>toolPairingCuts(turns)</code>：每个切口（0..length）配平的布尔表；
- <code>toolPairingBalancedBefore(turns, index)</code>：单个切口查询；
- <code>retreatToBalancedCut(turns, from, floor)</code>：从想切的位置往回退到配平点，退不到返回 −1。

**与上游的唯一差异**：余额为负（结果没有调用 = 数据已经坏了）时，上游直接抛
<code>tool-pairing balance: tool/result at surface seq N has no matching tool-call</code>；
这边把该切口及其之后一律判为不可切。理由写在文件头：**压缩是每轮都跑的路，
不该被一条坏数据整轮打死**。不切在坏数据旁边，比"切完再猜哪里坏了"可控。

顺带一条约束：<code>retreatToBalancedCut</code> 内部走 <code>toolPairingBalancedBefore</code>，
三个导出都有生产调用点 —— 否则 <code>deadExports</code> 的"只有测试引用"那一条会红（本批真红过一次）。

### 47.4 <code>planCompaction</code> 的五步

1. 预算内直接 <code>null</code>；
2. <code>start</code>：系统提示 + 紧随其后的任务句之后；
3. 保留量 = <code>max(keepRecentTurns 下限, 从尾部累加到 retainTokens 的条数)</code>；
4. <code>end = retreatToBalancedCut(turns, length - retained, start)</code>，返回 −1 则放弃；
5. 可压的不足 2 条 → <code>null</code>。

返回形状没变（<code>start/end/dropped/tokensBefore/tokensAfter</code>），调度器与 IPC 不用改。

### 47.5 最小收益为什么在 <code>applyCompaction</code> 而不是 plan

注记要 <code>buildCompactionNote(dropped)</code> 才量得准（确定性注记最多 1200 字符，
语义摘要最多 1200 字符），而 plan 是纯函数、预算阶段还没决定用哪种摘要。
更关键的是：**这条判断不能挡掉剪枝**。<code>applyCompaction</code> 的顺序仍是
"plan → 先剪工具结果 → 剪完重试 plan → 要贴注记前才判收益"；
收益不够时返回 <code>{ dropped: 0, pruned: n }</code>，东西留在原地，
<code>ai:compact</code> 也不会发（调用方按 <code>dropped &gt; 0</code> 判断）。

另外 <code>CompactionOutcome.tokensBefore</code> 统一成"这一轮进来时的数"，
不再因为剪枝重试而变成"剪完之后的数"。

### 47.6 计价补上工具调用

<code>estimateToolCallTokens</code>：工具名 + <code>JSON.stringify(args)</code>，走同一个
<code>estimateTextTokens</code>；JSON 序列化抛错（循环引用 / BigInt）给保守常数 16，不让估算自己把循环打死。
一条 <code>write_file</code> 带 4000 字符 content 从"只值 4"变成约 1013。

### 47.7 测试

- 新建 <code>tests/main/services/agent-core/toolPairing.test.ts</code> **8 例**：
  增减口径；配平切口；调用在中段/结果在尾部的坏切口；并发调用要等齐；孤儿结果整段不可切；越界判不安全；往回退与下限 −1。
- <code>tests/main/services/agent-core/contextGate.test.ts</code> **20 → 26 例**（+6）：
  按 token 多留（20 条 user 回合、retainTokens 100 → 尾部留 6 条而不是 2 条）；
  条数下限仍生效；配对坏切口往回退到 4（<code>dropped</code> 恰是 <code>call-a</code> + 它的结果）；
  退到起点压不动返回 null；最小收益（两条空回复 vs 注记 → 保持原样）；工具调用参数计价。
- 定向 <code>tests/main/services/agent-core</code> + <code>tests/guards</code> → **39 文件 / 307 例**绿。

### 47.8 闸门

- <code>tsc -p tsconfig.node.json</code> = **0**、<code>tsc -p tsconfig.web.json</code> = **0**。
- 全量 <code>node node_modules/vitest/vitest.mjs run --maxWorkers=2</code>（日志 <code>_recovery/full-gate-batch47.log</code>）→
  **Test Files 272 passed | 2 skipped (274)、Tests 3416 passed | 7 skipped (3423)、FULL_EXIT=0**
  （基线 3402 → +14：toolPairing 8 + contextGate 6）。
- prettier 过了 5 个改动文件。

## 48. 第十一批：预设注册表（agent-preset-registry，2026-10-26）

### 48.1 之前是"三份真相各读各的"

- **菜单自己解析文件**（<code>presetOptions.ts</code>，173 行）：容错口径与主进程不一样 ——
  菜单里看得到的预设，跑起来可能查不到；界面上也没有"这一条坏了"的任何提示。
- **运行时读两次盘**：<code>resolvePresetTools</code> 拿白名单、<code>readPreset</code> 再拿角色，
  两次之间文件被改就是白名单和角色来自不同版本。
- **坏条目静默跳过**：文件里写错一个名字，菜单里少一项，没人知道为什么。

### 48.2 磁盘形状只有一处：<code>src/shared/ai/presetRoster.ts</code>

常量 <code>PRESETS_FILE</code> / <code>PRESETS_BASENAME</code> / <code>PRESET_NAME_MAX=40</code> /
<code>PRESET_PROMPT_MAX=2000</code> / <code>PRESET_ROLES=[builder,coder,duo,creator]</code>
与三个类型（<code>AgentPreset</code> / <code>AgentPresetRow</code> / <code>AgentPresetRoster</code>）
都在这里：菜单、编辑器、主进程引同一个来源，不再各写一份常量。
对应上游 <code>agent-preset</code> 的 row/roster；<code>locked</code> 没搬 —— 预设是**按轮**语义，
不锁会话。

### 48.3 <code>parsePresetRoster</code>：三种"不好"分得很清

- <code>fileProblem</code>：整个文件读不了（不是数组 / JSON 坏 / 读盘失败），此时 <code>presets: []</code>。
- <code>broken</code>：**这一条**不可用 —— 不是对象、没有名字、名字超过 40 字、与前面的重名；
  菜单照旧列出来但禁用，并写明原因。
- <code>notes</code>：字段被忽略但整条仍可用 —— role/permissionMode 不认识、prompt 超长被截断、
  工具白名单/插件集里有 N 项不是有效名字、order 不是数字。
- <code>order</code> 只管菜单排序（没写的排在有 order 的后面，仍按文件顺序），坏条目按原序附末尾。

### 48.4 运行时 fail-closed：查不到 = 这一轮不开跑

<code>resolvePresetForRun</code> 取代"查到就用、查不到就 undefined"：

- 找不到 → <code>找不到预设「夜巡」（fileProblem）；为避免静默放开权限，这一轮没有开始</code>；
- 查到坏条目 → <code>预设「夜巡」不可用：&lt;broken&gt;；这一轮没有开始</code>。

IPC 拿到 <code>{ok:false,error}</code> 直接 <code>return {ok:false,error}</code>，**不调** <code>runAgentTurn</code>。
理由写在代码注释里：删掉预设文件里的那一行，不该等于把这一轮的权限边界静默放开。
（旧的 <code>readPreset</code> 连带删除 —— 生产无人调用，运行时只剩一个裁决口。）

### 48.5 IPC：一次读盘、两个入口

- 新增 <code>ai:getPresets</code>（<code>aiProjectPathSchema</code>，回 <code>{ok:true,data:roster}</code>），菜单不再读文件。
- <code>ai:agentCoreRun</code> 里预设只解析一次（<code>runPreset</code>），四处改读它：
  role / permissionMode / roleNote 的 prompt / <code>scopeToolsByPlugins</code> 的 plugins。
- 白名单优先级不变：本次显式传的 <code>allowedTools</code> 非空 → 用它；否则用预设里的。

### 48.6 界面与删除

- <code>AgentPresetMenu</code> 改读注册表：坏条目禁用 + line-through + "不可用"标签，
  当前预设坏了触发器带 ⚠；<code>fileProblem</code> 用琥珀色块说出来；<code>notes</code> 在 title 与
  "有字段没生效"小字里体现；可用的坏字段条目仍可选。菜单在挂载时读一次（保存预设会换
  reloadKey 重新拉）；外部直接改文件要重进项目才刷新。
- <code>PresetEditor</code> 的四个常量改从 shared 引入；<code>ChatPanel</code> 的 presetMeta 类型改 <code>AgentPresetRow</code>。
- 删除 <code>src/renderer/src/components/ai/presetOptions.ts</code> 与它的测试（解析器只剩主进程一份）。
- i18n 两份新增 <code>ai.preset.brokenTag / groupBroken / fileProblem / notesHint</code>。

### 48.7 测试与闸门

- <code>tests/main/services/ai/presets.test.ts</code> **11 例**：写读回/去重、ENOENT 空表、非数组与坏 JSON 的
  <code>fileProblem</code>、role/prompt 归一、notes（坏 role/prompt/permissionMode）、四类 broken 原因、
  order 排序、名单脏值 notes、<code>resolvePresetForRun</code> 三分支。
- <code>AgentPresetMenu.test.tsx</code> **10 例**（注册表渲染、坏条目、fileProblem、notes、回调）。
- <code>aiAgentCore-ipc.test.ts</code> **+2 例**：预设查不到 → fail-closed（不调 <code>runAgentTurn</code>、
  错误带名字）；<code>ai:getPresets</code> 原样交注册表。
- <code>tsc -p tsconfig.node.json</code> = **0**、<code>tsc -p tsconfig.web.json</code> = **0**；
  guards **16 文件 / 118 例**绿；全量 <code>node node_modules/vitest/vitest.mjs run --maxWorkers=2</code>
  （日志 <code>_recovery/full-gate-batch48.log</code>）→ **Test Files 271 passed | 2 skipped (273)、
  Tests 3418 passed | 7 skipped (3425)、FULL_EXIT=0**（第 47 批基线 3416 → +2）。
- 能力台账：<code>ai.getPresets = X</code> → ai 48→49、X 73→74、合计 272→273（X + ⛔ = 77），
  两份 generated catalog 已重生成（273 条）；prettier 过一遍全部改动文件。

## §49 第十一批：压缩的两个剩余语义（2026-10-26）

上一批（§47）把"压哪段、怎么配平、值不值得压"做对了，但触发时机与失败恢复还是旧的：
**撞线才压**、**厂商报 400 就原样抛**。这一批把 DSH `compaction-basic` 里剩下的
`thresholdRatio` 与 `context-overflow` 两个触发补上。

### 49.1 旧实现缺的两个洞

| 场景                           | 旧行为                                       | 现在                                                  |
| ------------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| 估算刚好在预算内、但已接近上限 | 不压；下一发请求把尾部大输出算进去就可能 400 | 到 `budget × 0.8` 就先压（`thresholdRatio` 可配）     |
| 厂商真的回了"上下文超了"       | 原样抛给界面，用户只能重开/删历史            | 强压到只留最后一条，重试一次；仍失败才抛原始 400      |
| 压缩结果只有计数               | 分不清"提前压"还是"救火"                     | `CompactionOutcome.trigger` = `pressure` / `overflow` |

### 49.2 为什么是 80%，为什么没搬 `headroomTokens`

上游的阈值是 `thresholdTokens = floor(min(contextWindow × thresholdRatio, contextWindow − reservedCompletion − headroomTokens))`。
我们**没有模型的 contextWindow**，只有 `LOOP_TOKEN_BUDGET_DEFAULT = 80_000` 这个硬预算，
所以把 `thresholdRatio` 映射成"预算的 80%"。留 20% 的理由：系统提示、工具 schema、图片、
模型自己的输出都不在估算器里（估算按 4 字符 1 token 保守算，但对固定开销没有感知）。

`headroomTokens` **没搬**：上游默认 65_536 是相对 1M/128k 窗口设的余量；照搬到 80k 预算，
阈值会被压到 16k，等于每几轮就压一次，和上游语义完全不同。等以后拿到真实 contextWindow 再补。

`thresholdRatio` 只收 `0 < ratio ≤ 1`；非法值（2、0、NaN）退回 0.8 —— 宁可多压一次，
也不让一个手滑的配置变成"整轮不压"。

### 49.3 溢出救火：只认 400/413/422，只留最后一条

- **识别**（`contextOverflow.ts` 的 `isContextOverflowError`）：带 number `status` 且不在
  `{400, 413, 422}` → 直接 false；否则用正文匹配中英常见说法（context length/window、
  maximum context、prompt too long、上下文长度/超出上下文/token 等）。429（限流）与 500（故障）
  有 `withLlmRetry` 的退避路径，不能被"压缩"掩盖成成功。
- **强压**（`compactForContextOverflow` → `applyCompaction(messages, opts, 'overflow')`）：
  跳过阈值与保留策略，`retained = Math.min(1, available)`（只留最后一条），`dropped` 至少 1 条。
  工具配对仍是硬约束：最后一条是 tool result 时 `retreatToBalancedCut` 退到它配对的 assistant
  call 之前，于是保留的是"调用 + 结果"两条 —— 宁可多留，不让协议断链。
- **一次**（`core.ts` 模型调用处）：`aborted` 或非溢出直接抛；`compactForContextOverflow` 返回
  null（没配压缩 / 没得压 / 剪与压都无收益）→ **抛原始 400**；有变化 → `onCompact(forced)` →
  再调一次 `opts.model(messages)`。第二发失败直接抛，不做循环救火（等价 `maxOverflowRetries = 1`）。

为什么"没变化就保留原错"：压缩失败不该盖掉"上下文超了"这个真因，否则界面只剩一句
"压缩没做成"，用户不知道该删历史还是换模型。

### 49.4 `trigger` 进 outcome

`CompactionOutcome` 增加必填 `trigger: 'pressure' | 'overflow'`。IPC 的 `onCompact` 仍只在
`dropped > 0` 时发 `ai:compact`；只剪了工具结果的救火也会回调（要触发重试），但不会多一条
"省略 N 条"的注记。

### 49.5 测试（+14）

- `contextGate.test.ts` **26 → 32**：
  - 阈值 3 例：总量在 80%~100% 之间默认就压（旧语义会漏）；`thresholdRatio: 0.95` 不压；
    非法 ratio（2 / 0 / NaN）退回默认。
  - 救火 3 例：离阈值还很远也照压且只留最后一条、`trigger === 'overflow'`；最后一条是 tool
    result 时连 assistant 调用一起留；只有 system + user 时返回 null。
- `contextOverflow.test.ts` **新 5 例**：英文 400、中文 400、429/500 即使正文有 context 也不认、
  无 status 的普通 Error 只看正文、非 Error 输入不炸。
- `core.test.ts` **+3 例**：溢出后第二发收到压缩后的消息（8 条 → 4 条）且 `onCompact` 收到
  `overflow / dropped=5`；非溢出错误只调一次并原样抛；溢出但没得压只调一次、原始 400 不被覆盖。
- 定位跑 `tests/guards tests/main/services/agent-core` = **40 文件 / 321 例**绿。

### 49.6 闸门

- `tsc -p tsconfig.node.json` = **0**、`tsc -p tsconfig.web.json` = **0**。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`
  （日志 `_recovery/full-gate-batch49.log`）→ **Test Files 272 passed | 2 skipped (274)、
  Tests 3432 passed | 7 skipped (3439)、FULL_EXIT = 0**（第 48 批 3418 → **+14**）。
- prettier 过全部改动文件。

### 49.7 真机

dev 起窗 + CDP 43191 smoke：窗口正常、控制台 0 error、`ai.tools()` 仍 35 个。阈值变化在真机上
没有可见差异（只是压缩注记会更早出现）；"厂商回 400"没法在本地伪造，救火路径由上面 8 例单测覆盖。

### 49.8 明确没做

`headroomTokens`（缺 contextWindow）、`compactionRetries`（我们的 plan 一次丢掉整个中段，
二次压没有合法收益）、`compactNow / modelSwitch` 触发、`overflowRetries > 1`。

## §50 第十二批：预设会话锁（2026-10-26）

§48 把预设做成了注册表，但预设仍是"每一轮都能改"的选择：这一轮以「只读巡检」开始，
下一轮在同一个会话里换「全放行」，权限组合就放开了 —— 这不是 DSH 的 `agent-preset` 语义。
这一批补上**会话锁**：会话开始过一轮之后，预设固定，换名直接拒绝。

### 50.1 锁的是线程，不是预设字段

DSH 的锁是**会话级**的（`packages/preset/agent-preset-registry/src/index.ts:369`）：
会话已经启动过，换 preset 抛 `RemoteError('agent-preset/locked','This session has already started',{sessionId,agentPreset})`。
空白会话仍可换，选择会落盘，resume/fork 靠会话投影的 `agentPreset` 重建。

qqbat 的会话单位是**线程**（`default` 或 `t-xxx`），所以锁也按线程：

- 锁文件 = `threadFile(projectPath, threadId) + '.preset.json'`
  （default → `.qqbat/ai-history.jsonl.preset.json`，其它 → `.qqbat/ai-history/<id>.jsonl.preset.json`）；
- 内容只有 `{ "preset": "只读巡检" }`（`null` 也是真实值 = 跟页面）；
- **不新增 IPC**：`ai:getPresets` 扩成可选 `threadId`，带就多回一个 `session`
  （`{started,preset,locked,problem?}`），菜单据此禁用换预设。这样 capability catalog、
  权限策略、文档登记都不用为一读一写再开两条通道。

实现：`src/main/services/ai/presetLock.ts`（`presetLockFile` / `writePresetSession` /
`clearPresetSession` / `decideSessionPreset` / `readPresetSession`），形状放
`src/shared/ai/presetRoster.ts` 的 `PresetSessionState`。

### 50.2 四种状态，坏数据不留模糊

| 线程状态                    | 锁文件                   | 行为                                               |
| --------------------------- | ------------------------ | -------------------------------------------------- |
| 空白（`past.length === 0`） | 缺失/坏                  | 用这一轮传的值；坏锁可以覆盖（还没有"过去"可保护） |
| 已开始                      | 缺失（§48 之前的老会话） | 视为跟页面锁：显式换名拒绝；不传则沿用 null        |
| 已开始                      | 有记录                   | 同值放行；异值拒绝；这一轮没传就沿用记录           |
| 已开始                      | 读不出来                 | fail-closed：这一轮根本不开始，先清空会话          |

拒绝文案分两档，都带**怎么修**：

- 有记录换名：`这个会话已经以预设「只读巡检」开始，不能再换成「全放行」。要换预设，先清空这个会话。`
- 锁坏了：`这个会话的预设记录读不出来（锁文件不是对象）。为了不悄悄换掉权限组合，这一轮没有开始；先清空这个会话再选预设。`

为什么老会话"缺失"要按跟页面锁，而不是"没有记录就随便换"：§48 之前写过的会话也可能
已经跑过带权限的轮次，只是当时没存锁；这时放行换名等于**静默提权**。宁可让用户清空重开。

### 50.3 运行时顺序：先裁决，再解析，最后落锁

`src/main/ipc/aiAgentCore.ts` 的 `ai:agentCoreRun`：

1. `past = await loadHistory(...)`（:290）—— 这一轮有没有历史，决定"空不空白"；
2. `decideSessionPreset(projectPath, threadId, past.length > 0, requested ?? null)`；
3. `!ok` → 直接 `return { ok:false, error }`，不解析、不跑模型；
4. `decision.preset` 才去 `resolvePresetForRun`（§48 的 fail-closed 仍在：查不到就这一轮不开）；
5. 解析**成功之后**才 `writePresetSession`（`decision.persist` 为真时）。

第 5 步的顺序是本批的纪律：先写锁再解析，会出现"锁里记了一个查不到的预设，下一轮永久开不了"；
写锁失败也 fail-closed ——

`这一轮的预设没能记下来（<原因>）。为了不让这个会话的权限组合变成"没人知道"，这一轮没有开始。`

### 50.4 清空会话必须连带删锁

`src/main/ipc/ai.ts` 的 `ai:clearThread` 在 `clearThread(...)` 之后 `await clearPresetSession(...)`。
记忆清空了、锁还在，用户点完"清空"再选预设会被一句"这个会话已经以……开始"挡住，
而界面已经没有任何历史 —— 看起来就是坏了。锁是会话数据的一部分，跟着会话一起清。

### 50.5 界面：锁定时只认主进程的值

`AgentPresetMenu` 拿 `threadId` 读 `getPresets`：

- `locked = session.locked`，`shownPreset = locked ? session.preset : preset` —— 触发器、勾选、
  高亮全部按 `shownPreset`；调用方 store 里残留的旧值不会盖过锁；
- 跟随页面 / 四个角色 / 每条预设都 `disabled={disabled || locked}`；「编辑预设…」仍可点
  （编辑文件不是换这一轮的权限组合）；
- 菜单顶部一条琥珀说明，坏锁优先显示 `problem`；触发器 `title` 写"要换先清空会话"；
- 锁定时 `onSessionPreset(session.preset)` 把锁值同步回 `ChatPanel`，后者比较后再 `setPreset`，
  避免无谓渲染循环。

`aiStore` 的 `newThread` / `switchThread` 改走 `get().setActiveThread(id)`：以前它们直接
`set({activeThreadId})`，只换 id 不恢复该线程的预设槽，切线程后 preset 仍是上一条线程的值。
这一处是"锁"之前就存在的漏，本批顺手钉住（测试见 50.6）。

### 50.6 测试（+16）

- 新建 `tests/main/services/ai/presetLock.test.ts` **9 例**：锁路径（default / 具名线程）、
  空白线程传值/落 null、同值放行、异值拒绝、已锁不传沿用、老会话 missing 拒绝、
  坏锁 fail-closed、空白可覆盖坏锁、清空后二次清空不抛。
- `tests/main/ipc/aiAgentCore-ipc.test.ts` **24 → 27**：锁定沿用锁值（不传 preset 也按锁跑）、
  锁定换名直接拒绝且不跑循环、空白线程解析成功后才落锁；`ai:getPresets` 带 threadId 回 session。
  该文件的 mock 里新增 `presetLock` 三函数，默认"不锁、persist:false"，老用例不受影响。
- `tests/renderer/components/ai/AgentPresetMenu.test.tsx` **10 → 13**：锁定态触发器只认锁值、
  选择项全禁用、`onSessionPreset` 被调、编辑仍可用；坏锁显示原因；未锁定不回写。
- `tests/renderer/stores/aiStorePresetThread.test.ts` **2 → 3**：新线程不继承旧线程预设，
  `switchThread` 切回去能恢复。
- 定位跑（guards + ai + agent-core + 上面三个文件）= **55 文件 / 447 例**绿。
- 全量 \`node node_modules/vitest/vitest.mjs run --maxWorkers=2\`（日志 \`_recovery/full-gate-batch50b.log\`）
  = **273 passed | 2 skipped（275 文件）**、**3449 passed | 7 skipped（3456 例）**、\`FULL_EXIT=0\`；
  guards 单独 **15 文件 / 107 例**；tsc node/web 均 0。
- 真机（CDP 43191，截图 \`_recovery/ui-b50-lock.png\`）：\`getPresets\` 对 default 线程
  （38 条消息）回 \`{started:true,preset:null,locked:true}\`；菜单触发器 title 是
  「会话已锁定（跟页面）：要换先清空会话」，展开后顶部有琥珀色说明条，
  角色与预设项全部 disabled，只有「编辑预设…」仍可点。

### 50.7 闸门收尾的两个形状问题

- **preload 的载荷必须是对象字面量**：\`ipcPayloadContract\` 用正则扫 \`invoke('通道', {…})\`，
  写成 \`threadId ? { projectPath, threadId } : { projectPath }\` 会让整条通道从扫描里消失。
  改成永远传 \`{ projectPath, threadId }\`：schema 里 threadId 可选，handler 用 \`if (!threadId)\`
  区分"只读注册表"和"带锁状态"，两种调用都合法。
- **\`aiAgentCore.ts\` 810 → 916**：本批新增的是会话锁的三步顺序与 fail-closed 注释，属于
  handler 的编排而不是可复用逻辑；按 \`fileGrowth\` 守卫允许的第二种修法登记快照
  （\`node scripts/update-file-size-baseline.mjs\`），提交信息里写明"认这笔账"。
  同一轮快照顺带收进了第 48/49 批遗留的几行（capabilityCatalog.generated、ChatPanel、
  types/ipc、preload、aiStore），它们都还在原守卫的 +80 行容差内，只是快照落到了真实行数。

### 50.8 明确没做

内置预设（DSH 的 `builtin` 行）、`isDefault`（第 51 批已补，见 §51）、导入导出、resume/fork 的锁复制
（qqbat 目前没有磁盘级 fork 会话的入口）、"降权换预设"（只收紧不放开的换名是否允许，
DSH 也不允许，保持一致）、锁文件的损坏自动修复（坏锁只能清空会话，不猜）。

## 51. 内置预设与项目默认（2026-10-26，第 51 批）

第 48 批的预设注册表只回答"文件里有哪几条"；第 50 批回答"这条会话还能不能换"。这一批补
另外两件事：**随程序来的预设**（不用用户写文件也有两条兜底），以及**这个项目的新会话从哪套
权限开始**（默认预设）。

两件事刻意分开：内置项是 `presets[]` 里的行，默认值是另一份文件里的一个名字。
把默认写进某条预设（比如给 `标准` 加 `isDefault: true`），删改那一条就会顺手改掉默认策略，
而且同一个数组里出现两个 `isDefault` 时"谁赢"没有天然答案。

### 51.1 内置项：随程序发布，不许同名覆盖

新建 `src/shared/ai/builtinPresets.ts`，两条（对齐 DSH 的 standard / minimal）：

| 名字       | order | role | permissionMode | allowedTools                                                                         |
| ---------- | ----- | ---- | -------------- | ------------------------------------------------------------------------------------ |
| `标准`     | 1     | 不设 | 不设（ask）    | 不设（全部工具）                                                                     |
| `最小只读` | 3     | 不设 | `ask`          | read_file / list_dir / search_text / list_nodes / check_capabilities / validate_flow |

`标准` 是"什么都没限制"的命名版本，适合当默认值；`最小只读` 把写与命令**物理上**从工具表拿掉，
不是靠提示词劝。两条都不固定角色（跟页面走），也不换模型。

与 DSH 的一处**故意不同**：DSH 允许用户文件里的同名项整体 override 内置项；我们不允许。
内置是权限兜底，同名静默换语义（比如用户写一个叫"最小只读"但带 write_file 的条目）比
"少一个可编辑项"危险得多。落地在两处：

- `parsePresetRoster` 遇到内置名 → 该条 `broken: '与内置预设「x」重名（内置预设不可覆盖，换个名字）'`；
- `writePresets` 遇到内置名 → 整表拒绝并抛 `「x」是内置预设名，不能保存；请换个名字`
  （不能只跳过那一条：用户以为保存成功了，实际写进去的数组少一条）。

名字也刻意避开常见自定义名（不叫"只读"），否则老项目第一次升级就整条变成 `broken`。

### 51.2 三层真相的合并

`readPresetRoster` 现在把三份来源合成一个 `AgentPresetRoster`：

| 层   | 来源                               | 失败形状                                                               |
| ---- | ---------------------------------- | ---------------------------------------------------------------------- |
| 内置 | 代码里的 `BUILTIN_PRESETS`         | 不会失败                                                               |
| 用户 | `.qqbat/agent-presets.json`        | 缺文件 = 空表；坏 JSON/顶层不是数组 = `fileProblem`；坏条目 = `broken` |
| 默认 | `.qqbat/agent-preset-default.json` | 缺文件 = `null`（跟页面）；坏文件/指向不可用项 = `defaultProblem`      |

合并顺序仍是第 48 批的规矩：可用项按 `order`（没写的排后面，同序保持来源顺序；内置在前），
坏条目按原序附在最后。默认值指向的那一行会被打上 `isDefault: true` —— 这是**算出来的展示
字段**，不回写预设文件（DSH 的 `remoteExportList` 也是这么算的）。

一处行为变化要记住：**缺预设文件不再返回空表**，永远至少有两条内置项。第 48 批里
"没有预设"的空态由"用户项为空"表达，不再由 `presets.length === 0` 表达。

### 51.3 默认值：单独一份文件，坏就读不懂

默认记录是 `.qqbat/agent-preset-default.json`，形状 `{ "default": "名字" }`；
`null`/缺文件 = 跟页面。写 `null` 时**删文件**，不写 `{"default":null}` —— 两种表示会在
"文件存在但没值"和"没配过"之间制造第三个状态，而它们语义相同。

`readPresetDefault` 与 `readPresetRoster` 分开读：一份坏文件不该拖死另一份；而且解析默认值
不需要先解析全部预设（热路径少一次 `JSON.parse`）。默认指向不存在/坏的条目时**不静默退回
跟页面**，而是记 `defaultProblem`，运行时由 `resolveDefaultPreset` 变成 fail-closed：

`默认预设不可用：<原因>；为避免静默放开权限，这一轮没有开始`

理由与第 48 批的 `resolvePresetForRun` 相同：默认也是权限口径，读不懂时退回页面默认等于
悄悄放宽边界。`writePresetDefault` 在服务层再校验一次目标可用（IPC 也查，但两次读之间
文件可能被改）。

### 51.4 运行时的三态：没表态 / 明确跟页面 / 明确选一个

`ai:agentCoreRun` 的 `preset` 从"可选字符串"变成"可选字符串或 null"。三态必须分开：

| 传值   | 含义                 | 行为                                               |
| ------ | -------------------- | -------------------------------------------------- |
| 字符串 | 用户明确选了这个预设 | 走第 48/50 批的解析与锁                            |
| `null` | 用户明确选了"跟页面" | **不读默认**，按跟页面跑                           |
| 缺省   | 这一轮没表态         | 只有**空白线程**才读默认；跑过的线程按 `null` 处理 |

"跑过的线程不套默认"是这一批的纪律：默认是"新会话从哪开始"，不是"旧会话可以被无声改口径"。
空白线程套上默认后，仍然要过第 50 批的会话锁：解析成功才 `writePresetSession`。

渲染层的坑在 `aiStore.runAgentCoreTurn`：以前是 `preset ?? undefined`，这会把用户明确选的
"跟页面"(`null`) 与"从没选过"(没有 key) 混成一件事 —— 空白线程于是永远套不上默认。
现在判据是 `presetByThread` **有没有当前线程这条键**：有键就原样传（含 `null`），
没键才传 `undefined`。键是 `projectPath + '::' + activeThreadId`，
用 `Object.prototype.hasOwnProperty.call` 判（不碰原型链）。

主进程顺序（`src/main/ipc/aiAgentCore.ts`）：

1. `past = await loadHistory(...)`；
2. `preset === undefined` 且 `past.length === 0` → `resolveDefaultPreset`（坏值直接 return）；
3. `decideSessionPreset(..., requestedPreset)` —— 会话锁仍在第一位；
4. `decision.preset` 才 `resolvePresetForRun`；
5. 解析成功后才 `writePresetSession`。

### 51.5 新 IPC 与能力账

新增 `ai:setPresetDefault`（`projectPath` + `preset: string | null`），handler 调
`writePresetDefault`，失败把服务层原因原样带回（界面要显示"为什么没设上"）。
能力清单附录加 `ai.setPresetDefault = X`，合计 273 → 274；两份 `*.generated.ts` 由
`node scripts/gen-capability-catalog.mjs` 重生成。`getPresets` 不新增通道：返回值多两个
可选字段 `defaultPreset` / `defaultProblem`，菜单一次读盘拿到"列表 + 锁 + 默认"。

### 51.6 界面：默认与内置是两个维度

`AgentPresetMenu` 顶部加一行"默认"下拉：`跟页面` + 全部可用预设；改选先乐观更新，
失败回滚原值并显示 `defaultProblem` 那一条文案。下拉的禁用条件是 `disabled || !projectPath`，
**不受会话锁影响** —— 会话锁管"这一轮还能不能换"，默认管"下个新会话从哪开始"，两件事。

行上的徽标也分开：`内置` 跟随程序来，`默认` 只表示当前项目默认。默认值指向的条目坏了时，
下拉保留一个 disabled 的占位项（不悄悄跳到第一项）。

`PresetEditor` 保存前预检内置名：主进程 `writePresets` 会整表拒绝，界面先拦是为了把错误
指到具体那一条；编辑器顶部常驻一句"内置不可编辑/不可同名覆盖"。

### 51.7 测试与闸门

- `tests/main/services/ai/presets.test.ts` 整篇重写：内置项永远存在、内置名不可覆盖
  （用户行 broken + 内置可用 + `writePresets` 抛）、默认写入/读取/`isDefault`/写 null 删除、
  默认坏值 fail-closed（不存在的名字 + 坏 JSON）、`writePresetDefault` 拒绝不可用名。
- `tests/main/ipc/aiAgentCore-ipc.test.ts` **24 → 31**：空白线程没表态套默认、显式 null 不读默认、
  默认坏了不跑循环、`ai:setPresetDefault` 成功/拒绝；外加第 50 批的锁用例。
- `tests/renderer/components/ai/AgentPresetMenu.test.tsx` **10 → 15**：默认下拉显示、改选调 IPC
  并移动"默认"徽标、保存失败回滚并显示原因。
- `tests/renderer/components/ai/PresetEditor.test.tsx` **11 → 12**：内置名不提交且不调
  `savePresets`。
- `tests/renderer/stores/aiStorePresetThread.test.ts` 保持 3 例（切线程恢复预设槽）。
- 定向 5 文件 = **75 例**绿；tsc node/web 均 0；guards **15 文件 / 107 例**绿。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`（日志 `_recovery/full-gate-batch51b.log`）
  = **273 passed | 2 skipped（275 文件）**、**3460 passed | 7 skipped（3467 例）**、`FULL_EXIT=0`
  （第 50 批基线 3449，+11）。
- 两处闸门收尾：`ipcPayloadContract` 登记 `ai:setPresetDefault`；`projectWritesViaFileOps`
  把 `presets.ts` 的 `writeFile` 1 → 2、新增 `rm: 1`（默认记录是应用自有数据，理由与预设文件相同）。

### 51.8 明确没做

（第 53 批已补导入导出，见 §53）内置项的图形化查看详情、默认值的"跟着当前选择走"、resume/fork 复制默认值
（默认是项目级，不需要按会话复制）、DSH 的 `selectedDefault` 与 `config.default` 双层回退
（qqbat 只有项目级默认一份，够用且不会出现"用户设置与部署默认谁优先"的歧义）。

---

## §53 第 53 批：预设导入导出（2026-10-26）

### 53.1 为什么是整表，不是单条

预设注册表本来就是**一个项目一份整表**（`.qqbat/agent-presets.json`）。单条导出/导入要额外
定义稳定的条目 id、同名策略、顺序落点；而真实需求是「把这台机器上的预设搬到另一台」。
所以这一批只做整表：导出时只写用户自己的条目（内置随程序发布，不导出），导入时按名字合并。

### 53.2 分享格式与上限

新文件 `src/shared/ai/presetShare.ts`（纯类型 + 常量）：

| 项        | 值                                                  |
| --------- | --------------------------------------------------- |
| `type`    | `qqbat-agent-presets`（固定，防止拿别的 JSON 来导） |
| `version` | `1`（只认这一个版本）                               |
| `presets` | 1..200 条声明                                       |
| 文件上限  | 256 KB（`PRESET_SHARE_MAX_BYTES`）                  |

条目只允许出现 `name / role / prompt / permissionMode / allowedTools / plugins / description / order`
这八个声明字段。`builtin`、`isDefault`、`broken`、`notes` 都是主进程内部状态，不写进分享文件。

导出（`buildPresetShare`）：读注册表 → 文件级问题/坏条目直接拒绝 → 只取非内置行 →
按生效后的值写 JSON（`exportedAt` 用导出时刻）→ 返回 `{ text, count, warnings }`。
有 `notes`（某个字段被忽略）的条目仍可导出，但会变成 `warnings` 在界面上提示，
因为导出的只能是「生效后的值」，原文件那一行不会跟着走。

### 53.3 导入的四道校验

`parsePresetShareText` 在任何写盘之前跑完，任何一道不过就整次拒绝：

1. 非空、字节数 ≤ 256 KB、能 `JSON.parse`、顶层是对象；
2. `type` 与 `version` 精确匹配；
3. `presets` 是 1..200 条的数组，每条必须是对象，**出现未知键就拒绝**（不静默 strip，
   否则用户以为导入了完整声明，实际少一半）；
4. 交给 `parsePresetRoster` 再解析一遍：有 `broken`（比如重名、名字超长、角色不认识）
   或 `notes`（有字段被忽略）都拒绝；分享文件内部同名也会在第二遍变成 `broken` 被拦下。

另外，**当前项目自己的预设文件**也要先读一遍（`readExistingForImport`）：文件级问题、
坏条目、被忽略字段都拒绝导入。原因是导入的最后一步是整表重写 —— 如果现有文件里本来
有坏条目，重写会把它「悄悄清理」掉，看起来导入成功，实际改了别的东西。

### 53.4 预览 → 确认 → 写盘

- `ai:pickPresetShare`：弹打开对话框 → `stat` 先看大小（超限不读文件）→ 读完交给
  `previewPresetImport` → 回 `{ filePath, fileName, text, preview }`。预览里只有
  `presets / exportedAt / conflicts / existingCount`，**不写盘**。
- `ai:importPresets`：重新解析原文（界面上的预览不能当授权凭证）→ 读现有 → 算同名冲突：
  - `overwrite=false` 且存在冲突：整次拒绝并列出冲突名（不是跳过冲突项 —— 半份导入
    最难解释：用户以为全进来了，实际少几条）；
  - `overwrite=true`：按名字 `Map` 覆盖/追加，最后 `writePresets` **只写一次**，
    返回 `{ added, replaced, total }`。
- `ai:exportPresets`：保存对话框 → 直接把 `text` 写目标路径，返回 `{ filePath, count, warnings }`。

三条通道都在 `src/main/ipc/aiPresets.ts`。单独开一个文件是因为 `aiAgentCore.ts` 已经贴着
行数红线，而这三条只做文件选择 + 读写，和跑循环的 handler 没有共享状态。

### 53.5 界面

- `AgentPresetMenu` 在「编辑预设…」下面加「导出预设 / 导入预设」两行（整表操作）；
  两个回调由 `ChatPanel` 提供。
- 导出：成功 `toast.success(ai.preset.exportResult)`，用户在保存对话框点取消时
  `error === '用户取消'` 不报错。
- 导入：`PresetImportDialog` 打开即调 `pickPresetShare`；取消直接关；失败可重选；
  显示文件名/导出时间/条数/项目现有条数/逐条预览（角色、审批、工具数）；有冲突时显示
  琥珀块 + 「覆盖同名项」勾选框，**未勾选时确认按钮禁用**；确认后调 `importPresets`，
  成功关闭并 `setPresetEpoch + 1` 让菜单重读注册表，再 `toast.success(importResult)`。

新增 i18n key 24 个（中英各一份），从 `ai.preset.exportAction` 到 `ai.preset.importResult`。

### 53.6 IPC、能力账与闸门登记

- 通道：`ai:exportPresets` / `ai:pickPresetShare` / `ai:importPresets`；在
  `register.ts` 里紧跟 `registerAiAllowRulesIpc()` 注册。
- preload 一律传对象字面量（`{ projectPath }` / `{ projectPath, text, overwrite }`），
  这是 `ipcPayloadContract` 能扫到载荷的前提。
- 能力三层：三条都是 X（内部，不进模型工具表）。ai 50→53、X 75→78、总数 275→278、
  X+⛔ 78→81；`node scripts/gen-capability-catalog.mjs` 重生成两份 **278 条**。
- 守卫登记：`ipcPayloadContract` 增加三条通道与 `aiPresetImportSchema`；
  `projectWritesViaFileOps` 登记 `src/main/ipc/aiPresets.ts` 的 `writeFile: 1`（目标路径
  由保存对话框选，导入只读，真正写预设表的是 `presets.ts`）；`register-all-ipc` 38→39 个域。

### 53.7 测试与闸门

- `tests/main/services/ai/presetShare.test.ts` **11 例**：导出只含自定义项、格式/版本/未知键/
  字节上限/空表/坏条目全部拒绝、预览不写盘、冲突不覆盖整次拒绝、覆盖后 added/replaced/total。
- `tests/main/ipc/aiPresets-ipc.test.ts` **8 例**：三条通道的参数校验、对话框取消、
  超限文件不读、导入透传 `overwrite`。
- `tests/renderer/components/ai/PresetImportDialog.test.tsx` **5 例**：取消关闭、错误重选、
  预览字段、冲突时确认禁用、勾选后确认并回传。
- `tests/renderer/components/ai/AgentPresetMenu.test.tsx` **16 例**（+1）：导出/导入是整表操作。
- tsc node/web 均 0；guards **15 文件 / 107 例**。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`
  （日志 `_recovery/full-gate-batch53.log`）= **276 passed | 2 skipped（278 文件）**、
  **3493 passed | 7 skipped（3500 例）**、`FULL_EXIT=0`（第 52 批基线 3468，+25）。

### 53.8 明确没做

单条导出/导入、拖拽文件到菜单、逐条勾选合并、导入前自动备份、分享文件签名或来源校验
（这是数据文件，不是可执行插件；导入仍受预设本身的权限语义约束）、把内置预设一起导出、
跨项目「导入到指定项目」（当前只导进当前项目）。

### 53.9 涉及文件

新增 `src/shared/ai/presetShare.ts`、`src/main/services/ai/presetShare.ts`、
`src/main/ipc/aiPresets.ts`、`src/renderer/src/components/ai/PresetImportDialog.tsx`；
改动 `src/main/schemas/ai.ts`、`src/main/ipc/register.ts`、`src/preload/index.ts`、
`src/renderer/src/types/ipc.ts`、`AgentPresetMenu.tsx`、`ChatPanel.tsx`、中英 i18n、
能力台账与两份 generated、4 个测试文件与 3 个守卫。

---

## §54 第 54 批：预设导入的自动备份与一键撤销（2026-10-26）

### 54.1 为什么备份的是「原始字节」

导入是整表重写：写盘前会把现有条目按标准格式重新序列化（缩进、键序、结尾换行都由程序决定）。
如果撤销也走这条路 —— 读当前表、倒推出「没有这次导入时的表」、再 `writePresets` ——
用户手改留下的空行、字段顺序、缩进全会变，等于撤销顺带重排了文件。所以撤销点存的是
导入前 `.qqbat/agent-presets.json` 的**原始字节**（base64 + sha256），撤销时原样写回；
导入前文件不存在就记 `previousExisted: false`，撤销等价于删掉这次导入写出的文件。
只备份预设表，默认预设文件（`agent-preset-default.json`）不备份：默认值是另一个语义
（§51），导入也不动它。

### 54.2 撤销点的形状

新文件 `src/shared/ai/presetUndo.ts`（纯类型 + 常量）：

| 项                                            | 值                                                     |
| --------------------------------------------- | ------------------------------------------------------ |
| 文件                                          | `.qqbat/agent-presets.undo.json`（`PRESET_UNDO_FILE`） |
| 版本                                          | `1`（`PRESET_UNDO_VERSION`，只认这一个）               |
| `action`                                      | `import`（将来别的操作要撤销得另开版本）               |
| `previousExisted`                             | 导入前有没有预设文件                                   |
| `previousSha256` / `previousBase64`           | 导入前原始字节的 sha256 与 base64；不存在时为 `null`   |
| `afterSha256`                                 | 导入完成时写出的文件 sha256，撤销前拿它比对            |
| `added` / `replaced` / `total` / `sourceName` | 只用于界面说明（`sourceName` 是导入对话框里的文件名）  |

读出来给界面的 `PresetUndoState` 只带 `available`、展示字段和 `problem`；磁盘上的
`previousBase64` 不出主进程。渲染层不自己拼错误文案：所有拒绝原因由主进程给
（`PresetUndoState.problem` / `error`），界面只负责显示。

### 54.3 一级撤销点：什么时候失效

- 只保留最近一次「有变化」的导入；再导入一次就覆盖旧点。
- `readPresetUndo` 三种结果：没有文件 → `{ available: false }`（不报 problem，菜单不显示
  按钮）；记录坏了（JSON 解析失败、版本不认识、字段矛盾）→ `{ available: false, problem }`，
  坏记录**不自动删**（先别毁证据）；记录合法但当前预设文件 sha256 ≠ `afterSha256` →
  失效，提示「导入之后预设文件又被改过，撤销已失效」。
- 撤销写入前再校验一遍：没有撤销点 / 记录坏了 / 当前文件被改过 / 备份自己 sha 对不上，
  一律拒绝且**一字不写**；写回后再复核一次 sha，对不上报「撤销写入后校验失败…」
  （多半是文件被占用）。成功后删撤销点。

### 54.4 无变化的导入不换撤销点

`importPresetShare` 解析后先算 `added/replaced`；如果都是 0，再把「按本次合并结果序列化
出来的字节」与导入前的原始字节逐字节比较，相同就返回 `unchanged: true`：不写盘、不动旧
撤销点。这样「把同一份分享文件再导一遍」不会把上一次真正改动的撤销点冲掉。文档 §5.2
只按计数判断；因为 parser 拒绝空 `presets`，计数全 0 的分支原本不可达，这一批补成按字节
判断，「无变化导入」的验收才真正成立。

### 54.5 导入顺序与失败语义

1. `capturePresetUndo`：读旧字节。`ENOENT` → `previousExisted:false`；其它读错误直接抛，
   导入中止（读不出旧文件就没法承诺可撤销）。
2. `writePresets`：整表一次写。
3. `writePresetUndoPoint`：记录「导入后的 sha256」。这一步失败**不让导入失败**：返回
   `undoProblem`，并 best-effort 删掉旧撤销点（旧的已经不匹配新表，留着只会骗人）。
4. 撤销成功后删撤销点。

失败语义因此是「导入成功但这次没有撤销机会」，界面上是 warning 而不是 error。

### 54.6 界面

- `AgentPresetMenu` 在「导入预设…」下面加「撤销上次导入…」：有记录且 `available` 才可点；
  有 `problem` 就禁用并用 `title` 说明原因；没有记录不渲染。重新加载（换项目/线程/预设更新）
  开头先清空旧撤销点，避免新数据回来前把上一个项目的撤销按钮点下去。
- `PresetUndoDialog` 单独确认（撤销动的是磁盘上的整张表，不是这一轮的权限组合）：显示
  导入时间、来源文件（没有就「（未记录）」）、新增/覆盖/总数、恢复目标（导入前有文件 →
  恢复原始字节；没有 → 删掉这次写出的文件）+ 琥珀警告；失败红字留在框内可重试；成功由
  `ChatPanel` 关框、`presetEpoch + 1` 让菜单重读并 toast `undoDone`。
- 导入完成 toast 分三支：`unchanged` → info；`undoProblem` → warning（导入成功、撤销点
  没写成）；否则 success。
- i18n 中英各新增 17 个键（`ai.preset.undo*` / `importUnchanged`），`importResult` 改成单参
  `{n}` 只报总数；恢复目标拆成 `undoRestoreFile` / `undoRestoreRemove`、来源未记录
  `undoSourceUnknown`（文档 §7 只列了 `undoRestoreTo`，拆分是为了不在组件里硬编码中文，
  也过 `noHardcodedCopy` 闸门）。

### 54.7 能力账、闸门与测试

- 能力三层：`ai.undoPresetImport` 是 X（内部）；ai 53→54、X 78→79、合计 278→279、
  X+⛔ 81→82；`node scripts/gen-capability-catalog.mjs` 重生成两份 **279 条**。
- `ipcPayloadContract` 登记 `ai:undoPresetImport`（`aiProjectPathSchema.shape`），
  `ai:importPresets` 载荷补 `sourceName`；`projectWritesViaFileOps` 登记
  `src/main/services/ai/presetUndo.ts` 的 `rm: 2`（写预设与删撤销点都在该文件里
  `atomicWrite`/`rm`，不进直写统计）。
- 测试：`tests/main/services/ai/presetUndo.test.ts` **11 例**（新）；`presetShare.test.ts`
  11→**13**；`aiPresets-ipc.test.ts` 8→**12**；`aiAgentCore-ipc.test.ts` 31→**32**
  （`ai:getPresets` 带回撤销点）；`PresetUndoDialog.test.tsx` **4 例**（新）；
  `AgentPresetMenu.test.tsx` 16→**19**；`PresetImportDialog.test.tsx` **5**（断言 `sourceName`）。
- tsc node/web 均 0；guards **15 文件 / 107 例**。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`
  （日志 `_recovery/full-gate-batch54.log`）= **278 passed | 2 skipped（280 文件）**、
  **3518 passed | 7 skipped（3525 例）**、`FULL_EXIT=0`（第 53 批基线 3493，+25）。
- 真机（dev + CDP 43191，§9.2 探针）：导入后 `getPresets` 带回 `undo.available:true`
  （sourceName/计数正确）；撤销后预设文件 sha256 回到导入前的值、撤销点文件自动删除；
  再导入一次后手改预设文件（追加空白，文件仍可解析），撤销返回 `ok:false`、错误点名
  「当前 sha256 … 导入完成时 …」、文件一字未动。界面在真实项目上走通「菜单出现撤销按钮
  → 对话框显示撤销点信息 → 确认后 toast、按钮消失」，撤销后预设表 sha256 与导入前一致。

### 54.8 明确没做

多级撤销 / redo、绕过 sha 校验的强改、编辑器保存与撤销点的合并（在被导入之后保存预设
就会让撤销点失效，按设计如此）、备份默认预设文件、分享文件签名或来源校验、跨窗口锁
（两个窗口同时导入/撤销是未定义行为）、把撤销点写进分享文件。

### 54.9 涉及文件

新增 `src/shared/ai/presetUndo.ts`、`src/main/services/ai/presetUndo.ts`、
`src/renderer/src/components/ai/PresetUndoDialog.tsx`、
`tests/main/services/ai/presetUndo.test.ts`、`tests/renderer/components/ai/PresetUndoDialog.test.tsx`；
改动 `src/shared/ai/presetShare.ts`、`src/main/services/ai/presetShare.ts`、
`src/main/services/ai/presets.ts`（抽出 `serializePresets` 用来预测「这次导入会写出什么字节」）、
`src/main/schemas/ai.ts`、`src/main/ipc/aiPresets.ts`、`src/main/ipc/aiAgentCore.ts`、
`src/preload/index.ts`、`src/renderer/src/types/ipc.ts`、`AgentPresetMenu.tsx`、`ChatPanel.tsx`、
`PresetImportDialog.tsx`、中英 i18n、能力台账与两份 generated、5 个既有测试文件与 2 个守卫。

---

## §55 第 55 批：DSH 小件快搬（工具超时 / 时间上下文 / 文件观察门）（2026-10-26）

### 55.1 为什么是这三件，为什么不是那三件

上游盘点（52 个包组 / 363 个包 / 41.4 万行源码）之后，先从「纯补技术缺口、不新增

IPC 能力、不碰产品面」的候选里挑了三个小件。选择标准只有一条：**这三件都是宿主

该管、而现在没管的事** —— 工具没有超时预算、模型不知道"现在几点 / 距上一条多久"、

覆盖文件前不要求先读过。

同一批里量过、看过源码但**明确不搬**的三件（理由见 §55.5）：`mcp-resources`（上游是

MCP **client** 的资源工具，本仓是 MCP **server**，角色反向）、`command-compact`（本仓

没有斜杠命令框架，也没有跨轮手动压缩入口）、`preset/persona`（要动 AgentPreset 的

schema 与分享格式，留待预设批次）。

设计文档：`docs/ai/dsh-small-packages-batch55-design.md`（465 行，含 §7 与上游逐条差异表）。

### 55.2 工具超时：语义与默认值

上游 `packages/guard/timeout-policy/src/index.ts`（81 行）的做法是：工具声明 `timeoutMs`，

宿主派生一个 deadline signal 交给工具，**不竞速、不丢弃 promise**，等工具在信号下自己

静止，再把结果改写成超时失败。

本仓旧实现只有 `core.ts` 里一个 `withTimeout`（Promise.race 硬停），而且**没有任何内置

工具声明 `timeoutMs`** —— 工具真挂住时，整轮对话就挂住。本批把两半接起来：

- 新增 `src/main/services/agent-core/toolTimeout.ts`：`toolTimeoutMessage(ms)`（文案唯一

  真源）、`withTimeout`（硬停兜底，从 core 搬来）、`runToolWithDeadline(tool, args, ctx)`。

- `runToolWithDeadline` 的语义：声明了 `timeoutMs` → `deadline = AbortSignal.timeout(ms)`、
  `signal = AbortSignal.any([ctx.signal, deadline])`（没有父 signal 时直接给 deadline），

  用替换后的 `ctx.signal` 调工具，同毫秒 `withTimeout` 兜底；catch 里看

  **`deadline.aborted`** 而不是错误文案 → 抛 `工具执行超时（Nms）`，由

  `classifyToolFailure` 按「超时」归成 `failure.code: 'timeout'`（actions 仍含 retry）。

  未声明 `timeoutMs` → 原样调用，**不引入隐式默认**。

- 外部取消（用户点停止）：父 signal 先到、deadline 未触发 → 原错误上抛，保持

  §45 那条「body 已经开始就绝不放弃」的取消语义。

- scheduler 的 `executeToolCall` 从「三元 + `withTimeout`」改成一行

  `runToolWithDeadline(tool, call.args, ctx)`。

默认值（都是对现在行为的显式化，不是新能力）：

| 工具                                  | timeoutMs | 理由                                                       |
| ------------------------------------- | --------- | ---------------------------------------------------------- |
| `read_file`                           | 30_000    | 大文件 + 慢盘读取上限                                      |
| `write_file`                          | 30_000    | 含审批等待之外的纯写盘时间                                 |
| `list_dir`                            | 15_000    | 目录遍历上限                                               |
| `search_text`                         | 60_000    | 全项目扫描上限                                             |
| `validate_flow`                       | 30_000    | 结构校验上限                                               |
| `run_command`                         | 90_000    | 沙箱自身 60s 上限的 1.5 倍（先由沙箱收尾，宿主只保底）     |
| 旧域 query 工具（`adaptLegacyTools`） | 120_000   | 含界面回执等待（`dispatchInstruction` 自带 15s），上限放宽 |
| 旧域 mutation 工具                    | 不声明    | 不执行，只攒提案，没有可超时的执行体                       |

行为变化：到点后模型收到的是 `[工具失败] 工具执行超时（Nms）`，整轮继续（`phase.finished`），

不再可能被一个不返回的工具拖死。

### 55.3 时间上下文

上游 `packages/context/time-context/src/index.ts`（377 行）在每一步 pre-step 注入一条

user message，并按 10 分钟节流。本仓没有"每步注入"的钩子，也不需要：一轮最长几分钟，

**每轮一次采样**足够，而且不往模型历史里塞额外 user 消息（历史是用户可见的记忆文件）。

落地：新增 `src/main/services/ai/timeContext.ts` 的 `buildTimeContext({ now?, timeZone?,

previousMessageAt? })`，输出两行（逐字）：

```
时间：2026-10-26 07:52:31（Asia/Shanghai，周一）
距上一条消息：约 8 分钟前
```

- 第二行三种形态：有上一条带 `ts` 的消息 → `约 N 分钟前`；没有历史 → `这是本次对话的第一条消息`；

  上一条没有时间记录 → `上一条消息没有时间记录`。

- elapsed 分档：< 60s「不到 1 分钟」；< 60m「约 N 分钟」；< 24h「约 N 小时 M 分钟」；

  ≥ 24h「约 N 天 M 小时」；> 30 天只给天数。未来时间（时钟回拨）按「不到 1 分钟」。

- 时区取请求里上报的浏览器时区，非法/缺失退回 UTC。
- 接线：`RunTurnInput.timeNote` 追加在 system prompt 末尾（`roleNote` → `historyNote` →

  `timeNote` 顺序）；`aiAgentCore` 在 **append 本轮要求之前**取 `past` 最后一条 `ts` 作

  `previousMessageAt`，append 之后把 `lastMessageAt` 更新为本轮 `turnTs` —— 所以跨轮续跑

  看到的是"距上一轮多久"，而不是每次都说"第一条消息"。

### 55.4 文件观察门

上游 `packages/fs/fs-observation-policy`（159 行）用 `ObservedStateGate` 记「谁看过哪个

文件、看到的是什么版本」，写/改前按版本判定。本仓的写入面只有 `write_file`（**整份覆盖**，

没有 `edit_file`），所以策略落在一条上：**覆盖既有文件前，这一轮必须读过它，且读过之后

它没再变**。

落地：新增 `src/main/services/agent-core/fsObservation.ts`：

- `FsObservation { mtimeMs, size }`；`class FsObservationGate` 按绝对路径记版本

  （`noteRead` / `assertWritable` / `noteWrite` / `versionOf`）。

- 判定表：

| 磁盘当前 | 这一轮读过     | 判定                                                                                |
| -------- | -------------- | ----------------------------------------------------------------------------------- |
| 不存在   | 不需要         | 允许（新建）                                                                        |
| 存在     | 没读过         | 拒：`文件已存在，但这一轮还没读过它 —— 先用 read_file 读一遍，确认要改什么再覆盖。` |
| 存在     | 读过、版本一致 | 允许                                                                                |
| 存在     | 读过、版本变了 | 拒：`文件在你读过之后又变了（磁盘上的版本和当时不一样）—— 先重新读一遍，再写。`     |

- 接线：`ToolContext.fsGate?`；`read_file` 读成功后 `await noteRead(abs)`；`write_file`

  在 `onBeforeWrite` **之前** `await assertWritable(abs)`、写成功后 `await noteWrite(abs)`。

  两个记录点都 `await` 是集成测试逼出来的（`void` 时"读完立刻写"会因 stat 未落定被误判成

  没读过）。`LoopOptions.fsObservation` / `RunTurnInput.fsObservation` 默认关（脚本、测试、

  无界面运行不变），`aiAgentCore` 生产入口显式 `true`。

- fail-closed：`noteRead` / `noteWrite` 里 stat 出错就删掉记录 —— 宁可多要求一次读，也不

  在版本不明时放行覆盖。

### 55.5 明确没搬（及理由）

- **`mcp/mcp-resources`**：它给"使用 MCP server 的 agent"提供 `list_mcp_resources` /

  `read_mcp_resource` 三个工具；本仓的 `src/main/mcp` 是 **MCP server**（把 QQ 机器人能力

  暴露给外部客户端），没有消费 MCP 资源的角色。要搬得先做 MCP client，那是另一个批次。

- **`compaction/command-compact`**：`/compact` 依赖斜杠命令框架；本仓既没有命令注册表，

  也没有"跨轮手动压缩"的入口（`applyCompaction` 只在循环内部使用）。硬做要先把压缩抽成

  可调用命令，属于中等改造，不在"小件快搬"里。

- **`preset/persona`**：prefix/suffix 两个提示段本身很小，但本仓预设已经是带 schema 的

  分享格式（第 53 批），加字段要同时改校验、分享、撤销与界面 —— 归入预设批次更合适。

### 55.6 测试与闸门

- 新增：`toolTimeout.test.ts` **7 例**（超时归一 / 按时完成 / 未声明原样调用 / 工具自身

  错误保留 / 父 signal 已中止 / 文案同源）、`fsObservation.test.ts` **10 例**（gate 单元

  5 + 循环集成 5，含"默认关不拦""未读覆盖被拒且磁盘不变""读后写成功""读后被外部改再写

  被拒"）、`timeContext.test.ts` **11 例**（固定时钟逐字断言、UTC、非法时区、周日、无历史、

  未来时间、五档 elapsed）。

- 改动：`core.test.ts` 48（+1 六个内置工具都声明超时）、`runTurn.test.ts` 13（+2 timeNote

  出现与顺序、缺省不出现）、`legacyTools.test.ts` 12（+1 query 120s / mutation 无）。

- 定向 6 文件 = **101 例**全绿；tsc node / tsc web 均 0。
- guards **15 文件 / 107 例**（本批不新增 IPC 能力，能力台账维持 279 条；不新增直写点）。
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`（日志

  `_recovery/full-gate-batch55.log`）= **281 passed | 2 skipped（283 文件）**、

  **3550 passed | 7 skipped（3557 例）**、`FULL_EXIT=0`（第 54 批基线 3525 例，+32）。

### 55.7 真机（dev + CDP 43191）

在真实项目 `projects/还原验证项目` 上建 `_probe55.txt`（内容 `old`，sha256 `CBA06B57…`），

`window.qqbat.ai.agentCoreRun(projectPath, …, fullAccess: true)` 跑三步（输出原文留在

`_recovery/probe55/`）：

1. **时间上下文**：要求照抄 system 里以「时间：」开头的那段 → 返回

   `时间：2026-10-26 07:17:58（Asia/Shanghai，周一）` / `距上一条消息：约 5 小时 46 分钟前`。

2. **未读覆盖被拒**：只让 `write_file`（`path=_probe55.txt`，不读文件）→ toolResults 里

   `[工具失败] 文件已存在，但这一轮还没读过它 —— 先用 read_file 读一遍，确认要改什么再覆盖。`，

   `phase.finished`；磁盘 sha256 仍 `CBA06B57…`、内容仍 `old`。

3. **先读再写放行**：先 `read_file` 再 `write_file` → `read_file ok:true`、`write_file ok:true`

   （`已写入 _probe55.txt`），磁盘变成 `probe-after-read`（sha256 `CB5CC370…`）。

收尾：删 `_probe55.txt`、停 dev / 杀 electron、43191 已 FREE（`PORT43191=FREE`、无项目

进程残留）。

### 55.8 涉及文件

新增 `src/main/services/agent-core/fsObservation.ts`、`src/main/services/agent-core/toolTimeout.ts`、

`src/main/services/ai/timeContext.ts`、三个测试文件、`docs/ai/dsh-small-packages-batch55-design.md`；
改动 `src/main/services/agent-core/core.ts`（六个内置工具声明 `timeoutMs`、`read_file` 记观察、

`write_file` 写前断言 + 写后记录、`LoopOptions.fsObservation`）、`toolGate.ts`（`ToolContext.fsGate`）、

`scheduler.ts`（走 `runToolWithDeadline`）、`runTurn.ts`（`timeNote` / `fsObservation`）、

`legacyTools.ts`（query 工具 120s）、`src/main/ipc/aiAgentCore.ts`（每轮时间采样 + 生产开启

观察门）、`core/runTurn/legacyTools` 三个测试、`docs/ai/dsh-source-adaptation-2026-10-24.md` §14。

## §56 第 56 批：会话视图（自动标题 / 线程统计 / 回合目录）（2026-10-26）

### 56.1 为什么是这三件

上游 session 组里有三个小包：`session-title`、`session-stats`、`session-turn-outline`。

它们共同回答一个界面问题：这条会话**叫什么、多大、聊到哪了**。本仓原来只有「线程列表 +

一串消息」：标题是首条消息前 28 字（`titleOf`）、没有规模信息、也没有「跳到某一轮」的入口。

三件都不新增 IPC 域、不改历史文件格式（标题单独一份旁路文件），所以合一批搬。

逐件对标：

- **标题**（`session/session-title`）：归一/截断纯函数进 shared，provider 起名 + 用户重命名

  pin 落盘 `.qqbat/ai-thread-titles.json`，来源三档 `fallback` / `provider` / `user`；

- **统计**（`session/session-stats`）：`listThreads` 每条线程带 `stats`（turns / messages /

  assistantMessages / chars / estimatedTokens / durationMs）；

- **回合目录**（`session/turn-outline`）：shared 纯函数 `buildTurnOutline`（prompt 截 50 字、

  response 取本轮最后一条 assistant 截 120 字）+ 界面抽屉，点一条滚到 `#ai-msg-<index>`。

同一批量过、**明确不搬**的六条（理由见设计文档 §七）：事件流回放、provider 路由记录、每步

刷新的时间上下文、按 seq 分页加载、多级标题史、`llmMs/toolMs/ttft/decode` 分项。

设计文档：`docs/ai/dsh-session-view-batch56-design.md`（226 行）。

### 56.2 标题归一只有一份口径

「什么叫可见字符」若各写一套，模型生成、用户输入、落盘读取迟早给出三种结果。所以口径

落在 `src/shared/ai/threadTitle.ts`（纯函数，无宿主依赖）：

- `cleanTitleText`：先剥 OSC / CSI / 其余 ESC 序列，再删 C0+C1 控制字符，再删方向性与零宽

  字符（`\u200E`、`\u200F`、`\u202A–\u202E`、`\u2066–\u2069`、`\uFEFF`），最后折叠空白去首尾。

  标题里出现 `ESC[31m` 是 bug 不是个性。

- `truncateTitleUtf8`：`for...of` 走**码点**、用 `TextEncoder` 算每个码点的字节数，放不下就停

  —— 结果前缀永远可解码，绝不出半个汉字（`slice` 切 UTF-16 码元会）。

- `normalizeThreadTitle` = 清洗 + 64 字节截断 + 去尾空白；结果空串 = 非法标题，由调用方报错。

- `fallbackThreadTitle` = 首条需求前 8 个词，再按 **48 字节**截断（比硬上限短，给列表留位置）。

硬上限 `THREAD_TITLE_MAX_BYTES = 64` 字节（≈21 汉字），与上游默认值同。上游这三条规则本批

逐条照抄，没有自创口径。

### 56.3 生成时机、pin 与竞态

落盘形状：`{ version: 1, titles: { [threadId]: { title, source, updatedAt } } }`；写走

`infra/fileOps.atomicWrite`（先临时文件再 rename），因此不需要进 `projectWritesViaFileOps`

的直写登记表；读到坏 JSON / 版本不认识 / 条目不合格一律当「没有标题」返回空表，**不删文件**

（与第 54 批「坏记录不自动删」同一纪律）。

什么时候生成（`src/main/ipc/aiAgentCore.ts` 收尾之后）：判据是循环开始前读到的 `past` 里没有

任何 user 消息 = 这就是本线程首轮，且 `result.finalText` 非空 → fire-and-forget 调

`maybeGenerateThreadTitle`。服务自己判三件事就返回 null，不区分原因（调用方也不需要）：

1. 配置缺 `provider` / `model` / `apiKey`（不拿用户 key 去试一个注定 401 的请求）；
2. 该线程已有落盘标题 —— provider 或 user 都算，**用户改过就绝不允许被覆盖**；
3. 生成出来归一后为空、或输入 prompt/response 为空。

竞态只有一处：生成期间用户可能刚好重命名。做法是**落盘前再读一次**标题表，已被占用就丢弃

生成结果（以先落盘者为准，绝不对用户操作翻脸）。落盘本身不是跨进程锁，单人本地应用接受。

错误语义：生成或落盘的任何异常只记 `logger.warn`，函数**永不 reject**；30s 超时（

`TITLE_TIMEOUT_MS`）放弃。标题是旁路，不能影响已经收尾的那一轮。

abort 语义要单独说清：`finally` 只清 `RUNNING` / `STEER`，**不 abort ctrl** —— 所以正常收尾

不会误杀标题请求；只有用户按停止（`ai:stop` → `cancelAgentCoreRun`）才 abort。

广播：落盘成功后 emit `ai:threadTitle { projectPath, threadId, title, source }`，渲染层据此就

地更新列表一行，不需要整表重拉。

### 56.4 线程统计只算已经存在的事实

`src/main/services/ai/threads.ts` 的 `statsOf(entries)`：`turns` = user 条数、`messages` = 全部

条数、`assistantMessages`、`chars` = user+assistant 正文字符（工具痕迹不算）、

`estimatedTokens = ceil(chars / 4)`（只用于列表上的量级感，不是计费口径）、`durationMs` = 首末

`ts` 跨度（不足两条或时间戳解析不出来 = 0）。

刻意**不**给 `llmMs` / `toolMs` / `ttft`：那要逐轮墙钟事件，本仓 trace 不带 threadId，拿不到

可信的按线程分项 —— **不编造**（设计文档 §七.6）。

`listThreads` 的标题优先级：落盘记录（user/provider）> fallback > 旧 `titleOf`（28 字截断，只在

什么都推不出来时保留老行为）；读不出条目的线程返回 `emptyThreadInfo`（title 空、source

`fallback`、stats 全 0），界面不用为它写分支。统计不额外读盘：列表本来就要 `loadHistory` 全文，

扫描复用同一次读取。

### 56.5 界面：一个入口按钮、一张目录、一个列表提示

`ChatPanel.tsx` 只多两行：一个 `outlineHighlight` 状态 + 一行

`<TurnOutlineLauncher messages={messages} scrollRef={listRef} onHighlight={setOutlineHighlight} />`。

这不是洁癖 —— `fileGrowth` 闸门给 ChatPanel 的基线是 1609 行、硬上限 1688 行，本批改完

1678 行，余量 10 行。按钮、抽屉开关、视口轮次跟踪、跳转高亮计时器全在新文件

`TurnOutlineLauncher.tsx`（132 行）里；抽屉本身在 `TurnOutlineDrawer.tsx`。

抽屉：右侧遮罩 + `role="dialog" aria-label="回合目录"`，Esc **在捕获阶段**关掉（否则会继续

冒泡到 ChatPanel 的「Esc = 停流/清输入」），空对话给一句空态文案而不是一块空白；条目

`aria-label="跳到第 N 轮"`、当前轮挂 `aria-current`，点一条 → `onJump(userIndex)` + 收起。

跳转口径：`AgentTranscript` 给每条消息容器挂 `id={ai-msg-<消息数组下标>}`，与

`buildTurnOutline` 的 `userIndex` **同一个下标**，中间不做映射；跳转就是

`scrollIntoView({ block: 'start' })`，`scroll-mt-3` 留 12px 顶部余量，落地后高亮 1.5 秒

（`bg-sky-400/5 ring-2 ring-inset ring-sky-400/60`）然后自动褪去 —— 1.5 秒是「够眼睛找到落点，

又不至于像被选中」。计时器在 Launcher 卸载时清掉。

视口当前轮：抽屉**开着**时才给消息容器挂 passive scroll 监听，取「最后一条顶边已越过容器

顶部（容差 4px）的用户消息」；关掉就摘监听。按轮取而不是按消息取，是因为助手回答比用户

气泡长得多，按消息取会让高亮在同一轮内来回甩。

线程行（`ThreadRow`）：hover 提示变成 `threadOption · stats`，即

`你好（42 条） · 21 轮 · 约 1,426 tokens`（千分位用 `toLocaleString()`）；重命名入口有两个

（hover 出现铅笔按钮、双击标题），空标题在渲染层就拦住（`ai.sidebar.renameEmpty`），失败

原因显示在行下 `role="alert"`，`ipc-missing` 特判成人话「重开应用」。i18n 中英各新增 12 键。

明确没做：常驻高亮（只在跳转后 1.5s）、目录搜索/分组/拖排序（21 轮的目录还不需要）。

### 56.6 IPC 与能力账

- `ai:renameThread`（invoke）：schema `aiRenameThreadSchema` = `projectPath` 非空、

  `threadId` 1–64、`title` 1–200；handler 先 `assertProjectPathAllowed`，再

  `tryIpcAsync(() => renameThreadTitle(...))`。归一后为空 → `{ ok: false, error: '标题不能为空

  （去掉控制字符后没有可见字符）' }`。

- `ai:threadTitle`（主 → 渲染广播）：`{ projectPath, threadId, title, source }`；preload

  `onThreadTitle`。

- 能力账：ai 域 54 → **56**、X 79 → **81**、合计 279 → **281**、X+⛔ 82 → **84**；附录 A 加

  `ai.onThreadTitle` / `ai.renameThread` 两行；`capabilityCatalog.generated.ts` 281 条

  （`ai:threadTitle` on、`ai:renameThread` invoke）、`capabilityPolicy.generated.ts` ai 域 56 条。

- 守卫同步登记：`agentCoreEventContract`（事件字段形状）、`ipcPayloadContract`（入参 schema）。

### 56.7 测试与闸门

- 新增 7 个测试文件、改动 4 个：
  - `tests/shared/ai/threadTitle.test.ts` **13 例**（ANSI/CSI/OSC 剥离、C0+C1、方向性字符、
    折叠空白、码点截断不出半字、64 字节硬上限、fallback 8 词/48 字节）；
  - `tests/shared/ai/turnOutline.test.ts` **8 例**（条目数=用户消息数、prompt 50 / response 120
    截断、跨轮取最后一条 assistant、缺 response 不补空串）；
  - `tests/main/services/ai/threadTitles.test.ts` **10 例**（读写往返、坏文件容忍、版本不认识、
    空标题抛错、user 覆盖、provider 不覆盖已有标题、落盘前二次读、缺 key 跳过、错误不 reject）；
  - `tests/main/services/ai/threads.test.ts` **6 例**（标题优先级、stats 六字段、空线程）；
  - `tests/renderer/components/ai/TurnOutlineDrawer.test.tsx` **7 例**、`TurnOutlineLauncher.test.tsx`
    **7 例**、`ThreadRow.test.tsx` **10 例**（stats 提示 / 改名成功退出编辑 / 空标题本地拦 /
    失败透传 / ipc-missing 人话 / Esc 取消 / 双击进入 / disabled 无入口）、`ChatPanel.test.tsx` **+1**。
  - 改动：`agentCoreEventContract` 4（+1 事件契约）、`ipcPayloadContract` 5（+1 payload）、
    `aiAgentCore-ipc` **34**（+2：首轮触发一次标题生成、非首轮不再触发）。
- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **0 错**；
- `tests/guards` **15 文件 / 107 例**全绿（deadExports 转绿、fileGrowth 绿、能力账 281）；
- 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2` = **288 passed | 2 skipped
  （290 文件）**、**3614 passed | 7 skipped（3621 例）**（第 55 批基线 283 文件 / 3557 例，
  本批 +7 文件 / +64 例）；定向 renderer 88 文件 / 984 例、i18n 6 文件 / 69 例。
- 日志：`_recovery/gate-batch56-tsc-guards.log`、`_recovery/full-gate-batch56.log`。
- prettier：本批 35 个改动文件里 34 个 `--check` 通过；唯一不过的是存量

  `docs/ai/dsh-source-adaptation-2026-10-24.md`（巨型表格，第 55 批同状况），不整文件重排。

### 56.8 真机（dev + CDP 43191）

在真实项目 `projects/还原验证项目` 上按设计 §九 走六步（输出原文留 `_recovery/probe56/`，

截图 `ui-b56-threads.png`、`ui-b56-drawer.png`）：

1. **首轮自动起名**：新线程 `probe56b-vxeldn` 发「用一句话说明什么是"会话标题"」→ 等 9s

   `listThreads`：`title=会话标题的定义与作用`、`titleSource=provider`、

   `stats={turns:1,messages:2,assistantMessages:1,chars:86,estimatedTokens:22,durationMs:6083}`。

2. **第二轮不覆盖**：同线程再发一轮 → `title` 不变、`titleStable=true`，`stats.turns=2`、

   `chars=157`、`estimatedTokens=40`（ceil(157/4)）。

3. **重命名归一**：`'\u001b[31m标题探针\u0007\u202E 第五十六批 \u001b[0m'` → 落盘

   `{title:'标题探针 第五十六批', source:'user'}`（28 字节）；100 个「零」→ 63 字节（≤64）；

   只有控制字符 → `{ok:false, error:'标题不能为空（去掉控制字符后没有可见字符）'}` 且原标题不变。

4. **重启后仍在**：杀掉 electron 重新起 dev，线程列表里该行仍在、标题仍是「第五十六批标题

   探针」，hover 提示原文 `第五十六批标题探针（4 条） · 2 轮 · 约 40 tokens`；长线程那行

   `你好（42 条） · 21 轮 · 约 1,426 tokens`（`_recovery/probe56/out-ui-threads2.txt`）。

5. **回合目录**：点开该线程 → 点「回合目录」→ `role=dialog aria-label=回合目录`，2 条条目

   （= 2 轮）、`跳到第 1 轮` 挂 `aria-current=true`；点第 2 轮 → 抽屉关闭、`ai-msg-2` 立刻

   带 `ring-sky-400`、1.6s 后高亮自动消失（`out-ui-jump.txt`）。

6. **长线程跳转**：21 轮的「你好」→ 目录 21 条（第 1–21 轮）；点「跳到第 10 轮」→ 抽屉关闭、

   高亮落在 `ai-msg-17`、其顶边距容器顶 **12px**（= `scroll-mt-3`）、scrollTop 9086 → 6191

   （从底部回到第 10 轮，`out-ui-jump2.txt`）。

7. **收尾**：删 `probe56b-vxeldn.jsonl`（+ preset）、`ai-thread-titles.json` 重置为

   `{version:1,titles:{}}`、停 dev 杀 electron，43191 FREE、无项目进程残留。

诚实边界（没真机跑的）：界面上**输入框**改名（铅笔/双击后敲字提交）没跑 —— 它走的是同一条

已真机验证的 `ai:renameThread`，输入框交互由 `ThreadRow.test.tsx` 10 例覆盖；`ai:threadTitle`

广播对**打开着的**列表的即时刷新也没跑（本次验证的是重启后读取），广播形状由

`agentCoreEventContract` 与 `aiAgentCore-ipc` 用例守住。

### 56.9 涉及文件

新增 `src/shared/ai/threadTitle.ts`、`src/shared/ai/threadTitleTypes.ts`、`src/shared/ai/turnOutline.ts`、
`src/main/services/ai/threadTitles.ts`、`src/renderer/src/components/ai/TurnOutlineLauncher.tsx`、
`src/renderer/src/components/ai/TurnOutlineDrawer.tsx`、7 个测试文件、`docs/ai/dsh-session-view-batch56-design.md`；
改动 `src/main/services/ai/threads.ts`（标题合并 + `statsOf` + `emptyThreadInfo`）、
`src/main/ipc/aiAgentCore.ts`（首轮后 fire-and-forget 起名 + 广播）、`src/main/ipc/ai.ts`（`ai:renameThread`）、
`src/main/schemas/ai.ts`、`src/preload/index.ts`、`src/renderer/src/types/ipc.ts`、
`src/renderer/src/stores/aiStore.ts`（`ThreadStats`/`ThreadInfo`/`renameThread`/`onThreadTitle`）、
`src/renderer/src/components/ai/ChatPanel.tsx`、`AiSidebar.tsx`、`AgentTranscript.tsx`、
`src/renderer/src/i18n/{zh-CN,en-US}.json`、`capabilityCatalog.generated.ts`、`capabilityPolicy.generated.ts`、
`docs/ai/ai-capability-layering-2026-10-08.md`、三份守卫/主进程测试、`docs/ai/dsh-source-adaptation-2026-10-24.md` §14。

## §57 第 57 批：会话管理三件套（正文搜索 / 导出 Markdown / 删除）（2026-10-27）

### 57.1 为什么是这三件

对标上游三包：`dsh-session-query`（49 KB）、`dsh-session-log-export`（index 23.7 KB + client 12.5 KB）、
以及会话删除/清理。它们都挂在 Cordis 服务 + Typert 远程调用上，代码搬不动，搬的是语义。

本项目缺的不是能力，是**入口**：`ai:clearThread` 主进程 handler（`src/main/ipc/ai.ts:519`）、preload
`:437`、`src/renderer/src/types/ipc.ts:707`、`aiStore.clearActiveThread:1351` 四层早就通了，但渲染层
**零调用者**（grep `clearThread(` 只命中 aiStore 自己）—— 用户根本没有办法删掉一条对话。

第二件：侧栏搜索框已经存在（`searching`/`query`/`onlyCurrent`），但过滤只匹配标题
（`th.title.toLowerCase().includes(q)`），而标题只取**第一条用户消息**的首行（截 28 字符）——
聊到第 20 轮时用户记得的那句话永远搜不到。

第三件：会话在磁盘上是 `<id>.jsonl` 的 append-only 碎片，用户想把一段对话贴给别人只能手工复制。
导出成人读 Markdown 是"拿得出去"的最后一环。

明确不搬：跨项目搜索（上游按 session 目录扫，本项目 `listThreads` 已按项目分组）、正则/模糊打分
（上游有自己的 query 语法，本项目只做子串）、导入（与 append-only 历史、`selectWithinBudget` 裁剪
冲突）、图片/附件导出（历史里没有图片条目）、消息反馈（`dsh-message-feedback` 属另一批，形状已调研，
见设计文档 §五）。

### 57.2 搜索口径：标题本地过滤 + 正文主进程扫描

- 查询归一 `normalizeThreadSearchQuery`：`/\s+/gu` 折叠成单空格、trim、`toLowerCase()`、按码点截 120。
- 正文**逐字**比、不折叠空白：`'A  B  C'` 不能被 `'a b c'` 搜到 —— 折叠查询是为了"用户多打了空格
  也认"，折叠正文会制造假命中。这条我一开始写反了（用例断言成"能搜到"），测试当场红，改口径后
  9/9 绿。
- 只搜 `role === 'user' | 'assistant'` 的 `content`；不搜 `reasoning`、不搜 `trace`（工具名/参数/
  结果）、不搜角色名。真机上搜「失败」得 0 条正是这条口径的直接证据 —— 那个词只出现在 trace 里。
- 一处命中 = 一个条目的**第一处**出现；每线程最多 3 处、最多 12 条线程、片段半径 24 码点。按码点
  切而不是 UTF-16 码元，emoji 不会被切成半个。
- `foldChar` 逐码点 `toLowerCase()` 取首码点：`İ`（U+0130）小写会展开成两个码点，直接
  `toLowerCase()` 会让 match 下标与原文错位。
- 线程顺序沿用 `listThreads` 的"最后活动在前"；单条线程读失败 `continue`，不因一个坏文件吞掉
  整次搜索。

### 57.3 导出：人读 Markdown，不是可再导入的日志

- 形状：`# 标题` / `- 会话：id` / `- 项目：` / `- 导出时间：`（本地 `YYYY-MM-DD HH:mm:ss`）/
  `- 规模：N 轮 · M 条消息` / `---`，然后每轮 `## 第 N 轮`、`**你**`、`**助手**（用时 X.X 秒）`。
- 正文逐行加 `> `（空行给一个 `>`），用户原文里的 `##`、`- ` 不会顶破结构。
- 工具行 `- 工具：name ✓ · name ✗`；`attempt` 条目导成 `> ⚠️ 这一轮没有跑完：reason` ——
  失败轮也留在文件里，删掉才是不诚实。
- 不导 reasoning、不导工具参数与结果（`loadHistory` 带 `includeUi` 拿 trace 只为取名字与成败）。
  真机导出的 12782 字节里 grep 不到 `reasoning`。
- 单条正文截 4000 字符（`THREAD_EXPORT_MAX_ENTRY_CHARS`）、最多 2000 条（超了写尾注）；文件名
  `<安全标题>-<id 前 6>对话记录.md`，非法字符替 `_`、去尾部点/空格、标题截 40 码点、空标题给「对话」。
- 保存框在主进程（与 `src/main/ipc/aiPresets.ts` 的 `ai:exportPresets` 同构）：
  `BrowserWindow.fromWebContents(event.sender)` 有窗口就挂父窗口，`canceled` 时抛「用户取消」，
  然后 `writeFile(path, text, 'utf-8')`。

### 57.4 删除：复用 `ai:clearThread`，不新增通道

- 那四层已经通了，缺的只是入口 —— 再加一条 `ai:deleteThread` 只会让能力账多一条、语义多一份。
- `aiStore.deleteThread` 的语义：删的若是当前线程，先 `switchThread(project, 'default')` 再
  `loadThreads`；删别的只刷列表。`default` 线程（老的 `ai-history.jsonl`）也能删 —— 删掉就是清空
  历史文件，下次进入还是 `default` 的空壳。
- 二次确认做在行内（本项目没有 toast 基建，为一个删除弹模态框太重）：点垃圾桶 → 该行变成
  `确定删除？` + ✓/✕，Esc 取消，流式输出中三个图标全隐藏。
- 所以 UI 上「删除对话」与「清空当前对话」落到同一条通道 `ai:clearThread`，能力账只登记它。

### 57.5 界面

- 正文命中区（`ThreadSearchResults.tsx`）插在标题匹配列表**上方**：250ms 防抖、
  `query.trim().length < 2` 不发请求（一个字符的正文搜索等于把全项目翻一遍）、旧查询用 cancelled
  标记 + `clearTimeout` 丢弃、三态（搜索中 / 没有命中 / 失败 `role="alert"`）、`<mark>` 高亮、
  行 `title` 用 `formatThreadSearchSnippet` 拼 `…`。点命中 → `openThread` 打开该线程并收起搜索。
- `ThreadRow` 加 `onExport`/`onDelete`：hover 出 `Download`/`Trash2` 两个绝对定位小图标（行本身是
  button，不能嵌按钮，沿用第 56 批铅笔那套）；导出成功在行下 `role="status"` 给出文件名、
  `用户取消` 静默、其他失败 `role="alert"`。
- 顺手修两处**只有真机截图才看得见**的：①搜索时标题一条不命中会误显示「还没有对话」（对话明明
  都在）②搜索中不再显示「发出第一条消息后…才会保存进列表」—— 那说的是新建的空对话，摆在命中了
  的正文旁边像在说对话丢了。
- `fileGrowth` 逼出的拆分：接完搜索 + 导出/删除后 AiSidebar 831 行 ≥ 800 且未登记基线 →
  `RailButton` 搬成 `AiRailButton.tsx`（40 行）、上下文洞察浮层搬成 `AiContextFlyout.tsx`（70 行），
  `AiSidebar.tsx` 落回 737 行。两个新文件都被 AiSidebar 真引用（`deadExports` 绿），没跑 baseline
  脚本、没改 `tests/guards/`。

### 57.6 IPC 与能力账

- 两条新通道：`ai:searchThreads`（invoke，`aiSearchThreadsSchema{projectPath.min1, query.max400,
limit.int.min1.max50.optional}`）、`ai:exportThread`（invoke，`aiExportThreadSchema{projectPath.min1,
threadId.min1.max64}`）。两条都在 `assertProjectPathAllowed(baseDir, projectPath)` 之后才动手。
- 能力账：`ai` 域 56→58、`X` 81→83、合计 281→283、`X + ⛔` 84→86；附录 A 加
  `ai.searchThreads = X`、`ai.exportThread = X`；`node scripts/gen-capability-catalog.mjs` 重生成两份
  （283 条）。顺手修了存量错账：附录小计那行原写 `X 79 = 279`，而附录 A 代码块是 281 条 / X 81
  （第 56 批漏改）。
- 守卫：`ipcPayloadContract` 注册两条新通道；`projectWritesViaFileOps` 把 `src/main/ipc/ai.ts` 的
  `writeFile: 1` 登记为【系统/非项目】（目标路径由用户在保存框里选）；`update-file-size-baseline.mjs`
  把 840 行的 `ai.ts` 写进 fileGrowth 基线。

### 57.7 测试与闸门

| 测试文件                                                    | 用例数   | 断言点                                                                                                                                                             |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/shared/ai/threadSearch.test.ts`                      | 14       | 查询归一/大小写/码点截断、命中下标与片段、上限 3、同条目只算一处、attempt/system 不参与、moreBefore/moreAfter 与省略号、emoji 不切碎                               |
| `tests/shared/ai/threadExport.test.ts`                      | 14       | 文件名非法字符/空标题/结尾点/40 码点、头信息、轮次编号、`##`/`-` 进引用块、空行带 `>`、耗时与工具行、attempt 警告、超长截断、2000 条尾注、空会话、reasoning 不外流 |
| `tests/main/services/ai/threadSearch.test.ts`               | 9        | 命中片段、不搜标题、不搜 reasoning+trace、每线程最多 3 处、空查询、查询折叠但正文逐字、倒序 + limit 上限、坏行跳过                                                 |
| `tests/main/services/ai/threadExport.test.ts`               | 6        | 头信息/轮次/耗时/工具行、reasoning 与工具参数不外流、attempt 警告块、非法文件名替换、找不到线程抛错                                                                |
| `tests/renderer/components/ai/ThreadSearchResults.test.tsx` | 8        | 有结果 / 行 title 口径 / 无命中 / 短查询不发请求且不渲染 / 搜索中 / 失败 `role=alert` / `ipc-missing` 翻重启文案 / 防抖只发最后一下                                |
| `tests/renderer/components/ai/ThreadRow.test.tsx`           | 19（+9） | 图标 aria 与 opacity、导出成功只提示文件名、用户取消静默、导出失败、二次确认、取消、Esc、删除失败保留确认态、disabled 时三图标隐藏                                 |

- 定向：`vitest run tests/guards tests/renderer/components/ai tests/renderer/i18n` = **36 文件 / 299 例**。
- `tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 **0**；guards **15 文件 / 107 例**。
- 全量：**295 文件（293 通过 | 2 跳过）/ 3681 例（3674 通过 | 7 跳过）**，比第 56 批 290 / 3621
  多 5 个文件、60 例；`electron-vite build` **EXIT 0**。
- prettier：本批 30 个改动路径里 29 个 `--check` 通过；不过的仍是存量
  `docs/ai/dsh-source-adaptation-2026-10-24.md`（巨型表格，第 55/56 批同状况），不整文件重排。
- 日志：`_recovery/full-gate-batch57b.log`、`_recovery/build-batch57.log`、
  `_recovery/gate-batch57b-vitest-exit.txt`。

### 57.8 真机（dev + CDP 43191）

在真实项目 `projects/还原验证项目` 上跑，输出原文留 `_recovery/probe57/`，截图
`ui-b57-search.png`、`ui-b57-delete-confirm.png`：

1. **正文搜索**：查询「审批」（只存在于正文，不在任何线程标题里）→ `正文命中（1）`，行 `title`
   原文 `你好…t\` ← "probe-new"）这次**弹出的审批没有过**——「写入未通过审批」，文件没落盘。另…`，
`<mark>` 1 处；点该行 → 浮层收起（`out-search2.txt`）。
2. **口径旁证**：`失败` → 0 条（该词只在 trace 里）；`工具` → 2 条、`文件` → 3 条、`审批` → 1 条
   （`out-search-ipc.txt`）。
3. **导出取消**：`exportThread('default')` → 保存框弹出（800ms 后 promise 仍 pending）→
   `AppActivate('导出对话')` + `{ESC}` → `{ok:false, error:'用户取消'}`，3283ms
   （`out-export-cancel.txt`）。
4. **导出落盘**：同流程 + 剪贴板粘绝对路径 + Enter →
   `{ok:true, data:{filePath:'E:\\H Bot 制造\\_recovery\\probe57\\export-default.md', bytes:12782, entries:42}}`；
   文件头 `# 你好` / `- 会话：default` / `- 项目：还原验证项目` / `- 导出时间：2026-10-27 02:51:01` /
   `- 规模：21 轮 · 42 条消息`，21 个 `## 第 N 轮`、6 条工具行、grep 不到 `reasoning`。
5. **二次确认**：点垃圾桶 → 该行变成 `确定删除？` + `确认删除`/`取消删除` 两个按钮
   （`ui-b57-delete-confirm.png`）；点取消 → 行恢复原标题。
6. **真删**：对「请只调用一次 write_file 工具，参数：」确认删除 → `listThreads` 只剩
   `[probe55-readwrite, default]`、行消失、`ai-history/probe55-unread.jsonl` 从磁盘消失、
   无 `role="alert"`。
7. **删当前线程**：先打开 `probe55-readwrite` 再删它 → `listThreads` 只剩 `[default]`、无「当前对话」
   占位、对话区切回「你好」（`hasGreeting=true`、`hasOldThread=false`）。
8. **收尾**：43191 与 5173 均 0 监听、`ai-history/` 0 个 jsonl、`ai-thread-titles.json` 是
   `{version:1,titles:{}}`。

诚实边界（没真机跑的）：

- 保存框的**人机细节**没测：覆盖确认、切目录、长文件名截断。取消与落盘两条路径都是驱动真保存框
  跑出来的（Esc / 粘路径 + Enter）。
- 正文搜索只搜**当前项目**（能力账也这么写）。
- 搜索框输入是用 `HTMLInputElement.prototype` 的 value setter + `input` 事件喂的 React 受控输入，
  等于模拟键入；中文输入法的组合事件（`compositionstart/end`）没测。
- `ai:searchThreads` 在主线程同步读所有 jsonl（每线程一次 `loadHistory`）。本项目单项目最多几十条
  线程、单文件 ≤ 1 MB，实测没有感知；上千条线程要改成增量索引或分批 —— 这个阈值本批没测。

### 57.9 涉及文件

新增 `src/shared/ai/threadSearch.ts`(145)、`src/shared/ai/threadExport.ts`(163)、
`src/main/services/ai/threadSearch.ts`(88)、`src/main/services/ai/threadExport.ts`(65)、
`src/renderer/src/components/ai/ThreadSearchResults.tsx`(151)、`AiRailButton.tsx`(40)、
`AiContextFlyout.tsx`(70)、5 个测试文件、`docs/ai/dsh-session-manage-batch57-design.md`；
改动 `src/main/ipc/ai.ts`(840，两条 handler)、`src/main/schemas/ai.ts`、`src/preload/index.ts`、
`src/renderer/src/types/ipc.ts`、`src/renderer/src/stores/aiStore.ts`（`ThreadSearchHit` /
`ThreadSearchMatch` / `searchThreads` / `deleteThread`）、`src/renderer/src/components/ai/AiSidebar.tsx`(737)、
`src/renderer/src/i18n/{zh-CN,en-US}.json`（各 +13 键）、`capabilityCatalog.generated.ts`、
`capabilityPolicy.generated.ts`、`tests/guards/{ipcPayloadContract,projectWritesViaFileOps}.test.ts`、
`tests/guards/file-size-baseline.json`、`tests/renderer/components/ai/ThreadRow.test.tsx`、
`docs/ai/ai-capability-layering-2026-10-08.md`、`docs/ai/dsh-source-adaptation-2026-10-24.md`、
`docs/ai/dsh-session-view-batch56-design.md`（第 56 批交接清单收口为终态）。

## §58 第 58 批：消息反馈 + @ 文件引用（2026-10-27）

### 58.1 为什么是这两件

选型不是拍脑袋，先把设置页里 18 条插件逐条分诊了一遍
（`docs/ai/dsh-plugin-porting-survey-2026-10-27.md`，三份子报告在 `_recovery/survey58/`）：

- **能搬 3 条**：持久终端 6 工具（`agent-core/terminal.ts` 的 `ShellSession` 全仓零引用 = 死代码）、
  会话检索工具（包一层 `threadSearch.ts:53 searchProjectThreads`）、并行工具调用数设置
  （`core.ts:498 maxParallelToolCalls` 已实现但 `runTurn.ts:210` / `aiAgentCore.ts:633` 没透传）。
- **部分搬 2 条**：会话检查器（扩 `TrajectoryPanel.tsx`，L）、Git 工作树（要先有会话级 cwd，M）。
- **已有等价物 2 条**：用户终端（`services/terminal.ts` + `Terminal.tsx` + node-pty/xterm）、插件市场
  （`services/plugins/market.ts`）。
- **不搬 11 条**：子智能体、网页搜索、智能体团队、语音输入、CoT 翻译、DSH 徽章、Ralph、Codex /
  Claude Code 子智能体（两者实体不在 asar 里，只有 `ON_DEMAND_BUNDLES` 元信息）等，理由逐条记在
  分诊文档。

本批只做用户点名的两件，加一件"其实已经有了"的核对结论：

1. **消息反馈**（`dsh-message-feedback` + `dsh-command-feedback` + `dsh-client-ui-message-feedback`）：
   上游是 Cordis 服务 + Typert 远程调用，代码搬不动，搬语义 —— 7 档分类、说明上限、同档再点撤回、
   目标是"已落盘的 assistant 消息"。
2. **@ 文件引用**（`dsh-file-reference` + `-local`）：搬两条正则、`{path, kind}` 两字段契约、5 档打分、
   一段系统提示词。**不搬** 1951 行的 `client-ui-input-trigger` 浮层框架与 `dsh-resource://` 协议。
3. **工具审批白名单记忆**：核对结论是**本项目已经有**（`toolApproval.ts` 三值决策 + `allowRules.ts`
   可撤销规则表 + 5 分钟超时），比上游强；上游 `OUTCOMES` 只有 `allowed-once` 一个"准"，而且**没有
   白名单落盘、没有审批超时**。本批不动它，缺口（策略句注入 / 四结局区分 / 审计对 / auto-review）
   记在第 60 批候选里。

### 58.2 消息反馈：稳定 id 是地基

反馈要指向"某一条 assistant 消息"，而这一层原来根本没有 id：

- `HistoryEntry` 只有 `{ts, role, content}`，渲染层的历史消息 id 是**位置派生**的
  （`hist-${i}-${k}`）—— 重启、压缩、截断都会变，拿它当反馈的 key 会指向另一条消息。
- 所以先把 id 打通，四处一起改：
  1. `src/main/services/ai/historyStore.ts`：`appendHistoryEntries` 生成/沿用 `id` 并**返回 ids 数组**，
     落盘行是 `{id, ts, role, content}`；读侧 `loadHistory` 只认落盘里真有的 `id`（**读侧不编造**）；
     `truncateHistoryAt` 重写行时保留 `id`（截断改了 id 就等于把反馈指到别人身上）。
  2. `src/main/services/agent-core/uiTrace.ts`：`assistantHistoryEntry` 入参加必填 `id`。
  3. `src/main/ipc/aiAgentCore.ts`：每轮 `const assistantMessageId = randomUUID()`，落盘与事件共用。
  4. 渲染层 `ChatMessageWithTrace.messageId`：`ai:response` 带回来就挂上，`loadHistoryFromDisk` 用
     落盘的 `id`，缺省（老历史）就**不显示**反馈按钮 —— 这是刻意的：宁可没有按钮，也不要存一条
     指向不存在消息的反馈。
- 真机第一次跑就抓到一个真 bug：`ai:response` 与 invoke 回执**谁先到没有保证**（这句注释在
  `aiStore.ts` 早就写着），回执先到时走 `runAgentCoreTurn` 的兜底分支自己收尾，而那条路径**没带
  messageId** → 界面拿不到 id，按钮不出现。修法是让 `ai:agentCoreRun` 的回执也带 `messageId`
  （`lastMessageId` 在 main 里生成后就留着），兜底分支用它。这个 bug 只有"真的在界面上发一句话"
  才能暴露，单测两条路分开测都会绿。

### 58.3 反馈落盘形状与并发

- 文件 `<project>/.qqbat/ai-feedback/<sanitizeThreadId>.json`，形状
  `{version: 1, items: {[messageId]: {rating, category?, note?, createdAt, updatedAt}}}`，走
  `infra/fileOps.atomicWrite`（所以不进 `projectWritesViaFileOps` 的直写登记表）。
- 上限 500 条/线程，超了按 `updatedAt` 丢最旧；坏文件/坏版本读成空表，不抛、不删。
- `setMessageFeedback` 的校验顺序：评分/分类合法 → `hasAssistantMessage` 必须命中
  （`role === 'assistant' && entry.id === messageId`，否则 `target-not-found`）→ note 超 4×500 直接
  `note-too-long`（**拒绝而不截断**，悄悄截断等于骗人）→ `normalizeFeedbackNote` 归一
  （剥 C0/C1、折叠空白、trim、按码点截 500）→ **内容没变就直接返回现有条目、不写盘**
  （把磁盘上的 `updatedAt` 改成 2020 再写一次，仍然是 2020 —— 这条有测试）。
- 改评分保留 `createdAt`、只换 `updatedAt`；撤回（`deleteMessageFeedback`）不存在时返回 false
  且**不写盘**；`ai:clearThread` 顺带 `clearThreadFeedback`（删对话不能留一堆指向不存在消息的反馈）。
- 上游还做了乐观并发的 `version` 冲突（`version-conflict`）。本项目是**单窗口桌面应用 + 每次改动
  重读重写整表**，不存在两个客户端抢同一条的场景，所以没搬 `version` 字段 —— 搬一个用不上的
  UUID 比不搬更糟。

### 58.4 反馈界面：一个动作两种结局

- 每条**有 id 的** assistant 消息，动作行里在"复制"和"重新生成"之间多一对 👍/👎
  （`MessageActions` 加 `feedback` / `feedbackEnabled` / `onFeedback`），`aria-pressed` +
  `data-active`，选中态是 emerald / rose 实心。
- 点未选中的那一档 = **打开弹层**（不是直接落库）；点已选中的那一档 = **撤回**。上游也是这个语义
  （"任一评分都会打开反馈弹层"，再点同一个 = retract）—— 照抄它，因为避免"误点即写盘"。
- 弹层 `MessageFeedbackDialog`：`role="dialog"` + `useDialogFocus`、7 个分类 chip（`aria-pressed`）、
  说明 `maxLength=500` 带字数、提交中禁用、失败**保留弹层**用 `role="alert"` 说原因、Esc / 遮罩 /
  取消三条关闭路径。**没有**右上角 X —— 它会和「取消」撞同一个无障碍名。
- 失败文案分工（`feedbackFailureText`）：`ipc-missing` → 「界面与主进程版本不一致，重启应用再试」、
  `note-too-long` → 「描述太长」、`conflict` → 「这条反馈已在别处改动」、其余透传原文。
- 反馈状态在渲染层是 `threadFeedback: Record<messageId, MessageFeedbackItem>`，`putMessageFeedback`
  乐观写、失败回滚，`retractMessageFeedback` 同理；切线程/新建/清空都重置这张表，加载历史后
  `loadThreadFeedback` 再补。

### 58.5 @ 文件引用：路径即提示词，不塞文件内容

上游最反直觉的一条：插入的是**工作区相对路径纯文本**，不是文件内容。

- 触发两条正则（只看光标左侧）：引号态 `/(?:^|\s)@"([^"]*)$/u`、裸态 `/(?:^|\s)@([^\s]*)$/u`。
  `@` 必须在行首或空白之后 —— 所以邮箱 `a@b` 不弹菜单；光标后面还有字符时不弹（`@src/fo|o/bar.ts`
  这种中间落点弹出来会盖住后半截路径）。
- 插入形态 `formatFileReferenceMention`：文件无空格 `@src/a.ts`、有空格 `@"a b.ts"`；目录
  `@dir/`（引号态故意**不闭合** `@"dir/`，方便接着往下钻）；含引号/控制字符的路径返回 null，
  界面显示「这个路径没法用 @ 表达」，原文一个字都不动。
- 候选来自两条路径：查询里含 `/` 或为空 → **live 列目录**（不建索引，永远新鲜）；否则 → **有界索引**
  （`MAX_INDEX_ENTRIES=20000`，BFS 跳过 `ALWAYS_FORBIDDEN_SEGMENT_NAMES` 与构建产物目录，
  `INDEX_TTL_MS=3000`）。打分 5 档（basename 全等 1000 / 前缀 900 / 包含 700 / 全路径包含 500 /
  子序列 300），目录 +25，同分目录优先 → 短路径优先 → 字典序。
- 隐藏项只在 fragment 以 `.` 开头时出现（真机 `@.env` 能查到 `.env`，`@` 查不到 —— 否则每个
  项目都会被 `.git`、`.qqbat` 刷屏）。
- 写盘立刻失效索引：`services/fileOps.ts` 的 `writeProjectFile` 写完就
  `invalidateFileReferenceIndex(projectPath)` —— 否则 3 秒 TTL 内刚写出的文件搜不到，看起来像没建成。
- 提示词 `FILE_REFERENCE_PROMPT`（上游原文，`read` 换成我们的 `read_file`）注册在
  `agent-core/prompt.ts` 的 `order: 35`，**条件注入**：工作区为空或工具白名单里没有 `read_file` 时
  给空串（没有读文件的能力却告诉模型"去读那个路径"是纯坑）。
- 额外一件上游没做的：`describeMissingFileReferences` —— 用户这句话里 `@` 到的路径在工作区真不存在时，
  在系统提示里直接告诉模型"这些路径不存在，先说清找不到再问他要哪个"。真机上 `@src/rend` 那一轮，
  模型先列 `src/` 确认只有 `plugins/` 再追问，没有瞎编一个文件读（`trace` 里只有一次 `list_dir`）。

### 58.6 IPC 与能力账

4 条新通道（全部 `assertProjectPathAllowed` + `tryIpcAsync`，并登记进
`tests/guards/ipcPayloadContract.test.ts`）：

- `ai:getThreadFeedback`（读整表）、`ai:putMessageFeedback`（已落盘 assistant 消息打评价）、
  `ai:deleteMessageFeedback`（撤回）—— 载荷 schema 在 `src/main/schemas/ai.ts`。
  preload 的 `putMessageFeedback` 刻意写成**字面量载荷**，因为契约闸门是静态抠
  `invoke('x', { ... })` 的键名，传整包 `payload` 会被判"无法静态核对"。
- `file:searchReferences`（候选列表）—— schema 在 `src/main/schemas/file.ts`，服务在
  `src/main/services/ai/fileReference.ts`，`baseDir` 有值时先 `assertWithinProject`。

能力账（`docs/ai/ai-capability-layering-2026-10-08.md`）：`ai` 58 → **61**、`file` 6 → **7**，
合计 283 → **287**、X + ⛔ 86 → **90**；`node scripts/gen-capability-catalog.mjs` 重生成两份
generated（287 条）。顺手把附录小计的存量错账改了（改前写 `X 79 = 279`，与附录 A 的 281 条不符）。

### 58.7 测试与闸门

新增 9 个测试文件、改动 2 个：

- `tests/shared/ai/messageFeedback.test.ts`(8)：7 档分类顺序、归一剥 C0/C1、折叠空白、按码点截 500
  不切碎 emoji、刚好 500。
- `tests/shared/ai/fileReference.test.ts`(24)：行首/空白后触发、邮箱不触发、**中间光标不触发**
  （含引号态）、越界/非整数 caret、`formatFileReferenceMention` 四种形态 + 不可表达返回 null、
  `applyFileReferencePick` 的 settle/drill/已跟空白不补第二个空格/引号态整体替换、
  `parseFileReferenceMentions` 剥尾随中英标点、提示词含 `use the read_file tool`。
- `tests/main/services/ai/messageFeedback.test.ts`(12)：落盘路径与 `version`、`target-not-found`、
  user 消息不能打反馈、未知分类/评分、纯控制字符等于没写、2001 字拒绝不截断、**内容没变不写盘**、
  改评分保留 `createdAt`、撤回幂等、`clearThreadFeedback`、两线程互不影响、坏文件读成空表。
- `tests/main/services/ai/fileReference.test.ts`(21)：空 query 列根、`src/` 排序、隐藏项规则、
  `../` 越界返回 `[]`、limit 夹取、basename 全等优先、确定性、同分目录优先、排除目录不参与、
  子序列命中、3 秒缓存需失效、baseDir 越界抛错、`writeProjectFile` 立刻失效索引、
  `describeMissingFileReferences` 五例。
- 渲染层：`MessageActions.feedback`(6)、`MessageFeedbackDialog`(14)、`AgentTranscript.feedback`(9)、
  `AtReferenceMenu`(7)、`ChatPanelAtReference`(11，含"搜索还没回来时按 Enter 不插旧候选、也不发送")。
- 改动：`tests/main/ipc/aiAgentCore-ipc.test.ts` 34 → **36**（"`ai:response` 与历史落盘共用同一个
  messageId" + 回执也带 messageId；"`@` 了不存在的路径 → 系统提示带 mentionNote"）、
  `tests/main/services/agent-core/uiTrace.test.ts` 补 `id` 断言。

闸门实测：`tsc -p tsconfig.node.json` = **0**、`tsc -p tsconfig.web.json` = **0**；
`vitest run tests/guards` = **15 文件 / 107 例全绿**；全量 `vitest run` = **302 passed | 2 skipped
（304 文件）/ 3788 passed | 7 skipped（3795 例）**、185.69s（第 57 批 295 文件 / 3681 例 →
+9 文件 / +114 例）；`electron-vite build` = **EXIT 0**。日志：`_recovery/full-gate-batch58.log`、
`_recovery/gate-batch58-vitest-exit.txt`、`_recovery/build-batch58.log`。

prettier：本批新写的 6 个文件先 `--write` 再 `--check` 全过。4 个"存量就不干净"的文件
（`src/main/ipc/file.ts`、`src/main/schemas/file.ts`、`src/main/services/fileOps.ts`、
`src/main/services/ai/historyStore.ts`）用 `git show HEAD:<path>` 取 HEAD 版本单独 check 证实
本来就不过 —— 按第 55/56/57 批先例不动整文件，避免把两百行无意义 diff 混进功能提交。

### 58.8 真机（dev + CDP 43191）

1. **起 dev**：`Remove-Item Env:ELECTRON_RUN_AS_NODE`、`$env:QQBAT_CDP_PORT='1'`、
   `node node_modules/electron-vite/bin/electron-vite.js dev`，等 `CDP 已开启：127.0.0.1:43191` +
   `[bootstrap] SQLite 引擎：better-sqlite3`。
2. **老历史不显示反馈按钮**：项目「还原验证项目」41 条历史消息，`button[aria-label="这条回答有帮助"]`
   数 = **0**（老条目没有 id，符合设计）。
3. **第一次跑就红**：界面上发一句"只回复两个字：好的"，新 assistant 只有 复制/重新生成/撤回，
   没有 👍/👎；同一条在 `.qqbat/ai-history.jsonl` 里**有 id**（`fb75815c-…`），`ai:response` 事件
   也带 `messageId`，但界面没有 → 定位到 `runAgentCoreTurn` 兜底分支丢 id（见 58.2）。修完重启，
   同一探针 → **3 对** 👍/👎 出现。
4. **点赞 → 弹层**：点 👍 **不落库**，`[role="dialog"]` 文本是 `提交反馈 / 反馈分类（7 chip）/
反馈详情 / 0 / 500 / 取消 / 提交`，`textarea` 的 `maxlength="500"`。
5. **提交**：选「任务结果」→ `aria-pressed="true"`；填 16 字说明（计数 `16 / 500`）→ 提交 → 弹层关、
   目标消息 `good aria-pressed="true" data-active="true"`、行下 `role="status"`「感谢你的反馈」、
   `getThreadFeedback` 回 `{rating:'positive', category:'task-result', note:'真机探针：回复准确、
没有多余动作'}`。
6. **撤回**：再点同一个 👍 → `aria-pressed="false"`、状态「已撤回反馈」、条目数 **0**。
7. **点踩**：👎 打开同一个弹层 → 选「稳定性和速度」→ 提交 → `bad aria-pressed="true"`、
   条目 `{rating:'negative', category:'service-stability'}`；好按钮仍 false（互斥）。
8. **重启后仍在**：杀 electron 重启，`messageCount=49`、带反馈按钮的 **4** 条、
   `{id:'ai-msg-46', good:'false', bad:'true'}`、`feedbackItemCount=1` —— 从磁盘恢复成功。
9. **@ 菜单（真实键盘路径，`_recovery/cdp-at.mjs`：`Input.insertText` + `Input.dispatchKeyEvent`）**：
   输入 `@` → `[role="listbox"]` 文本 `引用文件↑↓ 选择 · Enter 插入 · Esc 关闭` + 候选 `data/`、`src/`；
   再输 `src/` → 只剩 `src/plugins/`；`ArrowDown` + `Enter`（目录）→ 输入框变 `@src/plugins/`、
   caret 13、菜单**保持打开**（下钻）。
10. **隐藏项与文件补空格**：`@.env` → 候选 `.env`；`Enter` → 文本 `@.env `（文件后补**一个**空格）、
    caret 6、菜单关闭。
11. **顺带发现的 UX bug**：搜索还没回来时菜单里挂着上一轮候选，此时 Enter 会插入**过期路径**
    （菜单同时显示「正在查找…」和旧结论）。修法：`useAtReference.onKeyDown` 在 `loading` 期间把
    Enter/Tab 吞掉（不插、也不落到"发送"），并补一条用例钉住。

诚实边界（没真机跑的）：

- 中文输入法的组合事件（`compositionstart/end`）在 @ 菜单里没测；真机输入走 `Input.insertText`。
- 「含空格路径」的引号形态没在真机验（验证项目里没有带空格的文件），只有单测覆盖。
- 多窗口/多客户端同时改同一条消息的反馈没测（本批没搬 `version` 乐观并发，见 58.3）。
- 反馈弹层的分类 chip 键盘 Tab 顺序没逐步验；Esc 与遮罩两条关闭路径验过。
- 探针在 default 线程里误发的两条消息（`@src/rend` 与一次失控的 Enter）已从历史里清掉，
  备份在 `_recovery/probe58/ai-history-default.bak.jsonl`；`ai-msg-46` 的负反馈保留作持久化证据。

### 58.9 涉及文件

新增 `src/shared/ai/messageFeedback.ts`(73)、`src/shared/ai/fileReference.ts`(160)、
`src/main/services/ai/messageFeedback.ts`(218)、`src/main/services/ai/fileReference.ts`(287)、
`src/renderer/src/components/ai/MessageFeedbackDialog.tsx`(192)、`AtReferenceMenu.tsx`(152)、
`src/renderer/src/hooks/useAtReference.ts`(204)、9 个测试文件、
`docs/ai/dsh-plugin-porting-survey-2026-10-27.md`、`_recovery/cdp-at.mjs`（真机驱动）。

改动 `src/main/ipc/ai.ts`(906，三条 handler)、`src/main/ipc/aiAgentCore.ts`(1046，messageId 生成/
透传/mentionNote)、`src/main/ipc/file.ts`(185，`file:searchReferences`)、
`src/main/schemas/{ai,file}.ts`、`src/main/services/ai/historyStore.ts`(419，id 进出)、
`src/main/services/agent-core/{runTurn,prompt,uiTrace}.ts`、`src/main/services/fileOps.ts`(63，写盘
失效索引)、`src/preload/index.ts`(1141)、`src/renderer/src/types/ipc.ts`(1773)、
`src/renderer/src/stores/aiStore.ts`(2524，`threadFeedback` + 三个 action + 兜底 messageId)、
`src/renderer/src/components/ai/ChatPanel.tsx`(1717，@ 菜单接线净 +40)、`AgentTranscript.tsx`(213)、
`MessageActions.tsx`(149)、`src/renderer/src/i18n/{zh-CN,en-US}.json`（`ai.feedback.*` 17 键 +
`ai.at.*` 6 键）、`capabilityCatalog.generated.ts`、`capabilityPolicy.generated.ts`、
`tests/guards/ipcPayloadContract.test.ts`、`tests/main/ipc/aiAgentCore-ipc.test.ts`、
`tests/main/services/agent-core/uiTrace.test.ts`、`docs/ai/ai-capability-layering-2026-10-08.md`、
`docs/ai/dsh-source-adaptation-2026-10-24.md`、`README.md`。

## §59 第 59 批：并行工具数设置 + 会话检索 + 持久终端（2026-10-27）

### 59.1 为什么是这三件

**并行工具调用数设置**对标上游 `dsh-client-ui-settings-agent-loop`（配置页里一个数字字段），让模型在「同一批里几个工具同时跑」这件事上有控制权。上游默认 10，我们这里也能关到 1（全串行）。这是真机撞出来的需求：有些任务串行更稳，但之前没开关。

**会话检索工具**对标上游 `dsh-tool-session-query`（49 KB），让模型能搜这个项目的历史对话，而不是只会「瞎猜」。DSH 两条行为契约必须落地：①达上限 12 条要说「已达上限，可能还有更多」；②排除当前这段对话（自己不能当证据）。

**持久终端 6 工具**对标上游 `dsh-tool-terminal`（terminal_open/send/read/signal/close/list），不是 run_command 的替代——后者是一次性进程（起→跑→退），这个是开着的 shell（可以连续 cd/build 看日志）。问题在于：`ShellSession` 在第 59 批前已经写完（78 行），但全仓零引用 → 死代码。这版把它活化成 6 个工具，并照 DSH 规则限制 4 个会话、256KB 输出截断。

注意：审批白名单记忆**早已存在**且比上游强（always+ 可撤销规则表 +5min 超时），这一批不再动。

### 59.2 并行工具数：设置层 + 运行时

**服务文件**：新建 `src/main/services/ai/parallelToolCallsSettings.ts`（干净 TS，非 @ts-nocheck）—— 照 `budgetSettings.ts` 的「双读单写 + 应用进运行时」形状。导出常量 `MAX_PARALLEL_DEFAULT = 10`（与 `core.ts` 的 `MAX_PARALLEL_TOOL_CALLS_DEFAULT` 同值，注释说明为何不 import：避免反向依赖）、`MAX_PARALLEL_LIMIT = 50`、`MIN_PARALLEL = 1`；schema `parallelToolCallsSchema = z.object({ enabled: z.boolean(), maxParallel: z.number().int().min(1).max(50) })`；模块级 `let active`；`parallelSettingPath() = userDataPathOrThrow('aiParallelToolCalls', electron.app)`；`readParallelToolCallsSetting()`（缺失/非法 → 默认值 + warn）、`writeParallelToolCallsSetting()`（`atomicWrite`）、`applyParallelToolCallsSetting()`、`loadAndApplyParallelToolCalls()`、`currentParallelToolCallsSetting()`；关键函数 **`effectiveMaxParallelToolCalls(): number`** —— 关掉时返回 **1** 而不是 undefined，注释写明理由：undefined 会让循环回落默认 10，那就是静默失败。

**paths.ts**：`USER_DATA_LAYOUT` 加 `aiParallelToolCalls: ['config', 'ai-parallel-tool-calls.json']`（`LEGACY_USER_DATA_LAYOUT` 不用加，这是新设置）。

**IPC**：`src/main/ipc/ai.ts` 新增 `ai:getParallelToolCalls`（无载荷，直接回 `currentParallelToolCallsSetting()`）与 `ai:setParallelToolCalls`（校验 → 写盘 → apply → 回当前值），handler 插在 `ai:setToolBudget` 之后。

**runTurn.ts**：`RunTurnInput` 末尾加 `maxParallelToolCalls?: number`；`runAgentLoop({...})` 参数末尾加 `...(input.maxParallelToolCalls ? { maxParallelToolCalls: input.maxParallelToolCalls } : {}),`。

**aiAgentCore.ts**：import `effectiveMaxParallelToolCalls`；`runAgentTurn({...})` 的参数里加 `maxParallelToolCalls: effectiveMaxParallelToolCalls(),`。

**index.ts**：在 `await loadAndApplyToolBudget();` 后加 `await loadAndApplyParallelToolCalls();`（注释：必须在使用 AI 之前应用）。

**渲染层 store**：`aiStore.ts` 接口区加 `maxParallelToolCalls: { enabled; maxParallel }` + `loadParallelToolCalls(): Promise<void>` + `saveParallelToolCalls(enabled, maxParallel): Promise<{ok:true}|{ok:false;error:string}>`；初始 state `maxParallelToolCalls: { enabled: true, maxParallel: 10 }`；实现里 `loadParallelToolCalls` 桥缺失直接 return；`saveParallelToolCalls` 先落盘再改本地。

**设置界面**：`AIProviderConfig.tsx`（418→约 480 行）—— `const [parallel, setParallel] = useState({ enabled: true, maxParallel: 10 })` 与 `parallelError`；`useEffect` 里 `void window.qqbat.ai.getParallelToolCalls().then(...)`；`saveBudget` 之后加 `saveParallel(next)`（乐观写本地 → 调 IPC → 失败显示 error）；toolBudget 块之后加一整块并行设置（Switch + 数字输入 `min=1 max=50 step=1` + 失焦落盘 + 关闭 amber 提示 + 错误行）。

**i18n**：两份在 `settings.aiProvider.toolBudget` 之后各加 `parallelToolCalls: { title, hint, value, unit, defaultNote, offHint, saveFailed }`（zh/en 键集合一致）。

**闸门**：tsc node/web 均 0；`tests/main/services/ai/parallelToolCallsSettings.test.ts` **17 例全绿**（mock paths/electron，用临时目录）：文件不存在→默认、默认值与 core 的 10 一致、正常读回、坏 JSON→默认、越界 (0/51/2.5)→默认、缺字段→默认、写盘带缩进 JSON、往返一致、apply 后 current 反映、current 返回副本、loadAndApply 应用、loadAndApply 遇坏文件回落、★关掉=1 非 undefined、默认=10、schema 接受 1/50 拒绝 0/51/1.5/缺 enabled。`tests/guards/ipcPayloadContract.test.ts` 在 EXEMPT 里加 `'ai:getParallelToolCalls': '无载荷'` 与 `'ai:setParallelToolCalls': '载荷是 { enabled, maxParallel }，键名由 aiSetParallelToolCallsSchema 校验'` → **5 例全绿**。

### 59.3 会话检索工具：从 service 到 tool

**新建工具**：`src/main/services/agent-core/sessionSearchTool.ts`（`export const SESSION_SEARCH_TOOL: Tool`）—— name='search_sessions'，readOnly=true，category='query'，executionMode='parallel'，timeoutMs=30_000，parameters `{ query(required), limit }`；MAX_RESULTS=12（THREAD_SEARCH_MAX_RESULTS）、MAX_TEXT_CHARS=6000；内部 `formatResult(payload, excludedThreadId)` 用 `excludedThreadId ? results.filter(r => r.id !== excludedThreadId) : results` 排除调用方，输出「`「query」命中 N 条历史会话（不含当前这段）：`」+ 每条 `## 标题` / `- 会话 id · 最后活动 YYYY-MM-DD HH:mm · N 条消息` / `- 用户/助手：片段`；**达上限时**追加「（已达上限 12 条，可能还有更多：把查询写得更具体，或分开搜几个不同的词。）」；超 6000 字截断加 `…（结果过长，已截断）`；空查询回「查询为空：请给出至少一个字的关键词。」；异常回「搜索历史会话时出错：…」（不崩整轮）。文件头注释记了 DSH 的两条契约与「不放进 CORE_TOOLS」的理由。

**ToolContext.threadId**：`src/main/services/agent-core/toolGate.ts` 的 `ToolContext` 末尾加 `threadId?: string`（注释：给 search_sessions 排除调用方）。

**core.ts**：`LoopOptions` 的 `fsObservation` 之后加 `threadId?: string`；`const ctx: ToolContext = {...}` 末尾加 `...(opts.threadId ? { threadId: opts.threadId } : {}),`；import `SESSION_SEARCH_TOOL`；`registerTool(TODO_TOOL)` 之后加 `registerTool(SESSION_SEARCH_TOOL)`（不入 CORE_TOOLS）。

**prompt.ts**：新增 `SESSION_SEARCH_PROMPT` 常量 + `registerPromptSection({ id: 'session-search', order: 36, render: ({ workspace, toolNames }) => workspace && toolNames.includes('search_sessions') ? SESSION_SEARCH_PROMPT : '' })`（条件注入）。

**测试**：`tests/main/services/agent-core/sessionSearchTool.test.ts` **11 例全绿**：搜到别的线程正文、★排除调用方自己、别的线程仍能搜到、无命中提示换说法、空查询拒绝、★达上限说「已达上限」+「更具体」、未达上限不多嘴、limit 收窄、带线程 id 与时间、工具声明只读/可并行/无 approval、空工作区不抛。

**闸门**：`tests/main/services/agent-core/prompt.test.ts` 5→**8 例全绿**（+3 例 search_sessions 条件注入：可用时出现/不可用时不出现/无工作区不出现）。

### 59.4 持久终端 6 工具：待收尾

队友正在收尾 `ShellSession.send()` 的输出起点错位 bug，预计修好后能过全部 17 例。该部分包含：`terminal.ts`（`ShellSession` 的 `send/read/signal/close/list/run`）、`terminalTools.ts`（6 个 `Tool` 封装 + `killAllAgentTerminals`）、以及对应的两个测试文件。暂不纳入本次提交 gates，等 teammate 修复后一并加入。

### 59.5 能力账

`docs/ai/ai-capability-layering-2026-10-08.md`：`| ai |` 行 63→63、X 63→63；小计 X **89**、合计 **289**；X+⛔ **92**；附录 A 插入 `ai.getParallelToolCalls = X` 与 `ai.setParallelToolCalls = X`；附录小计 `X 89 = 289`。`node scripts/gen-capability-catalog.mjs` → `[capability-catalog] 已写入两份（289 条）`。

### 59.6 涉及文件行数

Lead-side 完整交付：`parallelToolCallsSettings.ts`(96)、`sessionSearchTool.ts`(152)、`runTurn.ts`(284)，`ai.ts`(924)，`aiAgentCore.ts`(1055)，`paths.ts`(194)，`AIProviderConfig.tsx`(约 480)，`capabilityCatalog.generated.ts`(289 条)，`capabilityPolicy.generated.ts`(289 条)。

测试：`parallelToolCallsSettings.test.ts`(240 行/17 例)、`sessionSearchTool.test.ts`(150 行/11 例)、`prompt.test.ts`(210 行/8 例)、`ipcPayloadContract.test.ts`(258 行/5 例)。

Terminal-b59 队友交付待定：`terminal.ts`(198)、`terminalTools.ts`(311)、`terminal.test.ts`(180 行/7 例)、`terminalTools.test.ts`(180 行/10 例) —— 6 个用例失败等待修复。

TASK AS OF THIS BLOCK：并行工具数设置 + 会话检索工具已 Lead-side 完整落地并各自有测试（17+11+3+5 绿），tsc node/web 均 0；持久终端 6 工具由队友收尾（6 个失败正在修）；剩余 = 等队友完成 terminal 测试 → 全量 vitest → build → 真机（并行数设置 + search_sessions）→ wiring §59 补完 → 适配表第十三批一行 + README 数字更新 → 提交。
Open objectives: 第 59 批「并行工具调用数设置 + 会话检索工具 + 持久终端 6 工具」做完并提交（用户 m03057/m03510/m03533「继续」延续 m01170「能搬就搬」）。

## §60 第 60 批：每轮刷新标题 + 审批策略句与四结局话术（2026-10-28）

### 60.1 为什么是这两件

第 59 批收口时，上游 `others.md` §5 与 `approval.md` §10 各剩一件"小但每天都被真机碰到"的事：①会话标题只在**首轮**生成一次，聊了三轮后标题还停在「看看这个项目」，会话列表里全是同款项；②审批的**失败结局**在模型眼里只有一种（"被拒绝"），可实际有四种（拒绝 / 超时 / 取消 / 没有窗口），模型把"没窗口"这种环境故障当成"用户不喜欢"，于是换个参数重试同一个危险动作。两件都不引入新工具、新依赖，但都改"模型看到的世界"。

### 60.2 每轮刷新标题（A，`others.md` §5 B 策略）

**数据形状**（`src/shared/ai/threadTitleTypes.ts`，31 行）：`ThreadTitleRecord` 加两字段 —— 必填 `revision: number`（每次**真落盘** +1，用来判在飞刷新是否过期；旧文件读时兜底 1）与可选 `inputCount?: number`（生成时折叠的用户消息数）。`ThreadTitleSource` 仍是 `'fallback' | 'provider' | 'user'`：fallback 仍不落盘，user 改名仍 pin 住。

**服务**（`src/main/services/ai/threadTitles.ts`，447 行，原有 214 行的重构 + 新函数）：

- `parseRecord` 容忍旧记录（revision 缺失 → 1）；`setThreadTitle` 加 `force` 选项，并给 `WriteFenceOptions` 补「旧版本号」与「是否重命名」——原因是 `maybeRefreshThreadTitle` 的 prompt 生成要 30s，期间用户可能已经手动改名，**在飞刷新不能覆盖 user 标题**，也不能把 revision 回退。
- 生成侧：`buildTitlePrompt` 仍取首条用户消息 + 首个助手回复各 500 字（`TITLE_PROMPT_CHARS`/`TITLE_RESPONSE_CHARS`）；新增 `buildRefreshPrompt`（`REFRESH_INPUT_MAX_CHARS = 4000`）喂**最近几轮折叠对话**，并**剔除 `toolCallsRejected` 的轮次**（工具被拒的回复没有信息量，喂进去会把标题带偏）。
- `maybeGenerateThreadTitle`（首轮，`kind: 'generate'`）与新增 `maybeRefreshThreadTitle`（后续轮，`kind: 'refresh'`）共用 `generateTitleText`；provider 没出字、超时（`TITLE_TIMEOUT_MS = 30_000`）、信号中止 → 静默放弃，标题保持旧值。
- 去抖：`REFRESH_INFLIGHT`（每个 thread 一个 AbortController，在飞时新请求直接放弃）+ `REFRESH_LAST_AT`（**最小间隔 `REFRESH_MIN_INTERVAL_MS = 2000`**，`pruneRefreshClock` 每 200 次清理一次超 60s 的旧键）。这里踩过一个坑：只靠"在飞"去抖不够——第一次刷新完成后立刻又调就绕过了间隔，标题会在两轮内被反复改写；所以间隔必须是**上次落盘之后**算，而不是"仍在生成中"。

**落盘判定**（`src/main/ipc/aiAgentCore.ts`）：`isFirstTurn = !past.some(entry => entry.role === 'user')`（历史里还没有任何用户消息）→ 首轮走 generate；否则走 refresh（`ctrl.signal.aborted` 或开关关闭就跳过）。落盘前用 `past` 读到的旧 `revision` 比对——旧记录被用户改名/别的轮刷新过（`threadTitleAutoRefreshEnabled()` 关闭同理）就放弃本次结果。

**开关**（队友 task-1 交付，9 个导出 + 17 例测试）：`src/main/services/ai/threadTitleSettings.ts`（113 行）照 `parallelToolCallsSettings.ts` 的「双读单写 + 应用进运行时」形状；`paths.ts` 加 `USER_DATA_LAYOUT.aiThreadTitleRefresh = ['config', 'ai-thread-title-refresh.json']`；`index.ts` 启动 `await loadAndApplyThreadTitleRefresh()`；IPC `ai:getThreadTitleRefresh` / `ai:setThreadTitleRefresh`；`AIProviderConfig.tsx` 紧跟「并行工具调用数」块加 `auto / off` 下拉（off 时显示 amber 提示）；i18n 两份各 6 键 `settings.aiProvider.threadTitleRefresh.*`；`aiAgentCore.ts` 用 `threadTitleAutoRefreshEnabled()` 把开关接上（关闭 = 首轮仍生成、后续轮不再刷新）。

**测试**：`tests/main/services/ai/threadTitles.test.ts` 19 例（原有 11 例按 revision 更新 + 新增「刷新」段 8 例：空输入/缺 key 不发、user 标题 pin、模型原样返回不落盘、消息条数与上次相同不重问、话题变了 revision+1 且记 inputCount、折叠超 4000 字跳过、生成期间用户改名以用户为准、2 秒内连发只发前一次）；`aiAgentCore-ipc.test.ts` 40 例，新增第 60 批刷新段 3 例（非首轮 → 用「历史用户消息 + 本轮要求」调 refresh、开关关着不调、首轮只走 generate）。

### 60.3 审批 M1：审批策略句进系统提示

**提示词**（`src/main/services/agent-core/prompt.ts`，226 行）：`PromptContext` 加 `approvalPolicy?: 'ask' | 'never'`；规矩第 4 条按口径分岔（ask：「写文件、跑命令会先弹审批给人点。被拒绝时**不要原地重试**」；never：「**不再弹审批**（完全权限）……但角色写域边界仍然有效」）；新增 `APPROVAL_POLICY_PROMPT: Record<'ask' | 'never', string>` 与段落 `id: 'approval-policy', order: 32`（**有工作区才渲染**——开荒没有写盘/跑命令，讲审批是噪音）。ask 文案把四种结局逐条写明（拒绝→换做法；超时 5 分钟→先做别的、收尾提醒点确认；本轮取消→立刻停；无窗口→环境问题，提醒开主窗口）。never 文案明确「不存在请求升级权限的参数，不要尝试」。

**链路**：`RunTurnInput` 加 `approvalMode?: 'ask' | 'never'`（`runTurn.ts`，315 行），组装系统提示时 `...(input.approvalMode ? { approvalPolicy: input.approvalMode } : {})`；`aiAgentCore.ts` 传 `approvalMode: effectiveFullAccess ? 'never' : 'ask'`（与同一处 `effectiveFullAccess = fullAccess ?? runPreset?.permissionMode === 'full'` 同口径，预设 `full` 与调用方开关都算「不弹审批」）。

**测试**：`prompt.test.ts` 8→11 例（approval-policy 段三例：默认按 ask 注入含四种结局、never 明确不弹窗且不出现 ask 话术、无工作区不出现）；`runTurn.test.ts` 13→14 例（捕获第一轮 `m[0].content` 断言 ask/never 两副口径）。

### 60.4 审批 M2：四结局区分话术（`approval.md` §10.1）

**契约扩展**（`src/main/services/ai/toolApproval.ts`，169 行）：

- `export type ApprovalReason = 'user' | 'timeout' | 'aborted' | 'unavailable'`；`export interface ApprovalResult { decision: ApprovalDecision; reason: ApprovalReason }`。
- `requestApproval(req, { emit, signal?, timeoutMs? })` 返回值从 `ApprovalDecision` 改成 `Promise<ApprovalResult>`：用户点 `allow/deny/always` → `reason: 'user'`；5 分钟定时器 → `{ deny, timeout }`；`signal` 中止 → `{ deny, aborted }`；同一 `callId` 重复请求（旧请求已被新请求顶掉）→ `{ deny, aborted }`；`resolveApproval` 仍回 boolean（它只答"这次点的是不是允许"），未点以前的结构由 `requestApproval` 自己补 reason。`cancelApprovalsFor` / 测试用的 `_resetApprovals` → `aborted`。

**闸门抽模块**（`src/main/ipc/aiAgentCoreApproval.ts`，201 行，新文件）：原 `aiAgentCore.ts` 里 100 行的审批回调整体搬到 `createApprovalGate(ctx: ApprovalGateContext): (req, signal?) => Promise<boolean>`，`aiAgentCore.ts` 从 1167 → 988 行（`fileGrowth` 闸门从 +112 行超阈值 → 绿）。`ApprovalGateContext` 字段：`projectPath / role / effectiveFullAccess / allowRules / approved / window: BrowserWindow | null / addRule`。顺序是硬约束：**角色写域闸在最前**（越界写连弹窗都不弹——让用户点「允许」绕过角色边界等于边界不存在）→ 全权直通 → 已记住的规则（本轮 `approved` 集合 / 跨轮 `allowRules`）→ 没有窗口（`window == null` 或 `isDestroyed()`）**立刻 throw `approvalDeniedText(req, 'unavailable')`**（不让模型干等 5 分钟）→ `requestApproval`。

**四结局话术**（`approvalDeniedText`，模块内私有）：拒绝 =「用户拒绝了 … 不要原地重试同一个调用：换一种做法，或先问清用户想要什么。」；超时 =「等待确认超时（5 分钟没人点，按拒绝处理）… 先把不依赖它的部分做完，收尾时提醒用户点一下确认。」；取消 =「这次确认被取消了（这一轮已中止）…」；不可用 =「没有可用的审批通道（没有打开的应用窗口）… 这属于环境问题，提醒用户打开主窗口，别换个参数绕过去。」。全部 **throw Error**，由 `toolPipeline` 的 catch 变成 `[工具失败] <原因>`（与角色写域同一口子，零管线改动）。

**MCP 侧**（`src/main/mcp/server.ts`）：`applyToolGuard` 的两个 `requestApproval` 调用点改读 `outcome.decision`；「没有窗口」已自带 fail-safe 话术（保持）。

**测试**：新建 `tests/main/ipc/aiAgentCoreApproval.test.ts` **9 例**（mock `requestApproval`）：无窗口 → 拒且不弹窗；窗口已销毁同；全权直通不写规则；本轮 approved 直通；以前记的规则直通；always 落规则并见附录；拒绝/超时/取消三句不同；builder 写 src/ 直接拒且不弹窗；builder 写流程文件照常弹。`aiAgentCore-ipc.test.ts` 37 例里更新 deny 断言为 `rejects`（原因里含「被用户拒绝了」）并新增"四种结局"三例。

### 60.5 能力账

`docs/ai/ai-capability-layering-2026-10-08.md`：`ai` 行 63→65、小计 X **89→91**、合计 **289→291**；附录 A 加 `ai.getThreadTitleRefresh = X` 与 `ai.setThreadTitleRefresh = X`（两条都是主进程内部开关，不进模型工具表）。`node scripts/gen-capability-catalog.mjs` → 两份 generated 同步（291 条）。`tests/guards/ipcPayloadContract.test.ts` 在 EXEMPT 里补这两条载荷说明（闸门要求每个新 `ai:` 通道表态）。

### 60.6 涉及文件行数

新增：`aiAgentCoreApproval.ts`(201)、`threadTitleSettings.ts`(113)、`threadTitleTypes.ts`(31)。改动：`threadTitles.ts`(214→447)、`toolApproval.ts`(→169)、`prompt.ts`(179→226)、`runTurn.ts`(→315)、`aiAgentCore.ts`(1167→988)、`mcp/server.ts`(→511)、`AIProviderConfig.tsx`(+55)、`ai.ts`(+32)、`schemas/ai.ts`(+8)、`paths.ts`(+2)、`index.ts`(+5)、`preload/index.ts`(+4)、`types/ipc.ts`(+3)、i18n 两份各 +8 行。

测试：`threadTitles.test.ts`(19 例)、`aiAgentCore-ipc.test.ts`(40 例)、`aiAgentCoreApproval.test.ts`(9 例)、`prompt.test.ts`(11 例)、`runTurn.test.ts`(14 例)、`threadTitleSettings.test.ts`(17 例)、`ipcPayloadContract.test.ts`(+2 EXEMPT)。

### 60.7 闸门

typecheck node/web 均 `EXIT=0`；全量 vitest 见提交说明（本次全绿后才提交）；`fileGrowth` 4/4、`styleContract` 4/4、`deadExports`/`i18n`/`orphanKeys`/`capability*` 全绿；新文件过 prettier。

## §61 第 61 批：协议契约层 + 智能体 SDK 门面（2026-10-28，P0）

### 61.1 为什么先做这一步

39 个 `registerXxxIpc` 把 291 条 IPC 通道平铺在 preload 上，智能体相关约 100 条。这些通道是"内部接线"：改个参数名就动到调用方，跟"开放给插件/第三方"的目标是反的。P0 不新增能力，只做两件事——**给智能体那一面冻结一份带版本的语义契约**，并让 preload 在一个稳定名字下暴露它。证据见 `docs/ai/protocol-sdk.md`。

### 61.2 契约层（新增，不依赖 Electron）

- `src/shared/protocol/rpc/version.ts`：`PROTOCOL_VERSION = 1`。规则写进注释：新增方法 = minor，改语义/删方法 = major。
- `src/shared/protocol/rpc/agentSdk.ts`：`AgentSdk` 26 个方法（send/steer/stop/isRunning/listTools/listThreads/getHistory/clearThread/renameThread/searchThreads/exportThread/getThreadFeedback/putMessageFeedback/deleteMessageFeedback/listTurns/previewTurn/rollbackTurn/rewindTo/noteTurn/getConfig/getAppConfig/resolveApproval/getParallelToolCalls/setParallelToolCalls/getThreadTitleRefresh/setThreadTitleRefresh）；`AGENT_METHODS: readonly AgentMethodSpec[]` 逐条登记 `{ sdk, channel: 'ai:…', schema, note }`——**通道名只在这张表里出现**，调用方按方法名调用。
- 入参全部具名对象（`{ projectPath, threadId, … }`），不跟着 IPC 的位置参数走；`AgentSendInput` 11 个字段（`preset?: string | null`、`agentMode: 'plan' | 'build'`、`images`、`activeFilePath` 等）。

### 61.3 preload 门面

`src/preload/agentSdk.ts` 的 `createAgentSdk(ai)` 把具名入参映射回位置参数（`ai.agentCoreRun(p, r, …, preset ?? undefined, …)`），**复用同一个函数对象**——没有新的 `invoke('ai:…')` 字面量，所以载荷守卫的覆盖范围不变。`preload/index.ts` 仍以标识符形式 `contextBridge.exposeInMainWorld('qqbat', api)`，再用 `Object.assign(api, { agent, protocolVersion: PROTOCOL_VERSION })` 挂上去：两个 AST 守卫都要求第二个参数是标识符，包成对象字面量会直接让守卫失效（`pre.size=2`）。

渲染层 `src/renderer/src/types/ipc.ts` 的 `QqbatApi` 加 `agent: AgentSdk` 与 `protocolVersion: number`，类型即文档。

### 61.4 守卫

- 新增 `tests/guards/protocolContract.test.ts`（7 例）：版本号、方法名/通道唯一、每个通道在 preload 里真有 `invoke(...)`、每个 schema 名都能在 `schemas/ai.ts` 解析出 `safeParse` 函数、`createAgentSdk` 的键集合与契约表完全一致（用 Proxy 假 ai 记录调用）、抽样断言 6 个方法的参数映射、preload 三处接线字符串不漂。
- `tests/guards/ipcSurfaceParity.test.ts`：门面的 `agent.*` / `protocolVersion` **不是 IPC 通道**（由上面 7 例单独对账），在"类型声明 ↔ preload 暴露"对账里排除，正则 `/^(?:agent(?:\.|$)|protocolVersion$)/`。该文件在 HEAD 上本就不是 prettier 合规（整份分号），改动沿用 HEAD 风格、只动两处，不做整份重排。

### 61.5 涉及文件行数

新增：`shared/protocol/rpc/version.ts`(15)、`shared/protocol/rpc/agentSdk.ts`(约 210)、`preload/agentSdk.ts`(约 80)、`tests/guards/protocolContract.test.ts`(约 120)、`docs/ai/protocol-sdk.md`(约 90)。改动：`preload/index.ts`(+15)、`renderer/src/types/ipc.ts`(+10)、`tests/guards/ipcSurfaceParity.test.ts`(+8)。**未新增 IPC 通道**（291 条不变、能力台账不动），这是本批能一次过闸的原因。

### 61.6 闸门

typecheck node/web `EXIT=0`；guards 16 文件 114 例全绿（含新增 7 例）；全量 vitest 见提交说明。新文件 prettier 干净。

### 61.7 下一步（P1/P2 待排）

P1：把 `agent-core` 抽成不依赖 Electron 的 `AgentRuntime`（teammate `runtime-boundary` 的审计文档已并行产出，落在 `docs/ai/agent-runtime-boundary.md`）；P2：291 条通道收敛成"公共 SDK / 内部通道"两层并在 preload 统一 dispatch；P3：agent 窗口做成可替换 surface；P4：manifest v2 + 生态包装。

## §62 第 62 批：AgentRuntime 缝（P1 第一步，2026-10-28）

**做了什么事**：新增 `src/main/services/agent-runtime/index.ts` —— 宿主只需要 `emit` + `approval` 两个洞，运行时把"在干什么"翻译成事件流（`text / reasoning / step / work/start / work/end / stats / compacted`）。本批是 `runAgentTurn` 的**薄包装，行为零变更**；目的不是省代码，是先把边界钉住，让下一批能把 `aiAgentCore.ts:240-961` 的运行体搬进来而不改语义。

**为什么不是"能编译就行"的验收**：`AgentRuntimeTurnInput = Omit<RunTurnInput, 流式回调>`（那组回调是宿主的事），`AgentRuntimeResult = RunTurnResult`（不另造一层）。真正的证明在测试里：假宿主（没有窗口、没有 Electron）驱动纯文本一轮、默认拒绝写盘一轮、放开审批后落盘一轮。

**守卫**：`tests/guards/agentRuntimeElectronFree.test.ts`（2 例）——目录内不许 `from 'electron'` / `BrowserWindow` / `.webContents`，入口不许 `ipcMain` / `callLlm`；注释行先剥掉（本模块头注释就写着"不碰 BrowserWindow"，那是说明不是依赖）。

**测试**：`tests/main/services/agent-runtime/runtime.test.ts` **3 例**（`// @vitest-environment node`），同一批断言在下一批搬迁后必须原样全绿。

**文档**：新增 `docs/ai/bidirectional-adaptation.md` —— 双向适配（DSH 驱动我 / 我驱动 DSH）的形态、传输层、P1 验收、版本与退出、批次计划 62–65。

**闸门**：typecheck node/web `EXIT=0`；新增 5 例 + 全量 vitest 见提交说明；新文件过 prettier。

## §63 第 63 批：运行体搬进 agent-runtime（P1 第二步，2026-10-28）

**做了什么事**：`src/main/ipc/aiAgentCore.ts` 从 989 行降到 284 行 —— 项目内一轮运行体（记忆、预设/角色、工具表、轮循环、提案、标题刷新）整体搬到 `src/main/services/agent-runtime/projectTurn.ts`（789 行）。`ai:agentCoreRun` 的 handler 只剩装配：`RUNNING`/`STEER` 登记、inbox、`emit` 转发、构造两个注入点、`finally` 清理。

**接口**：

- `ProjectTurnInput`：`projectPath / requirement / threadId / memoryFile / signal / emit / stepQueue / turnQueue / persistInbox` + 可选项（`images / fullAccess / planFirst / maxRounds / activeFilePath / preset / agentMode / allowedTools`）。参数名与原 handler 完全一致，搬完后 `emit('ai:…')` 的每一行都没改。
- `ProjectTurnDeps`：`approval(ctx)` —— 宿主手里才有窗口，所以「问人」那一环由宿主用 `createApprovalGate` 组装，运行时只交上下文（角色 / 全权 / 规则表 / 本轮已放行）；`dispatch(instruction)` —— 旧工具里要界面执行的指令（等回执，超时/无窗口都收敛成失败）。
- 开荒分支（`projectPath === ''`）留在宿主，因为它本来就是另一套装配（`runOnboardingTurn`），且没有项目路径可作 `RUNNING` 的键。

**为什么旧链路断言零改动**：实现方式是纯切片搬运 + 3 处注入点替换（`emit` 闭包、审批闸门、`dispatchInstruction`），`aiAgentCoreApproval.ts` 原样复用；四个旧测试文件的断言真的一行没改就全绿。搬运后 `projectTurn.ts` 里不出现 `BrowserWindow` / `win` / `createApprovalGate`。

**顺手做的守卫对账**：

- `tests/guards/agentCoreEventContract.test.ts`：原来把「循环这一侧」写死成 `ipc/aiAgentCore.ts`；改为 `LOOP_FILES`（宿主 + `projectTurn.ts` 两个文件），事件清单与工具事件的 `name/args` 断言不变。
- `tests/guards/fileGrowth.test.ts`：`projectTurn.ts` 压到 800 行以下（789）；`aiAgentCore.ts` 降到 284 后按幽灵规则从登记表删掉。
- `tests/guards/fileSize.test.ts`：`ipc/ai.ts`（975 行）因此进入「又长又热」前几名，按队列规则补一条待拆登记，拆法写清：**按 SDK 面把会话 / 审批 / 设置 / 标题四组 handler 抽成模块**，门面与通道都不变。

**涉及文件行数**：新增 `services/agent-runtime/projectTurn.ts`(789)；`ipc/aiAgentCore.ts` 989 → 284；`tests/guards/agentCoreEventContract.test.ts`(+13)；`tests/guards/fileSize.test.ts`（换一条登记）；`tests/guards/file-size-baseline.json`（删 `aiAgentCore.ts`、更新 `ai.ts`）。

**闸门**：typecheck node/web `EXIT=0`；guards 17 文件 116 例全绿；`agent-runtime` 与 `aiAgentCore*` 测试 43 例全绿；全量 vitest 见提交说明；`projectTurn.ts`、`aiAgentCore.ts` 过 prettier。

**下一步（P1 收尾）**：64 批把 MCP 前端接到 SDK 上（DSH 能连我们），65 批做 `@deepseek-ai/dsh-headless` 适配器实验。本批没跑真机，行为等价靠旧断言。

## §64 第 64 批：平台注册表（P2a 多平台第一步，2026-10-28）

**批次变更说明**：§63 原计划 64 批做 MCP 前端（让 DSH 连我们），用户 10-28 明确「先别让 dsh 连上我们了」，改为先把「多平台/多产品」的地基做掉 —— 对应 P2 的第一步 P2a。

**做了什么事**：把散在 `botTypeConfig.ts`（`@ts-nocheck` 还原文件）、`capabilities.ts`、`builtinCatalog.ts`、`NodePalette`、`NodeSearchDialog` 里的「哪个节点属于哪个平台」收成一份数据表 `src/shared/domain/platform/registry.ts`。用户价值：以后接飞书/钉钉/微信的节点能从同一张表推导可见性，不用改画布。

**为什么只做注册表、不做节点包**：节点库（`src/shared/nodes/`，43 文件）和画布是「保留不动」的产品核心，P2a 只把平台语义抽出来；真正把节点拆成插件包放 P2b（`groups/*` 17 文件是天然切分单位）。

**数据形状**：

- `PlatformFamily` 10 个：`qq / lark / dingtalk / wechat / kook / telegram / discord / slack / sandbox / minecraft`。
- 每族声明 `platformIds`（覆盖 `capabilities.ts` 的 12 个 `PlatformIdSchema` 值）、`projectAdapters`（`official→qq / lark→lark / dingtalk→dingtalk`）、`legacyTags`（`QQ / 飞书 / 微信 / 钉钉`）与中英显示名。
- `projectPlatformFamily(project)`：**adapter 优先于 botType**（飞书项目即使 `botType:'general'` 也算飞书）；`botType:'general'` 且无 adapter → `undefined`（不绑平台）。
- `nodePlatformTags(spec)`：显式 `platform` 与历史 `tags` 取并集去重；`'all'` 展开为空（通用）。
- `specVisibleOnPlatform(spec, family)`：通用节点永远可见；专属节点只在本族可见（`family === null` 时不可见）。

**类型迁移**：`nodeV2.ts` / `flow.ts` 的 `platform?: 'all' | 'qq'` 改为 `platform?: NodePlatformTag`（值联合搬到注册表）。`botTypeConfig.ts` 是还原文件，**不改**；两边漂移由闸门守。

**UI**：`NodePalette` 的徽标从 `spec.platform === 'qq'` 改为按 `nodePlatformTags(spec)` 取第一个族 + `platformLabel(family, locale)`；筛选从 `specVisibleForBotType(spec, botType)` 改为 `specVisibleOnPlatform(spec, projectFamily ?? null)`（先按项目平台收窄，`botType` 选择器仍在）；`NodeSearchDialog` 同步。i18n 键 `palette.qqOfficialTitle / qqOfficial` 换成 `palette.platformOnlyTitle / platformOnly`（中英各两条，带 `{platform}` 参数），用户可见面不再出现「QQ 专属」。

**守卫**：新增 `tests/guards/platformTagCoverage.test.ts`（5 例）：每个节点 `platform` 标注都能在注册表找到；`tags` 里的历史平台标签都已登记；`PlatformIdSchema` 每个值归属唯一族（平台词表漂移即红）；每族有中英显示名且 `AdapterType` 全部有归属。`noOneBotSurface` 的字段断言同步改为 `platform?: NodePlatformTag`。

**测试**：`tests/shared/domain/platform/registry.test.ts` 12 例（项目族判定、标注推导、可见性、与 `botTypeConfig` 词表不漂、显示名）。

**涉及文件行数**：新增 `shared/domain/platform/registry.ts`(约 230)、`tests/shared/domain/platform/registry.test.ts`(约 150)、`tests/guards/platformTagCoverage.test.ts`(约 100)；改动 `nodeV2.ts`(+1 import/+1 类型)、`flow.ts`(同)、`NodePalette.tsx`(+约 20)、`NodeSearchDialog.tsx`(+8)、`zh-CN.json`/`en-US.json`（各 2 键）、`tests/guards/noOneBotSurface.test.ts`(+4)。**未新增 IPC 通道**，能力台账不动。

**闸门**：typecheck node/web `EXIT=0`；guards 18 文件 121 例全绿；新增测试 17 例；全量 vitest 见提交说明。

**下一步（P2b）**：节点库按平台拆包 —— 先 `groups/qq-*` 与 `groups/{lark,dingtalk,wechat}-*` 分组，节点贡献点从 `builtinCatalog.ts` 的静态 import 改成「平台包注册」，同一张注册表做可见性/依赖校验。
