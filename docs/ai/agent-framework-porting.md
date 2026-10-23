# 把智能体框架搬到其他项目（移植指南，2026-10-20）

> 目标：把 qqbat 的**智能体内核**（循环 / 工具 / 插件 / 上下文管理）复制到另一个项目，
> 而不是把整个 QQ-Bot 低代码平台搬过去。
> 配套脚本：`scripts/export-agent-framework.mjs`（按下面的分层清单复制文件 + 生成清单）。

## 1. 框架由哪些层组成

| 层 | 目录 / 文件 | 职责 | 外部依赖 |
|---|---|---|---|
| L0 共享契约 | `src/shared/ai/`、`src/shared/plugins/`、`src/shared/types/{ai,tool,proposal,llm-presets}.ts` | 类型、工具呈现、失败分类、清单契约 | **零依赖**（纯 TS），最值得先复制 |
| L1 智能体循环 | `src/main/services/agent-core/` | Loop / 工具执行 / 沙箱 / 提示词 / 上下文摘要 | 仅 L0 |
| L2 AI 服务 | `src/main/services/ai/` | Provider 适配、工具注册表、角色、提案、会话落盘 | L0 + L1 + Electron IPC（少量） |
| L3 插件宿主 | `src/main/services/plugins/` | kernel（服务容器）、host、内置插件、沙箱桥、外部装载 | L0 + L1 + Electron IPC |
| L4 IPC 桥 | `src/main/ipc/ai*.ts`、`src/main/schemas/`、`src/preload/index.ts` 的 ai 段 | 渲染层可用 | Electron |
| L5 渲染层 | `src/renderer/src/components/ai/`、`lib/ai/`、`stores/aiStore.ts` | 对话面板 / 工具行 / composer | React + Tailwind + i18n + 项目 store |
| L6 测试 | `tests/{shared,main,renderer}/**` 中 ai/plugins 相关 | 契约与回归 | vitest |

## 2. 三种搬法（按投入选）

### A. 只要"能跑起来的内核"（最小）
复制 **L0 + L1**，自己写一个 20 行的循环驱动（见 `src/main/services/ai/chatRun.ts` 的调用方式）。
产出：一个能在 Node/Electron 主进程里跑的 tool-calling 智能体，不带 UI。

### B. 通常推荐：内核 + 插件系统
复制 **L0 + L1 + L2 + L3**，保留 `kernel.ts` / `host.ts` / `builtinHostPlugins.ts`。
新项目自己的工具按域写成一个插件（`inject: ['tools']`），不要改 host。
产出：可扩展的智能体内核，工具/提示词都能以插件方式增删。

### C. 全量（含对话界面）
在上面基础上补 L4 + L5。注意 L5 的硬耦合：
- `window.qqbat.*` 桥（IPC 通道名要自己换一套）；
- `useProjectStore`（当前项目路径）；
- i18n 键（`ai.*` / `common.*` 两组，可先只搬 zh-CN）；
- Tailwind v4 的 zinc 色板与 `@theme` 变量。

## 3. 用脚本导出

```bash
node scripts/export-agent-framework.mjs D:\other-project\agent-core
```

脚本行为：
1. 只复制上表列出的**框架文件**（不含 bot/流程/画布等业务模块）；
2. 目标目录非空时拒绝，除非传 `--force`；
3. 生成 `MANIFEST.md`：复制了哪些文件、每个文件的外部依赖、还缺什么（IPC / store / i18n）。

## 4. 移植后必须做的五件事

1. **别名**：把 `@shared/*` `@main/*` `@renderer/*` 加进新项目的 tsconfig/vite（否则 import 全红）；
2. **IPC 命名空间**：`ai:*` / `plugin:*` 换成新项目的命名空间，并在 preload 暴露同名桥；
3. **数据目录**：会话 JSONL / 轮次日志原来落在 `.qqbat/`，换成新项目的数据根；
4. **i18n**：先只保留 zh-CN 也能跑（缺键会显示键名，不会崩）；
5. **闸门**：把 `tests/guards` 里与本框架相关的三条（`capabilityLayering`、`silentFailure`、`styleContract`）一起搬，否则后续容易退化。

## 5. 明确不建议复制的东西

- `src/main/services/bot/`、`src/renderer/src/components/canvas/` 等业务模块（与 QQ 机器人强绑定）；
- 本项目的 UI 路由与三栏布局；
- `tests/guards/fileSize.test.ts` 等"本仓库体积阈值"的闸门（数字只对本仓库有意义）。

## 6. 已知限制（复制过去也不会自动解决）

- 会话落盘与轮次日志目前是**文件式**（JSONL），没有数据库层；
- 上下文摘要是**确定性截断**，不是模型摘要（`contextDigest.ts` 的注释写了原因）；
- 插件热重载、跨进程服务网关、profile 组合应用内核都**没做**（见 `plugin-system.md` §14）。

需要其中任何一条时，应该在**新项目里按需求补**，而不是期待"复制过来就有"。
