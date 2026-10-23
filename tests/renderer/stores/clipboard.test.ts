// tests/renderer/stores/clipboard.test.ts
// 阶段 8 Part B3：节点复制粘贴剪贴板测试
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useFlowStore } from '@renderer/stores/flowStore'
import { createNode, createEdge } from '@renderer/lib/nodeFactory'

// highlightNodes 内部用 setTimeout，测试中 mock 避免 3 秒延迟
beforeEach(() => {
  vi.useFakeTimers()
  useFlowStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('flowStore clipboard', () => {
  it('初始 clipboard 为 null', () => {
    expect(useFlowStore.getState().clipboard).toBeNull()
  })

  it('copySelectedNodes：多选节点复制到 clipboard', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2)
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    useFlowStore.getState().copySelectedNodes()
    const clip = useFlowStore.getState().clipboard
    expect(clip).not.toBeNull()
    expect(clip!.nodes).toHaveLength(2)
    expect(clip!.nodes.map((n: { data: { nodeKind: string } }) => n.data.nodeKind)).toContain('message_received')
    expect(clip!.nodes.map((n: { data: { nodeKind: string } }) => n.data.nodeKind)).toContain('message_send')
  })

  it('copySelectedNodes：单选节点也能复制', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.selectNode(n1.id)
    useFlowStore.getState().copySelectedNodes()
    const clip = useFlowStore.getState().clipboard
    expect(clip).not.toBeNull()
    expect(clip!.nodes).toHaveLength(1)
    expect(clip!.nodes[0].id).toBe(n1.id)
  })

  it('copySelectedNodes：空选时不操作', () => {
    useFlowStore.getState().copySelectedNodes()
    expect(useFlowStore.getState().clipboard).toBeNull()
  })

  it('copySelectedNodes：内部边一起复制', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const n3 = createNode('branch_if', { x: 400, y: 0 })  // 不选中
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    store.addEdge(createEdge(n1.id, 'next', n2.id, 'in'))
    store.addEdge(createEdge(n2.id, 'out', n3.id, 'in'))  // 跨边界，不复制
    // 多选 n1, n2
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    useFlowStore.getState().copySelectedNodes()
    const clip = useFlowStore.getState().clipboard
    expect(clip!.edges).toHaveLength(1)  // 只复制 n1→n2 内部边
    expect(clip!.edges[0].source).toBe(n1.id)
    expect(clip!.edges[0].target).toBe(n2.id)
  })

  it('pasteNodes：空 clipboard 返回空数组', () => {
    const result = useFlowStore.getState().pasteNodes()
    expect(result).toEqual([])
  })

  it('pasteNodes：ID 重新分配（不与原节点冲突）', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.selectNode(n1.id)
    store.copySelectedNodes()
    const result = useFlowStore.getState().pasteNodes()
    expect(result).toHaveLength(1)
    expect(result[0]).not.toBe(n1.id)  // 新 ID
  })

  it('pasteNodes：位置偏移 +40,+40', () => {
    const n1 = createNode('message_received', { x: 100, y: 200 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.selectNode(n1.id)
    store.copySelectedNodes()
    useFlowStore.getState().pasteNodes()
    const pastedNode = useFlowStore.getState().nodes.find((n) => n.id !== n1.id)
    expect(pastedNode!.position.x).toBe(140)
    expect(pastedNode!.position.y).toBe(240)
  })

  it('pasteNodes：边 source/target 重映射到新 ID', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2)
    store.addEdge(createEdge(n1.id, 'next', n2.id, 'in'))
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    store.copySelectedNodes()
    useFlowStore.getState().pasteNodes()
    const allNodes = useFlowStore.getState().nodes
    const allEdges = useFlowStore.getState().edges
    // 原 2 节点 + 粘贴 2 节点 = 4
    expect(allNodes).toHaveLength(4)
    // 原 1 边 + 粘贴 1 边 = 2
    expect(allEdges).toHaveLength(2)
    // 粘贴的边 source/target 应是新节点 ID
    const pastedNodeIds = allNodes.filter((n) => n.id !== n1.id && n.id !== n2.id).map((n) => n.id)
    const pastedEdge = allEdges.find((e) => pastedNodeIds.includes(e.source) && pastedNodeIds.includes(e.target))
    expect(pastedEdge).toBeDefined()
  })

  it('pasteNodes：保留 label 和 config', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    n1.data.label = '我的触发器'
    n1.data.config = { match: 'command', command: 'ping', message_type: 'any' }
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.selectNode(n1.id)
    store.copySelectedNodes()
    useFlowStore.getState().pasteNodes()
    const pastedNode = useFlowStore.getState().nodes.find((n) => n.id !== n1.id)
    expect(pastedNode!.data.label).toBe('我的触发器')
    expect(pastedNode!.data.config).toEqual({ match: 'command', command: 'ping', message_type: 'any' })
  })

  it('pasteNodes：多次粘贴生成多份副本且位置递增不重叠', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.selectNode(n1.id)
    store.copySelectedNodes()
    useFlowStore.getState().pasteNodes()
    useFlowStore.getState().pasteNodes()
    // 原 1 + 粘贴 2 = 3
    const nodes = useFlowStore.getState().nodes
    expect(nodes).toHaveLength(3)
    // 原节点 (0,0)，第一次粘贴 (40,40)，第二次粘贴 (80,80) — 位置递增不重叠
    const pasted = nodes.filter((n) => n.id !== n1.id)
    expect(pasted[0].position).toEqual({ x: 40, y: 40 })
    expect(pasted[1].position).toEqual({ x: 80, y: 80 })
  })

  it('reset 清空 clipboard', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.selectNode(n1.id)
    store.copySelectedNodes()
    expect(useFlowStore.getState().clipboard).not.toBeNull()
    useFlowStore.getState().reset()
    expect(useFlowStore.getState().clipboard).toBeNull()
  })
})
