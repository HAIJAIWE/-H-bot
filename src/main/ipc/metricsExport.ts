// src/main/ipc/metricsExport.ts

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { metricsService } from '../services/metrics'
import { exportToCSV, exportToJSON } from '../services/metricsExport'
import { tryIpc, tryIpcAsync } from './_shared'
import { exportToCSVScheme, exportToJSONSchema } from '../schemas/metricsExport'

export function registerMetricsExportIpc(): void {
  // ── metrics:exportToCSV ──────────────────────────────────
  ipcMain.handle('metrics:exportToCSV', async (event) => {
    const parsed = exportToCSVScheme.safeParse({})
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const dataPoints = metricsService.getHistory()
      if (dataPoints.length === 0) {
        throw new Error('没有指标数据可导出')
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      const saveResult = win
        ? await dialog.showSaveDialog(win, {
            title: '导出指标 CSV',
            defaultPath: `metrics-${Date.now()}.csv`,
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
          })
        : await dialog.showSaveDialog({
            title: '导出指标 CSV',
            defaultPath: `metrics-${Date.now()}.csv`,
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
          })

      if (saveResult.canceled || !saveResult.filePath) {
        throw new Error('用户取消')
      }

      exportToCSV(dataPoints, saveResult.filePath)
      return { success: true, filePath: saveResult.filePath }
    })
  })

  // ── metrics:exportToJSON ─────────────────────────────────
  ipcMain.handle('metrics:exportToJSON', async (event) => {
    const parsed = exportToJSONSchema.safeParse({})
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const dataPoints = metricsService.getHistory()
      if (dataPoints.length === 0) {
        throw new Error('没有指标数据可导出')
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      const saveResult = win
        ? await dialog.showSaveDialog(win, {
            title: '导出指标 JSON',
            defaultPath: `metrics-${Date.now()}.json`,
            filters: [{ name: 'JSON 文件', extensions: ['json'] }]
          })
        : await dialog.showSaveDialog({
            title: '导出指标 JSON',
            defaultPath: `metrics-${Date.now()}.json`,
            filters: [{ name: 'JSON 文件', extensions: ['json'] }]
          })

      if (saveResult.canceled || !saveResult.filePath) {
        throw new Error('用户取消')
      }

      exportToJSON(dataPoints, saveResult.filePath)
      return { success: true, filePath: saveResult.filePath }
    })
  })
}
