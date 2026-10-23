# 智能体重写计划（rewrite program）

> 分支：`rewrite/agent-core`（从 `refactor/isolation-hardening` 切出，原分支保持可用）
> 起点：2026-10-18，依据 `docs/ai/agent-architecture-review-2026-10-18.md`
> 原则：**按评审结论重写「该重写的」，保留「被证明是对的」**。不做 big-bang。

---

## 一、范围与非目标

| 层 | 处理 | 原因 |
|---|---|---|
| L1 领域内核（NodeRegistry / HandlerRegistry / FlowInterpreter / codegen） | **保留** | 拆分清楚、有真解释器用例、无本次诊断出的缺陷 |
| L2 Agent 运行时 | **重写**为 AgentRuntime（A/B 共用） | 目前两套循环 + 两套记忆 + 两套配置链；控制流靠 nudge |
| L3 决策制品 | **补齐** Plan / Receipt | 只有 Verdict 落地，Plan 无类型、Receipt 不存在 |
| L4 写通道 | **重写协议**（main 侧执行 + 回执） | 单向、无回执、真源在渲染层 —— 三处假成功的共同根因 |
| L5 观测 | **新增** Run Ledger | trace/metrics/bot 日志串不起来 |
| L6 适配层 | **收薄** | agent_chat 内联了策略/记忆/待确认 |

**非目标**：不换技术栈；不引入 LangGraph 等第三方编排；不拆多智能体；不动渲染层 UI 结构（只改它承担的职责）。

---

## 二、三个工作流

### W1 · 写通道（L4）—— 优先级最高

**目标**：把「发出去就当成功」改成「执行完才回结果」，且失败能回到模型。

新协议（`src/shared/protocol/instruction.ts`）：

```ts
export interface InstructionRequest {
  requestId: string;
  name: string;
  args: Record<string, unknown>;
  projectPath: string;
}
export type InstructionOutcome =
  | { status: "applied"; detail?: string }
  | { status: "rejected"; reason: string }   // 用户拒绝 / 路径校验 / 只读目录
  | { status: "failed"; reason: string };     // 渲染层执行抛错
export interface InstructionResult { requestId: string; outcome: InstructionOutcome }
```

- main：`dispatchInstruction(win, req, { timeoutMs })` → `Promise<InstructionResult>`；
- preload：`onClientInstruction` + `resolveInstruction(result)`；
- renderer：`handleClientInstruction` 返回 outcome，不再只 console.error；
- 超时 = `failed`（不是成功），并按**工具失败**回灌给模型。

**验收**：把项目目录改成只读，让助手 `write_file` 一次 —— 模型必须收到「写失败」、用户必须看到红字；MCP 外部 IDE 必须看到 `isError`。

### W2 · AgentRuntime（L2）

**目标**：A（作者助手）与 B（机器人）共用一套循环，差异用 PolicyProfile 表达。

```ts
export interface PolicyProfile {
  maxRounds: number;
  guardMode: "readonly" | "acceptEdits" | "auto";
  approval: "blocking" | "twoPhase" | "none";
  allowedTools: string[];
  toolBudget: { perResult: number; perConversation: number };
  memory: { load: () => Promise<HistoryEntry[]>; save: (t: Turn) => Promise<void> };
}
export interface AgentRuntime { run(turn: TurnRequest): AsyncIterable<AgentEvent> }
```

**迁移方式（strangler）**：先让 runtime 包住 A 的现有循环并保持行为（golden 用例全绿）→ 再把 B 迁进来 → 最后删掉 A 的旧 `processAiChat` 内联循环与 B 的 `callBotAgent`。
**不做**：不一次性删旧实现；每一阶段都保留可回退的开关。

### W3 · 工具与风险判据（机器人侧）

**目标**：默认工具集从「按元数据推导」改成**显式白名单**；风险确认按**能力类别**（net / write / msg）而不是 `sideEffects` 是否为空。

**验收**：`http_request` 不在默认集；显式放开时必然触发确认；单测覆盖。

---

## 三、执行顺序与依赖

```
阶段 0（已做）  P0-2 预取闸门 / P1-2 write_file 转换 / P1-4 失败补交提案   ← 不动协议
   │
阶段 1（进行中）W3 机器人工具与风险判据（独立，可并行）
   │
阶段 2（下一步）W1 回执协议：shared 类型 → main 派发器 → preload → renderer → 回灌
   │
阶段 3          W2 AgentRuntime 抽取（依赖 W1 的 receipt 语义）
   │
阶段 4          Run Ledger(runId) + Plan 类型 + 上下文压缩
```

依赖关系：W2 必须先有「工具调用的真实结果」（W1），否则 runtime 会继承同一个假成功；W3 与两者无耦合，可并行。

---

## 四、门禁（每个切片必须过）

1. `npx tsc --noEmit -p tsconfig.node.json`（与 `tsconfig.web.json`）零错误；
2. 受影响目录的 vitest 全绿（不接受「别的用例本来就这样」）；
3. 新增行为必须有**能失败的用例**（先证明它会红，再改绿）；
4. 注释与实现一致：本仓库最大债务是注释漂移，新注释必须能被代码验证；
5. 每切片一个 commit，commit message 写明「改了什么判据」。

---

## 五、回滚策略

- 分支隔离：`rewrite/agent-core` 与原分支完全独立；
- 每切片单独 commit，可 `git revert`；
- W1/W2 引入的开关默认**开**（因为修的是假成功），但保留 `QQBAT_INSTRUCTION_RPC=0` 之类的降级开关一个版本周期；
- 渲染层改动保持向后兼容：旧版 preload 不调用 resolve 时，main 侧超时兜底。

---

## 六、当前进度（2026-10-18）

| 项 | 状态 | 证据 | commit |
|---|---|---|---|
| P0-2 并行预取先过闸门 | ✅ 已改 | `guardBlockedCalls` 纯函数 + 6 条用例 | facf73ff |
| P1-2 write_file 提案转换 | ✅ 已改 | write_code/write_file 合并 + 4 条用例 | facf73ff |
| P1-4 失败补交部分提案 | ✅ 已改 | `emitProposalOnce` + catch；autoTx 契约同步 | facf73ff |
| P0-1 机器人默认工具集/风险判据 | ✅ 已改 | `EXPOSED_BY_DEFAULT`（7→3）+ `requiresConfirmation` + 18 条用例 | 922bffdd |
| W1 回执协议 | ✅ 已落地 | 协议 + 派发器 + 渲染层回执 + A/MCP 已切换 | 9e726ccc / 本轮 |
| P1-8 记忆原子写 | ✅ 已改 | historyStore 两处整份重写改走 atomicWrite | 本轮 |
| P1-5 机器人额度记账 | ✅ 已改 | agent_chat 按真实 usage 调 addDailyUsage（以前恒 0） | 本轮 |
| W2-1 差异表收口 | ✅ 已落地 | @shared/agent/policy：AUTHOR/BOT Profile + 常量从 profile 读 | 本轮 |
| P1-7 trace 带 turnId | ✅ 已改 | trace 行可按"哪一轮"聚合（模型调用 + 每次工具同一键） | 本轮 |
| W2-2 循环搬进 runtime | ✅ 已落地 | `services/agent/authorRuntime.ts`；index.ts 1150→841 行 | 本轮 |
| W2-3 机器人迁入 | ⏳ 下一步 | 删 callBotAgent 的循环（依赖同一 runtime 契约） | — |
| W2-3 机器人迁入 | ⏳ 待开始 | 删 callBotAgent 的循环 | — |

**验证基线**：`tsc -p tsconfig.node.json` 零错误；`tests/main/services/ai` + `bot` + `evals` 共 89 文件 / 852 例全绿（4 skipped）。

**本轮行为变更（有意，已写进用例）**：
1. 机器人默认工具集从 7 个降到 3 个纯构造节点（`battle_panel/message_compose/message_op`）；要更多能力必须显式列 kind，且放开后按能力类别确认。
2. 失败（403/网络/解析）现在会交一张标「部分」的提案卡；**取消仍然什么都不交**。
3. **写指令变成"等回执"**：渲染层 15s（MCP 30s）内不回 = failed，失败原因按工具失败回灌模型。
   以前是"发出去就等于成功"，模型看到的恒为「操作已提交」。
4. **MCP 的返回值**从 status:dispatched 改成 applied；没落地一律 isError，并说明"没有产生任何改动"。
5. 取消对话时，挂起的写指令立刻结算为 failed（不再白等 15 秒）。
