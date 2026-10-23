// src/main/ipc/diagnostics.ts
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { basename } from 'path'
import { exportSchema, rendererLogSchema } from '../schemas/diagnostics'
import { exportDiagnostics, type DiagnosticsProgress } from '../services/diagnostics'
import { tryIpc, tryIpcAsync } from './_shared'
import { logger } from '../services/infra/logger'

export function registerDiagnosticsIpc(): void {
  // 渲染层运行日志（画布侧异常、桥接失败）。useFlowBridge 会调它 —— 以前只有 preload
  // 与类型声明、主进程没人接，Electron 直接抛 No handler registered，日志全丢。
  ipcMain.handle('diagnostics:rendererLog', async (_event, args: unknown) => {
    const parsed = rendererLogSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: '参数校验失败: ' + parsed.error.message }
    }
    // 只写日志、不回传数据：调用方（画布桥）还要继续干活，不该被日志失败卡住
    return tryIpc(() => {
      logger.info('[renderer] ' + parsed.data.line)
      return null
    })
  })
  ipcMain.handle('diagnostics:export', async (event, args: unknown) => {
    const parsed = exportSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }

    return tryIpcAsync(async () => {
      const { projectPath } = parsed.data

      // 弹出保存对话框
      const projectName = basename(projectPath)
      const defaultFileName = `diagnostics-${projectName}-${Date.now()}.zip`

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

      const outputPath = saveResult.filePath

      // 进度推送
      const sendProgress = (progress: DiagnosticsProgress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('diagnostics:progress', progress)
        }
      }

      return await exportDiagnostics(projectPath, outputPath, sendProgress)
    })
  })
}
