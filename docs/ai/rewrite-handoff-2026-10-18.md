# 智能体重写 · 交接单（2026-10-18）

> 分支：`rewrite/agent-core`（从 `refactor/isolation-hardening` 切出）
> 体检：全量 `vitest run` = **592 文件 / 7120 例通过**，1 例失败已修（i18n 硬编码），修后 586 文件全绿；`tsc node/web` 均 0。
> 本单只写「还剩什么、怎么改、别踩哪个坑」。

---

## 一、已完成（10 个代码提交）

| commit | 内容 | 关键不变量 |
|---|---|---|
| facf73ff | P0-2 预取先过闸门 / P1-2 write_file 提案转换 / P1-4 失败补交部分提案 | 预取必须在审批之后 |
| 922bffdd | P0-1 机器人默认工具集白名单 + 能力类别风险判据 | 默认集只能显式列出 |
| 9e726ccc | P1-1 回执协议（类型 + 派发器 + 渲染层回执） | 派发 ≠ 成功 |
| ab5ac70b | P1-1 收尾：A/MCP 全切「等回执」 | 超时 = failed |
| 03cddcba | P1-8 记忆原子写 / P1-5 额度记账 | 整份重写必须 tmp+rename |
| e5712b07 | W2-1 A/B 差异表（PolicyProfile） | 旋钮只有一处 |
| c3b7a2a5 | P1-7 trace 带 turnId | 一次任务可聚合 |
| 41d7ce38 | W2-2 作者助手循环搬出 index.ts | 行为零变化 |
| ca697356 | P2-1 机器人每轮独立超时 | 单轮不再吃整段预算 |
| b81d85b3 | 回执日志/拒绝原因改 ASCII | i18n 闸门 |

## 二、剩余三项（按建议顺序）

### ① W2-3 机器人循环迁入 services/agent/

**目标**：两个循环都归 `services/agent/`（authorRuntime 已有，缺 botRuntime）。

**阻塞点**：`bot/llm.ts` 与 `agent/botRuntime.ts` 会成环（前者要被后者 import 常量，后者要前者提供 provider）。

**解法（两步都小）**：
1. 新建 `src/main/services/bot/provider.ts`，搬 `loadBotAiConfig` / `createBotProvider` / `BOT_LLM_TIMEOUT_MS` / `BOT_HISTORY_TOKEN_BUDGET`；
   `bot/llm.ts` 改成从 `./provider` import 并 re-export 这几个名字（现有 import 点不动）。
2. 新建 `src/main/services/agent/botRuntime.ts`，搬 `callBotAgent` + `BotAgentRequest/Result/ToolRecord`；
   `bot/llm.ts` 保留 `export { callBotAgent } from "../agent/botRuntime"`（`botTools.test.ts` 从 llm import，别改它）。
   `agentNodes.ts` 可直接静态 import botRuntime。

**验收**：`tests/main/services/bot` 全绿；`tests/main/runtime` 三个 E2E 会 mock `callBotAgent`，mock 路径要跟着改。

### ② P1-3 MCP 图 mutation 必须经用户（二选一）

**现状**：`add_node/connect_nodes/update_node/delete_node` 在 MCP 下 `classifyTool` 判 `auto`，直接派发到渲染层落地，没有确认。

**方案 A（推荐，语义统一）**：走 `mcpProposal.ts` 的提案通道 —— 把四个 kind 加进 `dispatchComposeTool` 的判定，MCP 返回 `pending_user_confirmation`。
**方案 B（改动小）**：`classifyTool` 加 `context` 选项（assistant / mcp），mutation 分支在 mcp 下返回 ask；`mcpToolVerdict` 传 mcp。

**两种方案都要改的测试（真实成本，别低估）**：
- `tests/main/mcp/server.test.ts`（add_node / delete_node / connect_nodes 三条派发断言）
- `tests/main/mcp/turnJournal.test.ts` / `turnJournalConcurrency` / `turnJournalLifecycle` / `turnJournalRecovery`（用 add_node 当"不会丢的写"来测轮次）
- `tests/main/mcp/toolApproval.test.ts`（有一条「add_node 不问」，语义要翻）
- `tests/main/mcp/writeGuardWiring.test.ts` / `noAppManagedWrite.test.ts`（用写图工具当样本）

**建议**：选 A 的话，先把 `turnJournal*` 四个文件的样本工具从 `add_node` 换成 `write_code`（仍走回执 + 轮次），再加提案断言 —— 否则这四个文件在测一个已经不存在的路径。

### ③ P1-6 控制流状态机化 —— **决定：本轮不做**（2026-10-18）

**现状**：`plan → execute → wrap-up` 由 4 条 nudge + 文本启发式实现
（`WRAP_UP_NUDGE` / `ANNOUNCE_KICK_NUDGE` / `PLAN_PHASE_HINT` / `PLAN_PHASE_OPEN_NUDGE`，
判据 `looksLikeAnnouncement` / `shouldStayInPlanPhase`）。

**为什么不重写**：

1. **没有活跃缺陷**。它是有意设计（注释写明了每次真机事故对应的补丁），现有 12 条任务级 eval 全绿。
   重写它买到的是可读性，不是正确性。
2. **它捆绑了一个产品决策**。抽状态机的前提是把 `isPlanPhaseEnabled` / `isSelfConsistencyEnabled`
   默认打开 —— 那会让每次复杂改动多跑最多 3 轮只读。**慢多少、稳多少，目前没有数据**，
   不该由重构顺手决定。
3. **风险不对称**：改动面是主循环的唯一控制流，回归靠 12 条脚本化 eval；
   一旦判断错，症状是"AI 只说不做"——正是历史上最难查的一类。

**什么时候回来做（触发条件，满足任一）**：
- 真机再出现 ≥2 次"只宣布不动手 / 计划没落地"类事故；
- 需要在 A/B 之外接入**第三个**循环（那时三态机是复用前提）；
- 需要给用户提供"快速/稳妥"模式开关（那时必须先有状态机）。

**如果要现在做，顺序必须是**：先加"两种模式各跑一遍 eval"的对照数据 → 再翻默认 → 最后抽状态。反过来做，红了你分不清是谁改坏的。

## 三、回滚与红线

- 每个提交独立可 revert；`git revert --no-commit <sha>` 后跑 `tests/main/services/ai tests/main/mcp tests/guards` 验证。
- **红线**：不要把 `dispatchInstruction` 改回 `send`（重新引入假成功）；不要让 mutation 绕过 `toolCallToOperations`（重新引入静默丢弃）。
- `fileGrowth` 再报红：拆文件，或按规矩 `node scripts/update-file-size-baseline.mjs` 并在提交信息里写理由。

## 四、本轮踩过的闸门（下次改之前先读）

| 闸门 | 它会拦什么 |
|---|---|
| `fileGrowth` | 大文件再长超过 10% |
| `projectWritesViaFileOps` | 直接 fs.writeFile 写项目目录；登记计数必须同步 |
| `capabilityLayering` | preload 新增方法必须登记层（改 doc 附录 + 总表 + 重跑 gen-capability-catalog） |
| `ipcPayloadContract` | 新 ai 通道必须进 CONTRACTS 或 EXEMPT |
| `deadExports` | 只有测试引用 / 零引用的导出 |
| `noHardcodedCopy` | 双语目录里的中文界面文案（日志用 ASCII） |
