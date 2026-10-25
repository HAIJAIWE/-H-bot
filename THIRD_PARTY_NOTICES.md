# 第三方代码与许可

本仓库自己的代码按 `LICENSE`（AGPL-3.0-or-later）发布。下面这些**搬进来的第三方代码**
保留各自原许可，原许可全文随代码放在对应目录里。

## DeepSeek Harness（MIT）

| 项                   | 值                                                                              |
| -------------------- | ------------------------------------------------------------------------------- |
| 项目                 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| 版本 / tag           | `0.2.1-rc.3` / `dsh-v0.2.1-rc.3`                                                |
| 许可                 | MIT，`Copyright (c) 2026 DeepSeek`                                              |
| 许可全文             | `src/main/vendor/dsh/LICENSE`                                                   |
| 搬运清单与逐文件哈希 | `src/main/vendor/dsh/MANIFEST.json`                                             |
| 来源与适配说明       | `src/main/vendor/dsh/README.md`                                                 |
| 改了什么             | 见 MANIFEST 每个条目的 `adaptedNotes` 与该目录 README                           |
| 搬运日期             | 2026-10-25                                                                      |

取了哪些文件：

- `packages/llm/token-meter/src/estimate.ts` → `src/main/vendor/dsh/token-meter/estimate.ts`（固定密度启发式 token 定价）
- `packages/compaction/compaction-tool-result-pruner/src/config.ts` → `src/main/vendor/dsh/tool-result-pruner/config.ts`（剪枝预算校验、标记、默认值）
- `packages/compaction/compaction-tool-result-pruner/src/types.ts` → `src/main/vendor/dsh/tool-result-pruner/types.ts`（配置类型）
- `packages/compaction/compaction-tool-result-pruner/src/index.ts` → `src/main/vendor/dsh/tool-result-pruner/prune.ts`（`measureContent` / `pruneContent` 两个纯函数）
- `packages/todo/tool-todo/src/types.ts` → `src/main/vendor/dsh/todo/types.ts`（清单条目与三态类型）
- `packages/todo/tool-todo/src/index.ts` → `src/main/vendor/dsh/todo/todo-list.ts`（工具描述、`toTodoList` 校验、计数与回执文案）
- `packages/guard/repeat-tool-reminder/src/index.ts` → `src/main/vendor/dsh/repeat-tool-reminder/detector.ts`（重复调用检测：规范化参数、通配符、阈值校验、两段提醒文案）
- `packages/llm/llm/src/assembler.ts` → `src/shared/vendor/dsh/llm-assembler/assembler.ts`（流组装状态机：首关为准、截断丢工具调用、中断只留正文/思考）
- `packages/llm/llm/src/types.ts` → `src/shared/vendor/dsh/llm-assembler/types.ts`（内容块 / 结束原因 / 用量类型）
- `packages/core/tools/src/batch.ts` → `src/main/vendor/dsh/tool-batch/batch.ts`（一批调用的调度结构：独占屏障、有界池、启动前重分类、有序提交、取消补合成结果）
- `packages/util/output-retention/src/index.ts` → `src/main/vendor/dsh/output-retention/index.ts`（`ItemRetainer` / `TextRetainer`：条目上限与字节流头尾窗口，UTF-8 边界安全；上游的英文省略提示文案未搬）
- `packages/llm/llm/src/retry-policy.ts` → `src/shared/vendor/dsh/llm-retry/retry-policy.ts`（重试策略解析：键白名单、默认值、冻结；schemastery 的 `z` 已删）
- `packages/llm/llm-retry/src/index.ts` → `src/shared/vendor/dsh/llm-retry/delay.ts`（指数退避 + 对称抖动、可取消 sleep；新增 `plannedRetryDelay` = 上游 `recover` 里的 Retry-After 判断）
- `packages/spill/spill-local/src/store.ts` → `src/main/vendor/dsh/spill-local/store.ts`（目录 0700 / 文件 0600、`wx` 独占创建、文件名分段编码、`session-<sha256 前缀>` 子目录；tmpdir 默认根已删）
- `packages/spill/spill-local/src/cleanup.ts` → `src/main/vendor/dsh/spill-local/cleanup.ts`（过期清扫：只删超期普通文件、不跟随链接、逐级校验目录属主/权限；默认根发现已删）

改动原则（详见设计文档 `docs/ai/dsh-source-adaptation-2026-10-24.md` §0 / §2）：

1. **去 Cordis 化** —— 不引入上游服务树，`extends Service`、`static inject`、`ctx.*`、
   `session.append(...)` 一律不搬；只搬与运行时无关的纯算法。
2. 每个被搬文件顶部有 `@upstream` 来源头（路径 + tag + 逐条改动）。
3. 上游的提示词、人设、品牌文案、`packages/client/**`、`native/`、`packages/experimental/**`
   一律不搬。
4. `pnpm vendor:audit` 会重算每个目标文件的 sha256（上游快照在时连源文件一起对）；
   想手改搬来的算法，必须同时改 MANIFEST 的 `adaptedNotes` 并跑 `--update`。
