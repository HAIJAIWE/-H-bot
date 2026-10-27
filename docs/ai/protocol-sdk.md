# 智能体协议与 SDK（v1，第 61 批）

> 目标：让第三方插件（工具 / UI / 外部程序）能驱动本程序的智能体，而**不依赖**内部 IPC 通道名。
>
> 这份文档是**人看的那份契约**；机器可读的那份是 `src/shared/protocol/rpc/agentSdk.ts` 里的
> `AGENT_METHODS`，闸门 `tests/guards/protocolContract.test.ts` 保证两者与实现不漂移。

## 1. 为什么要有这一层

本仓的 IPC 是**实现细节**：`ai:agentCoreRun` 这类通道名随批次改过（引擎删过两次、载荷加过很多
字段）。插件如果直接依赖通道，主程序一改就静默失效。

所以分三层：

```
契约（shared，手写）      src/shared/protocol/rpc/agentSdk.ts     ← 版本化、可对账
实现（preload）           src/preload/agentSdk.ts                 ← 把对象入参摊成通道调用
传输（现成通道）          ipcRenderer.invoke('ai:…')              ← 随时可改
```

SDK 暴露在 `window.qqbat.agent`（渲染层）与 `window.qqbat.protocolVersion`（版本号）。

## 2. 版本规则

`src/shared/protocol/rpc/version.ts`：

| 改动                       | 版本   | 插件侧影响               |
| -------------------------- | ------ | ------------------------ |
| 只加方法 / 可选字段        | 次版本 | 旧插件继续可用           |
| 删方法、改语义、加必填字段 | 主版本 | 旧插件必须显式拒绝并提示 |

插件 manifest 用 `engines.apiVersion` 声明兼容范围（字段在 manifest v2 落地，见 P4）。

## 3. v1 冻结面（26 个方法）

全部返回 `Promise<unknown>`：**回执形状是主进程实现细节**，插件要稳定结构需按需申请冻结。

| SDK 方法                | 作用                            | 通道                       |
| ----------------------- | ------------------------------- | -------------------------- |
| `send`                  | 发一轮对话（等价于按回车）      | `ai:agentCoreRun`          |
| `steer`                 | 插话（下一个步边界注入）        | `ai:agentCoreSteer`        |
| `stop`                  | 真的停下这一轮                  | `ai:cancelChat`            |
| `isRunning`             | 这一轮在不在跑                  | `ai:isRunning`             |
| `listTools`             | 工具注册表快照                  | `ai:tools`                 |
| `listThreads`           | 任务线程列表（最后活动倒序）    | `ai:listThreads`           |
| `getHistory`            | 读回对话记忆                    | `ai:getHistory`            |
| `clearThread`           | 清空一条线程（界面 + 磁盘）     | `ai:clearThread`           |
| `renameThread`          | 起名（主进程归一后落盘）        | `ai:renameThread`          |
| `searchThreads`         | 搜线程正文                      | `ai:searchThreads`         |
| `exportThread`          | 导出线程为 Markdown             | `ai:exportThread`          |
| `getThreadFeedback`     | 读反馈表                        | `ai:getThreadFeedback`     |
| `putMessageFeedback`    | 打 👍/👎 + 分类说明             | `ai:putMessageFeedback`    |
| `deleteMessageFeedback` | 撤回反馈                        | `ai:deleteMessageFeedback` |
| `listTurns`             | 可撤销轮次列表                  | `ai:listTurns`             |
| `previewTurn`           | 撤回预览（只读）                | `ai:previewTurn`           |
| `rollbackTurn`          | 撤回一轮（文件 + 流程）         | `ai:rollbackTurn`          |
| `rewindTo`              | 编辑后从此处重开                | `ai:rewindTo`              |
| `noteTurn`              | 把计划处置写进记忆              | `ai:noteTurn`              |
| `getConfig`             | 读配置（可带 projectPath）      | `ai:getConfig`             |
| `getAppConfig`          | 读全局配置（含回退链）          | `ai:getAppConfig`          |
| `resolveApproval`       | 回批准决定（allow/deny/always） | `ai:resolveApproval`       |
| `getParallelToolCalls`  | 并行工具数设置                  | `ai:getParallelToolCalls`  |
| `setParallelToolCalls`  | 设置并行工具数                  | `ai:setParallelToolCalls`  |
| `getThreadTitleRefresh` | 标题自动刷新设置                | `ai:getThreadTitleRefresh` |
| `setThreadTitleRefresh` | 设置标题自动刷新                | `ai:setThreadTitleRefresh` |

## 4. 信任边界

SDK 是**调用面**，不是权限面：

- 能不能调用由主进程裁决（角色写域、预设工具白名单、审批闸门）；
- 插件拿到的 Promise **可能被拒**，必须处理失败（不要吞掉后假装成功）；
- 审批是同一个口子：`resolveApproval` 与界面确认条等价，没人点会超时按拒绝处理；
- 未来插件装进沙箱后，`resolveApproval` 这类"人机回路"仍然走宿主，不交给插件。

## 5. 怎么加一个方法（四件事，少一件闸门红）

1. `src/shared/protocol/rpc/agentSdk.ts`：加 `AgentSdk` 方法 + `AGENT_METHODS` 一行（channel + schema 名）；
2. `src/preload/agentSdk.ts`：在 `AiApi` 里加函数签名 + 在 `createAgentSdk` 里加一行映射；
3. 确认通道已在 `src/preload/index.ts` 的 `api.ai` 里存在（不存在就先加通道，并按闸门要求登记载荷契约）；
4. 升 `PROTOCOL_VERSION`（加方法 = 次版本）并跑 `npx vitest run tests/guards/protocolContract.test.ts`。

## 6. 下一步（不在本批）

- **P1**：把 agent-core 抽成纯 Node 运行时（`createAgentRuntime`），事件流走统一 envelope；
- **P2**：贡献点注册表（工具 / 提示段落 / 插槽 / 设置 / 审批规则收敛到 manifest 驱动）；
- **P3**：`agent.surface` 契约 —— 让「智能体窗口」本身成为可替换的内置插件（`ChatPanel` 拆分）；
- **P4**：manifest v2 + `engines.apiVersion` 校验 + 插件脚手架。

路线与取舍见 `docs/ai/agent-runtime-boundary.md`（运行时边界审计）与对话结论。
