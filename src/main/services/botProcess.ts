// src/main/services/botProcess.ts
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import type { BotStatus, BotState, BotLogEntry, ExecuteNodeEvent } from '@shared/types/runtime'
import type { DebugVar } from '@shared/types/debug'
import type { RunningBot } from '@shared/types/launch'
import { BotStateStore } from './statePersistence'
import { MessageQueue } from './messageQueue'
import { debuggerService } from './debugger'
import { logger } from './logger'

export interface BotSession {
  id: string
  projectPath: string
  process: ChildProcess
  status: BotStatus
  startedAt: string
  crashCount: number
  lastCrashTime: string | null
  restartTimer?: ReturnType<typeof setTimeout>
  /** SIGKILL 兜底定时器引用（Unix 下 kill -TERM 后的强制 kill 兜底），进程提前退出时需取消 */
  sigkillTimer?: ReturnType<typeof setTimeout>
  messageQueue?: MessageQueue<string>
  /** 消息队列是否已启动 */
  messageQueueStarted?: boolean
  /** 翻译器桥接端口，自动重启时需透传 */
  bridgePort?: number
  /** 日志缓冲区（FIFO，按 projectPath 隔离，最多 MAX_LOG_BUFFER 条） */
  logBuffer: BotLogEntry[]
  /** 日志缓冲区是否已触发截断通知（避免每次截断都通知前端） */
  logBufferTruncated: boolean
  /** 最近一次收到子进程 stdout/stderr 数据的时间戳 */
  lastStdoutTime: number
  /** 心跳检测定时器 */
  heartbeatTimer?: ReturnType<typeof setInterval>
}

const sessions = new Map<string, BotSession>()
const CRASH_WINDOW_MS = 5 * 60 * 1000 // 5 分钟
const MAX_CRASHES = 3

/**
 * 独立的 projectPath 级别崩溃历史，不随 session 生命周期消失。
 *
 * 修复 crashloop 保护失效：旧实现把 lastCrashTime 绑在 session 上，
 * 崩溃重启后旧 session 被 sessions.delete(id) 删除，lastCrashTime 丢失，
 * getCrashesInWindow 永远返回 ≤1，MAX_CRASHES=3 上限永远不会触发，
 * bot 持续崩溃时无限重启。改为按 projectPath 维护独立历史。
 */
const crashHistory = new Map<string, number[]>() // projectPath → 崩溃时间戳数组

/** 记录一次崩溃到独立历史，自动淘汰窗口外的旧记录 */
function recordCrash(projectPath: string): void {
  const now = Date.now()
  const history = (crashHistory.get(projectPath) ?? []).filter(t => now - t < CRASH_WINDOW_MS)
  history.push(now)
  crashHistory.set(projectPath, history)
}
/** 单个会话日志缓冲区上限（FIFO 淘汰最旧条目） */
const MAX_LOG_BUFFER = 1000
/** 内存监控间隔（毫秒） */
const MEMORY_MONITOR_INTERVAL_MS = 60_000
/** 心跳检测间隔（毫秒）—— 定期检查子进程是否存活 */
const HEARTBEAT_INTERVAL_MS = 30_000
/** 无 stdout 数据输出的超时阈值（毫秒）—— 超过此时间无输出视为异常 */
const STDOUT_STALL_TIMEOUT_MS = 120_000
/** 自动重启延迟（毫秒）—— 崩溃后等待此时间再重启 */
const AUTO_RESTART_DELAY_MS = 3_000
/** SIGKILL 强杀前等待时间（毫秒）—— SIGTERM 后给进程的优雅退出时间 */
const SIGKILL_GRACE_PERIOD_MS = 3_000
/** 子进程首次输出等待超时（毫秒）—— 用于检测进程是否成功启动 */
const STDOUT_FIRST_OUTPUT_TIMEOUT_MS = 3_000

type StatusChangeCallback = (projectPath: string, state: BotState) => void
type LogCallback = (projectPath: string, entry: BotLogEntry) => void
type NodeEventCallback = (projectPath: string, event: ExecuteNodeEvent) => void
type MetricDataCallback = (projectPath: string, data: string) => void

const statusChangeHandlers = new Set<StatusChangeCallback>()
const logHandlers = new Set<LogCallback>()
const nodeEventHandlers = new Set<NodeEventCallback>()
const metricDataHandlers = new Set<MetricDataCallback>()

/**
 * 注册状态变更回调，当机器人运行状态变化时触发
 * @param cb - 状态变更回调函数，接收 projectPath 和新状态
 * @returns 取消注册函数
 */
export function onStatusChange(cb: StatusChangeCallback): () => void {
  statusChangeHandlers.add(cb)
  return () => statusChangeHandlers.delete(cb)
}

/**
 * 注册日志回调，当机器人输出日志时触发
 * @param cb - 日志回调函数，接收 projectPath 和日志条目
 * @returns 取消注册函数
 */
export function onBotLog(cb: LogCallback): () => void {
  logHandlers.add(cb)
  return () => logHandlers.delete(cb)
}

/**
 * 注册节点事件回调，当流程节点进入/退出/出错时触发
 * @param cb - 节点事件回调函数，接收 projectPath 和节点事件
 * @returns 取消注册函数
 */
export function onNodeEvent(cb: NodeEventCallback): () => void {
  nodeEventHandlers.add(cb)
  return () => nodeEventHandlers.delete(cb)
}

/**
 * 注册指标数据回调，当收到机器人指标（消息数、延迟等）时触发
 * @param cb - 指标数据回调函数，接收 projectPath 和原始指标字符串
 * @returns 取消注册函数
 */
export function onMetricData(cb: MetricDataCallback): () => void {
  metricDataHandlers.add(cb)
  return () => metricDataHandlers.delete(cb)
}

function emitStatus(session: BotSession): void {
  const state = getBotState(session)
  for (const cb of statusChangeHandlers) {
    cb(session.projectPath, state)
  }
}

function emitLog(projectPath: string, entry: BotLogEntry): void {
  // 推送到对应 session 的日志缓冲区（按 projectPath 隔离，FIFO 淘汰）
  for (const [, session] of sessions) {
    if (session.projectPath === projectPath) {
      pushToLogBuffer(session, entry)
    }
  }
  // 转发给所有注册的 handler（IPC 层批处理转发到前端各面板）
  for (const cb of logHandlers) {
    cb(projectPath, entry)
  }
}

/**
 * 推送日志到 session 的环形缓冲区。
 * 超过 MAX_LOG_BUFFER 时按 FIFO 淘汰最旧条目；
 * 仅首次截断时通过 logHandlers 通知前端（避免每次截断都通知造成日志风暴）。
 *
 * 注意：此函数不调用 emitLog/emitSystemLog，避免递归推送。
 */
function pushToLogBuffer(session: BotSession, entry: BotLogEntry): void {
  session.logBuffer.push(entry)
  if (session.logBuffer.length > MAX_LOG_BUFFER) {
    // FIFO 淘汰最旧条目（array.shift 在 1000 规模下性能可接受）
    session.logBuffer.shift()
    // 仅第一次截断时通知前端
    if (!session.logBufferTruncated) {
      session.logBufferTruncated = true
      const notice: BotLogEntry = {
        timestamp: new Date().toISOString(),
        source: 'system',
        level: 'warn',
        message: `日志缓冲区已达上限 (${MAX_LOG_BUFFER})，旧日志将被 FIFO 淘汰`
      }
      // 直接通过 handlers 通知，避免递归调用 emitLog
      for (const cb of logHandlers) {
        cb(session.projectPath, notice)
      }
    }
  }
}

/** 公共日志函数：让其他服务（翻译器、官方适配器、botManager）也能往 app 的"输出"面板发日志 */
export function emitSystemLog(projectPath: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  emitLog(projectPath, {
    timestamp: new Date().toISOString(),
    source: 'system',
    level,
    message
  })
}

function emitNodeEvent(projectPath: string, event: ExecuteNodeEvent): void {
  for (const cb of nodeEventHandlers) {
    cb(projectPath, event)
  }
}

function emitMetricData(projectPath: string, data: string): void {
  for (const cb of metricDataHandlers) {
    cb(projectPath, data)
  }
}

function getBotState(session: BotSession): BotState {
  const now = Date.now()
  const started = new Date(session.startedAt).getTime()
  return {
    status: session.status,
    pid: session.process.pid ?? null,
    startedAt: session.startedAt,
    crashCount: session.crashCount,
    lastCrashTime: session.lastCrashTime,
    uptime: session.status === 'running' ? Math.floor((now - started) / 1000) : null
  }
}

/**
 * 启动机器人进程
 * @param projectPath - 项目根路径
 * @param bridgePort - 翻译器桥接端口，自动重启时需透传以保持连接
 * @returns 会话 ID
 * @throws 项目已在运行中时抛出错误
 */
export function startBot(projectPath: string, bridgePort?: number): string {
  // 检查是否已有运行中的会话
  for (const [, s] of sessions) {
    if (s.projectPath === projectPath && s.status === 'running') {
      throw new Error(`项目已在运行中: ${projectPath}`)
    }
  }

  // 从之前的会话继承崩溃计数
  let prevCrashCount = 0
  for (const [, s] of sessions) {
    if (s.projectPath === projectPath) {
      prevCrashCount = s.crashCount
      break
    }
  }

  const id = `bot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const botPy = join(projectPath, 'bot.py')
  const isWin = process.platform === 'win32'
  const python = join(projectPath, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python3')

  // 加载上次持久化的状态，注入为环境变量
  const stateService = BotStateStore.getInstance()
  const savedKeys = stateService.getAllKeys(projectPath).state  // 仅 runtime_state 表
  const stateEnvVars: Record<string, string> = {}
  for (const key of savedKeys) {
    const value = stateService.getState(projectPath, key)
    if (value !== null) {
      stateEnvVars[`QQBAT_STATE_${key}`] = JSON.stringify(value)
    }
  }

  // 组装启动参数，支持 bridgePort
  const botArgs = [botPy]
  if (bridgePort !== undefined) {
    botArgs.push('--qqbat-bridge-port', String(bridgePort))
    stateEnvVars['QQBAT_BRIDGE_PORT'] = String(bridgePort)
  }

  const proc = spawn(python, botArgs, {
    cwd: projectPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TZ: 'Asia/Shanghai', ...stateEnvVars },
    windowsHide: true
  })

  // 创建消息队列，用于 stdout 行处理
  const msgQueue = new MessageQueue<string>({
    maxConcurrent: 5,
    timeoutMs: 30_000,
    maxPerSecond: 20
  })
  msgQueue.setProcessor((line: string) => {
    // 链路追踪 ID 解析: [TRACE:{traceId}]
    const traceMatch = line.match(/\[TRACE:([^\]]+)\]/)
    const traceId = traceMatch ? traceMatch[1] : undefined

    // 节点事件解析: [NODE:enter:id-123], [NODE:exit:id-123], [NODE:error:id-123]
    const nodeMatch = line.match(/\[NODE:(enter|exit|error):([^\]]+)\]/)
    if (nodeMatch) {
      emitNodeEvent(projectPath, {
        nodeId: nodeMatch[2],
        timestamp: new Date().toISOString(),
        status: nodeMatch[1] as 'enter' | 'exit' | 'error',
        traceId
      })
      // 调试器：节点退出时清理调用栈
      if (nodeMatch[1] === 'exit' || nodeMatch[1] === 'error') {
        debuggerService.onNodeExit(nodeMatch[2])
      }
    }

    // 指标数据解析: [METRIC:msg_count={n},latency={ms}]
    if (line.includes('[METRIC:')) {
      emitMetricData(projectPath, line)
    }

    // 调试暂停解析: [DEBUG:PAUSE:nodeId:nodeLabel:var1=val1|var2=val2]
    const debugPauseMatch = line.match(/\[DEBUG:PAUSE:([^:]+):([^:]*):?(.*)\]/)
    if (debugPauseMatch) {
      const [, dbgNodeId, dbgNodeLabel, varsStr] = debugPauseMatch
      const variables: DebugVar[] = varsStr
        ? varsStr.split('|')
            .filter(Boolean)
            .map((pair) => {
              const eqIdx = pair.indexOf('=')
              if (eqIdx < 0) return { name: pair, value: 'true', type: 'bool' }
              const name = pair.slice(0, eqIdx)
              const rawValue = pair.slice(eqIdx + 1)
              return { name, value: rawValue, type: typeof rawValue }
            })
        : []
      debuggerService.onNodeHit(dbgNodeId, dbgNodeLabel, variables)
    }

    emitLog(projectPath, {
      timestamp: new Date().toISOString(),
      source: 'bot',
      level: 'info',
      message: line,
      traceId
    })

    return Promise.resolve()
  })
  msgQueue.start()

  const session: BotSession = {
    id,
    projectPath,
    process: proc,
    status: 'running',
    startedAt: new Date().toISOString(),
    crashCount: prevCrashCount,
    lastCrashTime: null,
    messageQueue: msgQueue,
    messageQueueStarted: true,
    bridgePort,
    // 日志缓冲区按 session 隔离（多实例安全），上限 MAX_LOG_BUFFER 条
    logBuffer: [],
    logBufferTruncated: false,
    lastStdoutTime: Date.now()
  }

  sessions.set(id, session)

  // 启动心跳检测 —— 定期检查子进程存活状态
  session.heartbeatTimer = setInterval(() => {
    try {
      // kill(0) 不发送实际信号，仅检查进程是否存在（Windows 兼容）
      const alive = proc.kill(0)
      if (!alive) {
        session.status = 'crashed'
        emitLog(projectPath, {
          timestamp: new Date().toISOString(),
          source: 'system',
          level: 'error',
          message: '心跳检测：子进程已不存在，标记为崩溃'
        })
        emitStatus(session)
        clearInterval(session.heartbeatTimer!)
        return
      }

      // 检查 stdout 是否长时间无输出（可能进程僵死）
      const idleMs = Date.now() - session.lastStdoutTime
      if (idleMs > STDOUT_STALL_TIMEOUT_MS && session.status === 'running') {
        emitLog(projectPath, {
          timestamp: new Date().toISOString(),
          source: 'system',
          level: 'warn',
          message: `心跳检测：进程已 ${Math.floor(idleMs / 1000)} 秒无输出，可能处于异常状态（PID: ${proc.pid})`
        })
      }
    } catch {
      // kill(0) 抛出 ESRCH 异常说明进程已不存在
      session.status = 'crashed'
      emitLog(projectPath, {
        timestamp: new Date().toISOString(),
        source: 'system',
        level: 'error',
        message: '心跳检测：进程已终止，标记为崩溃'
      })
      emitStatus(session)
      clearInterval(session.heartbeatTimer!)
    }
  }, HEARTBEAT_INTERVAL_MS)
  session.heartbeatTimer.unref?.()

  // stdout → 通过 MessageQueue 排队处理
  proc.stdout?.on('data', (data: Buffer) => {
    session.lastStdoutTime = Date.now()
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      msgQueue.enqueue(line).catch(() => {
        // 处理失败（如超时）忽略，已通过 reject 记录
      })
    }
  })

  // stderr → 日志（warn/error）
  proc.stderr?.on('data', (data: Buffer) => {
    session.lastStdoutTime = Date.now()
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      const level = line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback') ? 'error' : 'warn'
      emitLog(projectPath, {
        timestamp: new Date().toISOString(),
        source: 'bot',
        level,
        message: line
      })
    }
  })

  // 进程退出 → 崩溃检测 + 自动重启
  proc.on('exit', (code, signal) => {
    if (session.status !== 'running') return // 手动停止的不算崩溃

    session.status = 'crashed'
    session.lastCrashTime = new Date().toISOString()

    const isCrash = code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL'
    if (isCrash) {
      session.crashCount++
      // 记录到独立 crashHistory（不随 session 删除而丢失），保证 getCrashesInWindow 累计正确
      recordCrash(projectPath)
      emitLog(projectPath, {
        timestamp: new Date().toISOString(),
        source: 'system',
        level: 'error',
        message: `机器人进程退出 (code=${code}, signal=${signal}), 累计崩溃 ${session.crashCount} 次`
      })

      // 检查崩溃窗口（按 projectPath 查询独立历史，而非遍历 sessions）
      const crashesInWindow = getCrashesInWindow(projectPath)
      if (crashesInWindow < MAX_CRASHES) {
        emitLog(projectPath, {
          timestamp: new Date().toISOString(),
          source: 'system',
          level: 'info',
          message: `将在 3 秒后自动重启 (${crashesInWindow + 1}/${MAX_CRASHES})`
        })
        session.restartTimer = setTimeout(() => {
          try {
            // 重启时透传原 bridgePort，避免翻译器桥接断裂
            startBot(projectPath, session.bridgePort)
            // 清理旧 session 资源（监听器、心跳定时器、日志缓冲区）
            cleanupSessionResources(session)
            sessions.delete(id)
          } catch {
            // 重启失败同样需要清理，否则旧 session 残留导致资源泄漏
            cleanupSessionResources(session)
            sessions.delete(id)
          }
        }, AUTO_RESTART_DELAY_MS)
      } else {
        emitLog(projectPath, {
          timestamp: new Date().toISOString(),
          source: 'system',
          level: 'error',
          message: `崩溃次数已达上限 (${MAX_CRASHES}次/${CRASH_WINDOW_MS / 1000}秒)，停止自动重启`
        })
        // 不再自动重启：清理资源并从 Map 删除，避免 session 残留与日志缓冲区泄漏
        cleanupSessionResources(session)
        sessions.delete(id)
      }
    }

    emitStatus(session)
  })

  proc.on('error', (err) => {
    session.status = 'crashed'
    emitLog(projectPath, {
      timestamp: new Date().toISOString(),
      source: 'system',
      level: 'error',
      message: `启动失败: ${err.message}`
    })
    emitStatus(session)
    // 与 stopBot 路径保持一致：清理监听器、心跳定时器、日志缓冲区，避免泄漏
    cleanupSessionResources(session)
    sessions.delete(id)
  })

  emitLog(projectPath, {
    timestamp: new Date().toISOString(),
    source: 'system',
    level: 'info',
    message: `机器人已启动 (PID: ${proc.pid})`
  })

  emitStatus(session)
  return id
}

function getCrashesInWindow(projectPath: string): number {
  const now = Date.now()
  const history = crashHistory.get(projectPath) ?? []
  return history.filter(t => now - t < CRASH_WINDOW_MS).length
}

/**
 * 清理 session 持有的资源，防止内存泄漏：
 * - 移除子进程及其 stdout/stderr 的所有事件监听器
 * - 清空日志缓冲区（加速 GC）
 * - 重置截断标志
 *
 * 多实例安全：只清理当前 session 的资源，不影响其他 session。
 */
function cleanupSessionResources(session: BotSession): void {
  // 停止消息队列（清理内部定时器与待处理任务），与 stopBot 行为对齐
  // 修复崩溃/重启路径泄漏 messageQueue：proc.on('error') 与 exit 自动重启都走此函数，
  // 旧实现只 stopBot 单独 stop，崩溃重启路径会泄漏 messageQueue 内部 setInterval
  if (session.messageQueue && session.messageQueueStarted) {
    try { session.messageQueue.stop() } catch { /* 已停止 */ }
    session.messageQueueStarted = false
  }
  // 移除子进程的所有事件监听器（proc 对象即使退出，监听器仍保留在对象上直到 GC）
  try { session.process.removeAllListeners() } catch { /* 进程已销毁 */ }
  try { session.process.stdout?.removeAllListeners() } catch { /* ignore */ }
  try { session.process.stderr?.removeAllListeners() } catch { /* ignore */ }
  // 清除心跳检测定时器
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer)
    session.heartbeatTimer = undefined
  }
  // 清空日志缓冲区，加速 GC（session 即将从 Map 中移除，但显式清空更安全）
  session.logBuffer.length = 0
  session.logBufferTruncated = false
}

/**
 * 停止机器人进程，清理所有关联资源（消息队列、监听器、定时器、日志缓冲区）
 * @param projectPath - 项目根路径
 */
export function stopBot(projectPath: string): void {
  for (const [, session] of sessions) {
    if (session.projectPath !== projectPath) continue

    // 清除自动重启定时器
    if (session.restartTimer) {
      clearTimeout(session.restartTimer)
      session.restartTimer = undefined
    }

    if (session.status !== 'running') {
      // 停止消息队列
      if (session.messageQueue) {
        session.messageQueue.stop()
        session.messageQueueStarted = false
      }
      // 清理资源（监听器、日志缓冲区）
      cleanupSessionResources(session)
      sessions.delete(session.id)
      continue
    }

    session.status = 'stopped'

    if (session.process.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(session.process.pid), '/T', '/F'])
        } else {
          session.process.kill('SIGTERM')
          // 保存 SIGKILL 定时器引用到 session，便于在进程提前退出时取消（防止定时器泄漏）
          session.sigkillTimer = setTimeout(() => {
            try { session.process.kill('SIGKILL') } catch { /* 已退出 */ }
          }, SIGKILL_GRACE_PERIOD_MS)
          // 子进程退出时取消待执行的 SIGKILL（已退出则无需再 kill）
          session.process.once('exit', () => {
            if (session.sigkillTimer) {
              clearTimeout(session.sigkillTimer)
              session.sigkillTimer = undefined
            }
          })
        }
      } catch { /* 进程可能已退出 */ }
    }

    // 自动保存运行时状态
    const stateService = BotStateStore.getInstance()
    const now = new Date().toISOString()
    const started = new Date(session.startedAt).getTime()
    const uptime = Math.floor((Date.now() - started) / 1000)
    stateService.setState(projectPath, 'last_stopped_at', now)
    stateService.setState(projectPath, 'last_uptime_seconds', uptime)
    stateService.setState(projectPath, 'last_crash_count', session.crashCount)

    // 停止消息队列
    if (session.messageQueue) {
      session.messageQueue.stop()
      session.messageQueueStarted = false
    }

    emitLog(projectPath, {
      timestamp: now,
      source: 'system',
      level: 'info',
      message: '机器人已停止'
    })

    emitStatus(session)
    // 清理资源（监听器、日志缓冲区）—— 在 emitLog/emitStatus 之后，确保停止日志能正常推送
    cleanupSessionResources(session)
    sessions.delete(session.id)
  }
}

/**
 * 获取指定项目的机器人运行状态
 * @param projectPath - 项目根路径
 * @returns 运行状态，未找到时返回 null
 */
export function getBotStatus(projectPath: string): BotState | null {
  for (const [, session] of sessions) {
    if (session.projectPath === projectPath) {
      return getBotState(session)
    }
  }
  return null
}

/**
 * 向机器人进程 stdin 发送命令并等待首次 stdout 响应
 * @param projectPath - 项目根路径
 * @param command - 要发送的命令字符串
 * @returns 进程 stdout 输出内容，超时时返回提示字符串
 * @throws 机器人未运行或进程 IO 不可用时抛出错误
 */
export async function sendCommand(projectPath: string, command: string): Promise<string> {
  let session: BotSession | undefined
  for (const [, s] of sessions) {
    if (s.projectPath === projectPath) { session = s; break }
  }
  if (!session) throw new Error('机器人未运行')
  const proc = session.process
  if (!proc.stdin || !proc.stdout) throw new Error('进程 IO 不可用')
  return new Promise((resolve) => {
    let resolved = false
    const onData = (data: Buffer) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(data.toString())
      }
    }
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        // 修复监听器残留：超时分支必须显式移除 once('data') 注册的 onData，
        // 否则下一次 sendCommand 注册新 once 后，旧 once 会偷走响应数据
        proc.stdout!.removeListener('data', onData)
        resolve('（超时无输出）')
      }
    }, STDOUT_FIRST_OUTPUT_TIMEOUT_MS)
    proc.stdout!.once('data', onData)
    proc.stdin!.write(command + '\n')
  })
}

/**
 * 重启机器人，先停止再延迟 1 秒后启动，自动透传翻译器桥接端口
 * @param projectPath - 项目根路径
 */
export function restartBot(projectPath: string): void {
  // 先从当前 session 获取 bridgePort，避免重启后翻译器桥接断裂
  // 修复：旧实现 startBot(projectPath) 未传 bridgePort，新 session.bridgePort 为 undefined，
  // bot.py 启动时拿不到桥接端口参数，无法连接翻译器，消息收发链路完全断裂
  let bridgePort: number | undefined
  for (const [, s] of sessions) {
    if (s.projectPath === projectPath) { bridgePort = s.bridgePort; break }
  }
  // 先调用现有的 stopBot
  try { stopBot(projectPath) } catch (e) { logger.warn('[botProcess] 重启前停止 bot 失败:', e) }
  // 1 秒后启动
  setTimeout(() => {
    try { startBot(projectPath, bridgePort) } catch (e) { logger.error('[botProcess] restart failed:', e) }
  }, 1000)
}

/**
 * 列出当前所有运行中的机器人信息
 * @returns 运行中机器人数组，包含项目路径、PID 和启动时间
 */
export function listRunningBots(): RunningBot[] {
  const result: RunningBot[] = []
  for (const [, session] of sessions) {
    result.push({
      projectPath: session.projectPath,
      pid: session.process.pid ?? 0,
      startedAt: session.startedAt ?? new Date().toISOString()
    })
  }
  return result
}

/**
 * 开发环境内存监控（可选）。
 *
 * 注意：此监控为全局性质（监控整个 Node.js/Electron 主进程的堆内存），
 * 不按项目/端口隔离 —— 这是合理的，因为进程内存本身就是所有实例共享的。
 * 定时器调用 unref()，不会阻止进程退出。
 *
 * 泄漏检测策略：维护最近 N 次采样的窗口，若堆内存连续单调增长且增幅超过阈值，
 * 则输出警告（console.warn，仅在主进程控制台可见）。
 */
const MEMORY_SAMPLES = 5
const MEMORY_LEAK_GROWTH_THRESHOLD = 1.5 // 增长 50% 视为疑似泄漏
let memoryMonitorTimer: ReturnType<typeof setInterval> | null = null

function startMemoryMonitor(): void {
  // 仅在开发环境启用
  if (process.env.NODE_ENV !== 'development' && !(process.env as Record<string, string>).ELECTRON_IS_DEV) return
  if (memoryMonitorTimer) return

  const heapSamples: number[] = []

  memoryMonitorTimer = setInterval(() => {
    const mem = process.memoryUsage()
    const heapMB = mem.heapUsed / 1024 / 1024
    const rssMB = mem.rss / 1024 / 1024
    const externalMB = mem.external / 1024 / 1024
    logger.debug(`[memory] heapUsed=${heapMB.toFixed(2)}MB, rss=${rssMB.toFixed(2)}MB, external=${externalMB.toFixed(2)}MB`)
    // 泄漏检测：维护采样窗口，若连续单调增长且首末比值超过阈值则警告
    heapSamples.push(mem.heapUsed)
    if (heapSamples.length > MEMORY_SAMPLES) heapSamples.shift()
    if (heapSamples.length === MEMORY_SAMPLES) {
      let monotonicGrowth = true
      for (let i = 1; i < heapSamples.length; i++) {
        if (heapSamples[i] <= heapSamples[i - 1]) { monotonicGrowth = false; break }
      }
      if (monotonicGrowth && heapSamples[0] > 0) {
        const growthRatio = heapSamples[heapSamples.length - 1] / heapSamples[0]
        if (growthRatio > MEMORY_LEAK_GROWTH_THRESHOLD) {
          logger.warn(
            `[memory] 疑似内存泄漏：堆内存在 ${MEMORY_SAMPLES} 次采样中持续增长 ` +
            `${(heapSamples[0] / 1024 / 1024).toFixed(2)}MB → ${(heapSamples[heapSamples.length - 1] / 1024 / 1024).toFixed(2)}MB ` +
            `(增长 ${((growthRatio - 1) * 100).toFixed(0)}%)`
          )
        }
      }
    }
  }, MEMORY_MONITOR_INTERVAL_MS)

  // 不阻止进程退出
  memoryMonitorTimer.unref?.()
}

// 模块加载时启动内存监控（仅开发环境生效）
startMemoryMonitor()
