// tests/renderer/stores/multiSelect.test.ts
// 阶段 8 Part A4：多节点选择机制测试
import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@renderer/stores/flowStore'
import { createNode } from '@renderer/lib/nodeFactory'

beforeEach(() => {
  useFlowStore.getState().reset()
})

describe('flowStore multiSelect', () => {
  it('初始 selectedNodeIds 为空数组', () => {
    expect(useFlowStore.getState().selectedNodeIds).toEqual([])
  })

  it('toggleMultiSelect 添加节点到多选集合', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.toggleMultiSelect(n1.id)
    expect(useFlowStore.getState().selectedNodeIds).toEqual([n1.id])
  })

  it('toggleMultiSelect 再次切换移除节点', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n1.id)
    expect(useFlowStore.getState().selectedNodeIds).toEqual([])
  })

  it('toggleMultiSelect 多个节点依次添加', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const n3 = createNode('branch_if', { x: 400, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    store.toggleMultiSelect(n3.id)
    expect(useFlowStore.getState().selectedNodeIds).toEqual([n1.id, n2.id, n3.id])
  })

  it('toggleMultiSelect 移除中间节点保持顺序', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const n3 = createNode('branch_if', { x: 400, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    store.toggleMultiSelect(n3.id)
    // 移除中间的 n2
    store.toggleMultiSelect(n2.id)
    expect(useFlowStore.getState().selectedNodeIds).toEqual([n1.id, n3.id])
  })

  it('clearMultiSelect 清空多选集合', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2)
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    expect(useFlowStore.getState().selectedNodeIds).toHaveLength(2)
    useFlowStore.getState().clearMultiSelect()
    expect(useFlowStore.getState().selectedNodeIds).toEqual([])
  })

  it('多选不影响 selectedNodeId 单选状态', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2)
    // 单选 n1
    store.selectNode(n1.id)
    // 多选 n2（不影响 selectedNodeId）
    store.toggleMultiSelect(n2.id)
    // 重新读取 store 避免 stale 引用
    const fresh = useFlowStore.getState()
    expect(fresh.selectedNodeId).toBe(n1.id)
    expect(fresh.selectedNodeIds).toEqual([n2.id])
  })

  it('selectNode 切换单选时清空多选集合', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const n3 = createNode('branch_if', { x: 400, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2); store.addNode(n3)
    // 先多选 n1, n2
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    expect(useFlowStore.getState().selectedNodeIds).toHaveLength(2)
    // 单选 n3 → 多选应清空
    store.selectNode(n3.id)
    expect(useFlowStore.getState().selectedNodeIds).toEqual([])
    expect(useFlowStore.getState().selectedNodeId).toBe(n3.id)
  })

  it('reset 清空多选集合', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1)
    store.toggleMultiSelect(n1.id)
    expect(useFlowStore.getState().selectedNodeIds).toHaveLength(1)
    useFlowStore.getState().reset()
    expect(useFlowStore.getState().selectedNodeIds).toEqual([])
  })

  it('removeNodes 移除多选中的节点', () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const store = useFlowStore.getState()
    store.addNode(n1); store.addNode(n2)
    store.toggleMultiSelect(n1.id)
    store.toggleMultiSelect(n2.id)
    // 删除 n1
    useFlowStore.getState().removeNodes([n1.id])
    expect(useFlowStore.getState().selectedNodeIds).toEqual([n2.id])
  })
})
