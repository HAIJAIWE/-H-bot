// tests/main/ipc/launch-misc-ipc.test.ts
// 覆盖启动模式相关 IPC：launchAudit / launchDashboard / launchPanel / launchTransfer
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===========================================================================
// vi.hoisted —— 保证 mock 引用在 vi.mock 工厂中可用（vi.mock 会被提升到文件顶部）
// ===========================================================================
const {
  ipcMainHandleMock,
  auditServiceMock,
  dashboardServiceMock,
  panelRegistryServiceMock,
  flowServiceInstanceMock,
  dataTransferServiceMock
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  auditServiceMock: {
    logAudit: vi.fn(),
    listAudit: vi.fn(),
    searchAudit: vi.fn()
  },
  dashboardServiceMock: {
    getDashboardStatus: vi.fn(),
    getTimeline: vi.fn(),
    getGroups: vi.fn()
  },
  panelRegistryServiceMock: {
    getRegisteredPanels: vi.fn(),
    getPanelSchema: vi.fn(),
    queryPanelTable: vi.fn()
  },
  flowServiceInstanceMock: {
    loadFlow: vi.fn(),
    saveFlow: vi.fn()
  },
  dataTransferServiceMock: {
    exportTableToJson: vi.fn(),
    exportTableToCsv: vi.fn(),
    importFromJson: vi.fn(),
    importFromCsv: vi.fn()
  }
}))

// ===========================================================================
// vi.mock —— 拦截所有外部依赖
// IPC 文件用相对路径 ../services/xxx 引入，别名 @main/services/xxx 解析到同一文件
// ===========================================================================
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('@main/services/auditService', () => auditServiceMock)
vi.mock('@main/services/project/dashboardService', () => dashboardServiceMock)
vi.mock('@main/services/panelRegistryService', () => panelRegistryServiceMock)
// FlowService 在 IPC 文件顶层被 new，mock 工厂返回实例
// 注意：必须用 function() 而非箭头函数，否则不能用 new 调用
vi.mock('@main/services/flow', () => ({ FlowService: vi.fn(function () { return flowServiceInstanceMock }) }))
vi.mock('@main/services/dataTransferService', () => dataTransferServiceMock)
// pathGuard 已在独立单元测试覆盖；IPC 测试中 mock 为 no-op，聚焦于业务转发逻辑
vi.mock('@main/services/pathGuard', () => ({
  assertPathWithinBase: vi.fn(),
  assertExternalPathSafe: vi.fn()
}))

// ===========================================================================
// 导入被测模块（在 vi.mock 之后）
// ===========================================================================
import { registerLaunchAuditIpc } from '@main/ipc/launchAudit'
import { registerLaunchDashboardIpc } from '@main/ipc/launchDashboard'
import { registerLaunchPanelIpc } from '@main/ipc/launchPanel'
import { registerLaunchTransferIpc } from '@main/ipc/launchTransfer'
import { FLOW_SCHEMA_VERSION } from '@shared/types/flow'

// ===========================================================================
// 辅助工具
// ===========================================================================
type IpcResult = { ok: boolean; data?: unknown; error?: string }

/** 从 ipcMain.handle 调用记录中提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

const allMockGroups = [
  auditServiceMock,
  dashboardServiceMock,
  panelRegistryServiceMock,
  flowServiceInstanceMock,
  dataTransferServiceMock
]

// ===========================================================================
// beforeEach —— 重置所有 mock 并注册全部 IPC handler
// ===========================================================================
beforeEach(() => {
  ipcMainHandleMock.mockReset()
  for (const group of allMockGroups) {
    for (const fn of Object.values(group)) {
      ;(fn as { mockReset: () => void }).mockReset()
    }
  }
  // 注册所有 IPC handler
  registerLaunchAuditIpc()
  registerLaunchDashboardIpc()
  registerLaunchPanelIpc()
  registerLaunchTransferIpc()
})

// ===========================================================================
// launchAudit.ts（无 Zod 校验，位置参数）
// ===========================================================================
describe('launchAudit IPC', () => {
  describe('audit:log', () => {
    it('正常路径：写入审计日志返回 ok:true', async () => {
      auditServiceMock.logAudit.mockReturnValue(undefined)
      const entry = { level: 'info', action: 'login', user: 'admin' } as never
      const result = (await getHandler('audit:log')({}, '/proj', entry)) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(auditServiceMock.logAudit).toHaveBeenCalledWith('/proj', entry)
    })

    it('service 抛异常返回 ok:false', async () => {
      auditServiceMock.logAudit.mockImplementation(() => { throw new Error('log-fail') })
      const result = (await getHandler('audit:log')({}, '/proj', { level: 'info' } as never)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('log-fail')
    })
  })

  describe('audit:list', () => {
    it('正常路径：返回审计列表', async () => {
      const entries = [{ id: 1, time: '2024-01-01', level: 'info', action: 'login' }]
      auditServiceMock.listAudit.mockReturnValue(entries)
      const result = (await getHandler('audit:list')({}, '/proj', 1, 20)) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(entries)
      expect(auditServiceMock.listAudit).toHaveBeenCalledWith('/proj', 1, 20)
    })

    it('service 抛异常返回 ok:false', async () => {
      auditServiceMock.listAudit.mockImplementation(() => { throw new Error('list-fail') })
      const result = (await getHandler('audit:list')({}, '/proj', 1, 20)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('list-fail')
    })
  })

  describe('audit:search', () => {
    it('正常路径：返回搜索结果', async () => {
      const results = [{ id: 1, time: '2024-01-01', level: 'info', action: 'login' }]
      auditServiceMock.searchAudit.mockReturnValue(results)
      const result = (await getHandler('audit:search')({}, '/proj', 'login')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(results)
      expect(auditServiceMock.searchAudit).toHaveBeenCalledWith('/proj', 'login')
    })

    it('service 抛异常返回 ok:false', async () => {
      auditServiceMock.searchAudit.mockImplementation(() => { throw new Error('search-fail') })
      const result = (await getHandler('audit:search')({}, '/proj', 'q')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('search-fail')
    })
  })
})

// ===========================================================================
// launchDashboard.ts（无 Zod 校验，位置参数：projectPath）
// ===========================================================================
describe('launchDashboard IPC', () => {
  describe('launch:getDashboardStatus', () => {
    it('正常路径：返回 DashboardStatus', async () => {
      const status = { running: true, onlineTime: 1000, messageCount: 10, groupCount: 2, memberCount: 50 }
      dashboardServiceMock.getDashboardStatus.mockReturnValue(status)
      const result = (await getHandler('launch:getDashboardStatus')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(status)
      expect(dashboardServiceMock.getDashboardStatus).toHaveBeenCalledWith('/proj')
    })

    it('service 抛异常返回 ok:false', async () => {
      dashboardServiceMock.getDashboardStatus.mockImplementation(() => { throw new Error('status-fail') })
      const result = (await getHandler('launch:getDashboardStatus')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('status-fail')
    })
  })

  describe('launch:getTimeline', () => {
    it('正常路径：返回 TimelineItem 列表', async () => {
      const items = [{ id: 1, time: '2024-01-01', content: 'msg', type: 'message' }]
      dashboardServiceMock.getTimeline.mockReturnValue(items)
      const result = (await getHandler('launch:getTimeline')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(items)
      expect(dashboardServiceMock.getTimeline).toHaveBeenCalledWith('/proj')
    })

    it('service 抛异常返回 ok:false', async () => {
      dashboardServiceMock.getTimeline.mockImplementation(() => { throw new Error('timeline-fail') })
      const result = (await getHandler('launch:getTimeline')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('timeline-fail')
    })
  })

  describe('launch:getGroups', () => {
    it('正常路径：返回 GroupInfo 列表', async () => {
      const groups = [{ groupId: 'g1', groupName: '群1', memberCount: 10 }]
      dashboardServiceMock.getGroups.mockReturnValue(groups)
      const result = (await getHandler('launch:getGroups')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(groups)
      expect(dashboardServiceMock.getGroups).toHaveBeenCalledWith('/proj')
    })

    it('service 抛异常返回 ok:false', async () => {
      dashboardServiceMock.getGroups.mockImplementation(() => { throw new Error('groups-fail') })
      const result = (await getHandler('launch:getGroups')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('groups-fail')
    })
  })
})

// ===========================================================================
// launchPanel.ts（模块级 flowService；panel:listRegistered/getSchema/queryTable/savePanel）
// ===========================================================================
describe('launchPanel IPC', () => {
  describe('panel:listRegistered', () => {
    it('正常路径：返回面板列表', async () => {
      const panels = [{ panelId: 'p1', label: '面板1', description: '', dataSource: 'main', tableName: 'players' }]
      panelRegistryServiceMock.getRegisteredPanels.mockReturnValue(panels)
      const result = (await getHandler('panel:listRegistered')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(panels)
      expect(panelRegistryServiceMock.getRegisteredPanels).toHaveBeenCalledWith('/proj')
    })

    it('service 抛异常返回 ok:false', async () => {
      panelRegistryServiceMock.getRegisteredPanels.mockImplementation(() => { throw new Error('list-panels-fail') })
      const result = (await getHandler('panel:listRegistered')({}, '/proj')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('list-panels-fail')
    })
  })

  describe('panel:getSchema', () => {
    it('正常路径：返回面板 schema', async () => {
      const panels = [{ panelId: 'p1', label: '面板1', description: '', dataSource: 'main', tableName: 'players' }]
      const schema = { name: 'players', fields: [{ name: 'id', type: 'integer' }] }
      panelRegistryServiceMock.getRegisteredPanels.mockReturnValue(panels)
      panelRegistryServiceMock.getPanelSchema.mockReturnValue(schema)
      const result = (await getHandler('panel:getSchema')({}, '/proj', 'p1')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(schema)
      expect(panelRegistryServiceMock.getPanelSchema).toHaveBeenCalledWith('/proj', panels[0])
    })

    it('未找到面板返回 ok:false', async () => {
      panelRegistryServiceMock.getRegisteredPanels.mockReturnValue([])
      const result = (await getHandler('panel:getSchema')({}, '/proj', 'not-exist')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/未找到面板/)
      expect(panelRegistryServiceMock.getPanelSchema).not.toHaveBeenCalled()
    })

    it('service 抛异常返回 ok:false', async () => {
      panelRegistryServiceMock.getRegisteredPanels.mockImplementation(() => { throw new Error('schema-fail') })
      const result = (await getHandler('panel:getSchema')({}, '/proj', 'p1')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('schema-fail')
    })
  })

  describe('panel:queryTable', () => {
    it('正常路径：返回查询结果', async () => {
      const panels = [{ panelId: 'p1', label: '面板1', description: '', dataSource: 'main', tableName: 'players' }]
      const queryResult = { rows: [{ id: 1 }], total: 1, nextCursor: null }
      panelRegistryServiceMock.getRegisteredPanels.mockReturnValue(panels)
      panelRegistryServiceMock.queryPanelTable.mockReturnValue(queryResult)
      const result = (await getHandler('panel:queryTable')({}, '/proj', 'p1', 1, 20)) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toEqual(queryResult)
      expect(panelRegistryServiceMock.queryPanelTable).toHaveBeenCalledWith('/proj', panels[0], 1, 20, undefined)
    })

    it('带 cursor 参数：透传给 queryPanelTable', async () => {
      const panels = [{ panelId: 'p1', label: '面板1', description: '', dataSource: 'main', tableName: 'players' }]
      const queryResult = { rows: [{ id: 2 }], total: 100, nextCursor: 50 }
      panelRegistryServiceMock.getRegisteredPanels.mockReturnValue(panels)
      panelRegistryServiceMock.queryPanelTable.mockReturnValue(queryResult)
      const result = (await getHandler('panel:queryTable')({}, '/proj', 'p1', 2, 20, 42)) as IpcResult
      expect(result.ok).toBe(true)
      expect(panelRegistryServiceMock.queryPanelTable).toHaveBeenCalledWith('/proj', panels[0], 2, 20, 42)
    })

    it('未找到面板返回 ok:false', async () => {
      panelRegistryServiceMock.getRegisteredPanels.mockReturnValue([])
      const result = (await getHandler('panel:queryTable')({}, '/proj', 'no', 1, 10)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/未找到面板/)
    })

    it('service 抛异常返回 ok:false', async () => {
      panelRegistryServiceMock.getRegisteredPanels.mockImplementation(() => { throw new Error('query-fail') })
      const result = (await getHandler('panel:queryTable')({}, '/proj', 'p1', 1, 10)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('query-fail')
    })
  })

  describe('panel:savePanel', () => {
    it('正常路径：flow 已存在，更新节点并保存', async () => {
      const existingFlow = {
        schemaVersion: '1.0',
        systems: [],
        nodes: [{
          id: 'old', type: 'custom' as const, position: { x: 0, y: 0 },
          data: { nodeKind: 'admin_panel', label: '旧', config: { panelId: 'p1', label: '旧' }, inputs: [], outputs: [] }
        }],
        edges: [], variables: [],
        metadata: { name: '', version: '1.0', runtime: 'nonebot2' as const, createdAt: '', updatedAt: '' }
      }
      flowServiceInstanceMock.loadFlow.mockResolvedValue(existingFlow)
      flowServiceInstanceMock.saveFlow.mockResolvedValue(undefined)
      const panel = { panelId: 'p1', label: '新面板', description: 'desc', dataSource: 'main', tableName: 'players' }
      const result = (await getHandler('panel:savePanel')({}, '/proj', panel)) as IpcResult
      expect(result.ok).toBe(true)
      expect(flowServiceInstanceMock.loadFlow).toHaveBeenCalledWith('/proj')
      expect(flowServiceInstanceMock.saveFlow).toHaveBeenCalledWith('/proj', expect.objectContaining({
        schemaVersion: '1.0',
        nodes: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ nodeKind: 'admin_panel' }) })])
      }))
      // 节点被替换（不是新增），数量保持 1
      const savedFlow = flowServiceInstanceMock.saveFlow.mock.calls[0][1] as { nodes: unknown[] }
      expect(savedFlow.nodes).toHaveLength(1)
    })

    it('正常路径：flow 不存在，构建最小 FlowGraph 并保存', async () => {
      flowServiceInstanceMock.loadFlow.mockResolvedValue(null)
      flowServiceInstanceMock.saveFlow.mockResolvedValue(undefined)
      const panel = { panelId: 'new', label: '新面板' }
      const result = (await getHandler('panel:savePanel')({}, '/proj', panel)) as IpcResult
      expect(result.ok).toBe(true)
      const savedFlow = flowServiceInstanceMock.saveFlow.mock.calls[0][1] as { nodes: unknown[]; schemaVersion: string }
      expect(savedFlow.schemaVersion).toBe(FLOW_SCHEMA_VERSION)
      expect(savedFlow.nodes).toHaveLength(1)
    })

    it('loadFlow 抛异常返回 ok:false', async () => {
      flowServiceInstanceMock.loadFlow.mockRejectedValue(new Error('load-fail'))
      const panel = { panelId: 'p1', label: '面板' }
      const result = (await getHandler('panel:savePanel')({}, '/proj', panel)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('load-fail')
      expect(flowServiceInstanceMock.saveFlow).not.toHaveBeenCalled()
    })

    it('saveFlow 抛异常返回 ok:false', async () => {
      flowServiceInstanceMock.loadFlow.mockResolvedValue(null)
      flowServiceInstanceMock.saveFlow.mockRejectedValue(new Error('save-fail'))
      const panel = { panelId: 'p1', label: '面板' }
      const result = (await getHandler('panel:savePanel')({}, '/proj', panel)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('save-fail')
    })
  })
})

// ===========================================================================
// launchTransfer.ts（位置参数：dbPath, tableName, path）
// ===========================================================================
describe('launchTransfer IPC', () => {
  describe('data:exportJson', () => {
    it('正常路径：导出成功返回 ok:true', async () => {
      dataTransferServiceMock.exportTableToJson.mockReturnValue(undefined)
      const result = (await getHandler('data:exportJson')({}, '/db/main.db', 'players', '/out/players.json')) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(dataTransferServiceMock.exportTableToJson).toHaveBeenCalledWith('/db/main.db', 'players', '/out/players.json')
    })

    it('service 抛异常返回 ok:false', async () => {
      dataTransferServiceMock.exportTableToJson.mockImplementation(() => { throw new Error('export-json-fail') })
      const result = (await getHandler('data:exportJson')({}, '/db/main.db', 'players', '/out/players.json')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('export-json-fail')
    })
  })

  describe('data:exportCsv', () => {
    it('正常路径：导出成功返回 ok:true', async () => {
      dataTransferServiceMock.exportTableToCsv.mockReturnValue(undefined)
      const result = (await getHandler('data:exportCsv')({}, '/db/main.db', 'players', '/out/players.csv')) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(dataTransferServiceMock.exportTableToCsv).toHaveBeenCalledWith('/db/main.db', 'players', '/out/players.csv')
    })

    it('service 抛异常返回 ok:false', async () => {
      dataTransferServiceMock.exportTableToCsv.mockImplementation(() => { throw new Error('export-csv-fail') })
      const result = (await getHandler('data:exportCsv')({}, '/db/main.db', 'players', '/out/p.csv')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('export-csv-fail')
    })
  })

  describe('data:importJson', () => {
    it('正常路径：返回导入数量', async () => {
      dataTransferServiceMock.importFromJson.mockReturnValue(42)
      const result = (await getHandler('data:importJson')({}, '/db/main.db', 'players', '/in/players.json')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toBe(42)
      expect(dataTransferServiceMock.importFromJson).toHaveBeenCalledWith('/db/main.db', 'players', '/in/players.json')
    })

    it('service 抛异常返回 ok:false', async () => {
      dataTransferServiceMock.importFromJson.mockImplementation(() => { throw new Error('import-json-fail') })
      const result = (await getHandler('data:importJson')({}, '/db/main.db', 'players', '/in/p.json')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('import-json-fail')
    })
  })

  describe('data:importCsv', () => {
    it('正常路径：返回导入数量', async () => {
      dataTransferServiceMock.importFromCsv.mockReturnValue(10)
      const result = (await getHandler('data:importCsv')({}, '/db/main.db', 'players', '/in/players.csv')) as IpcResult
      expect(result.ok).toBe(true)
      expect(result.data).toBe(10)
      expect(dataTransferServiceMock.importFromCsv).toHaveBeenCalledWith('/db/main.db', 'players', '/in/players.csv')
    })

    it('service 抛异常返回 ok:false', async () => {
      dataTransferServiceMock.importFromCsv.mockImplementation(() => { throw new Error('import-csv-fail') })
      const result = (await getHandler('data:importCsv')({}, '/db/main.db', 'players', '/in/p.csv')) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toBe('import-csv-fail')
    })
  })
})


