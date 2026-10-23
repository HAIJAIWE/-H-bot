# 逆向保真度实测（2026-10-24）

## 目的

回答一个问题：**从 2026-10-18 打包客户端（`_baseline/out-bundle`）逆向回来的源码，到底有多"像"客户端本身？**
不是"文件在不在"（覆盖率审计已做过），而是"客户端里的代码，在我们源码里能找到多少"。

## 方法

1. 从 `_baseline/out-bundle/**/*.js` 抽 `//#region src/...` 段落，得到 **594 个客户端源模块**（含 region 原文）。
2. 对每个模块路径，在 `E:/qqbat-restored` 找同名源文件（`.tsx` / `.ts` 互试）。
3. 用 TypeScript `transpileModule` 把源码转成 JS（去类型、保留注释），剥掉 import/export 包装。
4. 计算**客户端侧召回率**：
   - `idRecall` = 客户端 region 里出现过的标识符（长度 ≥3），在源码里也出现的比例；
   - `litRecall` = 客户端 region 里的字符串字面量（长度 ≥2），在源码里也出现的比例。
5. 用召回率而不是双向 Jaccard：源码含 10/18 之后新增的代码，双向相似度会被"我们多写的部分"拖低，那不属于逆向丢失。

**已知噪声（会低估保真度）**：打包器会把小模块内联进调用方 region（如英文目录表并进 `catalog/build.ts`、zod schema 并进 config 模块），或把未用代码 tree-shake 掉（region 比源文件小很多）。这些在下面的低分项里逐条标注。

## 结果（585 个可定位模块）

| 档位 | 数量 | 占比 |
|---|---|---|
| ≥ 0.99（几乎全等） | 145 | 24.8% |
| 0.95 – 0.99 | 238 | 40.7% |
| 0.85 – 0.95 | 153 | 26.2% |
| 0.60 – 0.85 | 41 | 7.0% |
| < 0.60 | 8 | 1.4% |

- 标识符召回中位数 **0.969**；字符串字面量召回中位数 **1.000**。
- ≥ 0.95 的合计 383 / 585（65.5%）；≥ 0.85 的合计 536 / 585（91.6%）。

## 9 个没有源文件的客户端模块

| 模块 | 原因 |
|---|---|
| `src/main/services/ops/diagnostics.ts` | 重复实现，有意删除（原文在 `_baseline/out-bundle`） |
| `src/main/services/ops/metrics.ts` | 同上 |
| `src/main/services/ops/metricsExport.ts` | 同上 |
| `src/main/services/ops/auditService.ts` | 同上 |
| `src/main/services/ops/dockerExport.ts` | 同上（现役实现是带类型的 `src/main/services/dockerExport.ts`） |
| `src/main/services/ops/sshDeploy.ts` | 同上 |
| `src/main/services/project/backupService.ts` | 无调用方，未恢复 |
| `src/main/services/project/dataTransferService.ts` | 无调用方，未恢复 |
| `src/renderer/src/assets/node-authoring.md?raw` | 误报：文件存在（`src/renderer/src/assets/node-authoring.md`），是 `?raw` 后缀导致路径对不上 |

## 8 个低于 0.60 的模块（逐个解释）

| 模块 | idRecall | 原因 |
|---|---|---|
| `src/shared/nodes/catalog/build.ts` | 0.027 | 客户端把 16.6 万字符的英文目录表内联进该 region；我们的 `build.ts` 只有 4.6KB，表在独立的 `catalog.en-US.ts` 里 |
| `src/renderer/src/stores/panelDriftStore.ts` | 0.130 | 客户端把 `replyToDesc/qqWidth/cutByWidth/planPanelItems` 并进了这个 region；我们放在 `src/renderer/src/lib/panelSelection.ts`（store 本身逐字节一致） |
| `src/main/services/runner/runtimeEvents.ts` | 0.326 | 我们改成兼容再导出，唯一实现在 `src/main/services/runtimeEvents.ts`（3,688 B），避免两条导入路径各拿一套 Set |
| `src/main/ipc/runtime.ts` | 0.346 | 有意收窄：`runtime:*` 只保留 batchLog/executeNode/injectTestMessage，执行/重启/状态改走 botManager |
| `src/main/services/ai/appAiConfig.ts` | 0.467 | 客户端把 schema 内联进该 region；我们拆在 `schemas/` |
| `src/renderer/src/components/layout/FlowPanel.tsx` | 0.500 | 客户端 region 只有 136 字符（几乎全被 tree-shake），源码 219 字符 |
| `src/main/services/ai/projectAiConfig.ts` | 0.542 | 同 appAiConfig：schema 内联 |
| `src/main/schemas/flowIpc.ts` | 0.556 | 同上前提：客户端把 enum/schema 内联进调用方 |

结论：**没有发现"某块功能代码整段丢失"的模块**；低分全部由"搬家 / 内联 / 有意收窄 / tree-shaking"造成。

## 重跑方式

- 临时把 `electron.vite.config.ts` 三段 `build.minify` 设为 `false` 再 build，产物会带 `// src/...` 注释（当前 Vite 8 输出的是单行注释，不是客户端的 `//#region`）；比对脚本思路见上方方法。
- 比对结果原始数据：`_recovery/fidelity-src2.json`（每模块 idRecall/litRecall/客户端标识符数）。

## 边界

- 这是"源码 vs 客户端产物"的相似度，不是二进制逐字节比较；
- 类型被擦除，无法比对，只能保证"可编译"；
- 客户端 8497 个 asar 条目里绝大多数是 node_modules，不在本测试范围。
