import { ipcMain } from 'electron'
import { getRegisteredPanels, getPanelSchema, queryPanelTable } from '../services/panelRegistryService'
import { FlowService } from '../services/flow'
import type { FlowNode } from '@shared/types/flow'
import { FLOW_SCHEMA_VERSION } from '@shared/types/flow'
import { tryIpc, tryIpcAsync } from './_shared'
import {
  panelListRegisteredSchema,
  panelGetSchemaSchema,
  panelQueryTableSchema,
  panelSavePanelSchema
} from '../schemas/launchPanel'

/** 新建面板节点的默认位置偏移范围（避免节点堆叠在原点） */
const PANEL_POSITION_OFFSET = {
  minX: 100,
  rangeX: 400,
  minY: 100,
  rangeY: 300
} as const

const flowService = new FlowService()

export function registerLaunchPanelIpc(): void {
  /** panel:listRegistered — 列出项目下所有已注册的面板定义 */
  ipcMain.handle('panel:listRegistered', async (_e, projectPath: string) => {
    const parsed = panelListRegisteredSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => getRegisteredPanels(parsed.data[0]))
  })
  /** panel:getSchema — 获取指定面板的 schema 定义 */
  ipcMain.handle('panel:getSchema', async (_e, projectPath: string, panelId: string) => {
    const parsed = panelGetSchemaSchema.safeParse([projectPath, panelId])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const panels = getRegisteredPanels(parsed.data[0])
      const panel = panels.find(p => p.panelId === parsed.data[1])
      if (!panel) throw new Error(`未找到面板: ${parsed.data[1]}`)
      return getPanelSchema(parsed.data[0], panel)
    })
  })
  /** panel:queryTable — 分页查询面板数据表 */
  ipcMain.handle('panel:queryTable', async (_e, projectPath: string, panelId: string, page: number, pageSize: number, cursor?: number) => {
    const parsed = panelQueryTableSchema.safeParse([projectPath, panelId, page, pageSize, cursor])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const panels = getRegisteredPanels(parsed.data[0])
      const panel = panels.find(p => p.panelId === parsed.data[1])
      if (!panel) throw new Error(`未找到面板: ${parsed.data[1]}`)
      return queryPanelTable(parsed.data[0], panel, parsed.data[2], parsed.data[3], parsed.data[4])
    })
  })
  /** panel:savePanel — 保存/更新面板定义到 flow.json（AI 生成面板后写入） */
  ipcMain.handle('panel:savePanel', async (_e, projectPath: string, panel: { panelId: string; label: string; description?: string; dataSource?: string; tableName?: string }) => {
    const parsed = panelSavePanelSchema.safeParse([projectPath, panel])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      // 通过 FlowService 加载现有 flow，不存在则构建最小有效 FlowGraph
      const existing = await flowService.loadFlow(parsed.data[0])
      const now = new Date().toISOString()
      const flow = existing ?? {
        schemaVersion: FLOW_SCHEMA_VERSION,
        systems: [],
        nodes: [] as FlowNode[],
        edges: [],
        variables: [],
        metadata: { name: '', version: '1.0', runtime: 'nonebot2' as const, createdAt: now, updatedAt: now }
      }

      // 添加或更新 admin_panel 节点
      const existingIndex = flow.nodes.findIndex(
        (n: FlowNode) => n.data?.nodeKind === 'admin_panel' && n.data?.config?.panelId === parsed.data[1].panelId
      )
      const newNode: FlowNode = {
        id: `node_admin_${parsed.data[1].panelId}_${Date.now()}`,
        type: 'custom',
        position: {
          x: PANEL_POSITION_OFFSET.minX + Math.random() * PANEL_POSITION_OFFSET.rangeX,
          y: PANEL_POSITION_OFFSET.minY + Math.random() * PANEL_POSITION_OFFSET.rangeY
        },
        data: {
          nodeKind: 'admin_panel',
          label: parsed.data[1].label,
          config: {
            panelId: parsed.data[1].panelId,
            label: parsed.data[1].label,
            description: parsed.data[1].description || '',
            dataSource: parsed.data[1].dataSource || '',
            tableName: parsed.data[1].tableName || ''
          },
          inputs: [],
          outputs: []
        }
      }
      if (existingIndex >= 0) {
        flow.nodes[existingIndex] = newNode
      } else {
        flow.nodes.push(newNode)
      }

      // 通过 FlowService 的原子写入 + schema 校验 + 历史备份 + git commit
      await flowService.saveFlow(parsed.data[0], flow)
      return newNode
    })
  })
}
