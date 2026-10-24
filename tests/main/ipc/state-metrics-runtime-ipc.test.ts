// tests/main/ipc/state-metrics-runtime-ipc.test.ts
// 为以下 IPC handler 补齐单元测试：
//   stateStore / metrics / metricsExport / runtime / resourceMonitor / resource
//
// 说明：
//   - state.ts（state:save/load/list/clear）和 statePersistence.ts（state:setSession/...）
//     两个 IPC 模块因渲染层无调用方、与 stateStore IPC 语义重叠已删除，
//     对应测试一并移除。BotStateStore 已单例化，仅供 main 进程内部使用，
//     其测试在 statePersistence 单元测试中覆盖，不在 IPC 层测试。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** 取 mock 第一次调用的第一个参数（vi.fn() 未声明参数时 calls 是 [] 元组，不能直接索引） */
function firstCallArg<T>(fn: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }): T {
  return fn.mock.calls[0]?.[0] as T
}

// ===========================================================================
// vi.hoisted —— 保证 mock 引用在 vi.mock 工厂中可用
// ===========================================================================
const mocks = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn()

  // StateStore 实例（stateStore.ts 使用）
  const stateStoreInstance = {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    listKeys: vi.fn(),
    setSessionVar: vi.fn(),
    getSessionVar: vi.fn(),
    clearSession: vi.fn(),
    getStateCount: vi.fn(),
    getSessionCount: vi.fn(),
    getDbSize: vi.fn(),
    getAllStateEntries: vi.fn(),
    clearAll: vi.fn(),
    close: vi.fn()
  }

  // metricsService（metrics.ts + metricsExport.ts 使用）
  const metricsService = {
    start: vi.fn(),
    stop: vi.fn(),
    getSnapshot: vi.fn(),
    getHistory: vi.fn(),
    recordMetricLine: vi.fn(),
    recordNodeExecution: vi.fn(),
    recordError: vi.fn(),
    onData: vi.fn(() => () => {})
  }

  // resourceMonitor 单例（resourceMonitor.ts + resource.ts 使用）
  const resourceMonitor = {
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    getUsage: vi.fn(),
    getConfig: vi.fn(),
    setLimit: vi.fn(),
    getHistory: vi.fn()
  }

  // botProcess 函数（metrics.ts + runtime.ts 使用）
  const startBot = vi.fn()
  const stopBot = vi.fn()
  const getBotStatus = vi.fn()
  const sendCommand = vi.fn()
  const restartBot = vi.fn()
  const listRunningBots = vi.fn()
  const onStatusChange = vi.fn(() => () => {})
  const onBotLog = vi.fn(() => () => {})
  const onNodeEvent = vi.fn(() => () => {})
  const onMetricData = vi.fn(() => () => {})

  // 翻译器函数（runtime.ts 从 src/main/services/runner/eventBus 取，10/18 实现）
  const injectTestMessage = vi.fn()
  const getTranslatorStatus = vi.fn(() => ({ running: true, clients: 0, port: 8080 }))
  const startTranslator = vi.fn(() => Promise.resolve(8080))
  const resolveUsableTranslatorPort = vi.fn(async () => 8080)

  // metricsExport 函数
  const exportToCSV = vi.fn()
  const exportToJSON = vi.fn()

  // electron 额外组件
  const dialogShowSaveDialog = vi.fn()
  const browserWindowFromWebContents = vi.fn(() => null)
  // 显式给窗口形状：默认 () => [] 会被推成 never[]，mockReturnValue 就收不了对象
  const browserWindowGetAllWindows = vi.fn<
    () => Array<{ isDestroyed: () => boolean; webContents: { send: (channel: string, payload?: unknown) => void } }>
  >(() => [])
  const appOn = vi.fn()

  // fs/promises（runtime.ts 使用）
  const readFileMock = vi.fn(() => Promise.reject(new Error('ENOENT')))
  const writeFileMock = vi.fn(() => Promise.resolve())

  // fileOps.atomicWrite（runtime.ts 使用）
  const atomicWriteMock = vi.fn(() => Promise.resolve())

  return {
    ipcMainHandleMock,
    stateStoreInstance,
    metricsService,
    resourceMonitor,
    startBot,
    stopBot,
    getBotStatus,
    sendCommand,
    restartBot,
    listRunningBots,
    onStatusChange,
    onBotLog,
    onNodeEvent,
    onMetricData,
    injectTestMessage,
    getTranslatorStatus,
    startTranslator,
    resolveUsableTranslatorPort,
    exportToCSV,
    exportToJSON,
    dialogShowSaveDialog,
    browserWindowFromWebContents,
    browserWindowGetAllWindows,
    appOn,
    readFileMock,
    writeFileMock,
    atomicWriteMock
  }
})

// ===========================================================================
// vi.mock —— 拦截所有外部依赖
// ===========================================================================
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandleMock },
  BrowserWindow: {
    getAllWindows: mocks.browserWindowGetAllWindows,
    fromWebContents: mocks.browserWindowFromWebContents
  },
  dialog: { showSaveDialog: mocks.dialogShowSaveDialog },
  app: { on: mocks.appOn }
}))

vi.mock('@main/services/stateStore', () => ({
  StateStore: { getInstance: vi.fn(() => mocks.stateStoreInstance) }
}))

vi.mock('@main/services/metrics', () => ({
  metricsService: mocks.metricsService
}))

vi.mock('@main/services/metricsExport', () => ({
  exportToCSV: mocks.exportToCSV,
  exportToJSON: mocks.exportToJSON
}))

vi.mock('@main/services/botProcess', () => ({
  startBot: mocks.startBot,
  stopBot: mocks.stopBot,
  getBotStatus: mocks.getBotStatus,
  sendCommand: mocks.sendCommand,
  restartBot: mocks.restartBot,
  listRunningBots: mocks.listRunningBots,
  onStatusChange: mocks.onStatusChange,
  onBotLog: mocks.onBotLog,
  onNodeEvent: mocks.onNodeEvent,
  onMetricData: mocks.onMetricData
}))

vi.mock('@main/services/runtimeEvents', () => ({
  onStatusChange: mocks.onStatusChange,
  onBotLog: mocks.onBotLog,
  onNodeEvent: mocks.onNodeEvent,
  onMetricData: mocks.onMetricData,
  emitStatusChange: vi.fn(),
  emitLog: vi.fn(),
  emitBotLog: vi.fn(),
  emitSystemLog: vi.fn(),
  emitNodeEvent: vi.fn(),
  emitMetricData: vi.fn()
}))

vi.mock('@main/services/runner/eventBus', () => ({
  injectTestMessage: mocks.injectTestMessage,
  getTranslatorStatus: mocks.getTranslatorStatus,
  startTranslator: mocks.startTranslator,
  resolveUsableTranslatorPort: mocks.resolveUsableTranslatorPort
}))

vi.mock('@main/services/resourceMonitor', () => ({
  resourceMonitor: mocks.resourceMonitor
}))

vi.mock('@main/services/fileOps', () => ({
  atomicWrite: mocks.atomicWriteMock
}))

vi.mock('fs/promises', () => ({
  readFile: mocks.readFileMock,
  writeFile: mocks.writeFileMock,
  default: { readFile: mocks.readFileMock, writeFile: mocks.writeFileMock }
}))

// ===========================================================================
// 导入被测模块（在 vi.mock 之后）
// ===========================================================================
import { registerStateStoreIpc } from '@main/ipc/stateStore'
import { registerMetricsIpc, cleanupMetricsIpc } from '@main/ipc/metrics'
import { registerMetricsExportIpc } from '@main/ipc/metricsExport'
import { registerRuntimeIpc } from '@main/ipc/runtime'
import { registerResourceMonitorIpc } from '@main/ipc/resourceMonitor'
// 2026-10-24 恢复注：旧 `@main/ipc/resource`（resources:startMonitor/stopMonitor/getSnapshot）
// 在本 revision 已删除 —— 渲染层 `qqbat.resources.*` 零调用方，通道由 resourceMonitor 取代。

// ===========================================================================
// 辅助工具
// ===========================================================================
type IpcResult = { ok: boolean; data?: unknown; error?: string }

/** 从 ipcMain.handle 调用记录中提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

// ===========================================================================
// 全局 beforeEach —— 重置所有 mock 并恢复默认返回值
// ===========================================================================
beforeEach(() => {
  vi.resetAllMocks()
  // 恢复需要默认实现的 mock
  mocks.metricsService.onData.mockReturnValue(() => {})
  mocks.onStatusChange.mockReturnValue(() => {})
  mocks.onBotLog.mockReturnValue(() => {})
  mocks.onNodeEvent.mockReturnValue(() => {})
  mocks.onMetricData.mockReturnValue(() => {})
  mocks.getTranslatorStatus.mockReturnValue({ running: true, clients: 0, port: 8080 })
  mocks.startTranslator.mockResolvedValue(8080)
  mocks.resolveUsableTranslatorPort.mockResolvedValue(8080)
  mocks.browserWindowGetAllWindows.mockReturnValue([])
  mocks.browserWindowFromWebContents.mockReturnValue(null)
  mocks.readFileMock.mockRejectedValue(new Error('ENOENT'))
  mocks.writeFileMock.mockResolvedValue(undefined)
  mocks.atomicWriteMock.mockResolvedValue(undefined)
})

// ===========================================================================
// 1. stateStore.ts
// ===========================================================================
describe('stateStore IPC (registerStateStoreIpc)', () => {
  beforeEach(() => registerStateStoreIpc())

  // ---- bot_state ----
  describe('stateStore:set', () => {
    it('正常路径', async () => {
      const handler = getHandler('stateStore:set')
      const result = (await handler({}, { projectPath: '/p', key: 'bot:k', value: 99 })) as IpcResult
      expect(result).toEqual({ ok: true, data: null })
      expect(mocks.stateStoreInstance.set).toHaveBeenCalledWith('bot:k', 99, '/p')
    })

    it('参数校验失败', async () => {
      const handler = getHandler('stateStore:set')
      const result = (await handler({}, { projectPath: '', key: 'bot:k' })) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.set.mockImplementation(() => {
        throw new Error('set err')
      })
      const handler = getHandler('stateStore:set')
      const result = (await handler({}, { projectPath: '/p', key: 'bot:k', value: 1 })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'set err' })
    })
  })

  describe('stateStore:get', () => {
    it('正常路径', async () => {
      mocks.stateStoreInstance.get.mockReturnValue('v')
      const handler = getHandler('stateStore:get')
      const result = (await handler({}, { projectPath: '/p', key: 'bot:k' })) as IpcResult
      expect(result).toEqual({ ok: true, data: 'v' })
    })

    it('参数校验失败（缺少 key）', async () => {
      const handler = getHandler('stateStore:get')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.get.mockImplementation(() => {
        throw new Error('get err')
      })
      const handler = getHandler('stateStore:get')
      const result = (await handler({}, { projectPath: '/p', key: 'bot:k' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'get err' })
    })
  })

  describe('stateStore:delete', () => {
    it('正常路径', async () => {
      mocks.stateStoreInstance.delete.mockReturnValue(true)
      const handler = getHandler('stateStore:delete')
      const result = (await handler({}, { projectPath: '/p', key: 'bot:k' })) as IpcResult
      expect(result).toEqual({ ok: true, data: true })
    })

    it('参数校验失败', async () => {
      const handler = getHandler('stateStore:delete')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.delete.mockImplementation(() => {
        throw new Error('del err')
      })
      const handler = getHandler('stateStore:delete')
      const result = (await handler({}, { projectPath: '/p', key: 'bot:k' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'del err' })
    })
  })

  describe('stateStore:listKeys', () => {
    it('正常路径（带 prefix）', async () => {
      mocks.stateStoreInstance.listKeys.mockReturnValue(['k1', 'k2'])
      const handler = getHandler('stateStore:listKeys')
      const result = (await handler({}, { projectPath: '/p', prefix: 'k' })) as IpcResult
      expect(result).toEqual({ ok: true, data: ['k1', 'k2'] })
      // IPC-7：limit/offset 也一并透传（不传时为 undefined，由 store 用默认页大小）
      expect(mocks.stateStoreInstance.listKeys).toHaveBeenCalledWith('k', '/p', undefined, undefined)
    })

    it('参数校验失败（缺少 projectPath）', async () => {
      const handler = getHandler('stateStore:listKeys')
      const result = (await handler({}, {})) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.listKeys.mockImplementation(() => {
        throw new Error('list err')
      })
      const handler = getHandler('stateStore:listKeys')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'list err' })
    })
  })

  // ---- session_vars ----
  describe('stateStore:setSessionVar', () => {
    it('正常路径', async () => {
      const handler = getHandler('stateStore:setSessionVar')
      const result = (await handler(
        {},
        { projectPath: '/p', sessionId: 's1', varName: 'v1', value: 'x' }
      )) as IpcResult
      expect(result).toEqual({ ok: true, data: null })
      expect(mocks.stateStoreInstance.setSessionVar).toHaveBeenCalledWith('s1', 'v1', 'x', '/p')
    })

    it('参数校验失败（缺少 varName）', async () => {
      const handler = getHandler('stateStore:setSessionVar')
      const result = (await handler({}, { projectPath: '/p', sessionId: 's1' })) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.setSessionVar.mockImplementation(() => {
        throw new Error('sv err')
      })
      const handler = getHandler('stateStore:setSessionVar')
      const result = (await handler(
        {},
        { projectPath: '/p', sessionId: 's1', varName: 'v1', value: 'x' }
      )) as IpcResult
      expect(result).toEqual({ ok: false, error: 'sv err' })
    })
  })

  describe('stateStore:getSessionVar', () => {
    it('正常路径', async () => {
      mocks.stateStoreInstance.getSessionVar.mockReturnValue('val')
      const handler = getHandler('stateStore:getSessionVar')
      const result = (await handler(
        {},
        { projectPath: '/p', sessionId: 's1', varName: 'v1' }
      )) as IpcResult
      expect(result).toEqual({ ok: true, data: 'val' })
    })

    it('参数校验失败', async () => {
      const handler = getHandler('stateStore:getSessionVar')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.getSessionVar.mockImplementation(() => {
        throw new Error('gsv err')
      })
      const handler = getHandler('stateStore:getSessionVar')
      const result = (await handler(
        {},
        { projectPath: '/p', sessionId: 's1', varName: 'v1' }
      )) as IpcResult
      expect(result).toEqual({ ok: false, error: 'gsv err' })
    })
  })

  describe('stateStore:clearSession', () => {
    it('正常路径', async () => {
      const handler = getHandler('stateStore:clearSession')
      const result = (await handler({}, { projectPath: '/p', sessionId: 's1' })) as IpcResult
      expect(result).toEqual({ ok: true, data: null })
      expect(mocks.stateStoreInstance.clearSession).toHaveBeenCalledWith('s1', '/p')
    })

    it('参数校验失败（缺少 sessionId）', async () => {
      const handler = getHandler('stateStore:clearSession')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.clearSession.mockImplementation(() => {
        throw new Error('cs err')
      })
      const handler = getHandler('stateStore:clearSession')
      const result = (await handler({}, { projectPath: '/p', sessionId: 's1' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'cs err' })
    })
  })

  // ---- 统计与维护 ----
  describe('stateStore:stats', () => {
    it('正常路径', async () => {
      mocks.stateStoreInstance.getStateCount.mockReturnValue(5)
      mocks.stateStoreInstance.getSessionCount.mockReturnValue(2)
      mocks.stateStoreInstance.getDbSize.mockReturnValue(1024)
      const handler = getHandler('stateStore:stats')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({
        ok: true,
        data: { stateCount: 5, sessionCount: 2, dbSize: 1024 }
      })
    })

    it('参数校验失败', async () => {
      const handler = getHandler('stateStore:stats')
      const result = (await handler({}, {})) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.getStateCount.mockImplementation(() => {
        throw new Error('stats err')
      })
      const handler = getHandler('stateStore:stats')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'stats err' })
    })
  })

  describe('stateStore:getAllStateEntries', () => {
    it('正常路径', async () => {
      const entries = [{ key: 'k', value: 'v', updatedAt: 123 }]
      mocks.stateStoreInstance.getAllStateEntries.mockReturnValue(entries)
      const handler = getHandler('stateStore:getAllStateEntries')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({ ok: true, data: entries })
    })

    it('参数校验失败', async () => {
      const handler = getHandler('stateStore:getAllStateEntries')
      const result = (await handler({}, {})) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.getAllStateEntries.mockImplementation(() => {
        throw new Error('entries err')
      })
      const handler = getHandler('stateStore:getAllStateEntries')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'entries err' })
    })
  })

  describe('stateStore:clearAll', () => {
    it('正常路径', async () => {
      const handler = getHandler('stateStore:clearAll')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({ ok: true, data: null })
      expect(mocks.stateStoreInstance.clearAll).toHaveBeenCalledWith('/p')
    })

    it('参数校验失败', async () => {
      const handler = getHandler('stateStore:clearAll')
      const result = (await handler({}, {})) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.stateStoreInstance.clearAll.mockImplementation(() => {
        throw new Error('clearAll err')
      })
      const handler = getHandler('stateStore:clearAll')
      const result = (await handler({}, { projectPath: '/p' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'clearAll err' })
    })
  })

  it('注册时绑定 app.on("before-quit") 清理钩子', () => {
    // registerStateStoreIpc 已在 beforeEach 中调用
    expect(mocks.appOn).toHaveBeenCalledWith('before-quit', expect.any(Function))
  })
})

// ===========================================================================
// 2. metrics.ts
// ===========================================================================
describe('metrics IPC (registerMetricsIpc)', () => {
  beforeEach(() => {
    cleanupMetricsIpc()
    registerMetricsIpc()
  })
  afterEach(() => {
    cleanupMetricsIpc()
  })

  describe('metrics:getSnapshot', () => {
    it('正常路径', async () => {
      const sample = { timestamp: '2024-01-01T00:00:00Z', msgCount: 10 }
      mocks.metricsService.getSnapshot.mockReturnValue(sample)
      const handler = getHandler('metrics:getSnapshot')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: true, data: sample })
    })

    it('service 抛异常', async () => {
      mocks.metricsService.getSnapshot.mockImplementation(() => {
        throw new Error('snapshot err')
      })
      const handler = getHandler('metrics:getSnapshot')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'snapshot err' })
    })
  })

  describe('metrics:start', () => {
    it('正常路径', async () => {
      const handler = getHandler('metrics:start')
      const result = (await handler({}, {})) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(mocks.metricsService.start).toHaveBeenCalled()
    })

    it('参数校验失败（args 非 object）', async () => {
      const handler = getHandler('metrics:start')
      const result = (await handler({}, undefined)) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常', async () => {
      mocks.metricsService.start.mockImplementation(() => {
        throw new Error('start err')
      })
      const handler = getHandler('metrics:start')
      const result = (await handler({}, {})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'start err' })
    })
  })

  describe('metrics:stop', () => {
    it('正常路径', async () => {
      const handler = getHandler('metrics:stop')
      const result = (await handler({}, {})) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(mocks.metricsService.stop).toHaveBeenCalled()
    })

    it('参数校验失败', async () => {
      const handler = getHandler('metrics:stop')
      const result = (await handler({}, 'invalid')) as IpcResult
      expect(result.ok).toBe(false)
    })

    it('service 抛异常', async () => {
      mocks.metricsService.stop.mockImplementation(() => {
        throw new Error('stop err')
      })
      const handler = getHandler('metrics:stop')
      const result = (await handler({}, {})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'stop err' })
    })
  })

  describe('metrics:history', () => {
    it('正常路径', async () => {
      const history = [{ timestamp: 't1', msgCount: 1 }]
      mocks.metricsService.getHistory.mockReturnValue(history)
      const handler = getHandler('metrics:history')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: true, data: history })
    })

    it('service 抛异常', async () => {
      mocks.metricsService.getHistory.mockImplementation(() => {
        throw new Error('history err')
      })
      const handler = getHandler('metrics:history')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'history err' })
    })
  })

  it('注册时订阅 onStatusChange / onMetricData / onNodeEvent / onData', () => {
    expect(mocks.onStatusChange).toHaveBeenCalledTimes(1)
    expect(mocks.onMetricData).toHaveBeenCalledTimes(1)
    expect(mocks.onNodeEvent).toHaveBeenCalledTimes(1)
    expect(mocks.metricsService.onData).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// 3. metricsExport.ts
// ===========================================================================
describe('metricsExport IPC (registerMetricsExportIpc)', () => {
  beforeEach(() => registerMetricsExportIpc())

  const sampleData = [
    {
      timestamp: '2024-01-01T00:00:00Z',
      msgCount: 5,
      avgLatency: 100,
      p95Latency: 200,
      errorRate: 0,
      nodeExecutions: 3,
      errorTypes: {}
    }
  ]

  describe('metrics:exportToCSV', () => {
    it('正常路径：导出成功', async () => {
      mocks.metricsService.getHistory.mockReturnValue(sampleData)
      mocks.dialogShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/test/out.csv'
      })
      const handler = getHandler('metrics:exportToCSV')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({
        ok: true,
        data: { success: true, filePath: '/test/out.csv' }
      })
      expect(mocks.exportToCSV).toHaveBeenCalledWith(sampleData, '/test/out.csv')
    })

    it('没有指标数据可导出', async () => {
      mocks.metricsService.getHistory.mockReturnValue([])
      const handler = getHandler('metrics:exportToCSV')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({ ok: false, error: '没有指标数据可导出' })
      expect(mocks.dialogShowSaveDialog).not.toHaveBeenCalled()
    })

    it('用户取消保存对话框', async () => {
      mocks.metricsService.getHistory.mockReturnValue(sampleData)
      mocks.dialogShowSaveDialog.mockResolvedValue({
        canceled: true,
        filePath: ''
      })
      const handler = getHandler('metrics:exportToCSV')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({ ok: false, error: '用户取消' })
      expect(mocks.exportToCSV).not.toHaveBeenCalled()
    })

    it('exportToCSV 抛异常', async () => {
      mocks.metricsService.getHistory.mockReturnValue(sampleData)
      mocks.dialogShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/test/out.csv'
      })
      mocks.exportToCSV.mockImplementation(() => {
        throw new Error('csv write fail')
      })
      const handler = getHandler('metrics:exportToCSV')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'csv write fail' })
    })
  })

  describe('metrics:exportToJSON', () => {
    it('正常路径：导出成功', async () => {
      mocks.metricsService.getHistory.mockReturnValue(sampleData)
      mocks.dialogShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/test/out.json'
      })
      const handler = getHandler('metrics:exportToJSON')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({
        ok: true,
        data: { success: true, filePath: '/test/out.json' }
      })
      expect(mocks.exportToJSON).toHaveBeenCalledWith(sampleData, '/test/out.json')
    })

    it('没有指标数据可导出', async () => {
      mocks.metricsService.getHistory.mockReturnValue([])
      const handler = getHandler('metrics:exportToJSON')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({ ok: false, error: '没有指标数据可导出' })
    })

    it('用户取消保存对话框', async () => {
      mocks.metricsService.getHistory.mockReturnValue(sampleData)
      mocks.dialogShowSaveDialog.mockResolvedValue({
        canceled: true,
        filePath: ''
      })
      const handler = getHandler('metrics:exportToJSON')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({ ok: false, error: '用户取消' })
    })

    it('exportToJSON 抛异常', async () => {
      mocks.metricsService.getHistory.mockReturnValue(sampleData)
      mocks.dialogShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/test/out.json'
      })
      mocks.exportToJSON.mockImplementation(() => {
        throw new Error('json write fail')
      })
      const handler = getHandler('metrics:exportToJSON')
      const result = (await handler({ sender: {} })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'json write fail' })
    })
  })
})

// ===========================================================================
// 4. runtime.ts —— 只剩观测通道（控制/状态已迁到 botManager）
// ===========================================================================
describe('runtime IPC (registerRuntimeIpc)', () => {
  beforeEach(() => registerRuntimeIpc())

  it('注册时订阅 onBotLog / onNodeEvent（不再订阅状态：状态走 botManager）', () => {
    expect(mocks.onBotLog).toHaveBeenCalledTimes(1)
    expect(mocks.onNodeEvent).toHaveBeenCalledTimes(1)
    expect(mocks.onStatusChange).not.toHaveBeenCalled()
  })

  it('节点事件转发：runtime:executeNode 带 projectPath 包装', () => {
    const send = vi.fn()
    mocks.browserWindowGetAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { send } }
    ])
    const onNode = firstCallArg<(p: string, e: { nodeId: string; status: string; timestamp: string }) => void>(
      mocks.onNodeEvent,
    ) as unknown as (
      p: string,
      e: { nodeId: string; status: string; timestamp: string }
    ) => void
    const event = { nodeId: 'n1', status: 'enter', timestamp: '2026-01-01T00:00:00Z' }
    onNode('/p', event)
    expect(send).toHaveBeenCalledWith('runtime:executeNode', { projectPath: '/p', event })
  })

  it('日志批量转发：窗口内的多条合成一批 runtime:batchLog', () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn()
      mocks.browserWindowGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send } }
      ])
      const onLog = firstCallArg<
        (p: string, e: { timestamp: string; source: string; level: string; message: string }) => void
      >(mocks.onBotLog) as unknown as (
        p: string,
        e: { timestamp: string; source: string; level: string; message: string }
      ) => void
      const entry = { timestamp: 't', source: 'bot', level: 'info', message: 'hi' }
      onLog('/p', entry)
      expect(send).not.toHaveBeenCalled()
      vi.advanceTimersByTime(120)
      expect(send).toHaveBeenCalledWith('runtime:batchLog', [{ projectPath: '/p', entry }])
    } finally {
      vi.useRealTimers()
    }
  })

  describe('runtime:injectTestMessage', () => {
    it('正常路径：翻译器已连接，消息已发送', async () => {
      mocks.injectTestMessage.mockReturnValue(true)
      const handler = getHandler('runtime:injectTestMessage')
      const result = (await handler({}, { projectPath: '/p', message: 'hello' })) as IpcResult
      expect(result).toEqual({ ok: true, data: { sent: true } })
      // chatType/chatId 可选；缺省时为 undefined，保持向后兼容
      expect(mocks.injectTestMessage).toHaveBeenCalledWith('/p', 'hello', undefined, undefined)
    })

    it('参数校验失败（缺 projectPath）', async () => {
      const handler = getHandler('runtime:injectTestMessage')
      const result = (await handler({}, { message: 'hello' })) as IpcResult
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('翻译器未运行，消息未发送', async () => {
      mocks.injectTestMessage.mockReturnValue(false)
      const handler = getHandler('runtime:injectTestMessage')
      const result = (await handler({}, { projectPath: '/p', message: 'hello' })) as IpcResult
      expect(result).toEqual({ ok: false, error: '翻译器未运行或无客户端连接' })
    })

    it('injectTestMessage 抛异常', async () => {
      mocks.injectTestMessage.mockImplementation(() => {
        throw new Error('inject err')
      })
      const handler = getHandler('runtime:injectTestMessage')
      const result = (await handler({}, { projectPath: '/p', message: 'hello' })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'inject err' })
    })
  })

  // 回归：Python 时代的控制通道不许再悄悄回来（它们订阅的是 botProcess 的 stdout 总线）
  it.each(['runtime:start', 'runtime:stop', 'runtime:status', 'runtime:sendCommand', 'runtime:restart', 'runtime:listRunning'])(
    '%s 已下线',
    (channel) => {
      expect(() => getHandler(channel)).toThrow(/未注册/)
    }
  )
})

// ===========================================================================
// 5. resourceMonitor.ts
// ===========================================================================
describe('resourceMonitor IPC (registerResourceMonitorIpc)', () => {
  beforeEach(() => registerResourceMonitorIpc())

  describe('resourceMonitor:start', () => {
    it('正常路径', async () => {
      const handler = getHandler('resourceMonitor:start')
      const result = (await handler({}, 1234)) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(mocks.resourceMonitor.startMonitoring).toHaveBeenCalledWith(1234)
    })

    it('参数校验失败（pid 非数字）', async () => {
      const handler = getHandler('resourceMonitor:start')
      const result = (await handler({}, 'abc')) as IpcResult
      expect(result).toEqual({ ok: false, error: '参数校验失败: pid 必须是正整数' })
    })

    it('参数校验失败（pid <= 0）', async () => {
      const handler = getHandler('resourceMonitor:start')
      const result = (await handler({}, 0)) as IpcResult
      expect(result).toEqual({ ok: false, error: '参数校验失败: pid 必须是正整数' })
    })

    it('service 抛异常', async () => {
      mocks.resourceMonitor.startMonitoring.mockImplementation(() => {
        throw new Error('start mon fail')
      })
      const handler = getHandler('resourceMonitor:start')
      const result = (await handler({}, 1234)) as IpcResult
      expect(result).toEqual({ ok: false, error: 'start mon fail' })
    })
  })

  describe('resourceMonitor:stop', () => {
    it('正常路径', async () => {
      const handler = getHandler('resourceMonitor:stop')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(mocks.resourceMonitor.stopMonitoring).toHaveBeenCalled()
    })

    it('service 抛异常', async () => {
      mocks.resourceMonitor.stopMonitoring.mockImplementation(() => {
        throw new Error('stop fail')
      })
      const handler = getHandler('resourceMonitor:stop')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'stop fail' })
    })
  })

  describe('resourceMonitor:getUsage', () => {
    it('正常路径', async () => {
      const usage = { cpuPercent: 50, memoryMB: 100, memoryPercent: 5, uptime: 60 }
      mocks.resourceMonitor.getUsage.mockReturnValue(usage)
      const handler = getHandler('resourceMonitor:getUsage')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: true, data: usage })
    })

    it('service 抛异常', async () => {
      mocks.resourceMonitor.getUsage.mockImplementation(() => {
        throw new Error('usage fail')
      })
      const handler = getHandler('resourceMonitor:getUsage')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'usage fail' })
    })
  })

  describe('resourceMonitor:getConfig', () => {
    it('正常路径', async () => {
      const config = { maxMemoryMB: 1024, maxCPUPercent: 100 }
      mocks.resourceMonitor.getConfig.mockReturnValue(config)
      const handler = getHandler('resourceMonitor:getConfig')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: true, data: config })
    })

    it('service 抛异常', async () => {
      mocks.resourceMonitor.getConfig.mockImplementation(() => {
        throw new Error('config fail')
      })
      const handler = getHandler('resourceMonitor:getConfig')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'config fail' })
    })
  })

  describe('resourceMonitor:setConfig', () => {
    it('正常路径', async () => {
      const handler = getHandler('resourceMonitor:setConfig')
      const result = (await handler({}, { maxMemoryMB: 512, maxCPUPercent: 80 })) as IpcResult
      expect(result).toEqual({ ok: true })
      expect(mocks.resourceMonitor.setLimit).toHaveBeenCalledWith({
        maxMemoryMB: 512,
        maxCPUPercent: 80
      })
    })

    it('参数校验失败（config 为 null）', async () => {
      const handler = getHandler('resourceMonitor:setConfig')
      const result = (await handler({}, null)) as IpcResult
      expect(result).toEqual({ ok: false, error: '参数校验失败: config 必须是对象' })
    })

    it('参数校验失败（config 非对象）', async () => {
      const handler = getHandler('resourceMonitor:setConfig')
      const result = (await handler({}, 'invalid')) as IpcResult
      expect(result).toEqual({ ok: false, error: '参数校验失败: config 必须是对象' })
    })

    it('service 抛异常', async () => {
      mocks.resourceMonitor.setLimit.mockImplementation(() => {
        throw new Error('setLimit fail')
      })
      const handler = getHandler('resourceMonitor:setConfig')
      const result = (await handler({}, { maxMemoryMB: 512 })) as IpcResult
      expect(result).toEqual({ ok: false, error: 'setLimit fail' })
    })
  })

  describe('resourceMonitor:getHistory', () => {
    it('正常路径', async () => {
      const history = [{ cpuPercent: 10, memoryMB: 50, memoryPercent: 5, timestamp: 123 }]
      mocks.resourceMonitor.getHistory.mockReturnValue(history)
      const handler = getHandler('resourceMonitor:getHistory')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: true, data: history })
    })

    it('service 抛异常', async () => {
      mocks.resourceMonitor.getHistory.mockImplementation(() => {
        throw new Error('history fail')
      })
      const handler = getHandler('resourceMonitor:getHistory')
      const result = (await handler({})) as IpcResult
      expect(result).toEqual({ ok: false, error: 'history fail' })
    })
  })
})
