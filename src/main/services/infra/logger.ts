// src/main/services/infra/logger.ts
//
// 主进程日志门面：Electron 下写 electron-log（文件 + 控制台），纯 Node 下退化为
// console。保留打包产物时代的 API 形状（logger/sink/init_logger/...），但这里
// 是**手写类型**版本 —— 之前从 chunk 还原的版本整文件 any，任何 import 它的
// 模块都会被 TS7005（implicit any）淹掉。
/* eslint-disable @typescript-eslint/no-explicit-any */

import { join } from 'path';
import { userDataPathOrThrow } from './paths';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 底层输出端（electron-log 或 console 二选一） */
export interface LoggerSink {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  /** 记录带上下文的结构化日志 */
  logWithContext: (level: LogLevel, message: string, context?: Record<string, unknown>) => void;
  /** 日志文件路径（纯 Node 环境为空字符串） */
  getLogPath: () => string;
  /** 设置远程上报回调（可选，如 Sentry） */
  setRemoteReporter: (reporter: (level: LogLevel, message: string, meta: { timestamp: string }) => void) => void;
}

/**
 * 检测 Electron 主进程环境；非 Electron（纯 Node 服务）返回 null
 *
 * 纯 Node 下的 console 输出刻意拼成**单参数**：曾把 `[qqbot]` 当独立参数传，
 * 于是测试里 `console.warn.mock.calls[0][0]` 只拿到前缀，任何「警告文案」断言都看不到正文。
 */
export function getElectronApp(): any {
  try {
    const app = require('electron')?.app;
    if (app && typeof app.getPath === 'function') return app;
  } catch {
    /* 非 Electron */
  }
  return null;
}

/** 惰性加载 electron-log；不可用时返回 null */
export function loadElectronLog(): any {
  try {
    const mod = require('electron-log');
    const log = mod?.default ?? mod;
    if (log && typeof log.debug === 'function' && log.transports) return log;
  } catch {
    /* 未安装 */
  }
  return null;
}

export let electronApp: any = null;
export let electronLog: any = null;
export let logFilePath = '';

const noop = (): void => {};
export let sink: LoggerSink = { debug: noop, info: noop, warn: noop, error: noop };

export let logger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  logWithContext: noop,
  getLogPath: () => '',
  setRemoteReporter: noop,
};

let initialized = false;

/** 初始化日志（幂等）。模块被 import 时会自动调用一次。 */
export function init_logger(): void {
  if (initialized) return;
  initialized = true;

  electronApp = getElectronApp();
  electronLog = electronApp ? loadElectronLog() : null;
  logFilePath = '';

  if (electronLog && electronApp) {
    const logDir = userDataPathOrThrow('logs', electronApp);
    electronLog.transports.file.resolvePathFn = () => join(logDir, 'main.log');
    electronLog.transports.file.level = 'info';
    electronLog.transports.file.maxSize = 10 * 1024 * 1024;
    electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    const isDev = !electronApp.isPackaged;
    electronLog.transports.console.level = isDev ? 'debug' : 'warn';
    electronLog.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    if (electronLog.transports.ipc) electronLog.transports.ipc.level = false;
    sink = {
      debug: (...a: any[]) => electronLog.debug(...a),
      info: (...a: any[]) => electronLog.info(...a),
      warn: (...a: any[]) => electronLog.warn(...a),
      error: (...a: any[]) => electronLog.error(...a),
    };
    logFilePath = join(logDir, 'main.log');
  } else {
    const PREFIX = '[qqbot]';
    const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
    const minLevel: LogLevel =
      envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error'
        ? (envLevel as LogLevel)
        : 'info';
    const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const enabled = (l: LogLevel): boolean => ORDER[l] >= ORDER[minLevel];
    sink = {
      debug: (...a: any[]) => {
        if (enabled('debug')) console.debug(`${PREFIX} ${a.map(String).join(' ')}`);
      },
      info: (...a: any[]) => {
        if (enabled('info')) console.info(`${PREFIX} ${a.map(String).join(' ')}`);
      },
      warn: (...a: any[]) => {
        if (enabled('warn')) console.warn(`${PREFIX} ${a.map(String).join(' ')}`);
      },
      error: (...a: any[]) => {
        if (enabled('error')) console.error(`${PREFIX} ${a.map(String).join(' ')}`);
      },
    };
  }

  logger = {
    debug: (...args: any[]) => {
      sink.debug(...args);
    },
    info: (...args: any[]) => {
      sink.info(...args);
    },
    warn: (...args: any[]) => {
      sink.warn(...args);
    },
    error: (...args: any[]) => {
      sink.error(...args);
    },
    logWithContext: (level, message, context) => {
      const ctxStr = context ? ` ${JSON.stringify(context)}` : '';
      sink[level](`${message}${ctxStr}`);
    },
    getLogPath: () => logFilePath,
    setRemoteReporter: (reporter) => {
      const original = { ...sink };
      (['debug', 'info', 'warn', 'error'] as LogLevel[]).forEach((level) => {
        const orig = original[level];
        sink[level] = (...args: any[]) => {
          orig(...args);
          try {
            reporter(level, args.map(String).join(' '), { timestamp: new Date().toISOString() });
          } catch {
            /* 上报失败不影响主流程 */
          }
        };
      });
    },
  };
}

init_logger();
