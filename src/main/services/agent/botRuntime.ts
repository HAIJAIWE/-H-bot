// src/main/services/agent/botRuntime.ts
//
// **待接线**：10/22 进行中的「机器人 Agent 循环」抽离，恢复时只留下 23 行片段
// （磁带里也只有 20 行），且全仓库没有任何 import —— 真正的循环在
// services/bot/llm.ts 的 callBotAgent（agent_chat 节点直接调用）。
// 保留空模块，接线时再把节点层那一圈（策略/确认/记忆）搬进来。

export {};
