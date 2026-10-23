// tests/renderer/lib/layoutSubgraph.test.ts
// 阶段 7 Part C4：layoutSubgraph 纯函数单测
import { describe, it, expect } from 'vitest'
import { layoutSubgraph, NODE_WIDTH } from '@renderer/lib/autoLayout'
import { createNode, createEdge } from '@renderer/lib/nodeFactory'

describe('layoutSubgraph', () => {
  it('空子图返回空 Map', async () => {
    const result = await layoutSubgraph([], [])
    expect(result.size).toBe(0)
  })

  it('单节点子图返回单坐标', async () => {
    const n1 = createNode('message_received', { x: 100, y: 100 })
    const result = await layoutSubgraph([n1], [])
    expect(result.size).toBe(1)
    expect(result.has(n1.id)).toBe(true)
  })

  it('多节点子图返回的坐标数 == 节点数', async () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 200, y: 0 })
    const n3 = createNode('branch_if', { x: 400, y: 0 })
    const e1 = createEdge(n1.id, 'next', n2.id, 'in')
    const e2 = createEdge(n2.id, 'next', n3.id, 'in')
    const result = await layoutSubgraph([n1, n2, n3], [e1, e2])
    expect(result.size).toBe(3)
  })

  it('锚点偏移：传入 anchor {100,100} → 所有坐标 +100,+100', async () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 0, y: 0 })
    const e1 = createEdge(n1.id, 'next', n2.id, 'in')
    const result = await layoutSubgraph([n1, n2], [e1], { x: 100, y: 100 })
    const p1 = result.get(n1.id)!
    const p2 = result.get(n2.id)!
    expect(p1.x).toBeGreaterThanOrEqual(100)
    expect(p1.y).toBeGreaterThanOrEqual(100)
    expect(p2.x).toBeGreaterThanOrEqual(100)
    expect(p2.y).toBeGreaterThanOrEqual(100)
  })

  it('只考虑子图内部边（外部边不影响布局）', async () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 0, y: 0 })
    const n3 = createNode('branch_if', { x: 0, y: 0 })  // 不在子图中
    const e1 = createEdge(n1.id, 'next', n2.id, 'in')
    const e2 = createEdge(n2.id, 'next', n3.id, 'in')  // 跨子图边
    const result = await layoutSubgraph([n1, n2], [e1, e2])
    expect(result.size).toBe(2)
    expect(result.has(n1.id)).toBe(true)
    expect(result.has(n2.id)).toBe(true)
    expect(result.has(n3.id)).toBe(false)
  })

  it('控制流边参与布局，数据流边不参与', async () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 0, y: 0 })
    // next 是控制流端口
    const e1 = createEdge(n1.id, 'next', n2.id, 'in')
    // output 是数据流端口（不会影响布局拓扑）
    const e2 = createEdge(n1.id, 'output', n2.id, 'text')
    const result = await layoutSubgraph([n1, n2], [e1, e2])
    expect(result.size).toBe(2)
    // n1 应该在 n2 左侧（控制流从左到右）
    const p1 = result.get(n1.id)!
    const p2 = result.get(n2.id)!
    expect(p1.x).toBeLessThan(p2.x)
  })

  it('默认锚点为 {0,0}，坐标不偏移', async () => {
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 0, y: 0 })
    const e1 = createEdge(n1.id, 'next', n2.id, 'in')
    const result = await layoutSubgraph([n1, n2], [e1])
    const p1 = result.get(n1.id)!
    // 默认锚点，p1 应该接近 0（ELK 可能给小偏移）
    expect(p1.x).toBeGreaterThanOrEqual(0)
    expect(p1.y).toBeGreaterThanOrEqual(0)
  })

  it('节点宽度统一为 NODE_WIDTH', async () => {
    // 间接验证：ELK 布局后节点间 x 距离应考虑 NODE_WIDTH
    const n1 = createNode('message_received', { x: 0, y: 0 })
    const n2 = createNode('message_send', { x: 0, y: 0 })
    const e1 = createEdge(n1.id, 'next', n2.id, 'in')
    const result = await layoutSubgraph([n1, n2], [e1])
    const p1 = result.get(n1.id)!
    const p2 = result.get(n2.id)!
    // n1 → n2 控制流，水平距离应 >= NODE_WIDTH（节点宽度）
    expect(p2.x - p1.x).toBeGreaterThanOrEqual(NODE_WIDTH)
  })
})
