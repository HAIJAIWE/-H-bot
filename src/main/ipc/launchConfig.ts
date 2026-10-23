import { ipcMain } from 'electron'
import { logger } from '../services/logger'
import {
  listConfigCategories, getConfigTable, getConfigSchema, updateConfigRecord, insertConfigRecord, deleteConfigRecord,
  createConfigTable, dropConfigTable, renameConfigTable, alterConfigTable,
  type FieldDefinition
} from '../services/configService'
import { previewConfigTables, listLayerTemplates } from '../services/configTemplateService'
import { tryIpc, tryIpcAsync } from './_shared'
import {
  listConfigCategoriesSchema,
  previewConfigTablesSchema,
  listLayerTemplatesSchema,
  getConfigTableSchema,
  getConfigSchemaSchema,
  updateConfigRecordSchema,
  insertConfigRecordSchema,
  deleteConfigRecordSchema,
  createConfigTableSchema,
  dropConfigTableSchema,
  renameConfigTableSchema,
  alterConfigTableSchema
} from '../schemas/launchConfig'

export function registerLaunchConfigIpc(): void {
  /** launch:listConfigCategories — 列出项目配置分类 */
  ipcMain.handle('launch:listConfigCategories', async (_e, projectPath: string) => {
    const parsed = listConfigCategoriesSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => listConfigCategories(parsed.data[0]))
  })

  /** launch:previewConfigTables — 配置模板预览（项目创建前查看将初始化哪些配置表） */
  ipcMain.handle('launch:previewConfigTables', async (_e, botType: 'functional' | 'game', templateId?: string) => {
    const parsed = previewConfigTablesSchema.safeParse([botType, templateId])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => previewConfigTables(parsed.data[0], parsed.data[1]))
  })

  /** launch:listLayerTemplates — 列出某层配置模板摘要（用于 UI 展示模板内容） */
  ipcMain.handle('launch:listLayerTemplates', async (_e, layerName: string) => {
    const parsed = listLayerTemplatesSchema.safeParse([layerName])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => listLayerTemplates(parsed.data[0]))
  })

  /** launch:getConfigTable — 分页查询配置表数据 */
  ipcMain.handle('launch:getConfigTable', async (_e, projectPath: string, category: string, page: number, pageSize: number) => {
    const parsed = getConfigTableSchema.safeParse([projectPath, category, page, pageSize])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const data = getConfigTable(parsed.data[0], parsed.data[1], parsed.data[2], parsed.data[3])
      logger.debug(`[launchConfig] getConfigTable: projectPath=${parsed.data[0]}, category=${parsed.data[1]}, page=${parsed.data[2]}, total=${data.total}, rows=${data.rows.length}`)
      return data
    })
  })
  /** launch:getConfigSchema — 获取配置表字段定义 */
  ipcMain.handle('launch:getConfigSchema', async (_e, projectPath: string, category: string) => {
    const parsed = getConfigSchemaSchema.safeParse([projectPath, category])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const data = getConfigSchema(parsed.data[0], parsed.data[1])
      logger.debug(`[launchConfig] getConfigSchema: projectPath=${parsed.data[0]}, category=${parsed.data[1]}, schemas=${data.length}, fields=${data[0]?.fields.length ?? 0}`)
      return data
    })
  })
  /** launch:updateConfigRecord — 更新配置表记录 */
  ipcMain.handle('launch:updateConfigRecord', async (_e, projectPath: string, category: string, rowid: number, changes: Record<string, unknown>) => {
    const parsed = updateConfigRecordSchema.safeParse([projectPath, category, rowid, changes])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => { updateConfigRecord(parsed.data[0], parsed.data[1], parsed.data[2], parsed.data[3]) })
  })
  /** launch:insertConfigRecord — 插入配置表记录 */
  ipcMain.handle('launch:insertConfigRecord', async (_e, projectPath: string, category: string, values: Record<string, unknown>) => {
    const parsed = insertConfigRecordSchema.safeParse([projectPath, category, values])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => insertConfigRecord(parsed.data[0], parsed.data[1], parsed.data[2]))
  })
  /** launch:deleteConfigRecord — 删除配置表记录 */
  ipcMain.handle('launch:deleteConfigRecord', async (_e, projectPath: string, category: string, rowid: number) => {
    const parsed = deleteConfigRecordSchema.safeParse([projectPath, category, rowid])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => { deleteConfigRecord(parsed.data[0], parsed.data[1], parsed.data[2]) })
  })

  /** launch:createConfigTable — 创建自定义配置表 */
  ipcMain.handle('launch:createConfigTable', async (_e, projectPath: string, displayName: string, fields: { name: string; type: string }[]) => {
    const parsed = createConfigTableSchema.safeParse([projectPath, displayName, fields])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => createConfigTable(parsed.data[0], parsed.data[1], parsed.data[2] as FieldDefinition[]))
  })
  /** launch:dropConfigTable — 删除配置表 */
  ipcMain.handle('launch:dropConfigTable', async (_e, projectPath: string, category: string) => {
    const parsed = dropConfigTableSchema.safeParse([projectPath, category])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => { dropConfigTable(parsed.data[0], parsed.data[1]) })
  })
  /** launch:renameConfigTable — 重命名配置表显示名 */
  ipcMain.handle('launch:renameConfigTable', async (_e, projectPath: string, oldCategory: string, newDisplayName: string) => {
    const parsed = renameConfigTableSchema.safeParse([projectPath, oldCategory, newDisplayName])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => renameConfigTable(parsed.data[0], parsed.data[1], parsed.data[2]))
  })
  /** launch:alterConfigTable — 修改配置表结构（增/删/改字段） */
  ipcMain.handle('launch:alterConfigTable', async (_e, projectPath: string, category: string, options: {
    addFields?: { name: string; type: string }[]
    dropFields?: string[]
    updateFields?: { name: string; type: string }[]
  }) => {
    const parsed = alterConfigTableSchema.safeParse([projectPath, category, options])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => alterConfigTable(
      parsed.data[0],
      parsed.data[1],
      {
        addFields: parsed.data[2].addFields as FieldDefinition[] | undefined,
        dropFields: parsed.data[2].dropFields,
        updateFields: parsed.data[2].updateFields as FieldDefinition[] | undefined
      }
    ))
  })
}
