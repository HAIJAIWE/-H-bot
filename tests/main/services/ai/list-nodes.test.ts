// tests/main/services/ai/list-nodes.test.ts
import { describe, it, expect } from 'vitest'
import { executeTool } from '@main/services/ai/tools'
import { registerAllBuiltinNodes } from '@main/nodes/builtin'
import { getNodeRegistry } from '@main/nodes/registry'

describe('list_nodes 工具', () => {
  it('返回所有内置节点列表', async () => {
    registerAllBuiltinNodes(getNodeRegistry())
    const res = await executeTool({ id: 't1', name: 'list_nodes', args: {} }, '/test')
    const nodes = res.result as any[]
    expect(nodes).toBeInstanceOf(Array)
    expect(nodes.length).toBeGreaterThan(10)
    // 每个节点含 kind/label/summary
    const first = nodes[0]
    expect(first.kind).toBeTruthy()
    expect(first.label).toBeTruthy()
    expect(first.summary).toBeTruthy()
  })

  it('包含 exposedAsTool 字段', async () => {
    registerAllBuiltinNodes(getNodeRegistry())
    const res = await executeTool({ id: 't2', name: 'list_nodes', args: {} }, '/test')
    const nodes = res.result as any[]
    const sendMsg = nodes.find((n) => n.kind === 'message_send')
    expect(sendMsg).toBeDefined()
    expect(sendMsg.exposedAsTool).toBeDefined()
  })
})
