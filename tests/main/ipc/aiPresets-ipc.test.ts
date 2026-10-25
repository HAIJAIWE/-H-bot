// tests/main/ipc/aiPresets-ipc.test.ts
//
// 第 53 批：预设导入导出的三条 IPC。
// 这里只验通道边界（参数校验、对话框取消、写盘只在导出/确认导入时发生），
// 解析与合并规则在 tests/main/services/ai/presetShare.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  buildPresetShare: vi.fn(),
  previewPresetImport: vi.fn(),
  importPresetShare: vi.fn(),
  undoPresetImport: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showSaveDialog: mocks.showSaveDialog, showOpenDialog: mocks.showOpenDialog },
}))
vi.mock('fs/promises', () => {
  const m = { readFile: mocks.readFile, stat: mocks.stat, writeFile: mocks.writeFile }
  return { ...m, default: m }
})
vi.mock('@main/services/ai/presetShare', () => ({
  buildPresetShare: mocks.buildPresetShare,
  previewPresetImport: mocks.previewPresetImport,
  importPresetShare: mocks.importPresetShare,
}))
vi.mock('@main/services/ai/presetUndo', () => ({
  undoPresetImport: mocks.undoPresetImport,
}))

import { registerAiPresetsIpc } from '@main/ipc/aiPresets'

interface IpcResult {
  ok: boolean
  data?: unknown
  error?: string
}

const event = { sender: {} }

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.handle.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error('handler not registered: ' + channel)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

beforeEach(() => {
  mocks.handle.mockReset()
  for (const fn of [
    mocks.fromWebContents,
    mocks.showSaveDialog,
    mocks.showOpenDialog,
    mocks.readFile,
    mocks.stat,
    mocks.writeFile,
    mocks.buildPresetShare,
    mocks.previewPresetImport,
    mocks.importPresetShare,
    mocks.undoPresetImport,
  ]) {
    fn.mockReset()
  }
  mocks.fromWebContents.mockReturnValue(null)
  registerAiPresetsIpc()
})

describe('ai:exportPresets', () => {
  it('选保存位置后写盘，返回路径/条数/warnings', async () => {
    mocks.buildPresetShare.mockResolvedValue({
      text: '{"type":"x"}',
      count: 2,
      warnings: ['甲：x'],
    })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out/share.json' })
    const res = (await getHandler('ai:exportPresets')(event, { projectPath: '/p' })) as IpcResult
    expect(res).toEqual({
      ok: true,
      data: { filePath: 'C:/out/share.json', count: 2, warnings: ['甲：x'] },
    })
    expect(mocks.writeFile).toHaveBeenCalledWith('C:/out/share.json', '{"type":"x"}', 'utf-8')
  })

  it('取消 → 报「用户取消」，不写盘', async () => {
    mocks.buildPresetShare.mockResolvedValue({ text: 'x', count: 1, warnings: [] })
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    const res = (await getHandler('ai:exportPresets')(event, { projectPath: '/p' })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('用户取消')
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('服务层拒绝（坏文件/空表）原样回错误，且不弹保存框', async () => {
    mocks.buildPresetShare.mockRejectedValue(new Error('预设文件读不了：x'))
    const res = (await getHandler('ai:exportPresets')(event, { projectPath: '/p' })) as IpcResult
    expect(res).toEqual({ ok: false, error: '预设文件读不了：x' })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('projectPath 为空 → 参数校验失败', async () => {
    const res = (await getHandler('ai:exportPresets')(event, { projectPath: '' })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('参数校验失败')
  })
})

describe('ai:pickPresetShare', () => {
  it('选文件 → 限流后读原文，回文件名与预览（不写项目）', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/in/share.json'] })
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 100 })
    mocks.readFile.mockResolvedValue('{"type":"x"}')
    mocks.previewPresetImport.mockResolvedValue({
      presets: [{ name: '甲' }],
      conflicts: [],
      existingCount: 0,
    })
    const res = (await getHandler('ai:pickPresetShare')(event, {
      projectPath: '/p',
    })) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({
      filePath: 'C:/in/share.json',
      fileName: 'share.json',
      text: '{"type":"x"}',
    })
    expect(mocks.previewPresetImport).toHaveBeenCalledWith('/p', '{"type":"x"}')
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('太大 / 不是文件 / 取消 → 拒绝且不解析', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/in/big.json'] })
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 999_999_999 })
    let res = (await getHandler('ai:pickPresetShare')(event, { projectPath: '/p' })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('文件太大')

    mocks.stat.mockResolvedValue({ isFile: () => false, size: 1 })
    res = (await getHandler('ai:pickPresetShare')(event, { projectPath: '/p' })) as IpcResult
    expect(res.error).toContain('不是文件')

    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    res = (await getHandler('ai:pickPresetShare')(event, { projectPath: '/p' })) as IpcResult
    expect(res.error).toContain('用户取消')
    expect(mocks.previewPresetImport).not.toHaveBeenCalled()
  })
})

describe('ai:importPresets', () => {
  it('确认导入：把原文、overwrite、sourceName 原样交给服务层', async () => {
    mocks.importPresetShare.mockResolvedValue({
      added: 1,
      replaced: 0,
      total: 1,
      unchanged: false,
      undo: { available: true },
    })
    const res = (await getHandler('ai:importPresets')(event, {
      projectPath: '/p',
      text: '{"type":"x"}',
      overwrite: true,
      sourceName: '同事的预设.json',
    })) as IpcResult
    expect(res).toEqual({
      ok: true,
      data: { added: 1, replaced: 0, total: 1, unchanged: false, undo: { available: true } },
    })
    expect(mocks.importPresetShare).toHaveBeenCalledWith(
      '/p',
      '{"type":"x"}',
      true,
      '同事的预设.json',
    )
  })

  it('不带 sourceName 也能导入（第 4 参是 undefined）', async () => {
    mocks.importPresetShare.mockResolvedValue({ added: 1, replaced: 0, total: 1, unchanged: false })
    await getHandler('ai:importPresets')(event, {
      projectPath: '/p',
      text: 'x',
      overwrite: false,
    })
    expect(mocks.importPresetShare).toHaveBeenCalledWith('/p', 'x', false, undefined)
  })

  it('缺 overwrite → 参数校验失败，不调用服务层', async () => {
    const res = (await getHandler('ai:importPresets')(event, {
      projectPath: '/p',
      text: 'x',
    })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('参数校验失败')
    expect(mocks.importPresetShare).not.toHaveBeenCalled()
  })
})

describe('ai:undoPresetImport', () => {
  it('按项目撤销：把 projectPath 交给服务层，原样回结果', async () => {
    mocks.undoPresetImport.mockResolvedValue({
      restored: true,
      removed: false,
      createdAt: '2026-10-26T00:00:00.000Z',
      added: 1,
      replaced: 0,
      total: 2,
    })
    const res = (await getHandler('ai:undoPresetImport')(event, {
      projectPath: '/p',
    })) as IpcResult
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ restored: true, removed: false, total: 2 })
    expect(mocks.undoPresetImport).toHaveBeenCalledWith('/p')
  })

  it('服务层拒绝（没有可撤销/被改过/备份坏了）→ 原样回错误', async () => {
    mocks.undoPresetImport.mockRejectedValue(new Error('导入之后预设文件又被改过'))
    const res = (await getHandler('ai:undoPresetImport')(event, {
      projectPath: '/p',
    })) as IpcResult
    expect(res).toEqual({ ok: false, error: '导入之后预设文件又被改过' })
  })

  it('projectPath 为空 → 参数校验失败，不调用服务层', async () => {
    const res = (await getHandler('ai:undoPresetImport')(event, {
      projectPath: '',
    })) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('参数校验失败')
    expect(mocks.undoPresetImport).not.toHaveBeenCalled()
  })
})
