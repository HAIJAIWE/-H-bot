// tests/main/services/ai/generate-code.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeTool } from '@main/services/ai/tools'
import type { FlowGraph } from '@shared/types/flow'
import { FLOW_SCHEMA_VERSION } from '@shared/types/flow'

// Mock CodegenService：generate 返回 void（实际写文件），测试中不触盘
vi.mock('@main/services/flow/codegen', () => ({
  CodegenService: vi.fn()
}))

// vi.mock 会被提升，此处导入的是被 mock 后的 CodegenService
import { CodegenService } from '@main/services/flow/codegen'

const mockFlow: FlowGraph = {
  schemaVersion: FLOW_SCHEMA_VERSION,
  systems: [],
  nodes: [],
  edges: [],
  variables: [],
  metadata: { name: 'test', version: '1.0', runtime: 'typescript', createdAt: '', updatedAt: '' }
}

function mockGenerate(): ReturnType<typeof vi.fn> {
  const generate = vi.fn().mockResolvedValue(undefined)
  // 必须用普通函数：生产代码 `new CodegenService()` 需要可构造的 mock
  vi.mocked(CodegenService).mockImplementation(
    function () {
      return { generate }
    } as any
  )
  return generate
}

describe('generate_code 工具', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('调用 CodegenService.generate 并返回成功结果', async () => {
    const generate = mockGenerate()
    const res = await executeTool(
      { id: 't1', name: 'generate_code', args: {} },
      '/test',
      { flow: mockFlow }
    )
    expect(generate).toHaveBeenCalledWith('/test', mockFlow)
    expect(res.result).toMatchObject({ success: true })
  })

  it('codegen 完成后 1 秒触发 onCodegenComplete 回调（热更新防抖）', async () => {
    mockGenerate()
    const onCodegenComplete = vi.fn()
    await executeTool(
      { id: 't2', name: 'generate_code', args: {} },
      '/test',
      { flow: mockFlow, onCodegenComplete }
    )
    // 1 秒内尚未触发
    expect(onCodegenComplete).not.toHaveBeenCalled()
    // 推进 1 秒后触发
    await vi.advanceTimersByTimeAsync(1000)
    expect(onCodegenComplete).toHaveBeenCalledTimes(1)
  })

  it('缺少 flow 上下文时抛错', async () => {
    await expect(
      executeTool({ id: 't3', name: 'generate_code', args: {} }, '/test')
    ).rejects.toThrow(/flow/i)
  })
})
