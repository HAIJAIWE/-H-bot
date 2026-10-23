// tests/main/services/ai/integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted 保证 mock 引用在 vi.mock 工厂中可用
const { callLlmMock, executeToolMock } = vi.hoisted(() => ({
  callLlmMock: vi.fn(),
  executeToolMock: vi.fn()
}))

// Mock callLlm —— 控制多轮返回，避免真实网络调用
vi.mock('@main/services/ai/llm', () => ({
  callLlm: callLlmMock
}))

// Mock executeTool —— 保留 ALL_TOOL_DEFINITIONS / getToolCategory，仅替换执行器
vi.mock('@main/services/ai/tools', async (importOriginal) => {
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

describe('AI 全链路集成', () => {
  beforeEach(() => {
    callLlmMock.mockReset()
    executeToolMock.mockReset()
    executeToolMock.mockImplementation(async () => ({ result: 'mocked' }))
    setAiConfig({ provider: 'glm', apiKey: 'k', model: 'm' })
  })

  it('用户说"做复读机" → AI 生成 proposal → 包含 on_message + send_message + connect_nodes', async () => {
    let callCount = 0
    callLlmMock.mockImplementation(async (_config, _messages, _tools, callbacks) => {
      callCount++
      if (callCount === 1) {
        // 第一轮：LLM 返回 3 个 tool_calls（OpenAI 格式，与 GLMProvider 实际行为一致）
        // 工具名用 connect_nodes（与 tools.ts 定义一致，不是 connect）
        if (callbacks.onToolCalls) {
          await callbacks.onToolCalls([
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'add_node',
                arguments:
                  '{"nodeKind":"on_message","tempRef":"new_trigger","label":"收到消息"}'
              }
            },
            {
              id: 'c2',
              type: 'function',
              function: {
                name: 'add_node',
                arguments:
                  '{"nodeKind":"send_message","tempRef":"new_action","label":"发消息","config":{"message":"hi"}}'
              }
            },
            {
              id: 'c3',
              type: 'function',
              function: {
                name: 'connect_nodes',
                arguments:
                  '{"sourceRef":"new_trigger","sourcePortId":"out","targetRef":"new_action","targetPortId":"in"}'
              }
            }
          ])
        }
        callbacks.onComplete('')
      } else {
        // 第二轮：LLM 返回纯文本，循环结束
        callbacks.onChunk({ type: 'text', content: '已为您创建复读机流程' })
        callbacks.onComplete('已为您创建复读机流程')
      }
    })

    const { win, sent } = makeFakeWin()
    await processAiChat('/test', '帮我做个复读机', win as any)

    // 关键断言：callLlm 被调用 2 次（tool_calls 一轮 + 纯文本一轮）
    expect(callCount).toBe(2)

    // mutation 类工具不会被 executeTool 执行（累积到 Proposal）
    expect(executeToolMock).not.toHaveBeenCalled()

    // 验证 ai:proposal 事件被发送
    const proposalEvents = sent.filter((e) => e.channel === 'ai:proposal')
    expect(proposalEvents).toHaveLength(1)

    const proposal = (proposalEvents[0].payload as { proposal: { operations: unknown[] } }).proposal
    expect(proposal).toBeTruthy()
    expect(proposal.operations).toHaveLength(3)

    // 第 1 个 operation：add_node on_message
    expect(proposal.operations[0]).toMatchObject({
      kind: 'add_node',
      nodeKind: 'on_message',
      tempRef: 'new_trigger'
    })

    // 第 2 个 operation：add_node send_message
    expect(proposal.operations[1]).toMatchObject({
      kind: 'add_node',
      nodeKind: 'send_message',
      tempRef: 'new_action'
    })

    // 第 3 个 operation：connect new_trigger → new_action
    expect(proposal.operations[2]).toMatchObject({
      kind: 'connect',
      sourceRef: 'new_trigger',
      targetRef: 'new_action'
    })
  })

  it('纯文本回复（无 tool_calls）→ 发送 ai:response，不发送 ai:proposal', async () => {
    callLlmMock.mockImplementation(async (_config, _messages, _tools, callbacks) => {
      callbacks.onChunk({ type: 'text', content: '你好' })
      callbacks.onComplete('你好')
    })

    const { win, sent } = makeFakeWin()
    await processAiChat('/test', '你好', win as any)

    const proposalEvents = sent.filter((e) => e.channel === 'ai:proposal')
    const responseEvents = sent.filter((e) => e.channel === 'ai:response')

    expect(proposalEvents).toHaveLength(0)
    expect(responseEvents).toHaveLength(1)
    expect((responseEvents[0].payload as { message: string }).message).toBe('你好')
  })

  it('ai:* 事件携带 projectPath 字段（多项目不串台）', async () => {
    callLlmMock.mockImplementation(async (_config, _messages, _tools, callbacks) => {
      callbacks.onChunk({ type: 'text', content: '你好' })
      callbacks.onComplete('你好')
    })

    const { win, sent } = makeFakeWin()
    await processAiChat('/my/project', '你好', win as any)

    // ai:chunk、ai:response、ai:agentState 都应带 projectPath
    const chunkEvents = sent.filter((e) => e.channel === 'ai:chunk')
    const responseEvents = sent.filter((e) => e.channel === 'ai:response')
    const stateEvents = sent.filter((e) => e.channel === 'ai:agentState')

    for (const e of chunkEvents) {
      expect((e.payload as { projectPath?: string }).projectPath).toBe('/my/project')
    }
    for (const e of responseEvents) {
      expect((e.payload as { projectPath?: string }).projectPath).toBe('/my/project')
    }
    for (const e of stateEvents) {
      expect((e.payload as { projectPath?: string }).projectPath).toBe('/my/project')
    }
  })

  it('processAiChat 顶层异常时发送 ai:error + ai:agentState idle（不卡死）', async () => {
    callLlmMock.mockRejectedValue(new Error('网络炸了'))

    const { win, sent } = makeFakeWin()
    await processAiChat('/test', '你好', win as any)

    const errorEvents = sent.filter((e) => e.channel === 'ai:error')
    const stateEvents = sent.filter((e) => e.channel === 'ai:agentState')

    expect(errorEvents.length).toBeGreaterThan(0)
    expect((errorEvents[0].payload as { message: string }).message).toContain('网络炸了')
    // finally 必须发 idle
    expect(stateEvents.some((e) => (e.payload as { state: string }).state === 'idle')).toBe(true)
  })
})
