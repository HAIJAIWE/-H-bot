# DSH 插件可搬性分诊（2026-10-27）

> 对象：`D:\Programs\DeepSeekHarness\resources\app.asar`（单文件 174 MB）里的 262 个 `@deepseek-ai/dsh-*` 包，
> 以及用户截图里 DSH 设置页列出的「内置插件配置 4 条 + 实验性插件 14 条」。
> 用户口径（2026-10-27）："消息反馈、@ 文件引用、工具审批白名单记忆吗？你看一下 dsh 的代码吧，
> 能搬就搬。"
>
> 证据文件（对话期间产出，逐行带原文）：
> `_recovery/survey58/file-reference.md`（489 行）、`approval.md`（559 行）、`others.md`（353 行）。
> 读取工具：`node _recovery/dsh-read.js list|read <asar内路径>`（抽出的源码在 `_recovery/dsh-files/`）。

---

## 一、结论速览

| #   | 用户点名的三件 | 分诊          | 一句话                                                                                                      |
| --- | -------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| A   | 消息反馈       | **能搬（M）** | 上游是「👍/👎 + 7 个分类 + 详情」的会话级反馈表，语义可整段搬；我方缺的是**稳定的消息 id**                  |
| B   | @ 文件引用     | **能搬（M）** | 只搬「路径即提示词」的最小版：两条正则 + `{path,kind}` 契约 + 5 档打分 + 一段系统提示词                     |
| C   | 审批白名单记忆 | **已经有了**  | 我方 `.qqbat/ai-approvals.json`（三值决策 + 可撤销规则表 + 5 分钟超时）**比上游强**：上游压根没有白名单落盘 |

用户截图里 18 条的分布：**能搬 3、部分搬 2、不搬 11、已有等价物 2**（与不搬重叠计）。

| #   | 截图里的名字           | 能搬度             | 落点 / 理由（详见 `others.md`）                                                    |
| --- | ---------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| 1   | 子智能体（内置配置）   | 不搬               | 我方没有 subagent 这一层，配置页无所依附                                           |
| 2   | 网页搜索（内置配置）   | 不搬               | DeepSeek 厂商专用外网 API，我方没有搜索工具                                        |
| 3   | Agent 循环（内置配置） | **能搬（S）**      | `core.ts:498 maxParallelToolCalls` 已实现却没暴露成设置                            |
| 4   | 终端（内置配置）       | 已有等价物         | `services/terminal.ts` + `Terminal.tsx` + node-pty/xterm 已完整                    |
| 5   | 智能体团队             | 不搬（XL）         | 需先有 subagent + 持久会话存储；思路（任务板）可另议                               |
| 6   | 语音输入               | 不搬               | 需要本机 SenseVoice 模型                                                           |
| 7   | 自动授权审查           | **部分搬（M）**    | prompt/三档判据可搬，但要接我方模型调用层；见 `approval.md` §10                    |
| 8   | 开发者工具             | ①不搬 ②部分搬（L） | ① Electron 自带 DevTools ② 会话检查器可扩 `TrajectoryPanel.tsx`                    |
| 9   | Git 工作树             | 部分搬（M）        | 要先有「会话级 cwd」，我方 agent 没有这个概念                                      |
| 10  | 思考过程机器翻译       | 不搬               | 打 Bing/Google 外网服务的展示层糖                                                  |
| 11  | 持久终端               | **能搬（S/M）**    | `agent-core/terminal.ts` 的 `ShellSession` 已写好但**全仓零引用**，接 6 个工具即活 |
| 12  | 会话搜索               | **能搬（S）**      | `ai/threadSearch.ts:53 searchProjectThreads` 已存在，只差包成给 agent 的工具       |
| 13  | 随对话更新的标题       | **能搬（M）**      | 第 56 批做的是「首轮一次性」；补 B 策略 = 每轮刷新 + pin + 修订栅栏                |
| 14  | DSH 徽章技能           | 不搬               | 给别人产品打广告；我方没有 skill 体系                                              |
| 15  | Ralph 循环             | 不搬（XL）         | 需 workflow 引擎 + subagent spawn + 结构化报告                                     |
| 16  | 自定义插件市场         | 已有等价物         | `plugins/market.ts` + `marketBundledIndex.ts`（来源/哈希/兼容/安装卸载）已覆盖     |
| 17  | Codex 子智能体         | 不搬               | 依赖本机 Codex CLI 与凭据；且实体不在 asar（只有 `ON_DEMAND_BUNDLES` 元信息）      |
| 18  | Claude Code 子智能体   | 不搬               | 同上；asar 内连 `@anthropic-ai/claude-agent-sdk` 都没有                            |

## 二、三件点名的关键事实

### A. 消息反馈（`dsh-message-feedback` / `dsh-command-feedback` / `dsh-client-ui-message-feedback`）

- 形状（`message-feedback/lib/index.js`）：`{messageId, rating:'positive'|'negative', note?, category?,
version:uuid, createdAt, updatedAt}`，`updatedAt >= createdAt` 由 zod `refine` 保证。
- 语义三条：①目标必须是**已持久化的 assistant 消息**，否则 `target-not-found`；②乐观并发
  （`ifVersion !== existing.version` → `version-conflict`）；③内容没变**不追加事件**，只回现有条目。
- 交互（`client-ui-message-feedback/lib/client.js`）：👍/👎 在复制与分支之间；点已选中的那个 =
  **撤回**；任一点击都打开会话级弹层（7 个分类 chip + 详情 + 提交）；失败在按钮旁小字。
- 分类词表（`command-feedback/lib/index.js`）：任务结果 / 指令理解与遵循 / 产品功能与交互 /
  稳定性和速度 / 资源使用与费用 / 安全隐私与权限 / 其他。
- **我方缺口**：`HistoryEntry` 只有 `{ts,role,content}`（`historyStore.ts:389`），消息**没有稳定 id**；
  渲染层的 `id` 是 `hist-${i}-${k}` 位置派生，重启/压缩后会变 —— 要用它当 `messageId`，必须先把 id 写进历史。

### B. @ 文件引用（`dsh-file-reference` / `-local` / `client-ui-reference` / `client-ui-input-trigger`）

- 触发（`file-reference/lib/index.js:15-30`，两条正则）：`/(?:^|\s)(@"([^"]*))$/u` 与
  `/(?:^|\s)(@([^\s]*))$/u` —— `@` 必须在行首或空白后（邮箱不触发）、光标必须在 token 末尾、
  裸形态不含空格、`@"…"` 才允许空格且未闭合也合法。
- 契约：`{path: string, kind: 'file'|'directory'}`；RPC 参数只有 `(agentId, query)`（无 limit/cwd）。
- 检索（`file-reference-local/lib/index.js`）：纯 `fs.readdir` 递归，**不读 .gitignore**；
  含 `/` 走 live 列目录、不含 `/` 走有界索引（`maxEntries: 5e4`）+ 打分；`maxResults: 20`；
  排除 14 个目录 basename；打分 5 档 `1000/900/700/500/300+子序列`、目录 +25、全小写、确定性排序。
- 插入：**工作区相对路径纯文本** `@src/foo.ts`（有空格才 `@"a b.ts"`，目录 `@"dir/` 故意不闭合供 Tab 下钻）；
  **完全不塞文件内容** —— 换来一段系统提示词（`Tokens prefixed with @ are paths the user explicitly referenced. …`），
  由模型自己调 `read`。这条契约与我方 `read_file` 工具天然对得上。

### C. 工具审批白名单记忆（`dsh-user-approval` / `dsh-experimental-auto-review`）

- 上游**没有白名单落盘**：8 组特征串（always allow / allowed-always / approval-allowlist / approvalTimeout …）
  在 18188 个文件里 0 命中；只有 `OUTCOMES=["allowed-once","rejected","cancelled","unavailable"]` +
  `APPROVAL_POLICIES=["ask","never"]`，且**没有审批超时**。
- 我方已有（实测）：`toolApproval.ts`（三值 `allow|deny|always`、`APPROVAL_TIMEOUT_MS=5min`）+
  `allowRules.ts`（`.qqbat/ai-approvals.json`、`{version:1,rules:[{kind,match,addedAt}]}`、上限 50）+
  `ai:getAllowRules|removeAllowRule|clearAllowRules` + `ChatPanel.tsx:1282-1320` 撤销口。
- 我方比上游**多两档**、**少三层**：策略句注入（M1）、四结局区分（M2）、审计对（M3）；
  另缺一档能力：模型前置审查（M4，自动授权审查）。M5 沙箱越权重试不搬（我方无进程沙箱）。

## 三、建议的施工顺序

| 批次     | 内容                                                                           | 依据                                   |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| 第 58 批 | **消息反馈 + @ 文件引用**（用户点名的两件，都是"能搬"且互不依赖）              | §二 A/B                                |
| 第 59 批 | 会话检索工具（S）+ 并行工具调用数设置（S）+ 持久终端 6 工具（S/M）             | `others.md` §7 的 top3                 |
| 第 60 批 | 每轮刷新标题（M）+ 审批 M1/M2（策略句 + 四结局话术）                           | `others.md` §5、`approval.md` §10      |
| 不做     | 智能体团队 / Ralph / 语音 / CoT 翻译 / 网页搜索 / DevTools / 两类 CLI 子智能体 | 依赖外部服务、本机模型或我方不存在的层 |

## 四、落地状态（2026-10-28 第 60 批收口）

| 项                 | 状态                             | 落点                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息反馈           | **已落地**                       | `src/shared/ai/messageFeedback.ts`、`src/main/services/ai/messageFeedback.ts`、`ai:getThreadFeedback` / `ai:putMessageFeedback` / `ai:deleteMessageFeedback`、`MessageActions` + `MessageFeedbackDialog` + `AgentTranscript`、落盘 `.qqbat/ai-feedback/<threadId>.json` |
| @ 文件引用         | **已落地**                       | `src/shared/ai/fileReference.ts`、`src/main/services/ai/fileReference.ts`、`file:searchReferences`、`useAtReference` + `AtReferenceMenu`、`agent-core/prompt.ts` 的 `file-reference` 节（order 35，条件注入）                                                           |
| 工具审批白名单记忆 | **核对结论：早已存在**，本批未动 | `toolApproval.ts` 三值决策 + `allowRules.ts` 可撤销规则表 + `ai:getAllowRules` / `ai:removeAllowRule` / `ai:clearAllowRules` + `ChatPanel.tsx` 撤销口                                                                                                                   |
| 第 59 批           | **已落地**（`c23b7c2`）          | 会话检索工具 / 并行工具调用数设置 / 持久终端 6 工具（见 `others.md` §7；细节 `agent-core-wiring.md` §59）                                                                                                                                                               |
| 第 60 批           | **已落地**（本次提交）           | 每轮刷新标题（`others.md` §5）+ 审批策略句与四结局话术（`approval.md` §10；细节 `agent-core-wiring.md` §60）                                                                                                                                                            |

实现细节、闸门数字与真机实证写在 `agent-core-wiring.md` §58（58.1–58.9）。本批新增 9 个测试文件，
全量 304 文件 / 3795 例，`electron-vite build` EXIT 0；真机走了 11 步，其中揪出两个只有真机才能
暴露的问题 —— 「invoke 回执先到时兜底分支丢 messageId」（反馈按钮不出现，已修）与
「搜索未返回时按 Enter 会插过期候选」（已修并补用例）。
