// tests/main/ipc/ai-config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted 保证 mock 引用在 vi.mock 工厂中可用（vi.mock 会被提升到文件顶部）
const { setAiConfigMock, readFileMock } = vi.hoisted(() => ({
  setAiConfigMock: vi.fn(),
  readFileMock: vi.fn()
}))

// Mock electron —— ai.ts 顶层 import { ipcMain, BrowserWindow }
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() }
}))

// 捕获 setAiConfig 调用，并避免载入 ai/index.ts 的沉重依赖（llm/context/tools/proposal 等）
vi.mock('@main/services/ai', () => ({
  processAiChat: vi.fn(),
  setAiConfig: setAiConfigMock,
  getAiConfig: vi.fn(() => null),
  beginBatch: vi.fn(),
  commitBatch: vi.fn(),
  handleRollbackBatch: vi.fn()
}))

// tools 模块会被 ai.ts 顶层 import，提供空数组即可
vi.mock('@main/services/ai/tools', () => ({
  ALL_TOOL_DEFINITIONS: []
}))

// 控制 readFile 返回的 project.json 内容
// 同时提供 named 与 default 导出，兼容 vitest 对 Node builtin 的 CJS interop
vi.mock('fs/promises', () => {
  const mocked = { readFile: readFileMock }
  return { ...mocked, default: mocked }
})

import { loadAiConfigFromProject } from '@main/ipc/ai'

describe('LLM 配置自动加载', () => {
  beforeEach(() => {
    setAiConfigMock.mockReset()
    readFileMock.mockReset()
  })

  it('启动时从 project.json 读取 ai 配置并注入 setAiConfig', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        name: 'demo',
        ai: { provider: 'glm', apiKey: 'test-key', model: 'glm-4' }
      })
    )

    const config = await loadAiConfigFromProject('/test')

    expect(config).not.toBeNull()
    expect(config?.provider).toBe('glm')
    expect(config?.apiKey).toBe('test-key')
    expect(config?.model).toBe('glm-4')
    expect(setAiConfigMock).toHaveBeenCalledTimes(1)
    expect(setAiConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'glm',
        apiKey: 'test-key',
        model: 'glm-4'
      })
    )
  })

  it('无 ai 配置时返回 null 且不调用 setAiConfig', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ name: 'demo' }))

    const config = await loadAiConfigFromProject('/test')

    expect(config).toBeNull()
    expect(setAiConfigMock).not.toHaveBeenCalled()
  })

  it('project.json 不存在时返回 null（友好降级）', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const config = await loadAiConfigFromProject('/missing')

    expect(config).toBeNull()
    expect(setAiConfigMock).not.toHaveBeenCalled()
  })

  it('ai 字段不合法时返回 null 且不调用 setAiConfig', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ ai: { provider: 'unknown', apiKey: '', model: '' } })
    )

    const config = await loadAiConfigFromProject('/test')

    expect(config).toBeNull()
    expect(setAiConfigMock).not.toHaveBeenCalled()
  })

})
