// tests/main/services/ai/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted 确保 mock 引用在 vi.mock 工厂中可用
const { callLlmMock, executeToolMock } = vi.hoisted(() => ({
  callLlmMock: vi.fn(),
  executeToolMock: vi.fn()
}))

// Mock callLlm —— 控制多轮返回，避免真实网络调用
vi.mock('@main/services/ai/llm', () => ({
  callLlm: callLlmMock
}))

// Mock executeTool —— chatRun 真实 import 的是 './tools/execute'（不是 '@main/services/ai/tools'，
// 后者只是旧的静态定义表）；只替换执行器，工具定义与分类用真的。
vi.mock('@main/services/ai/tools/execute', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return { ...original, executeTool: executeToolMock }
})

// Mock buildSystemMessage —— 避免读文件
vi.mock('@main/services/ai/context', () => ({
  buildSystemMessage: vi.fn(async () => ({ role: 'system' as const, content: 'test' }))
}))

// Mock providerRegistry —— 避免 ai-provider 模块副作用
vi.mock('@shared/types/ai-provider', () => ({
  providerRegistry: {
    getOrCreate: () => ({}),
    setCurrent: () => {}
  }
}))

import { processAiChat, setAiConfig } from '@main/services/ai/index'

/** 构造 fake BrowserWindow，记录所有 webContents.send 调用 */
function makeFakeWin() {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => sent.push({ channel, payload })
    },
    isDestroyed: () => false
  }
  return { win, sent }
}

describe('processAiChat ReAct 多轮循环', () => {
  beforeEach(() => {
    callLlmMock.mockReset()
    executeToolMock.mockReset()
    executeToolMock.mockImplementation(async () => ({ result: 'mocked' }))
    setAiConfig({ provider: 'glm', apiKey: 'k', model: 'm' })
  })

  it('多轮 tool_calls 循环直到 LLM 返回纯文本', async () => {
    let callCount = 0
    callLlmMock.mockImplementation(async (_config, _messages, _tools, callbacks) => {
      callCount++
      if (callCount === 1) {
        // 第一轮：LLM 返回 tool_calls（OpenAI 格式，与 GLMProvider 实际行为一致）
        if (callbacks.onToolCalls) {
          await callbacks.onToolCalls([
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'list_nodes', arguments: '{}' }
            }
          ])
        }
        callbacks.onComplete('')
      } else {
        // 第二轮：LLM 返回纯文本
        callbacks.onChunk({ type: 'text', content: '规划完成' })
        callbacks.onComplete('规划完成')
      }
    })

    const { win } = makeFakeWin()
    await processAiChat('/test', '列出节点', win as any)

    // 关键断言：callLlm 被调用 2 次（多轮循环）
    expect(callCount).toBe(2)
    // query 类工具应被执行
    expect(executeToolMock).toHaveBeenCalledTimes(1)
  })

  it('超过 MAX_ROUNDS 时中断并发出错误事件', async () => {
    // 每轮都返回 tool_calls，模拟死循环
    callLlmMock.mockImplementation(async (_config, _messages, _tools, callbacks) => {
      if (callbacks.onToolCalls) {
        await callbacks.onToolCalls([
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'list_nodes', arguments: '{}' }
          }
        ])
      }
      callbacks.onComplete('')
    })

    const { win, sent } = makeFakeWin()
    await processAiChat('/test', '死循环测试', win as any)

    const errorEvents = sent.filter(
      (e) => e.channel === 'ai:error' || e.channel === 'error'
    )
    expect(errorEvents.length).toBeGreaterThan(0)
  })
})
