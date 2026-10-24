# DSH 源码适配设计（二改 + 改名 + 冲突以本项目为准）

> 结论：**可以做**。DSH 是 MIT（`LICENSE` 首行 `Copyright (c) 2026 DeepSeek`），二改、改名、商用都允许；
> 但**不建议整仓 fork**：上游 677,607 行 / 385 个 workspace 包，我们真正用得上的面只有 ≈23,000 行（3.5%），
> 而且其中一多半绑在 Cordis 服务图上（`agent-loop` 一个包就有 9 个 peer 依赖）。
> 推荐**选择性适配**：算法密集、耦合低的**搬代码 + 改名 + 来源头**；循环/工具执行这类深耦合的**按参考重写**。

本文是设计（未落代码）。落地按 §9 分阶段走，每阶段单独提交、单独过闸门。

**核心（机器人开发：流程引擎 / 节点库 / 低代码 / 面板 / 部署）与三栏布局一行不动**——这是前提，不是可协商项。

## 0. 决策与范围（已锁定）

| 编号 | 决策         | 结论                                        | 依据                                                 |
| ---- | ------------ | ------------------------------------------- | ---------------------------------------------------- |
| D1   | 适配范围     | **B 选择性适配，且只取 AI / 智能体面**      | 用户 m23937：「核心不换」「ai 和智能体相关的要给到」 |
| D2   | DI 冲突      | **i 去 Cordis 化**（我们的 kernel 不换）    | 同上「核心不换」——不引入第二套运行时                 |
| D3   | 上游同步基准 | **保留**（MANIFEST + 哈希 + `vendor:diff`） | 否则以后没法对照上游                                 |

### 0.1 范围红线

**做（AI / 智能体面）**

- 工具执行：结果裁剪、spill 落盘、超时与顺序提交、并行上限；
- 上下文：区段选择、摘要入口、压缩预算；
- 会话与轮次：取消、超时、事件顺序、步骤账本；
- 角色：把「预设」做成角色的组合清单（`AgentPreset → RolePreset`）—— 字段对应见下；
- 提示词：只改**装配机制**，不搬 DSH 的 prompt 文案。

**预设字段对应**（DSH `agent-preset` → 我们 `.qqbat/agent-presets.json`，2026-10-24 落地）：

| DSH 语义                      | 我们的字段                 | 我们的口径                                              |
| ----------------------------- | -------------------------- | ------------------------------------------------------- |
| 选择一串子插件 = 这一轮的组成 | `plugins` + `allowedTools` | 工具表是**权限边界**，不是建议                          |
| 每会话一个 preset             | `preset`（会话存名字）     | 与 DSH 一致：会话只存选择，不存内容                     |
| 预设自带提示段                | `prompt`                   | 接在角色说明后（`PROMPT_MAX=2000`），**只在提示层**     |
| 预设决定角色                  | `role`                     | 缺省跟着页面走；写死则覆盖（`roleDomains.ts` 唯一真源） |

差异（**刻意不照搬**）：DSH 的 preset 能换模型/参数；我们**不换** —— 模型是用户在设置里选的，
预设偷偷换掉它会让"为什么答得不一样"无法归因。

**不做（核心与布局，一行不动）**

- 机器人运行核心：`botManager` → `FlowRuntime` 直接解释 `.qqbat/flow.json`（ADR-003）；
- 低代码：节点库、画布、指令 / 面板 / 数据模板编辑器、生成代码；
- 部署：docker / ssh / standalone；
- IPC 契约与 `.qqbat/` 数据格式（用户数据不迁移）；
- 三栏布局与渲染层（保持三栏，不搬 `packages/client`）；
- 插件市场（不是 AI 面，本版移出，见 §4）。

一句话：**能换的是 AI 层的算法与循环；不能换的是"开发机器人"这条主干和它的三栏壳。**

## 1. 源码事实（已核，2026-10-24）

| 项         | 值                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------- |
| 本地快照   | `E:\H Bot 制造\deepseek-harness-master\deepseek-harness-master\`（zip 解出，**无 `.git`**） |
| 版本       | `0.2.1-rc.3`，与本地运行态 `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.3` 同版本             |
| 上游       | `github.com/deepseek-ai/deepseek-harness`，tag **`dsh-v0.2.1-rc.3`**（33 个 tag 中最新的）  |
| 许可       | MIT，`Copyright (c) 2026 DeepSeek`；上游另有 `THIRD_PARTY_NOTICES.md`                       |
| 规模       | 19,188 文件 / 125.4 MB；3,956 个非测试 `*.ts(x)` / **677,607 行**；另有 2,310 个测试文件    |
| 包结构     | 52 个包组目录 / 385 个 `package.json`；`packages/client` 单独就有 3,155 文件 / 21.9 MB      |
| 工具链     | Node `>=24.9.0`、zod `4.4.3`、TypeScript `6.0.3`、pnpm `11.28.5`                            |
| 我们的对应 | Node `>=22`、zod `4.6.1`、TS `^6.0.3`、pnpm（见 `package.json`）                            |

结论：**zod / TS 两栈已经对齐**，唯一硬差异是 Node 引擎下限（他们 24.9，我们 22）——见 §11 风险 4。

## 2. 合规边界（硬约束，不可协商）

MIT 的义务只有两条：**保留版权与许可声明**、**不担保**。落到工程上就是四件事：

1. `src/main/vendor/dsh/LICENSE` 放 MIT 原文（含 `Copyright (c) 2026 DeepSeek` 与 Permission 段），不放我们的版权行；
2. 仓库根 `THIRD_PARTY_NOTICES.md` 增加一条：项目名、版本、tag、commit、取了哪些文件、改了什么；
3. **每个被搬的文件**有来源头（见 §6 模板）；
4. `src/main/vendor/dsh/MANIFEST.json` 逐文件记录 `sourcePath / sha256 / targetPath / adaptedNotes`，供 `vendor:audit` 和上游 diff 用。

**"命名注释都要改"的正确边界**：标识符、文件名、注释**可以且应该**改（这是二改的自由）；
**版权声明、来源记录、许可文本不能删**。删掉的后果不是"更干净"，而是：① 违反 MIT；② 以后上游发 0.3，
我们没有任何基准做 diff，只能人工回忆"当初改了什么"。

### 禁止拷贝清单（这一版明确不碰）

| 内容                 | 位置                                                                         | 原因                                                               |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 客户端 UI            | `packages/client/**`（21.9 MB）                                              | 我们自己的 React 三栏 + Tailwind v4 已经成型，搬过来是换壳不是适配 |
| 提示词 / 人设 / 品牌 | `*-instructions`、`docs/`、`BRAND_GUIDELINES*`、`packages/client-ui-brand-*` | 既是版权敏感区，也是 DSH 产品语境，搬过来会串味                    |
| 原生与实验           | `native/`、`packages/experimental/**`                                        | 与产品无关                                                         |
| 上游的第三方副本     | `vendor/`、`THIRD_PARTY_NOTICES.md` 里列的非 DeepSeek 代码                   | 我们按自己的依赖清单引，不复制别人的副本                           |
| 构建/工具链          | `pnpm-lock.yaml`、`tsdown.config.ts`、`vitest.*.ts`                          | 我们的 electron-vite + vitest 4 已经跑通                           |

## 3. 三个候选方案（质不同，不是大小之别）

| 维度       | A 整仓 fork                                                         | **B 选择性适配（推荐）**                             | C 纯语义重写（现状）                                            |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| 做法       | 把上游仓库接进来当第二套宿主，逐步替换                              | 只取 4~6 个子系统，改名 + 适配层，逐个替换我们的实现 | 只读行为，用自己的结构重写                                      |
| 首年投入   | 高：385 包的依赖树 + Cordis 平台化，估 25~40 人日才"能跑自己的业务" | 中：≈2.5k 行搬迁 + ≈3k 行参考重写，估 8~12 人日      | 高：每个子系统都要重新推导行为，估 15~25 人日（且最容易漏边界） |
| 维护成本   | 最高：上游每个 breaking change 都要跟；我们的 2.9k 测试大面积重写   | 中：子系统级升级，MANIFEST 可 diff                   | 中高：自己实现的边界 bug 自己修                                 |
| 风险       | 双宿主并存、数据格式冲突、UI 全废                                   | 去 Cordis 化后语义偏移（取消/超时/事件顺序）         | 行为"看起来像"但细节不一致（我们已经踩过：并行工具的顺序提交）  |
| 可控性     | 低（上游节奏说了算）                                                | **高**                                               | 最高                                                            |
| 许可复杂度 | 高（要连带处理他们的第三方副本）                                    | 低（只搬 DeepSeek 自有包，逐个包记录）               | 最低（不搬代码，只借语义）                                      |

为什么 A 不划算，给两个硬数字：他们的 `agent-loop`（2,394 行）import 了 `dsh-agent`、`dsh-llm`、`dsh-session`、
`dsh-session-persistence`、`dsh-session-projection`、`dsh-scope`、`dsh-system-prompt`、`dsh-tools`、`cordis` 九个包；
而 `packages/client` 21.9 MB 的 UI 我们一行都用不上。

## 4. 子系统矩阵：搬 / 参考重写 / 跳过

行数是**非测试源码行**（`*.ts`，排除 `*.test.ts`），2026-10-24 实测。

| DSH 包                                            | 行数              | 我们的对应                                                                          | 耦合                                | 处置                                                | 理由                                                             |
| ------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `core/agent-loop`                                 | 2,394             | `src/main/services/agent-core/`（core 773 / runTurn 173 / scheduler 191，共 2,028） | 9 peer + session append + waterfall | **参考重写**                                        | 直接搬等于搬半个 host；我们已经用 2.9k 测试锁住行为              |
| `core/agent`                                      | 1,848             | 同上                                                                                | 深                                  | **参考重写**                                        | 同上                                                             |
| `core/tools`                                      | 3,800             | `src/main/services/ai/tools/`（1,840）                                              | 中（5 peer）                        | **搬算法段**（选择集 / 超时 / 结果裁剪 / 顺序提交） | 算法密集、可脱离服务图                                           |
| `core/tool-executor-native`                       | 36                | `tools/execute.ts`                                                                  | 低                                  | **搬**                                              | 极小，几乎无耦合                                                 |
| `core/tool-executor-ptc`                          | 2,209             | 无                                                                                  | 深                                  | 跳过                                                | 我们没有"用代码调工具"这个产品面                                 |
| `compaction/compaction`                           | 520               | `ai/contextDigest.ts`（127）+`ai/context.ts`（400）                                 | 中                                  | **搬**（区段选择）                                  | 纯算法，输入输出都是消息数组                                     |
| `compaction/compaction-tool-result-pruner`        | 306               | 工具结果 8192 阈值（`ai/index.ts` 附近）                                            | 中                                  | **搬**                                              | 我们现在的裁剪是"超阈值截头留尾"，它的策略更完整                 |
| `compaction/compaction-basic`                     | 1,744             | `ai/contextDigest.ts` + `ai/summaryLlm.ts`                                          | 深（8 peer）                        | **参考重写**                                        | 摘要入口必须走我们的 `resolveSummaryLlm` 与预算                  |
| `compaction/compaction-image-offload`             | 201               | 无                                                                                  | 中                                  | 暂缓                                                | 我们还没有图片上下文膨胀问题                                     |
| `preset/agent-preset-registry`                    | 1,146             | `ai/agents.ts`（132）+`ai/presets.ts`（112）+ 角色 chips                            | 深（11 peer）                       | **搬语义段**（组合清单 / 选择 / 应用）              | 正好补"角色 = 预设"这一层                                        |
| `boot/plugin-market` + `util/plugin-market-index` | 1,944 + 442       | `plugins/market.ts`（617）+`shared/plugins/market.ts`（308）                        | 深（7 peer）                        | **移出范围**                                        | 插件市场不属于 AI / 智能体面，等产品要了再单独决策               |
| `spill/spill-policy`                              | 350               | 工具结果落盘 `.qqbat/ai-spill/`                                                     | 低                                  | **搬**                                              | 策略表 + 阈值，正好替掉硬编码 8192                               |
| `todo/tool-todo` / `plan/plan-mode` / `goal/*`    | 274 / 541 / 1,950 | 无（只有"本轮改动"卡片）                                                            | 中                                  | 暂缓                                                | 这是**产品功能**不是适配，需要先决定要不要 todo/plan/goal 三个面 |
| `skill/skill` + `skill-filesystem`                | 869 + …           | 无                                                                                  | 中                                  | 暂缓                                                | 没有 skill 运行器与目录约定                                      |
| `context/agent-instructions`                      | 2,244             | `ai/promptSections.ts`（200）                                                       | 深                                  | 跳过                                                | 内容是 DSH 自己的产品语境                                        |
| `client/ui-*`                                     | 21.9 MB           | 我们自己的渲染层                                                                    | —                                   | 跳过                                                | 见 §2 禁止清单                                                   |

合计（估）：**搬迁 ≈2.1k 行**、**参考重写 ≈3k 行**、**不动 ≈675k 行**（含 `packages/client` 21.9 MB、市场 2.4k、PTC 2.2k、instructions 2.2k）。

## 5. DI 冲突：Cordis vs 我们的 kernel

上游每个包都写着 `ctx.service(...)` / `ctx.effect(...)` / `ctx.emit(...)`，我们的 `src/main/services/plugins/kernel.ts`（227 行）
按 DSH 的四条语义自建了等价物：**provideService / requireService / effect / inject 激活 / 反序卸载 / 级联卸载**；
没有的是 HMR、`cordis-plugin-loader/include/group`、profile patch 组合。

| 方案                          | 做法                                                                                         | 成本             | 风险                                                             | 适用                          |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------- | ----------------------------- |
| **i 去 Cordis 化（推荐）**    | 把 `ctx.*` 调用逐个换成我们的 `PluginKernelContext`，peer 服务改成我们的接口                 | 每个包 1~2 天    | 语义偏移（取消、超时、事件顺序）                                 | ≤1.5k 行的算法包              |
| ii 换用上游 Cordis            | 引入 `@deepseek-ai/cordis`（4.0.5，MIT）当运行时，vendored 包原样跑                          | 低（1 天接进来） | 变成**平台迁移**：我们 3,376 行的插件系统要重做，2.9k 测试受影响 | 只有在决定"整仓 fork"时才考虑 |
| iii 岛内 Cordis + 岛外 kernel | vendor 区里跑一个小 Cordis 容器，只桥 5 个服务（tools / llm / session-log / log / settings） | 中（2~3 天搭桥） | 双 DI 生命周期，排障要跨两套容器                                 | `agent-loop` 这类深耦合重包   |

推荐：**i 打底，iii 兜底**。先拿 S1/S3 验证"去 Cordis 化"的实际成本；如果发现某个包拆不动，再对那一个包启用 iii。

## 6. 命名与注释改造规范

### 6.1 术语映射（示例，落地时补全）

| 上游                   | 我们的叫法          | 备注                                   |
| ---------------------- | ------------------- | -------------------------------------- |
| `AgentLoop`            | `TurnRunner`        | 我们已有"轮/步"术语（`turn` / `step`） |
| `ToolSet`              | `ToolSelection`     | 与 `tools/registry.ts` 的选择集对齐    |
| `CompactionRegion`     | `ContextRegion`     | 避免 compaction/compress 混用          |
| `CompactionSummarizer` | `HistorySummarizer` | 与 `contextDigest.ts` 对齐             |
| `AgentPreset`          | `RolePreset`        | 我们的产品词是"角色"                   |
| `PresetRegistry`       | `RoleRegistry`      | 同上                                   |
| `SpillPolicy`          | `SpillTrimPolicy`   | "trim" 表明是裁剪策略                  |
| `PluginMarketIndex`    | `CatalogIndex`      | 我们的界面词是"市场目录"               |

### 6.2 每个搬迁文件的头（模板，`vendor:audit` 按它卡）

```ts
// src/main/vendor/dsh/<subsystem>/<file>.ts
//
// 来源：deepseek-harness @ dsh-v0.2.1-rc.3
//       packages/<group>/<pkg>/src/<orig>.ts（MIT，Copyright (c) 2026 DeepSeek）
// 改编：<一句话说清改了什么，例如"ctx.service 换成 PluginKernelContext；去掉上报，顺序不变">
// 契约：输入输出与我们的 shared/types 对齐，见 MANIFEST.json 的 adaptedNotes
```

### 6.3 注释怎么写

- 一律改写成中文，写**为什么**（不变量、边界、踩过的坑），不写"这段来自上游"以外的出处；
- **删掉**上游的工单号、内部人名、`oxlint-disable` 之类的仓库专属注释（它们对我们没意义）；
- **保留**算法不变量（例如"结果按模型给出的顺序提交"），这类注释是资产的精华；
- 不要整段照搬上游 README/文档进我们的 `docs/`，改写成我们的表述（README 也在版权范围内）。

### 6.4 兼容开关命名

只有**行为兼容开关**带前缀，形如 `QQBAT_DSH_COMPACTION=1`（默认关，灰度打开）；业务常量不加前缀。
现在已有的 `QQBAT_CONTEXT_SUMMARY`（`deterministic` / `model`）保持原样，S2 里扩展到三值。

## 7. 冲突裁决：什么情况下"本项目优先"

| 冲突类型      | 裁决                                                    | 例子                                      |
| ------------- | ------------------------------------------------------- | ----------------------------------------- |
| 类型与契约    | **我们的 `src/shared` 优先**，外来代码适配              | `HistoryEntry` 字段不因上游改名           |
| 持久化格式    | **我们的 `.qqbat/` 与 JSONL 优先**，绝不迁移用户数据    | 上游 session 结构与我们不同，只映射不改盘 |
| IPC / preload | **我们的通道名优先**                                    | `ai:*` / `plugin:*` 不被上游命名覆盖      |
| 命名          | **我们的领域词优先**，外来名走 §6.1 映射                | "角色"不是 preset                         |
| 行为          | **有测试覆盖的行为优先**；上游更优时走"行为变更单"      | 见下                                      |
| 依赖与运行时  | **我们的 `package.json` 优先**，不为此升 Electron/React | 见 §11 风险 4                             |
| 引擎 API      | 只用 Electron 主进程实际提供的 Node 能力                | 见 §13 开放问题 1                         |

**"优先本项目"的例外（必须写进提交说明）**：如果我们的既有行为本身就是**错的**（协议不符、崩溃、数据损坏），
不能用"以本项目为准"挡着——那要走正常修 bug 流程（先加失败用例，再改行为），而不是把它固化成"我们的语义"。

## 8. 目录布局与 MANIFEST

```
src/main/vendor/dsh/
  LICENSE              MIT 原文（含 DeepSeek 版权行），不许改
  MANIFEST.json        逐文件来源 + sha256 + 改编说明
  README.md            我们改了什么、对应上游 tag/commit、如何升级
  compaction/          region.ts  pruner.ts
  market/              parse.ts  index-url.ts  cache.ts
  spill/               policy.ts
```

```json
{
  "upstream": {
    "repo": "https://github.com/deepseek-ai/deepseek-harness",
    "tag": "dsh-v0.2.1-rc.3",
    "commit": "<补：22 位 sha>",
    "license": "MIT"
  },
  "files": [
    {
      "sourcePath": "packages/compaction/compaction-tool-result-pruner/src/index.ts",
      "targetPath": "src/main/vendor/dsh/compaction/pruner.ts",
      "sourceSha256": "<上游原文哈希>",
      "adaptedNotes": "ctx.service 换 PluginKernelContext；阈值改读 budgetSettings；顺序与截断位置未改"
    }
  ]
}
```

`scripts/vendor-audit.mjs`（S0 写）：① 每个 `vendor/dsh/**/*.ts` 必须有 §6.2 头；② 头里的 tag/路径必须在 MANIFEST 有对应条目；
③ `sourceSha256` 与本地上游快照对得上（防"记了个假来源"）；④ LICENSE 存在且首行含 `MIT`。

## 9. 分阶段实施（每阶段一个提交，独立过闸门）

| 阶段                             | 范围                                                                             | 产出                       | 闸门                                              | 估时   |
| -------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- | ------ |
| **S0 合规脚手架**                | LICENSE / NOTICE / MANIFEST 模板 / `vendor-audit` / guard 用例                   | 空 vendor 目录也能过审计   | tsc + guards                                      | 0.5 天 |
| **S1 工具结果裁剪 + spill 策略** | `tool-result-pruner` + `spill-policy` → 替掉 8192 硬编码                         | 阈值来自配置，落盘策略统一 | `tests/main/services/ai/*` 回归 + 新裁剪用例      | 1.5 天 |
| **S2 压缩区段与摘要**            | `compaction/region` → `context.ts` / `contextDigest.ts`，摘要入口接 `summaryLlm` | 长任务不再"忘掉前半段"     | A/B 对照报告（同历史、压缩前后模型可见内容 diff） | 2~3 天 |
| ~~S3 市场索引解析~~              | 已移出本版范围（插件市场不属于 AI 面）                                           | —                          | —                                                 | —      |
| **S4（可选）循环与调度对齐**     | 不 vendor：按 §4 参考重写 `runTurn` / `scheduler` 的取消与顺序提交               | 与 DSH 行为矩阵对齐        | agent-core 全量 + 并行/屏障/取消矩阵              | 3~5 天 |
| **S5 收尾**                      | 文档、`vendor:diff`、体积/性能对比、删死代码                                     | 可复现的升级流程           | 全量测试 + 体积预算                               | 1 天   |

顺序理由：先做**耦合最低、收益最直接**的（裁剪/压缩），把"改名 + 来源头 + 审计"的肌肉记忆练出来；
深耦合的循环留到最后，且默认**不搬**。

## 10. 闸门与验收

- `tsc -p tsconfig.node.json` / `tsconfig.web.json` **0 错**；
- `tests/guards` 全绿（新增 `vendorAudit` 一条）；
- 全量 `vitest`（当前基线 224 文件 / 2,997 用例）不退化；
- vendor 单文件 ≤400 行、单子系统 ≤800 行（我们的 `fileSize` 闸门同样适用）；无 `console.log`、无 `any`（`styleContract` 同样适用）；
- 性能：压缩路径每轮增加 <50 ms；启动增加 <100 ms；
- 行为对照：压缩/裁剪改动必须附"同一历史输入，改动前后模型可见内容"的 diff 报告（不是凭感觉说"更好了"）。

## 11. 风险清单

| #   | 风险                                          | 触发信号                                         | 对策                                                           |
| --- | --------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| 1   | **双实现并存导致语义漂移**（最大）            | 同一能力两处代码都在跑                           | 每个子系统切换必须**同一提交删除旧实现**；不允许"先留着以后清" |
| 2   | 去 Cordis 化后行为不等价                      | 取消不生效、超时变长、事件顺序变                 | 用"行为矩阵"测试固定：并发/屏障/取消/超时四组用例              |
| 3   | 上游升级漂移（0.2.1 → 0.3）                   | 改名后无法直接 diff                              | 留 `sourceSha256` + `vendor:diff` 脚本，对照上游原文件         |
| 4   | Node 引擎不一致（上游 `>=24.9`，我们 `>=22`） | 用了 `node:sqlite` 之外的新 API 崩在 Electron 里 | 不引入 Node 24 专有 API；加一条 vendor 专用 lint/guard         |
| 5   | 范围蔓延（"顺手也搬一个"）                    | vendor 行数超预算                                | 每阶段预算写进 PR 描述；超了就开新决策                         |
| 6   | 合规漏项                                      | 忘了 NOTICE、头里没版权行                        | `vendor:audit` 在 CI 里卡                                      |
| 7   | 产品语境串味                                  | 我们的提示词/界面出现 DSH 品牌词                 | §2 禁止清单 + 文案审查                                         |

## 12. 决策链（选了什么 / 排除了什么 / 为什么）

| 决策     | 结论                            | 排除了什么               | 为什么                                                            | 归属                 |
| -------- | ------------------------------- | ------------------------ | ----------------------------------------------------------------- | -------------------- |
| 适配方式 | 选择性适配                      | 整仓 fork；纯语义重写    | 677k 行里只有 3.5% 用得上；fork 等于换宿主                        | **待用户确认**       |
| DI       | 去 Cordis 化，重包用岛内 Cordis | 引入上游 Cordis 当运行时 | 我们已有 kernel-lite + 2.9k 测试；换运行时是平台迁移不是适配      | **待用户确认**       |
| 循环     | 参考重写，不搬                  | vendor `agent-loop`      | 9 个 peer + session append + waterfall，搬过来要连 session 一起搬 | LLM 建议             |
| 命名     | 改标识符 + 中文注释，保来源头   | 全删痕迹                 | MIT 义务；且没有基准就没法跟上上游                                | **待用户确认（D3）** |
| 落地顺序 | 裁剪/压缩 → 市场 → （可选）循环 | 先搬循环                 | 低耦合先验证流程，失败成本低                                      | LLM 建议             |

## 13. 开放问题

1. **Electron 42 内置的 Node 版本**是多少？（决定 vendored 代码能不能用 Node 24 API；需实测 `process.versions.node`）
2. 要不要做 **todo / plan / goal** 三个产品面？（DSH 有、我们没有；这是产品决策，不是适配问题）
3. 市场是否支持**远程闭包**（tarball / git）？上游用 `execa` + `worker_threads` 解析，我们目前 fail-closed 只吃内联文件。
4. 摘要用**全局 AI** 还是**项目 AI**？（`resolveSummaryLlm` 已按项目解析，需确认口径）

## 14. 变更记录

| 日期               | 变更                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-24         | 初稿：事实核对、三方案对比、子系统矩阵、命名与冲突规则、S0~S5 计划                                                                                                                                                                                                                    |
| 2026-10-24（二次） | 按用户口径锁定范围：只适配 AI / 智能体面，核心与三栏布局不动，市场索引移出；D1/D2 定案                                                                                                                                                                                                |
| 2026-10-24（三次） | **S1 落地**：循环内上下文压缩（`agent-core/contextGate.ts`，提交 `f7a869e`）—— 对照见 `agent-core-wiring.md` §23                                                                                                                                                                      |
| 2026-10-24（四次） | **S2 落地**：角色进循环 + 预设字段（`role`/`prompt`）对齐 `agent-preset` 语义 —— 对照见 `agent-core-wiring.md` §24                                                                                                                                                                    |
| 2026-10-25         | **S3 落地**：循环入口接通 `planFirst` / `fullAccess`，预设工具表真正交给循环，系统提示只广告实际可用的工具 —— 对照见 `agent-core-wiring.md` §25                                                                                                                                       |
| 2026-10-25         | **S4 落地**：贴图 / 当前打开的文件 / 预设 `permissionMode` 三处"传了没读"补齐；顺带查出 `aiSavePresetsSchema` 没声明 `role`/`prompt` 导致 zod 静默 strip —— 对照见 `agent-core-wiring.md` §26                                                                                         |
| 2026-10-25（二次） | **压缩提示进界面**：新 IPC 事件 `ai:compact`（四处登记 + 能力账本三处 + 重生成目录），界面落一条 `notice:'compaction'` 分隔提示 —— 对照见 `agent-core-wiring.md` §27                                                                                                                  |
| 2026-10-25（三次） | **预设表单化**：`PresetEditor` 从整文件 JSON 文本框改为列表 + 表单（未知字段原样回写），`PresetSelect` 的键从 `id` 改回 `name`（修「写了 id 的预设选中后静默失效」）—— 对照见 `agent-core-wiring.md` §28；没有 `projectPath` 时明说「先打开一个项目」并禁用保存（旧写法是点了没反应） |
| 2026-10-25（四次） | **本轮边界一行**：`TurnBoundary` 把主进程真正生效的角色来源 / 工具与插件收窄数 / 审批口径 / 先计划摆在输入框上方（默认态不渲染）—— 对照见 `agent-core-wiring.md` §29                                                                                                                  |
