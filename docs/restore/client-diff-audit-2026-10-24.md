# 恢复树 vs 10/18 打包客户端：差异审计（2026-10-24）

基准：`D:/H Bot 制造`（2026-10-18 打包的安装目录），以及仓库内留档的
`_baseline/app.asar.bin`（74,277,199 B，sha256 `9bf9e626…fb7b19`）。
审计对象：`E:/qqbat-restored` 工作树与它构建出的 `out/`。

目的不是"看起来一样"，而是回答一个问题：**从客户端反推恢复时，有哪些东西
还留在树外、或者根本没被恢复回来。** 本文只记录已核实的事实与风险，不含推测。

## 一、方法

- asar 解包：`headerSize = buf.readUInt32LE(12)`，文件表 JSON 从 offset 16 开始；
  数据区起点 `base = 8 + buf.readUInt32LE(4)`；条目内容 = `buf[base + offset, base + offset + size)`。
  产物：`_recovery/asar-entries.json`（8497 个文件 / 132,610,650 B，其中 node_modules 8375、
  out 121、package.json 1）、`_recovery/client-package.json`。
- 渲染层 i18n 目录：直接 `import('file:///…/_recovery/client-i18n-chunk.js')`，
  导出 `s` = zh-CN、`o` = en-US，各 3009 个扁平 key。
- 渲染层硬编码扫描：去注释后取字符串字面量，与 client bundle 文本、client 目录值
  三方比对（详见 §六）。
- 构建产物对比：把 client 的 `/out/…` 与本地 `out/` 都归一化成
  `out/<dir>/<name>-HASH.js` 再求差集（第一次忘了加 `out/` 前缀，得到的是假阳性，已修正）。

## 二、结论总表

| 维度 | client | 恢复树 | 判定 |
| --- | --- | --- | --- |
| dependencies | 20 个 | 同 20 个同名同版本 + `yaml` | 一致（`yaml` 为恢复期新增依赖） |
| 主进程入口 | `out/main/index.js` 607,792 B + 22 chunk | `index.js` 1,708,225 B + 6 chunk | **分块策略不同**（功能不缺，首屏体积更大） |
| asarUnpack | 316 条（含 chunks、ssh2、better-sqlite3、node-pty） | 原缺 3 类 | 已补（§四） |
| extraResources | `resources/icon.png` 1440 B | 目录整个缺失 | 已补（§四） |
| i18n key | 3009 | 3116（补前）/ 3130（补后） | 补回 14 个仍在用的键（§五） |
| IPC 频道 | 277 | 282 | 差异均为有意新增，另见 `runtime:*` 迁移（§三） |
| preload 面 | `runtime.{start,stop,restart,status,sendCommand,listRunning}` 等 | 只剩 `runtime.{batchLog,executeNode,injectTestMessage}` | **有意迁移**到 `botManager.*`（§三） |
| 构建产物文件数 | 120（去掉目录条目） | 106（哈希归一后 105 个唯一名） | 只差 16 个 main chunk（§四） |
| 源码脚本 | 打包产物不含 | 12 个被 `package.json` 引用的脚本丢失 | **已全部重建**（规则可自证；§七） |
| 类型检查 | — | 修前 node 161 / web 286 错 | **已清零**：node 0 / web 0（§八） |

## 三、依赖、元数据与 IPC

- **依赖一致**：client 与 `package.json` 的 dependencies 同名同版本——
  `@modelcontextprotocol/sdk ^1.29.0`、`better-sqlite3 ^12.11.1`、`node-pty ^1.1.0`、
  `ssh2 ^1.17.0`、`ws ^8.21.0`、`zod ^4.6.1`、`zustand ^5.0.14`、react 19.2.7 等。
  唯一多出来的是恢复期为 YAML 处理补的 `yaml`。
- **品牌差异（未改，待拍板）**：`electron-builder.yml` 是
  `productName: QQ Bat` / `shortcutName: QQ Bat` / `appId: com.qqbat.app`；
  client 安装名与 exe 都是 `H Bot 制造.exe`。`package.json` 的 `author` 与 client 一致（`H Bot 制造`）。
- **IPC**：client 独有的是 `runtime:{start,stop,restart,status,statusChange,statusChanged,sendCommand,listRunning}`
  （外加若干误报，例如 `about:blank`、`nodeId:portId`、`path:[2]`）。
  恢复树新增的是 `ai:{agentCoreRun,agentCoreSteer,agentStep,clearAllowRules,getAllowRules,instructionResult,removeAllowRule,savePresets}`、
  `launch:{listLayerTemplates,previewConfigTables}`、`node:vm`、`plugin:{listHost,loadAi,marketAddSource,marketInstall,marketList,marketRemoveSource,marketUninstall,setHostEnabled}`。
- **`runtime:*` 是有意迁移**：client 渲染层确实调用 `runtime.restart/start/stop/status`
  （ConsolePanel 重启、aiStore 的 run_bot/stop_bot、注入前的状态检查），恢复树把运行控制
  统一到 `botManager.*`，`runtime:*` 只保留观测三件套。风险：**第三方插件若直接调
  `window.qqbat.runtime.start` 会失效**；client 里 `sendCommand`/`listRunning` 在渲染层 0 次引用。

## 四、打包配置与 out/ 清单（已修）

- `electron-builder.yml` 的 `asarUnpack` 原来只有 `**/*.node`、`node_modules/better-sqlite3/**`、
  `node_modules/node-pty/**`，client 的 unpacked 目录里还包含：
  - **全部 `out/main/chunks/*.js` 与 `out/main/untrustedWorker.js`**——不可信节点沙箱走
    `child_process.fork`，入口必须是真实文件，留在 asar 里会 fork 失败；
  - **`node_modules/ssh2/**`**——运行时动态 require 协议实现，asar 内路径解析不可靠。
  已补这三条并各加中文注释。复核实测：client 的 `app.asar.unpacked` 共 310 个文件，构成为
  `node_modules/node-pty` 154、`node_modules/better-sqlite3` 105、`node_modules/ssh2` 29、
  `out/main/chunks/*` 21、`out/main/untrustedWorker.js` 1——与现有 `asarUnpack` 逐条对得上。
- **`resources/` 目录整个缺失**（`electron-builder.yml` 却引用 `win.icon: resources/icon.png`
  与 `extraResources: resources/**/*`）。已从 client 的 `resources/resources/icon.png`
  复制回 `resources/icon.png`（1440 B）。
- **`out/` 曾被 tsc 污染**：`tsconfig.node.json` 带 `composite: true` + `outDir: ./out`，
  恢复期手跑不带 `--noEmit` 的 `tsc -p` 写进了 1558 个文件（`src/**/*.js|.d.ts`、
  `tests/**`、`electron.vite.config.js/.d.ts`、`tsconfig.node.tsbuildinfo`、`vitest.config.js/.d.ts`）。
  已删除并重新构建；现在 `out/` 106 个文件（哈希归一后 105 个唯一名）、`out/main` 9 个。
- **产物差集（修正前缀后）**：client 120 个文件 vs 我们 105 个，**只缺 16 个 main chunk**：
  `ai`、`builtin`、`codegen`、`dynamicHandlers`、`expressionSafety`、`historyStore`、`llm`、
  `logger`、`memory`、`pathGuard`、`pending`、`pluginKindContract`、`pluginNamingContract`、
  `policy`、`registration`、`tools`；我们多一个 `builtinCatalog`。渲染层（monaco 语言包、
  `CodeEditor`/`Terminal`/`elk.bundled`/`editor.worker`/`i18n`、`index.html`）齐平。
- **main 分块策略差异**：client 用 `output.manualChunks` 一类配置把 AI/codegen/registration 等
  拆成 22 个 chunk（`index.js` 仅 607 KB），恢复的 `electron.vite.config.ts` 只有 3 个入口，
  产出 6 个 chunk、`index.js` 1.7 MB。功能不受影响，影响的是启动时的解析/内存；
  复刻原分块需要拿到原配置，未擅自猜。`out/main/chunks/**` 已按上条解包，拆不拆都能跑。

## 五、i18n（已修）

- client 目录 3009 个 key；恢复树 3116 个。差集共 **16 个**，其中 14 个仍在用：
  - `blocks.placeholders.{body,cases,headers,messages,params,segments,transitions,variablesJson}`（8 个）
  - `bot.{loadFailed,restartCancelledNotSaved,restartFailed,startCancelledNotSaved,startFailed,stopFailed}`（6 个）
- 另 2 个是 `resource.{cpuExceeded,memoryExceeded}`：在 client 全部产物里 0 次引用（死键），
  恢复树对应的 `src/renderer/src/stores/resourceStore.ts` 本身也是死模块，未补。
- 已按 client 原文补进 `src/renderer/src/i18n/zh-CN.json` 与 `en-US.json`（现各 3130 key）。
- 两处"恢复时被降级成硬编码中文"的地方已改回 i18n：
  - `src/renderer/src/components/blocks/propertyDrawerConstants.ts`：`JSON_EXAMPLES` 从中文字面量
    改回 8 个 getter + `t('blocks.placeholders.*')`；
  - `src/renderer/src/stores/botStore.ts`：6 处 toast/文案改 `t('bot.*')`。
- `src/renderer/src/components/blocks/propertyDrawerConstants.ts` 里的 `CONFIG_LABELS`、`CONFIG_HINTS`、
  `PORT_HINTS`、`SELECT_OPTIONS` 四份字典（512 行 / 380 个中文字面量）运行期零 importer，client 同模块
  里也没有它们（显示名/说明已收敛到 `src/renderer/src/i18n/fieldLabels.ts` + `scripts/i18n/field-{zh,en}.json`）
  → **2026-10-24 已删除**：文件从 559 行降到 51 行，只保留 4 个仍在用的导出。

## 六、硬编码文案与死代码

扫描了 50 个文件、1072 个含中文字符串；与 client bundle 文本 / client 目录值比对后，
只剩 **8 个文件、118 个**「client 用 t()、恢复树写的字面量」候选。逐个查 importer 后：
- 其中 7 个文件是**死模块**（0 importer）：`blocks/BlockView.tsx`（只被同样死的 `ChainView.tsx` 引用）、
  `stores/resourceStore.ts`（只被 `MetricsPanel`/`ResourceLimits` 引用）、
  `canvas/CanvasToolbar.tsx`（连带 `canvas/TemplateMarketDialog.tsx`、`settings/TemplateMarket.tsx`）、
  `canvas/PropertyDrawer.tsx`、`launch/NapCatConfigDialog.tsx`。
- 只有 `blocks/propertyDrawerConstants.ts` 是活文件，已修（§五）。
→ **没有仍在使用的文案被硬编码**。

2026-10-24 后续清理：`TimeMachinePanel.tsx`（原只被 CanvasToolbar 引用）与 `ProjectCard.tsx`
（只被已归档的测试引用）在 client bundle 里 0 命中，已随上述死模块一起移到 `_recovery/dead-renderer/`。

## 七、被 package.json 引用的源码脚本（2026-10-24 已全部重建）

恢复初期 `scripts/` 只剩 `audit-baseline.mjs`、`export-agent-framework.mjs`、`gen-capability-catalog.mjs`、
`update-file-size-baseline.mjs`、`update-style-baseline.mjs` 与 3 个 `_live_*.cjs`，而 `package.json` 引用的
12 个脚本一个都不存在 —— `pnpm install` 的 prepare、`pnpm dev/test/pack`、`pnpm audit/benchmark/check:*`
全部会失败。

**不可恢复的证据**：client asar 不含源码脚本；`D:/tmp/qqbat-tape.jsonl`（83,296,473 B）里这些名字
只在 package.json 内容中出现，没有任何 `scripts/*` 的 read/write 记录；`D:/QQ bot` 目录已空；
E:/D: 全盘 glob `**/ensure-sqlite*` 0 命中。因此**原始语义不可反推**；重建原则是「规则能从 client 产物/
目录对账、且能实测自证的才写」，不凭想象造「看起来有审计、实际没审」的假闸门。

### 第一轮（4 个，行为已实测）

| 脚本 | 实现要点 |
| --- | --- |
| `scripts/ensure-sqlite.js` | 在目标运行时（node/electron，electron 走 `ELECTRON_RUN_AS_NODE=1`）requiring 一次 better-sqlite3 探测；失败才用 `prebuild-install --runtime/--target` 重建；实测 node ABI 137、electron ABI 146（42.11.18）都直接可用（12.x 已走 N-API） |
| `scripts/typecheck.mjs` | 串行跑 `tsconfig.node.json` / `tsconfig.web.json`，汇总错误数+耗时，完整日志写 `_recovery/typecheck-{node,web}.log`；支持只查 `node`/`web` |
| `scripts/install-hooks.mjs` | 无 .git 时明确跳过；有 .git 时写 pre-commit：拒绝提交 `node_modules/out/release/dist/_recovery/_baseline`、拒绝 >5MB 单文件。**刻意不跑 prettier**（仓库没有 `.prettierrc`，默认配置会把整库判红） |
| `scripts/clean-cache.js` | 删除 `out/`、`release/`、`node_modules/.vite`、`node_modules/.cache`、`*.tsbuildinfo`，打印释放空间；不碰 `projects/` 与 `_baseline/` |

配套新增 `.npmrc`（一行 `verify-deps-before-run=false`）：恢复树的 `node_modules` 缺 pnpm 自己写的
`node_modules/.modules.yaml`，pnpm 11 会把它判成"不是 pnpm 装的"，于是每次 `pnpm run` 都先尝试 purge+重装，
非交互 shell 直接 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。关掉这个前置校验后，
`pnpm dev / build / test / pack` 恢复可用，且不会误删已编译好原生模块的 `node_modules`（node-pty 一旦被
purge，pnpm 10+ 默认拦构建脚本，二进制就没了）。真正要重装时请手动 `pnpm install` 并确认不要 purge。

### 第二轮（9 个，全部实测通过）

| 脚本 | 实现要点与实测结果 |
| --- | --- |
| `scripts/audit.mjs`（`audit`） | 扫 `src/{main,preload,shared,renderer}` 843 个文件的 import/require/动态 import，过滤模板串假 import 与 `@main/@shared/...` 别名；main/preload/shared 的第三方包必须在 `dependencies`，renderer 允许 devDependencies；未声明 exit 1，生产依赖未 import 只警告（`KNOWN_UNUSED` 登记 `@types/react-window`、`node-pty`、`yaml` 及理由）。实测 21 生产 / 27 开发依赖、引用 20 个第三方包，通过 |
| `scripts/benchmark.mjs`（`benchmark`） | 不新增依赖、恒 exit 0；`--rounds` 默认 5；测 buildCatalog(zh) 恒等 / buildCatalog(en) 克隆 / normalizeFlow(500 节点) / validateFlow(500 节点) 的中位数。实测 3 轮：0.001 / 0.370 / 2.73 / 1.32 ms，缺译文 0 |
| `scripts/check-catalog.mjs`（`check:catalog`） | 无 jiti，走 `scripts/lib/catalog-modules.mjs`（用 tsc 把 catalog 源码编成 CJS 再 require）；kind 唯一、`collectMissingCopy()` 必须为空、逐节点校验 en 文案/端口/选项，并反向查多余 kind/端口/选项。实测 76 节点 / 76 份英文 / 0 缺译文 |
| `scripts/check-identity-conflicts.mjs`（`check:identity`） | kind、toolName、端口 id、选项 value 冲突检测；输入输出同名只警告。实测 76 kind / 46 toolName 唯一，4 条已知警告 |
| `scripts/check-duplication.mjs`（`check:duplication`） | 同一 kind 多处定义；跳过端口 kind（'control' / 'data'）—— 首版正则把端口当节点定义，误报 data 1206 次，已修。通过 |
| `scripts/check-userdata-layout.mjs`（`check:userdata`） | 只允许 `src/main/services/infra/paths.ts` 直接 `app.getPath('userData')`，其余按存量 allowlist ratchet；实测 6 文件 / 9 处（diagnostics 2、crashReporter 2、napcat 1、official 1、templates 1） |
| `scripts/i18n-extract-copy.mjs` + `scripts/i18n-build-catalog.mjs`（`check:i18n`） | 从节点目录抽取待译文案、回写 `catalog.en-US.ts`；与 client 目录 deep equal（76 kind / 870 端口 / 374 选项）。`check:i18n` 已去掉对 `git diff --exit-code` 的依赖（无 .git 也能跑） |
| `scripts/gen-nodes-reference.mjs`（`docs:nodes` / `docs:nodes:check`） | 生成 `docs/nodes-reference.md`（22,236 B、76 节点、5 弃用），`--check` 检测漂移；排序按目录顺序（11 组：触发器 7 / 消息 6 / 动作 11 / 判断 3 / 控制流 13 / 数据 11 / AI 3 / 存储 10 / 计算 6 / 上下文 4 / 文本 2） |

至此 `package.json` 的 30 条 scripts 全部有实现且逐条实测；`node_modules` 不新增 jiti/esbuild/tsx 等依赖。

## 八、类型检查（2026-10-24 已清零）

早期汇报里的「tsc 0 错」只覆盖了 **`src/main`**。当时完整跑两个 tsconfig 是 node 161 错 /
web 286 错；本轮已全部修到 **0 错**，`node scripts/typecheck.mjs` 两个目标都是 ✔：

| 目标 | 修前 | 修后 | 根因与修法 |
| --- | --- | --- | --- |
| `tsconfig.node.json` | 161（全在 `tests/**`：mcp 82、services/ai 28、ipc 17、agent-core 11…） | **0** | 一部分是**生产侧签名过窄**，按真实契约放宽：`Tool.run` 返回 `Promise<string \| ToolRunOutcome>`（scheduler 本就 `normalizeToolOutcome`）、`toolCallToOperations(toolName, args, projectPath?, role?)` 后两参可选、`buildToolResultMessages` 的 budget 可选、`queryTable(..., cursor: number \| null = null)`、三个 provider 的 `chat()` 显式四参；其余是测试侧：mock 元组显式泛型、`vi.fn` 返回值补类型、NodeNext 下动态 import 别名改变量 specifier、`sqliteShim` 用 `../../helpers/sqliteShim.js` 扩展名 |
| `tsconfig.web.json` | 286（`src/renderer` 268 + `tests/renderer` 18） | **0** | 结构债为主：重建 `EditorFile`/`ThemeConfig`、补 `ChatMessage.reasoning`、`refTable/refField`、`BotType` 改从权威联合类型再导出、flow slices 对齐 `FlowState`（`nodeGroups` 取代臆造 `groups`）、删 `types/ipc.ts` 里重复的 `agentCoreRun/agentCoreSteer` 声明并补齐可选参数、`tsconfig.web.json` 的 `types` 加 `node`（tests/renderer 用 fs/path）；死组件（DebuggerPanel/sourceDebugStore 等 10 个）归档到 `_recovery` 而不是留在树里装红 |

教训：`electron-vite build` 走 rolldown、不做类型检查，所以构建与运行绿 ≠ 类型绿；闸门必须以
`node scripts/typecheck.mjs` 为准（它串行跑两份 tsconfig，日志写 `_recovery/typecheck-{node,web}.log`）。

## 九、当前闸门

| 闸门 | 结果 |
| --- | --- |
| `electron-vite build` | EXIT 0（含 §五 i18n 改动） |
| `tests/guards` | 12 文件 / 88 passed + 2 skipped |
| 全量 vitest（2026-10-24 03:15 复跑） | 226 文件 / 2958 passed + 58 skipped（3016 例）/ 0 failed |
| `tsc`（`node scripts/typecheck.mjs`） | node **0 错** / web **0 错**（§八） |
| `package.json` scripts | 30 条全部有实现，逐条实测（§七） |
| `pnpm dev / test / pack` | 恢复可用（依赖 §七 的脚本重建） |

补充（2026-10-24 收尾）：全量测试全绿后复跑 `electron-vite build` 又抓到一处 **MISSING_EXPORT** ——
`src/main/services/builtinNodes/joinApproval.ts` 从 `persistentStore` 引 `validateStrategyGroups` /
`validateWhitelistUsers`，两者真实定义在 `src/main/services/official.ts`；已改成从 `../official` 引入，
重建 EXIT 0。教训：**vitest 里缺失的命名导出会静默变 `undefined`（路径没被用例走到就全绿），只有
rolldown 构建会报 MISSING_EXPORT** —— 所以 build 与 typecheck 必须一起当闸门。

## 十、待拍板

1. ~~**品牌**~~ —— **已对齐**：`productName`/`shortcutName`/`copyright` 都是 `H Bot 制造`，portable 产物名 `H-Bot-Portable-${version}.exe`；`appId` 保持 `com.qqbat.app`（安装器里推不回来）。
2. ~~**缺失脚本**~~ —— **已全部重建**（§七），30 条 scripts 逐条实测。
3. ~~**main 分块**~~ —— **已核对，不改**：client out/main 23 个 js（index 607,792B；ai 706K / FlowRuntime 388K / registration 303K / dynamicHandlers 301K）；恢复树同为 23 个（index 913,595B；ai 696K / handlerRegistry 361K / FlowRuntime 333K），模块划分一致，只差索引 chunk 体积。
4. ~~**类型债**：286 + 161 个 tsc 错误~~ —— **已清零**（2026-10-24，§八），现在 `pnpm typecheck` 是硬闸门。
5. ~~**死代码**~~ —— §六 的死模块 + `TimeMachinePanel.tsx`、`ProjectCard.tsx` 已归档到 `_recovery/dead-renderer/`；`propertyDrawerConstants.ts` 的四份死字典已于 2026-10-24 删除（§五）。
6. ~~**format 配置**~~ —— 已加 `.prettierrc`（singleQuote / semi / printWidth 100 / trailingComma all）+ `.prettierignore`（依赖、构建产物、`_recovery`、`_baseline`、生成文件）。**尚未全库格式化**（实测会动 836 个文件），`format:check` 只作手工工具、不进闸门。
7. ~~**ops/ 旧实现**~~ —— **已删 5 个无 importer 的 10/18 副本**：`ops/{dockerExport,sshDeploy,auditService,diagnostics,metrics}.ts`；保留被引用的 5 个（`crashLogger` / `crashReporter` / `errorMonitoring` / `git` / `debugger`）。`ops/crashReporter.ts` 首轮误删，build 的 `UNRESOLVED_IMPORT`（`ops/crashLogger.ts` 的相对 import）抓到后已恢复——教训：只按 `services/ops/xxx` 全路径 grep importer 会漏掉同目录相对引用。原文仍在 `_baseline/out-bundle`，`scripts/audit-baseline.mjs` 的 `MISSING_OK` 已逐条登记。

## 十一、本地 git 与清理提交（2026-10-24）

工作树此前没有版本控制（原 `D:\QQ bot` 已空），本轮清理前先 `git init -b main` 做了快照：

- 首个提交 `97cc982 chore: 恢复工作树基线快照（清理死代码之前）`：**1271 文件 / 3.60 MiB**。
- `.gitignore`：`node_modules/`、`out/`、`release/`、`dist/`、`coverage/`、`*.tsbuildinfo`、`_recovery/`、`_baseline/`、`projects/`、`.qqbat/`、`backups/`、`logs/`、`crashes/`、`crash-reports/`、`.env*`（保留 `.env.example`）、`*.log`。
- **`_baseline/`（76 MB）与 `_recovery/`（169 MB）刻意不入库**：前者是打包产物取证材料（可从 `D:\H Bot 制造` 重新提取），后者是恢复过程日志与归档。push 到 GitHub 前确认这两个目录不在暂存区。
- 第二轮清理（6 个 ops 副本、4 份死字典、`.prettierrc`/`.prettierignore`）单独提交，可用 `git show` / `git revert` 对照首个提交。
