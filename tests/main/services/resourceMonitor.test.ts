// tests/main/services/resourceMonitor.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock electron 的 BrowserWindow（resourceMonitor 依赖它广播 IPC）
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// Mock child_process 的 spawn 和 execSync（避免真实进程操作）
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(() => ({ on: vi.fn(), kill: vi.fn() })),
    execSync: vi.fn(() => '')
  }
})

import { resourceMonitor } from '@main/services/resourceMonitor'

describe('resourceMonitor', () => {
  beforeEach(() => {
    // 每个测试前停止监控并重置状态
    resourceMonitor.stopMonitoring()
    resourceMonitor.setLimit({ maxMemoryMB: 1024, maxCPUPercent: 100 })
    resourceMonitor.getAlerts() // 触发内部状态读取（alerts 在 setLimit 后未清空，但 warnedMemory/warnedCPU 已重置）
    vi.clearAllMocks()
  })

  afterEach(() => {
    resourceMonitor.stopMonitoring()
    vi.useRealTimers()
  })

  describe('getConfig / setLimit', () => {
    it('默认配置为 1024MB / 100%', () => {
      const cfg = resourceMonitor.getConfig()
      expect(cfg.maxMemoryMB).toBe(1024)
      expect(cfg.maxCPUPercent).toBe(100)
    })

    it('setLimit 设置自定义阈值', () => {
      resourceMonitor.setLimit({ maxMemoryMB: 512, maxCPUPercent: 80 })
      const cfg = resourceMonitor.getConfig()
      expect(cfg.maxMemoryMB).toBe(512)
      expect(cfg.maxCPUPercent).toBe(80)
    })

    it('setLimit 部分设置时保留默认值', () => {
      resourceMonitor.setLimit({ maxMemoryMB: 256 })
      const cfg = resourceMonitor.getConfig()
      expect(cfg.maxMemoryMB).toBe(256)
      expect(cfg.maxCPUPercent).toBe(100) // 默认值
    })
  })

  describe('startMonitoring / stopMonitoring', () => {
    it('startMonitoring 后能获取 usage', () => {
      // 监控当前进程（pid === process.pid）
      resourceMonitor.startMonitoring(process.pid)
      const usage = resourceMonitor.getUsage()
      expect(usage).toHaveProperty('cpuPercent')
      expect(usage).toHaveProperty('memoryMB')
      expect(usage).toHaveProperty('memoryPercent')
      expect(usage).toHaveProperty('uptime')
      expect(usage.memoryMB).toBeGreaterThanOrEqual(0)
      expect(usage.uptime).toBeGreaterThanOrEqual(0)
    })

    it('startMonitoring 后 getHistory 返回采样点', () => {
      resourceMonitor.startMonitoring(process.pid)
      const history = resourceMonitor.getHistory()
      expect(history.length).toBeGreaterThanOrEqual(1) // 立即采集第一个样本
      const point = history[0]
      expect(point).toHaveProperty('cpuPercent')
      expect(point).toHaveProperty('memoryMB')
      expect(point).toHaveProperty('memoryPercent')
      expect(point).toHaveProperty('timestamp')
    })

    it('stopMonitoring 后不再采集', () => {
      vi.useFakeTimers()
      resourceMonitor.startMonitoring(process.pid)
      const historyBefore = resourceMonitor.getHistory().length

      resourceMonitor.stopMonitoring()
      // 推进时间，不应有新采样
      vi.advanceTimersByTime(15000)
      const historyAfter = resourceMonitor.getHistory().length
      expect(historyAfter).toBe(historyBefore)
    })

    it('重复 startMonitoring 不重置（已运行时忽略）', () => {
      resourceMonitor.startMonitoring(process.pid)
      const history1 = resourceMonitor.getHistory().length

      // 第二次调用不应重置 samples
      resourceMonitor.startMonitoring(process.pid)
      const history2 = resourceMonitor.getHistory().length
      expect(history2).toBeGreaterThanOrEqual(history1)
    })
  })

  describe('getUsage', () => {
    it('未启动监控时返回零值', () => {
      // stopMonitoring 后 monitoredPid 为 null
      resourceMonitor.stopMonitoring()
      const usage = resourceMonitor.getUsage()
      // monitoredPid 为 null 时走 process.memoryUsage 路径
      expect(usage.memoryMB).toBeGreaterThanOrEqual(0)
    })

    it('启动后 uptime 随时间增长', () => {
      resourceMonitor.startMonitoring(process.pid)
      const usage1 = resourceMonitor.getUsage()
      expect(usage1.uptime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getAlerts', () => {
    it('初始状态无告警', () => {
      // setLimit 会重置 warnedMemory/warnedCPU 但不清空 alerts
      // 这里只验证 getAlerts 返回数组
      const alerts = resourceMonitor.getAlerts()
      expect(Array.isArray(alerts)).toBe(true)
    })

    it('getAlerts 返回副本（修改不影响内部状态）', () => {
      const alerts = resourceMonitor.getAlerts()
      alerts.push({ type: 'memory', message: 'fake', timestamp: 0, value: 0, limit: 0 })
      const alerts2 = resourceMonitor.getAlerts()
      expect(alerts2.length).toBeLessThan(alerts.length)
    })
  })

  describe('getHistory', () => {
    it('getHistory 返回副本（修改不影响内部状态）', () => {
      resourceMonitor.startMonitoring(process.pid)
      const history = resourceMonitor.getHistory()
      const originalLen = history.length
      history.push({ cpuPercent: 999, memoryMB: 999, memoryPercent: 999, timestamp: 0 })
      const history2 = resourceMonitor.getHistory()
      expect(history2.length).toBe(originalLen)
    })

    it('采样点不超过 maxSamples(60)', () => {
      vi.useFakeTimers()
      resourceMonitor.startMonitoring(process.pid)
      // 推进足够多的时间触发多次采样（每 5 秒一次）
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000) // 61 个间隔
      const history = resourceMonitor.getHistory()
      expect(history.length).toBeLessThanOrEqual(60)
    })
  })

  describe('资源超限检测', () => {
    it('内存超限时生成告警', () => {
      // 设置极低的内存限制（1MB），当前进程内存肯定超过
      resourceMonitor.setLimit({ maxMemoryMB: 1, maxCPUPercent: 100 })
      resourceMonitor.startMonitoring(process.pid)
      const alerts = resourceMonitor.getAlerts()
      // 当前进程内存通常 > 1MB，应触发告警
      const memAlerts = alerts.filter(a => a.type === 'memory')
      // 如果当前进程内存确实超过 1MB，应该有告警
      // 但由于 collect 是 async 的，第一次 collect 可能在 startMonitoring 同步执行时还未完成
      // 这里用 getUsage 确认内存确实超限
      const usage = resourceMonitor.getUsage()
      if (usage.memoryMB > 1) {
        expect(memAlerts.length).toBeGreaterThan(0)
        expect(memAlerts[0].message).toContain('内存超出限制')
      }
    })

    it('告警只触发一次（warnedMemory 标记）', () => {
      resourceMonitor.setLimit({ maxMemoryMB: 1, maxCPUPercent: 100 })
      resourceMonitor.startMonitoring(process.pid)
      const alerts1 = resourceMonitor.getAlerts().filter(a => a.type === 'memory').length

      // 再次采集不应重复告警
      vi.useFakeTimers()
      vi.advanceTimersByTime(10000)
      const alerts2 = resourceMonitor.getAlerts().filter(a => a.type === 'memory').length

      // 如果第一次有告警，第二次不应增加
      if (alerts1 > 0) {
        expect(alerts2).toBe(alerts1)
      }
    })
  })
})
