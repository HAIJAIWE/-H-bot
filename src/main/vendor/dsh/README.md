# vendor/dsh —— 从 DeepSeek Harness 搬来的算法

这个目录里的代码**不是我们写的**，是从上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
按 MIT 许可搬运并适配的。上游许可原文见同目录 `LICENSE`（`Copyright (c) 2026 DeepSeek`）。

## 搬运基准

| 项       | 值                                                                                      |
| -------- | --------------------------------------------------------------------------------------- |
| 上游版本 | `0.2.1-rc.3`                                                                            |
| 上游 tag | `dsh-v0.2.1-rc.3`                                                                       |
| 本地快照 | `deepseek-harness-master/deepseek-harness-master/`（zip 解出，无 `.git`，已 gitignore） |
| 搬运日期 | 2026-10-25                                                                              |
| 许可     | MIT（见 `LICENSE`）                                                                     |

`MANIFEST.json` 逐文件记录 `sourcePath` / `sourceSha256` / `targetPath` / `targetSha256` / `adaptedNotes`。
`pnpm vendor:audit` 会重算每个目标文件的哈希（上游快照在的话，连上游哈希一起对）。

## 只搬「算法密集、耦合低」的文件

设计文档 `docs/ai/dsh-source-adaptation-2026-10-24.md` §0 的 D2 决策：**去 Cordis 化** ——
本仓库不引入第二套运行时，所以凡是 `extends Service`、`static inject = [...]`、
`session.append(...)`、`ctx.tokenMeter` 这类绑在上游服务树/会话重放上的部分一律**不搬**，
只搬里面的纯算法，并且必须写明改了什么。

已经确认**搬不动**的（只作参考，不在此目录）：

- `packages/compaction/compaction-basic/src/index.ts`（477 行，import 22 个 `@deepseek-ai/*`）；
- 同目录 `region.ts`（601 行，绑 `SessionSeq` / `EpochHeader` / `dsh-token-meter`）；
- `packages/llm/token-meter/src/index.ts`（297 行，Cordis `Service` + 会话投影重放）；
- `packages/compaction/compaction-tool-result-pruner/src/index.ts` 的 `pruneSession()`（要 `Session` 的 shadow-price 协议）；
- `packages/plan/plan-mode/src/index.ts`（452 行，`PlanModeController extends Service` + 会话投影 + 系统提示注册）；
- `packages/preset/agent-preset-registry/**`（绑死 DSH 那四个预设 id 与 Cordis YAML 插件行，换不到我们的语义上）；
- `packages/compaction/compaction-image-offload/**`（我们循环里的图只挂在当轮首个 user 回合、且不落盘，历史里没有旧图可搬）。

## 目录

| 路径                               | 来源                                                              | 说明                                                                              |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `token-meter/estimate.ts`          | `packages/llm/token-meter/src/estimate.ts`                        | 固定密度启发式定价（块结构开销、角色框开销）                                      |
| `token-meter/measure.ts`           | **本仓库适配层**                                                  | 字符计量：ASCII 记 1、宽字符记 4（上游直接 `text.length / 4`，对中文低估约 4 倍） |
| `token-meter/types.ts`             | **本仓库适配层**                                                  | 上游 `@deepseek-ai/dsh-llm` / `dsh-session` 类型的最小垫片                        |
| `tool-result-pruner/config.ts`     | `packages/compaction/compaction-tool-result-pruner/src/config.ts` | `PRUNE_MARKER` / `DEFAULTS` / `resolveConfig`                                     |
| `tool-result-pruner/prune.ts`      | 同上 `src/index.ts` 的两个方法                                    | `measureContent` / `pruneContent` 提成纯函数，剪枝逻辑没改                        |
| `tool-result-pruner/types.ts`      | 同上 `src/types.ts`                                               | 只留配置类型（`PrunedEntry` / `PruneResult` 绑 `SessionSeq`，已删）               |
| `todo/types.ts`                    | `packages/todo/tool-todo/src/types.ts`                            | `TodoItem` 与三态生命周期（投影的 declare module 已删）                           |
| `todo/todo-list.ts`                | 同目录 `src/index.ts` 的纯函数                                    | 工具描述、`toTodoList` 校验（文案未改）、计数与回执文案                           |
| `repeat-tool-reminder/detector.ts` | `packages/guard/repeat-tool-reminder/src/index.ts`                | 重复调用检测纯算法（规范化参数、通配符、阈值校验、两段提醒文案），Cordis 接线已删 |

标「本仓库适配层」的**不是上游文件**，不参与哈希对账，改它们不需要同步上游。

### 另一个 vendor 根：`src/shared/vendor/dsh/`

协议层的算法放在 `src/shared`，不放在本目录：唯一消费方 `src/shared/types/ai-provider.ts` 属于 shared，
而 `tsconfig.web.json` 的 paths 只有 `@shared/*` / `@renderer/*`（**没有 `@main`**），
shared 里 import `@main/*` 会让 web 侧 tsc 直接红。**宿主算法仍在本目录。**
两处文件登记在同一个 `MANIFEST.json` 里（`targetPath` 是仓库相对路径，不限定目录）。

| 路径（相对仓库根）                                 | 来源                                | 说明                                                                                                 |
| -------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/shared/vendor/dsh/llm-assembler/assembler.ts` | `packages/llm/llm/src/assembler.ts` | `BlockAssembler` 状态机（首关为准、越界 delta 忽略、max-tokens 丢工具调用、中断只留非空白正文/思考） |
| `src/shared/vendor/dsh/llm-assembler/types.ts`     | `packages/llm/llm/src/types.ts`     | 只留 text / reasoning / tool-call 与 stop / tool-calls / max-tokens                                  |

## 怎么用

- 循环内 token 估算：`src/main/services/agent-core/tokenEstimate.ts` → `token-meter/`；
- 工具结果掐头留尾：`src/main/services/agent-core/toolResultPrune.ts` → `tool-result-pruner/`；
- 模型的多步清单：`src/main/services/agent-core/todoTool.ts` → `todo/`（清单条在 `ChatPanel` 顶部）；
- 连续重复调用的提醒：`src/main/services/agent-core/repeatGuard.ts` → `repeat-tool-reminder/`（命中阈值插一条 user 提醒，不否决调用）；
- 流式组装（GLM / OpenAI 兼容 / Ollama 三家共用）：`src/shared/ai/streamAssembler.ts` → `src/shared/vendor/dsh/llm-assembler/`（把厂商帧翻成 chunk，再按上游规则取块）；
- 接线点与「为什么先剪再压」见 `docs/ai/agent-core-wiring.md` §33；流组装见 §37。

## 更新上游时的做法

1. 解压新快照到 `deepseek-harness-master/`（保持同名目录，已 gitignore）；
2. 逐文件比对 `sourcePath`，把上游改动**手工**合进 `targetPath`（不做整文件覆盖，适配改动会丢）；
3. 改 `MANIFEST.json` 的 `sourceSha256` 与 `adaptedNotes`；
4. `node scripts/vendor-audit.mjs --update` 重算 `targetSha256`；
5. `pnpm vendor:audit` 必须全绿；`docs/ai/dsh-source-adaptation-2026-10-24.md` §14 记一行。

## 合规

- 许可原文：本目录 `LICENSE`（MIT 全文 + 上游版权行），**不要改**；
- 每个被搬文件顶部有 `@upstream` 来源头（路径、tag、改了哪几处）；
- 仓库根 `THIRD_PARTY_NOTICES.md` 有整体条目（版本、取了哪些文件、改了什么）；
- 上游的提示词、人设、品牌文案、`packages/client/**`、`native/`、`packages/experimental/**` 一律**不搬**。
