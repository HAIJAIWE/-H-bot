import { describe, it, expect } from 'vitest'
import type { NodeSpecV2, PortSpec, HandlerRef } from '@shared/types/nodeV2'

describe('NodeSpecV2 类型', () => {
  it('可以构造完整节点', () => {
    const spec: NodeSpecV2 = {
      kind: 'send_message',
      type: 'action',
      label: '发消息',
      group: '动作',
      icon: '✉️',
      description: '发送文本消息',
      summary: '向当前会话发送一条文本消息，适用于回复用户或主动通知',
      sideEffects: ['send_message'],
      tags: ['消息', '回复', '动作'],
      handler: { source: 'builtin', module: 'send_message' },
      exposedAsTool: true,
      toolName: '发消息',
      toolArgs: ['text'],
      defaultConfig: { message: '' },
      inputs: [
        { id: 'in', name: '入口', kind: 'control' },
        { id: 'text', name: '文本', kind: 'data', dataType: 'string', required: true, description: '要发送的文本内容' }
      ],
      outputs: [{ id: 'out', name: '出口', kind: 'control' }]
    }
    expect(spec.kind).toBe('send_message')
    expect(spec.handler.source).toBe('builtin')
    expect(spec.exposedAsTool).toBe(true)
  })

  it('HandlerRef 支持三种来源', () => {
    const builtin: HandlerRef = { source: 'builtin', module: 'send_message' }
    const custom: HandlerRef = { source: 'custom', funcName: 'query_level' }
    const ai: HandlerRef = { source: 'ai_generated', code: 'await bot.send(event, "hi")' }
    expect(builtin.source).toBe('builtin')
    expect(custom.source).toBe('custom')
    expect(ai.source).toBe('ai_generated')
  })
})
