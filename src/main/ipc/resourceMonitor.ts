// src/main/ipc/resourceMonitor.ts
// 资源监控 IPC — resourceMonitor:start / resourceMonitor:stop / resourceMonitor:getUsage / resourceMonitor:getConfig / resourceMonitor:setConfig / resourceMonitor:getHistory
// 通道名与 preload 暴露的 resourceMonitor.* 命名空间对齐

import { ipcMain } from 'electron'
import { resourceMonitor } from '../services/resourceMonitor'
import { tryIpc } from './_shared'
import {
  resourceMonitorStartSchema,
  resourceMonitorSetConfigSchema
} from '../schemas/resourceMonitor'

export function registerResourceMonitorIpc(): void {
  // resourceMonitor:start — 开始监控
  ipcMain.handle('resourceMonitor:start', async (_event, pid: number) => {
    const parsed = resourceMonitorStartSchema.safeParse({ pid })
    if (!parsed.success) return { ok: false, error: '参数校验失败: pid 必须是正整数' }
    return tryIpc(() => {
      resourceMonitor.startMonitoring(parsed.data.pid)
    })
  })

  // resourceMonitor:stop — 停止监控
  ipcMain.handle('resourceMonitor:stop', async () => {
    return tryIpc(() => {
      resourceMonitor.stopMonitoring()
    })
  })

  // resourceMonitor:getUsage — 立即获取当前资源占用
  ipcMain.handle('resourceMonitor:getUsage', async () => {
    return tryIpc(() => resourceMonitor.getUsage())
  })

  // resourceMonitor:getConfig — 获取资源限制配置
  ipcMain.handle('resourceMonitor:getConfig', async () => {
    return tryIpc(() => resourceMonitor.getConfig())
  })

  // resourceMonitor:setConfig — 设置资源限制配置
  ipcMain.handle('resourceMonitor:setConfig', async (_event, config: { maxMemoryMB?: number; maxCPUPercent?: number }) => {
    const parsed = resourceMonitorSetConfigSchema.safeParse(config)
    if (!parsed.success) return { ok: false, error: '参数校验失败: config 必须是对象' }
    return tryIpc(() => {
      resourceMonitor.setLimit(parsed.data)
    })
  })

  // resourceMonitor:getHistory — 获取历史采样点
  ipcMain.handle('resourceMonitor:getHistory', async () => {
    return tryIpc(() => resourceMonitor.getHistory())
  })
}
