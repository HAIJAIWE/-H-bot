// tests/renderer/stores/flowStore.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useFlowStore } from '@renderer/stores/flowStore'
import { createNode } from '@renderer/lib/nodeFactory'

beforeEach(() => {
  useFlowStore.getState().reset()
})

describe('flowStore', () => {
  it('初始状态为空', () => {
    const s = useFlowStore.getState()
    expect(s.nodes).toHaveLength(0)
    expect(s.edges).toHaveLength(0)
    expect(s.selectedNodeId).toBeNull()
  })

  it('添加节点', () => {
    const node = createNode('message_received', { x: 100, y: 100 })
    useFlowStore.getState().addNode(node)
    expect(useFlowStore.getState().nodes).toHaveLength(1)
  })

  it('删除节点同时删除相关边', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.addNode(n2)
    store.addEdge({
      id: 'e1',
      source: n1.id,
      sourcePort: 'next',
      target: n2.id,
      targetPort: 'in'
    })
    store.removeNode(n1.id)
    const s = useFlowStore.getState()
    expect(s.nodes).toHaveLength(1)
    expect(s.edges).toHaveLength(0)
  })

  it('选中节点', () => {
    const node = createNode('message_received', { x: 0, y: 0 })
    useFlowStore.getState().addNode(node)
    useFlowStore.getState().selectNode(node.id)
    expect(useFlowStore.getState().selectedNodeId).toBe(node.id)
  })

  it('更新节点配置', () => {
    const node = createNode('message_received', { x: 0, y: 0 })
    useFlowStore.getState().addNode(node)
    useFlowStore.getState().updateNodeConfig(node.id, { command: 'ping' })
    const updated = useFlowStore.getState().nodes[0]
    expect(updated.data.config.command).toBe('ping')
  })

  it('导出 FlowGraph', () => {
    const node = createNode('message_received', { x: 0, y: 0 })
    useFlowStore.getState().addNode(node)
    const graph = useFlowStore.getState().exportGraph()
    expect(graph.nodes).toHaveLength(1)
    expect(graph.metadata.runtime).toBe('typescript')
  })
})

// 阶段 6：highlightNodes 行为测试
describe('flowStore.highlightNodes', () => {
  beforeEach(() => {
    useFlowStore.getState().reset()
  })

  afterEach(() => {
    // 恢复真实定时器，避免影响后续测试
    vi.useRealTimers()
  })

  it('调用 highlightNodes 后 highlightedNodeIds 立即更新', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.addNode(n2)

    store.highlightNodes([n1.id, n2.id])
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set([n1.id, n2.id]))
  })

  it('3 秒后自动清除 highlightedNodeIds', () => {
    vi.useFakeTimers()
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)

    store.highlightNodes([n1.id])
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set([n1.id]))

    // 推进 3 秒，setTimeout 触发自动清除
    vi.advanceTimersByTime(3000)
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set())
  })

  it('多次调用 highlightNodes 只保留最后一次的 IDs', () => {
    vi.useFakeTimers()
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const n3 = createNode('branch_if', { x: 400, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.addNode(n2)
    store.addNode(n3)

    // 第一次调用
    store.highlightNodes([n1.id])
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set([n1.id]))

    // 第二次调用（仅 1 秒后，第一次的 setTimeout 还没触发）
    vi.advanceTimersByTime(1000)
    store.highlightNodes([n2.id, n3.id])
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set([n2.id, n3.id]))

    // 再推进 2 秒（累计 3 秒），第一次的 setTimeout 触发但其判断条件已不满足
    // （当前 highlightedNodeIds 是 [n2.id, n3.id] !== [n1.id]），不会误清
    vi.advanceTimersByTime(2000)
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set([n2.id, n3.id]))

    // 再推进 1 秒，第二次的 setTimeout 触发（共 4 秒后），清除最后一次的 IDs
    vi.advanceTimersByTime(1000)
    expect(useFlowStore.getState().highlightedNodeIds).toEqual(new Set())
  })
})
