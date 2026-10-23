// tests/shared/types/ai-provider-toolcalls.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GLMProvider, OpenAICompatibleProvider as OpenAIProvider } from '@shared/types/ai-provider'

// 构造 mock 流式响应（模拟 OpenAI/GLM 分片返回 tool_calls）
function makeStreamChunks() {
  return [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'add_node', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"nodeKind":"on_' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'message"}' } }] } }] },
    { choices: [{ delta: {} }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  ]
}

/** 构造 mock reader：按顺序返回 chunks */
function makeReader(chunks: unknown[]) {
  let i = 0
  return {
    read: async () => {
      if (i >= chunks.length) return { done: true, value: undefined }
      const chunk = chunks[i++]
      return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`) }
    }
  }
}

/** 构造空流 reader（用于消息格式测试，只关心请求体） */
function makeEmptyReader() {
  return {
    read: async () => ({ done: true, value: undefined })
  }
}

describe('GLMProvider tool_calls 解析', () => {
  afterEach(() => vi.restoreAllMocks())

  it('正确拼接分片 tool_calls', async () => {
    const provider = new GLMProvider({ provider: 'glm', apiKey: 'test', model: 'glm-4' })
    const mockResponse = {
      ok: true,
      body: { getReader: () => makeReader(makeStreamChunks()) }
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any)

    let capturedToolCalls: any[] = []
    await provider.chat(
      [{ role: 'user', content: '加个节点' }],
      [],
      {
        onChunk: () => {},
        onToolCalls: async (toolCalls) => { capturedToolCalls = toolCalls },
        onComplete: () => {}
      }
    )

    expect(capturedToolCalls).toHaveLength(1)
    expect(capturedToolCalls[0].id).toBe('call_1')
    expect(capturedToolCalls[0].function.name).toBe('add_node')
    expect(capturedToolCalls[0].function.arguments).toBe('{"nodeKind":"on_message"}')
  })

  it('provider 每片重发全名时不重复拼接（name 累加 bug 修复）', async () => {
    const provider = new GLMProvider({ provider: 'glm', apiKey: 'test', model: 'glm-4' })
    // 模拟某些 provider 每个分片都带完整 name
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_nodes', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'list_nodes', arguments: '{}' } }] } }] },
      { choices: [{ delta: {} }] }
    ]
    const mockResponse = {
      ok: true,
      body: { getReader: () => makeReader(chunks) }
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any)

    let capturedToolCalls: any[] = []
    await provider.chat(
      [{ role: 'user', content: '列出节点' }],
      [],
      {
        onChunk: () => {},
        onToolCalls: async (toolCalls) => { capturedToolCalls = toolCalls },
        onComplete: () => {}
      }
    )

    expect(capturedToolCalls).toHaveLength(1)
    // 不应是 'list_nodeslist_nodes'
    expect(capturedToolCalls[0].function.name).toBe('list_nodes')
  })

  it('provider 不发送 index 字段时使用 size 作为 fallback', async () => {
    const provider = new GLMProvider({ provider: 'glm', apiKey: 'test', model: 'glm-4' })
    // 两个 tool_call 都没有 index 字段
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ id: 'call_1', function: { name: 'list_nodes', arguments: '{}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'call_2', function: { name: 'read_flow', arguments: '{}' } }] } }] },
      { choices: [{ delta: {} }] }
    ]
    const mockResponse = {
      ok: true,
      body: { getReader: () => makeReader(chunks) }
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any)

    let capturedToolCalls: any[] = []
    await provider.chat(
      [{ role: 'user', content: '列两个' }],
      [],
      {
        onChunk: () => {},
        onToolCalls: async (toolCalls) => { capturedToolCalls = toolCalls },
        onComplete: () => {}
      }
    )

    // 两个 tool_call 都应被捕获，而不是都存入 key undefined 互相覆盖
    expect(capturedToolCalls).toHaveLength(2)
    const names = capturedToolCalls.map((tc) => tc.function.name).sort()
    expect(names).toEqual(['list_nodes', 'read_flow'])
  })
})

describe('多轮对话消息格式（tool_calls/toolResult 保留）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('GLMProvider 保留 assistant 的 tool_calls 和 user 的 tool 结果', async () => {
    const provider = new GLMProvider({ provider: 'glm', apiKey: 'test', model: 'glm-4' })
    let capturedBody: any
    const mockResponse = {
      ok: true,
      body: { getReader: () => makeEmptyReader() }
    }
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse((options as RequestInit).body as string)
      return mockResponse as any
    })

    await provider.chat(
      [
        { role: 'user', content: '加个节点' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'add_node', args: { nodeKind: 'on_message' } }]
        },
        { role: 'user', content: '', toolResult: '{"ok": true}' }
      ],
      [],
      { onChunk: () => {}, onComplete: () => {} }
    )

    // assistant 消息应保留 tool_calls（OpenAI 格式）
    const assistantMsg = capturedBody.messages[1]
    expect(assistantMsg.role).toBe('assistant')
    expect(assistantMsg.tool_calls).toHaveLength(1)
    expect(assistantMsg.tool_calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'add_node', arguments: '{"nodeKind":"on_message"}' }
    })

    // tool 结果消息应转为 role='tool'
    const toolMsg = capturedBody.messages[2]
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.tool_call_id).toBe('call_1')
    expect(toolMsg.content).toBe('{"ok": true}')
  })

  it('OpenAIProvider 保留 assistant 的 tool_calls 和 user 的 tool 结果', async () => {
    const provider = new OpenAIProvider({ provider: 'openai', apiKey: 'test', model: 'gpt-4' })
    let capturedBody: any
    const mockResponse = {
      ok: true,
      body: { getReader: () => makeEmptyReader() }
    }
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse((options as RequestInit).body as string)
      return mockResponse as any
    })

    await provider.chat(
      [
        { role: 'user', content: '加个节点' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'list_nodes', args: {} }]
        },
        { role: 'user', content: '', toolResult: '{"nodes": []}' }
      ],
      [],
      { onChunk: () => {}, onComplete: () => {} }
    )

    const assistantMsg = capturedBody.messages[1]
    expect(assistantMsg.role).toBe('assistant')
    expect(assistantMsg.tool_calls).toHaveLength(1)
    expect(assistantMsg.tool_calls[0].function.name).toBe('list_nodes')

    const toolMsg = capturedBody.messages[2]
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.tool_call_id).toBe('call_1')
    expect(toolMsg.content).toBe('{"nodes": []}')
  })

  it('无 toolCalls/toolResult 的普通消息不受影响', async () => {
    const provider = new GLMProvider({ provider: 'glm', apiKey: 'test', model: 'glm-4' })
    let capturedBody: any
    const mockResponse = {
      ok: true,
      body: { getReader: () => makeEmptyReader() }
    }
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse((options as RequestInit).body as string)
      return mockResponse as any
    })

    await provider.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' }
      ],
      [],
      { onChunk: () => {}, onComplete: () => {} }
    )

    expect(capturedBody.messages).toHaveLength(3)
    expect(capturedBody.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(capturedBody.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(capturedBody.messages[2]).toEqual({ role: 'assistant', content: 'hello' })
    // 普通消息不应有 tool_calls 字段
    expect(capturedBody.messages[2].tool_calls).toBeUndefined()
  })
})
