# QQ bat 源码恢复说明（RESTORE-NOTES）

本仓库是从 2026-10-18 打包产物 + 本机 Vite 开发缓存 + DSH 会话磁带里**重建出来的可构建源码树**。原工程 `D:\QQ bot` 已丢失（空目录、无 .git）。

目标只有一个：先恢复成能编译、能启动、能建项目、能编辑流程的工程，再谈补功能。

## 当前状态（2026-10-23 22:0x）

- 构建：`electron-vite build` 成功。清理掉恢复期 tsc 写进 `out/` 的 1558 个垃圾文件后，现在 `out/` 106 个文件（`out/main` 9 个）。
- 启动：Electron 能起窗口，主进程无未捕获异常（只有 [errorMonitoring] 未配 SENTRY_DSN 的提示）。
- 业务：左上项目下拉能选中项目；Bot 管理列出项目；「低代码」页能走「新建指令」向导 → 生成 2 节点 1 连线并落盘 `.qqbat/flow.json`；「布局」后节点不叠压；git 自动初始化并出现 `master (1 提交)`。
- 规模：src 下 **813 个 .ts/.tsx（含 2 个 .d.ts）/ 182,875 行**（2026-10-24 清理死代码、重复翻译器、NapCat 全链路与 Python 旧栈后，逐文件计数）；`[[MISSING` 标记 0 处；**213 个文件首行带 `// @ts-nocheck`**（见「已知债」）。
- 测试：**全绿**（2026-10-24 清掉 OneBot 用户可见面后复跑）。`vitest run --maxWorkers=2` → **232 文件 / 2938 例通过**，4 文件 / 10 例 skip（0 failed，2948 例）；guards 14 文件 / 102 通过。
- 类型检查（2026-10-24 **已清零**）：`node scripts/typecheck.mjs` → node **0 错**（原 161，全在 `tests/`）、web **0 错**（原 286）；`src/main` / `src/renderer` 均干净。注意树里仍有 213 个 `// @ts-nocheck` 文件（见「已知债 1」），闸门覆盖的是其余文件；`electron-vite build` 走 rolldown 不做类型检查，所以以该脚本为准。明细与修法见 `docs/restore/client-diff-audit-2026-10-24.md` §八。

## 恢复基准（2026-10-24 定）

- **基准 = 打包客户端**（`D:\H Bot 制造`，2026-10-18 04:50 的 `resources/app.asar`）。源码行为以它为准；DSH 磁带里更晚 revision 的测试只作参考，不反过来驱动恢复。
- 基准产物已随仓库保管：`_baseline/app.asar.bin`（74,277,199B，sha256 `9bf9e626…fb7b19`）+ `_baseline/out-bundle/`（25 文件 / 5,833,371B）+ `manifest.sha256`；`scripts/audit-baseline.mjs` 默认优先用它，缺了才回退 `D:/tmp/hbot-out`。
- 覆盖率可复算：`node scripts/audit-baseline.mjs`（产物 594 个模块 / 树 813 文件覆盖 98.3%（584/594），缺的 10 个全部登记了理由；2026-10-24 又删掉 5 个无 importer 的 ops 副本、2 个重复翻译器副本、4 个 NapCat 遗留模块、12 个 Python 旧栈 .ts）；`--check` 会在出现未登记缺失时 exit 1。明细 `docs/restore/baseline-inventory.json`，报告 `docs/restore/baseline-alignment-2026-10-24.md`。
- 树里另有 94 个模块**没进过这次构建**（= 10/18 之后的增量或更早的遗留），已分类但**不删**；`agent-core` / 插件内核 / presets 等增量按用户要求暂停推进。
- **TS-only 口径**：运行时是 `botManager` + `FlowRuntime` 进程内解释 `flow.json`（ADR-003），不 spawn Python。2026-10-24 已把 Python 旧栈（botProcess、pythonUtils/emitterV2、schemas/python*、旧手架/扫描、highcode 模板、nonebot 资产）整批删除，部署也改 Node 运行时；树里只剩 `pyToJs`/`safeEval` 这类**表达式语义兼容**与老项目存档字段。
- **翻译器只有一套**：`src/main/services/runner/eventBus.ts`（`/runtime/ws`，10/18 基线的真实宿主）。恢复期另建的 `onebot-translator.ts` / `officialExtras.ts` 在基线里 0 region，已删除；`ipc/official.ts`、`ipc/runtime.ts`、`dashboardService.ts` 全部改接 eventBus。
- **内部命名（2026-10-24）**：运行时事件契约与网关动作名全部改成项目自己的口径（`RuntimeEvent` / `RuntimeMessage` / `ROLE_LEVELS`，动作名 `send_message`、`send_group_message`、`delete_message` …），用户可见面再无第三方协议名。存量 `flow.json` 里的旧动作名（`send_msg` / `send_group_msg` / `delete_msg` 等 7 个）由 `src/main/services/translator/actions/aliases.ts` 的 `LEGACY_ACTION_ALIASES` 在网关入口归一化，不改磁盘数据。
- 取舍：renderer 有 93 个组件取自 10/20 的 Vite 开发缓存（带类型的原版），比客户端新；优先级 缓存原版 > 产物 region > 磁带重放。

## 源码的四类来源（判断一个文件可信度先看头注释）

1. **Vite dev 缓存原版（最可信）** —— 本机 `C:\Users\Administrator\AppData\Roaming\qqbat\Cache\Cache_Data\` 里 Chromium 缓存存的是 **Vite 转换后的 ESM 源码**，大量 `f_*` 块带 inline sourcemap，`sourcesContent` 就是原始 .tsx/.ts（带类型、带 JSX）。已导出 93 个文件到 `_recovery/vite-src/`，清单 `_recovery/vite-cache-meta.json`。
2. **10/18 生产包 region 移植** —— `D:\tmp\hbot-out\out\main\*.js` 与 `renderer-index.js` 未压缩、按 `//#region src/...` 分块，可整段搬回。凡头注释写「本文件从 10/18 编译产物还原」的（236 个文件）属此类：**逻辑真、类型假**（类型被剥掉，注解是后来补的/或干脆没有）。
3. **旧基线 + 磁带重放** —— Trae CN 本地历史（最新只到 2026-09-22）+ DSH 会话磁带（`E:/qqbat-tapes/*.jsonl`、`_recovery/live-session.jsonl`）里的 read/write/edit 事件。重放器在 `_recovery/replay-file.mjs`（用 TS 编译器 parse 每步快照做校验），产物在 `_recovery/replayed/`。**注意**：旧重放脚本有个致命 bug——把「局部读」整段覆写进行号，版本漂移时写坏文件；本轮损坏就是它造成的，不要再用老脚本。
4. **按消费方重建** —— 模块整体丢了、只剩 import 痕迹时，按调用方签名 + 产物 region 反向重建（如 `src/shared/types/runtime.ts`、`src/shared/types/pagination.ts`、`src/shared/types/buttonPanel.ts`、`src/main/ipc/file.ts`、`src/main/ipc/customNode.ts`、`src/main/schemas/project.ts`）。头注释会写清依据。

## 构建 / 运行 / 验证

```powershell
cd <仓库根目录>
node node_modules/electron-vite/bin/electron-vite.js build *> _recovery/build-full.txt   # 看 EXIT 与 error during / PARSE_ERROR / UNRESOLVED_IMPORT / MISSING_EXPORT
```

主进程有**三个构建入口**（`electron.vite.config.ts` 的 `main.build.rollupOptions.input`）：`index`（桌面）、`standalone`（Docker/SSH headless，`node out/main/standalone.js <project>`）、`untrustedWorker`（不可信节点沙箱，`child_process.fork`）。少一个都是运行期才炸。

启动有三个必踩的坑：

1. **必须 `Remove-Item Env:ELECTRON_RUN_AS_NODE`** —— 这个环境变量常驻，否则 electron 以 Node 身份跑，`@sentry/electron` 报 `Cannot read properties of undefined (reading 'getAppPath')`。
2. **单实例锁** —— 先杀 `Get-Process electron | Where-Object { $_.Path -like "$PWD\*" }`，否则新进程直接「已有实例在运行」退出。
3. **要拿 stderr 就别用后台作业前台跑** —— 后台跑只会拿到 exit 0。用 `Start-Process ... -RedirectStandardOutput _recovery/run-out.txt -RedirectStandardError _recovery/run-err.txt` 分离启动，再 sleep 13 秒探活。

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList @('.','--remote-debugging-port=9223','--user-data-dir=_recovery\userdata') -RedirectStandardOutput _recovery\run-out.txt -RedirectStandardError _recovery\run-err.txt
```

CDP 探针（都放在 `_recovery/`，可直接复用）：`cdp-probe.mjs`（URL/title/#root/截图/console 错误）、`cdp-state.mjs`（botManager.list / listRecent）、`cdp-ui.mjs`（点页签）、`cdp-newcmd.mjs` + `cdp-fillcmd2.mjs`（走新建指令向导）、`cdp-layout.mjs`（点「布局」并量节点几何）。

## 已经清掉的运行时崩溃（按出现顺序，都是 porter 把打包壳当源码留下的）

1. `zod.z.*` 373 处 —— 16 个文件写着 `import { zod } from 'zod'` 却用 `zod.z`；统一改成仓库通用的 `import { z } from 'zod'`。
2. `require_<chunk>.<member>` 934 处 / 99 个文件 —— 打包器的 chunk 命名空间不是模块；脚本 `_recovery/rewrite-require.mjs` 按「谁 export 了这个名字」重新归属并补 import（删 82 处 `init_*.init_*()`、841 处去前缀、补 14 条 import、0 未解析）。
3. `import { node_path } from 'node:path'` 一类内建命名空间当命名导出 —— 75 个文件 151 条 import 改成 `import * as`。
4. `var init_dataService = __esmMin(...)` 惰性初始化 —— 函数声明提升 vs var 不提升，导致 `TypeError: init_dataService is not a function`；`dataService.ts` / `schemaService.ts` 改成 `let xInited = false; function init_x() { if (xInited) return; xInited = true; ... }`。
5. `fs_promises` 别名 import —— 26 个文件改成 `import * as fs_promises from 'node:fs/promises'`。
6. **两个 BotManager 单例** —— 旧 `src/main/services/botManager.ts`（NapCat 时代）与 10/18 版 `src/main/services/bot/botManager.ts` 各 `new` 一个；IPC 查旧实例（baseDir 配置没生效）→ 永远返回空列表、顶栏「未选择」。旧文件已改成 9 行门面 `export { BotManager, botManager } from './bot/botManager'`。
7. `file:*` / `customNode:*` 一组通道缺失 —— 树里是旧 revision 的 IPC；按产物 region 重写 `src/main/ipc/file.ts`（含 devMode 的 fail-closed）与 `src/main/ipc/customNode.ts`（scan/scanAiGenerated/watch/unwatch/fork + 以 pluginsDir 为 key 的 watchers）。
8. 项目 schema 停在 NapCat 时代 —— `adapter` 枚举还是 `napcat|official`、`botType` 还是 `functional|game`，新建项目被 Zod 拒（渲染层只看到 `{ok:false}`）。按 10/18 产物重写 `src/main/schemas/project.ts`（adapter: official/lark/dingtalk，botType: qq/general/game，+ lark/dingtalk/ai 块），`src/shared/types/project.ts` 同步（napcat 类型/字段已于 2026-10-24 随 NapCat 能力一并删除）。
9. 向导生成的节点叠压 20px —— `blockEditorModel.placeNewNodesBelow` 写死 `x: 40 + i * 300`，而卡片宽 `NODE_WIDTH=320`；改成 `40 + i * (NODE_WIDTH + NEW_NODE_GAP)`（NEW_NODE_GAP=80）。

## 测试恢复的判定原则（2026-10-24 定）

tests 来自磁带里**更晚**的 revision（10/18–10/23），src 是 10/18 04:50 的 asar 构建。所以测试失败不一定是我们恢复坏了：

- **旧节点名/旧 API 漂移**（`on_message`→`message_received`、`send_message`→`message_send`、`switch_case`→`branch_switch`；`@main/services/ai/tools`→`/tools/defs`；`getByRole('button')`→`'combobox'`）→ **改测试**。
- **测的是本构建没有的功能**（Python codegen 旧栈、multi-agent 侦察链、plan_task、模板市场页）→ **整文件 skip 或移到 `_recovery/legacy-*`**，并在文件头/README 写明取证（是否出现在 10/18 两个 bundle 里）。
- **安全类缺口**（P0 风险层、MCP 等回执、停止按钮不停循环、trace 缺 turnId、额度记账只有读侧、插件包类型闸门）→ **补实现**，不缩小断言。
- 断言过严的（ELK 链首坐标恰好 {0,0}）→ 改成测「真的被摊开了」。

## 已知债（按优先级）

1. **223 个文件 `// @ts-nocheck`** —— 从产物还原时加的，等于把类型错误藏起来了。清理办法：把标记临时改成 `// @ts-nocheck-disabled`，跑 `tsc -p tsconfig.recover.json`，按 TS2304（真会崩）/ TS2339 / TS7006 的顺序收敛。已经做过一轮：4616 行诊断里 TS2304 只有 154 条，已全部补 import。
2. ~~**tests/ 与新 API 脱节**~~ —— **已清（2026-10-24）**：`node scripts/typecheck.mjs` 两个 tsconfig 都是 0 错。做法是「生产侧签名按真实契约放宽 + 测试侧补注解/元组 mock + 重建缺失共享类型」，没有缩小断言；逐类明细见 `docs/restore/client-diff-audit-2026-10-24.md` §八。
3. **两套 codegen 栈并存** —— `src/main/services/codegen.ts`（319 行，产 Python 的旧实现）与 `src/main/services/flow/codegen.ts`（84 行，写 `src/plugins/generated/flow.generated.ts` 的 CodegenService）。`src/main/codegen/dataflow.ts` 同时被两边用（Python 侧 pythonLiteral、TS 侧 tsLiteral/ctx.flowVars）。短期以补导出保编译，语义收敛另开一单。
4. **`src/shared/domain/index.ts` 是死 barrel** —— 全仓 0 引用，指向不存在的 ai/config/ui 子目录。
5. **`src/main/services/logger.ts` 只是兼容门面** —— 真实现在 `src/main/services/infra/logger.ts`（163 行）。
6. **通道静态审计会误判** —— 能力目录 260 个 channel vs 静态扫出 293 条，差集 36 条里大多是 `webContents.send` 事件（`ai:proposal`、`*:statusChanged`、`resourceMonitor:*`），不能当缺失。
7. **IPC 注册顺序/单例** —— `registerFileIpc(baseDir)`、`registerCustomNodeIpc(baseDir?)` 都显式传 baseDir；新增通道记得同时改 `src/main/ipc/register.ts` 与 `src/preload/index.ts`（两处签名不一致时渲染层只会拿到 undefined）。

## 恢复脚本清单（`_recovery/`）

- `replay-file.mjs` / `replay-verify.mjs` / `replay-diag.mjs`：磁带重放与逐点校验（按时间把当时的 read 行与重放状态比对）。
- `rewrite-require.mjs`：把 `require_<chunk>` 命名空间改回真模块导入。
- `analyze-renderer-events.mjs`：统计每个文件在磁带里被全量读/局部读/写的次数——决定能不能从磁带重建。
- `cache-source-index.json`：扫全部缓存块 sourcemap 得到的「路径 → 最长原文」索引（MISSING_EXPORT 修复靠它）。
- `cdp-*.mjs`：上面那批 CDP 探针。
- `build-full.txt` / `run-out.txt` / `run-err.txt` / `tsc-*.txt`：每次闸门的原始输出。
- `asar-audit.json`：打包客户端（`D:\H Bot 制造\resources\app.asar`）region 抽取与逐文件比对结果；清点结论见 `docs/restore/asar-salvage-2026-10-23.md`。

## 客户端差异审计（2026-10-24）

以 `D:/H Bot 制造`（及 `_baseline/app.asar.bin`）为基准做了一次逐项审计，明细见
`docs/restore/client-diff-audit-2026-10-24.md`。本轮已修：

- **asarUnpack 补三条**：`node_modules/ssh2/**`（运行时动态 require）、`out/main/chunks/**` 与
  `out/main/untrustedWorker.js`（`child_process.fork` 必须指向真实文件）。
- **`resources/` 目录整份缺失**（而 `electron-builder.yml` 引用它）→ 从 client 复制回 `resources/icon.png`（1440 B）。
- **i18n 补 14 键**：`bot.*` 6 个（启动/停止/重启失败与未保存取消）+ `blocks.placeholders.*` 8 个；
  `propertyDrawerConstants.ts` 的 `JSON_EXAMPLES` 与 `botStore.ts` 的 6 处文案改回 `t()`。
- **`out/` 清污 + 重建**：恢复期手跑不带 `--noEmit` 的 tsc 写进去 1558 个文件，已删净。

审计同时确认：dependencies 与 client 完全一致（只多一个 `yaml`）；渲染层产物（monaco 语言包、
CodeEditor/Terminal/elk/editor.worker/i18n/index.html）齐平；main 少 16 个 chunk 是分块策略差异
（client 22 chunk / 我们 6 chunk，功能不缺）；IPC 的 `runtime:* → botManager.*` 是有意迁移。

## 本地 git 与清理提交（2026-10-24）

清理死代码之前，先给工作树做了版本控制（原 `D:\QQ bot` 已空，这棵树一直没有 .git）：

- `git init -b main` + 首个提交 `97cc982 chore: 恢复工作树基线快照（清理死代码之前）`：**1271 文件 / 3.60 MiB**。
- 入库范围 = 源码 + 测试 + 脚本 + 文档 + 配置；**不入库**：`node_modules/`、`out/`、`release/`、`dist/`、`_recovery/`（169 MB）、`_baseline/`（76 MB）、`projects/`、`.qqbat/`、`.env*`（保留 `.env.example`）、日志与崩溃转储。
- 第二轮清理单独提交（可 `git show` / `git revert`）：
  - 删 `src/main/services/ops/` 下 5 个无 importer 的 10/18 副本：`dockerExport`、`sshDeploy`、`auditService`、`diagnostics`、`metrics`（真源是扁平的 `services/*`；原文仍在 `_baseline/out-bundle`，`scripts/audit-baseline.mjs` 的 `MISSING_OK` 已登记）。`ops/crashReporter.ts` 首轮被误删，build 报 `UNRESOLVED_IMPORT`（被同目录 `crashLogger.ts` 相对 import）后已恢复；
  - 删 `propertyDrawerConstants.ts` 的四份死字典（`CONFIG_LABELS`/`CONFIG_HINTS`/`PORT_HINTS`/`SELECT_OPTIONS`，512 行），文件 559 → 51 行；同步删掉 `tests/renderer/i18n/noHardcodedCopy-baseline.json` 里对应的 380 条登记；
  - 加 `.prettierrc` + `.prettierignore`（仓库历史上从未格式化过，`format:check` 暂只作手工工具）。
- GitHub：`_baseline/` 与 `_recovery/` 刻意不提交；若需要保留取证材料，走 Release 资产或本地备份，不要塞进仓库历史。

## 恢复期重写的源码脚本（10/18 产物不含脚本，原实现不可恢复）

`package.json` 引用、但源码里已丢失的 13 个脚本**已全部重建并逐条实测**（30 条 scripts 现在都能跑）：

| 脚本 | 作用 |
| --- | --- |
| `scripts/ensure-sqlite.js` | 在 node/electron 运行时探测 better-sqlite3，失败才用 prebuild-install 按 runtime/target 重建（12.x 走 N-API，实测 node ABI 137 / electron ABI 146 都直接可用） |
| `scripts/typecheck.mjs` | 串行跑 node/web 两个 tsconfig 并汇总，完整日志写 `_recovery/typecheck-{node,web}.log`；现在是**硬闸门**（两目标 0 错） |
| `scripts/install-hooks.mjs` | 有 .git 时装 pre-commit：拒绝提交 `node_modules/out/release/dist/_recovery/_baseline` 与 >5MB 单文件；**不跑 prettier**（`.prettierrc` 已加，但全库尚未格式化，一跑就是几千文件 diff） |
| `scripts/clean-cache.js` | 清理 `out/ release/ node_modules/.vite node_modules/.cache *.tsbuildinfo`，不碰 `projects/`、`_baseline/` |
| `scripts/audit.mjs` | 依赖审计：main/preload/shared 的第三方包必须在 dependencies，renderer 允许 devDependencies；未声明 exit 1，未使用只警告。实测通过（21 生产 / 27 开发，3 条已登记未用） |
| `scripts/benchmark.mjs` | 目录/流程基准，不新增依赖、恒 exit 0；实测 buildCatalog zh/en、normalizeFlow/validateFlow 500 节点中位数 0.001 / 0.370 / 2.73 / 1.32 ms |
| `scripts/check-catalog.mjs` | 节点目录闸门：kind 唯一 + collectMissingCopy 为空 + en 文案/端口/选项逐节点对账（走 scripts/lib/catalog-modules.mjs，用 tsc 编 CJS，不装 jiti）。实测 76 节点 / 76 份英文 / 0 缺 |
| `scripts/check-identity-conflicts.mjs` | kind / toolName / 端口 id / 选项 value 冲突（输入输出同名只警告）。实测 76 kind / 46 toolName 唯一、4 条已知警告 |
| `scripts/check-duplication.mjs` | 同一 kind 多处定义；跳过端口 kind（'control'/'data'）。通过 |
| `scripts/check-userdata-layout.mjs` | 只允许 paths.ts 直接 app.getPath('userData')，其余按存量 allowlist ratchet；实测 6 文件 / 9 处 |
| `scripts/i18n-extract-copy.mjs` + `scripts/i18n-build-catalog.mjs` | 抽取/回写英文目录，与 client 目录 deep equal（76 kind / 870 端口 / 374 选项）；`check:i18n` 已无 git 依赖 |
| `scripts/gen-nodes-reference.mjs` | 生成 `docs/nodes-reference.md`（76 节点 / 22,236 B）并支持 `--check`；排序按目录分组 |

## 下一步

1. 清 @ts-nocheck（按 TS2304 → TS2339 顺序），把 `tsconfig.recover.json` 变成真闸门。
2. ~~决策 tests：按新 API 修 or 重写~~ —— **已修完**：`node scripts/typecheck.mjs` node/web 双 0 错，全量 vitest 232 文件 / 2938 例通过；做法是「生产签名按真实契约放宽 + 测试补注解/元组 mock + 重建缺失共享类型」，明细见 `docs/restore/client-diff-audit-2026-10-24.md` §八。
3. 收敛两套 codegen 栈。
4. 之后才是功能。**注意：这棵树里已经带着 10/18 之前的 DSH 对齐成果**——`agent-core/scheduler.ts`（独占/并行工具组）、`plugins/kernel.ts`（Cordis-lite 内核）、`plugins/market.ts`（插件市场）、`ai/contextDigest.ts` + `ai/summaryLlm.ts`（模型摘要）都在；盘点基线读 `docs/ai/dsh-parity-2026-10-18.md`（14 层对照表）与 `docs/ai/agent-framework-porting.md`，别按旧记忆列待办。
