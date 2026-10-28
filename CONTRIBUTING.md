# 参与开发（CONTRIBUTING）

欢迎一起来搞 H Bot 制造（qqbat）。下面几条是协作约定，照着走能少踩坑、也避免互相覆盖。

## 开发环境

- Node >= 22、pnpm 11（仓库 `packageManager` 已锁版本）。
- 安装依赖：`pnpm install`（pnpm 11 默认拦原生模块 postinstall，白名单见 `pnpm-workspace.yaml` 的 `allowBuilds`：`better-sqlite3` 与 `electron` 为 true）。
- 起开发模式：`pnpm dev`，界面在 http://localhost:5173。
- 环境变量模板见 `.env.example`：复制成项目目录下的 `.env` 按需填，`.env` 本身不入库。

## 分支与提交流程

- `main` 是受保护的主线，**不要直接 push 到 main**。
- 在功能分支上开发：`git checkout -b feat/你的功能`（修 bug 用 `fix/...`）。
- 推到远程后开 **Pull Request**，至少一次 review 通过再合并。
- 提交信息沿用本仓库风格（中文 + Conventional Commits 风格），例如：
  `feat(plugins): 外部窗口包管理面板`、`fix(runtime): 修复节点超时计数`。

## 提交前自查

- `pnpm typecheck`：node / web 两份 tsconfig 类型闸门，均需 0 错。
- `pnpm test`：全量测试（约 4 分钟）。
- `node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2`：仓库自查闸门（文件体量、死导出、IPC 契约、i18n 等）。
- 以上任意一项红了，先在本分支修好再提 PR。

## 不要提交的东西

这些已被 `.gitignore` 挡住，但请自觉别用 `git add -f` 强加：

- 依赖与构建产物：`node_modules/`、`out/`、`release/`、`dist/`
- 用户数据与本地项目：`.qqbat/`、`projects/`、`backups/`、`logs/`、`crashes/`
- 恢复期取证材料：`_recovery/`、`_baseline/`、`deepseek-harness-master/`
- 一次性本地数据库：`test_data.db*`、`*.db-wal`、`*.db-shm`
- 大文件 / 二进制：优先 Git LFS 或外链，别直接拖进仓库

## 代码风格

- 格式化配置在 `.prettierrc`（全库尚未统一跑过 prettier，新文件请对齐现有风格）。
- 文案 / i18n 改动同步 `src/renderer` 下的语言包，避免只改中文漏英文。

## 有问题

先在 Issue 里描述复现步骤与环境；涉及安全的事走 [SECURITY.md](SECURITY.md) 的私有通道，别在公开 Issue 贴细节。
