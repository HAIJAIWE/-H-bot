// tests/main/ipc/ai-ipc.test.ts
//
// # ai:* 通道的**接线**（不是业务逻辑）
//
// 这份文件原先只剩一个被截断的 mock 头（还在 mock 一个本构建里并不存在的
// `@shared/types/ai-provider.providerRegistry`）。按恢复树的现状重写成"接线"用例：
// 每个 handler 有没有把参数原样交给 service、失败时返不返 `{ok:false}`、
// 需要窗口的通道在没窗口时会不会硬着头皮往下走。
//
// 越界路径的拒绝由 `tests/main/ipc/projectPathGuard.test.ts` 专门覆盖，这里只钉"传参"。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  const registered = new Map<string, Handler>()
  const ipcMainHandle = vi.fn((channel: string, fn: Handler) => {
    registered.set(channel, fn)
  })
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  return {
    registered,
    ipcMainHandle,
    win,
    setAiConfig: vi.fn(),
    getAiConfig: vi.fn(() => null),
    beginBatch: vi.fn(),
    commitBatch: vi.fn(),
    handleRollbackBatch: vi.fn(),
    isBatchModeFor: vi.fn(() => false),
    // 循环侧（2026-10-25 旧助手链路删掉后，取消/查询都落在 aiAgentCore 上）
    cancelAgentCoreRun: vi.fn(() => true),
    isAgentCoreRunning: vi.fn(() => true),
    // 停止时顺带收掉的两样：挂着的审批弹窗与悬着的写指令
    cancelApprovalsFor: vi.fn(),
    settleInstructionsFor: vi.fn(),
    resolveApproval: vi.fn(() => true),
    runOnboarding: vi.fn(async () => ({ ok: true, finalText: '' })),
    fromWebContents: vi.fn((): unknown => win),
    getHandler: (channel: string): Handler => {
      const fn = registered.get(channel)
      if (!fn) throw new Error(`handler ${channel} 未注册`)
      return fn
    },
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle, on: vi.fn() },
  BrowserWindow: {
    fromWebContents: mocks.fromWebContents,
    getAllWindows: vi.fn(() => [mocks.win]),
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false,
    getName: vi.fn(() => 'qqbat'),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
}))

// ai/index.ts 依赖很重（llm / context / tools / proposal），这里整体 mock，只验接线
vi.mock('@main/services/ai', () => ({
  setAiConfig: mocks.setAiConfig,
  getAiConfig: mocks.getAiConfig,
  beginBatch: mocks.beginBatch,
  commitBatch: mocks.commitBatch,
  handleRollbackBatch: mocks.handleRollbackBatch,
  isBatchModeFor: mocks.isBatchModeFor,
}))

// 对话只有一条路 = 循环：取消/查询落在 ai:agentCoreRun 的实现上
vi.mock('@main/ipc/aiAgentCore', () => ({
  cancelAgentCoreRun: mocks.cancelAgentCoreRun,
  isAgentCoreRunning: mocks.isAgentCoreRunning,
}))

vi.mock('@main/services/ai/toolApproval', () => ({
  cancelApprovalsFor: mocks.cancelApprovalsFor,
  resolveApproval: mocks.resolveApproval,
}))

vi.mock('@main/services/ai/instructionBridge', () => ({
  settleInstructionsFor: mocks.settleInstructionsFor,
}))

// ipc/ai.ts 的 `ai:tools` 现在给的是**循环注册表**（agent-core 的 listTools()，
// 也就是预设白名单真正过滤的那张表）；mock 打在真源上。
vi.mock('@main/services/agent-core/core', () => ({
  listTools: () => [
    {
      name: 'read_file',
      description: '读一个文件',
      category: 'query',
      parameters: { type: 'object' },
    },
    { name: 'write_file', description: '写一个文件', category: 'mutation' },
  ],
}))

vi.mock('@main/services/ai/budgetSettings', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    writeToolBudgetSetting: vi.fn(async () => {}),
    applyToolBudgetSetting: vi.fn(),
    currentToolBudgetSetting: vi.fn(() => ({ enabled: true, thresholdChars: 8192 })),
  }
})

vi.mock('@main/runtime/dynamicHandlers', () => ({
  getDynamicHandler: vi.fn(() => undefined),
  setBuiltinResolver: vi.fn(),
}))

vi.mock('@main/services/plugins/pluginLoader', () => ({
  loadProjectPlugins: vi.fn(async () => []),
}))

vi.mock('@main/services/devBackup/devMode', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, isFrameworkDevModeEnabled: vi.fn(() => false) }
})

import { registerAiIpc } from '@main/ipc/ai'

let baseDir: string
let projectPath: string

beforeEach(async () => {
  mocks.registered.clear()
  for (const fn of [
    mocks.setAiConfig,
    mocks.beginBatch,
    mocks.commitBatch,
    mocks.handleRollbackBatch,
    mocks.isBatchModeFor,
    mocks.cancelAgentCoreRun,
    mocks.isAgentCoreRunning,
    mocks.cancelApprovalsFor,
    mocks.settleInstructionsFor,
    mocks.resolveApproval,
    mocks.fromWebContents,
  ]) {
    fn.mockClear()
  }
  mocks.fromWebContents.mockReturnValue(mocks.win)
  mocks.isAgentCoreRunning.mockReturnValue(true)
  mocks.cancelAgentCoreRun.mockReturnValue(true)
  mocks.isBatchModeFor.mockReturnValue(false)
  baseDir = await mkdtemp(join(tmpdir(), 'qqbat-ai-ipc-'))
  projectPath = join(baseDir, 'demo')
  await mkdir(join(projectPath, '.qqbat'), { recursive: true })
  registerAiIpc({ getBaseDir: () => baseDir } as never)
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

async function call(channel: string, args: unknown): Promise<any> {
  return await mocks.getHandler(channel)({ sender: {} }, args)
}

describe('注册面', () => {
  it('注册了对话（循环）用到的通道', () => {
    const channels = [...mocks.registered.keys()]
    for (const ch of ['ai:cancelChat', 'ai:isRunning', 'ai:tools', 'ai:resolveApproval']) {
      expect(channels).toContain(ch)
    }
    // 旧助手链路的 ai:chat 已经删了：谁把它加回来，这里先红
    expect(channels).not.toContain('ai:chat')
  })
})

describe('接线', () => {
  it('ai:tools 返回的是循环注册表（预设白名单过滤的那张），字段补全成工具定义', async () => {
    const res = await call('ai:tools', {})
    expect(res.ok).toBe(true)
    // 前两条是循环注册表（mock 的两个），字段缺省就地补全
    expect(res.data.slice(0, 2)).toEqual([
      {
        name: 'read_file',
        description: '读一个文件',
        category: 'query',
        parameters: { type: 'object' },
      },
      { name: 'write_file', description: '写一个文件', category: 'mutation', parameters: {} },
    ])
    const names = res.data.map((tool: { name: string }) => tool.name)
    // 旧 27 个定义也在这张表里 —— 循环接上 adaptLegacyTools 之后，界面上勾的就是它们
    expect(names).toContain('apply_template')
    // 同名（read_file / write_file / validate_flow）只留循环版：一个名字一套规则
    expect(names.filter((name: string) => name === 'read_file')).toHaveLength(1)
    expect(new Set(names).size).toBe(names.length)
  })

  it('ai:cancelChat 取消循环，并收掉挂着的审批与写指令，回执是否真取消了', async () => {
    const res = await call('ai:cancelChat', { projectPath })
    expect(res).toEqual({ ok: true, data: { cancelled: true } })
    expect(mocks.cancelAgentCoreRun).toHaveBeenCalledWith(projectPath)
    // 只停循环不收这两样，界面会一直转圈等人点一个不会来的批准
    expect(mocks.cancelApprovalsFor).toHaveBeenCalledWith(projectPath)
    expect(mocks.settleInstructionsFor).toHaveBeenCalledWith(projectPath, expect.any(String))
  })

  it('ai:cancelChat 在批处理模式里顺手提交（30 秒定时器不该继续跑）', async () => {
    mocks.isBatchModeFor.mockReturnValue(true)
    await call('ai:cancelChat', { projectPath })
    expect(mocks.commitBatch).toHaveBeenCalledWith(projectPath)
  })

  it('ai:isRunning 包成 { running }（界面据此决定能不能点停止）', async () => {
    const res = await call('ai:isRunning', { projectPath })
    expect(res).toEqual({ ok: true, data: { running: true } })
    expect(mocks.isAgentCoreRunning).toHaveBeenCalledWith(projectPath)
  })

  it('ai:beginBatch 无窗口 ⇒ 明确失败；有窗口 ⇒ 交给 beginBatch', async () => {
    mocks.fromWebContents.mockReturnValue(null)
    const failed = await call('ai:beginBatch', { projectPath })
    expect(failed.ok).toBe(false)
    expect(mocks.beginBatch).not.toHaveBeenCalled()

    mocks.fromWebContents.mockReturnValue(mocks.win)
    const ok = await call('ai:beginBatch', { projectPath })
    expect(ok.ok).toBe(true)
    expect(mocks.beginBatch).toHaveBeenCalledWith(projectPath, mocks.win)
  })

  it('参数不合法 ⇒ 参数校验失败（和路径越界是两回事，别混成一条错误）', async () => {
    const res = await call('ai:cancelChat', { projectPath: '' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('参数校验失败')
    expect(mocks.cancelAgentCoreRun).not.toHaveBeenCalled()
  })
})
