// tests/main/ipc/flow-project-file-ipc.test.ts
// 覆盖 flow.ts / project.ts / file.ts / customNode.ts(其他 channel) 的 IPC handler
//
// 2026-10-24 恢复注：本 revision（10/18 asar）里没有 ipc/templates.ts —— 模板市场那一层
// （template:list/listBuiltin/getById/apply/save/delete/export/import 八个通道）整块不存在，
// register.ts 也没有 registerTemplateIpc。原文件的「templates IPC」一节随之删除；
// 该功能若要回来，先恢复 src/main/ipc/templates.ts 再补这一节。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted 保证 mock 引用在 vi.mock 工厂中可用（vi.mock 会被提升到文件顶部）
const {
  ipcMainHandleMock,
  // flow service
  loadFlowMock,
  saveFlowMock,
  // project service
  createProjectMock,
  recordRecentProjectMock,
  loadProjectConfigMock,
  getProjectMetaMock,
  listRecentProjectsMock,
  removeRecentProjectMock,
  renameProjectMock,
  deleteProjectMock,
  moveProjectMock,
  cloneProjectMock,
  saveProjectConfigMock,
  // file ops
  readProjectFileMock,
  writeProjectFileMock,
  listProjectFilesMock,
  atomicWriteMock,
  // custom node
  scanCustomNodesMock,
  scanCustomNodesV2Mock,
  forkBuiltinNodeMock,
  // botManager
  registerBotMock,
  unregisterBotMock,
  // templates service
  listTemplatesMock,
  listBuiltinMock,
  getTemplateByIdMock,
  saveTemplateMock,
  deleteTemplateMock,
  exportTemplateMock,
  importTemplateFromFileMock,
  importTemplateMock,
  // electron dialog/shell
  showOpenDialogMock,
  showSaveDialogMock,
  openPathMock,
  // fs/promises.readFile（project:updateTranslatorPort 使用）
  readFileMock
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  loadFlowMock: vi.fn(),
  saveFlowMock: vi.fn(),
  createProjectMock: vi.fn(),
  recordRecentProjectMock: vi.fn(),
  loadProjectConfigMock: vi.fn(),
  getProjectMetaMock: vi.fn(),
  listRecentProjectsMock: vi.fn(),
  removeRecentProjectMock: vi.fn(),
  renameProjectMock: vi.fn(),
  deleteProjectMock: vi.fn(),
  moveProjectMock: vi.fn(),
  cloneProjectMock: vi.fn(),
  saveProjectConfigMock: vi.fn(),
  readProjectFileMock: vi.fn(),
  writeProjectFileMock: vi.fn(),
  listProjectFilesMock: vi.fn(),
  atomicWriteMock: vi.fn(),
  scanCustomNodesMock: vi.fn(),
  scanCustomNodesV2Mock: vi.fn(),
  forkBuiltinNodeMock: vi.fn(),
  registerBotMock: vi.fn(),
  unregisterBotMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  listBuiltinMock: vi.fn(),
  getTemplateByIdMock: vi.fn(),
  saveTemplateMock: vi.fn(),
  deleteTemplateMock: vi.fn(),
  exportTemplateMock: vi.fn(),
  importTemplateFromFileMock: vi.fn(),
  importTemplateMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  openPathMock: vi.fn(),
  readFileMock: vi.fn()
}))

// Mock electron —— 5 个 IPC 文件顶层 import { ipcMain, BrowserWindow, dialog, shell }
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock
  },
  shell: { openPath: openPathMock }
}))

// Mock service 类（仅用于类型注解，提供空构造器避免加载真实模块的重依赖）
vi.mock('@main/services/flow', () => ({ FlowService: vi.fn() }))
vi.mock('@main/services/project', () => ({ ProjectService: vi.fn() }))
vi.mock('@main/services/templates', () => ({ TemplateService: vi.fn() }))

// Mock fileOps —— file.ts 与 project.ts 均引用
vi.mock('@main/services/fileOps', () => ({
  readProjectFile: readProjectFileMock,
  writeProjectFile: writeProjectFileMock,
  listProjectFiles: listProjectFilesMock,
  atomicWrite: atomicWriteMock
}))

// Mock customNodeScanner + forkNode —— customNode.ts 引用
vi.mock('@main/services/plugins/customNodeScanner', () => ({
  scanCustomNodes: scanCustomNodesMock,
  scanCustomNodesV2: scanCustomNodesV2Mock
}))
vi.mock('@main/services/flow/forkNode', () => ({
  forkBuiltinNode: forkBuiltinNodeMock
}))

// Mock botManager 单例 —— project.ts 引用
vi.mock('@main/services/botManager', () => ({
  botManager: {
    registerBot: registerBotMock,
    unregisterBot: unregisterBotMock
  }
}))

// Mock fs/promises.readFile（project:updateTranslatorPort 直接使用）
// 同时提供 named 与 default 导出，兼容 CJS interop
vi.mock('@main/services/infra/fileOps', () => ({
  readProjectFile: readProjectFileMock,
  writeProjectFile: writeProjectFileMock,
  listProjectFiles: listProjectFilesMock
}))

vi.mock('fs/promises', async (importOriginal) => {
  // 只替换 readFile（project:updateTranslatorPort 直接读 project.json）；
  // 其余保持真实实现 —— file.ts 会拉进 devBackup/devMode，它们要 mkdir/readdir。
  const actual = await importOriginal<typeof import('fs/promises')>()
  const mocked = { ...actual, readFile: readFileMock }
  return { ...mocked, default: mocked }
})

import { registerFlowIpc } from '@main/ipc/flow'
import { registerProjectIpc } from '@main/ipc/project'
import { registerFileIpc } from '@main/ipc/file'
import { registerCustomNodeIpc, setAiGeneratedScanner } from '@main/ipc/customNode'

/** 从 ipcMain.handle 调用记录中提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

/** 构造 mock FlowService */
function makeFlowService() {
  return { loadFlow: loadFlowMock, saveFlow: saveFlowMock } as unknown as Parameters<typeof registerFlowIpc>[0]
}

/** 构造 mock ProjectService */
function makeProjectService() {
  return {
    createProject: createProjectMock,
    recordRecentProject: recordRecentProjectMock,
    loadProjectConfig: loadProjectConfigMock,
    getProjectMeta: getProjectMetaMock,
    listRecentProjects: listRecentProjectsMock,
    removeRecentProject: removeRecentProjectMock,
    renameProject: renameProjectMock,
    deleteProject: deleteProjectMock,
    moveProject: moveProjectMock,
    cloneProject: cloneProjectMock,
    saveProjectConfig: saveProjectConfigMock
  } as unknown as Parameters<typeof registerProjectIpc>[0]
}


// ===== flow.ts =====
describe('flow IPC', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    loadFlowMock.mockReset()
    saveFlowMock.mockReset()
    registerFlowIpc(makeFlowService())
  })

  describe('flow:load', () => {
    it('正常路径：返回 flow 数据', async () => {
      const flow = { schemaVersion: '1.0', nodes: [], edges: [] }
      loadFlowMock.mockResolvedValue(flow)

      const handler = getHandler('flow:load')
      const result = (await handler({}, '/proj')) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(flow)
      expect(loadFlowMock).toHaveBeenCalledWith('/proj')
    })

    it('参数校验：projectPath 为空字符串返回 ok:false', async () => {
      const handler = getHandler('flow:load')
      const result = (await handler({}, '')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/projectPath/)
      expect(loadFlowMock).not.toHaveBeenCalled()
    })

    it('参数校验：projectPath 非字符串返回 ok:false', async () => {
      const handler = getHandler('flow:load')
      const result = (await handler({}, undefined)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/projectPath/)
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      loadFlowMock.mockRejectedValue(new Error('load boom'))

      const handler = getHandler('flow:load')
      const result = (await handler({}, '/proj')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('load boom')
    })
  })

  describe('flow:save', () => {
    it('正常路径：保存成功返回 ok:true', async () => {
      saveFlowMock.mockResolvedValue(undefined)
      const flow = { schemaVersion: '1.0', nodes: [], edges: [] }

      const handler = getHandler('flow:save')
      const result = (await handler({}, '/proj', flow)) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(saveFlowMock).toHaveBeenCalledWith('/proj', flow, 'other')
    })

    it('参数校验：projectPath 为空返回 ok:false', async () => {
      const handler = getHandler('flow:save')
      const result = (await handler({}, '', {})) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/projectPath/)
      expect(saveFlowMock).not.toHaveBeenCalled()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      saveFlowMock.mockRejectedValue(new Error('save boom'))

      const handler = getHandler('flow:save')
      const result = (await handler({}, '/proj', {})) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('save boom')
    })
  })
})

// ===== project.ts =====
describe('project IPC', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    createProjectMock.mockReset()
    recordRecentProjectMock.mockReset()
    loadProjectConfigMock.mockReset()
    getProjectMetaMock.mockReset()
    listRecentProjectsMock.mockReset()
    removeRecentProjectMock.mockReset()
    renameProjectMock.mockReset()
    deleteProjectMock.mockReset()
    moveProjectMock.mockReset()
    cloneProjectMock.mockReset()
    saveProjectConfigMock.mockReset()
    registerBotMock.mockReset()
    unregisterBotMock.mockReset()
    showOpenDialogMock.mockReset()
    openPathMock.mockReset()
    readFileMock.mockReset()
    atomicWriteMock.mockReset()
    // 默认让 botManager 的方法 resolve
    registerBotMock.mockResolvedValue(undefined)
    registerProjectIpc(makeProjectService())
  })

  describe('project:create', () => {
    const validInput = { name: 'my-bot', adapter: 'official' as const }

    it('正常路径：返回项目 meta', async () => {
      const meta = { id: '1', name: 'my-bot', path: '/proj/my-bot' }
      createProjectMock.mockResolvedValue(meta)
      recordRecentProjectMock.mockResolvedValue(undefined)

      const handler = getHandler('project:create')
      const result = (await handler({}, validInput)) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(meta)
      expect(createProjectMock).toHaveBeenCalled()
      expect(recordRecentProjectMock).toHaveBeenCalledWith(meta)
      expect(registerBotMock).toHaveBeenCalledWith(meta.path)
    })

    it('参数校验：name 为空返回 ok:false', async () => {
      const handler = getHandler('project:create')
      const result = (await handler({}, { name: '', adapter: 'official' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
      expect(createProjectMock).not.toHaveBeenCalled()
    })

    it('参数校验：缺少 adapter 返回 ok:false', async () => {
      const handler = getHandler('project:create')
      const result = (await handler({}, { name: 'x' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service.createProject 抛异常返回 ok:false', async () => {
      createProjectMock.mockRejectedValue(new Error('create boom'))

      const handler = getHandler('project:create')
      const result = (await handler({}, validInput)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('create boom')
    })
  })

  describe('project:open', () => {
    it('正常路径：返回 config + path', async () => {
      const config = { name: 'demo', adapter: 'official' }
      loadProjectConfigMock.mockResolvedValue(config)

      const handler = getHandler('project:open')
      const result = (await handler({}, { path: '/proj/demo' })) as { ok: boolean; data: { config: unknown; path: string } }

      expect(result.ok).toBe(true)
      expect(result.data.config).toBe(config)
      expect(result.data.path).toBe('/proj/demo')
    })

    it('参数校验：缺少 path 返回 ok:false', async () => {
      const handler = getHandler('project:open')
      const result = (await handler({}, {})) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      loadProjectConfigMock.mockRejectedValue(new Error('open boom'))

      const handler = getHandler('project:open')
      const result = (await handler({}, { path: '/proj/x' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('open boom')
    })
  })

  describe('project:getMeta', () => {
    it('正常路径：返回 meta', async () => {
      const meta = { id: '1', name: 'demo' }
      getProjectMetaMock.mockResolvedValue(meta)

      const handler = getHandler('project:getMeta')
      const result = (await handler({}, '/proj/demo')) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(meta)
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:getMeta')
      const result = (await handler({}, '')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      getProjectMetaMock.mockRejectedValue(new Error('meta boom'))

      const handler = getHandler('project:getMeta')
      const result = (await handler({}, '/proj/x')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('meta boom')
    })
  })

  describe('project:getConfig', () => {
    it('正常路径：返回 config', async () => {
      const config = { name: 'demo', adapter: 'official' }
      loadProjectConfigMock.mockResolvedValue(config)

      const handler = getHandler('project:getConfig')
      const result = (await handler({}, '/proj/demo')) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(config)
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:getConfig')
      const result = (await handler({}, '')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      loadProjectConfigMock.mockRejectedValue(new Error('cfg boom'))

      const handler = getHandler('project:getConfig')
      const result = (await handler({}, '/proj/x')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('cfg boom')
    })
  })

  describe('project:listRecent', () => {
    it('正常路径：返回最近项目列表', async () => {
      const recent = [{ id: '1', name: 'a', path: '/a' }]
      listRecentProjectsMock.mockResolvedValue(recent)

      const handler = getHandler('project:listRecent')
      const result = (await handler({})) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(recent)
    })

    it('错误路径：service 抛异常时 handler reject（无 try-catch）', async () => {
      listRecentProjectsMock.mockRejectedValue(new Error('list boom'))

      const handler = getHandler('project:listRecent')
      await expect(handler({})).rejects.toThrow('list boom')
    })
  })

  describe('project:removeRecent', () => {
    it('正常路径：移除成功返回 ok:true', async () => {
      removeRecentProjectMock.mockResolvedValue(undefined)

      const handler = getHandler('project:removeRecent')
      const result = (await handler({}, '/proj/x')) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(removeRecentProjectMock).toHaveBeenCalledWith('/proj/x')
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:removeRecent')
      const result = (await handler({}, '')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('project:rename', () => {
    it('正常路径：重命名并同步 botManager', async () => {
      renameProjectMock.mockResolvedValue(undefined)
      registerBotMock.mockResolvedValue(undefined)

      const handler = getHandler('project:rename')
      const result = (await handler({}, '/proj/x', 'new-name')) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(renameProjectMock).toHaveBeenCalledWith('/proj/x', 'new-name')
      expect(unregisterBotMock).toHaveBeenCalledWith('/proj/x')
      expect(registerBotMock).toHaveBeenCalledWith('/proj/x')
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:rename')
      const result = (await handler({}, '', 'new-name')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('参数校验：非法 newName 返回 ok:false', async () => {
      const handler = getHandler('project:rename')
      const result = (await handler({}, '/proj/x', 'bad/name!')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      renameProjectMock.mockRejectedValue(new Error('rename boom'))

      const handler = getHandler('project:rename')
      const result = (await handler({}, '/proj/x', 'new-name')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('rename boom')
    })
  })

  describe('project:delete', () => {
    it('正常路径：删除并注销 bot', async () => {
      deleteProjectMock.mockResolvedValue(undefined)

      const handler = getHandler('project:delete')
      const result = (await handler({}, '/proj/x')) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(deleteProjectMock).toHaveBeenCalledWith('/proj/x')
      expect(unregisterBotMock).toHaveBeenCalledWith('/proj/x')
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:delete')
      const result = (await handler({}, '')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      deleteProjectMock.mockRejectedValue(new Error('delete boom'))

      const handler = getHandler('project:delete')
      const result = (await handler({}, '/proj/x')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('delete boom')
    })
  })

  describe('project:move', () => {
    it('正常路径：上移返回 ok:true', async () => {
      moveProjectMock.mockResolvedValue(undefined)

      const handler = getHandler('project:move')
      const result = (await handler({}, '/proj/x', -1)) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(moveProjectMock).toHaveBeenCalledWith('/proj/x', -1)
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:move')
      const result = (await handler({}, '', 1)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('参数校验：非法 offset（0）返回 ok:false', async () => {
      const handler = getHandler('project:move')
      const result = (await handler({}, '/proj/x', 0)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      moveProjectMock.mockRejectedValue(new Error('move boom'))

      const handler = getHandler('project:move')
      const result = (await handler({}, '/proj/x', 1)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('move boom')
    })
  })

  describe('project:openFolder', () => {
    it('正常路径：打开文件夹返回 ok:true', async () => {
      openPathMock.mockResolvedValue('')

      const handler = getHandler('project:openFolder')
      const result = (await handler({}, '/proj/x')) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(openPathMock).toHaveBeenCalledWith('/proj/x')
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:openFolder')
      const result = (await handler({}, '')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：shell.openPath 抛异常返回 ok:false', async () => {
      openPathMock.mockRejectedValue(new Error('open boom'))

      const handler = getHandler('project:openFolder')
      const result = (await handler({}, '/proj/x')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('open boom')
    })
  })

  describe('project:clone', () => {
    it('正常路径：克隆并注册 bot，返回 meta', async () => {
      const meta = { id: '2', name: 'clone', path: '/proj/clone' }
      cloneProjectMock.mockResolvedValue(meta)
      registerBotMock.mockResolvedValue(undefined)

      const handler = getHandler('project:clone')
      const result = (await handler({}, '/proj/src', 'clone')) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(meta)
      expect(cloneProjectMock).toHaveBeenCalledWith('/proj/src', 'clone')
      expect(registerBotMock).toHaveBeenCalledWith(meta.path)
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:clone')
      const result = (await handler({}, '', 'clone')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('参数校验：非法 newName 返回 ok:false', async () => {
      const handler = getHandler('project:clone')
      const result = (await handler({}, '/proj/x', 'bad name!')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      cloneProjectMock.mockRejectedValue(new Error('clone boom'))

      const handler = getHandler('project:clone')
      const result = (await handler({}, '/proj/x', 'clone')) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('clone boom')
    })
  })

  describe('project:pickDirectory', () => {
    it('正常路径：返回选中目录', async () => {
      showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/picked'] })

      const handler = getHandler('project:pickDirectory')
      const result = (await handler({})) as { ok: boolean; data: string }

      expect(result.ok).toBe(true)
      expect(result.data).toBe('/picked')
    })

    it('取消选择返回 ok:false 且 error 为 canceled', async () => {
      showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })

      const handler = getHandler('project:pickDirectory')
      const result = (await handler({})) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('canceled')
    })
  })

  describe('project:saveConfig', () => {
    const validInput = { name: 'demo', adapter: 'official' as const, __projectPath: '/proj/demo' }

    it('正常路径：保存配置返回 ok:true', async () => {
      saveProjectConfigMock.mockResolvedValue(undefined)

      const handler = getHandler('project:saveConfig')
      const result = (await handler({}, validInput)) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(saveProjectConfigMock).toHaveBeenCalledWith('/proj/demo', expect.objectContaining({ name: 'demo', adapter: 'official' }))
    })

    it('参数校验：缺少 __projectPath 返回 ok:false', async () => {
      const handler = getHandler('project:saveConfig')
      const result = (await handler({}, { name: 'demo', adapter: 'official' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      saveProjectConfigMock.mockRejectedValue(new Error('save boom'))

      const handler = getHandler('project:saveConfig')
      const result = (await handler({}, validInput)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('save boom')
    })
  })

  describe('project:updateTranslatorPort', () => {
    it('正常路径：更新端口返回 ok:true', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ name: 'demo', translatorPort: 8080 }))
      atomicWriteMock.mockResolvedValue(undefined)

      const handler = getHandler('project:updateTranslatorPort')
      const result = (await handler({}, '/proj/demo', 9090)) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('project.json'), 'utf-8')
      expect(atomicWriteMock).toHaveBeenCalled()
      // 写入的内容应含新端口
      const written = atomicWriteMock.mock.calls[0][1] as string
      expect(JSON.parse(written).translatorPort).toBe(9090)
    })

    it('参数校验：空 path 返回 ok:false', async () => {
      const handler = getHandler('project:updateTranslatorPort')
      const result = (await handler({}, '', 9090)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('参数校验：非法端口（0）返回 ok:false', async () => {
      const handler = getHandler('project:updateTranslatorPort')
      const result = (await handler({}, '/proj/x', 0)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('参数校验：非法端口（70000 超范围）返回 ok:false', async () => {
      const handler = getHandler('project:updateTranslatorPort')
      const result = (await handler({}, '/proj/x', 70000)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('错误路径：readFile 抛异常返回 ok:false', async () => {
      readFileMock.mockRejectedValue(new Error('read boom'))

      const handler = getHandler('project:updateTranslatorPort')
      const result = (await handler({}, '/proj/x', 9090)) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('read boom')
    })
  })
})

// ===== file.ts =====
describe('file IPC', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    readProjectFileMock.mockReset()
    writeProjectFileMock.mockReset()
    listProjectFilesMock.mockReset()
    registerFileIpc()
  })

  describe('file:read', () => {
    it('正常路径：返回文件内容', async () => {
      readProjectFileMock.mockResolvedValue('hello')

      const handler = getHandler('file:read')
      const result = (await handler({}, { projectPath: '/proj', relativePath: 'foo.txt' })) as { ok: boolean; data: string }

      expect(result.ok).toBe(true)
      expect(result.data).toBe('hello')
      expect(readProjectFileMock).toHaveBeenCalledWith('/proj', 'foo.txt')
    })

    it('参数校验：缺少 projectPath 返回 ok:false', async () => {
      const handler = getHandler('file:read')
      const result = (await handler({}, { relativePath: 'foo.txt' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('参数校验：缺少 relativePath 返回 ok:false', async () => {
      const handler = getHandler('file:read')
      const result = (await handler({}, { projectPath: '/proj' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      readProjectFileMock.mockRejectedValue(new Error('read boom'))

      const handler = getHandler('file:read')
      const result = (await handler({}, { projectPath: '/proj', relativePath: 'foo.txt' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('read boom')
    })
  })

  describe('file:write', () => {
    it('正常路径：写入成功返回 ok:true', async () => {
      writeProjectFileMock.mockResolvedValue(undefined)

      const handler = getHandler('file:write')
      const result = (await handler({}, { projectPath: '/proj', relativePath: 'foo.txt', content: 'hi' })) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(writeProjectFileMock).toHaveBeenCalledWith('/proj', 'foo.txt', 'hi')
    })

    it('参数校验：缺少 content 返回 ok:false', async () => {
      const handler = getHandler('file:write')
      const result = (await handler({}, { projectPath: '/proj', relativePath: 'foo.txt' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      writeProjectFileMock.mockRejectedValue(new Error('write boom'))

      const handler = getHandler('file:write')
      const result = (await handler({}, { projectPath: '/proj', relativePath: 'foo.txt', content: 'hi' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('write boom')
    })
  })

  describe('file:list', () => {
    it('正常路径：返回文件列表', async () => {
      const files = [{ name: 'a.txt', path: 'a.txt', isDirectory: false, size: 10 }]
      listProjectFilesMock.mockResolvedValue(files)

      const handler = getHandler('file:list')
      const result = (await handler({}, { projectPath: '/proj' })) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(files)
      expect(listProjectFilesMock).toHaveBeenCalledWith('/proj', undefined)
    })

    it('正常路径：指定 relativeDir 透传', async () => {
      listProjectFilesMock.mockResolvedValue([])

      const handler = getHandler('file:list')
      await handler({}, { projectPath: '/proj', relativeDir: 'sub' })

      expect(listProjectFilesMock).toHaveBeenCalledWith('/proj', 'sub')
    })

    it('参数校验：缺少 projectPath 返回 ok:false', async () => {
      const handler = getHandler('file:list')
      const result = (await handler({}, {})) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/参数校验失败/)
    })

    it('错误路径：service 抛异常返回 ok:false', async () => {
      listProjectFilesMock.mockRejectedValue(new Error('list boom'))

      const handler = getHandler('file:list')
      const result = (await handler({}, { projectPath: '/proj' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('list boom')
    })
  })
})

// ===== customNode.ts（scan / fork，scanV2 与 watch 已在 customNode-v2.test.ts 覆盖）=====
describe('customNode IPC（scan/fork）', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    scanCustomNodesMock.mockReset()
    scanCustomNodesV2Mock.mockReset()
    forkBuiltinNodeMock.mockReset()
    // 关闭 aiGeneratedScanner 注入槽，避免 auto-wire 干扰
    setAiGeneratedScanner(null)
    registerCustomNodeIpc()
  })

  describe('customNode:scan', () => {
    it('正常路径：返回节点列表', async () => {
      const nodes = [{ name: 'n1', funcName: 'n1', inputs: [], outputs: [], icon: '🔧', description: '' }]
      scanCustomNodesMock.mockResolvedValue(nodes)

      const handler = getHandler('customNode:scan')
      const result = (await handler({}, { projectPath: '/proj' })) as { ok: boolean; data: unknown }

      expect(result.ok).toBe(true)
      expect(result.data).toBe(nodes)
      expect(scanCustomNodesMock).toHaveBeenCalledWith('/proj')
    })

    it('错误路径：scanCustomNodes 抛异常返回 ok:false', async () => {
      scanCustomNodesMock.mockRejectedValue(new Error('scan boom'))

      const handler = getHandler('customNode:scan')
      const result = (await handler({}, { projectPath: '/proj' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('scan boom')
    })
  })

  describe('customNode:fork', () => {
    it('正常路径：forkBuiltinNode 成功返回 ok:true', async () => {
      forkBuiltinNodeMock.mockResolvedValue({ success: true, newKind: 'custom_my_node' })

      const handler = getHandler('customNode:fork')
      const result = (await handler({}, { projectPath: '/proj', builtinKind: 'send_message', newName: 'my_node' })) as { ok: boolean; data: { newKind: string } }

      expect(result.ok).toBe(true)
      expect(result.data.newKind).toBe('custom_my_node')
      expect(forkBuiltinNodeMock).toHaveBeenCalledWith('/proj', 'send_message', 'my_node')
    })

    it('错误路径：forkBuiltinNode 抛异常返回 ok:false', async () => {
      forkBuiltinNodeMock.mockRejectedValue(new Error('fork boom'))

      const handler = getHandler('customNode:fork')
      const result = (await handler({}, { projectPath: '/proj', builtinKind: 'send_message', newName: 'my_node' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('fork boom')
    })

    it('forkBuiltinNode 返回校验失败时返回 ok:false', async () => {
      forkBuiltinNodeMock.mockResolvedValue({ success: false, newKind: '', error: 'newName 不能是 Python 关键字: class' })

      const handler = getHandler('customNode:fork')
      const result = (await handler({}, { projectPath: '/proj', builtinKind: 'send_message', newName: 'class' })) as { ok: boolean; error: string }

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Python|关键字/)
    })
  })
})

