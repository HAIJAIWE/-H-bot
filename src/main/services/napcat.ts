// src/main/services/napcat.ts
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { get } from 'http'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { app } from 'electron'
import { findFreePort } from './portFinder'
import { logger } from './logger'

export type NapcatStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

export interface NapcatSession {
  projectPath: string
  process: ChildProcess | null
  status: NapcatStatus
  port: number
  napcatPath: string
  pid: number | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, NapcatSession>()

/** HTTP 请求超时（检查 NapCat WS 连接是否可达） */
const HTTP_TIMEOUT_MS = 3000

type StatusCallback = (projectPath: string, status: NapcatStatus, pid: number | null, port: number) => void
const statusHandlers = new Set<StatusCallback>()

export function onNapcatStatusChange(cb: StatusCallback): () => void {
  statusHandlers.add(cb)
  return () => statusHandlers.delete(cb)
}

function emitStatus(session: NapcatSession): void {
  for (const cb of statusHandlers) {
    cb(session.projectPath, session.status, session.pid, session.port)
  }
}

// ── WebUI Token 检测回调 ───────────────────────────────────

type TokenCallback = (projectPath: string, token: string, port: number) => void
const tokenHandlers = new Set<TokenCallback>()

export function onNapcatToken(cb: TokenCallback): () => void {
  tokenHandlers.add(cb)
  return () => tokenHandlers.delete(cb)
}

function emitToken(projectPath: string, token: string, port: number): void {
  for (const cb of tokenHandlers) {
    cb(projectPath, token, port)
  }
}

// ── QQ 号检测回调 ──────────────────────────────────────────

type QqDetectedCallback = (projectPath: string, qq: string) => void
const qqDetectedHandlers = new Set<QqDetectedCallback>()

export function onNapcatQqDetected(cb: QqDetectedCallback): () => void {
  qqDetectedHandlers.add(cb)
  return () => qqDetectedHandlers.delete(cb)
}

function emitQqDetected(projectPath: string, qq: string): void {
  for (const cb of qqDetectedHandlers) {
    cb(projectPath, qq)
  }
}

// ── WS 连接检测 ──────────────────────────────────────────────

/** 通过 HTTP GET 检查 NapCat 是否在监听端口 */
function checkWsConnection(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(`http://127.0.0.1:${port}/`, () => {
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy()
      resolve(false)
    })
  })
}

// ── 心跳检测（每 15 秒） ────────────────────────────────────

function startHeartbeat(session: NapcatSession): void {
  stopHeartbeat(session)
  session.heartbeatTimer = setInterval(async () => {
    // 仅当处于 connected 状态时检测断连
    if (session.status !== 'connected') return

    const ok = await checkWsConnection(session.port)
    if (!ok) {
      session.status = 'reconnecting'
      session.reconnectAttempts = 0
      emitStatus(session)
      stopHeartbeat(session)
      scheduleReconnect(session)
    }
  }, 15000)
}

function stopHeartbeat(session: NapcatSession): void {
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer)
    session.heartbeatTimer = null
  }
}

function stopReconnect(session: NapcatSession): void {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer)
    session.reconnectTimer = null
  }
}

// ── 指数退避重连 ────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_RECONNECT_DELAY = 5000
const MAX_RECONNECT_DELAY = 60000

function scheduleReconnect(session: NapcatSession): void {
  // 清除已有的重连定时器
  stopReconnect(session)

  if (session.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    session.status = 'error'
    session.reconnectAttempts = 0
    emitStatus(session)
    return
  }

  const delay = Math.min(
    INITIAL_RECONNECT_DELAY * Math.pow(2, session.reconnectAttempts),
    MAX_RECONNECT_DELAY
  )
  session.reconnectAttempts++

  session.reconnectTimer = setTimeout(async () => {
    const ok = await checkWsConnection(session.port)
    if (ok) {
      // 重连成功
      session.status = 'connected'
      session.reconnectAttempts = 0
      emitStatus(session)
      startHeartbeat(session)
      return
    }

    // WS 仍断开：检查 NapCat 进程是否还活着
    const processAlive =
      session.process !== null &&
      !session.process.killed &&
      session.process.exitCode === null

    if (!processAlive) {
      // 进程挂了 → kill + 重新 spawn
      await restartNapcatProcess(session)
    }
    // 进程还活着 → 等待 NapCat 自动恢复，继续下一次退避尝试

    scheduleReconnect(session)
  }, delay)
}

/** 重启 NapCat 子进程（用于进程已退出的场景） */
async function restartNapcatProcess(session: NapcatSession): Promise<void> {
  // 先确保旧进程被清理
  if (session.process && !session.process.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(session.process.pid), '/T', '/F'])
      } else {
        session.process.kill('SIGKILL')
      }
    } catch { /* 忽略 */ }
  }

  const napcatDir = dirname(session.napcatPath)
  const isNapcatBat =
    session.napcatPath.endsWith('.bat') || session.napcatPath.endsWith('.cmd')

  // 重启前重新写入 OneBot 11 配置
  await writeOnebotConfig(napcatDir, session.port)

  // .bat/.cmd 文件必须通过 cmd.exe 启动，但避免 shell:true + 字符串拼接（命令注入风险）
  // 改用 cmd.exe /c + 数组参数，shell 元字符不会被解释
  const proc = isNapcatBat
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/c', session.napcatPath], {
        cwd: napcatDir,
        windowsHide: true
      })
    : spawn(session.napcatPath, [], {
        cwd: napcatDir,
        windowsHide: true
      })

  session.process = proc
  session.pid = proc.pid ?? null

  // 监听新进程的 stdout，检测连接成功
  proc.stdout?.on('data', (data: Buffer) => {
    const text = data.toString()
    if (
      text.includes('WebSocket') ||
      text.includes('已连接') ||
      text.includes('OneBot')
    ) {
      // 新进程已就绪，接下来的心跳会检测到 WS 连接
    }
  })

  // 关键：旧进程的 exit 事件可能在新进程启动后才触发，
  // 必须检查 session.process 是否仍是当前 proc，避免覆盖新进程引用（竞态修复）
  proc.on('exit', () => {
    if (session.process === proc) {
      session.process = null
      session.pid = null
    }
  })

  proc.on('error', () => {
    // 启动失败 → 下次退避重试会继续尝试
  })
}

/** 清除所有定时器 */
function clearSessionTimers(session: NapcatSession): void {
  stopHeartbeat(session)
  stopReconnect(session)
}

// ── NapCat OneBot 11 配置写入 ────────────────────────────────

async function writeOnebotConfig(napcatDir: string, port: number): Promise<void> {
  const configDir = join(napcatDir, 'napcat', 'config')
  await mkdir(configDir, { recursive: true })

  const config = {
    network: {
      httpServers: [],
      httpClients: [],
      websocketServers: [
        {
          name: 'qqbat-ws',
          enable: true,
          host: '127.0.0.1',
          port,
          messagePostFormat: 'array',
          reportSelfMessage: false,
          token: '',
          enableForcePushEvent: true,
          debug: false,
          heartInterval: 30000
        }
      ],
      websocketClients: []
    },
    musicSignUrl: '',
    enableLocalFile2Url: false,
    parseMultMsg: false
  }

  await writeFile(join(configDir, 'onebot11.json'), JSON.stringify(config, null, 2), 'utf-8')
}

// ── 应用数据目录 ────────────────────────────────────────────

function appDataDir(): string {
  return join(app.getPath('userData'), 'qqbat-data')
}

/** 保存 NapCat 路径到应用配置 */
export async function saveNapcatPath(napcatPath: string): Promise<void> {
  const dir = appDataDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'napcat-path.json'), JSON.stringify({ napcatPath }, null, 2), 'utf-8')
}

/** 读取保存的 NapCat 路径 */
export async function loadNapcatPath(): Promise<string | null> {
  const file = join(appDataDir(), 'napcat-path.json')
  if (!existsSync(file)) return null
  const raw = await readFile(file, 'utf-8')
  try {
    const parsed = JSON.parse(raw)
    return parsed.napcatPath || null
  } catch (e) {
    logger.warn('[napcat] 状态查询失败:', e)
    return null
  }
}

export async function startNapcat(projectPath: string): Promise<void> {
  // 检查是否已有运行中的 NapCat
  for (const [, s] of sessions) {
    if (s.projectPath === projectPath && s.process && s.status !== 'disconnected') {
      throw new Error('NapCat 已在运行中')
    }
  }

  const napcatPath = await loadNapcatPath()
  if (!napcatPath) {
    throw new Error('NapCat 路径未配置，请先设置 NapCat 路径')
  }

  const port = await findFreePort(8080)
  const napcatDir = dirname(napcatPath)

  // 写入 OneBot 11 配置，让 NapCat 启动 WebSocket 服务端
  await writeOnebotConfig(napcatDir, port)

  // NapCat CLI（无需 QQ 号，扫码登录后自动获取）
  // 实际命令行取决于用户 NapCat 安装方式
  // 支持 napcat.bat 或 napcat CLI
  const isNapcatBat = napcatPath.endsWith('.bat') || napcatPath.endsWith('.cmd')

  // .bat/.cmd 文件必须通过 cmd.exe 启动，但避免 shell:true + 字符串拼接（命令注入风险）
  // 改用 cmd.exe /c + 数组参数，shell 元字符不会被解释
  const proc = isNapcatBat
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/c', napcatPath], {
        cwd: napcatDir,
        windowsHide: true
      })
    : spawn(napcatPath, [], {
        cwd: napcatDir,
        windowsHide: true
      })

  const session: NapcatSession = {
    projectPath,
    process: proc,
    status: 'connecting',
    port,
    napcatPath,
    pid: proc.pid ?? null,
    heartbeatTimer: null,
    reconnectAttempts: 0,
    reconnectTimer: null
  }

  const sessionKey = `${projectPath}-${Date.now()}`
  sessions.set(sessionKey, session)

  // 读取 WebUI token
  try {
    const webuiConfigPath = join(napcatDir, 'napcat', 'config', 'webui.json')
    const raw = await readFile(webuiConfigPath, 'utf-8')
    const webuiConfig = JSON.parse(raw)
    const webuiPort = webuiConfig.port || 6099
    if (webuiConfig.token) {
      emitToken(projectPath, webuiConfig.token, webuiPort)
    }
  } catch { /* webui.json 不存在或解析失败，忽略 */ }

  // 解析 stdout 检测状态
  proc.stdout?.on('data', (data: Buffer) => {
    const text = data.toString()
    if (text.includes('QRCode') || text.includes('二维码')) {
      session.status = 'connecting'
      emitStatus(session)
    }

    // 扫码登录后提取 QQ 号
    // 匹配常见输出格式: "QQ: 123456", "账号: 123456", "account: 123456", "当前账号: 123456"
    const qqMatch = text.match(/(?:QQ|账号|account|当前账号)[^\d]*(\d{5,12})/i)
    if (qqMatch) {
      emitQqDetected(session.projectPath, qqMatch[1])
    }

    if (text.includes('WebSocket') || text.includes('已连接') || text.includes('OneBot')) {
      session.status = 'connected'
      emitStatus(session)
      // 连接成功 → 启动心跳
      startHeartbeat(session)
    }
  })

  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString()
    if (text.toLowerCase().includes('error') || text.includes('失败')) {
      session.status = 'error'
      emitStatus(session)
    }
  })

  proc.on('exit', () => {
    session.process = null
    session.pid = null
    // 重连中不删除 session，让重连逻辑自行处理
    if (session.status === 'reconnecting') return
    clearSessionTimers(session)
    if (session.status !== 'disconnected') {
      session.status = 'disconnected'
      emitStatus(session)
    }
    sessions.delete(sessionKey)
  })

  proc.on('error', () => {
    session.status = 'error'
    emitStatus(session)
  })

  emitStatus(session)
}

export function stopNapcat(projectPath: string): void {
  for (const [, session] of sessions) {
    if (session.projectPath !== projectPath) continue
    // 先清除所有定时器
    clearSessionTimers(session)
    if (session.process && session.process.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(session.process.pid), '/T', '/F'])
        } else {
          session.process.kill('SIGTERM')
          setTimeout(() => {
            try { session.process?.kill('SIGKILL') } catch { /* 已退出 */ }
          }, 3000)
        }
      } catch { /* 进程可能已退出 */ }
    }
    session.status = 'disconnected'
    session.process = null
    session.pid = null
    emitStatus(session)
  }
}

/**
 * 停止所有运行中的 NapCat 进程（应用退出前清理使用）。
 *
 * 与 stopNapcat 区别：不按 projectPath 过滤，直接遍历全部 session。
 * 退出场景下应用即将终止，无需 emitStatus（renderer 已无监听），
 * 也无需等待 proc.on('exit') 触发 sessions.delete —— 直接清空 Map。
 */
export function stopAllNapcat(): void {
  for (const [, session] of sessions) {
    clearSessionTimers(session)
    if (session.process && session.process.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(session.process.pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          session.process.kill('SIGTERM')
          // 不等待 SIGKILL 兜底：before-quit 后进程会被 OS 强制回收
        }
      } catch { /* 进程可能已退出 */ }
    }
    session.status = 'disconnected'
    session.process = null
    session.pid = null
  }
  sessions.clear()
}

export function getNapcatStatus(projectPath: string): { status: NapcatStatus; pid: number | null; port: number | null } {
  for (const [, session] of sessions) {
    if (session.projectPath === projectPath) {
      return { status: session.status, pid: session.pid, port: session.port }
    }
  }
  return { status: 'disconnected', pid: null, port: null }
}
