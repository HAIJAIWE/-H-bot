// tests/main/ipc/remaining-ipc-1.test.ts
// 覆盖 7 个 IPC handler：ai / aiProvider / codegen / crash / crashReporter / debugger / diagnostics
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===========================================================================
// vi.hoisted —— mock 引用（vi.mock 会被提升到文件顶部，需用 hoisted 保证引用可用）
// ===========================================================================
const {
  // electron
  ipcMainHandleMock,
  ipcMainOnMock,
  browserWindowFromWebContents,
  dialogShowSaveDialog,
  appGetName,
  // ai service
  processAiChatMock,
  setAiConfigMock,
  getAiConfigMock,
  beginBatchMock,
  commitBatchMock,
  handleRollbackBatchMock,
  // ai tools（循环注册表）
  loopToolsMock,
  // ai provider registry
  providerRegistryMock,
  // codegen service（实例方法 mock）
  codegenGenerateMock,
  // crash reporter service
  getRecentReportsMock,
  readReportMock,
  clearReportsMock,
  captureExceptionMock,
  exportDiagnosticMock,
  // debugger service
  debuggerServiceMock,
  // diagnostics service
  exportDiagnosticsMock,
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  ipcMainOnMock: vi.fn(),
  browserWindowFromWebContents: vi.fn((): any => null),
  dialogShowSaveDialog: vi.fn(),
  appGetName: vi.fn(() => 'qqbat'),
  processAiChatMock: vi.fn(),
  setAiConfigMock: vi.fn(),
  getAiConfigMock: vi.fn((): unknown => null),
  beginBatchMock: vi.fn(),
  commitBatchMock: vi.fn(),
  handleRollbackBatchMock: vi.fn(),
  loopToolsMock: vi.fn(() => [
    { name: 'list_dir', description: '列目录', category: 'query', parameters: { type: 'object' } },
    { name: 'write_file', description: '写文件', category: 'mutation' }
  ]),
  providerRegistryMock: {
    list: vi.fn(() => ['glm', 'openai']),
    getCurrent: vi.fn(() => 'glm'),
    getOrCreate: vi.fn(),
    has: vi.fn(() => true),
    setCurrent: vi.fn()
  },
  codegenGenerateMock: vi.fn(),
  getRecentReportsMock: vi.fn(),
  readReportMock: vi.fn(),
  clearReportsMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  exportDiagnosticMock: vi.fn(),
  debuggerServiceMock: {
    setBreakpoints: vi.fn(),
    start: vi.fn(),
    stepOver: vi.fn(),
    stepInto: vi.fn(),
    stepOut: vi.fn(),
    continue: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn((): any => ({ status: 'idle', variables: [], callStack: [] }))
  },
  exportDiagnosticsMock: vi.fn()
}))

// ===========================================================================
// vi.mock —— 拦截所有外部依赖
// ===========================================================================
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock, on: ipcMainOnMock },
  BrowserWindow: { fromWebContents: browserWindowFromWebContents, getAllWindows: vi.fn(() => []) },
  dialog: { showSaveDialog: dialogShowSaveDialog },
  app: { getName: appGetName }
}))

// ai/index.ts 依赖较重（llm/context/tools/proposal 等），整体 mock
vi.mock('@main/services/ai', () => ({
  processAiChat: processAiChatMock,
  setAiConfig: setAiConfigMock,
  getAiConfig: getAiConfigMock,
  beginBatch: beginBatchMock,
  commitBatch: commitBatchMock,
  handleRollbackBatch: handleRollbackBatchMock
}))

// ipc/ai.ts 的 ai:tools 现在给的是**循环注册表**（预设白名单过滤的那张），
// 不是助手链路那 27 个定义 —— mock 打在真源上。
vi.mock('@main/services/agent-core/core', () => ({
  listTools: loopToolsMock
}))

vi.mock('@shared/types/ai-provider', () => ({
  providerRegistry: providerRegistryMock
}))

// codegen.ts 顶层 import { CodegenService }（仅类型用），mock 避免加载重依赖
vi.mock('@main/services/flow/codegen', () => ({
  CodegenService: vi.fn()
}))

vi.mock('@main/services/crashReporter', () => ({
  getRecentReports: getRecentReportsMock,
  readReport: readReportMock,
  clearReports: clearReportsMock,
  captureException: captureExceptionMock,
  exportDiagnostic: exportDiagnosticMock
}))

vi.mock('@main/services/debugger', () => ({
  debuggerService: debuggerServiceMock
}))

vi.mock('@main/services/diagnostics', () => ({
  exportDiagnostics: exportDiagnosticsMock
}))

// ===========================================================================
// 导入被测模块（vi.mock 之后）
// ===========================================================================
import { registerAiIpc } from '@main/ipc/ai'
import { registerAIProviderIpc } from '@main/ipc/aiProvider'
import { registerCodegenIpc } from '@main/ipc/codegen'
import { registerCrashIpc } from '@main/ipc/crash'
import { registerCrashReporterIpc } from '@main/ipc/crashReporter'
import { registerDebuggerIpc } from '@main/ipc/debugger'
import { registerDiagnosticsIpc } from '@main/ipc/diagnostics'

// ===========================================================================
// 辅助工具
// ===========================================================================
interface IpcResult {
  ok: boolean
  data?: unknown
  error?: string
}

/** 从 ipcMain.handle 调用记录中提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> | unknown {
  const call = ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown> | unknown
}

/** 从 ipcMain.on 调用记录中提取指定 channel 的 listener */
function getOnHandler(channel: string): (...args: unknown[]) => void {
  const call = ipcMainOnMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`on handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => void
}

/** 构造一个 mock BrowserWindow，含 webContents.send */
function makeMockWin(): {
  webContents: { send: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
} {
  return { webContents: { send: vi.fn() }, isDestroyed: vi.fn(() => false) }
}

/** 所有 mock 函数组，用于 beforeEach 重置 */
const allMocks = [
  ipcMainHandleMock,
  ipcMainOnMock,
  browserWindowFromWebContents,
  dialogShowSaveDialog,
  appGetName,
  processAiChatMock,
  setAiConfigMock,
  getAiConfigMock,
  beginBatchMock,
  commitBatchMock,
  handleRollbackBatchMock,
  providerRegistryMock.list,
  providerRegistryMock.getCurrent,
  providerRegistryMock.getOrCreate,
  providerRegistryMock.has,
  providerRegistryMock.setCurrent,
  codegenGenerateMock,
  getRecentReportsMock,
  readReportMock,
  clearReportsMock,
  captureExceptionMock,
  exportDiagnosticMock,
  debuggerServiceMock.setBreakpoints,
  debuggerServiceMock.start,
  debuggerServiceMock.stepOver,
  debuggerServiceMock.stepInto,
  debuggerServiceMock.stepOut,
  debuggerServiceMock.continue,
  debuggerServiceMock.pause,
  debuggerServiceMock.stop,
  debuggerServiceMock.getState,
  exportDiagnosticsMock
]

// ===========================================================================
// beforeEach —— 重置所有 mock，恢复默认返回值，重新注册所有 IPC
// ===========================================================================
beforeEach(() => {
  for (const m of allMocks) m.mockReset()
  // 恢复默认返回值
  browserWindowFromWebContents.mockReturnValue(null)
  appGetName.mockReturnValue('qqbat')
  getAiConfigMock.mockReturnValue(null)
  providerRegistryMock.list.mockReturnValue(['glm', 'openai'])
  providerRegistryMock.getCurrent.mockReturnValue('glm')
  providerRegistryMock.has.mockReturnValue(true)
  debuggerServiceMock.getState.mockReturnValue({ status: 'idle', variables: [], callStack: [] })
  // 注册所有 IPC handler
  // ai IPC 需要 ProjectService 提供 baseDir（渲染层传来的 projectPath 必须落在项目根内）
  registerAiIpc({ getBaseDir: () => '/' } as never)
  registerAIProviderIpc()
  registerCodegenIpc({ generate: codegenGenerateMock } as never)
  registerCrashReporterIpc()
  registerDebuggerIpc()
  registerDiagnosticsIpc()
})

// ===========================================================================
// ai IPC
// ===========================================================================
describe('ai IPC', () => {
  describe('ai:chat', () => {
    it('正常路径：异步派发 processAiChat 返回 ok:true', async () => {
      processAiChatMock.mockResolvedValue(undefined)
      const win = makeMockWin()
      browserWindowFromWebContents.mockReturnValue(win)

      const res = (await getHandler('ai:chat')(
        { sender: {} },
        { projectPath: '/proj', message: 'hello' }
      )) as IpcResult
      expect(res.ok).toBe(true)
      expect(processAiChatMock).toHaveBeenCalledWith('/proj', 'hello', win, {})
    })

    it('参数校验：缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('ai:chat')(
        { sender: {} },
        { message: 'hello' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
      expect(processAiChatMock).not.toHaveBeenCalled()
    })

    it('参数校验：缺少 message 返回 ok:false', async () => {
      const res = (await getHandler('ai:chat')(
        { sender: {} },
        { projectPath: '/proj' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('无法获取窗口返回 ok:false', async () => {
      browserWindowFromWebContents.mockReturnValue(null)

      const res = (await getHandler('ai:chat')(
        { sender: {} },
        { projectPath: '/proj', message: 'hello' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('无法获取窗口')
      expect(processAiChatMock).not.toHaveBeenCalled()
    })

    it('processAiChat 同步抛异常返回 ok:false', async () => {
      processAiChatMock.mockImplementation(() => {
        throw new Error('chat-sync-error')
      })
      browserWindowFromWebContents.mockReturnValue(makeMockWin())

      const res = (await getHandler('ai:chat')(
        { sender: {} },
        { projectPath: '/proj', message: 'hello' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('chat-sync-error')
    })

    it('processAiChat 异步拒绝时通过 webContents.send 通知，仍返回 ok:true', async () => {
      processAiChatMock.mockRejectedValue(new Error('async-error'))
      const win = makeMockWin()
      browserWindowFromWebContents.mockReturnValue(win)

      const res = (await getHandler('ai:chat')(
        { sender: {} },
        { projectPath: '/proj', message: 'hello' }
      )) as IpcResult
      expect(res.ok).toBe(true)
      // 等待微任务队列中的 .catch 回调执行
      await new Promise((r) => setTimeout(r, 0))
      expect(win.webContents.send).toHaveBeenCalledWith('ai:chunk', expect.any(Object))
      expect(win.webContents.send).toHaveBeenCalledWith('ai:response', expect.any(Object))
    })
  })

  describe('ai:tools', () => {
    it('正常路径：返回循环注册表，缺 category 的按 mutation 补、缺 parameters 的补空对象', async () => {
      const res = (await getHandler('ai:tools')()) as IpcResult
      expect(res.ok).toBe(true)
      const rows = res.data as Array<{ name: string; category: string; parameters: unknown }>
      expect(rows.slice(0, 2)).toEqual([
        { name: 'list_dir', description: '列目录', category: 'query', parameters: { type: 'object' } },
        { name: 'write_file', description: '写文件', category: 'mutation', parameters: {} }
      ])
      // 旧助手定义也并进来了（同一个名字只留循环版）
      expect(rows.map((row) => row.name)).toContain('apply_template')
      expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length)
    })
  })

  describe('ai:setConfig', () => {
    it('正常路径：setAiConfig 被调用返回 ok:true', async () => {
      const config = { provider: 'glm', apiKey: 'k', model: 'm' }
      const res = (await getHandler('ai:setConfig')({}, config)) as IpcResult
      expect(res.ok).toBe(true)
      expect(setAiConfigMock).toHaveBeenCalledWith(config)
    })

    it('参数校验：provider 非法返回 ok:false', async () => {
      const res = (await getHandler('ai:setConfig')(
        {},
        { provider: 'unknown', apiKey: 'k', model: 'm' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
      expect(setAiConfigMock).not.toHaveBeenCalled()
    })

    it('参数校验：apiKey 为空返回 ok:false', async () => {
      const res = (await getHandler('ai:setConfig')(
        {},
        { provider: 'glm', apiKey: '', model: 'm' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('setAiConfig 抛异常返回 ok:false', async () => {
      setAiConfigMock.mockImplementation(() => {
        throw new Error('set-cfg-fail')
      })

      const res = (await getHandler('ai:setConfig')(
        {},
        { provider: 'glm', apiKey: 'k', model: 'm' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('set-cfg-fail')
    })
  })

  describe('ai:getConfig', () => {
    it('正常路径：返回当前配置', async () => {
      const cfg = { provider: 'glm', apiKey: 'k', model: 'm' }
      getAiConfigMock.mockReturnValue(cfg)

      const res = (await getHandler('ai:getConfig')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(cfg)
    })

    it('未配置时返回 ok:true data:null', async () => {
      getAiConfigMock.mockReturnValue(null)

      const res = (await getHandler('ai:getConfig')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toBeNull()
    })

    it('getAiConfig 抛异常时包成 ok:false（10/18 起 handler 走 tryIpcAsync，不再把异常抛给渲染层）', async () => {
      getAiConfigMock.mockImplementation(() => {
        throw new Error('get-cfg-fail')
      })

      const res = (await getHandler('ai:getConfig')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('get-cfg-fail')
    })
  })

  describe('ai:beginBatch', () => {
    it('正常路径：beginBatch 被调用返回 ok:true', async () => {
      const win = makeMockWin()
      browserWindowFromWebContents.mockReturnValue(win)

      const res = (await getHandler('ai:beginBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(beginBatchMock).toHaveBeenCalledWith('/proj', win)
    })

    it('无法获取窗口返回 ok:false', async () => {
      browserWindowFromWebContents.mockReturnValue(null)

      const res = (await getHandler('ai:beginBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('无法获取窗口')
      expect(beginBatchMock).not.toHaveBeenCalled()
    })

    it('beginBatch 抛异常返回 ok:false', async () => {
      beginBatchMock.mockImplementation(() => {
        throw new Error('begin-fail')
      })
      browserWindowFromWebContents.mockReturnValue(makeMockWin())

      const res = (await getHandler('ai:beginBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('begin-fail')
    })
  })

  describe('ai:commitBatch', () => {
    it('正常路径返回 ok:true', async () => {
      const res = (await getHandler('ai:commitBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(commitBatchMock).toHaveBeenCalledWith('/proj')
    })

    it('commitBatch 抛异常返回 ok:false', async () => {
      commitBatchMock.mockImplementation(() => {
        throw new Error('commit-fail')
      })

      const res = (await getHandler('ai:commitBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('commit-fail')
    })
  })

  describe('ai:rollbackBatch', () => {
    it('正常路径返回 ok:true', async () => {
      const res = (await getHandler('ai:rollbackBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(handleRollbackBatchMock).toHaveBeenCalledWith('/proj')
    })

    it('handleRollbackBatch 抛异常返回 ok:false', async () => {
      handleRollbackBatchMock.mockImplementation(() => {
        throw new Error('rollback-fail')
      })

      const res = (await getHandler('ai:rollbackBatch')({ sender: {} }, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('rollback-fail')
    })
  })
})

// ===========================================================================
// aiProvider IPC
// ===========================================================================
describe('aiProvider IPC', () => {
  describe('aiProvider:list', () => {
    it('正常路径：返回 providers 列表和当前 provider', async () => {
      const res = (await getHandler('aiProvider:list')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ providers: ['glm', 'openai'], current: 'glm' })
      expect(providerRegistryMock.list).toHaveBeenCalledTimes(1)
      expect(providerRegistryMock.getCurrent).toHaveBeenCalledTimes(1)
    })

    it('providerRegistry.list 抛异常返回 ok:false', async () => {
      providerRegistryMock.list.mockImplementation(() => {
        throw new Error('list-fail')
      })

      const res = (await getHandler('aiProvider:list')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('list-fail')
    })
  })

  describe('aiProvider:test', () => {
    it('参数校验：args 非对象返回 ok:false', async () => {
      const res = (await getHandler('aiProvider:test')({}, 'not-object')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('参数校验：args 为 null 返回 ok:false', async () => {
      const res = (await getHandler('aiProvider:test')({}, null)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('正常路径：测试连接成功返回响应', async () => {
      const mockProvider = {
        chat: vi.fn(async (_msgs, _tools, callbacks) => {
          callbacks.onChunk({ type: 'text', content: '连接成功' })
          callbacks.onComplete('连接成功')
        })
      }
      providerRegistryMock.getOrCreate.mockReturnValue(mockProvider)

      const config = { provider: 'glm', apiKey: 'k', model: 'm' }
      const res = (await getHandler('aiProvider:test')({}, config)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ response: '连接成功' })
      expect(mockProvider.chat).toHaveBeenCalledTimes(1)
    })

    it('provider.chat 无返回内容时降级文案', async () => {
      const mockProvider = {
        chat: vi.fn(async (_msgs, _tools, callbacks) => {
          callbacks.onComplete('')
        })
      }
      providerRegistryMock.getOrCreate.mockReturnValue(mockProvider)

      const res = (await getHandler('aiProvider:test')(
        {},
        { provider: 'glm', apiKey: 'k', model: 'm' }
      )) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ response: '连接成功（无返回内容）' })
    })

    it('provider.chat 抛异常返回 ok:false（带"连接失败"前缀）', async () => {
      const mockProvider = {
        chat: vi.fn(async () => {
          throw new Error('timeout')
        })
      }
      providerRegistryMock.getOrCreate.mockReturnValue(mockProvider)

      const res = (await getHandler('aiProvider:test')(
        {},
        { provider: 'glm', apiKey: 'k', model: 'm' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/连接失败.*timeout/)
    })
  })

  describe('aiProvider:switch', () => {
    it('正常路径：切换 Provider 返回 ok:true', async () => {
      providerRegistryMock.has.mockReturnValue(true)

      const res = (await getHandler('aiProvider:switch')(
        {},
        { provider: 'openai', config: { provider: 'openai', apiKey: 'k', model: 'm' } }
      )) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ provider: 'openai' })
      expect(providerRegistryMock.setCurrent).toHaveBeenCalledWith('openai')
    })

    it('参数校验：args 非对象返回 ok:false', async () => {
      const res = (await getHandler('aiProvider:switch')({}, null)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('未知的 Provider 返回 ok:false', async () => {
      providerRegistryMock.has.mockReturnValue(false)

      const res = (await getHandler('aiProvider:switch')(
        {},
        { provider: 'unknown', config: { provider: 'unknown', apiKey: 'k', model: 'm' } }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/未知的 Provider/)
      expect(providerRegistryMock.setCurrent).not.toHaveBeenCalled()
    })

    it('setCurrent 抛异常返回 ok:false', async () => {
      providerRegistryMock.has.mockReturnValue(true)
      providerRegistryMock.setCurrent.mockImplementation(() => {
        throw new Error('switch-fail')
      })

      const res = (await getHandler('aiProvider:switch')(
        {},
        { provider: 'glm', config: { provider: 'glm', apiKey: 'k', model: 'm' } }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('switch-fail')
    })
  })

  describe('aiProvider:getConfig', () => {
    it('正常路径：返回当前 provider 名称', async () => {
      providerRegistryMock.getCurrent.mockReturnValue('glm')

      const res = (await getHandler('aiProvider:getConfig')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ current: 'glm' })
    })

    it('getCurrent 抛异常返回 ok:false', async () => {
      providerRegistryMock.getCurrent.mockImplementation(() => {
        throw new Error('get-cfg-fail')
      })

      const res = (await getHandler('aiProvider:getConfig')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('get-cfg-fail')
    })
  })
})

// ===========================================================================
// codegen IPC
// ===========================================================================
describe('codegen IPC', () => {
  it('正常路径：generate 被调用返回 ok:true', async () => {
    codegenGenerateMock.mockResolvedValue(undefined)

    const res = (await getHandler('codegen:generate')({}, '/proj', { nodes: [], edges: [] })) as IpcResult
    expect(res.ok).toBe(true)
    expect(codegenGenerateMock).toHaveBeenCalledWith('/proj', { nodes: [], edges: [] }, false, undefined)
  })

  it('正常路径：debugMode=true 透传', async () => {
    codegenGenerateMock.mockResolvedValue(undefined)

    const res = (await getHandler('codegen:generate')({}, '/proj', { nodes: [] }, true)) as IpcResult
    expect(res.ok).toBe(true)
    expect(codegenGenerateMock).toHaveBeenCalledWith('/proj', { nodes: [] }, true, undefined)
  })

  it('参数校验：projectPath 为空返回 ok:false', async () => {
    const res = (await getHandler('codegen:generate')({}, '', { nodes: [] })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/参数校验失败/)
    expect(codegenGenerateMock).not.toHaveBeenCalled()
  })

  it('service.generate 抛异常返回 ok:false', async () => {
    codegenGenerateMock.mockRejectedValue(new Error('gen-fail'))

    const res = (await getHandler('codegen:generate')({}, '/proj', { nodes: [] })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('gen-fail')
  })
})

// ===========================================================================
// crash IPC（crash.ts 仅 re-export crashReporter.ts 的注册函数）
// ===========================================================================
describe('crash IPC (re-export)', () => {
  it('registerCrashIpc 与 registerCrashReporterIpc 是同一函数', () => {
    expect(registerCrashIpc).toBe(registerCrashReporterIpc)
  })
})

// ===========================================================================
// crashReporter IPC
// ===========================================================================
describe('crashReporter IPC', () => {
  describe('crash:getReports', () => {
    it('正常路径：返回报告列表', async () => {
      const reports = [{ id: 'r1', timestamp: 't1', type: 'captured', message: 'm1' }]
      getRecentReportsMock.mockResolvedValue(reports)

      const res = (await getHandler('crash:getReports')({}, { count: 5 })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(reports)
      expect(getRecentReportsMock).toHaveBeenCalledWith(5)
    })

    it('正常路径：无 count 参数使用默认值', async () => {
      getRecentReportsMock.mockResolvedValue([])

      const res = (await getHandler('crash:getReports')({}, {})) as IpcResult
      expect(res.ok).toBe(true)
      expect(getRecentReportsMock).toHaveBeenCalledWith(undefined)
    })

    it('参数校验：count 为负数返回 ok:false', async () => {
      const res = (await getHandler('crash:getReports')({}, { count: -1 })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
      expect(getRecentReportsMock).not.toHaveBeenCalled()
    })

    it('参数校验：count 为非整数返回 ok:false', async () => {
      const res = (await getHandler('crash:getReports')({}, { count: 1.5 })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      getRecentReportsMock.mockRejectedValue(new Error('reports-fail'))

      const res = (await getHandler('crash:getReports')({}, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('reports-fail')
    })
  })

  describe('crash:readReport', () => {
    it('正常路径：返回报告详情', async () => {
      const report = { id: 'r1', timestamp: 't1', type: 'captured', message: 'm1', stack: '', version: '1', os: '' }
      readReportMock.mockResolvedValue(report)

      const res = (await getHandler('crash:readReport')({}, { id: 'r1' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(report)
      expect(readReportMock).toHaveBeenCalledWith('r1')
    })

    it('报告不存在返回 ok:false', async () => {
      readReportMock.mockResolvedValue(null)

      const res = (await getHandler('crash:readReport')({}, { id: 'missing' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('报告不存在')
    })

    it('参数校验：缺少 id 返回 ok:false', async () => {
      const res = (await getHandler('crash:readReport')({}, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
      expect(readReportMock).not.toHaveBeenCalled()
    })

    it('service 抛异常返回 ok:false', async () => {
      readReportMock.mockRejectedValue(new Error('read-fail'))

      const res = (await getHandler('crash:readReport')({}, { id: 'r1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('read-fail')
    })
  })

  describe('crash:clearReports', () => {
    it('正常路径返回 ok:true', async () => {
      clearReportsMock.mockResolvedValue(undefined)

      const res = (await getHandler('crash:clearReports')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toBeNull()
      expect(clearReportsMock).toHaveBeenCalledTimes(1)
    })

    it('service 抛异常返回 ok:false', async () => {
      clearReportsMock.mockRejectedValue(new Error('clear-fail'))

      const res = (await getHandler('crash:clearReports')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('clear-fail')
    })
  })

  describe('crash:capture (ipcMain.on)', () => {
    it('正常路径：captureException 被调用', () => {
      const handler = getOnHandler('crash:capture')
      handler({}, { message: 'test error' })

      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
      const error = captureExceptionMock.mock.calls[0][0] as Error
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('test error')
    })

    it('带 stack 时设置 error.stack', () => {
      const handler = getOnHandler('crash:capture')
      handler({}, { message: 'boom', stack: 'custom-stack-trace' })

      const error = captureExceptionMock.mock.calls[0][0] as Error
      expect(error.stack).toBe('custom-stack-trace')
    })

    it('带 extra 时透传给 captureException', () => {
      const handler = getOnHandler('crash:capture')
      const extra = { foo: 'bar' }
      handler({}, { message: 'err', extra })

      expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), extra)
    })

    it('参数校验：缺少 message 不调用 captureException', () => {
      const handler = getOnHandler('crash:capture')
      handler({}, {})

      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('参数校验：args 为 null 不调用 captureException', () => {
      const handler = getOnHandler('crash:capture')
      handler({}, null)

      expect(captureExceptionMock).not.toHaveBeenCalled()
    })
  })

  describe('crash:exportDiagnostic', () => {
    it('正常路径（有窗口）：导出成功', async () => {
      const win = makeMockWin()
      browserWindowFromWebContents.mockReturnValue(win)
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      exportDiagnosticMock.mockResolvedValue({ outputPath: '/out/diag.zip', fileSize: 1024 })

      const res = (await getHandler('crash:exportDiagnostic')({ sender: {} })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ outputPath: '/out/diag.zip', fileSize: 1024 })
      expect(dialogShowSaveDialog).toHaveBeenCalledWith(win, expect.objectContaining({ title: '导出诊断包' }))
      expect(exportDiagnosticMock).toHaveBeenCalledWith('/out/diag.zip')
    })

    it('正常路径（无窗口）：使用无 win 重载', async () => {
      browserWindowFromWebContents.mockReturnValue(null)
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      exportDiagnosticMock.mockResolvedValue({ outputPath: '/out/diag.zip', fileSize: 512 })

      const res = (await getHandler('crash:exportDiagnostic')({ sender: {} })) as IpcResult
      expect(res.ok).toBe(true)
      expect(dialogShowSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '导出诊断包' }))
    })

    it('用户取消返回 ok:false', async () => {
      dialogShowSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

      const res = (await getHandler('crash:exportDiagnostic')({ sender: {} })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('用户取消')
      expect(exportDiagnosticMock).not.toHaveBeenCalled()
    })

    it('exportDiagnostic 抛异常返回 ok:false', async () => {
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      exportDiagnosticMock.mockRejectedValue(new Error('export-fail'))

      const res = (await getHandler('crash:exportDiagnostic')({ sender: {} })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('export-fail')
    })
  })
})

// ===========================================================================
// debugger IPC
// ===========================================================================
describe('debugger IPC', () => {
  describe('debug:setBreakpoints', () => {
    it('正常路径：setBreakpoints 被调用返回 ok:true', async () => {
      const bps = [{ nodeId: 'n1', enabled: true }]
      const res = (await getHandler('debug:setBreakpoints')({}, bps)) as IpcResult
      expect(res.ok).toBe(true)
      expect(debuggerServiceMock.setBreakpoints).toHaveBeenCalledWith(bps)
    })

    it('参数校验：非数组返回 ok:false', async () => {
      const res = (await getHandler('debug:setBreakpoints')({}, 'not-array')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('参数必须是 Breakpoint 数组')
      expect(debuggerServiceMock.setBreakpoints).not.toHaveBeenCalled()
    })

    it('参数校验：null 返回 ok:false', async () => {
      const res = (await getHandler('debug:setBreakpoints')({}, null)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('参数必须是 Breakpoint 数组')
    })

    it('setBreakpoints 抛异常返回 ok:false', async () => {
      debuggerServiceMock.setBreakpoints.mockImplementation(() => {
        throw new Error('bp-fail')
      })

      const res = (await getHandler('debug:setBreakpoints')({}, [])) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('bp-fail')
    })
  })

  // 会话控制类 handler：正常路径 + 错误路径
  const sessionHandlers: Array<{ channel: string; method: keyof typeof debuggerServiceMock }> = [
    { channel: 'debug:start', method: 'start' },
    { channel: 'debug:stepOver', method: 'stepOver' },
    { channel: 'debug:stepInto', method: 'stepInto' },
    { channel: 'debug:stepOut', method: 'stepOut' },
    { channel: 'debug:continue', method: 'continue' },
    { channel: 'debug:pause', method: 'pause' },
    { channel: 'debug:stop', method: 'stop' }
  ]

  for (const { channel, method } of sessionHandlers) {
    describe(channel, () => {
      it('正常路径返回 ok:true', async () => {
        const res = (await getHandler(channel)()) as IpcResult
        expect(res.ok).toBe(true)
        expect(debuggerServiceMock[method]).toHaveBeenCalledTimes(1)
      })

      it('service 抛异常返回 ok:false', async () => {
        const mock = debuggerServiceMock[method] as unknown as { mockImplementation: (fn: () => void) => void }
        mock.mockImplementation(() => {
          throw new Error(`${channel}-fail`)
        })

        const res = (await getHandler(channel)()) as IpcResult
        expect(res.ok).toBe(false)
        expect(res.error).toBe(`${channel}-fail`)
      })
    })
  }

  describe('debug:getState', () => {
    it('正常路径：返回当前状态', async () => {
      const state = { status: 'paused', variables: [], callStack: [], pausedNodeId: 'n1' }
      debuggerServiceMock.getState.mockReturnValue(state)

      const res = (await getHandler('debug:getState')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(state)
    })

    it('getState 抛异常返回 ok:false', async () => {
      debuggerServiceMock.getState.mockImplementation(() => {
        throw new Error('state-fail')
      })

      const res = (await getHandler('debug:getState')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('state-fail')
    })
  })

  describe('debug:getVariables', () => {
    it('正常路径：返回 variables 数组', async () => {
      const vars = [{ name: 'x', value: '1', type: 'int' }]
      debuggerServiceMock.getState.mockReturnValue({ status: 'paused', variables: vars, callStack: [] })

      const res = (await getHandler('debug:getVariables')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(vars)
    })

    it('getState 抛异常返回 ok:false', async () => {
      debuggerServiceMock.getState.mockImplementation(() => {
        throw new Error('vars-fail')
      })

      const res = (await getHandler('debug:getVariables')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('vars-fail')
    })
  })
})

// ===========================================================================
// diagnostics IPC
// ===========================================================================
describe('diagnostics IPC', () => {
  describe('diagnostics:export', () => {
    it('正常路径（有窗口）：导出成功', async () => {
      const win = makeMockWin()
      browserWindowFromWebContents.mockReturnValue(win)
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      exportDiagnosticsMock.mockResolvedValue({ outputPath: '/out/diag.zip', fileSize: 2048 })

      const res = (await getHandler('diagnostics:export')(
        { sender: {} },
        { projectPath: '/proj' }
      )) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ outputPath: '/out/diag.zip', fileSize: 2048 })
      expect(dialogShowSaveDialog).toHaveBeenCalledWith(win, expect.objectContaining({ title: '导出诊断包' }))
      expect(exportDiagnosticsMock).toHaveBeenCalledWith('/proj', '/out/diag.zip', expect.any(Function))
    })

    it('正常路径（无窗口）：使用无 win 重载', async () => {
      browserWindowFromWebContents.mockReturnValue(null)
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      exportDiagnosticsMock.mockResolvedValue({ outputPath: '/out/diag.zip', fileSize: 100 })

      const res = (await getHandler('diagnostics:export')(
        { sender: {} },
        { projectPath: '/proj' }
      )) as IpcResult
      expect(res.ok).toBe(true)
      expect(dialogShowSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '导出诊断包' }))
    })

    it('参数校验：缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('diagnostics:export')(
        { sender: {} },
        {}
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
      expect(dialogShowSaveDialog).not.toHaveBeenCalled()
    })

    it('参数校验：projectPath 为空字符串返回 ok:false', async () => {
      const res = (await getHandler('diagnostics:export')(
        { sender: {} },
        { projectPath: '' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('用户取消返回 ok:false', async () => {
      dialogShowSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

      const res = (await getHandler('diagnostics:export')(
        { sender: {} },
        { projectPath: '/proj' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('用户取消')
      expect(exportDiagnosticsMock).not.toHaveBeenCalled()
    })

    it('exportDiagnostics 抛异常返回 ok:false', async () => {
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      exportDiagnosticsMock.mockRejectedValue(new Error('diag-fail'))

      const res = (await getHandler('diagnostics:export')(
        { sender: {} },
        { projectPath: '/proj' }
      )) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('diag-fail')
    })

    it('导出过程中通过 win.webContents.send 推送进度', async () => {
      const win = makeMockWin()
      browserWindowFromWebContents.mockReturnValue(win)
      dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/diag.zip' })
      // 捕获 onProgress 回调并模拟调用
      exportDiagnosticsMock.mockImplementation(async (_p, _o, onProgress) => {
        onProgress?.({ phase: 'collecting_logs', message: '正在收集日志...' })
        return { outputPath: '/out/diag.zip', fileSize: 10 }
      })

      await getHandler('diagnostics:export')({ sender: {} }, { projectPath: '/proj' })
      expect(win.webContents.send).toHaveBeenCalledWith('diagnostics:progress', {
        phase: 'collecting_logs',
        message: '正在收集日志...'
      })
    })
  })
})
