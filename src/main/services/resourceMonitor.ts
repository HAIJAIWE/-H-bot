// src/main/services/resourceMonitor.ts
// 资源监控服务 — 采集指定进程的 CPU / 内存使用情况，支持 Windows 外部进程监控

import { totalmem } from 'os'
import { BrowserWindow } from 'electron'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger'

const execAsync = promisify(exec)

export interface ResourceUsage {
  /** CPU 使用率（百分比，0–100） */
  cpuPercent: number
  /** 内存使用量 (MB) */
  memoryMB: number
  /** 内存使用率（百分比） */
  memoryPercent: number
  /** 进程运行时间（秒） */
  uptime: number
}

export interface ResourceLimit {
  maxMemoryMB?: number
  maxCPUPercent?: number
}

export interface ResourceConfig {
  maxMemoryMB: number
  maxCPUPercent: number
}

export interface SamplePoint {
  cpuPercent: number
  memoryMB: number
  memoryPercent: number
  timestamp: number
}

export interface ResourceAlert {
  type: 'memory' | 'cpu'
  message: string
  timestamp: number
  value: number
  limit: number
}

class ResourceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private samples: SamplePoint[] = []
  private alerts: ResourceAlert[] = []
  private readonly intervalMs = 5000 // 5 秒采样一次
  private readonly maxSamples = 60 // 保留最近 60 个采样点
  private lastCpuUsage: { user: number; system: number } | null = null
  private lastCpuTime = 0
  private monitoredPid: number | null = null
  private startTime = 0
  private limit: ResourceLimit = { maxMemoryMB: 1024 }
  private warnedMemory = false
  private warnedCPU = false
  private killedDueToLimit = false

  /** 获取当前配置 */
  getConfig(): ResourceConfig {
    return {
      maxMemoryMB: this.limit.maxMemoryMB ?? 1024,
      maxCPUPercent: this.limit.maxCPUPercent ?? 100
    }
  }

  /** 设置资源限制阈值 */
  setLimit(limit: ResourceLimit): void {
    this.limit = { maxMemoryMB: 1024, ...limit }
    this.warnedMemory = false
    this.warnedCPU = false
    this.killedDueToLimit = false
    // 广播配置变更（通道名与 preload resourceMonitor.onConfig 对齐）
    this.broadcast('resourceMonitor:config', this.getConfig())
  }

  /** 获取告警列表 */
  getAlerts(): ResourceAlert[] {
    return [...this.alerts]
  }

  /** 开始监控指定进程 */
  startMonitoring(pid: number): void {
    if (this.timer) return
    this.monitoredPid = pid
    this.startTime = Date.now()
    this.lastCpuUsage = null
    this.lastCpuTime = 0
    this.samples = []
    this.alerts = []
    this.killedDueToLimit = false
    // 立即采集第一个样本
    this.collect()
    this.timer = setInterval(() => this.collect(), this.intervalMs)
  }

  /** 停止监控 */
  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.monitoredPid = null
  }

  /** 立即获取当前资源占用 */
  getUsage(): ResourceUsage {
    const pid = this.monitoredPid
    if (pid === null || pid === process.pid) {
      const mem = process.memoryUsage()
      const total = totalmem()
      const memoryPercent = total > 0 ? Math.round((mem.rss / total) * 100 * 10) / 10 : 0
      return {
        cpuPercent:
          this.samples.length > 0
            ? this.samples[this.samples.length - 1].cpuPercent
            : 0,
        memoryMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        memoryPercent,
        uptime:
          this.startTime > 0
            ? Math.round((Date.now() - this.startTime) / 1000)
            : 0
      }
    }

    // 外部进程：从最近采样获取
    if (this.samples.length > 0) {
      const last = this.samples[this.samples.length - 1]
      return {
        cpuPercent: last.cpuPercent,
        memoryMB: last.memoryMB,
        memoryPercent: last.memoryPercent,
        uptime:
          this.startTime > 0
            ? Math.round((Date.now() - this.startTime) / 1000)
            : 0
      }
    }

    return { cpuPercent: 0, memoryMB: 0, memoryPercent: 0, uptime: 0 }
  }

  /** 获取历史采样点（用于图表） */
  getHistory(): SamplePoint[] {
    return [...this.samples]
  }

  private async collect(): Promise<void> {
    const pid = this.monitoredPid
    const now = Date.now()
    const total = totalmem()

    let cpuPercent = 0
    let memoryMB = 0

    if (pid === null || pid === process.pid) {
      // 监控当前进程
      const mem = process.memoryUsage()
      const cpu = process.cpuUsage()

      if (this.lastCpuUsage && this.lastCpuTime > 0) {
        const userDiff = cpu.user - this.lastCpuUsage.user
        const sysDiff = cpu.system - this.lastCpuUsage.system
        const totalDiff = userDiff + sysDiff
        const elapsedMicro = (now - this.lastCpuTime) * 1000
        cpuPercent =
          elapsedMicro > 0
            ? Math.min(100, Math.round((totalDiff / elapsedMicro) * 100))
            : 0
      }

      this.lastCpuUsage = { user: cpu.user, system: cpu.system }
      this.lastCpuTime = now
      memoryMB = Math.round((mem.rss / 1024 / 1024) * 10) / 10
    } else {
      // 监控外部进程（Windows 平台）
      const result = await this.readExternalProcessUsage(pid)
      cpuPercent = result.cpuPercent
      memoryMB = result.memoryMB
      this.lastCpuTime = now
    }

    const memoryPercent = total > 0 ? Math.round((memoryMB / (total / 1024 / 1024)) * 100 * 10) / 10 : 0

    const point: SamplePoint = { cpuPercent, memoryMB, memoryPercent, timestamp: now }
    this.samples.push(point)
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples)
    }

    // 检查资源限制 → 超限则 kill 进程
    this.checkLimits(cpuPercent, memoryMB)

    // 通过 IPC 推送 resourceMonitor:usage（通道名与 preload resourceMonitor.onUsage 对齐）
    const usage: ResourceUsage = {
      cpuPercent,
      memoryMB,
      memoryPercent,
      uptime: this.startTime > 0 ? Math.round((now - this.startTime) / 1000) : 0
    }
    this.broadcast('resourceMonitor:usage', usage)

    // 推送 resourceMonitor:status（含限制和最新告警，通道名与 preload resourceMonitor.onStatus 对齐）
    this.broadcast('resourceMonitor:status', {
      usage,
      config: this.getConfig(),
      lastAlert: this.alerts.length > 0 ? this.alerts[this.alerts.length - 1] : null
    })
  }

  /** 使用 Windows wmic 读取外部进程资源 */
  private async readExternalProcessUsage(pid: number): Promise<{ cpuPercent: number; memoryMB: number }> {
    try {
      if (process.platform === 'win32') {
        // 使用 wmic 获取进程 CPU 时间和工作集内存
        // 改用 exec 异步调用，避免 execSync 阻塞 Electron 主线程最多 3 秒
        // pid 是数字类型，无注入风险
        const { stdout: wmicOutput } = await execAsync(
          `wmic process where ProcessId=${pid} get KernelModeTime,UserModeTime,WorkingSetSize /format:csv`,
          { encoding: 'utf-8', timeout: 3000 }
        )
        const lines = wmicOutput.trim().split('\n').filter(Boolean)
        if (lines.length >= 2) {
          const parts = lines[1].split(',')
          if (parts.length >= 4) {
            const kernelTime = parseInt(parts[2], 10) || 0
            const userTime = parseInt(parts[3], 10) || 0
            const workingSet = parseInt(parts[4], 10) || 0

            // 计算 CPU 使用率
            const totalTime = kernelTime + userTime
            const elapsed = Date.now() - this.lastCpuTime
            const cpuPercent = elapsed > 0
              ? Math.min(100, Math.round(((totalTime - (this.lastCpuUsage?.system ?? 0) - (this.lastCpuUsage?.user ?? 0)) / 10000) / elapsed * 100))
              : 0

            this.lastCpuUsage = { user: userTime, system: kernelTime }

            const memoryMB = Math.round((workingSet / 1024 / 1024) * 10) / 10
            return { cpuPercent, memoryMB }
          }
        }
      } else {
        // Unix: 使用 ps 命令
        const { stdout: psOutput } = await execAsync(
          `ps -p ${pid} -o %cpu,rss --no-headers 2>/dev/null`,
          { encoding: 'utf-8', timeout: 3000 }
        )
        const trimmed = psOutput.trim()
        if (trimmed) {
          const [cpuStr, rssStr] = trimmed.split(/\s+/)
          const cpuPercent = Math.round(parseFloat(cpuStr) * 10) / 10 || 0
          const memoryMB = Math.round((parseInt(rssStr, 10) || 0) / 1024 * 10) / 10
          return { cpuPercent, memoryMB }
        }
      }
    } catch {
      // 进程可能已不存在
    }
    return { cpuPercent: 0, memoryMB: 0 }
  }

  private checkLimits(cpuPercent: number, memoryMB: number): void {
    const now = Date.now()
    const maxMem = this.limit.maxMemoryMB ?? 1024

    if (memoryMB > maxMem && !this.warnedMemory && !this.killedDueToLimit) {
      this.warnedMemory = true
      const alert: ResourceAlert = {
        type: 'memory',
        message: `内存超出限制: ${memoryMB}MB > ${maxMem}MB`,
        timestamp: now,
        value: memoryMB,
        limit: maxMem
      }
      this.alerts.push(alert)
      logger.warn(`[ResourceMonitor] ${alert.message}`)

      // Kill 超限进程
      this.killProcessDueToLimit('memory')
    }

    const maxCPU = this.limit.maxCPUPercent ?? 100
    if (maxCPU < 100 && cpuPercent > maxCPU && !this.warnedCPU && !this.killedDueToLimit) {
      this.warnedCPU = true
      const alert: ResourceAlert = {
        type: 'cpu',
        message: `CPU 超出限制: ${cpuPercent}% > ${maxCPU}%`,
        timestamp: now,
        value: cpuPercent,
        limit: maxCPU
      }
      this.alerts.push(alert)
      logger.warn(`[ResourceMonitor] ${alert.message}`)

      this.killProcessDueToLimit('cpu')
    }

    // 限制告警数量
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100)
    }
  }

  private killProcessDueToLimit(type: 'memory' | 'cpu'): void {
    const pid = this.monitoredPid
    if (pid === null || pid === process.pid) {
      logger.warn(`[ResourceMonitor] 无法 kill 当前 Electron 进程`)
      return
    }

    this.killedDueToLimit = true
    logger.warn(`[ResourceMonitor] 因 ${type} 超限，kill 进程 PID=${pid}`)

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'])
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch (err) {
      logger.error(`[ResourceMonitor] kill 进程失败:`, err)
    }

    // 广播告警（通道名与 preload resourceMonitor.onAlert 对齐）
    this.broadcast('resourceMonitor:alert', {
      type,
      message: `进程 ${pid} 因 ${type} 超限已被终止`,
      timestamp: Date.now()
    })
  }

  private broadcast(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }
}

export const resourceMonitor = new ResourceMonitor()
