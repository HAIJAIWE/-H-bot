// src/main/ipc/botManager.ts
import { ipcMain, BrowserWindow } from 'electron'
import { botManager } from '../services/botManager'
import { tryIpc, tryIpcAsync } from './_shared'
import { botManagerProjectPathSchema } from '../schemas/botManager'

export function registerBotManagerIpc(): void {
  // 注册推送回调：bot 状态变化 → 渲染进程
  botManager.on('statusChanged', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('botManager:statusChanged', status)
      }
    }
  })

  // botManager:list — 返回所有 BotStatus[]
  ipcMain.handle('botManager:list', async () => {
    return tryIpcAsync(async () => {
      let bots = botManager.listBots()
      // 如果内存为空，尝试扫描磁盘
      if (bots.length === 0) {
        const paths = await botManager.scanProjectBots()
        for (const p of paths) {
          try { await botManager.registerBot(p) } catch { /* 忽略 */ }
        }
        bots = botManager.listBots()
      }
      return bots
    })
  })

  // botManager:start — 参数 { projectPath }
  ipcMain.handle('botManager:start', async (_event, args: unknown) => {
    const parsed = botManagerProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
    return tryIpcAsync(() => botManager.startBot(parsed.data.projectPath))
  })

  // botManager:stop — 参数 { projectPath }
  ipcMain.handle('botManager:stop', async (_event, args: unknown) => {
    const parsed = botManagerProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
    return tryIpcAsync(() => botManager.stopBot(parsed.data.projectPath))
  })

  // botManager:restart — 参数 { projectPath }
  ipcMain.handle('botManager:restart', async (_event, args: unknown) => {
    const parsed = botManagerProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
    return tryIpcAsync(() => botManager.restartBot(parsed.data.projectPath))
  })

  // botManager:register — 参数 { projectPath }
  ipcMain.handle('botManager:register', async (_event, args: unknown) => {
    const parsed = botManagerProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
    return tryIpcAsync(() => botManager.registerBot(parsed.data.projectPath))
  })

  // botManager:unregister — 参数 { projectPath }
  ipcMain.handle('botManager:unregister', async (_event, args: unknown) => {
    const parsed = botManagerProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
    return tryIpc(() => {
      botManager.unregisterBot(parsed.data.projectPath)
    })
  })
}
