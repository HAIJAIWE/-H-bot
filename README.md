# H Bot 制造（qqbat）

AI 驱动的可视化**多平台**机器人开发框架。拖节点搭流程、写指令就上线：消息 / 定时 / 事件触发、条件分支、
变量与配置表、玩家存档、AI 节点、内置节点包与插件市场，支持 Docker / SSH 部署。
当前对接 QQ 官方机器人协议端，节点层与平台无关，后续按适配层扩展其它平台。

> 本仓库是 **2026-10-18 打包客户端**的源码恢复与整理版：原工作目录已丢失且没有 git 历史，
> 恢复方法、客户端模块覆盖率（594 个模块 / 98.5% 可定位）、已知差异与闸门数字见
> [`RESTORE-NOTES.md`](RESTORE-NOTES.md) 与 [`docs/restore/`](docs/restore/)。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 42 |
| 界面 | React 19 + TypeScript 6 + Tailwind CSS v4 + zustand |
| 构建 | electron-vite（rolldown）+ Vite 7 |
| 数据 | better-sqlite3（项目内 data/、玩家存档） |
| 协议 | QQ 官方机器人协议端（WebSocket） |
| 部署 | Docker（node:22-slim）/ SSH（Node 运行时，不需要 Python） |

## 快速开始

要求 Node >= 22、pnpm 11（`packageManager` 已锁定版本）。

```bash
pnpm install
pnpm dev        # 主进程 + 渲染层，界面在 http://localhost:5173
```

安装说明：pnpm 11 会把依赖的 postinstall 默认拦下来，白名单写在 `pnpm-workspace.yaml` 的
`allowBuilds`（`better-sqlite3` 与 `electron` 为 true，其余原生可选模块为 false）。若 `pnpm install`
之后 `node_modules/electron/dist` 仍然是空的，手动跑一次 `node node_modules/electron/install.js`
（从本地缓存解压运行时二进制，不需要重新下载 Electron 本体）。

连真实 QQ 需要在「机器人设置」里配置官方协议端（AppID / AppSecret）；不连也能用「测试运行」跑流程。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发模式（热更新） |
| `pnpm build` | `electron-vite build`：main / preload / renderer 三个入口产物到 `out/` |
| `pnpm typecheck` | 两份 tsconfig 的类型闸门（node / web） |
| `pnpm test` | 全量测试（约 4 分钟） |
| `node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2` | 仓库自查闸门（文件体量、死导出、IPC 契约、i18n 等） |
| `pnpm pack` | 打包安装器（electron-builder；`productName` = H Bot 制造） |
| `pnpm audit:baseline` | 对照 `_baseline/` 的打包产物核对模块覆盖（该目录不入库） |

仓库里还有一批自查脚本：`check:catalog`、`check:identity`、`check:duplication`、`check:userdata`、
`check:i18n`、`docs:nodes:check`、`audit`、`benchmark`，用途见 [`docs/restore/client-diff-audit-2026-10-24.md`](docs/restore/client-diff-audit-2026-10-24.md)。

## 多平台与节点

内置节点目录共 **76 个节点**，与 2026-10-18 打包客户端逐条一致（含 17 个分组分片、英文文案 76 份 /
870 个端口 / 374 个选项与客户端 deep equal）：

| platform 标记 | 数量 | 含义 |
| --- | --- | --- |
| `all` | 64 | 与平台无关（分支、变量、数据、AI、计算、文本、存储…） |
| `qq` | 12 | 官方 QQ 协议端特有（按钮点击、战斗面板、入群审批、频道、互动菜单/面板、机器人资料、消息编辑/操作、群管理、通用 API 调用…） |

另外 12 个节点带 `requires` 能力标注（如 `message_send → ["im.message.send"]`），用来做细粒度能力绑定；
`platform` 只决定编辑器徽标与可见性，新平台接入时**不需要复制节点**：补一个适配器 + 能力映射即可，
通用节点原样复用。

## 目录结构

```text
src/main      主进程：IPC、服务、流程运行时、AI、插件内核、部署
src/preload   预加载桥（contextBridge，唯一暴露 window.qqbat 的地方）
src/renderer  界面：编辑器、画布、面板、AI 侧栏、i18n
src/shared    主/渲染共用类型、节点目录（76 个内置节点）、消息组合
tests         单元 / 集成 / 渲染测试，tests/guards 是自查闸门
scripts       构建期与仓库自查脚本（全部走 node，不依赖额外工具）
docs          节点参考、恢复审计与方法文档
```

## 当前状态

- 类型检查：`node scripts/typecheck.mjs` → node **0 错** / web **0 错**
- 构建：`electron-vite build` EXIT 0
- 测试：295 文件（293 通过 + 2 跳过）/ 3674 通过 + 7 skipped（3681 例）/ 0 失败；guards 15 文件 / 107 通过
- 已知债：源码里仍有 **221 个 `@ts-nocheck`** 历史文件（闸门只覆盖其余文件）；全库尚未跑过 prettier
  格式化（配置在 `.prettierrc`，会动数百个文件，刻意没执行）

## 许可

[AGPL-3.0-or-later](LICENSE)。第三方依赖遵循各自许可；`resources/icon.png` 等品牌素材随项目分发。
