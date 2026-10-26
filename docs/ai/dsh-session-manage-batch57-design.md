# 第 57 批设计：会话管理（正文搜索 / Markdown 导出 / 线程删除）

> 2026-10-27。上游对标包：`dsh-session-query`（会话检索）、`dsh-session-log-export`（会话日志导出）、
> 以及本仓第 56 批留下的一个缺口（`ai:clearThread` 三层已通、**界面上没有入口**）。
> 用户口径（2026-10-27）："做成 DSH 那样，纯开发完善内容，其他事不要做"。

---

## 一、为什么是这三件

第 56 批把"会话视图"补齐了（标题 / 统计 / 回合目录），第 57 批顺着往上做**会话管理**——
三件都在同一个界面上（侧栏对话浮层）、都只读已经存在的记忆文件、都不碰 AI 循环本身：

| 件              | 上游语义                                                | 本仓缺口的真实形状                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 正文搜索      | `dsh-session-query`：按查询读会话、有长度上限与命中窗口 | 侧栏搜索框**只匹配标题**（`AiSidebar.tsx:348-355` 的 `th.title.toLowerCase().includes(q)`）—— 用户记得"我说过把超时改成 30 秒"，但记不住标题                                                                                             |
| ② Markdown 导出 | `dsh-session-log-export`：会话日志可导出、可再导入      | 记忆只在 `.qqbat/ai-history/*.jsonl` 里，**没有任何导出**；写日报、发工单、贴给别人看都只能截图                                                                                                                                          |
| ③ 删除线程      | `dsh-session*` 会话生命周期                             | `ai:clearThread` 主进程（`src/main/ipc/ai.ts`）、preload（`src/preload/index.ts:437`）、桥声明（`src/renderer/src/types/ipc.ts:707`）、store（`aiStore.ts:1347 clearActiveThread`）**全都在**，但**没有任何组件调用**—— 用户根本没机会点 |

三件共用的边界：**只读记忆文件 + 一次 IPC**，不进 `aiAgentCore` 的轮循环，不改上下文组装。

## 二、三件分别的语义口径

### 57.1 正文搜索：标题本地过滤 + 正文主进程扫描

- **为什么正文扫描必须在主进程**：渲染层只加载**当前线程**的消息（`loadHistoryFromDisk`），
  别的线程正文从来不在内存里。要搜正文只能读盘。
- **为什么标题仍留在渲染层过滤**：标题本来就在 `threads` 里，本地 `includes` 是零延迟；
  挪到主进程会让"打字即过滤"变成"打字即 IPC"，体验倒退。两段结果在界面上**分区**
  （标题命中在前、正文命中在后），不合并排序——合并排序要让用户理解一个他们不关心的打分规则。
- **匹配口径**：子串、不区分大小写、**不跨条目**。查询先归一（trim、折叠连续空白、转小写、
  截到 120 码点）。不用正则（用户输入里的 `.` `*` 会变成语法，且正则回溯是可控性问题）、
  不做模糊评分（"看起来像"的排序无法解释）。
- **不匹配角色的名字**：用户搜的是"我说过/它答过的话"，不是角色标签；`reasoning`/`trace` 也不搜
  （内部推理不是会话内容，且体积大）。
- **上限**：每条线程最多 3 处命中、最多 12 条线程、每条命中片段半径 24 码点
  （`THREAD_SEARCH_HITS_PER_THREAD=3` / `THREAD_SEARCH_MAX_RESULTS=12` /
  `THREAD_SEARCH_SNIPPET_RADIUS=24`）—— 上限是为了让浮层（208px 宽）保持可读，不是性能数字。
- **为什么不跨项目**：跨项目要扫所有项目的盘，权限边界（`assertProjectPathAllowed`）与耗时都不清；
  "跨项目"这件事已经由工作区分组承担了。

### 57.2 Markdown 导出：人读，不是机器再导入

- DSH 导出的是**会话日志原始格式**（可再导入同款 harness）；本仓没有"导入会话"的需求，
  用户要的是能贴进文档/工单的**人读**文本 —— 所以导出 Markdown，并在头信息里带**会话标识**，
  便于对账（"说的是哪个线程"）。
- **导出什么**：头信息（标题 / 线程 id / 项目名 / 导出时间 / 轮次与规模）+ 逐条正文
  （`## 第 N 轮`、`**你**` / `**助手**`）+ 每轮的工具行**仅名称与状态**。
- **明确不导出**：`reasoning`（内部推理，长且不属于会话内容）、工具参数与结果原文（体积与隐私）、
  图片/附件（记忆里本来就没有）。`attempt`（失败行）导出成一行引用块，标出 `reason` —— "这一轮没跑完"
  是用户复盘最需要的信息。
- **上限**：单条正文 4,000 字符（与 `historyStore.MAX_ENTRY_CHARS` 同源）、最多 2,000 条 ——
  导出的东西比记忆文件大没有意义。
- **落盘在主进程**：渲染层没有 fs；`dialog.showSaveDialog` 与已有先例（`src/main/ipc/aiPresets.ts`
  的 `ai:exportPresets`）同构。默认文件名 `<标题>-<线程 id 前 6>-对话记录.md`，
  标题里的 `\ / : * ? " < > |` 一律换成 `_`（Windows 文件名非法字符，不换就等于保存必失败）。

### 57.3 删除线程：把已经通的路接上界面，不新增 IPC

- 删除 = 删掉该线程的记忆文件（`clearHistoryFile`）—— 与 `ai:clearThread` 完全同义。
  **不新增 `ai:deleteThread`**：两个通道做同一件事就是两份真相，早晚有一份忘记同步。
- 界面上要**二次确认**（行内变成「确认 / 取消」两个小按钮，不弹窗）：记忆文件删了就没了，
  这条线程也不会出现在列表里，误点代价不可逆。
- 删**当前**线程时：切回该项目的 `default` 线程（老记忆文件），并刷新列表；
  删**别的**线程时：只刷列表 —— 别顺手把用户正在看的对话清掉。

## 三、接口形状（一条一条钉住）

```ts
// shared/ai/threadSearch.ts（纯函数，无 IO）
THREAD_SEARCH_QUERY_MAX_CHARS = 120
THREAD_SEARCH_HITS_PER_THREAD = 3
THREAD_SEARCH_MAX_RESULTS = 12
THREAD_SEARCH_SNIPPET_RADIUS = 24
normalizeThreadSearchQuery(raw: string): string        // trim → 折叠空白 → 小写 → 截 120 码点
matchThreadEntries(entries: {role, content}[], query, hitsPerThread?): ThreadSearchHit[]
// ThreadSearchHit = { index, role: 'user'|'assistant', before, match, after }
//   before/match/after 是**原文字符**（不做省略号，界面自己加），按码点切，不切碎代理对

// shared/ai/threadExport.ts（纯函数，无 IO）
THREAD_EXPORT_MAX_ENTRY_CHARS = 4000
THREAD_EXPORT_MAX_ENTRIES = 2000
exportThreadFileName(title: string, threadId: string): string
renderThreadMarkdown(input: ThreadExportInput): string

// 主进程 → 渲染层（两个新 invoke）
ai:searchThreads   ← { projectPath, query, limit? }  → { query, results: ThreadSearchMatch[] }
ai:exportThread    ← { projectPath, threadId }        → { filePath, bytes, entries } | 用户取消 = 明确错误
```

`ThreadSearchMatch` = `listThreads` 那条的形状 + `hits`，即
`{ id, title, titleSource, messageCount, updatedAt, stats, hits }` —— 界面拿到就能直接渲染，
不需要再查一次线程列表。

## 四、落地顺序

1. **A 纯函数**：`threadSearch.ts` / `threadExport.ts` + 单测（先写，主进程与界面都依赖它）。
2. **B 主进程**：`services/ai/threadSearch.ts`（扫盘 + 组装）、`services/ai/threadExport.ts`
   （读记忆 → 渲染）、schema 两条、`ipc/ai.ts` 两条 handler（导出走 save dialog）。
3. **C 渲染层**：`aiStore` 加 `searchThreads` / `deleteThread`；`AiSidebar` 浮层——搜索框下新增
   「正文命中」区、`ThreadRow` 加导出/删除两个 hover 图标 + 行内二次确认；i18n 两份。
4. **D 闸门与真机**：tsc / guards / 全量 vitest / build；dev + CDP 43191 逐条打真机
   （搜索命中片段、导出文件内容、删线程后列表与切换、删当前线程回 default）。

## 五、明确没做

- 不跨项目搜索、不搜 `reasoning`/`trace`、不做正则与模糊评分；
- 不导入会话（无可信格式，且导入=任意用户文件进上下文，风险大于收益）；
- 不导出图片/附件；
- 不做消息级反馈（`dsh-message-feedback` —— 下一批候选，需要先定"评价存在哪个文件、随线程删还是留"）；
- 不改 `aiAgentCore` 的任何轮循环语义。

## 六、落地状态（2026-10-27 收口；本批已全部闭环）

### 6.1 工作区与基线

- 基线 HEAD = `4559842`（第 56 批）。本批改完 `git status --porcelain` 是 30 个路径：
  17 个改动 + 13 个新增（含 1 份设计文档、5 个测试文件）。
- 上游对照仍在 `_recovery/dsh-files/`（`dsh-session-query`、`dsh-session-log-export` 等已抽出的源码），
  取读工具是 `_recovery/dsh-read.js`（自己解 asar 头，`list` / `read` 两个子命令）。

### 6.2 已完成

- **A 纯函数**：`src/shared/ai/threadSearch.ts`(145)、`src/shared/ai/threadExport.ts`(163)，
  单测 28 例（14 + 14）全绿。
- **B 主进程**：`src/main/services/ai/threadSearch.ts`(88)、`threadExport.ts`(65)、
  `src/main/schemas/ai.ts` 两条 schema、`src/main/ipc/ai.ts`(840) 两条 handler（导出挂父窗口 + save dialog
  - `writeFile`），测试 15 例（9 + 6）全绿。
- **C 渲染层**：`aiStore` 的 `ThreadSearchHit` / `ThreadSearchMatch` / `searchThreads` / `deleteThread`；
  `AiSidebar.tsx`(737) 接搜索命中区与导出/删除；新组件 `ThreadSearchResults.tsx`(151)、
  `AiRailButton.tsx`(40)、`AiContextFlyout.tsx`(70)；i18n 中英各 +13 键；渲染层测试 8 + 19 例。
- **D 闸门与真机**：tsc node/web 0、guards 15/107、全量 295 文件 / 3681 例（3674 通过 + 7 跳过）、
  build EXIT 0、prettier 29/30（剩 `dsh-source-adaptation-2026-10-24.md` 是存量巨型表格）；
  真机跑了正文搜索、搜索口径旁证、导出取消、导出落盘、二次确认、真删、删当前线程、收尾共 8 步
  （细节与截图见 `docs/ai/agent-core-wiring.md` §57.8）。

### 6.3 未完成

已清空。`team_task_list` 上 task-2（渲染层三件套）已 completed，随提交一起闭环。

### 6.4 真机步骤（可执行版，已跑过）

1. 起 dev：`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`；
   `$env:QQBAT_CDP_PORT='1'`；`node node_modules/electron-vite/bin/electron-vite.js dev`。
   等到日志出现 `CDP 已开启：127.0.0.1:43191` 与 `[bootstrap] SQLite 引擎：better-sqlite3`。
2. 探针：`node _recovery/cdp-eval.mjs _recovery/probe57/<probe>.js`（查询词选「审批」这类只在正文里
   的说法；导出要弹真保存框，用 `WScript.Shell` 的 `AppActivate('导出对话')` + `SendKeys`）。
3. 截图：`node _recovery/cdp-shot2.mjs <out>.png`（带 `Page.bringToFront`；`cdp-shot.mjs` 在这种
   前台被 DevTools 占着的场景会卡在 `Page.captureScreenshot`）。
4. 收尾：杀 electron、确认 43191 / 5173 都 0 监听，`ai-history/` 里自己造的 jsonl 删掉。

### 6.5 已知风险（复审后）

1. 正文搜索**只搜当前项目**；跨项目搜索要连 `listThreads` 的项目枚举一起改，没做。
2. `ai:searchThreads` 在主线程同步读全部 jsonl（每线程一次 `loadHistory`）：单项目几十条线程、
   单文件 ≤ 1 MB 实测无感；上千条线程要改增量索引 —— 阈值本批没测。
3. 搜索框输入的真机验证用的是 value setter + `input` 事件（React 受控输入），中文输入法的
   `compositionstart/end` 组合事件没测。
4. 导出保存框的人机细节（覆盖确认、切目录、超长文件名）没测；取消与落盘两条路径都跑了真框。
5. 导出成功的提示是行下 `role="status"` 小字，列表刷新后随组件卸载消失（本项目无 toast 基建）。
6. 删除确认态在流式输出中不会自动收起（图标隐藏了，但已进入确认态的那行按钮仍可用）。
7. 消息级反馈（`dsh-message-feedback`）留作下一批：需要先定"评价落在哪个文件、随线程删还是留"。

### 6.6 下一批入口（第 58 批）

候选按"能力账里还标 ⛔/缺入口"的优先级：①消息反馈（positive/negative + note，本地 jsonl + 回放式
事件）②`@` 文件引用（上游 `dsh-client-ui-input-trigger` + `dsh-file-reference`）③工具审批的白名单
记忆（`dsh-tool-approval-memory` 一类）。开工前先读 `docs/ai/agent-core-wiring.md` §57 与本文档 §五
「明确没做」，别把"没做"当成"忘了做"。
