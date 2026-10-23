// src/main/services/logger.ts
//
// 兼容门面：真正的实现是 services/infra/logger.ts（electron-log + console 降级，
// 带 logWithContext / setRemoteReporter / getLogPath）。
//
// 历史上这里是一份只写 console 的 10 行 stub，errorMonitoring 却按完整 Logger
// 调 setRemoteReporter/logWithContext —— 于是类型检查炸在调用方。
// 统一从 infra/logger 再导出，避免出现两份 logger 各自初始化。
export { logger, sink, init_logger, type LogLevel, type Logger, type LoggerSink } from './infra/logger'
