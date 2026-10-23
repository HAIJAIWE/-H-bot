// tests/renderer/lib/autoLayout.benchmark.test.ts
// 阶段 4：ELK 自动布局性能基线测量。
//
// 本测试是 informational（基线记录），不做严格阈值断言：
// - jsdom 环境下 ELK 比真实浏览器慢 3-5x（实测 10 节点 ~280ms vs 浏览器 ~80ms）
// - 浏览器环境的阈值（Stage 3 memo 的 <80ms）在 jsdom 下不适用
// - 严格阈值会因 CI 抖动频繁 false negative，掩盖真正的回归
//
// Worker 化决策准则（阶段 4 测量，阶段 5 决策）——基于人工观察 console.table 趋势：
// - 若 chainMs(50) 浏览器实测 < 100ms：维持现状，Worker 化不 justified（验证阶段 3 memo）
// - 若 chainMs(50) 浏览器实测 ∈ [100, 300]ms：边界，加 perf 监控，暂不 Worker 化
// - 若 chainMs(50) 浏览器实测 >= 300ms 或 chainMs(200) >= 1000ms：阶段 5 启动 Worker 化
//
// 注：jsdom 下测得的 ms 值需除以 3-5x 估算浏览器环境实际耗时。
//
// Worker 化实施前置条件（已具备）：
// - CSP 已允许 worker-src 'self' blob:（见 tests/main/csp.test.ts）
// - elkjs 支持 Worker 内 import（动态 import 在 Worker 内可用）
// - IPC 失败回退路径：Worker 超时 5s 后 fallback 到主线程 layoutFlow

import { describe, it, expect } from 'vitest'
import { layoutFlow } from '@renderer/lib/autoLayout'
import type { FlowNode, FlowEdge, Port } from '@shared/types/flow'

const controlIn: Port = { id: 'in', name: '入口', kind: 'control' }
const controlOut: Port = { id: 'next', name: '下一步', kind: 'control' }
const trueOut: Port = { id: 'true', name: '真分支', kind: 'control' }
const falseOut: Port = { id: 'false', name: '假分支', kind: 'control' }

/** 链式拓扑：n0 → n1 → ... → nN-1 */
function genChain(n: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  for (let i = 0; i < n; i++) {
    nodes.push({
      id: `n${i}`,
      type: i === 0 ? 'trigger' : 'action',
      position: { x: 0, y: 0 },
      data: {
        label: `n${i}`,
        nodeKind: i === 0 ? 'message_received' : 'message_send',
        config: {},
        inputs: i === 0 ? [] : [controlIn],
        outputs: [controlOut],
      },
    })
    if (i > 0) {
      edges.push({
        id: `e${i}`,
        source: `n${i - 1}`,
        sourcePort: 'next',
        target: `n${i}`,
        targetPort: 'in',
      })
    }
  }
  return { nodes, edges }
}

/** 树状拓扑：每层 branch_if 分 true/false 两条子链。
 *  深度 d → 节点数约 2^(d+1) - 1 */
function genTree(depth: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  let idCounter = 0

  function build(d: number, parentId: string | null, parentPort: string | null): string {
    const id = `n${idCounter++}`
    const isRoot = parentId === null
    const isLeaf = d === 0
    const inputs = isRoot ? [] : [controlIn]
    const outputs = isLeaf
      ? [controlOut]
      : [trueOut, falseOut]
    nodes.push({
      id,
      type: isRoot ? 'trigger' : isLeaf ? 'action' : 'logic',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        nodeKind: isLeaf ? 'message_send' : isRoot ? 'message_received' : 'branch_if',
        config: {},
        inputs,
        outputs,
      },
    })
    if (parentId !== null && parentPort !== null) {
      edges.push({ id: `e${id}`, source: parentId, sourcePort: parentPort, target: id, targetPort: 'in' })
    }
    if (!isLeaf) {
      build(d - 1, id, 'true')
      build(d - 1, id, 'false')
    }
    return id
  }

  build(depth, null, null)
  return { nodes, edges }
}

describe('autoLayout 性能基线', () => {
  const results: Array<{ topology: string; size: number; ms: number }> = []

  // 链式拓扑
  for (const n of [10, 50, 100, 200, 500]) {
    it(`链式 ${n} 节点布局耗时记录基线`, async () => {
      const { nodes, edges } = genChain(n)
      const t0 = performance.now()
      await layoutFlow(nodes, edges)
      const ms = performance.now() - t0
      results.push({ topology: 'chain', size: n, ms })

      // 软基线：仅断言"layoutFlow 完成且耗时为正数"（不死循环/不抛错）。
      // 不做严格阈值断言：jsdom 下 ELK 比浏览器慢 3-5x，浏览器阈值不适用。
      // 真正回归检测靠人工观察 console.table 趋势 + Worker 化决策准则（见头注释）。
      expect(ms).toBeGreaterThan(0)
    })
  }

  // 树状拓扑（branch_if 分叉）
  for (const depth of [2, 4, 6]) {
    const nodeCount = Math.pow(2, depth + 1) - 1
    it(`树状 depth=${depth}（约 ${nodeCount} 节点）布局耗时记录基线`, async () => {
      const { nodes, edges } = genTree(depth)
      const t0 = performance.now()
      await layoutFlow(nodes, edges)
      const ms = performance.now() - t0
      results.push({ topology: 'tree', size: nodes.length, ms })

      // 软基线：同链式拓扑，jsdom 容差不适用浏览器阈值
      expect(ms).toBeGreaterThan(0)
    })
  }

  it('输出基线汇总（informational）', () => {
    // 用 console.table 把结果刷到 CI 日志，此 case 永远通过
    // eslint-disable-next-line no-console
    console.table(results)
    expect(results.length).toBeGreaterThan(0)
    // 至少链式 5 + 树状 3 = 8 个数据点
    expect(results.length).toBeGreaterThanOrEqual(8)
  })
})
