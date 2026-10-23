// tests/main/ipc/codegen-ipc.test.ts
// 覆盖 codegen:generate IPC handler。
//
// 历史：这里还有一组 codegen:exportReadable 用例（导出可读 Python）。ADR-003 之后
// 解释器直接执行 flow.json，产物是 TypeScript 快照，那条通道与 src/main/services/codegen.ts
// 一起下线了 —— 用例移到 _recovery/legacy-python-codegen-tests/。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { ipcMainHandleMock, codegenGenerateMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  codegenGenerateMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

// CodegenService 只在签名里当类型用；mock 掉避免拖入 git/plugin 重依赖
vi.mock('@main/services/flow/codegen', () => ({
  CodegenService: vi.fn()
}))

import { registerCodegenIpc } from '@main/ipc/codegen'

interface IpcResult {
  ok: boolean
  data?: unknown
  error?: string
}

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> | unknown {
  const call = ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown> | unknown
}

const FLOW = { nodes: [], edges: [] }

beforeEach(() => {
  ipcMainHandleMock.mockReset()
  codegenGenerateMock.mockReset()
  registerCodegenIpc({ generate: codegenGenerateMock } as never)
})

describe('codegen:generate IPC', () => {
  it('只注册 generate 一条通道（exportReadable 已随 ADR-003 下线）', () => {
    const channels = ipcMainHandleMock.mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toEqual(['codegen:generate'])
  })

  it('正常路径：generate 收到 projectPath/flow/debugMode，返回 ok:true 与版本信息', async () => {
    codegenGenerateMock.mockResolvedValue({ version: 'v1.2', versionError: null })
    const res = (await getHandler('codegen:generate')({}, '/proj', FLOW)) as IpcResult
    expect(res).toEqual({ ok: true, data: { version: 'v1.2', versionError: null } })
    // 第 4 参是 version 三态：没传就是 undefined（自动命名），不能变成 null（不打版本）
    expect(codegenGenerateMock).toHaveBeenCalledWith('/proj', FLOW, false, undefined)
  })

  it('debugMode=true 透传', async () => {
    codegenGenerateMock.mockResolvedValue({ version: null, versionError: null })
    const res = (await getHandler('codegen:generate')({}, '/proj', FLOW, true)) as IpcResult
    expect(res.ok).toBe(true)
    expect(codegenGenerateMock.mock.calls[0][2]).toBe(true)
  })

  it('version=null 原样透传（只生成、不打版本）', async () => {
    codegenGenerateMock.mockResolvedValue({ version: null, versionError: null })
    await getHandler('codegen:generate')({}, '/proj', FLOW, false, null)
    expect(codegenGenerateMock).toHaveBeenCalledWith('/proj', FLOW, false, null)
  })

  it('version 对象原样透传（用户填的版号/说明）', async () => {
    codegenGenerateMock.mockResolvedValue({ version: 'v2.0', versionError: null })
    const version = { name: 'v2.0', message: '发布前快照' }
    await getHandler('codegen:generate')({}, '/proj', FLOW, false, version)
    expect(codegenGenerateMock).toHaveBeenCalledWith('/proj', FLOW, false, version)
  })

  it('打版本失败也算生成成功：version=null + versionError 透出', async () => {
    codegenGenerateMock.mockResolvedValue({ version: null, versionError: 'git 不可用' })
    const res = (await getHandler('codegen:generate')({}, '/proj', FLOW)) as IpcResult
    expect(res.ok).toBe(true)
    expect((res.data as { versionError: string }).versionError).toBe('git 不可用')
  })

  it('projectPath 为空 → 参数校验失败，service 不被调用', async () => {
    const res = (await getHandler('codegen:generate')({}, '', FLOW)) as IpcResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('参数校验失败')
    expect(codegenGenerateMock).not.toHaveBeenCalled()
  })

  it('version.name 超长 → 参数校验失败', async () => {
    const res = (await getHandler('codegen:generate')({}, '/proj', FLOW, false, {
      name: 'x'.repeat(65)
    })) as IpcResult
    expect(res.ok).toBe(false)
    expect(codegenGenerateMock).not.toHaveBeenCalled()
  })

  it('service 抛异常 → ok:false 带错误文本', async () => {
    codegenGenerateMock.mockRejectedValue(new Error('磁盘写不进去'))
    const res = (await getHandler('codegen:generate')({}, '/proj', FLOW)) as IpcResult
    expect(res).toEqual({ ok: false, error: '磁盘写不进去' })
  })
})
