// src/main/ipc/buttonPanel.ts
import { ipcMain } from 'electron'
import {
  listButtonPanels,
  getButtonPanel,
  createButtonPanel,
  updateButtonPanel,
  deleteButtonPanel,
  duplicateButtonPanel,
  listBuiltinPanelTemplates,
  importBuiltinPanels,
} from '../services/buttonPanelService'
import { tryIpc } from './_shared'
import {
  buttonPanelListSchema,
  buttonPanelGetSchema,
  buttonPanelCreateSchema,
  buttonPanelUpdateSchema,
  buttonPanelDeleteSchema,
  buttonPanelDuplicateSchema,
  buttonPanelImportBuiltinSchema,
} from '../schemas/buttonPanel'

export function registerButtonPanelIpc(): void {
  ipcMain.handle('buttonPanel:list', async (_e, projectPath: string) => {
    const parsed = buttonPanelListSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => listButtonPanels(parsed.data[0]))
  })

  ipcMain.handle('buttonPanel:get', async (_e, projectPath: string, panelId: string) => {
    const parsed = buttonPanelGetSchema.safeParse([projectPath, panelId])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const panel = getButtonPanel(parsed.data[0], parsed.data[1])
      if (!panel) throw new Error(`面板不存在：${parsed.data[1]}`)
      return panel
    })
  })

  ipcMain.handle('buttonPanel:create', async (_e, projectPath: string, payload: { name: string; description?: string; keyboard?: unknown }) => {
    const parsed = buttonPanelCreateSchema.safeParse([projectPath, payload])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => createButtonPanel(
      parsed.data[0],
      parsed.data[1].name,
      parsed.data[1].description ?? '',
      parsed.data[1].keyboard
    ))
  })

  ipcMain.handle('buttonPanel:update', async (_e, projectPath: string, payload: { panelId: string; patch?: Record<string, unknown> }) => {
    const parsed = buttonPanelUpdateSchema.safeParse([projectPath, payload])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => updateButtonPanel(parsed.data[0], parsed.data[1].panelId, parsed.data[1].patch ?? {}))
  })

  ipcMain.handle('buttonPanel:delete', async (_e, projectPath: string, panelId: string) => {
    const parsed = buttonPanelDeleteSchema.safeParse([projectPath, panelId])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const ok = deleteButtonPanel(parsed.data[0], parsed.data[1])
      if (!ok) throw new Error(`面板不存在：${parsed.data[1]}`)
      return true
    })
  })

  ipcMain.handle('buttonPanel:duplicate', async (_e, projectPath: string, panelId: string, newName?: string) => {
    const parsed = buttonPanelDuplicateSchema.safeParse([projectPath, panelId, newName])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => duplicateButtonPanel(parsed.data[0], parsed.data[1], parsed.data[2]))
  })

  // 预置面板模板
  ipcMain.handle('buttonPanel:listBuiltin', async () => {
    return tryIpc(() => listBuiltinPanelTemplates())
  })

  ipcMain.handle('buttonPanel:importBuiltin', async (_e, projectPath: string, templateIds?: string[]) => {
    const parsed = buttonPanelImportBuiltinSchema.safeParse([projectPath, templateIds])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => importBuiltinPanels(parsed.data[0], parsed.data[1]))
  })
}
