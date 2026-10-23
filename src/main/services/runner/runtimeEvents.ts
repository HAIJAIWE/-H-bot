// src/main/services/runner/runtimeEvents.ts
//
// 兼容入口：事件总线的**唯一实现**在 `../runtimeEvents`（服务层根目录）。
// 运行时代码历史上有两条导入路径（`services/runtimeEvents` 与 `services/runner/runtimeEvents`），
// 保留本文件让两边指向同一份 Set —— 否则订阅方和广播方各拿一套，日志会静默丢失。
export {
  statusChangeHandlers,
  logHandlers,
  nodeEventHandlers,
  metricDataHandlers,
  onStatusChange,
  onBotLog,
  onNodeEvent,
  onMetricData,
  emitStatusChange,
  emitLog,
  emitBotLog,
  emitSystemLog,
  emitNodeEvent,
  emitMetricData,
} from '../runtimeEvents';
