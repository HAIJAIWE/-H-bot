// src/shared/types/debug.ts

// =============================================================================
// 节点级调试（低代码模式专用，已存在）
// =============================================================================

/** 断点定义 */
export interface Breakpoint {
  nodeId: string
  enabled: boolean
  condition?: string // 条件断点表达式（可选）
}

/** 变量信息 */
export interface DebugVar {
  name: string
  value: string
  type: string
  portId?: string // 关联端口 ID（可选）
}

/** 调用栈帧 */
export interface DebugFrame {
  nodeId: string
  nodeLabel: string
  enteredAt: string
  variables: DebugVar[]
}

/** 调试状态 */
export type DebugStatus = 'idle' | 'running' | 'paused' | 'stepping'

/** 完整调试状态 */
export interface DebugState {
  status: DebugStatus
  pausedNodeId?: string
  variables: DebugVar[]
  callStack: DebugFrame[]
}

// =============================================================================
// 源码级调试（高代码模式专用，基于 debugpy + DAP 协议）
// =============================================================================

/** 源码级断点（行断点，对应 DAP Breakpoint） */
export interface SourceBreakpoint {
  /** 相对项目根的文件路径（如 'src/plugins/hello/__init__.py'） */
  filePath: string
  /** 1-based 行号 */
  line: number
  /** 1-based 列号（可选，默认 1） */
  column?: number
  /** 是否启用 */
  enabled: boolean
  /** 条件表达式（Python 表达式，结果为 False 时不停） */
  condition?: string
  /** 命中次数条件（如 '>5' 表示第 6 次开始才停） */
  hitCondition?: string
  /** 日志点（命中时输出此模板，不暂停） */
  logMessage?: string
  /** 服务端返回的实际 ID（debugpy 确认后才有） */
  id?: number
  /** 服务端确认状态：true 表示已验证，false 表示无效（如行号不在可执行代码上） */
  verified?: boolean
  /** 验证失败时的提示消息 */
  message?: string
}

/**
 * 函数断点（不依赖行号，按函数名设置；对应 DAP FunctionBreakpoint）。
 *
 * debugpy 支持模块级函数断点；类方法需要传 `Class.method`，但 debugpy 实际只对模块级
 * 函数生效（类方法会被解释为名为 "Class.method" 的函数，多数情况下无法匹配）。
 * 用户应填模块级函数名，如 `handle_message` 或 `plugins.hello.on_command`。
 */
export interface FunctionBreakpoint {
  /** 函数名（用户输入，如 `handle_message` / `plugins.hello.on_command`） */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 条件表达式（Python 表达式，结果为 False 时不停） */
  condition?: string
  /** 命中次数条件（如 '>5' 表示第 6 次开始才停） */
  hitCondition?: string
  /** 服务端返回的实际 ID（debugpy 确认后才有） */
  id?: number
  /** 服务端确认状态：true 表示已验证，false 表示无效（如函数名不存在） */
  verified?: boolean
  /** 验证失败时的提示消息 */
  message?: string
}

/** 源码调用栈帧 */
export interface SourceFrame {
  /** DAP frameId（用于 evaluate / scopes / variables 等请求） */
  frameId: number
  /** 函数名 */
  name: string
  /** 源码位置 */
  source: {
    /** 相对项目根的文件路径 */
    path: string
    /** 1-based 行号 */
    line: number
    /** 1-based 列号 */
    column: number
  }
  line: number
  column: number
  /** 模块/类的展示名（如 'src.plugins.hello'） */
  presentationHint?: string
}

/** 源码变量（DAP Variable 映射） */
export interface SourceVariable {
  name: string
  value: string
  type?: string
  /** variablesReference > 0 表示该变量有子变量（对象/列表/字典），需要再请求 getVariables */
  variablesReference: number
  presentationHint?: string
  /** 可用于 evaluate 的表达式（如 'obj.attr'） */
  evaluateName?: string
}

/** Watch 表达式项 */
export interface WatchExpression {
  expression: string
  value?: string
  error?: string
  variablesReference?: number
}

/** REPL 历史条目（调试控制台用户输入 + 求值结果） */
export interface ReplHistoryEntry {
  /** 用户输入的表达式 */
  expression: string
  /** 求值结果（成功时） */
  value?: string
  /** 求值错误（失败时） */
  error?: string
  /** DAP variablesReference（> 0 表示结果是对象/列表，可展开） */
  variablesReference?: number
  /** 类型信息（DAP 返回的 type 字段，如 'int' / 'str' / 'list'） */
  type?: string
  /** 时间戳（ms） */
  timestamp: number
}

/** 源码调试器状态 */
export type SourceDebuggerStatus =
  | 'idle'          // 未启动
  | 'starting'      // 启动中（debugpy 监听 + 子进程启动）
  | 'running'       // 运行中
  | 'paused'        // 已暂停（命中断点 / step / 异常）
  | 'terminated'    // 已终止
  | 'error'         // 异常退出

/** 完整源码调试状态（前端订阅） */
export interface SourceDebuggerState {
  status: SourceDebuggerStatus
  /** 当前栈顶帧（status === 'paused' 时有值） */
  currentFrame?: SourceFrame
  /** 调用栈 */
  stackTrace: SourceFrame[]
  /** 顶层变量（基于 currentFrame 的 Locals + Arguments） */
  variables: SourceVariable[]
  /** Watch 表达式求值结果 */
  watchExpressions: WatchExpression[]
  /** 错误信息（status === 'error' 时有值） */
  error?: string
  /** debugpy 监听端口（启动后才有） */
  port?: number
  /** 子进程 PID */
  pid?: number
}

/** Stopped 事件原因 */
export type StopReason = 'breakpoint' | 'step' | 'exception' | 'pause' | 'entry' | 'function breakpoint'

/** 调试输出事件（DAP output event 映射） */
export interface DebugOutputEvent {
  /** 类别：console（REPL 输出）/ stdout / stderr / telemetry */
  category: string
  /** 输出文本 */
  output: string
  /** 关联源码位置（可选） */
  filePath?: string
  line?: number
  column?: number
  /** DAP variablesReference（用于格式化带变量的输出） */
  variablesReference?: number
}

/** 启动调试会话选项 */
export interface DebugSessionOptions {
  /** debugpy 监听端口（默认 0 = 自动分配空闲端口） */
  port?: number
  /** 启动后立即停在入口（stopOnEntry） */
  stopOnEntry?: boolean
  /** 异常时暂停（默认 false，仅未捕获异常暂停） */
  breakOnException?: boolean
  /** 调试启动时附加的环境变量 */
  env?: Record<string, string>
  /** 透传给 bot.py 的额外参数 */
  extraArgs?: string[]
}
