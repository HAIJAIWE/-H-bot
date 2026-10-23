// src/main/ipc/history.ts
import { ipcMain } from 'electron'
import { historyService } from '../services/history'
import { historyListSchema, historyRestoreSchema, historyEntrySchema } from '../schemas/history'
import { tryIpc, tryIpcAsync } from './_shared'

export function registerHistoryIpc(): void {
  ipcMain.handle('history:list', async (_event, args: unknown) => {
    const parsed = historyListSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => historyService.list(parsed.data.projectPath))
  })

  ipcMain.handle('history:restore', async (_event, args: unknown) => {
    const parsed = historyRestoreSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => historyService.restore(parsed.data.projectPath, parsed.data.fileName))
  })

  ipcMain.handle('history:read', async (_event, args: unknown) => {
    const parsed = historyEntrySchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => historyService.read(parsed.data.projectPath, parsed.data.fileName))
  })
}
