import { ipcMain } from 'electron'
import { getDashboardStatus, getTimeline, getGroups } from '../services/project/dashboardService'
import { tryIpc } from './_shared'
import { launchDashboardProjectPathSchema } from '../schemas/launchDashboard'

export function registerLaunchDashboardIpc(): void {
  ipcMain.handle('launch:getDashboardStatus', async (_e, projectPath: string) => {
    const parsed = launchDashboardProjectPathSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => getDashboardStatus(parsed.data[0]))
  })
  ipcMain.handle('launch:getTimeline', async (_e, projectPath: string) => {
    const parsed = launchDashboardProjectPathSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => getTimeline(parsed.data[0]))
  })
  ipcMain.handle('launch:getGroups', async (_e, projectPath: string) => {
    const parsed = launchDashboardProjectPathSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => getGroups(parsed.data[0]))
  })
}
