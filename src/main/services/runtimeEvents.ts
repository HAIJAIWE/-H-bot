// src/main/services/runtimeEvents.ts
//
// **运行时事件总线**：机器人进程 / FlowInterpreter / 翻译器 / 官方适配器
// 都从这里把状态、日志、节点事件、指标行广播给 IPC 层。
//
// 为什么是一个独立模块而不是直接调 ipcMain：
//   · 生产者（服务层）不该依赖 Electron 的窗口/IPC；
//   · IPC 层在启动时 onX() 注册一次，把批量转发交给 batcher；
//   · 测试里可以只订阅、不启动 Electron。
import type { BotLogEntry, BotState, ExecuteNodeEvent } from '../../shared/types/runtime';

type StatusChangeHandler = (projectPath: string, state: BotState) => void;
type LogHandler = (projectPath: string, entry: BotLogEntry) => void;
type NodeEventHandler = (projectPath: string, event: ExecuteNodeEvent) => void;
type MetricDataHandler = (projectPath: string, data: string) => void;

export const statusChangeHandlers = new Set<StatusChangeHandler>();
export const logHandlers = new Set<LogHandler>();
export const nodeEventHandlers = new Set<NodeEventHandler>();
export const metricDataHandlers = new Set<MetricDataHandler>();

/** 注册运行状态变更回调；返回取消注册函数 */
export function onStatusChange(cb: StatusChangeHandler): () => void {
  statusChangeHandlers.add(cb);
  return () => statusChangeHandlers.delete(cb);
}

/** 注册日志回调（运行时日志 + 系统日志共用） */
export function onBotLog(cb: LogHandler): () => void {
  logHandlers.add(cb);
  return () => logHandlers.delete(cb);
}

/** 注册节点执行事件回调（节点进入/退出/出错） */
export function onNodeEvent(cb: NodeEventHandler): () => void {
  nodeEventHandlers.add(cb);
  return () => nodeEventHandlers.delete(cb);
}

/** 注册指标数据回调；data 是 `METRIC:` 之后的原始载荷 */
export function onMetricData(cb: MetricDataHandler): () => void {
  metricDataHandlers.add(cb);
  return () => metricDataHandlers.delete(cb);
}

/** 广播运行状态（由 botManager 依据 TS 运行时状态调用） */
export function emitStatusChange(projectPath: string, state: BotState): void {
  for (const cb of statusChangeHandlers) cb(projectPath, state);
}

/** 广播一条日志条目（source 由具体 emitX 决定） */
export function emitLog(projectPath: string, entry: BotLogEntry): void {
  for (const cb of logHandlers) cb(projectPath, entry);
}

/**
 * 推送一条运行时日志（source: 'bot'）。
 * 由 `runtimeLogParser` 转发 `FlowRuntime` 的输出行，渲染层「输出」面板按 source 区分显示。
 */
export function emitBotLog(
  projectPath: string,
  message: string,
  level: BotLogEntry['level'] = 'info',
  traceId?: string,
): void {
  emitLog(projectPath, {
    timestamp: new Date().toISOString(),
    source: 'bot',
    level,
    message,
    ...(traceId ? { traceId } : {}),
  });
}

/** 公共日志函数：让翻译器、官方适配器、botManager 也能往「输出」面板发系统日志 */
export function emitSystemLog(
  projectPath: string,
  message: string,
  level: BotLogEntry['level'] = 'info',
): void {
  emitLog(projectPath, {
    timestamp: new Date().toISOString(),
    source: 'system',
    level,
    message,
  });
}

/** 广播节点执行事件（由 FlowInterpreter 在节点进入/退出/出错时调用） */
export function emitNodeEvent(projectPath: string, event: ExecuteNodeEvent): void {
  for (const cb of nodeEventHandlers) cb(projectPath, event);
}

/** 广播指标原始行（由运行时日志里的 `METRIC:` 行提取后调用） */
export function emitMetricData(projectPath: string, data: string): void {
  for (const cb of metricDataHandlers) cb(projectPath, data);
}
