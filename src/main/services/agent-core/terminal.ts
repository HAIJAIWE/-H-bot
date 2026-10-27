// src/main/services/agent-core/terminal.ts
//
// **持久 shell 会话**（2026-10-18，对齐主流 harness 的 terminal/subprocess）。
//
// 和 run_command 的区别：那个是一次性子进程（起→跑→退），这个是**一条开着的 shell**：
// 可以连续跑命令、保留 cd/环境变量/变量，适合「先 cd 再 build 再看日志」这种连续操作。
//
// 实现要点：每条命令后追加一个唯一 marker，读到 marker 就算这条命令结束 ——
// 不猜输出边界，也不靠等待固定时长（那种写法在慢命令上必错）。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface ShellRunResult {
  ok: boolean
  output: string
  /** 超时被杀（与「命令返回非 0」不同，调用方要分开处理） */
  timedOut?: boolean
}

export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'

export interface ShellSendResult {
  ok: boolean
  output: string
  waitReason: TerminalWaitReason
}

export class ShellSession {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private baseOffset = 0
  private lastOutputLength = 0

  static readonly RETAIN_LIMIT_CHARS = 1_000_000

  constructor(private readonly opts: { cwd: string; shell?: string }) {}

  start(): void {
    if (this.proc) return
    this.proc = spawn(
      this.opts.shell ?? 'powershell.exe',
      ['-NoLogo', '-NoProfile', '-Command', '-'],
      {
        cwd: this.opts.cwd,
        windowsHide: true,
        stdio: 'pipe',
      },
    ) as ChildProcessWithoutNullStreams
    this.proc.stdout.on('data', d => {
      this.buffer += String(d)
      this.handleBufferGrowth()
    })
    this.proc.stderr.on('data', d => {
      this.buffer += String(d)
      this.handleBufferGrowth()
    })
  }

  private handleBufferGrowth(): void {
    if (this.buffer.length > ShellSession.RETAIN_LIMIT_CHARS) {
      const excess = this.buffer.length - ShellSession.RETAIN_LIMIT_CHARS
      this.baseOffset += excess
      this.buffer = this.buffer.slice(excess)
    }
  }

  get pid(): number | null {
    return this.proc?.pid ?? null
  }

  get alive(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  async run(command: string, timeoutMs = 20000): Promise<ShellRunResult> {
    this.start()
    const proc = this.proc
    if (!proc) return { ok: false, output: '会话没有起来' }
    const marker = '__DSH_DONE_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '__'
    // 记录起始位置，不再重置 buffer
    const startAt = this.baseOffset + this.buffer.length
    proc.stdin.write(command + '\n')
    proc.stdin.write('Write-Output "' + marker + '"\n')
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const at = this.buffer.indexOf(marker, startAt - this.baseOffset)
      if (at >= 0) {
        const output = this.buffer.slice(0, at).replace(/\r/g, '').trimEnd()
        const cleaned = output
          .split('\n')
          .filter(l => !l.startsWith('PS ') && l.trim() !== '')
          .join('\n')
        return { ok: true, output: cleaned }
      }
      if (proc.exitCode !== null) {
        return { ok: false, output: this.buffer }
      }
      await new Promise(r => setTimeout(r, 20))
    }
    this.kill()
    return { ok: false, output: this.buffer, timedOut: true }
  }

  async send(
    text: string,
    opts?: { submit?: boolean; timeoutMs?: number; idleMs?: number; promptPattern?: RegExp },
  ): Promise<ShellSendResult> {
    const timeoutMs = opts?.timeoutMs ?? 10000
    const idleMs = opts?.idleMs ?? 400
    const promptPattern = opts?.promptPattern ?? /[\r\n][^\r\n]*>\s*$/

    this.start()
    const proc = this.proc
    if (!proc) return { ok: false, output: '', waitReason: 'session_exit' }

    // 1. 检查进程是否已退出（发送前的检查）
    if (proc.exitCode !== null || !this.proc) {
      return { ok: true, output: '', waitReason: 'session_exit' }
    }

    // 2. 记录基准位置（用于计算增量输出）
    const snapshotAt = this.baseOffset + this.buffer.length

    // 3. 发送命令（submit=true 时补 \n）
    if (opts?.submit !== false) {
      proc.stdin.write(text + '\n')
    } else {
      proc.stdin.write(text)
    }

    const startedAt = Date.now()
    let lastLength = this.buffer.length
    let consecutiveIdleReads = 0

    while (Date.now() - startedAt < timeoutMs) {
      // 1. 检查进程是否已退出
      if (proc.exitCode !== null || !this.proc) {
        return { ok: true, output: this.filterOutput(snapshotAt), waitReason: 'session_exit' }
      }

      const currentLength = this.buffer.length

      // 2. 检查是否匹配 prompt（看到 PS> 提示符表示可以接受新输入）
      if (promptPattern.test(this.buffer)) {
        consecutiveIdleReads++
        if (consecutiveIdleReads >= 2) {
          return { ok: true, output: this.filterOutput(snapshotAt), waitReason: 'stdin_read' }
        }
      } else {
        consecutiveIdleReads = 0
      }

      // 3. 检查是否进入空闲状态（超过 idleMs 没有新输出，且至少等待过一次）
      if (
        currentLength === lastLength &&
        lastLength > snapshotAt &&
        Date.now() - startedAt >= idleMs
      ) {
        return { ok: true, output: this.filterOutput(snapshotAt), waitReason: 'inferred_idle' }
      }

      lastLength = currentLength
      await new Promise(r => setTimeout(r, 50))
    }

    // 4. 超时
    return { ok: true, output: this.filterOutput(snapshotAt), waitReason: 'timeout' }
  }

  private filterOutput(fromIndex: number): string {
    const segment = this.buffer.slice(fromIndex).replace(/\r/g, '')
    const lines = segment.split('\n')
    // 过滤掉 PS > 提示符行，但保留实际命令输出（不以 PS 开头的非空行）
    const filtered = lines.filter(l => !/^\s*PS\s*>\s*$/.test(l) && l.trim() !== '').join('\n')
    return filtered.trimEnd()
  }

  get currentCursor(): number {
    return this.baseOffset + this.buffer.length
  }

  readSince(cursor: number): { chunk: string; cursor: number } {
    if (cursor < this.baseOffset) cursor = this.baseOffset
    const data = this.buffer.slice(cursor - this.baseOffset)
    const newCursor = this.baseOffset + this.buffer.length
    return { chunk: data, cursor: newCursor }
  }

  signal(name: 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP'): boolean {
    if (!this.proc) return false
    try {
      // Windows PowerShell 支持 SIGINT (Ctrl+C) 和 SIGKILL
      if (name === 'SIGINT' || name === 'SIGKILL') {
        return this.proc.kill(name)
      }
      // Windows 不支持 SIGTSTP/SIGTERM，返回 false
      return false
    } catch {
      return false
    }
  }

  kill(): void {
    try {
      this.proc?.kill('SIGKILL')
      this.proc = null
    } catch {
      // 已经退了
    } finally {
      this.proc = null
    }
  }
}
