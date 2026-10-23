// src/main/ipc/metrics.ts
import { ipcMain, BrowserWindow } from 'electron'
import { metricsService } from '../services/metrics'
import { startMetricsSchema, stopMetricsSchema } from '../schemas/metrics'
import { onStatusChange, onMetricData, onNodeEvent } from '../services/runtimeEvents'
import { tryIpc } from './_shared'

let started = false
let cleanupFns: Array<() => void> = []

function broadcastSample(sample: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('metrics:snapshot', sample)
    }
  }
}

export function registerMetricsIpc(): void {
  // 监听机器人状态：自动启动/停止指标收集
  const unsubStatus = onStatusChange((projectPath, state) => {
    if (state.status === 'running' && !started) {
      started = true
      metricsService.start()
    } else if (state.status !== 'running' && started) {
      started = false
      metricsService.stop()
    }
  })
  cleanupFns.push(unsubStatus)

  // 监听 METRIC 行
  const unsubMetric = onMetricData((_projectPath, data) => {
    metricsService.recordMetricLine(data)
  })
  cleanupFns.push(unsubMetric)

  // 监听节点事件：统计执行次数和错误
  const unsubNode = onNodeEvent((_projectPath, event) => {
    if (event.status === 'enter') {
      metricsService.recordNodeExecution()
    } else if (event.status === 'error') {
      metricsService.recordError('node_execution')
    }
  })
  cleanupFns.push(unsubNode)

  // 转发聚合数据到渲染层
  const unsubData = metricsService.onData((sample) => {
    broadcastSample(sample)
  })
  cleanupFns.push(unsubData)

  // metrics:getSnapshot — 立即获取当前快照
  ipcMain.handle('metrics:getSnapshot', async () => {
    return tryIpc(() => metricsService.getSnapshot())
  })

  ipcMain.handle('metrics:start', async (_event, args: unknown) => {
    const parsed = startMetricsSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      metricsService.start()
      started = true
    })
  })

  ipcMain.handle('metrics:stop', async (_event, args: unknown) => {
    const parsed = stopMetricsSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      metricsService.stop()
      started = false
    })
  })

  ipcMain.handle('metrics:history', async () => {
    return tryIpc(() => metricsService.getHistory())
  })
}

// 清理（用于测试/HMR）
export function cleanupMetricsIpc(): void {
  for (const fn of cleanupFns) {
    fn()
  }
  cleanupFns = []
  started = false
}
