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
| 恢复树 `src/*.ts(x)`              | 830 个（2026-10-24 清理 5 个 ops 副本后）                 |
| 产物模块在树里的覆盖率            | **98.3%（584/594）**                                      |
| 缺失                              | 10 个，**全部已登记理由**（未登记 0）                     |
| 树里有、产物里没有 region         | 227 个（其中 33 个是纯类型/再导出，构建后本就不留模块名） |
| 这 227 里，导出符号能在产物中搜到 | 95 个（被内联或改名，不是缺）                             |
| 真的没进过这次构建                | **99 个**                                                 |

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

## 三、Python 技术栈现状（TS-only 的落地口径）

先说结论：**运行时已经是纯 TS**。机器人运行按钮 → `botManager:start` → `botManager` 用 `FlowRuntime` 在**主进程内**解释 `.qqbat/flow.json`（ADR-003：不再生成 `bot.py`、不再 spawn Python）。

树里还剩的 Python 相关代码分四类，都**不在** TS 运行时主链路上：

| 类别                  | 位置                                                                                                                                | 说明                                                                                   | 处置                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 旧进程运行器          | `src/main/services/botProcess.ts` + `src/main/ipc/runtime.ts` 的 `runtime:*` 通道                                                   | 会 spawn `<project>/.venv/.../python bot.py`，解析 stdout 标记。界面运行按钮**不走**它 | 标记遗留，只保留协议解析（`runner/runtimeLogParser.ts` 仍被 TS 运行时复用）                 |
| Python 代码生成       | `src/main/codegen/{pythonUtils,emitterV2,expressionSafety,dataflow}.ts`                                                             | 旧 codegen 栈（生成 bot.py 用）；`flow/codegen.ts` 现输出可读 TS 快照                  | 不修、不测；对应的 17 个 Python codegen 测试已归档 `_recovery/legacy-python-codegen-tests/` |
| 部署模板              | `src/main/services/{dockerExport,sshDeploy}.ts`                                                                                     | Dockerfile/远程脚本仍写 `bot.py`、`CMD ["python","bot.py"]`                            | 导出/部署功能用得到再改；本轮不动                                                           |
| 旧 Python 脚手架/解析 | `aiNodeScaffold.ts`（跑 python 校验）、`customNodeScanner.ts`（扫 .py 插件）、`pathGuard.assertPythonPathSafe`、`schemas/python.ts` | 旧节点包模型（.py）                                                                    | `schemas/python.ts`、`renderer/.../pythonCompletions.ts` 已 0 引用，可优先删                |

所以「我没怎么用 py 了，都是 ts 技术栈」在代码里是成立的：**新的东西全 TS，Python 只剩导出/部署/旧插件包的壳**，且不再作为恢复与测试目标。

## 四、当前状态（同一份基线下的验证）

| 闸门                                | 结果                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `vitest run --maxWorkers=2`（全量） | 226 文件通过 / 3004 例通过 / 58 skip（5 文件），0 failed           |
| `tests/guards`                      | 12 文件 / 88 通过 + 2 skip                                         |
| `tsc -p tsconfig.node.json`         | src 0 错（185 行全在 tests/，历史 revision 漂移）                  |
| `electron-vite build`               | EXIT=0（main/preload/renderer 三入口）                             |
| 真机                                | 起窗、项目「还原验证项目」可选中、低代码页可编辑、console errors 0 |

测试口径（写进 `RESTORE-NOTES.md`）：测试比客户端晚 → 旧 API 漂移改测试；客户端没有的功能 skip/归档并留证；安全类缺口补实现。

## 五、剩余债（与本基准相关）

1. **112 个未进客户端构建的模块**：分类已给出，但「哪些该留、哪些该删」需要你拍板；删是不可逆的。
2. `botProcess.ts` + `ipc/runtime.ts` 的 Python 通道仍在，理论上可被旧调用触发（当前 UI 不走）。若确定要纯 TS，可把 `runtime:*` 改成只服务日志/指标。
3. 部署导出模板（docker/ssh）仍按 `bot.py` 写，和 TS 运行时不一致 —— 要么改成导出 `out/main` 运行方式，要么在 UI 上标注「旧版导出」。
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
