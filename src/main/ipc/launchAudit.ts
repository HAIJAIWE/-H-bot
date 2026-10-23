import { ipcMain } from 'electron'
import { logAudit, listAudit, searchAudit } from '../services/auditService'
import type { AuditEntry } from '../services/auditService'
import { tryIpc } from './_shared'
import {
  auditLogSchema,
  auditListSchema,
  auditSearchSchema
} from '../schemas/launchAudit'

export function registerLaunchAuditIpc(): void {
  ipcMain.handle('audit:log', async (_e, projectPath: string, entry: Omit<AuditEntry, 'id' | 'time'>) => {
    const parsed = auditLogSchema.safeParse([projectPath, entry])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => { logAudit(parsed.data[0], parsed.data[1] as Omit<AuditEntry, 'id' | 'time'>) })
  })
  ipcMain.handle('audit:list', async (_e, projectPath: string, page: number, pageSize: number) => {
    const parsed = auditListSchema.safeParse([projectPath, page, pageSize])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => listAudit(parsed.data[0], parsed.data[1], parsed.data[2]))
  })
  ipcMain.handle('audit:search', async (_e, projectPath: string, query: string) => {
    const parsed = auditSearchSchema.safeParse([projectPath, query])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => searchAudit(parsed.data[0], parsed.data[1]))
  })
}
