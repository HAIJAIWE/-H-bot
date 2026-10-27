// src/renderer/src/lib/ai/executableProtocol.ts
//
// **可执行窗口包的协议辅助**（第 74 批，P4b-1）。
//
// 把"宿主 ⇄ worker"的翻译抽成纯函数：建 init 消息、把会话快照投影成 worker 能吃的形状、
// 解释 worker 回来的消息（视图要过白名单校验，命令要过能力声明）。组件只负责
// Worker 生命周期与 React 渲染，这样这些判断在 node 测试里能直接覆盖。
import {
  WINDOW_VIEW_API_VERSION,
  WINDOW_VIEW_COMMANDS,
  validateWindowView,
  type WindowEntryContext,
  type WindowEntryInitMessage,
  type WindowView,
  type WindowViewCommand,
} from '@shared/plugins/windowView'
import type { WindowPackageInfo } from '@shared/plugins/windowPackage'
import type { AgentSurfaceSnapshot } from './agentSurfaceContext'

/** 宿主发的第一条消息：版本协商 + 命令白名单 */
export function buildInitMessage(spec: WindowPackageInfo): WindowEntryInitMessage {
  return {
    type: 'init',
    apiVersion: WINDOW_VIEW_API_VERSION,
    packageId: spec.id,
    capabilities: [...(spec.capabilities ?? [])],
  }
}

/** 会话快照 → worker 侧只读上下文（只留窗口要用的字段，不带 trace/stats） */
export function toEntryContext(snapshot: AgentSurfaceSnapshot): WindowEntryContext {
  const thread = snapshot.threads.find(item => item.id === snapshot.threadId)
  return {
    projectPath: snapshot.projectPath,
    threadId: snapshot.threadId,
    threads: snapshot.threads.map(item => ({
      id: item.id,
      title: item.title,
      messageCount: item.messageCount,
    })),
    messages: snapshot.messages.map(message => ({
      role: message.role,
      content: message.content,
    })),
    streaming: snapshot.streaming,
    running: snapshot.running,
    pendingApproval: snapshot.pendingApproval
      ? { toolName: snapshot.pendingApproval.toolName }
      : null,
  }
  // thread 仅用于将来"当前线程标题"这类便捷字段；现在不往协议里加冗余字段
}

export type EntryMessageInterpretation =
  | { kind: 'view'; view: WindowView; issues: string[] }
  | { kind: 'command'; command: WindowViewCommand; payload?: string }
  | { kind: 'ignore'; reason: string }

/**
 * 解释 worker 回来的一条消息。
 *
 * 三条纪律：
 * - 视图必须过 `validateWindowView`（白名单节点/深度/数量/文本长度），不合法就忽略；
 * - 命令必须是已知动作**且**在清单 capabilities 里声明过，否则忽略；
 * - payload 只收字符串且限长（命令参数不解释成对象，避免把它当结构化数据透传）。
 */
export function interpretEntryMessage(
  raw: unknown,
  capabilities: readonly WindowViewCommand[],
): EntryMessageInterpretation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'ignore', reason: 'message is not an object' }
  }
  const message = raw as Record<string, unknown>

  if (message.type === 'view') {
    const result = validateWindowView(message.view)
    if (!result.ok) {
      return { kind: 'ignore', reason: `invalid view: ${result.issues.slice(0, 3).join('; ')}` }
    }
    return { kind: 'view', view: result.view, issues: result.issues }
  }

  if (message.type === 'command') {
    const command = message.command
    if (
      typeof command !== 'string' ||
      !(WINDOW_VIEW_COMMANDS as readonly string[]).includes(command)
    ) {
      return { kind: 'ignore', reason: `unknown command: ${String(command)}` }
    }
    if (!capabilities.includes(command as WindowViewCommand)) {
      return {
        kind: 'ignore',
        reason: `command ${command} is not declared in manifest capabilities`,
      }
    }
    const payload = message.payload
    if (payload !== undefined && (typeof payload !== 'string' || payload.length > 500)) {
      return {
        kind: 'ignore',
        reason: 'command payload must be a string of at most 500 characters',
      }
    }
    return {
      kind: 'command',
      command: command as WindowViewCommand,
      ...(typeof payload === 'string' ? { payload } : {}),
    }
  }

  return { kind: 'ignore', reason: `unknown message type: ${String(message.type)}` }
}
