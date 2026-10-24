# 恢复基准核对：以打包客户端为准（2026-10-24）

对象：`D:\H Bot 制造`（2026-10-18 04:50 打的 Windows 客户端）。它的 `resources/app.asar` 是 本仓库（恢复树）的**主要来源**，也是本轮确认的**恢复基准**：

> 源码行为以打包客户端为准；磁带（DSH 会话）里更晚 revision 的测试只作参考，不反过来驱动恢复。

本文回答三件事：①产物里的模块，树里到底齐不齐；②树里哪些模块**没进过这次构建**（= 更晚的增量 / 更早的遗留）；③Python 技术栈现在处于什么状态。

## 一、覆盖率（可复算）

工具：`scripts/audit-baseline.mjs`（新增）。打包产物里每个参与构建的模块都带一条 `//#region src/...` 注释，因此 region 集合 = 那次构建真正装进去的模块清单。

```powershell
cd <仓库根目录>
node scripts/audit-baseline.mjs           # 摘要 + 写 docs/restore/baseline-inventory.json
node scripts/audit-baseline.mjs --check    # 有「未登记的缺失」就 exit 1（可挂 CI）
```

实测（2026-10-24）：

| 指标                              | 数值                                                      |
| --------------------------------- | --------------------------------------------------------- |
| 打包产物 js                       | 25 个 / 5.6 MB（main 24 + renderer index）                |
| 产物模块清单（region 去重）       | **594 个**                                                |
| 恢复树 `src/*.ts(x)`              | 812 个（2026-10-24 依次清理 5 个 ops 副本、2 个翻译器、4 个 NapCat 模块、12 个 Python 旧栈 .ts 后） |
| 产物模块在树里的覆盖率            | **98.3%（584/594）**                                      |
| 缺失                              | 10 个，**全部已登记理由**（未登记 0）                     |
| 树里有、产物里没有 region         | 209 个（其中 33 个是纯类型/再导出，构建后本就不留模块名） |
| 这 209 里，导出符号能在产物中搜到 | 83 个（被内联或改名，不是缺）                             |
| 真的没进过这次构建                | **93 个**                                                 |

缺的 10 个（`--check` 里逐条写明了理由，`MISSING_OK`）：

| region                                                    | 为什么可以没有                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/main/services/ops/metricsExport.ts`                  | 10/18 原文副本，真源是扁平 `services/metricsExport.ts`；0 importer，已删                               |
| `src/main/services/ops/auditService.ts`                   | 10/18 原文副本，真源是扁平 `services/auditService.ts`（ipc/launchAudit 导入）；0 importer，已删         |
| `src/main/services/ops/diagnostics.ts`                    | 10/18 原文副本，真源是扁平 `services/diagnostics.ts`；0 importer，已删                                 |
| `src/main/services/ops/dockerExport.ts`                   | 10/18 原文副本；已移植为带类型 `services/dockerExport.ts`（5 例单测）；0 importer，已删                 |
| `src/main/services/ops/metrics.ts`                        | 10/18 原文副本，真源是扁平 `services/metrics.ts`（ipc/metrics 导入）；0 importer，已删                 |
| `src/main/services/ops/sshDeploy.ts`                      | 10/18 原文副本；已移植为带类型 `services/sshDeploy.ts`；0 importer，已删                               |
| `src/main/services/project/backupService.ts`              | 10/18 原文副本，真源是扁平 `services/backupService.ts`；0 importer，已删                               |
| `src/main/services/project/dataTransferService.ts`        | 10/18 原文副本，真源是扁平 `services/dataTransferService.ts`；0 importer，已删                         |
| `src/renderer/src/components/blocks/useEditorActions.tsx` | 真身是 `useEditorActions.ts`（纯 hook，无 JSX）                                                        |
| `src/renderer/src/assets/node-authoring.md`               | `?raw` 伪模块；真身 md 已从同一产物提取写回                                                            |

结论：**产物里能还原的模块一个都没缺**；10 个缺口里 8 个是「同一职责两份实现」中没有 importer 的副本
（其中 5 个 `ops/` 副本是 2026-10-24 第二轮清理删掉的；`ops/crashReporter.ts` 因被 `ops/crashLogger.ts`
相对 import 而保留，首轮误删后由 build 的 `UNRESOLVED_IMPORT` 抓出并恢复），另 2 个是扩展名 / `?raw` 伪模块，真身都在。

**体量核对**（同一脚本顺手做）：把每个 region 的代码字符数与树里同名文件比对，只有 4 处「树文件 < region 的 70%」，逐个看过，都不是截断：

| 文件                                         | region / 树     | 原因                                                                                                                  |
| -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/shared/nodes/catalog/build.ts`          | 168,655 / 5,677 | 产物把整张节点目录**数据**内联进同一 region；树里是代码 + 独立数据文件                                                |
| `src/main/services/runner/runtimeEvents.ts`  | 2,093 / 662     | 树里是**门面**（真源 `services/runtimeEvents.ts`），产物是同 region 内联实现                                          |
| `src/main/ipc/runtime.ts`                    | 7,652 / 2,621   | 本轮**有意收窄**：`runtime:*` 只留观测（batchLog / executeNode / injectTestMessage），执行/重启/状态全改走 `botManager`；产物里那 7.6K 是旧的 Python 运行器通道 |
| `src/renderer/src/stores/panelDriftStore.ts` | 2,971 / 1,681   | 产物把面板规划助手（`qqWidth`/`cutByWidth`/`planPanelItems`）放在同 region；树里已拆到 `lib/canvas/panelSelection.ts` |

结论：**没有发现新的截断**（此前 ChatPanel 那类「后半段丢失」的问题已不复存在）。

## 二、112 个没进过 10/18 构建的模块

逐条清单在 `docs/restore/baseline-inventory.json` 的 `delta.unshippedFiles`。按工程判断分两类（产物只能证明「没进这次构建」，不能证明是谁加的，所以这是分类不是铁证）：

### 2.1 10/18 之后的增量（丢失的工作树里更晚的代码）

| 区域                                     | 数量 | 内容                                                                                                                                                |
| ---------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/services/agent-core/**`        | 10   | 单循环引擎：core/model/prompt/runTurn/modelAdapter/scheduler/sandbox/legacyTools/adapters/…                                                         |
| `src/main/services/ai/**`                | 12   | presets、allowRules、lanes、scout、planner、readOnlyRoute、instructionBridge、contextDigest、summaryLlm、codeSnippet、inboxStore、legacyToolAdapter |
| `src/main/services/plugins/**`           | 12   | 新插件内核：host/layers/defaults/builtinHostPlugins/scoping/market/aiPluginLoader/沙箱桥…                                                           |
| `src/main/ipc/**`                        | 3    | aiAgentCore、aiAllowRules、aiInstruction                                                                                                            |
| `src/shared/{plugins,protocol,ai,agent}` | 7    | 插件身份/版本/清单、指令回执协议、工具失败分类、作者画像                                                                                            |
| `src/renderer/src/components/ai/** 等`   | 31   | AgentTranscript、轨迹面板、TurnChangesCard、PresetSelect、MessageActions、插件市场页…                                                               |

这些就是「智能体/插件」方向的增量。按你的要求，**本轮不再往这边做**，也不拿它们当恢复基准；它们留在树里是因为它们属于你丢失工作树里的真代码（测试也在测它们）。

### 2.2 更早 revision 的遗留（客户端构建时已被裁掉）

| 区域                                                                                                                                   | 内容                                         | 状态                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `src/main/schemas/{python,napcat,napcatDownload,templates,launchAi,linter}`                                                            | 旧 Python/NapCat/模板市场的 IPC 参数表       | 无 importer 或只服务旧通道                           |
| `src/main/services/{napcat,napcatDownloader,segmentTranslator,messageQueue,benchmark,configTemplateService}`                           | NapCat 下载/启动、消息队列、评测、配置表模板 | 运行时不挂主链路                                     |
| `src/main/templates/**`（8 个）                                                                                                        | 内置流程模板数据                             | 客户端把模板数据内联，没留模块名；树里这份是数据资产 |
| `src/main/{nodes/aiToolCall,nodes/compat}`                                                                                             | v3 节点（ai_tool_call）与 v2 兼容层          | 已被 v4 目录取代                                     |
| `src/renderer/src/pages/ProjectSelector.tsx`、`components/project/ProjectCard.tsx`                                                     | 旧项目选择页                                 | 全树 0 引用（开机走 Workspace）                      |
| `src/renderer/src/**/pythonCompletions.ts`、`NapCatConfigDialog.tsx`、`TemplateMarket.tsx`、`ResourceLimits.tsx`、`DebuggerPanel.tsx`… | 旧 UI 挂件                                   | 无挂载点                                             |

处置原则：**不删**（它们是你工作树的一部分，删了不可逆），但在文档里标为遗留；后续要做「瘦身」时按这张表逐项确认再删。

## 三、Python 技术栈：已收敛（2026-10-24）

先说结论：**树里不再有 Python 运行 / 生成 / 部署代码**。机器人运行按钮 → `botManager:start` → `botManager` 用 `FlowRuntime` 在**主进程内**解释 `.qqbat/flow.json`（ADR-003：不生成 `bot.py`、不 spawn Python）；部署侧也换成 Node 运行时（`services/deploy/runtimeBundle.ts` 复制 `out/main`，`dockerExport.ts` 写 `CMD ["node","/app/runtime/standalone.js","/app"]`，`sshDeploy.ts` 的 `mode: 'node'` 远程直接跑 Node）。

本轮按「10/18 产物里 0 命中就删」清掉的旧栈（12 个 .ts + 模板/资产）：

| 类别               | 删掉的东西                                                                                                                        | 真源在哪                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 旧进程运行器       | `src/main/services/botProcess.ts`、`services/dashboardService.ts`                                                              | `botManager` + `services/project/dashboardService.ts`                                      |
| 旧 codegen         | `codegen/pythonUtils.ts`、`codegen/emitterV2.ts`、`schemas/python.ts`、`schemas/pythonDebugger.ts`                          | `codegen/{typescriptUtils,emitters,expressionSafety,dataflow}.ts`                          |
| 旧节点模型         | `services/{customNodeScanner,aiGeneratedScanner,aiNodeScaffold,forkNode}.ts`、`renderer/.../pythonCompletions.ts`              | `services/plugins/{customNodeScanner,aiGeneratedScanner,customNodeScaffold}`、`services/flow/forkNode.ts` |
| 根 pluginLoader    | `src/main/services/pluginLoader.ts`                                                                                             | `services/plugins/pluginLoader.ts`                                                          |
| 模板 / 资产        | `src/main/templates/highcode-template/`、`src/nonebot_plugins/`                                                                | 无（Python 时代产物）                                                                        |

还留着的 Python 字样只有**语义兼容**，不含 Python 执行：

| 位置                                                         | 为什么留                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/shared/nodes/pyToJs.ts`、`runtime/safeEval.ts`        | 用户表达式仍是 Python 风格（`A if C else B`、`True/False`、`and/or/not`），翻译成 JS 执行 |
| `codegen/expressionSafety.ts` 的正则与注释                  | 与历史 Python 安全表**判据同源**，避免两套「安全」定义漂移                                 |
| `shared/types/project.ts` 的 `pythonPath?`、`schemas/project.ts:103` | 老项目存档字段，读写保留以免把用户配置剥掉                                                |
| 注释里的历史说明                                             | 解释「节点事件原由 Python 打印标记」这类迁移背景                                          |

部署侧的 `adapter === 'napcat'` 兼容分支（Dockerfile 里的 NapCat 下载、start.sh 双进程、compose volume、`includeNapcat` 开关、`.env` 的 `NAPCAT_QQ`）已于 2026-10-24 **彻底删除**：`DeployAdapter` 只剩 `'official'`，部署 schema 只接受 `z.enum(['official'])`。项目类型侧同步删掉 `AdapterType` 的 `'napcat'`、`NapcatConfig` / `NapCatConfig` 两个接口、`ProjectConfig.napcat` 字段与 `createProjectSchema` 的 napcat 块；`tests/guards/noNapcat.test.ts` 锁住这些能力面不再回来。

## 四、当前状态（同一份基线下的验证）

| 闸门                                | 结果                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `vitest run --maxWorkers=2`（全量） | 231 文件通过 / 2933 例通过 / 10 skip（4 文件），0 failed           |
| `tests/guards`                      | 14 文件 / 101 通过（含写闸门序列调用正控、NapCat/OneBot 删除守卫） |
| `node scripts/typecheck.mjs`        | node **0 错** / web **0 错**                                       |
| `electron-vite build`               | EXIT=0（main/preload/renderer 三入口）                             |
| 真机                                | 起窗、项目「还原验证项目」可选中、低代码页可编辑、console errors 0 |

测试口径（写进 `RESTORE-NOTES.md`）：测试比客户端晚 → 旧 API 漂移改测试；客户端没有的功能 skip/归档并留证；安全类缺口补实现。

## 五、剩余债（与本基准相关）

1. **93 个没进过 10/18 构建的模块**：分类已给出，但「哪些该留、哪些该删」需要你拍板；删是不可逆的。
2. ~~`botProcess.ts` + `ipc/runtime.ts` 的 Python 通道~~ —— **已解决**：`botProcess.ts` 已删，`runtime:*` 只剩观测（batchLog / executeNode / injectTestMessage）。
3. ~~部署模板按 `bot.py` 写~~ —— **已解决**：docker/ssh 都改成 Node 运行时（`services/deploy/runtimeBundle.ts`）。
4. `tests/` 侧 185 行 tsc 诊断（历史 revision 漂移，运行期已绿）。
5. 5 个 skip 测试文件（multi-agent、plan_task、需真实 API Key 的 e2e、官方能力清单文档对账、基线冒烟）。
6. **格式化闸门缺配置**：原工作树的 `.prettierrc` 没有恢复回来，`prettier --check` 按默认配置对整棵树都不合格（连没动过的 `src/main/index.ts` 也是 warn）。要不要补一份 `.prettierrc` 再一次性 `prettier --write src/` 需要你拍板 —— 那会是几千文件的 diff，且没有 git 兜底。

## 六、一个必须写明的偏差：renderer 有 93 个模块来自 10/20 Vite 缓存

打包客户端是 10/18 04:50 构建的；但本机 Electron userData 里留下了 **10/20 的 Vite 开发缓存**（`C:/Users/Administrator/AppData/Roaming/qqbat/Cache/Cache_Data`），缓存里带 inline sourcemap，`sourcesContent` 是**原始 TS/TSX**（带类型、带 JSX）。

- 已从缓存取回 **93 个 renderer 组件原版**（清单 `_recovery/vite-cache-meta.json`，文件在 `_recovery/vite-src/`，最早 10/19、最晚 10/20 14:57）。
- 这些文件**比客户端新**，但比磁带里的 revision 旧；当三者不一致时，优先级是：**缓存原版（有类型）> 产物 region（逻辑对、类型被剥）> 磁带重放（易写坏）**。
- 影响：`src/renderer/src/components/**` 里有一部分 UI 是 10/20 的形态（例：`ChatPanel.tsx` 缓存版 58,915 字符，而 10/18 产物只有编译后形态）。这是「恢复质量」与「严格对齐客户端」之间的已知取舍，写在这里避免以后把差异误判成 bug。

## 七、基准产物随仓库保管（`_baseline/`）

恢复的唯一权威基准是 2026-10-18 那个打包客户端。它原先只存在于本机 `D:/tmp`，现在整份收进仓库 `_baseline/`，换机器/清临时目录都不会丢：

| 内容 | 大小 | 说明 |
| --- | --- | --- |
| `_baseline/app.asar.bin` | 74,277,199 B | `D:\H Bot 制造\resources\app.asar` 原样备份，sha256 `9bf9e6263d2381826c32afebb557b63cb3972e4e81aae0c5afa1ffe2d6fb7b19` |
| `_baseline/out-bundle/` | 5,833,371 B / 25 文件 | 从 asar 解出的 `out/`（main 24 + renderer index），即 `//#region` 的来源 |
| `_baseline/manifest.sha256` | — | 26 条校验和 |
| `_baseline/README.md` | — | 出处、用法、只读纪律 |

`scripts/audit-baseline.mjs` 的默认基准已改为「先看 `_baseline/out-bundle/`，没有才回退 `D:/tmp/hbot-out`」，所以本文所有数字都可以只靠仓库复算。

## 八、怎么复核这份文档

```powershell
cd <仓库根目录>
node scripts/audit-baseline.mjs --check        # 覆盖率与缺失登记
node node_modules/vitest/vitest.mjs run --root . --maxWorkers=2 tests/guards
node node_modules/electron-vite/bin/electron-vite.js build
```

补充文档：`RESTORE-NOTES.md`（来源与操作手册）、`docs/restore/asar-salvage-2026-10-23.md`（客户端清点与打捞）、`docs/restore/baseline-inventory.json`（机器可读清单）。
