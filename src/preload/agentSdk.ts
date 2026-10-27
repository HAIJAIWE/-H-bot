// src/preload/agentSdk.ts
//
// 智能体 SDK 的 preload 实现（第 61 批）。契约在 `src/shared/protocol/rpc/agentSdk.ts`。
//
// 这一层只做两件事：
//   1) 把 SDK 的**对象入参**摊成通道需要的**位置参数**（通道形状是历史包袱，不外泄给插件）；
//   2) 保证 SDK 只依赖**已登记**的通道 —— 契约表 `AGENT_METHODS` 与这里的实现一一对应，
//      `tests/guards/protocolContract.test.ts` 会逐条核对（少一个 / 多一个都红）。
//
// 为什么不直接在 SDK 里 `ipcRenderer.invoke('ai:xxx')`：载荷契约闸门靠**静态抠键**
// 核对每个通道的字面量载荷；SDK 若自己拼 invoke，就绕过了那道闸门，等于开第二套真相源。
import type { AgentSdk } from '../shared/protocol/rpc/agentSdk'

/** `api.ai` 那段里被 SDK 用到的能力面（按名取用；签名必须与 preload 的实现一致，typecheck 兜底） */
type AiApi = {
  agentCoreRun: (
    projectPath: string,
    requirement: string,
    threadId?: string,
    maxRounds?: number,
    planFirst?: boolean,
    fullAccess?: boolean,
    allowedTools?: string[],
    preset?: string | null,
    agentMode?: 'blocks' | 'code' | 'duo' | 'creator',
    images?: string[],
    activeFilePath?: string,
  ) => Promise<unknown>
  agentCoreSteer: (projectPath: string, text: string, target?: 'step' | 'turn') => Promise<unknown>
  cancelChat: (projectPath: string) => Promise<unknown>
  isRunning: (projectPath: string) => Promise<unknown>
  tools: () => Promise<unknown>
  listThreads: (projectPath: string) => Promise<unknown>
  getHistory: (projectPath: string, threadId?: string) => Promise<unknown>
  clearThread: (projectPath: string, threadId: string) => Promise<unknown>
  renameThread: (projectPath: string, threadId: string, title: string) => Promise<unknown>
  searchThreads: (projectPath: string, query: string, limit?: number) => Promise<unknown>
  exportThread: (projectPath: string, threadId: string) => Promise<unknown>
  getThreadFeedback: (projectPath: string, threadId: string) => Promise<unknown>
  putMessageFeedback: (payload: {
    projectPath: string
    threadId: string
    messageId: string
    rating: 'positive' | 'negative'
    category?: string
    note?: string
  }) => Promise<unknown>
  deleteMessageFeedback: (
    projectPath: string,
    threadId: string,
    messageId: string,
  ) => Promise<unknown>
  listAiTurns: (projectPath: string) => Promise<unknown>
  previewAiTurn: (projectPath: string, turnId: string, threadId?: string) => Promise<unknown>
  rollbackAiTurn: (projectPath: string, turnId: string, threadId?: string) => Promise<unknown>
  rewindAiTo: (projectPath: string, messageText: string, threadId?: string) => Promise<unknown>
  noteTurn: (projectPath: string, note: string, threadId?: string) => Promise<unknown>
  getConfig: (projectPath?: string) => Promise<unknown>
  getAppConfig: () => Promise<unknown>
  resolveApproval: (callId: string, decision: 'allow' | 'deny' | 'always') => Promise<unknown>
  getParallelToolCalls: () => Promise<unknown>
  setParallelToolCalls: (enabled: boolean, maxParallel: number) => Promise<unknown>
  getThreadTitleRefresh: () => Promise<unknown>
  setThreadTitleRefresh: (mode: 'off' | 'auto') => Promise<unknown>
}

/**
 * 用 preload 里那份 `api.ai` 建出 SDK。
 *
 * 传的是**同一批函数对象**（不是重新 invoke）：渲染层与插件走同一条实现，
 * 校验、守卫、审批都还是那份，不会出现「插件能绕过去」的第二套路径。
 */
export function createAgentSdk(ai: AiApi): AgentSdk {
  return {
    send: input =>
      ai.agentCoreRun(
        input.projectPath,
        input.requirement,
        input.threadId,
        input.maxRounds,
        input.planFirst,
        input.fullAccess,
        input.allowedTools,
        input.preset,
        input.agentMode,
        input.images,
        input.activeFilePath,
      ),
    steer: input => ai.agentCoreSteer(input.projectPath, input.text, input.target),
    stop: input => ai.cancelChat(input.projectPath),
    isRunning: input => ai.isRunning(input.projectPath),
    listTools: () => ai.tools(),
    listThreads: input => ai.listThreads(input.projectPath),
    getHistory: input => ai.getHistory(input.projectPath, input.threadId),
    clearThread: input => ai.clearThread(input.projectPath, input.threadId),
    renameThread: input => ai.renameThread(input.projectPath, input.threadId, input.title),
    searchThreads: input => ai.searchThreads(input.projectPath, input.query, input.limit),
    exportThread: input => ai.exportThread(input.projectPath, input.threadId),
    getThreadFeedback: input => ai.getThreadFeedback(input.projectPath, input.threadId),
    putMessageFeedback: input =>
      ai.putMessageFeedback({
        projectPath: input.projectPath,
        threadId: input.threadId,
        messageId: input.messageId,
        rating: input.rating,
        category: input.category,
        note: input.note,
      }),
    deleteMessageFeedback: input =>
      ai.deleteMessageFeedback(input.projectPath, input.threadId, input.messageId),
    listTurns: input => ai.listAiTurns(input.projectPath),
    previewTurn: input => ai.previewAiTurn(input.projectPath, input.turnId, input.threadId),
    rollbackTurn: input => ai.rollbackAiTurn(input.projectPath, input.turnId, input.threadId),
    rewindTo: input => ai.rewindAiTo(input.projectPath, input.messageText, input.threadId),
    noteTurn: input => ai.noteTurn(input.projectPath, input.note, input.threadId),
    getConfig: input => ai.getConfig(input?.projectPath),
    getAppConfig: () => ai.getAppConfig(),
    resolveApproval: input => ai.resolveApproval(input.callId, input.decision),
    getParallelToolCalls: () => ai.getParallelToolCalls(),
    setParallelToolCalls: input => ai.setParallelToolCalls(input.enabled, input.maxParallel),
    getThreadTitleRefresh: () => ai.getThreadTitleRefresh(),
    setThreadTitleRefresh: input => ai.setThreadTitleRefresh(input.mode),
  }
}
