// tests/main/ipc/customNode-v2.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// vi.hoisted 保证 mock 引用在 vi.mock 工厂中可用（vi.mock 会被提升到文件顶部）
const { ipcMainHandleMock, scanCustomNodesV2Mock, scanAiGeneratedNodesMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  scanCustomNodesV2Mock: vi.fn(),
  scanAiGeneratedNodesMock: vi.fn()
}))

// Mock electron —— customNode.ts 顶层 import { ipcMain, BrowserWindow }
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null)
  }
}))

// Mock customNodeScanner：提供 legacy scanCustomNodes（旧 handler 仍引用）+ V2
vi.mock('@main/services/customNodeScanner', () => ({
  scanCustomNodes: vi.fn(),
  scanCustomNodesV2: scanCustomNodesV2Mock
}))

import { registerCustomNodeIpc, setAiGeneratedScanner, closeAllWatchersForTesting } from '@main/ipc/customNode'

/** 从 ipcMain.handle 的调用记录里提取指定 channel 的 handler */
function getHandler(
  channel: string
): (event: unknown, payload: { projectPath: string; builtinKind?: string; newName?: string }) => Promise<unknown> {
  const call = ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (event: unknown, payload: { projectPath: string }) => Promise<unknown>
}

// ===== 问题 3（IPC 部分）：customNode:fork 重新校验 newName =====
describe('customNode:fork IPC 重新校验 newName', () => {
  let tmpRoot: string
  let prevCwd: string

  beforeEach(async () => {
    ipcMainHandleMock.mockReset()
    scanCustomNodesV2Mock.mockReset()
    scanAiGeneratedNodesMock.mockReset()
    setAiGeneratedScanner(null)

    tmpRoot = await mkdtemp(join(tmpdir(), 'qqbat-ipc-fork-'))
    prevCwd = process.cwd()
    process.chdir(tmpRoot)
  })

  afterEach(async () => {
    process.chdir(prevCwd)
    try {
      await rm(tmpRoot, { recursive: true, force: true })
    } catch {
      await new Promise((r) => setTimeout(r, 50))
      await rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('IPC handler 拒绝含大写字母的 newName（绕过 UI 正则）', async () => {
    registerCustomNodeIpc()
    const handler = getHandler('customNode:fork') as (
      e: unknown,
      p: { projectPath: string; builtinKind: string; newName: string }
    ) => Promise<{ ok: boolean; error?: string }>

    const result = await handler({}, {
      projectPath: join(tmpRoot, 'proj'),
      builtinKind: 'send_message',
      newName: 'MySend'
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/newName|小写字母|非法/)
  })

  it('IPC handler 拒绝 Python 关键字 newName', async () => {
    registerCustomNodeIpc()
    const handler = getHandler('customNode:fork') as (
      e: unknown,
      p: { projectPath: string; builtinKind: string; newName: string }
    ) => Promise<{ ok: boolean; error?: string }>

    const result = await handler({}, {
      projectPath: join(tmpRoot, 'proj'),
      builtinKind: 'send_message',
      newName: 'class'
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Python|关键字/)
  })

  it('IPC handler 拒绝路径穿越 builtinKind', async () => {
    registerCustomNodeIpc()
    const handler = getHandler('customNode:fork') as (
      e: unknown,
      p: { projectPath: string; builtinKind: string; newName: string }
    ) => Promise<{ ok: boolean; error?: string }>

    const result = await handler({}, {
      projectPath: join(tmpRoot, 'proj'),
      builtinKind: '../../../etc/passwd',
      newName: 'my_node'
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/builtinKind|非法/)
  })
})

// ===== 问题 7：customNode:watch closed 监听器累积 =====
describe('customNode:watch 监听器清理', () => {
  let tmpRoot: string
  let prevCwd: string

  beforeEach(async () => {
    ipcMainHandleMock.mockReset()
    scanCustomNodesV2Mock.mockReset()
    scanAiGeneratedNodesMock.mockReset()
    setAiGeneratedScanner(null)
    vi.mocked(BrowserWindow.getAllWindows).mockReset()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])

    tmpRoot = await mkdtemp(join(tmpdir(), 'qqbat-ipc-watch-'))
    prevCwd = process.cwd()
    process.chdir(tmpRoot)
  })

  afterEach(async () => {
    // 先关闭所有 FSWatcher，防止 Windows 上删除 tmp 目录时 EPERM
    closeAllWatchersForTesting()
    process.chdir(prevCwd)
    try {
      await rm(tmpRoot, { recursive: true, force: true })
    } catch {
      await new Promise((r) => setTimeout(r, 50))
      await rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('替换 watcher 时移除旧的 closed 监听器', async () => {
    // 准备真实 customPy 文件
    const projectPath = join(tmpRoot, 'proj')
    // customNode:watch 监听的是项目根的 plugins/ 目录（不是 src/plugins/custom）
    const customPy = join(projectPath, 'plugins', '__init__.py')
    await mkdir(join(projectPath, 'plugins'), { recursive: true })
    await writeFile(customPy, '')

    // 构造 mock 窗口，含 on / off / isDestroyed / webContents.send
    const onSpy = vi.fn()
    const offSpy = vi.fn()
    const mockWin = {
      on: onSpy,
      off: offSpy,
      isDestroyed: vi.fn(() => false),
      webContents: { id: 1, send: vi.fn() }
    } as unknown as BrowserWindow
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin])
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)

    registerCustomNodeIpc()
    const handler = getHandler('customNode:watch')

    // 第一次 watch：注册 closed 监听器
    await handler({ sender: { id: 1 } }, { projectPath })
    expect(onSpy).toHaveBeenCalledWith('closed', expect.any(Function))
    expect(onSpy).toHaveBeenCalledTimes(1)
    const firstListener = onSpy.mock.calls[0][1] as (e: unknown) => void

    // 第二次 watch（同 path）：应先 off 旧监听器，再 on 新监听器
    await handler({ sender: { id: 1 } }, { projectPath })
    expect(offSpy).toHaveBeenCalledWith('closed', firstListener)
    expect(onSpy).toHaveBeenCalledTimes(2)
    const secondListener = onSpy.mock.calls[1][1] as (e: unknown) => void
    expect(secondListener).not.toBe(firstListener)
  })

  it('首次 watch 不调用 off（无旧监听器可移除）', async () => {
    const projectPath = join(tmpRoot, 'proj2')
    // customNode:watch 监听的是项目根的 plugins/ 目录（不是 src/plugins/custom）
    const customPy = join(projectPath, 'plugins', '__init__.py')
    await mkdir(join(projectPath, 'plugins'), { recursive: true })
    await writeFile(customPy, '')

    const onSpy = vi.fn()
    const offSpy = vi.fn()
    const mockWin = {
      on: onSpy,
      off: offSpy,
      isDestroyed: vi.fn(() => false),
      webContents: { id: 1, send: vi.fn() }
    } as unknown as BrowserWindow
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin])
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)

    registerCustomNodeIpc()
    const handler = getHandler('customNode:watch')

    await handler({ sender: { id: 1 } }, { projectPath })

    expect(onSpy).toHaveBeenCalledTimes(1)
    expect(offSpy).not.toHaveBeenCalled()
  })
})
