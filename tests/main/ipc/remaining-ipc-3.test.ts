// tests/main/ipc/remaining-ipc-3.test.ts
// 覆盖以下 IPC handler：official / plugins / register / sshDeploy / terminal / adapter / dockerExport
//
// 2026-10-24 恢复注：napcat 与 python 两组通道在当前 revision 已不存在 —— NapCat adapter 退役
//（adapter 只剩 official/lark/dingtalk），python 服务（python.ts / pythonLinter / pythonDebugger）也跟着删了。
// 原文件的「napcat IPC」「python IPC」两节及其 mock 一并移除。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ===========================================================================
// vi.hoisted —— 保证 mock 引用在 vi.mock 工厂中可用
// ===========================================================================
const mocks = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn()
  const browserWindowFromWebContents = vi.fn()
  const dialogShowOpenDialog = vi.fn()
  const shellOpenPath = vi.fn()

  // ---- napcat service ----
  const napcatService = {
    startNapcat: vi.fn(),
    stopNapcat: vi.fn(),
    getNapcatStatus: vi.fn(),
    onNapcatStatusChange: vi.fn(() => () => {}),
    onNapcatQqDetected: vi.fn(() => () => {}),
    onNapcatToken: vi.fn(() => () => {}),
    saveNapcatPath: vi.fn(),
    loadNapcatPath: vi.fn()
  }

  // ---- napcat downloader ----
  class NapcatDownloadError extends Error {
    phase: 'network' | 'disk' | 'extract'
    constructor(message: string, phase: 'network' | 'disk' | 'extract' = 'network') {
      super(message)
      this.name = 'NapcatDownloadError'
      this.phase = phase
    }
  }
  const napcatDownloader = {
    downloadNapCat: vi.fn(),
    isNapcatDownloaded: vi.fn(),
    NapcatDownloadError
  }

  // ---- official service ----
  const officialService = {
    startOfficial: vi.fn(),
    stopOfficial: vi.fn(),
    getOfficialStatus: vi.fn(),
    testOfficialConnection: vi.fn(),
    sendOfficialMessage: vi.fn(),
    uploadOfficialFile: vi.fn(),
    sendOfficialMedia: vi.fn(),
    recallOfficialMessage: vi.fn(),
    onOfficialStatusChange: vi.fn(() => () => {}),
    onOfficialMessage: vi.fn(() => () => {}),
    saveOfficialConfig: vi.fn(),
    loadOfficialConfig: vi.fn()
  }

  // ---- onebot-translator ----
  const translatorService = {
    startTranslator: vi.fn(),
    stopTranslator: vi.fn(),
    getTranslatorStatus: vi.fn(),
    findFreePort: vi.fn(() => 8080)
  }

  // ---- fileOps ----
  const fileOps = { atomicWrite: vi.fn() }

  // ---- fs/promises (official.ts 的 readFile) ----
  const fsPromisesReadFile = vi.fn()

  // ---- pluginScanner ----
  const pluginScanner = {
    scanPlugins: vi.fn(),
    loadPluginPackage: vi.fn()
  }

  // ---- aiPluginLoader（插件市场/AI 插件层，plugins.ts 的 unload/setEnabled 先问它）----
  const aiPluginLoader = {
    aiPluginIdOf: vi.fn((name: string) => `ai.${name}`),
    setAiPluginEnabledByName: vi.fn(async () => false),
    unloadAiPluginByName: vi.fn(() => false),
    loadAiPluginPackage: vi.fn(),
    pluginDataDir: vi.fn(() => '/data')
  }

  // ---- pluginLoader ----
  const pluginLoader = {
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
    setPluginEnabled: vi.fn(),
    getPluginInfos: vi.fn(),
    getAllPluginSpecs: vi.fn()
  }

  // ---- fs (plugins.ts 用) ----
  const fsExistsSync = vi.fn()
  const fsMkdirSync = vi.fn()
  const fsCopyFileSync = vi.fn()
  const fsReaddirSync = vi.fn()
  const fsReadFileSync = vi.fn()

  // ---- fs/promises (plugins.ts 用，异步 API) ----
  const fsPromisesAccess = vi.fn()
  const fsPromisesMkdir = vi.fn()
  const fsPromisesCopyFile = vi.fn()
  const fsPromisesReaddir = vi.fn()

  // ---- python service ----
  const pythonService = {
    detectPython: vi.fn(),
    createVenv: vi.fn(),
    installDependencies: vi.fn(),
    verifyVenv: vi.fn(),
    checkVenvUpdates: vi.fn(),
    updateDependencies: vi.fn(),
    savePythonPath: vi.fn(),
    loadCustomPythonPath: vi.fn()
  }

  // ---- terminal service ----
  const terminalService = {
    createTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    killTerminal: vi.fn(),
    registerTerminalDataHandler: vi.fn()
  }

  // ---- batcher ----
  // 注意：必须用普通函数（不能用箭头函数），因为 terminal.ts 中用 `new BatchAccumulator(...)` 调用
  const BatchAccumulatorMock = vi.fn(function (this: unknown) {
    return {
      add: vi.fn(),
      flush: vi.fn(),
      destroy: vi.fn()
    }
  })

  // ---- sshDeploy service ----
  const sshDeployService = {
    deployProjectViaSsh: vi.fn(),
    tryLoadSsh2: vi.fn()
  }

  // ---- dockerExport service ----
  const dockerExportService = {
    exportProjectToDocker: vi.fn()
  }

  // ---- adapter registry ----
  const adapterRegistry = {
    list: vi.fn(() => ['napcat', 'official']),
    has: vi.fn((type: string) => type === 'napcat' || type === 'official')
  }

  return {
    ipcMainHandleMock,
    browserWindowFromWebContents,
    dialogShowOpenDialog,
    shellOpenPath,
    napcatService,
    napcatDownloader,
    officialService,
    translatorService,
    fileOps,
    fsPromisesReadFile,
    pluginScanner,
    pluginLoader,
    aiPluginLoader,
    fsExistsSync,
    fsMkdirSync,
    fsCopyFileSync,
    fsReaddirSync,
    fsReadFileSync,
    fsPromisesAccess,
    fsPromisesMkdir,
    fsPromisesCopyFile,
    fsPromisesReaddir,
    pythonService,
    terminalService,
    BatchAccumulatorMock,
    sshDeployService,
    dockerExportService,
    adapterRegistry
  }
})

// ===========================================================================
// vi.mock —— 模块级 mock，对所有 import 生效
// ===========================================================================
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandleMock },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: mocks.browserWindowFromWebContents
  },
  dialog: { showOpenDialog: mocks.dialogShowOpenDialog },
  shell: { openPath: mocks.shellOpenPath }
}))

vi.mock('@main/services/official', () => mocks.officialService)
vi.mock('@main/services/onebot-translator', () => mocks.translatorService)
vi.mock('@main/services/fileOps', () => mocks.fileOps)
vi.mock('fs/promises', () => {
  const m = {
    readFile: mocks.fsPromisesReadFile,
    access: mocks.fsPromisesAccess,
    mkdir: mocks.fsPromisesMkdir,
    copyFile: mocks.fsPromisesCopyFile,
    readdir: mocks.fsPromisesReaddir
  }
  return { ...m, default: m }
})
vi.mock('@main/services/pluginScanner', () => mocks.pluginScanner)
vi.mock('@main/services/pluginLoader', () => mocks.pluginLoader)
// plugins.ts 真身 import 的是嵌套路径（10/18 起插件服务收进 services/plugins/），
// 只 mock 扁平路径等于没 mock：真实 scanner/loader 会跑起来、返回空。
vi.mock('@main/services/plugins/pluginScanner', () => mocks.pluginScanner)
vi.mock('@main/services/plugins/pluginLoader', () => mocks.pluginLoader)
vi.mock('@main/services/plugins/aiPluginLoader', () => mocks.aiPluginLoader)
vi.mock('fs', () => {
  const m = {
    existsSync: mocks.fsExistsSync,
    mkdirSync: mocks.fsMkdirSync,
    copyFileSync: mocks.fsCopyFileSync,
    readdirSync: mocks.fsReaddirSync,
    readFileSync: mocks.fsReadFileSync,
    constants: { F_OK: 0 }
  }
  return { ...m, default: m }
})
vi.mock('@main/services/terminal', () => mocks.terminalService)
vi.mock('@main/services/batcher', () => ({ BatchAccumulator: mocks.BatchAccumulatorMock }))
vi.mock('@main/services/sshDeploy', () => mocks.sshDeployService)
vi.mock('@main/services/dockerExport', () => mocks.dockerExportService)
vi.mock('@shared/types/adapter', () => ({ adapterRegistry: mocks.adapterRegistry }))

// ===========================================================================
// 导入被测 IPC 注册函数
// ===========================================================================
import { registerOfficialIpc } from '@main/ipc/official'
import { registerPluginIpc } from '@main/ipc/plugins'
import { registerTerminalIpc } from '@main/ipc/terminal'
import { registerSshDeployIpc } from '@main/ipc/sshDeploy'
import { registerAdapterIpc } from '@main/ipc/adapter'
import { registerDockerExportIpc } from '@main/ipc/dockerExport'

// ===========================================================================
// 辅助
// ===========================================================================
interface IpcResult {
  ok: boolean
  data?: unknown
  error?: string
  [key: string]: unknown
}

/** 从 ipcMain.handle 的调用记录里提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

/** mock event，含 sender 供 BrowserWindow.fromWebContents 使用 */
const mockEvent = { sender: {} }
/** mock 窗口 */
const mockWin = {
  isDestroyed: vi.fn(() => false),
  webContents: { send: vi.fn() }
}

/** 所有 vi.fn mock 列表，用于 beforeEach 统一 reset */
const allMockFns: Array<{ mockReset: () => void }> = [
  mocks.ipcMainHandleMock,
  mocks.browserWindowFromWebContents,
  mocks.dialogShowOpenDialog,
  mocks.shellOpenPath,
  ...Object.values(mocks.napcatService),
  mocks.napcatDownloader.downloadNapCat,
  mocks.napcatDownloader.isNapcatDownloaded,
  ...Object.values(mocks.officialService),
  ...Object.values(mocks.translatorService),
  mocks.fileOps.atomicWrite,
  mocks.fsPromisesReadFile,
  ...Object.values(mocks.pluginScanner),
  ...Object.values(mocks.pluginLoader),
  ...Object.values(mocks.aiPluginLoader),
  mocks.fsExistsSync,
  mocks.fsMkdirSync,
  mocks.fsCopyFileSync,
  mocks.fsReaddirSync,
  mocks.fsReadFileSync,
  mocks.fsPromisesAccess,
  mocks.fsPromisesMkdir,
  mocks.fsPromisesCopyFile,
  mocks.fsPromisesReaddir,
  ...Object.values(mocks.pythonService),
  ...Object.values(mocks.terminalService),
  mocks.BatchAccumulatorMock,
  ...Object.values(mocks.sshDeployService),
  ...Object.values(mocks.dockerExportService),
  ...Object.values(mocks.adapterRegistry)
]

beforeEach(() => {
  // 重置所有 mock
  for (const fn of allMockFns) fn.mockReset()

  // 默认实现
  mocks.browserWindowFromWebContents.mockReturnValue(mockWin)
  mocks.translatorService.startTranslator.mockResolvedValue(undefined)
  mocks.translatorService.getTranslatorStatus.mockReturnValue({ running: false, clients: 0, port: 0 })
  // AI 插件层默认「没这个插件」→ unload/setEnabled 回落到节点插件那条老路
  mocks.aiPluginLoader.aiPluginIdOf.mockImplementation((name: string) => `ai.${name}`)
  mocks.aiPluginLoader.unloadAiPluginByName.mockReturnValue(false)
  mocks.aiPluginLoader.setAiPluginEnabledByName.mockResolvedValue(false)
  mocks.translatorService.findFreePort.mockReturnValue(8080)
  mocks.adapterRegistry.list.mockReturnValue(['napcat', 'official'])
  mocks.adapterRegistry.has.mockImplementation((type: string) => type === 'napcat' || type === 'official')
  // official.ts 的 getTranslatorPort 调用 readFile，默认让其失败以走 findFreePort 分支
  mocks.fsPromisesReadFile.mockRejectedValue(new Error('file not found'))
  // terminal.ts 的 BatchAccumulator 需要 mock 实例（用普通函数实现，支持 new 调用）
  mocks.BatchAccumulatorMock.mockImplementation(function (this: unknown) {
    return { add: vi.fn(), flush: vi.fn(), destroy: vi.fn() }
  })

  // 注册所有 IPC handler
  registerOfficialIpc()
  registerPluginIpc()
  registerTerminalIpc()
  registerSshDeployIpc()
  registerAdapterIpc()
  registerDockerExportIpc()
})

// ===========================================================================
// official IPC
// ===========================================================================
describe('official IPC', () => {
  describe('official:start', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.officialService.startOfficial.mockResolvedValue(undefined)
      const res = (await getHandler('official:start')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.officialService.startOfficial).toHaveBeenCalledWith('/proj')
    })

    it('缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('official:start')(mockEvent, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.startOfficial.mockRejectedValue(new Error('start-fail'))
      const res = (await getHandler('official:start')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('start-fail')
    })
  })

  describe('official:stop', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.officialService.stopOfficial.mockReturnValue(undefined)
      const res = (await getHandler('official:stop')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.officialService.stopOfficial).toHaveBeenCalledWith('/proj')
      expect(mocks.translatorService.stopTranslator).toHaveBeenCalledWith('/proj')
    })

    it('缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('official:stop')(mockEvent, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.stopOfficial.mockImplementation(() => { throw new Error('stop-fail') })
      const res = (await getHandler('official:stop')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('stop-fail')
    })
  })

  describe('official:status', () => {
    it('正常路径返回状态数据', async () => {
      const status = { status: 'connected', appId: 'app123', alive: true }
      mocks.officialService.getOfficialStatus.mockReturnValue(status)
      const res = (await getHandler('official:status')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(status)
    })

    it('缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('official:status')(mockEvent, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.getOfficialStatus.mockImplementation(() => { throw new Error('status-fail') })
      const res = (await getHandler('official:status')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('status-fail')
    })
  })

  describe('official:saveConfig', () => {
    const validArgs = { projectPath: '/proj', appId: 'app1', appSecret: 'secret1' }

    it('正常路径返回 ok:true', async () => {
      mocks.officialService.saveOfficialConfig.mockResolvedValue(undefined)
      const res = (await getHandler('official:saveConfig')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.officialService.saveOfficialConfig).toHaveBeenCalledWith('/proj', {
        appId: 'app1', appSecret: 'secret1', sandbox: undefined, wsUrl: undefined
      })
    })

    it('缺少 appId 返回 ok:false', async () => {
      const res = (await getHandler('official:saveConfig')(mockEvent, { projectPath: '/proj', appSecret: 's' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.saveOfficialConfig.mockRejectedValue(new Error('save-fail'))
      const res = (await getHandler('official:saveConfig')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('save-fail')
    })
  })

  describe('official:getConfig', () => {
    it('正常路径返回配置', async () => {
      const config = { appId: 'app1', appSecret: 'secret1' }
      mocks.officialService.loadOfficialConfig.mockResolvedValue(config)
      const res = (await getHandler('official:getConfig')(mockEvent, '/proj')) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(config)
      expect(mocks.officialService.loadOfficialConfig).toHaveBeenCalledWith('/proj')
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.loadOfficialConfig.mockRejectedValue(new Error('load-fail'))
      const res = (await getHandler('official:getConfig')(mockEvent, '/proj')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('load-fail')
    })
  })

  describe('official:testConnection', () => {
    it('正常路径连接成功返回 ok:true', async () => {
      mocks.officialService.testOfficialConnection.mockResolvedValue(true)
      const res = (await getHandler('official:testConnection')(mockEvent, { appId: 'a', appSecret: 's' })) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { connected: boolean }).connected).toBe(true)
    })

    it('连接失败返回 ok:false', async () => {
      mocks.officialService.testOfficialConnection.mockResolvedValue(false)
      const res = (await getHandler('official:testConnection')(mockEvent, { appId: 'a', appSecret: 's' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('连接失败')
    })

    it('缺少 appId 返回 ok:false', async () => {
      const res = (await getHandler('official:testConnection')(mockEvent, { appSecret: 's' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.testOfficialConnection.mockRejectedValue(new Error('conn-fail'))
      const res = (await getHandler('official:testConnection')(mockEvent, { appId: 'a', appSecret: 's' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('conn-fail')
    })
  })

  describe('official:sendMessage', () => {
    const validArgs = { projectPath: '/proj', chatType: 'group' as const, chatId: '12345', content: 'hello' }

    it('正常路径返回 ok:true', async () => {
      // handler 是透传：tryIpcAsync 把服务返回值整体放进 data，不再二次拆包
      const sent = { ok: true, data: { id: 'msg1', timestamp: 123 } }
      mocks.officialService.sendOfficialMessage.mockResolvedValue(sent)
      const res = (await getHandler('official:sendMessage')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(sent)
      expect(mocks.officialService.sendOfficialMessage).toHaveBeenCalledWith(
        '/proj', 'group', '12345', 'hello',
        expect.objectContaining({ msgType: undefined, markdown: undefined })
      )
    })

    it('缺少 chatId 返回 ok:false', async () => {
      const res = (await getHandler('official:sendMessage')(mockEvent, { projectPath: '/proj', chatType: 'group' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.sendOfficialMessage.mockRejectedValue(new Error('send-fail'))
      const res = (await getHandler('official:sendMessage')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('send-fail')
    })
  })

  describe('official:uploadFile', () => {
    const validArgs = { projectPath: '/proj', chatType: 'group' as const, chatId: '123', fileType: 1, url: 'http://x.com/f' }

    it('正常路径返回 ok:true', async () => {
      const uploaded = { ok: true, data: { fileInfo: 'fi', fileUuid: 'fu', ttl: 0 } }
      mocks.officialService.uploadOfficialFile.mockResolvedValue(uploaded)
      const res = (await getHandler('official:uploadFile')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(uploaded)
      expect(mocks.officialService.uploadOfficialFile).toHaveBeenCalledWith(
        '/proj', 'group', '123', 1, 'http://x.com/f', undefined
      )
    })

    it('缺少 url 返回 ok:false', async () => {
      const res = (await getHandler('official:uploadFile')(mockEvent, { projectPath: '/proj', chatType: 'group', chatId: '1', fileType: 1 })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.uploadOfficialFile.mockRejectedValue(new Error('upload-fail'))
      const res = (await getHandler('official:uploadFile')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('upload-fail')
    })
  })

  describe('official:sendMedia', () => {
    const validArgs = { projectPath: '/proj', chatType: 'c2c' as const, chatId: '123', mediaUrl: 'http://x.com/m', fileType: 2 }

    it('正常路径返回 ok:true', async () => {
      mocks.officialService.sendOfficialMedia.mockResolvedValue({ ok: true })
      const res = (await getHandler('official:sendMedia')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
    })

    it('缺少 mediaUrl 返回 ok:false', async () => {
      const res = (await getHandler('official:sendMedia')(mockEvent, { projectPath: '/proj', chatType: 'c2c', chatId: '1', fileType: 1 })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.sendOfficialMedia.mockRejectedValue(new Error('media-fail'))
      const res = (await getHandler('official:sendMedia')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('media-fail')
    })
  })

  describe('official:recallMessage', () => {
    const validArgs = { projectPath: '/proj', chatType: 'group' as const, chatId: '123', msgId: 'msg1' }

    it('正常路径返回 ok:true', async () => {
      mocks.officialService.recallOfficialMessage.mockResolvedValue(true)
      const res = (await getHandler('official:recallMessage')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
    })

    it('缺少 msgId 返回 ok:false', async () => {
      const res = (await getHandler('official:recallMessage')(mockEvent, { projectPath: '/proj', chatType: 'group', chatId: '1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.officialService.recallOfficialMessage.mockRejectedValue(new Error('recall-fail'))
      const res = (await getHandler('official:recallMessage')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('recall-fail')
    })
  })

  describe('official:startTranslator', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.translatorService.startTranslator.mockResolvedValue(undefined)
      const res = (await getHandler('official:startTranslator')(mockEvent, { projectPath: '/proj', port: 9090 })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.translatorService.startTranslator).toHaveBeenCalledWith('/proj', 9090)
    })

    it('缺少 port 返回 ok:false', async () => {
      const res = (await getHandler('official:startTranslator')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.translatorService.startTranslator.mockRejectedValue(new Error('translator-fail'))
      const res = (await getHandler('official:startTranslator')(mockEvent, { projectPath: '/proj', port: 9090 })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('translator-fail')
    })
  })

  describe('official:stopTranslator', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.translatorService.stopTranslator.mockReturnValue(undefined)
      const res = (await getHandler('official:stopTranslator')(mockEvent, {})) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.translatorService.stopTranslator).toHaveBeenCalled()
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.translatorService.stopTranslator.mockImplementation(() => { throw new Error('stop-t-fail') })
      const res = (await getHandler('official:stopTranslator')(mockEvent, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('stop-t-fail')
    })
  })

  describe('official:getTranslatorStatus', () => {
    it('正常路径返回状态数据', async () => {
      mocks.translatorService.getTranslatorStatus.mockReturnValue({ running: true, clients: 2, port: 8080 })
      const res = (await getHandler('official:getTranslatorStatus')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ running: true, clients: 2, port: 8080 })
    })
  })
})

// ===========================================================================
// plugins IPC
// ===========================================================================
describe('plugins IPC', () => {
  describe('plugin:scan', () => {
    it('正常路径返回插件列表和 errors', async () => {
      const plugins = [{ name: 'p1', version: '1.0.0' }]
      const errors: unknown[] = [{ type: 'manifest', message: 'bad manifest' }]
      // 10/18 起 scanPlugins 返回 { plugins, errors }（不再是「继承 Array 再挂属性」）
      mocks.pluginScanner.scanPlugins.mockResolvedValue({ plugins, errors })
      const res = (await getHandler('plugin:scan')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(plugins)
      expect(res.errors).toEqual(errors)
      expect(mocks.pluginScanner.scanPlugins).toHaveBeenCalledWith('/proj')
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginScanner.scanPlugins.mockRejectedValue(new Error('scan-fail'))
      const res = (await getHandler('plugin:scan')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('scan-fail')
    })
  })

  describe('plugin:load', () => {
    it('正常路径返回 ok:true', async () => {
      const pkg = { name: 'p1', version: '1.0.0' }
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({ package: pkg, errors: [] })
      mocks.pluginLoader.registerPlugin.mockReturnValue(true)
      const res = (await getHandler('plugin:load')(mockEvent, { pluginPath: '/proj/plugins/p1' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(pkg)
    })

    it('package 为 null 返回 ok:false', async () => {
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({ package: null, errors: [{ type: 'manifest', message: 'bad manifest' }] })
      const res = (await getHandler('plugin:load')(mockEvent, { pluginPath: '/proj/plugins/p1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/bad manifest/)
    })

    it('registerPlugin 返回 false 返回 ok:false', async () => {
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({ package: { name: 'p1', version: '1.0.0' }, errors: [] })
      mocks.pluginLoader.registerPlugin.mockReturnValue(false)
      const res = (await getHandler('plugin:load')(mockEvent, { pluginPath: '/proj/plugins/p1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/已加载/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginScanner.loadPluginPackage.mockRejectedValue(new Error('load-fail'))
      const res = (await getHandler('plugin:load')(mockEvent, { pluginPath: '/proj/plugins/p1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('load-fail')
    })
  })

  describe('plugin:unload', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.pluginLoader.unregisterPlugin.mockReturnValue(true)
      const res = (await getHandler('plugin:unload')(mockEvent, { pluginName: 'p1' })) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { name: string }).name).toBe('p1')
    })

    it('unregisterPlugin 返回 false 返回 ok:false', async () => {
      mocks.pluginLoader.unregisterPlugin.mockReturnValue(false)
      const res = (await getHandler('plugin:unload')(mockEvent, { pluginName: 'p1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/未加载/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.unregisterPlugin.mockImplementation(() => { throw new Error('unload-fail') })
      const res = (await getHandler('plugin:unload')(mockEvent, { pluginName: 'p1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('unload-fail')
    })
  })

  describe('plugin:install', () => {
    it('用户取消选择返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('用户取消')
    })

    it('所选目录无 manifest.json 返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      mocks.fsPromisesAccess.mockRejectedValue(new Error('ENOENT')) // manifest 不存在
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/manifest\.json/)
    })

    it('manifest 缺少 name/version 返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      // manifest 存在（access 成功）
      mocks.fsPromisesAccess.mockResolvedValue(undefined)
      mocks.fsPromisesReadFile.mockResolvedValue(JSON.stringify({ description: 'no name' }))
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/name.*version/)
    })

    it('目标目录已存在返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      // manifest 存在、有效；plugins 目录存在；target 目录已存在（access 全部成功）
      mocks.fsPromisesAccess.mockResolvedValue(undefined)
      mocks.fsPromisesReadFile.mockResolvedValue(JSON.stringify({ name: 'p1', version: '1.0.0' }))
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/已存在/)
    })

    it('正常路径返回 ok:true', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      // access(manifestPath) 成功、access(pluginsDir) 成功、access(targetDir) 失败（不存在）
      mocks.fsPromisesAccess.mockImplementation((p: unknown) => {
        const path = String(p)
        if (path.endsWith('p1')) return Promise.reject(new Error('ENOENT')) // targetDir 不存在
        return Promise.resolve()
      })
      mocks.fsPromisesReadFile.mockResolvedValue(JSON.stringify({ name: 'p1', version: '1.0.0' }))
      mocks.fsPromisesReaddir.mockResolvedValue([])
      mocks.fsPromisesMkdir.mockResolvedValue(undefined)
      const pkg = { name: 'p1', version: '1.0.0' }
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({ package: pkg, errors: [] })
      mocks.pluginLoader.registerPlugin.mockReturnValue(true)
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { name: string }).name).toBe('p1')
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockRejectedValue(new Error('dialog-fail'))
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('dialog-fail')
    })
  })

  describe('plugin:listInstalled', () => {
    it('正常路径返回已加载插件列表', async () => {
      const plugins = [{ name: 'p1', version: '1.0.0', enabled: true }]
      mocks.pluginLoader.getPluginInfos.mockReturnValue(plugins)
      const res = (await getHandler('plugin:listInstalled')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(plugins)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.getPluginInfos.mockImplementation(() => { throw new Error('list-fail') })
      const res = (await getHandler('plugin:listInstalled')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('list-fail')
    })
  })

  describe('plugin:setEnabled', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.pluginLoader.setPluginEnabled.mockReturnValue(true)
      const res = (await getHandler('plugin:setEnabled')(mockEvent, { pluginName: 'p1', enabled: false })) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { enabled: boolean }).enabled).toBe(false)
    })

    it('setPluginEnabled 返回 false 返回 ok:false', async () => {
      mocks.pluginLoader.setPluginEnabled.mockReturnValue(false)
      const res = (await getHandler('plugin:setEnabled')(mockEvent, { pluginName: 'p1', enabled: true })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/未加载/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.setPluginEnabled.mockImplementation(() => { throw new Error('enable-fail') })
      const res = (await getHandler('plugin:setEnabled')(mockEvent, { pluginName: 'p1', enabled: true })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('enable-fail')
    })
  })

  describe('plugin:getAllSpecs', () => {
    it('正常路径返回 NodeSpec 列表', async () => {
      const specs = [{ kind: 'p1_node1', type: 'custom', label: 'N1', summary: '', sideEffects: [] }]
      mocks.pluginLoader.getAllPluginSpecs.mockReturnValue(specs)
      const res = (await getHandler('plugin:getAllSpecs')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(specs)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.getAllPluginSpecs.mockImplementation(() => { throw new Error('specs-fail') })
      const res = (await getHandler('plugin:getAllSpecs')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('specs-fail')
    })
  })
})

// ===========================================================================
// terminal IPC
// ===========================================================================
describe('terminal IPC', () => {
  describe('terminal:create', () => {
    it('正常路径返回 ok:true 和 terminal id', async () => {
      mocks.terminalService.createTerminal.mockReturnValue('term-1')
      const res = (await getHandler('terminal:create')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toBe('term-1')
      expect(mocks.terminalService.createTerminal).toHaveBeenCalledWith('/proj')
      expect(mocks.terminalService.registerTerminalDataHandler).toHaveBeenCalledWith('term-1', expect.any(Function))
    })

    it('缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('terminal:create')(mockEvent, { projectPath: '' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.terminalService.createTerminal.mockImplementation(() => { throw new Error('create-fail') })
      const res = (await getHandler('terminal:create')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('create-fail')
    })
  })

  describe('terminal:write', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.terminalService.writeTerminal.mockReturnValue(undefined)
      const res = (await getHandler('terminal:write')(mockEvent, { id: 'term-1', data: 'ls\n' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.terminalService.writeTerminal).toHaveBeenCalledWith('term-1', 'ls\n')
    })

    it('缺少 id 返回 ok:false', async () => {
      const res = (await getHandler('terminal:write')(mockEvent, { data: 'ls' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.terminalService.writeTerminal.mockImplementation(() => { throw new Error('write-fail') })
      const res = (await getHandler('terminal:write')(mockEvent, { id: 'term-1', data: 'ls' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('write-fail')
    })
  })

  describe('terminal:kill', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.terminalService.killTerminal.mockReturnValue(undefined)
      // 先 create 以便 batcher 存在
      mocks.terminalService.createTerminal.mockReturnValue('term-1')
      await getHandler('terminal:create')(mockEvent, { projectPath: '/proj' })

      const res = (await getHandler('terminal:kill')(mockEvent, { id: 'term-1' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.terminalService.killTerminal).toHaveBeenCalledWith('term-1')
    })

    it('缺少 id 返回 ok:false', async () => {
      const res = (await getHandler('terminal:kill')(mockEvent, {})) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.terminalService.killTerminal.mockImplementation(() => { throw new Error('kill-fail') })
      const res = (await getHandler('terminal:kill')(mockEvent, { id: 'term-1' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('kill-fail')
    })
  })
})

// ===========================================================================
// adapter IPC
// ===========================================================================
describe('adapter IPC', () => {
  // 由于 currentAdapterType 是模块级状态，测试间共享。在 afterEach 中重置。
  afterEach(async () => {
    const switchHandler = getHandler('adapter:switch')
    await switchHandler({}, { type: 'napcat' })
  })

  it('adapter:list 返回已注册适配器列表', async () => {
    const res = (await getHandler('adapter:list')()) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(['napcat', 'official'])
    expect(mocks.adapterRegistry.list).toHaveBeenCalled()
  })

  it('adapter:switch 切换到有效类型返回 ok:true', async () => {
    const res = (await getHandler('adapter:switch')({}, { type: 'official' })) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe('official')
  })

  it('adapter:switch 未知类型返回 ok:false', async () => {
    mocks.adapterRegistry.has.mockReturnValue(false)
    const res = (await getHandler('adapter:switch')({}, { type: 'unknown' })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/未知的适配器类型/)
  })

  it('adapter:current 返回当前适配器类型', async () => {
    // 先切换到已知状态
    await getHandler('adapter:switch')({}, { type: 'napcat' })
    const res = (await getHandler('adapter:current')()) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe('napcat')
  })
})

// ===========================================================================
// dockerExport IPC
// ===========================================================================
describe('dockerExport IPC', () => {
  describe('docker:export', () => {
    const validArgs = {
      projectPath: '/proj',
      adapter: 'napcat' as const,
      outputDir: '/output',
      includeNapcat: true
    }

    it('正常路径返回 ok:true', async () => {
      const result = {
        success: true,
        outputDir: '/output',
        dockerfilePath: '/output/Dockerfile',
        buildCommand: 'docker build',
        runCommand: 'docker run',
        files: ['Dockerfile'],
        error: ''
      }
      mocks.dockerExportService.exportProjectToDocker.mockResolvedValue(result)
      const res = (await getHandler('docker:export')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(result)
    })

    it('导出失败（success=false）返回 ok:false', async () => {
      mocks.dockerExportService.exportProjectToDocker.mockResolvedValue({
        success: false, outputDir: '/output', dockerfilePath: '', buildCommand: '', runCommand: '', files: [], error: 'bot.py 缺失'
      })
      const res = (await getHandler('docker:export')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('bot.py 缺失')
    })

    it('缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('docker:export')(mockEvent, { adapter: 'napcat', outputDir: '/output' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.dockerExportService.exportProjectToDocker.mockRejectedValue(new Error('export-fail'))
      const res = (await getHandler('docker:export')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('export-fail')
    })
  })

  describe('docker:openFolder', () => {
    it('正常路径（字符串参数）返回 ok:true', async () => {
      mocks.shellOpenPath.mockResolvedValue('')
      const res = (await getHandler('docker:openFolder')(mockEvent, '/output')) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.shellOpenPath).toHaveBeenCalledWith('/output')
    })

    it('正常路径（对象参数）返回 ok:true', async () => {
      mocks.shellOpenPath.mockResolvedValue('')
      const res = (await getHandler('docker:openFolder')(mockEvent, { path: '/output' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.shellOpenPath).toHaveBeenCalledWith('/output')
    })

    it('空 path 返回 ok:false', async () => {
      const res = (await getHandler('docker:openFolder')(mockEvent, '')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('参数 path 为空')
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.shellOpenPath.mockRejectedValue(new Error('open-fail'))
      const res = (await getHandler('docker:openFolder')(mockEvent, '/output')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('open-fail')
    })
  })
})

// ===========================================================================
// sshDeploy IPC
// ===========================================================================
describe('sshDeploy IPC', () => {
  describe('ssh:deploy', () => {
    const validArgs = {
      projectPath: '/proj',
      host: 'example.com',
      port: 22,
      username: 'root',
      password: 'pass123',
      remotePath: '/opt/bot',
      adapter: 'napcat' as const,
      includeNapcat: false,
      mode: 'docker' as const
    }

    it('正常路径返回 ok:true', async () => {
      const result = { success: true, message: '部署成功', logs: ['log1', 'log2'], error: '' }
      mocks.sshDeployService.deployProjectViaSsh.mockResolvedValue(result)
      const res = (await getHandler('ssh:deploy')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(result)
    })

    it('部署失败（success=false）返回 ok:false 含 logs 在 error 中', async () => {
      const result = { success: false, message: '部署失败', logs: ['err log'], error: '连接超时' }
      mocks.sshDeployService.deployProjectViaSsh.mockResolvedValue(result)
      const res = (await getHandler('ssh:deploy')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      // P0-C3 修复：logs 合并到 error 消息中，不再携带 data 字段
      expect(res.error).toContain('连接超时')
      expect(res.error).toContain('err log')
      expect(res.data).toBeUndefined()
    })

    it('缺少 host 返回 ok:false', async () => {
      const res = (await getHandler('ssh:deploy')(mockEvent, { ...validArgs, host: '' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('缺少 password 和 privateKey 返回 ok:false', async () => {
      const { password: _pw, ...argsWithoutPw } = validArgs
      const { privateKey: _pk, ...rest } = argsWithoutPw as Record<string, unknown> & { privateKey?: string }
      const res = (await getHandler('ssh:deploy')(mockEvent, rest)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/password.*privateKey/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.sshDeployService.deployProjectViaSsh.mockRejectedValue(new Error('deploy-fail'))
      const res = (await getHandler('ssh:deploy')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('deploy-fail')
    })
  })

  describe('ssh:testConnection', () => {
    const validArgs = {
      host: 'example.com',
      port: 22,
      username: 'root',
      password: 'pass123'
    }

    it('ssh2 未安装返回 ok:false', async () => {
      mocks.sshDeployService.tryLoadSsh2.mockReturnValue(null)
      const res = (await getHandler('ssh:testConnection')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/未安装 ssh2/)
    })

    it('缺少 host 返回 ok:false', async () => {
      const res = (await getHandler('ssh:testConnection')(mockEvent, { ...validArgs, host: '' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('连接成功返回 ok:true 和 latency', async () => {
      // 构造 mock ssh2 Client
      const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
      const clientInstance = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb
          return clientInstance
        }),
        connect: vi.fn(() => {
          // 模拟 ready 事件
          setTimeout(() => handlers.ready?.(), 0)
        }),
        end: vi.fn()
      }
      // 注意：必须用普通函数（不能用箭头函数），因为 sshDeploy.ts 中用 `new ssh2.Client()` 调用
      const mockSsh2 = { Client: vi.fn(function (this: unknown) { return clientInstance }) }
      mocks.sshDeployService.tryLoadSsh2.mockReturnValue(mockSsh2)

      const res = (await getHandler('ssh:testConnection')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { connected: boolean }).connected).toBe(true)
      expect((res.data as { latency: number }).latency).toBeGreaterThanOrEqual(0)
      expect(clientInstance.connect).toHaveBeenCalled()
      expect(clientInstance.end).toHaveBeenCalled()
    })

    it('连接失败返回 ok:false', async () => {
      const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
      const clientInstance = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb
          return clientInstance
        }),
        connect: vi.fn(() => {
          // 模拟 error 事件
          setTimeout(() => handlers.error?.(new Error('connection refused')), 0)
        }),
        end: vi.fn()
      }
      // 注意：必须用普通函数（不能用箭头函数），因为 sshDeploy.ts 中用 `new ssh2.Client()` 调用
      const mockSsh2 = { Client: vi.fn(function (this: unknown) { return clientInstance }) }
      mocks.sshDeployService.tryLoadSsh2.mockReturnValue(mockSsh2)

      const res = (await getHandler('ssh:testConnection')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('connection refused')
    })
  })
})

// ===========================================================================
// register IPC（registerAllIpc 入口函数）
//
// 2026-10-24 重写：register.ts 已改成「按 baseDir 建容器 → 从容器取三个核心服务 →
// 依次调 39 个 register*Ipc」，外面再套一层 captureIpcHandlers（见 ipcBridge.ts）。
// 旧用例还停在「传 ProjectService 实例 / 只 mock 十来个模块 / TemplateService」的版本，
// 与当前实现完全对不上，故按现状重写：mock 容器 + ipcBridge + 全部 39 个模块。
// ===========================================================================

/**
 * NodeNext 下 `import()` 按 ESM 解析：`@main/ipc/register` 这种无扩展名的别名
 * TS 静态解析不到（TS2307），但运行时由 Vite 别名接管 —— 用变量传 specifier，
 * 让类型层不参与解析，同时不破坏 vi.doMock 的时机。
 */
async function importRegisterModule(): Promise<{ registerAllIpc: (baseDir: string) => void }> {
  const specifier = '@main/ipc/register'
  return (await import(specifier)) as { registerAllIpc: (baseDir: string) => void }
}

describe('registerAllIpc', () => {
  const registerModules: Array<{ mod: string; fn: string }> = [
    { mod: 'project', fn: 'registerProjectIpc' },
    { mod: 'flow', fn: 'registerFlowIpc' },
    { mod: 'expression', fn: 'registerExpressionIpc' },
    { mod: 'codegen', fn: 'registerCodegenIpc' },
    { mod: 'file', fn: 'registerFileIpc' },
    { mod: 'terminal', fn: 'registerTerminalIpc' },
    { mod: 'runtime', fn: 'registerRuntimeIpc' },
    { mod: 'ai', fn: 'registerAiIpc' },
    { mod: 'aiAgentCore', fn: 'registerAiAgentCoreIpc' },
    { mod: 'aiInstruction', fn: 'registerAiInstructionIpc' },
    { mod: 'aiAllowRules', fn: 'registerAiAllowRulesIpc' },
    { mod: 'history', fn: 'registerHistoryIpc' },
    { mod: 'git', fn: 'registerGitIpc' },
    { mod: 'diagnostics', fn: 'registerDiagnosticsIpc' },
    { mod: 'metrics', fn: 'registerMetricsIpc' },
    { mod: 'metricsExport', fn: 'registerMetricsExportIpc' },
    { mod: 'customNode', fn: 'registerCustomNodeIpc' },
    { mod: 'crashReporter', fn: 'registerCrashReporterIpc' },
    { mod: 'resourceMonitor', fn: 'registerResourceMonitorIpc' },
    { mod: 'stateStore', fn: 'registerStateStoreIpc' },
    { mod: 'adapter', fn: 'registerAdapterIpc' },
    { mod: 'aiProvider', fn: 'registerAIProviderIpc' },
    { mod: 'debugger', fn: 'registerDebuggerIpc' },
    { mod: 'plugins', fn: 'registerPluginIpc' },
    { mod: 'botManager', fn: 'registerBotManagerIpc' },
    { mod: 'launchData', fn: 'registerLaunchDataIpc' },
    { mod: 'launchConfig', fn: 'registerLaunchConfigIpc' },
    { mod: 'launchDashboard', fn: 'registerLaunchDashboardIpc' },
    { mod: 'launchAudit', fn: 'registerLaunchAuditIpc' },
    { mod: 'launchBackup', fn: 'registerLaunchBackupIpc' },
    { mod: 'launchTransfer', fn: 'registerLaunchTransferIpc' },
    { mod: 'launchPanel', fn: 'registerLaunchPanelIpc' },
    { mod: 'official', fn: 'registerOfficialIpc' },
    { mod: 'dockerExport', fn: 'registerDockerExportIpc' },
    { mod: 'sshDeploy', fn: 'registerSshDeployIpc' },
    { mod: 'dataNotify', fn: 'registerDataNotifyIpc' },
    { mod: 'buttonPanel', fn: 'registerButtonPanelIpc' },
    { mod: 'panelSync', fn: 'registerPanelSyncIpc' },
    { mod: 'capability', fn: 'registerCapabilityIpc' }
  ]

  const projectService = { getBaseDir: () => '/base' }
  const flowService = {}
  const codegenService = {}
  let registerStubs: Record<string, ReturnType<typeof vi.fn>>
  let getGlobalContainer: ReturnType<typeof vi.fn>
  let captureIpcHandlers: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    registerStubs = {}
    for (const { mod, fn } of registerModules) {
      registerStubs[fn] = vi.fn()
      vi.doMock(`@main/ipc/${mod}`, () => ({ [fn]: registerStubs[fn] }))
    }
    getGlobalContainer = vi.fn(() => ({
      get: (key: string) => {
        if (key === 'ProjectService') return projectService
        if (key === 'FlowService') return flowService
        return codegenService
      }
    }))
    vi.doMock('@main/services/runner/serviceContainer', () => ({
      getGlobalContainer,
      SERVICE_KEYS: {
        PROJECT_SERVICE: 'ProjectService',
        FLOW_SERVICE: 'FlowService',
        CODEGEN_SERVICE: 'CodegenService',
        HISTORY_SERVICE: 'HistoryService',
        BOT_MANAGER: 'BotManager'
      }
    }))
    // register.ts 只在这层包装里做「注册期间记下 handler」，行为直通
    captureIpcHandlers = vi.fn((fn: () => void) => fn())
    vi.doMock('@main/services/ai/ipcBridge', () => ({ captureIpcHandlers }))
    vi.doMock('electron', () => ({
      ipcMain: { handle: vi.fn() },
      BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn() },
      dialog: { showOpenDialog: vi.fn() },
      shell: { openPath: vi.fn() }
    }))
  })

  afterEach(() => {
    vi.resetModules()
    for (const { mod } of registerModules) vi.doUnmock(`@main/ipc/${mod}`)
    vi.doUnmock('@main/services/runner/serviceContainer')
    vi.doUnmock('@main/services/ai/ipcBridge')
    vi.doUnmock('electron')
  })

  it('按 baseDir 建容器，并调用全部 register 函数', async () => {
    const { registerAllIpc } = await importRegisterModule()
    registerAllIpc('/base')

    expect(getGlobalContainer).toHaveBeenCalledWith('/base')
    expect(captureIpcHandlers).toHaveBeenCalledTimes(1)
    const missing = registerModules
      .filter(({ fn }) => registerStubs[fn].mock.calls.length !== 1)
      .map(({ mod, fn }) => `${mod}:${fn}`)
    expect(missing).toEqual([])
  })

  it('把容器里的 ProjectService / FlowService / CodegenService 传给对应 register', async () => {
    const { registerAllIpc } = await importRegisterModule()
    registerAllIpc('/base')

    expect(registerStubs.registerProjectIpc).toHaveBeenCalledWith(projectService)
    expect(registerStubs.registerFlowIpc).toHaveBeenCalledWith(flowService)
    expect(registerStubs.registerCodegenIpc).toHaveBeenCalledWith(codegenService)
  })

  it('注册期间抛错时不让异常静默：captureIpcHandlers 收到的是同一个同步函数', async () => {
    const { registerAllIpc } = await importRegisterModule()
    registerAllIpc('/base')
    expect(captureIpcHandlers).toHaveBeenCalledTimes(1)
    const arg = captureIpcHandlers.mock.calls[0][0] as () => void
    expect(typeof arg).toBe('function')
  })
})
