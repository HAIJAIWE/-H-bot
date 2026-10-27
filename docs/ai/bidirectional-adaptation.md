# 双向适配：DSH 驱动我 / 我驱动 DSH（2026-10-28）

> 第 61 批先把智能体那一面冻结成 `window.qqbat.agent.*`（协议 v1）；本文定的是**下一步为什么抽 AgentRuntime**，
> 以及两条对外适配路线各自的形态、成本和退出策略。

## 一、结论

- 双向适配都走**协议面**，不共享内存、不嵌对方内核。
- 共同前置是 **P1：agent 运行时脱离 Electron**。现在它挂在 `src/main/ipc/aiAgentCore.ts` 上，
  只有我们自己的渲染层能驱动；抽出来之后，MCP 前端、DSH 适配器、CLI、测试都能驱动同一套循环。
- 顺序：**P1 → A（被 DSH 驱动）→ B（驱动 DSH，实验性）**。A 顺带逼出 P2 的"公共面"，
  B 只当适配器做，随时可弃。

## 二、A：DSH 驱动我（便宜，先做）

我们**已经是 MCP server**（`src/main/mcp/server.ts`，`@modelcontextprotocol/sdk`）：

1. DSH 作为宿主，用 MCP（stdio 或 HTTP）连上我们 → 工具、项目上下文、节点能力进 DSH 的工具表；
2. 若要再进一步，把"跑一轮 agent"暴露成 MCP tool/prompt → DSH 的 agent 调我们的 agent；
3. 不需要 DSH 改代码、不碰 asar、不嵌它的运行时。

代价：一个 MCP 前端（已有一半）+ 工具面的白名单/权限（P2 会做）。价值：我们的能力直接进 DSH 生态。

## 三、B：我驱动 DSH（贵，先做实验）

不是把 Cordis 装进主进程 —— 那是"做宿主"里最贵的一档。便宜版本是**进程边界**：

- DSH 侧有 `@deepseek-ai/dsh-headless`（桌面版 0.2.1-rc.3），桌面端本就是"host shell + 打包 web 运行时"；
- 实验路径：我们 spawn headless 子进程 / 连它的主机协议（`hostProtocolVersion 4`），我们当宿主、它当 worker；
- 我们的模型/工具/审批照旧，只把"另一个 agent 运行时"当成可调度资源（与现在调度 node-pty 同级）。

风险：接口**外部未公开且会变**（版本锁 0.2.1-rc.3）→ 只能做成适配器、不能做成依赖，
并提供"连不上就退回本地运行时"的降级。

## 四、P1 的验收（不能被偷换成"能编译"）

1. `src/main/services/agent-runtime/**` 目录 grep 不到 `electron`（守卫文件：`tests/guards/agentRuntimeElectronFree.test.ts`）；
2. 一个**假宿主**（只有 `emit` + `approval`）能驱动一整轮：纯文本、默认拒绝写盘、放开后落盘（`tests/main/services/agent-runtime/runtime.test.ts`）；
3. 旧链路（`aiAgentCore.ts`）行为不变：`aiAgentCore-ipc.test.ts` 等四文件断言**零改动**全绿；
4. `RunTurnInput` / `LoopOptions` 签名不动（测试里 60 处直接构造）。

## 五、版本与退出

- 协议版本：`src/shared/protocol/rpc/version.ts`（当前 1）。改语义/删方法 = major，加方法 = minor。
- A 路线：MCP 是公共标准，DSH 升级不直接冲击我们；工具面变化按 MCP schema 兼容处理。
- B 路线：以 `hostProtocolVersion` 为握手门槛，不匹配就禁用适配器并在设置里明说，不做静默降级到错误行为。
- 许可：DSH 为 MIT，若吸收其代码，沿用 `src/main/vendor/dsh/**` 的 provenance 头。

## 六、批次计划

| 批次       | 交付                                                                   | 验收                                  |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------- |
| 62（本批） | `agent-runtime` 缝（薄包装）+ Electron-free 守卫 + 假宿主测试          | 上述 1/2 绿，旧链路零改动             |
| 63         | 把 `aiAgentCore.ts:240-961` 运行体搬进 runtime，宿主只剩 emit+approval | 旧链路四文件断言零改动全绿            |
| 64         | MCP 前端补齐（工具白名单 + 一轮运行暴露）                              | DSH 连上能看到工具并调通一个只读工具  |
| 65（实验） | dsh headless 适配器（可弃）                                            | 能 spawn 并跑通一次握手，失败自动降级 |
