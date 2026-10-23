import { ipcMain } from 'electron'
import { createBackup, listBackups, restoreBackup, createSnapshot } from '../services/backupService'
import { tryIpcAsync } from './_shared'
import {
  backupCreateSchema,
  backupListSchema,
  backupRestoreSchema,
  backupSnapshotSchema
} from '../schemas/launchBackup'

export function registerLaunchBackupIpc(): void {
  ipcMain.handle('backup:create', async (_e, projectPath: string, dbPath: string, description: string) => {
    const parsed = backupCreateSchema.safeParse([projectPath, dbPath, description])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => createBackup(parsed.data[0], parsed.data[1], parsed.data[2]))
  })
  ipcMain.handle('backup:list', async (_e, projectPath: string) => {
    const parsed = backupListSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => listBackups(parsed.data[0]))
  })
  ipcMain.handle('backup:restore', async (_e, projectPath: string, backupName: string) => {
    const parsed = backupRestoreSchema.safeParse([projectPath, backupName])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => restoreBackup(parsed.data[0], parsed.data[1]))
  })
  ipcMain.handle('backup:snapshot', async (_e, projectPath: string, name?: string) => {
    const parsed = backupSnapshotSchema.safeParse([projectPath, name])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => createSnapshot(parsed.data[0], parsed.data[1]))
  })
}
