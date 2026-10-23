// src/main/services/terminal.ts
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

/** 子进程 stdout/stderr 'data' 事件的回调类型 */
type StreamDataCallback = (chunk: Buffer | string) => void

export interface TerminalSession {
  id: string
  process: ChildProcess
  projectPath: string
  // 保存已注册的 data 回调，便于 killTerminal 时移除监听器，防止内存泄漏
  dataCallbacks: Set<StreamDataCallback>
  /** SIGKILL 兜底定时器引用，进程提前退出时需取消（防止定时器泄漏） */
  sigkillTimer?: ReturnType<typeof setTimeout>
}

const sessions = new Map<string, TerminalSession>()

export function createTerminal(projectPath: string): string {
  const id = `term-${Date.now()}-${randomUUID().slice(0, 8)}`
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
  const proc = spawn(shell, [], {
    cwd: projectPath,
    env: { ...process.env, TERM: 'xterm-256color' }
  })
  // Windows: 切换到 UTF-8 代码页，防止中文乱码
  if (process.platform === 'win32') {
    proc.stdin?.write('chcp 65001>nul\r\n')
  }
  sessions.set(id, { id, process: proc, projectPath, dataCallbacks: new Set() })
  return id
}

export function writeTerminal(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session) throw new Error(`终端不存在: ${id}`)
  session.process.stdin?.write(data)
}

export function resizeTerminal(_id: string, _cols: number, _rows: number): void {
  // child_process.spawn 不直接支持 resize
  // 留空供后续 node-pty 升级
}

export function killTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  // 先移除所有 data 监听器，防止 kill 后 stdout 仍触发回调
  for (const cb of session.dataCallbacks) {
    session.process.stdout?.off('data', cb)
    session.process.stderr?.off('data', cb)
  }
  session.dataCallbacks.clear()
  session.process.kill('SIGTERM')
  // 保存 SIGKILL 定时器引用，进程提前退出时取消（防止泄漏）
  session.sigkillTimer = setTimeout(() => {
    if (sessions.has(id)) {
      sessions.get(id)?.process.kill('SIGKILL')
      sessions.delete(id)
    }
  }, 3000)
  // 子进程退出时取消待执行的 SIGKILL
  session.process.once('exit', () => {
    if (session.sigkillTimer) {
      clearTimeout(session.sigkillTimer)
      session.sigkillTimer = undefined
    }
    // 进程已退出，从 sessions 移除（无需等 SIGKILL 定时器）
    if (sessions.has(id)) sessions.delete(id)
  })
}

/**
 * 终止所有终端会话（应用退出前清理使用）。
 *
 * 场景：Electron 默认不会在退出时杀死 spawn 的子进程，cmd.exe/bash 会残留为孤儿进程，
 * 占用终端资源并可能持有文件句柄。before-quit 时遍历所有 session 调用 killTerminal，
 * 确保每个 shell 子进程都收到 SIGTERM（Windows 上由 killTerminal 内部 kill 发送）。
 *
 * 注意：复制 keys 数组再迭代，避免 killTerminal 内部 sessions.delete 修改 Map 影响迭代。
 */
export function killAllTerminals(): void {
  const ids = Array.from(sessions.keys())
  for (const id of ids) {
    try { killTerminal(id) } catch { /* 进程可能已退出 */ }
  }
}

export function registerTerminalDataHandler(id: string, callback: (data: string) => void): void {
  const session = sessions.get(id)
  if (!session) return
  // 包装 string 回调为 StreamDataCallback（Buffer → string 转换）
  const wrapped: StreamDataCallback = (chunk) => callback(typeof chunk === 'string' ? chunk : chunk.toString())
  session.dataCallbacks.add(wrapped)
  session.process.stdout?.on('data', wrapped)
  session.process.stderr?.on('data', wrapped)
}
