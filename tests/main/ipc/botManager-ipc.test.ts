// tests/main/ipc/botManager-ipc.test.ts
// 覆盖 4 个 IPC handler：botManager / launchBackup / launchConfig / launchData
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'path'

// vi.hoisted 保证 mock 引用在 vi.mock 工厂中可用（vi.mock 会被提升到文件顶部）
const {
  ipcMainHandleMock,
  botManagerMock,
  backupMocks,
  configMocks,
  dataMocks,
  uidMocks,
  templateMocks
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  botManagerMock: {
    on: vi.fn(),
    listBots: vi.fn((): any[] => []),
    scanProjectBots: vi.fn((): any[] => []),
    registerBot: vi.fn(),
    unregisterBot: vi.fn(),
    startBot: vi.fn(),
    stopBot: vi.fn(),
    restartBot: vi.fn()
  },
  backupMocks: {
    createBackup: vi.fn(),
    listBackups: vi.fn(),
    restoreBackup: vi.fn(),
    createSnapshot: vi.fn()
  },
  configMocks: {
    listConfigCategories: vi.fn(),
    getConfigTable: vi.fn(),
    getConfigSchema: vi.fn(),
    updateConfigRecord: vi.fn(),
    insertConfigRecord: vi.fn(),
    deleteConfigRecord: vi.fn(),
    createConfigTable: vi.fn(),
    dropConfigTable: vi.fn(),
    renameConfigTable: vi.fn(),
    alterConfigTable: vi.fn()
  },
  dataMocks: {
    listDataSources: vi.fn(),
    getSchema: vi.fn(),
    queryTable: vi.fn(),
    queryPlayerTables: vi.fn(),
    updateRecord: vi.fn(),
    insertRecord: vi.fn(),
    deleteRecord: vi.fn(),
    searchPlayer: vi.fn(),
    saveSchema: vi.fn(),
    listPlayers: vi.fn()
  },
  uidMocks: {
    getUidMapping: vi.fn(),
    updatePlayerUid: vi.fn(),
    getPlayersWithUid: vi.fn()
  },
  templateMocks: {
    getDataTemplate: vi.fn(),
    saveDataTemplate: vi.fn()
  }
}))

// Mock electron —— 各 IPC 文件顶层 import { ipcMain } / BrowserWindow
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  // launchData → services/bot/botManager 在模块顶层就 new BotManager()，
  // 构造函数读 `userDataPath('projects', electron.app)` —— 缺 app 会整组导入失败。
  app: { getPath: vi.fn(() => '/userdata'), getAppPath: vi.fn(() => '/app') }
}))

// Mock 依赖的 service（IPC 文件用相对路径 ../services/xxx 引入，
// 别名 @main/services/xxx 解析到同一文件，mock 生效）
vi.mock('@main/services/botManager', () => ({ botManager: botManagerMock }))
vi.mock('@main/services/backupService', () => backupMocks)
vi.mock('@main/services/configService', () => configMocks)
vi.mock('@main/services/dataService', () => dataMocks)
vi.mock('@main/services/uidMappingService', () => uidMocks)
vi.mock('@main/services/dataTemplateService', () => templateMocks)
// launchData.ts 走的是嵌套路径（10/18 起服务按域收进子目录）；只 mock 扁平门面等于没 mock，
// 真实 dataService 会去开不存在的 db（报「数据库文件不存在」）。
vi.mock('@main/services/project/dataService', () => dataMocks)
vi.mock('@main/services/bot/uidMappingService', () => uidMocks)
vi.mock('@main/services/project/dataTemplateService', () => templateMocks)
vi.mock('@main/services/bot/botManager', () => ({ botManager: botManagerMock }))
vi.mock('@main/services/bot/identityService', () => ({ checkIdentity: vi.fn() }))
vi.mock('@main/services/project/playerSchemaService', () => ({
  getPlayerSchema: vi.fn(),
  savePlayerSchema: vi.fn()
}))
vi.mock('@main/services/project/playerBaseDataService', () => ({
  backfillPlayerBaseData: vi.fn(),
  countPlayersMissingBaseData: vi.fn()
}))

import { registerBotManagerIpc } from '@main/ipc/botManager'
import { registerLaunchBackupIpc } from '@main/ipc/launchBackup'
import { registerLaunchConfigIpc } from '@main/ipc/launchConfig'
import { registerLaunchDataIpc } from '@main/ipc/launchData'

const allMockGroups = [botManagerMock, backupMocks, configMocks, dataMocks, uidMocks, templateMocks]

/** 从 ipcMain.handle 的调用记录里提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

/** 一次返回 { ok, data/error } 的通用结果 */
interface IpcResult {
  ok: boolean
  data?: unknown
  error?: string
}

beforeEach(() => {
  ipcMainHandleMock.mockReset()
  for (const group of allMockGroups) {
    for (const fn of Object.values(group)) {
      ;(fn as { mockReset: () => void }).mockReset()
    }
  }
  // 默认实现：list 类操作返回空数组，避免 IPC 走扫描分支时报错
  botManagerMock.listBots.mockReturnValue([])
  botManagerMock.scanProjectBots.mockResolvedValue([])
  // 重新注册所有 IPC handler
  registerBotManagerIpc()
  registerLaunchBackupIpc()
  registerLaunchConfigIpc()
  registerLaunchDataIpc()
})

// ===== botManager IPC =====
describe('botManager IPC', () => {
  it('botManager:list 内存非空时直接返回，不调用 scanProjectBots', async () => {
    const bots = [{ projectPath: '/p1', name: 'demo', status: 'stopped' }]
    botManagerMock.listBots.mockReturnValue(bots)

    const res = (await getHandler('botManager:list')({})) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(bots)
    expect(botManagerMock.scanProjectBots).not.toHaveBeenCalled()
  })

  it('botManager:list 内存为空时触发磁盘扫描并重新注册', async () => {
    botManagerMock.listBots
      .mockReturnValueOnce([]) // 第一次：空
      .mockReturnValueOnce([{ projectPath: '/p1', name: 'demo', status: 'stopped' }]) // 扫描后
    botManagerMock.scanProjectBots.mockResolvedValue(['/p1', '/p2'])
    botManagerMock.registerBot.mockResolvedValue(undefined)

    const res = (await getHandler('botManager:list')({})) as IpcResult
    expect(res.ok).toBe(true)
    expect((res.data as unknown[]).length).toBe(1)
    expect(botManagerMock.scanProjectBots).toHaveBeenCalledTimes(1)
    // 两个路径都尝试 register
    expect(botManagerMock.registerBot).toHaveBeenCalledWith('/p1')
    expect(botManagerMock.registerBot).toHaveBeenCalledWith('/p2')
  })

  it('botManager:list 扫描时 registerBot 抛错被忽略，仍返回 ok', async () => {
    botManagerMock.listBots.mockReturnValueOnce([]).mockReturnValueOnce([])
    botManagerMock.scanProjectBots.mockResolvedValue(['/p1'])
    botManagerMock.registerBot.mockRejectedValue(new Error('注册失败'))

    const res = (await getHandler('botManager:list')({})) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual([])
  })

  it('botManager:list listBots 抛异常返回 ok:false', async () => {
    botManagerMock.listBots.mockImplementation(() => {
      throw new Error('boom')
    })

    const res = (await getHandler('botManager:list')({})) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('boom')
  })

  // 参数校验 + 错误路径：对 start/stop/restart/register/unregister 统一覆盖
  const paramHandlers: Array<{ channel: string; method: keyof typeof botManagerMock; async: boolean }> = [
    { channel: 'botManager:start', method: 'startBot', async: true },
    { channel: 'botManager:stop', method: 'stopBot', async: true },
    { channel: 'botManager:restart', method: 'restartBot', async: true },
    { channel: 'botManager:register', method: 'registerBot', async: true },
    { channel: 'botManager:unregister', method: 'unregisterBot', async: false }
  ]

  for (const { channel, method, async: isAsync } of paramHandlers) {
    describe(channel, () => {
      it('正常路径返回 ok:true', async () => {
        const mock = botManagerMock[method] as unknown as {
          mockResolvedValue: (v: unknown) => void
          mockReturnValue: (v: unknown) => void
        }
        if (isAsync) mock.mockResolvedValue(undefined)
        else mock.mockReturnValue(undefined)

        const res = (await getHandler(channel)({}, { projectPath: '/proj' })) as IpcResult
        expect(res.ok).toBe(true)
        expect(botManagerMock[method]).toHaveBeenCalledWith('/proj')
      })

      it('缺少 projectPath 返回 ok:false', async () => {
        const res = (await getHandler(channel)({}, { projectPath: '' })) as IpcResult
        expect(res.ok).toBe(false)
        expect(res.error).toBe('参数 projectPath 无效')
        expect(botManagerMock[method]).not.toHaveBeenCalled()
      })

      it('projectPath 类型错误返回 ok:false', async () => {
        const res = (await getHandler(channel)({}, { projectPath: 123 })) as IpcResult
        expect(res.ok).toBe(false)
        expect(res.error).toBe('参数 projectPath 无效')
        expect(botManagerMock[method]).not.toHaveBeenCalled()
      })

      it('service 抛异常返回 ok:false', async () => {
        const mock = botManagerMock[method] as unknown as {
          mockRejectedValue: (e: unknown) => void
          mockImplementation: (fn: () => void) => void
        }
        if (isAsync) mock.mockRejectedValue(new Error('svc-error'))
        else mock.mockImplementation(() => { throw new Error('svc-error') })

        const res = (await getHandler(channel)({}, { projectPath: '/proj' })) as IpcResult
        expect(res.ok).toBe(false)
        expect(res.error).toBe('svc-error')
      })
    })
  }

  it('botManager:statusChanged 推送回调已注册', () => {
    // registerBotManagerIpc 在顶层调用 botManager.on('statusChanged', ...)
    expect(botManagerMock.on).toHaveBeenCalledWith('statusChanged', expect.any(Function))
  })
})

// ===== launchBackup IPC =====
describe('launchBackup IPC', () => {
  it('backup:create 正常路径返回备份路径', async () => {
    backupMocks.createBackup.mockResolvedValue('/proj/data/backups/backup.bak')
    const res = (await getHandler('backup:create')({}, '/proj', '/proj/data.db', 'desc')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe('/proj/data/backups/backup.bak')
    expect(backupMocks.createBackup).toHaveBeenCalledWith('/proj', '/proj/data.db', 'desc')
  })

  it('backup:create service 抛异常返回 ok:false', async () => {
    backupMocks.createBackup.mockRejectedValue(new Error('backup-fail'))
    const res = (await getHandler('backup:create')({}, '/proj', '/proj/data.db', 'desc')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('backup-fail')
  })

  it('backup:list 正常路径返回备份列表', async () => {
    const list = [{ name: 'a.bak', time: 't1', description: 'd1', size: 100 }]
    backupMocks.listBackups.mockResolvedValue(list)
    const res = (await getHandler('backup:list')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(list)
    expect(backupMocks.listBackups).toHaveBeenCalledWith('/proj')
  })

  it('backup:list service 抛异常返回 ok:false', async () => {
    backupMocks.listBackups.mockRejectedValue(new Error('list-fail'))
    const res = (await getHandler('backup:list')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('list-fail')
  })

  it('backup:restore 正常路径返回 true', async () => {
    backupMocks.restoreBackup.mockResolvedValue(true)
    const res = (await getHandler('backup:restore')({}, '/proj', 'a.bak')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe(true)
    expect(backupMocks.restoreBackup).toHaveBeenCalledWith('/proj', 'a.bak')
  })

  it('backup:restore service 抛异常返回 ok:false', async () => {
    backupMocks.restoreBackup.mockRejectedValue(new Error('restore-fail'))
    const res = (await getHandler('backup:restore')({}, '/proj', 'a.bak')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('restore-fail')
  })

  it('backup:snapshot 正常路径（带 name）', async () => {
    backupMocks.createSnapshot.mockResolvedValue('/proj/data/snap.db')
    const res = (await getHandler('backup:snapshot')({}, '/proj', 'mysnap')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe('/proj/data/snap.db')
    expect(backupMocks.createSnapshot).toHaveBeenCalledWith('/proj', 'mysnap')
  })

  it('backup:snapshot 正常路径（无 name）', async () => {
    backupMocks.createSnapshot.mockResolvedValue('/proj/data/snapshot.db')
    const res = (await getHandler('backup:snapshot')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(backupMocks.createSnapshot).toHaveBeenCalledWith('/proj', undefined)
  })

  it('backup:snapshot service 抛异常返回 ok:false', async () => {
    backupMocks.createSnapshot.mockRejectedValue(new Error('snap-fail'))
    const res = (await getHandler('backup:snapshot')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('snap-fail')
  })
})

// ===== launchConfig IPC =====
describe('launchConfig IPC', () => {
  it('launch:listConfigCategories 正常路径', async () => {
    configMocks.listConfigCategories.mockReturnValue(['cat1', 'cat2'])
    const res = (await getHandler('launch:listConfigCategories')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(['cat1', 'cat2'])
    expect(configMocks.listConfigCategories).toHaveBeenCalledWith('/proj')
  })

  it('launch:listConfigCategories service 抛异常返回 ok:false', async () => {
    configMocks.listConfigCategories.mockImplementation(() => {
      throw new Error('cfg-list-fail')
    })
    const res = (await getHandler('launch:listConfigCategories')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('cfg-list-fail')
  })

  it('launch:getConfigTable 正常路径', async () => {
    const table = { columns: ['a'], rows: [{ a: 1 }] }
    configMocks.getConfigTable.mockReturnValue(table)
    const res = (await getHandler('launch:getConfigTable')({}, '/proj', 'cat1', 1, 20)) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(table)
    expect(configMocks.getConfigTable).toHaveBeenCalledWith('/proj', 'cat1', 1, 20)
  })

  it('launch:getConfigTable service 抛异常返回 ok:false', async () => {
    configMocks.getConfigTable.mockImplementation(() => {
      throw new Error('table-fail')
    })
    const res = (await getHandler('launch:getConfigTable')({}, '/proj', 'cat1', 1, 20)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('table-fail')
  })

  it('launch:getConfigSchema 正常路径', async () => {
    const schema = { fields: [{ name: 'a', type: 'text' }] }
    configMocks.getConfigSchema.mockReturnValue(schema)
    const res = (await getHandler('launch:getConfigSchema')({}, '/proj', 'cat1')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(schema)
    expect(configMocks.getConfigSchema).toHaveBeenCalledWith('/proj', 'cat1')
  })

  it('launch:getConfigSchema service 抛异常返回 ok:false', async () => {
    configMocks.getConfigSchema.mockImplementation(() => {
      throw new Error('schema-fail')
    })
    const res = (await getHandler('launch:getConfigSchema')({}, '/proj', 'cat1')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('schema-fail')
  })

  it('launch:updateConfigRecord 正常路径（写操作，无 data）', async () => {
    configMocks.updateConfigRecord.mockReturnValue(undefined)
    const res = (await getHandler('launch:updateConfigRecord')(
      {},
      '/proj',
      'cat1',
      5,
      { name: 'new' }
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBeUndefined()
    expect(configMocks.updateConfigRecord).toHaveBeenCalledWith('/proj', 'cat1', 5, { name: 'new' })
  })

  it('launch:updateConfigRecord service 抛异常返回 ok:false', async () => {
    configMocks.updateConfigRecord.mockImplementation(() => {
      throw new Error('update-fail')
    })
    const res = (await getHandler('launch:updateConfigRecord')(
      {},
      '/proj',
      'cat1',
      5,
      { name: 'new' }
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('update-fail')
  })

  // ---- 表结构管理（DDL）+ 记录增删（DML）----

  it('launch:insertConfigRecord 正常路径（返回新 rowid）', async () => {
    configMocks.insertConfigRecord.mockReturnValue(42)
    const res = (await getHandler('launch:insertConfigRecord')(
      {},
      '/proj',
      'cat1',
      { name: 'alice', age: 18 }
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe(42)
    expect(configMocks.insertConfigRecord).toHaveBeenCalledWith('/proj', 'cat1', { name: 'alice', age: 18 })
  })

  it('launch:insertConfigRecord service 抛异常返回 ok:false', async () => {
    configMocks.insertConfigRecord.mockImplementation(() => {
      throw new Error('insert-fail')
    })
    const res = (await getHandler('launch:insertConfigRecord')(
      {},
      '/proj',
      'cat1',
      { name: 'x' }
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('insert-fail')
  })

  it('launch:deleteConfigRecord 正常路径（写操作，无 data）', async () => {
    configMocks.deleteConfigRecord.mockReturnValue(undefined)
    const res = (await getHandler('launch:deleteConfigRecord')(
      {},
      '/proj',
      'cat1',
      7
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBeUndefined()
    expect(configMocks.deleteConfigRecord).toHaveBeenCalledWith('/proj', 'cat1', 7)
  })

  it('launch:deleteConfigRecord service 抛异常返回 ok:false', async () => {
    configMocks.deleteConfigRecord.mockImplementation(() => {
      throw new Error('delete-fail')
    })
    const res = (await getHandler('launch:deleteConfigRecord')(
      {},
      '/proj',
      'cat1',
      7
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('delete-fail')
  })

  it('launch:createConfigTable 正常路径（返回新 category）', async () => {
    configMocks.createConfigTable.mockReturnValue('cat_new')
    const fields = [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }]
    const res = (await getHandler('launch:createConfigTable')(
      {},
      '/proj',
      '新表',
      fields
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe('cat_new')
    expect(configMocks.createConfigTable).toHaveBeenCalledWith('/proj', '新表', fields)
  })

  it('launch:createConfigTable service 抛异常返回 ok:false', async () => {
    configMocks.createConfigTable.mockImplementation(() => {
      throw new Error('create-table-fail')
    })
    const res = (await getHandler('launch:createConfigTable')(
      {},
      '/proj',
      '新表',
      []
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('create-table-fail')
  })

  it('launch:dropConfigTable 正常路径（写操作，无 data）', async () => {
    configMocks.dropConfigTable.mockReturnValue(undefined)
    const res = (await getHandler('launch:dropConfigTable')(
      {},
      '/proj',
      'cat1'
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBeUndefined()
    expect(configMocks.dropConfigTable).toHaveBeenCalledWith('/proj', 'cat1')
  })

  it('launch:dropConfigTable service 抛异常返回 ok:false', async () => {
    configMocks.dropConfigTable.mockImplementation(() => {
      throw new Error('drop-fail')
    })
    const res = (await getHandler('launch:dropConfigTable')(
      {},
      '/proj',
      'cat1'
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('drop-fail')
  })

  it('launch:renameConfigTable 正常路径（返回新 category）', async () => {
    configMocks.renameConfigTable.mockReturnValue('cat_renamed')
    const res = (await getHandler('launch:renameConfigTable')(
      {},
      '/proj',
      'cat_old',
      '新名称'
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe('cat_renamed')
    expect(configMocks.renameConfigTable).toHaveBeenCalledWith('/proj', 'cat_old', '新名称')
  })

  it('launch:renameConfigTable service 抛异常返回 ok:false', async () => {
    configMocks.renameConfigTable.mockImplementation(() => {
      throw new Error('rename-fail')
    })
    const res = (await getHandler('launch:renameConfigTable')(
      {},
      '/proj',
      'cat_old',
      '新名称'
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('rename-fail')
  })

  it('launch:alterConfigTable 正常路径（返回结果）', async () => {
    const alterResult = { added: 1, dropped: 0, updated: 0 }
    configMocks.alterConfigTable.mockReturnValue(alterResult)
    const options = { addFields: [{ name: 'new_col', type: 'text' }] }
    const res = (await getHandler('launch:alterConfigTable')(
      {},
      '/proj',
      'cat1',
      options
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(alterResult)
    expect(configMocks.alterConfigTable).toHaveBeenCalledWith('/proj', 'cat1', options)
  })

  it('launch:alterConfigTable 传入完整 options（add/drop/update）', async () => {
    configMocks.alterConfigTable.mockReturnValue({ added: 1, dropped: 1, updated: 1 })
    const options = {
      addFields: [{ name: 'new_col', type: 'text' }],
      dropFields: ['old_col'],
      updateFields: [{ name: 'mid_col', type: 'integer' }]
    }
    const res = (await getHandler('launch:alterConfigTable')(
      {},
      '/proj',
      'cat1',
      options
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(configMocks.alterConfigTable).toHaveBeenCalledWith('/proj', 'cat1', options)
  })

  it('launch:alterConfigTable service 抛异常返回 ok:false', async () => {
    configMocks.alterConfigTable.mockImplementation(() => {
      throw new Error('alter-fail')
    })
    const res = (await getHandler('launch:alterConfigTable')(
      {},
      '/proj',
      'cat1',
      {}
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('alter-fail')
  })
})

// ===== launchData IPC =====
describe('launchData IPC', () => {
  // 一个在 process.cwd() 内、扩展名合法的路径，用于"正常路径"
  const safePath = join(process.cwd(), 'test-data.db')

  it('launch:listDataSources 正常路径', async () => {
    dataMocks.listDataSources.mockReturnValue([{ name: 'main', path: safePath }])
    const res = (await getHandler('launch:listDataSources')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual([{ name: 'main', path: safePath }])
    expect(dataMocks.listDataSources).toHaveBeenCalledWith('/proj')
  })

  it('launch:listDataSources service 抛异常返回 ok:false', async () => {
    dataMocks.listDataSources.mockImplementation(() => {
      throw new Error('ds-fail')
    })
    const res = (await getHandler('launch:listDataSources')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('ds-fail')
  })

  // ---- assertDataFileSafe 参数校验：getSchema 为代表 ----
  it('launch:getSchema 正常路径', async () => {
    dataMocks.getSchema.mockReturnValue({ fields: [] })
    const res = (await getHandler('launch:getSchema')({}, safePath)) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ fields: [] })
    expect(dataMocks.getSchema).toHaveBeenCalledWith(safePath)
  })

  it('launch:getSchema 空路径返回 ok:false', async () => {
    const res = (await getHandler('launch:getSchema')({}, '')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('文件路径不能为空')
    expect(dataMocks.getSchema).not.toHaveBeenCalled()
  })

  it('launch:getSchema 非绝对路径返回 ok:false', async () => {
    const res = (await getHandler('launch:getSchema')({}, 'relative.db')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('文件路径必须是绝对路径')
    expect(dataMocks.getSchema).not.toHaveBeenCalled()
  })

  it('launch:getSchema 路径越界（cwd 之外）返回 ok:false', async () => {
    const outside = resolve(process.cwd(), '..', 'outside.db')
    const res = (await getHandler('launch:getSchema')({}, outside)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/路径越界/)
    expect(dataMocks.getSchema).not.toHaveBeenCalled()
  })

  it('launch:getSchema 不支持的扩展名返回 ok:false', async () => {
    const badExt = join(process.cwd(), 'test.txt')
    const res = (await getHandler('launch:getSchema')({}, badExt)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/不支持的文件类型/)
    expect(dataMocks.getSchema).not.toHaveBeenCalled()
  })

  it('launch:getSchema service 抛异常返回 ok:false', async () => {
    dataMocks.getSchema.mockImplementation(() => {
      throw new Error('schema-read-fail')
    })
    const res = (await getHandler('launch:getSchema')({}, safePath)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('schema-read-fail')
  })

  it('launch:queryTable 正常路径', async () => {
    dataMocks.queryTable.mockReturnValue({ rows: [], total: 0 })
    const res = (await getHandler('launch:queryTable')({}, safePath, 'players', 1, 20)) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ rows: [], total: 0 })
    expect(dataMocks.queryTable).toHaveBeenCalledWith(safePath, 'players', 1, 20, undefined)
  })

  it('launch:queryTable 空路径返回 ok:false', async () => {
    const res = (await getHandler('launch:queryTable')({}, '', 'players', 1, 20)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('文件路径不能为空')
    expect(dataMocks.queryTable).not.toHaveBeenCalled()
  })

  it('launch:queryTable service 抛异常返回 ok:false', async () => {
    dataMocks.queryTable.mockImplementation(() => {
      throw new Error('query-fail')
    })
    const res = (await getHandler('launch:queryTable')({}, safePath, 'players', 1, 20)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('query-fail')
  })

  it('launch:updateRecord 正常路径（写操作，无 data）', async () => {
    dataMocks.updateRecord.mockReturnValue(undefined)
    const res = (await getHandler('launch:updateRecord')(
      {},
      safePath,
      'players',
      3,
      { name: 'x' }
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(dataMocks.updateRecord).toHaveBeenCalledWith(safePath, 'players', 3, { name: 'x' })
  })

  it('launch:updateRecord 路径越界返回 ok:false', async () => {
    const outside = resolve(process.cwd(), '..', 'outside.db')
    const res = (await getHandler('launch:updateRecord')({}, outside, 'players', 3, {})) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/路径越界/)
    expect(dataMocks.updateRecord).not.toHaveBeenCalled()
  })

  it('launch:insertRecord 正常路径', async () => {
    dataMocks.insertRecord.mockReturnValue(10)
    const res = (await getHandler('launch:insertRecord')({}, safePath, 'players', { name: 'x' })) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe(10)
    expect(dataMocks.insertRecord).toHaveBeenCalledWith(safePath, 'players', { name: 'x' })
  })

  it('launch:deleteRecord 正常路径（无 data）', async () => {
    dataMocks.deleteRecord.mockReturnValue(undefined)
    const res = (await getHandler('launch:deleteRecord')({}, safePath, 'players', 3)) as IpcResult
    expect(res.ok).toBe(true)
    expect(dataMocks.deleteRecord).toHaveBeenCalledWith(safePath, 'players', 3)
  })

  it('launch:searchPlayer 正常路径', async () => {
    dataMocks.searchPlayer.mockReturnValue([{ qq: '123', name: 'a' }])
    const res = (await getHandler('launch:searchPlayer')({}, '/proj', 'keyword')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual([{ qq: '123', name: 'a' }])
    expect(dataMocks.searchPlayer).toHaveBeenCalledWith('/proj', 'keyword')
  })

  it('launch:searchPlayer service 抛异常返回 ok:false', async () => {
    dataMocks.searchPlayer.mockImplementation(() => {
      throw new Error('search-fail')
    })
    const res = (await getHandler('launch:searchPlayer')({}, '/proj', 'keyword')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('search-fail')
  })

  it('launch:listPlayers 正常路径', async () => {
    dataMocks.listPlayers.mockReturnValue([{ qq: '123' }])
    const res = (await getHandler('launch:listPlayers')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual([{ qq: '123' }])
    expect(dataMocks.listPlayers).toHaveBeenCalledWith('/proj')
  })

  it('launch:listPlayers service 抛异常返回 ok:false', async () => {
    dataMocks.listPlayers.mockImplementation(() => {
      throw new Error('list-players-fail')
    })
    const res = (await getHandler('launch:listPlayers')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('list-players-fail')
  })

  it('launch:queryPlayerTables 正常路径', async () => {
    dataMocks.queryPlayerTables.mockReturnValue({ tables: [] })
    const res = (await getHandler('launch:queryPlayerTables')({}, safePath, '123456')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ tables: [] })
    expect(dataMocks.queryPlayerTables).toHaveBeenCalledWith(safePath, '123456')
  })

  it('launch:queryPlayerTables 空路径返回 ok:false', async () => {
    const res = (await getHandler('launch:queryPlayerTables')({}, '', '123456')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('文件路径不能为空')
  })

  it('launch:getUidMapping 正常路径', async () => {
    uidMocks.getUidMapping.mockReturnValue({ nextUid: 10001, mapping: {} })
    const res = (await getHandler('launch:getUidMapping')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ nextUid: 10001, mapping: {} })
    expect(uidMocks.getUidMapping).toHaveBeenCalledWith('/proj')
  })

  it('launch:getUidMapping service 抛异常返回 ok:false', async () => {
    uidMocks.getUidMapping.mockImplementation(() => {
      throw new Error('uid-fail')
    })
    const res = (await getHandler('launch:getUidMapping')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('uid-fail')
  })

  it('launch:getPlayersWithUid 正常路径', async () => {
    uidMocks.getPlayersWithUid.mockReturnValue([{ uid: '1', openid: 'o1', recordCount: 0, sources: [] }])
    const res = (await getHandler('launch:getPlayersWithUid')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(uidMocks.getPlayersWithUid).toHaveBeenCalledWith('/proj')
  })

  it('launch:getPlayersWithUid service 抛异常返回 ok:false', async () => {
    uidMocks.getPlayersWithUid.mockImplementation(() => {
      throw new Error('pwu-fail')
    })
    const res = (await getHandler('launch:getPlayersWithUid')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('pwu-fail')
  })

  it('launch:updatePlayerUid 正常路径', async () => {
    uidMocks.updatePlayerUid.mockReturnValue(true)
    const res = (await getHandler('launch:updatePlayerUid')({}, '/proj', 'openid1', 10005)) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBe(true)
    expect(uidMocks.updatePlayerUid).toHaveBeenCalledWith('/proj', 'openid1', 10005)
  })

  it('launch:updatePlayerUid service 抛异常返回 ok:false', async () => {
    uidMocks.updatePlayerUid.mockImplementation(() => {
      throw new Error('update-uid-fail')
    })
    const res = (await getHandler('launch:updatePlayerUid')({}, '/proj', 'openid1', 10005)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('update-uid-fail')
  })

  it('launch:getDataTemplate 正常路径', async () => {
    templateMocks.getDataTemplate.mockReturnValue({ version: 1, groups: [] })
    const res = (await getHandler('launch:getDataTemplate')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ version: 1, groups: [] })
    expect(templateMocks.getDataTemplate).toHaveBeenCalledWith('/proj')
  })

  it('launch:getDataTemplate service 抛异常返回 ok:false', async () => {
    templateMocks.getDataTemplate.mockImplementation(() => {
      throw new Error('tpl-fail')
    })
    const res = (await getHandler('launch:getDataTemplate')({}, '/proj')) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('tpl-fail')
  })

  it('launch:saveDataTemplate 正常路径（返回 data:null）', async () => {
    templateMocks.saveDataTemplate.mockReturnValue(undefined)
    const res = (await getHandler('launch:saveDataTemplate')(
      {},
      '/proj',
      { version: 1, groups: [] }
    )) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toBeNull()
    expect(templateMocks.saveDataTemplate).toHaveBeenCalledWith('/proj', { version: 1, groups: [] })
  })

  it('launch:saveDataTemplate service 抛异常返回 ok:false', async () => {
    templateMocks.saveDataTemplate.mockImplementation(() => {
      throw new Error('save-tpl-fail')
    })
    const res = (await getHandler('launch:saveDataTemplate')(
      {},
      '/proj',
      { version: 1, groups: [] }
    )) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toBe('save-tpl-fail')
  })
})
