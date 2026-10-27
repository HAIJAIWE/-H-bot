// src/renderer/src/lib/ai/agentSurfaceContext.ts
//
// **智能体窗口的输入契约**（第 70 批，P3 第二刀）。
//
// 第 68/69 批让窗口可注册、可切换；但贡献方拿到的 `render()` 没有参数，
// 想画消息只能自己 `import { useAiStore }` —— 等于把渲染层的私有状态当成公开 API，
// 内部结构一改就会砸掉所有第三方窗口。本文件定义**只读投影 + 命令**：
//   - `getSnapshot()`：项目/线程/消息/运行态/待审批的只读快照。同一份状态内引用稳定，
//     可直接喂 `useSyncExternalStore`（每次 store 变化才换新对象，不会无限重渲染）；
//   - `subscribe()`：状态变了通知，监听者自己重读快照；
//   - `actions`：发消息 / 插话 / 停止 / 回审批 / 新建与切换线程 —— 是**命令**，
//     不暴露 store setter，贡献方无法直接改状态。
//
// 刻意不做：沙箱与权限（P4 插件宿主的事）、细粒度订阅（先整份快照；
// 等消息量大到需要优化时再按「消息 / 运行态」拆成两条流）。
import type { AgentMode } from '@shared/ai/roleDomains'
import { useAiStore, type ChatMessageWithTrace } from '../../stores/aiStore'

/** 待批准的工具调用（快照里的只读副本，形状来自主进程的审批请求） */
export interface AgentSurfaceApproval {
  callId: string
  toolName: string
  args: Record<string, unknown>
  hint: string
}

/** 贡献方需要的一切状态：只读，且同一状态内引用稳定 */
export interface AgentSurfaceSnapshot {
  /** 当前对话所属项目（没有项目时是空串） */
  projectPath: string
  /** 当前任务线程 id */
  threadId: string
  messages: ChatMessageWithTrace[]
  streaming: boolean
  /** 主进程是否真有请求在飞（与 streaming 可能不一致，见 aiStore 注释） */
  running: boolean
  pendingApproval: AgentSurfaceApproval | null
}

/** 窗口能发起的动作（命令，不是 setter） */
export interface AgentSurfaceActions {
  send: (text: string, options?: { images?: string[]; agentMode?: AgentMode }) => Promise<void>
  steer: (text: string, target?: 'step' | 'turn') => Promise<boolean>
  stop: () => void
  resolveApproval: (decision: 'allow' | 'deny' | 'always') => Promise<void>
  newThread: () => void
  switchThread: (threadId: string) => Promise<void>
}

export interface AgentSurfaceContext {
  getSnapshot: () => AgentSurfaceSnapshot
  subscribe: (listener: () => void) => () => void
  actions: AgentSurfaceActions
}

function readSnapshot(): AgentSurfaceSnapshot {
  const s = useAiStore.getState()
  return {
    projectPath: s.conversationPath,
    threadId: s.activeThreadId,
    messages: s.messages,
    streaming: s.streaming,
    running: s.mainProcessRunning,
    pendingApproval: s.pendingApproval,
  }
}

/**
 * 建一份窗口上下文的实例。`AgentSurfaceHost` 每次挂载建一份（`useMemo` 保稳定），
 * 同一个实例给当前生效的那个窗口用。
 */
export function createAgentSurfaceContext(): AgentSurfaceContext {
  let cached = readSnapshot()
  const listeners = new Set<() => void>()
  let unsubscribeStore: (() => void) | null = null

  const projectPath = (): string => useAiStore.getState().conversationPath

  const actions: AgentSurfaceActions = {
    send: (text, options) =>
      useAiStore.getState().sendMessage(projectPath(), text, options?.images, options?.agentMode),
    steer: (text, target) => useAiStore.getState().steer(projectPath(), text, target),
    stop: () => useAiStore.getState().stopStreaming(),
    resolveApproval: decision => useAiStore.getState().resolvePendingApproval(decision),
    newThread: () => useAiStore.getState().newThread(projectPath()),
    switchThread: threadId => useAiStore.getState().switchThread(projectPath(), threadId),
  }

  return {
    getSnapshot: () => cached,
    subscribe: listener => {
      listeners.add(listener)
      if (!unsubscribeStore) {
        unsubscribeStore = useAiStore.subscribe(() => {
          cached = readSnapshot()
          for (const l of listeners) l()
        })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && unsubscribeStore) {
          unsubscribeStore()
          unsubscribeStore = null
        }
      }
    },
    actions,
  }
}
