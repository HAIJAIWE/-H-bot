import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { crashGetReportsSchema, crashReadReportSchema, crashCaptureSchema } from '../schemas/crash'
import {
  getRecentReports,
  readReport,
  clearReports,
  captureException,
  exportDiagnostic
} from '../services/crashReporter'
import { tryIpc, tryIpcAsync, errorMessage } from './_shared'

export function registerCrashReporterIpc(): void {
  // crash:getReports — 获取崩溃报告列表
  ipcMain.handle('crash:getReports', async (_event, args: unknown) => {
    const parsed = crashGetReportsSchema.safeParse(args ?? {})
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    return tryIpcAsync(() => getRecentReports(parsed.data.count))
  })

  // crash:readReport — 读取指定报告详情
  ipcMain.handle('crash:readReport', async (_event, args: unknown) => {
    const parsed = crashReadReportSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    return tryIpcAsync(async () => {
      const report = await readReport(parsed.data.id)
      if (!report) {
        throw new Error('报告不存在')
      }
      return report
    })
  })

  // crash:clearReports — 清空所有崩溃报告
  ipcMain.handle('crash:clearReports', async () => {
    return tryIpcAsync(async () => {
      await clearReports()
      return null
    })
  })

  // crash:capture — 捕获异常上报（fire-and-forget）
  ipcMain.on('crash:capture', (_event, args: unknown) => {
    try {
      const parsed = crashCaptureSchema.safeParse(args)
      if (!parsed.success) {
        return
      }
      const error = new Error(parsed.data.message)
      if (parsed.data.stack) {
        error.stack = parsed.data.stack
      }
      captureException(error, parsed.data.extra)
    } catch { /* crash reporter 自身不应抛出 */ }
  })

  // crash:exportDiagnostic — 导出诊断包
  ipcMain.handle('crash:exportDiagnostic', async (event) => {
    return tryIpcAsync(async () => {
      const defaultFileName = `diagnostic-${app.getName()}-${Date.now()}.zip`

      const win = BrowserWindow.fromWebContents(event.sender)
      const saveResult = win
        ? await dialog.showSaveDialog(win, {
            title: '导出诊断包',
            defaultPath: defaultFileName,
            filters: [{ name: 'ZIP 文件', extensions: ['zip'] }]
          })
        : await dialog.showSaveDialog({
            title: '导出诊断包',
            defaultPath: defaultFileName,
            filters: [{ name: 'ZIP 文件', extensions: ['zip'] }]
          })

      if (saveResult.canceled || !saveResult.filePath) {
        throw new Error('用户取消')
      }

      return await exportDiagnostic(saveResult.filePath)
    })
  })
}
