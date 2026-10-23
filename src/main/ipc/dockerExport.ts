// src/main/ipc/dockerExport.ts
// Docker 导出 IPC 处理器
//
// 注册通道：
//   - docker:export      为项目生成 Docker 部署包
//   - docker:openFolder  在文件管理器中打开导出目录
//
// 进度推送：
//   - docker:progress    实时推送导出阶段与消息（phase + message）

import { ipcMain, BrowserWindow, shell } from 'electron'
import { exportProjectToDocker, type DockerExportPhase } from '../services/dockerExport'
import { dockerExportSchema, dockerOpenFolderSchema } from '../schemas/deploy'
import { tryIpc, tryIpcAsync } from './_shared'
import { assertOpenPathSafe } from '../services/pathGuard'

export function registerDockerExportIpc(): void {
  ipcMain.handle('docker:export', async (event, args: unknown) => {
    const parsed = dockerExportSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const opts = parsed.data

    return tryIpcAsync(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const sendProgress = (phase: DockerExportPhase, message: string) => {
        win?.webContents.send('docker:progress', { phase, message })
      }

      const result = await exportProjectToDocker(
        opts.projectPath,
        {
          adapter: opts.adapter,
          includeNapcat: opts.includeNapcat,
          outputDir: opts.outputDir,
          imageName: opts.imageName,
          port: opts.port
        },
        sendProgress
      )

      if (!result.success) {
        throw new Error(result.error)
      }
      return result
    })
  })

  ipcMain.handle('docker:openFolder', async (_event, args: unknown) => {
    const raw = typeof args === 'string' ? { path: args } : args
    const parsed = dockerOpenFolderSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: '参数 path 为空' }
    }
    return tryIpcAsync(async () => {
      // 安全校验：防止通过 shell.openPath 打开系统目录或执行可执行文件
      assertOpenPathSafe(parsed.data.path)
      await shell.openPath(parsed.data.path)
    })
  })
}
