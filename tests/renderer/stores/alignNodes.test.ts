// tests/renderer/stores/alignNodes.test.ts
// 阶段 8 打磨 #5：多选对齐工具测试
import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@renderer/stores/flowStore'
import { createNode } from '@renderer/lib/nodeFactory'

beforeEach(() => {
  useFlowStore.getState().reset()
})

describe('flowStore alignNodes', () => {
  it('少于 2 个节点不操作', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.alignNodes([n1.id], 'left')
    // 位置不变
    expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 100, y: 100 })
  })

  it('左对齐：所有节点 x = min(x)', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const n2 = createNode('message_send', { x: 300, y: 200 })
    const n3 = createNode('branch_if', { x: 50, y: 300 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    useFlowStore.getState().alignNodes([n1.id, n2.id, n3.id], 'left')
    const nodes = useFlowStore.getState().nodes
    expect(nodes[0].position.x).toBe(50)
    expect(nodes[1].position.x).toBe(50)
    expect(nodes[2].position.x).toBe(50)
    // y 不变
    expect(nodes[0].position.y).toBe(100)
    expect(nodes[1].position.y).toBe(200)
    expect(nodes[2].position.y).toBe(300)
  })

  it('右对齐：所有节点 x = max(x)', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const n2 = createNode('message_send', { x: 300, y: 200 })
    const n3 = createNode('branch_if', { x: 50, y: 300 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    useFlowStore.getState().alignNodes([n1.id, n2.id, n3.id], 'right')
    const nodes = useFlowStore.getState().nodes
    expect(nodes[0].position.x).toBe(300)
    expect(nodes[1].position.x).toBe(300)
    expect(nodes[2].position.x).toBe(300)
  })

  it('顶对齐：所有节点 y = min(y)', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const n2 = createNode('message_send', { x: 300, y: 200 })
    const n3 = createNode('branch_if', { x: 50, y: 50 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    useFlowStore.getState().alignNodes([n1.id, n2.id, n3.id], 'top')
    const nodes = useFlowStore.getState().nodes
    expect(nodes[0].position.y).toBe(50)
    expect(nodes[1].position.y).toBe(50)
    expect(nodes[2].position.y).toBe(50)
    // x 不变
    expect(nodes[0].position.x).toBe(100)
    expect(nodes[1].position.x).toBe(300)
    expect(nodes[2].position.x).toBe(50)
  })

  it('底对齐：所有节点 y = max(y)', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const n2 = createNode('message_send', { x: 300, y: 200 })
    const n3 = createNode('branch_if', { x: 50, y: 50 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    useFlowStore.getState().alignNodes([n1.id, n2.id, n3.id], 'bottom')
    const nodes = useFlowStore.getState().nodes
    expect(nodes[0].position.y).toBe(200)
    expect(nodes[1].position.y).toBe(200)
    expect(nodes[2].position.y).toBe(200)
  })

  it('只对齐传入的节点，不影响其他节点', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const n2 = createNode('message_send', { x: 300, y: 200 })
    const n3 = createNode('branch_if', { x: 500, y: 500 })  // 不参与对齐
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    useFlowStore.getState().alignNodes([n1.id, n2.id], 'left')
    const nodes = useFlowStore.getState().nodes
    expect(nodes[0].position.x).toBe(100)  // 对齐
    expect(nodes[1].position.x).toBe(100)  // 对齐
    expect(nodes[2].position.x).toBe(500)  // 不变
  })

  it('对齐支持撤销（pushHistory）', () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const n2 = createNode('message_send', { x: 300, y: 200 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2)
    // addNode 已 pushHistory，记录对齐前的历史快照
    useFlowStore.getState().alignNodes([n1.id, n2.id], 'left')
    // 对齐后 x 都变成 100
    expect(useFlowStore.getState().nodes[0].position.x).toBe(100)
    expect(useFlowStore.getState().nodes[1].position.x).toBe(100)
    // 撤销后恢复原位置
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().nodes[0].position.x).toBe(100)
    expect(useFlowStore.getState().nodes[1].position.x).toBe(300)
  })
})
