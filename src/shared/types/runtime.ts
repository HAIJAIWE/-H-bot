// src/shared/types/runtime.ts
//
// 运行时（机器人进程 / 节点事件 / 日志）的共享类型。
// 主进程 emit、preload 转发、渲染层 store 消费**必须同一份形状**，所以放 shared。
// 由 10/18 打包产物还原：字段依据 `src/main/services/botProcess.ts` 的构造点
// （getBotState / emitSystemLog / emitLog / emitNodeEvent）与渲染层消费点反推。

/** 机器人进程状态：stopped → starting → running → stopping/crashed/error */
export type BotStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'error'

/** 状态快照（botProcess.emitStatus → IPC runtime:statusChange → runtimeStore.setBotState） */
export interface BotState {
  status: BotStatus
  /** 子进程 PID；没起来时为 null */
  pid: number | null
  /** ISO 时间字符串（不是时间戳：渲染层直接 new Date(startedAt)） */
  startedAt: string
  /** 5 分钟窗口内的崩溃次数（超过 MAX_CRASHES 不再自动重启） */
  crashCount: number
  /** 最近一次崩溃的时间戳（毫秒）；从未崩溃为 null */
  lastCrashTime: string | null
  /** 已运行秒数；非 running 时为 null（由主进程算，渲染层只做本地刷新） */
  uptime: number | null
}

/** 日志来源：子进程 stdout 记 bot，主进程内部记 system，翻译器/管理器带前缀 */
export type BotLogSource = 'bot' | 'system' | 'translator' | 'manager'

/**
 * 一条运行时日志。
 *
 * `nodeId` 现在由运行时按需补（见 runtimeStore 的兼容读取），所以这里是可选的；
 * `traceId` 来自子进程输出里的 `[TRACE:xxx]` 标记，用于链路过滤。
 */
export interface BotLogEntry {
  /** ISO 时间字符串 */
  timestamp: string
  source: BotLogSource
  level: 'info' | 'warn' | 'error'
  message: string
  nodeId?: string
  traceId?: string
}

/** 节点事件阶段：进入 / 退出 / 出错 */
export type NodeEventStatus = 'enter' | 'exit' | 'error'

/**
 * 一次节点执行的观测事件。
 *
 * 两个来源：主进程解释器直接发（FlowInterpreter.emitNodeEvent，带 duration），
 * 子进程输出 `[NODE:enter:id]` 解析后发（不带 duration —— 耗时只有解释器知道）。
 */
export interface ExecuteNodeEvent {
  nodeId: string
  /** ISO 时间字符串 */
  timestamp: string
  status: NodeEventStatus
  /** 执行耗时（毫秒）；error/子进程解析事件可能没有 */
  duration?: number
  /** 错误信息或附加说明 */
  message?: string
  traceId?: string
}
