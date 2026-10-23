// src/shared/types/log.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  /** 可选的节点 ID，用于追踪哪个节点产生的日志 */
  nodeId?: string
  /** 链路追踪 ID，用于追踪单条消息的完整处理流程 */
  traceId?: string
  /** 项目路径，用于按项目隔离日志 */
  projectPath?: string
}
