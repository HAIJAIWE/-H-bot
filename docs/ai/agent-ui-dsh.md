# 智能体窗口：按 DSH 的对话界面重排（2026-10-25）

> 上游参照：`deepseek-harness` 0.2.1-rc.3 的客户端包 `packages/client/ui-conversation`、
> `ui-chat`、`ui-tool`（只读参考，MIT；**没有复制代码**，按几何与语义复刻）。
> 快照在仓库内 `deepseek-harness-master/deepseek-harness-master/packages/client/`。

## 1. 为什么重排

重排前的智能体面板（`src/renderer/src/components/ai/ChatPanel.tsx` 1604 行时代）是这样的：

- **每条消息一个头像圆点**（用户 "U" / 助手 "AI"），窄右栏（180–368px）里各吃掉 24px；
- 用户蓝气泡 + 助手整栏，两种排版混着；
- 思考是带边框的 `<details>` 灰框，工具是一行 `▸` 展开的卡片，**再外面还有一层**
  `TurnFoldHeader`（整轮折成 "▸ 你: … · N 条回复 · M 次工具"）；
- 运行中是三个跳点的气泡 + "第 3/12 步"；
- 结论：一屏里三种折叠层级（轮 → 过程 → 单条），用户要连点三次才看到一行参数；
  而真正该一眼看到的东西（助手正文）反而被挤在中间。

DSH 的做法相反（`ui-chat/src/client/chat/`）：**一轮 = 用户气泡 → 过程行 → 助手正文 → 轮尾操作**，
过程收成**一行**，正文永远整栏可读，没有任何头像。

## 2. 复刻到的几何与语义

| 元素     | DSH 出处                                       | 我们的落点                       | 关键参数                                                                           |
| -------- | ---------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 用户气泡 | `ChatView.module.css` `.userRow`/`.userBubble` | `MessageBubble.tsx`              | 右对齐、`max-w-[85%]`、`rounded-2xl rounded-tr-sm bg-blue-700`、**无头像**         |
| 助手正文 | `AssistantMarkdown.tsx`                        | `MessageBubble.tsx`              | 整栏 `text-sm leading-6`，无气泡无头像                                             |
| 过程行   | `TurnProcessNodeView.tsx`                      | `TurnProcess.tsx`                | 一行按钮：「工作了 12 秒」+ 右侧「3 次工具」+ chevron；12px/22px；**位于正文之上** |
| 思考行   | `ReasoningRow.tsx`                             | `ReasoningRow.tsx`               | 折叠时标题「思考」+ 首行预览（去 `**`、上限 96 字）；展开是全文，左侧竖线          |
| 工具行   | `ui-tool/ToolRow.tsx`                          | `ToolRows.tsx`（`ToolCallCard`） | 一行：状态点 + 工具名 + 摘要 + `▸`；点开才是参数与结果                             |
| 运行行   | `RunningStatus.tsx`                            | `RunningLine.tsx`                | 一个脉冲点 + 「正在处理 12 秒」微光文字，12px/22px，`role=status`                  |
| 轮尾操作 | `TurnTailNodeView.tsx` `MessageIconActions`    | `MessageActions.tsx`（已有）     | 最后一轮常显、历史轮 hover 才出图标                                                |

DSH 的结算文案分叉（`TurnProcessNodeView`）：`aborted|interrupted → Stopped`、
`error → Failed`、否则有耗时 → `Worked for 12s`、无耗时 → `Worked`；**停止/失败不显示时长**。
我们照抄口径：`ai.process.stopped` / `failed` / `took {duration}` / `worked`
（`TurnProcess.tsx` 的 `outcome`）。

## 3. 改了什么（文件级）

- 新增 `TurnProcess.tsx`（过程行）、`ReasoningRow.tsx`（思考行）、`RunningLine.tsx`（运行行）。
- `MessageBubble.tsx`：删掉头像与 `toolCalls` 透传；助手正文前挂过程行；`StreamingBubble`
  只负责正文 + 光标（思考由 `TurnProcess` 那一层出，保证"跑的时候"和"跑完以后"同款）。
- `AgentTranscript.tsx`：删掉 `TurnFoldHeader` 与 `turnOpen/turnAt`（整轮不再折叠），
  每轮容器直接渲染消息；`MessageActions` 仍然只给最后一轮显示"重新生成/撤回"。
- `ToolRows.tsx`：删掉 `ToolTrace`（"这一轮干了什么"的折叠列表）—— 折叠上移到过程行，只保留 `ToolCallCard`。
- `ChatPanel.tsx`：删掉 `ThinkingIndicator`、`turnOpen` 状态、`turnAt` 计算；
  运行中的那一轮改渲染 `TurnProcess running` + 工具行 + `RunningLine`。
- 删除 `TurnFoldHeader.tsx`、`ThinkingIndicator.tsx`；`lib/ai/turnGrouping.ts` 删掉 `turnPreview`
  （整轮不再需要一行摘要），i18n 删 `ai.turns.*`、`ai.tool.trace`、`ai.chat.thinkingAria`。
- i18n 新增 `ai.process.*`（running/worked/took/failed/stopped/tools/seconds/minutes）与
  `ai.running.*`（idle/for）；`ai.chat.reasoning` 由「思考过程」改为「思考」（DSH 的 `message.think`）。

## 4. 一致性约束（改这些地方前先读）

1. **折叠只在过程层**。不要再引入"整轮折叠"，也不要在工具行里再套一层折叠。
2. **助手正文永远整栏**。任何新加的信息块（用量、改动、提案）都排在正文之后，不要插在它前面。
3. **过程行在正文之上**（DSH 同序）：先"它干了多久"，再读结论。
4. **运行中与历史轮同款**：同样是 `ReasoningRow` + `ToolCallCard`，只是外面那行换成"执行中"且默认展开。
5. 结算文案不要自己拼字符串 —— 走 `ai.process.*`，停止/失败不带时长。

## 5. 没搬的部分（有意）

| DSH 有                                  | 我们没做 | 理由                                                          |
| --------------------------------------- | -------- | ------------------------------------------------------------- |
| Lexical 编辑器（chip/引用/选区投影）    | 不做     | 现用 textarea 足够；换编辑器是另一个量级的改动                |
| 轮次导航竖排小点（`TurnNavigator`）     | 不做     | 右栏窄，点列会和滚动条抢地方                                  |
| 用量药丸 + 弹层（`TurnUsagePanel`）     | 部分     | 统计已在底部 `RunStatsBar`；轮尾药丸留待它有"按轮用量"数据源  |
| 底部统计药丸 `StatsPills`               | 不做     | 与现有 `RunStatsBar` 重复                                     |
| 输入卡底部控制行 + `ContextMeter` 环形  | 不做     | 现有单行 composer 已含模型/角色/附件；上下文百分比已在统计条  |
| 44px steering 批间距、轮距 4/12/16 分级 | 部分     | 现按 `mb-5`（20px）分轮；分级间距等有真实的"steering"概念再说 |

## 6. 测试

- `tests/renderer/components/ai/turnProcess.test.tsx`：结算文案与计数、折叠/展开、运行中默认展开、
  停止/失败不带时长、无内容不渲染、`formatDuration` 分秒口径；`RunningLine` 两态。
- `tests/renderer/components/ai/reasoningBubble.test.tsx`：思考行折叠只给首行预览、点开全文、
  预览去 `**`；`StreamingBubble` 只渲染正文。
- `tests/renderer/components/ai/ChatPanel.test.tsx`：过程行结算 + 展开后逐条工具可读。
- `tests/renderer/lib/turnGrouping.test.ts`：切轮边界与计数（`turnPreview` 用例已删）。
