# H Bot 制造（打包客户端）清点与打捞结论

对象：`D:\H Bot 制造` —— 2026-10-18 04:50 由 `electron-builder` 打出的 Windows 客户端（NSIS 安装包 + portable + `resources/app.asar`）。
它同时也是 `E:\qqbat-restored` 这棵恢复树的**主要来源**：源码树里绝大多数字节都是从它的 `out/` 反推回来的。

## 一、它里面到底有什么（逐项清点）

| 位置 | 内容 | 数量/大小 | 对恢复的价值 |
|---|---|---|---|
| `resources/app.asar` | 应用归档 | 74,277,199 字节 / 8,497 个条目 | 源码主体 |
| ├ `/out/main/` | 主进程构建产物 | 26 个 js：`index.js` 607,792、`standalone.js` 9,681、`untrustedWorker.js` 8,130、24 个 `chunks/*.js`（最大 `ai-DvGDTK0D.js` 706,651） | **模块级可还原**（chunks 未压缩、带 `//#region src/...`） |
| ├ `/out/renderer/` | 渲染进程产物 | 96 个文件 / 12,793,230 字节（`index-*.js` 3.15MB、`CodeEditor-*.js` 4.89MB、`elk.bundled-*.js` 2.55MB、`i18n-*.js`、worker、CSS） | **模块级可还原**（未压缩、带 region） |
| ├ `/node_modules/` | 打包进去的依赖 | 7,000+ 条目（zod、hono、ajv、lucide-react、@modelcontextprotocol/sdk、@opentelemetry…） | 依赖清单对照（版本以 `pnpm-lock.yaml` 为准） |
| ├ `resources/app.asar.unpacked/` | 原生模块解包 | 316 个文件（better-sqlite3、node-pty 的 `.node` 与构建残留） | 只影响打包，不参与源码 |
| └ `/package.json` | 打包元数据 | `name: qqbat` `version: 0.1.0` `main: ./out/main/index.js` `license: AGPL-3.0-or-later` `engines.node >= 22` | 已与恢复树对齐 |
| `H Bot 制造.exe` | 主程序 | 235,128,320 字节 | **不能反编译出源码**：它是 electron 可执行文件（asar 已内嵌/外部化），二进制里只有 `app.asar` 路径与 electron 字符串 |
| `locales/` `*.pak` `*.dll` `LICENSES.chromium.html` | Electron 运行时 | — | 与源码无关 |

**没有** sourcemap（`*.map` = 0），**没有** `src/` 目录 —— 打捞完全依赖 region 注释与未压缩代码。

## 二、能救回多少（量化）

做法：把 `/out/**/*.js` 里所有 `//#region src/...` 段抽出来，按路径去重取最长版本，再和恢复树逐文件比对。

- 归档里可识别的 **应用源模块：418 个**（main/services 49、main/ipc 38、shared/nodes 35、main/schemas 32、renderer 225、其余 39）。
- 恢复树里**已存在：416 个**（99.5%）。
- 真正缺的只有 2 个，且都不是「丢代码」：
  1. `src/renderer/src/assets/node-authoring.md?raw` —— 这是 Vite 的 `?raw` 导入伪模块，真身 `node-authoring.md`（9,290 字符）早已从同一产物里提取并写回；
  2. `src/renderer/src/components/blocks/useEditorActions.tsx` —— 打包 revision 里是 `.tsx`，恢复树里是 `.ts`（15,666 字节，比产物 region 的 9,219 编译字符更大更全），属重命名。
- 另有 12 个文件「产物 region 比树里文件短」，逐个看过：是 rolldown 把相邻依赖内联进同一 region 造成的假象（例如 `storageKeys.ts` 的 region 里塞进了整份 i18n 表），**不是截断**。

结论：**模块层面已基本榨干（416/418）**，再从 asar 里抠不出更多「新文件」。真正的损失是类型注解、JSDoc、测试与文档——这些产物里本就没有。

## 三、这一轮真正捞到的缺口：`untrustedWorker`

这是清点时唯一有实质价值的发现：

- 恢复树的 `src/main/runtime/untrustedWorkerHost.ts` 用 `child_process.fork` 起 `out/main/untrustedWorker.js`（候选还有 `../untrustedWorker.js` 与源码 `untrustedWorker.ts`），而**这三个在恢复树里一个都没有** → 不可信节点沙箱一用就炸，且只在运行期暴露。
- 源码在 asar 里是 `unpacked`，实体在 `D:\H Bot 制造\resources\app.asar.unpacked\out\main\untrustedWorker.js`（7,446 字符，带 `//#region src/main/runtime/untrustedWorker.ts` 与全部中文注释）。
- 已按它逐段还原成 `src/main/runtime/untrustedWorker.ts`（9,452 字符，补了 TS 类型，逻辑一致）：stdin 行 JSON 协议、每 kind 一个 vm 沙箱、`register/unregister/unregisterPrefix/list/info/selfProbe/invoke/reply` 八个消息、`console.*` 全部改道 stderr、迟到结果投递。
- 同时补上**三个主进程入口**（10/18 产物有、恢复树原本没有）：
  `electron.vite.config.ts` 的 `main.build.rollupOptions.input = { index, standalone, untrustedWorker }`。
  少 `standalone` 则 Docker/SSH 部署镜像起不来（`node out/main/standalone.js <project>`）；少 `untrustedWorker` 则沙箱崩。
- 验证：`build` 通过，`out/main/{standalone.js 9,956, untrustedWorker.js 8,120}` 与产物尺寸几乎一致；worker 协议冒烟通过：
  `{"t":"info","id":1}` → `{"t":"reply","id":1,"ok":true,"value":{"pid":…,"node":"v24.21.0"}}`；
  `register` + `list` → `{"value":["t1"]}`。

## 四、还能怎么用它（剩余价值）

1. **行为对照物**：`H Bot 制造.exe` 能直接跑（内部 asar 与外部同源），拿它和恢复树对比同一操作的界面/落盘结果，是最强的回归手段。
2. **依赖清单核对**：asar 的 `/node_modules` 是「10/18 构建时真实装上的版本」，与 `pnpm-lock.yaml` 交叉验证可发现版本漂移（当前构建已通过，暂不动）。
3. **资源文件**：`resources/` 下除 asar 外只有 `elevate.exe`/`elevate.exe` 与安装器资源，没有额外模板/图标库（图标在 `electron-builder.yml` 引用的 `resources/icon.png`，恢复树需自查是否存在）。

## 五、打捞脚本（可复用）

asar 解析不能走 `node:fs`（DSH 自己的运行时会拦截 `.asar` 路径并报 `ENOENT ... in app.asar`），做法是：`Copy-Item app.asar D:\tmp\hbot-app-v2.bin` → 解析 16 字节头（`readUInt32LE(12)` = header JSON 长度）→ `base = 16 + headerSize` → 条目 `offset` 是**字符串**，必须 `Number()`。
归档条目清单与比对结果见 `_recovery/asar-audit.json`；worker 编译产物原始副本见 `_recovery/untrustedWorker.compiled.js`。
