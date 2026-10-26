# 第 56 批：会话自动标题 + 回合目录/统计（DSH B 档）

> 交接文档。上一批（第 55 批，DSH 小件快搬）见 `docs/ai/dsh-small-packages-batch55-design.md`；
> 本批对应上游 `packages/session/session-title`、`session-stats`、`session-turn-outline` 三包的语义适配。
> 写于 2026-10-26。

## 一、这一批解决什么

本仓的会话（线程）与回合视图目前是"能用但粗"：

- 线程标题 = 第一条用户消息首行（28 字符硬截，不处理 ANSI/控制字符、不按字节截、不能改）；
- 线程列表只有消息条数，没有整条会话的规模感（几轮、多长、多少估算 token）；
- 回合只能从头翻，没有"这一轮说了什么/答了什么"的目录，长会话里找不到某一轮。

上游三个包正好各自对应一块：

| 上游包                 | 上游职责                                                  | 本批适配                                                                    |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `session-title`        | 标题归一 + fallback + 可选 provider 生成 + 用户重命名 pin | 标题归一/字节截断/fallback + 首轮后一次 AI 生成 + 用户重命名（持久化）      |
| `session-stats`        | 整份会话的轮/步/耗时/首 token/解码统计                    | 整条线程的轮数/消息数/字符数/估算 token/时间跨度（落进 `listThreads` 返回） |
| `session-turn-outline` | 每轮 prompt/response 预览（50/120 字符）                  | 纯函数切出回合目录，界面抽屉列出并点击跳到那一轮                            |

**不做**（理由见 §七）：每步刷新的时间上下文、标题来源事件日志（我们线程没有事件流）、会话分页加载、
provider 路由记录（我们标题生成不走主请求 route）。

## 二、语义定案：会话标题

### 2.1 归一与截断（shared 纯函数，照上游 normalize.ts 口径）

- `cleanTitleText`：按顺序剥离 OSC/CSI/ESC 控制序列、C0/C1 控制字符、方向性/零宽控制字符，
  再把连续空白折叠成单个空格，首尾 trim。
- `truncateTitleUtf8(text, maxBytes)`：按**码点**累加 `Buffer.byteLength`，超预算前停在完整码点上
  （绝不切出半个 UTF-8 字符，也不产生 replacement char）。
- `normalizeThreadTitle(text)` = `truncateTitleUtf8(cleanTitleText(text), 64).trimEnd()`；
  归一后为空 = 非法标题。
- `fallbackThreadTitle(firstUserText)`：clean 后按空白取前 **8 个词**，再截到 **48 字节**。
- 常量：`THREAD_TITLE_MAX_BYTES=64`、`THREAD_TITLE_FALLBACK_MAX_WORDS=8`、
  `THREAD_TITLE_FALLBACK_MAX_BYTES=48`。

### 2.2 来源与持久化

`ThreadTitleSource = 'fallback' | 'provider' | 'user'`（对齐上游 `SessionTitleSource` 的三种 kind）：

- `fallback`：不落盘，列表读取时由第一条用户消息即时推导（上游也是投影即时生成）；
- `provider`：首轮回答成功后异步生成一次，落盘；
- `user`：用户重命名，落盘并 pin —— 此后不再自动生成（上游 rename 会 supersede 自动生成）。

落盘文件：`.qqbat/ai-thread-titles.json`，原子写（`infra/fileOps.atomicWrite`）：

```json
{
  "version": 1,
  "titles": {
    "t-xxx": {
      "title": "给机器人加定时提醒",
      "source": "provider",
      "updatedAt": "2026-10-26T07:30:00.000Z"
    }
  }
}
```

读取容忍坏文件（JSON 坏/版本不认识/条目字段不合法 → 整份当空，不抛错、不覆盖）；
写入前归一，归一为空 → 抛人话错误（界面提示"标题不能为空"）。

### 2.3 自动生成（provider）

时机：**一轮成功收尾之后**（`ai:response` 已发、`ai:agentState=idle` 已发），仅当：

1. 这是该线程的**第一轮**（本轮开始时历史里没有用户消息）；
2. 该线程没有落盘标题（`user` 或 `provider` 都没有 —— 用户改过就不许覆盖）；
3. 回答正文非空；
4. AI 配置有 `provider`/`model`/`apiKey`（没有就不发请求，保留 fallback）。

生成：一次**非流式小请求**（`callLlm`，无工具），system 固定中文指令，user 给
「用户第一句需求 + 助手回答前 500 字」，收集正文后 `normalizeThreadTitle`。
成功 → 落盘 `source:'provider'` 并广播 `ai:threadTitle`；失败 → 只记 warning，不写盘，fallback 继续用。

成本边界：每线程最多一次；不因失败重试；不阻塞回复（fire-and-forget，`void ... .catch()`）。

### 2.4 用户重命名

`ai:renameThread`（新增 IPC 能力）。归一后为空 → `{ok:false,error:'标题不能为空（去掉控制字符后没有可见字符）'}`；
成功 → 落盘 `source:'user'`，返回 `{title, source}`。界面刷新线程列表。

## 三、语义定案：回合目录

`buildTurnOutline(messages)`（shared 纯函数）：

- 每条 `role==='user'` 的消息开一轮；`turn` 从 1 递增；`userIndex` = 该消息在 messages 里的下标；
- 该轮的 `prompt` = 这条用户消息内容 → 折叠空白、截 **50** 字符（超限加 `…`）；
- 该轮的 `response` = 本轮内**最后一条**有正文的 `assistant` 消息（next user 之前），同口径截 **120** 字符；
- 没有用户消息 → 空数组；system/attempt 消息不参与；
- 预览是**纯展示**，不改消息本身，也不进模型。

界面：左侧图标轨「会话目录」抽屉（`TurnOutlineDrawer`），列出「第 N 轮 + prompt + response」；
点击 → 滚到 `#ai-msg-<userIndex>`（`AgentTranscript` 给每条消息容器加锚点 id）。

## 四、语义定案：线程统计

`listThreads` 每条线程新增 `stats`（整条线程，与分页无关）：

```ts
interface ThreadStats {
  turns: number // 用户消息数（对齐上游 "轮"）
  messages: number // 全部消息条数（含 attempt）
  assistantMessages: number
  chars: number // 正文字符数（用户 + 助手）
  estimatedTokens: number // ceil(chars / 4)，量级估算，不是计费口径
  durationMs: number // 第一条 ts → 最后一条 ts（缺 ts / 单条 → 0）
}
```

界面：线程行的 hover 提示里追加「N 轮 · 约 X tokens」（不新增采集，全部来自已读的历史条目）。

## 五、文件计划

新增（shared/主进程）：

- `src/shared/ai/threadTitle.ts`：常量、`ThreadTitleSource`/`ThreadTitleRecord`、`cleanTitleText`、
  `truncateTitleUtf8`、`normalizeThreadTitle`、`fallbackThreadTitle`；
- `src/shared/ai/turnOutline.ts`：`TURN_PROMPT_PREVIEW_LIMIT=50`、`TURN_RESPONSE_PREVIEW_LIMIT=120`、
  `previewText`、`buildTurnOutline`；
- `src/main/services/ai/threadTitles.ts`：`THREAD_TITLES_FILE`、读/写/归一/`renameThread`/
  `maybeGenerateThreadTitle`；
- `src/main/services/ai/threads.ts`（改）：合并落盘标题（优先 user/provider）、fallback 推导、`stats`；
- `src/main/schemas/ai.ts`（改）：`aiRenameThreadSchema`；
- `src/main/ipc/ai.ts`（改）：`ai:renameThread` handler；`aiAgentCore.ts`（改）：首轮后 fire-and-forget 生成 +
  `ai:threadTitle` 广播；
- `src/preload/index.ts`、`src/renderer/src/types/ipc.ts`（改）：`renameThread`、`onThreadTitle`、
  `listThreads` 返回加 `stats`；
- 渲染层：`AiSidebar.tsx`（重命名 + 目录抽屉入口 + 统计提示）、新 `TurnOutlineDrawer.tsx`、
  `AgentTranscript.tsx`（消息锚点 id）、`aiStore.ts`（`onThreadTitle` 监听后刷新线程列表）、i18n 中英。

测试：`tests/shared/ai/threadTitle.test.ts`、`tests/shared/ai/turnOutline.test.ts`、
`tests/main/services/ai/threadTitles.test.ts`、`tests/main/services/ai/threads.test.ts`、
`tests/main/ipc/ai.test.ts`（renameThread）、`tests/main/ipc/aiAgentCore-ipc.test.ts`（mock 标题生成）、
渲染层 `TurnOutlineDrawer.test.tsx` / `AiSidebar` 重命名用例。

## 六、守卫与能力账

新增 IPC 能力 **2** 个：`ai.renameThread`（invoke）、`ai.onThreadTitle`（事件订阅）；
`ai:renameThread` 进 `ipcPayloadContract` 的 CONTRACTS（`shape: aiRenameThreadSchema.shape`）。

能力台账 `docs/ai/ai-capability-layering-2026-10-08.md`：ai 行 54→**56**、X 79→**81**、合计 279→**281**；
附录 A 加两行；重跑 `node scripts/gen-capability-catalog.mjs` 生成两份 281 条目录。

`threadTitles.ts` 落盘用 `atomicWrite`（不是直写 fs API），`projectWritesViaFileOps` 登记不变；
`threads.ts` 仍只读，不新增直写点。

## 七、明确没做（以及为什么）

1. **标题来源事件日志**：上游 `session/title` 是 session 事件流里的 log-only 事件；本仓线程是
   JSONL 记忆，没有事件流，标题来源只存落盘记录，不做事件回放。
2. **provider 路由记录**：上游标题生成要等主请求 header 记录 route；本仓标题请求独立发起，
   用当前 AI 配置，不追主请求 route（省一层耦合）。
3. **每步刷新的时间上下文**：第 55 批已做"每轮一次采样"，本批不再动（上游 refreshInterval 语义不适配我们的轮模型）。
4. **会话分页/按 seq 定向加载**：本仓历史一次性读全文，回合目录直接基于内存消息，不需要 seq 坐标。
5. **多级标题历史/标题摘要列表**：一级标题足够；不做。
6. **线程统计里的 llmMs/toolMs/ttft/decode**：本仓没有逐轮持久化的墙钟事件，trace 也不带 threadId，
   拿不到可信的按线程耗时分项 —— 只给轮数/字符/估算 token/时间跨度，**不编造**。

## 八、分阶段

- **Phase A（shared + 线程标题服务）**：两个 shared 纯函数模块 + `threadTitles.ts` + `threads.ts` 合并/统计；
  定向测试；`tsc node`。
- **Phase B（IPC/能力账）**：schema、handler、preload、types、`aiAgentCore` 生成与广播；
  `ipcPayloadContract`/`capabilityLayering` 登记；`tsc node/web`。
- **Phase C（渲染层，交给队友）**：重命名交互、会话目录抽屉、统计提示、i18n、前端测试；
  `tsc web`。
- **Phase D（文档/闸门/真机/提交）**：`docs/ai/agent-core-wiring.md` §56、适配文档 §14 一行、
  prettier、全量 vitest、真机探针、提交。

## 九、闸门与真机

闸门：

```
node node_modules/typescript/bin/tsc -p tsconfig.node.json
node node_modules/typescript/bin/tsc -p tsconfig.web.json
node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2   # 15 文件/107 例基线
node node_modules/vitest/vitest.mjs run --maxWorkers=2                # 283 文件/3557 例基线
```

真机（dev + CDP 43191）：

1. 新线程发一句需求 → 等回复 → 线程列表标题变成 AI 生成的短语（≤64 字节），
   若生成失败则保留 fallback（首条消息前 8 词）；
2. 重命名该线程为带 ANSI/控制字符的字符串 → 列表显示归一后的标题；清空标题 → 界面报"标题不能为空"；
3. 同一线程再发一轮 → 标题**不变**（user/provider 已 pin）；
4. 会话目录抽屉列出两轮、每轮 prompt/response 预览有截断；点第 1 轮 → 消息区滚到那一轮；
5. 线程列表 hover 提示出现「N 轮 · 约 X tokens」；
6. 清理：删测试线程/标题文件、停 dev、确认 43191 FREE。

## 十、风险

- 标题生成多一次模型请求：仅每线程首轮一次，失败静默、不阻塞回复；配置缺 key 直接跳过。
- 自动生成与用户重命名竞态：生成完成后落盘前**再读一次**存储，若已是 `user` 来源则丢弃（以先落盘者为准）。
- 标题生成与主请求并发在旧 provider 上限内：小请求（≤300 输出 token 的预期），不设流式。
- 统计字符数是大文件历史扫描：列表本来就要 `loadHistory` 全文，扫描同一次读取，不额外读盘。
- 回合目录锚点在虚拟滚动下失效：本仓消息列表非虚拟滚动，锚点可靠；将来虚拟化需同步改。

## 十一、验收清单

- [ ] 新线程首轮后标题为 provider 生成（≤64 字节），失败时 fallback 可读；
- [ ] 重命名持久化，重启后仍在；空标题被拒；
- [ ] 已重命名线程再发消息不会被自动标题覆盖；
- [ ] 线程列表 `stats` 字段正确（轮数/消息数/字符/token 估算/时长）；
- [ ] 回合目录条目数 = 用户消息数，预览截断符合 50/120；
- [ ] 点击目录跳到对应消息；
- [ ] `tsc node/web` 0；guards 全绿（能力账 281）；全量 vitest 全绿；
- [ ] 真机 6 步留证据；§56 文档与适配文档已写；提交完成。

## 十二、参考坐标（当前 HEAD f325877）

- `src/main/services/ai/threads.ts`（102 行，@ts-nocheck）：`listThreads` 合并老文件+目录、`titleOf` 28 字符截断；
- `src/main/ipc/ai.ts`：`ai:listThreads` handler :486-497；`ai:clearThread` 紧随其后；
- `src/main/ipc/aiAgentCore.ts`：收尾顺序 :812-899（先记忆、再 endTurn、再 response/idle）；`past` 在 :332 读；
- `src/preload/index.ts`：线程方法 :435、事件订阅 :519/:596；
- `src/renderer/src/components/ai/AiSidebar.tsx`：线程行 `ThreadRow`（文件尾函数）、`flyout === 'threads'` 区域 :282-409；
- `src/renderer/src/components/ai/AgentTranscript.tsx`：逐消息容器 `div key={`msg-${i}`}`（加锚点处）；
- `src/renderer/src/components/ai/ChatPanel.tsx`：`turns = groupIntoTurns(messages)` :894、`AgentTranscript` :1018；
- `src/renderer/src/stores/aiStore.ts`：事件监听注册 :1986/:1994；`loadThreads` :1227；
- `src/renderer/src/i18n/zh-CN.json` `ai.sidebar` 块 :621 起、`ai.chat.threadOption` :365；
- `docs/ai/agent-core-wiring.md` 3261 行，§55 从 :3045 起（§56 追加文件尾）。

## 十三、一句话

**把会话从"一条条消息"抬到"有名字、有规模、有目录的会话"：标题归一 + 首轮 AI 起名 + 可重命名，
线程列表带整条会话统计，回合目录一键跳到任意一轮。**

## 十四、交接状态与未完成清单（2026-10-26 19:45，给新会话）

> 本文件 §一~§十三 是开工时的设计；**当前真实状态以本节为准**。

### 14.1 工作区与基线

- 仓库：`E:\H Bot 制造`（`D:\QQ bot` 是误设的空目录且 ACL 有问题，新会话请直接把 cwd 设为 `E:\H Bot 制造`）。
- 基线：HEAD = `f325877`（第 55 批已提交）；**第 56 批全部改动尚未提交**（`git status --short` 为 35 个路径：修改 + 新增）。
- 权限：danger-full-access、审批关闭；改源码前先停 dev（Windows 文件锁）。

### 14.2 已完成（已验证）

- **Phase A/B**：shared 纯函数（`threadTitle.ts`/`threadTitleTypes.ts`/`turnOutline.ts`）、`threadTitles.ts` 落盘服务、`threads.ts` 的标题优先级与 `stats`、schema/IPC/preload/渲染层类型/`aiAgentCore` 首轮旁路接线、能力台账 281 + 两份生成物重生成、`ai:renameThread` 进 `ipcPayloadContract`、事件契约补 `ai:threadTitle`。Phase A 定向 4 文件 37 例绿。
- **Phase C**（队友 ui-session 实现、Lead 已验收）：AiSidebar 重命名入口 + 线程统计提示、`TurnOutlineDrawer` + `TurnOutlineLauncher`、`AgentTranscript` 每条消息锚点 `ai-msg-<下标>`、ChatPanel 挂载与滚动高亮、`aiStore` 的 `onThreadTitle` 监听与 `renameThread` action、i18n 中英；前端测试 ThreadRow 10 / TurnOutlineDrawer 7 / TurnOutlineLauncher 7 / ChatPanel 8 例。
- **闸门实测（2026-10-26 19:40–19:43）**：tsc node `0`、tsc web `0`；guards 15 文件 / 107 例全绿（`deadExports` 已因 `buildTurnOutline` 被界面引用而自然通过）；全量 vitest 日志 `_recovery/full-gate-batch56.log` = **288 passed | 2 skipped（290 文件）/ 3614 passed | 7 skipped（3621 例）/ exit 0**（第 55 批基线 283 文件 / 3557 例）。
- **文档**：`docs/ai/agent-core-wiring.md` 已追加 §56（114 行）；`docs/ai/dsh-source-adaptation-2026-10-24.md` §14 已加「2026-10-26（第十批）」行；本设计与全部改动文件已过 `prettier --write/--check`。

### 14.3 未完成（按序）

1. **真机 6 步**（见 14.4）。
2. **git 提交**：建议信息 `feat(ai): 会话自动标题与回合目录（标题归一生成、线程统计、回合跳转）`；提交前再跑 `tsc node/web` + `guards`（全量可复用上面结果，除非真机发现要改代码）；`git add -A`（`_recovery` 已 gitignore）→ `git commit -F`。
3. **Team 收尾**：shared task `task-2` 仍是 in_progress（owner ui-session 已 inactive、未写完成说明），可 complete 或留档。

### 14.4 真机步骤（§九 的可执行版）

- 放端口：确认 43191 无人监听（`Get-NetTCPConnection -LocalPort 43191 -State Listen -ErrorAction SilentlyContinue`）、无项目 electron（`Get-Process electron -ErrorAction SilentlyContinue`）。
- 起 dev：`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; $env:QQBAT_CDP_PORT='1'; node node_modules/electron-vite/bin/electron-vite.js dev`（CDP 43191，页面 `http://localhost:5173/`）。
- 项目：`E:\H Bot 制造\projects\还原验证项目`（已配 glm-5.3/百炼，能真正生成标题）。
- 探针脚本（上一轮已写、**尚未运行过**，可能需要按实际页面微调）：`_recovery/probe56/probe-title.js`（新线程发「只回答一个字：好。不要调用任何工具。」→ 等 8s → `listThreads` 查该线程 `title/titleSource/stats`）、`_recovery/probe56/probe-rename.js`（挑 provider 来源线程 → `renameThread(project,threadId,'第五十六批标题探针')` → 再 `listThreads` 验证 `titleSource==='user'`）。运行：`node _recovery/cdp-eval.mjs <js文件>`；截图：`node _recovery/cdp-shot.mjs <png路径>`。
- 检查点：① 首轮后标题为 provider 生成（≤64 字节，不是首条消息前 8 词），`.qqbat/ai-thread-titles.json` 出现 `{version:1,titles:{<threadId>:{title,source:'provider',updatedAt}}}`；② 改名带控制字符/纯空白 → 归一后为空被拒（界面「标题不能为空」）；③ 重命名后同线程再发一轮 → 标题不被覆盖（user pin）；④ 侧栏线程行 hover 出现「N 轮 · 约 X」统计提示；⑤ 会话页回合目录按钮 → 抽屉列出两轮、点第 1 轮滚到 `#ai-msg-…`；⑥ 清理测试线程文件（`.qqbat/ai-history/<id>.jsonl` 等）、清标题文件测试条目、停 dev/electron、确认 43191 FREE。
- 注意：标题生成是旁路请求，失败只 `logger.warn`，界面仍显示 fallback；等 8s 不够可再查。`agentCoreRun` 返回 `{ok,finalText,rounds,phase,toolResults}`。

### 14.5 已知风险/提示

- ui-session 越过了「docs/** 禁改」边界（wiring §56 在 19:35 出现）；内容已复核与实现一致，提交前建议 `git diff docs/ai/agent-core-wiring.md` 快速过一眼。
- fileSize 提示：ChatPanel 1678 / aiStore 2246 / aiAgentCore 1006 行「待拆」、`capabilityPolicy.generated.ts` 606 行「★未登记」——都不失败，属历史排期提示。
- 自动标题只在线程首轮触发（`past` 无 user 条目）；已有历史的线程不会自动起名，只显示 fallback，需要时手动重命名。
- 改名 IPC 只接受 1..200 字符（schema），主进程归一后为空会拒 —— 两条行为都要在真机验证。

### 14.6 新会话第一步

`git status --short` 确认 35 个未提交路径仍在 → `tsc node/web` + `guards` 快速确认环境 → 起 dev 做真机 6 步 → 提交。
