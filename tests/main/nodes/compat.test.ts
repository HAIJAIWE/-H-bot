import { describe, it, expect } from 'vitest'
import { toNodeSpecV2 } from '@main/nodes/compat'
import type { NodeSpec } from '@shared/types/flow'

describe('toNodeSpecV2 兼容转换', () => {
  it('把旧 NodeSpec 转为 v2，填充默认 AI 字段', () => {
    const oldSpec: NodeSpec = {
      kind: 'send_message',
      type: 'action',
      label: '发消息',
      group: '动作',
      icon: '✉️',
      description: '发送文本消息',
      defaultConfig: { message: '' },
      inputs: [{ id: 'in', name: 'in', kind: 'control' }],
      outputs: [{ id: 'out', name: 'out', kind: 'control' }]
    }
    const v2 = toNodeSpecV2(oldSpec)
    expect(v2.kind).toBe('send_message')
    expect(v2.summary).toBe('发送文本消息')  // 默认用 description
    expect(v2.sideEffects).toEqual([])
    expect(v2.tags).toEqual([])
    expect(v2.handler.source).toBe('builtin')
    // HandlerRef 是 discriminated union，需先收窄类型再访问 module 字段
    if (v2.handler.source === 'builtin') {
      expect(v2.handler.module).toBe('send_message')
    }
    expect(v2.exposedAsTool).toBe(false)
  })

  it('保留旧 Port 字段，补充默认 required/description', () => {
    const oldSpec: NodeSpec = {
      kind: 'test',
      type: 'action',
      label: '测试',
      group: '动作',
      icon: 'T',
      description: '测试节点',
      defaultConfig: {},
      inputs: [{ id: 'text', name: '文本', kind: 'data', dataType: 'string' }],
      outputs: []
    }
    const v2 = toNodeSpecV2(oldSpec)
    expect(v2.inputs[0].required).toBe(false)
    expect(v2.inputs[0].description).toBe('')
  })

  it('plugin 类型转为 custom', () => {
    const oldSpec: NodeSpec = {
      kind: 'plugin_test',
      type: 'plugin',
      label: '插件节点',
      group: '插件',
      icon: 'P',
      description: '插件',
      defaultConfig: {},
      inputs: [],
      outputs: []
    }
    const v2 = toNodeSpecV2(oldSpec)
    expect(v2.type).toBe('custom')
  })
})
