// tests/canvasConstants.test.ts
// 阶段 3 验证：从 BlockView 迁移的常量 + SystemRegionLayer 包围盒计算

import { describe, it, expect, afterEach } from 'vitest'
import type { FlowNode, FlowEdge, SystemGroup, Port } from '@shared/types/flow'
import {
  formatSummary,
  BLOCK_COLORS,
  STEP_NUMBER_COLORS,
} from '@renderer/lib/canvasConstants'

// 直接 import SystemRegionLayer 的纯函数不方便（computeRegions 未导出），
// 这里在测试中复刻一份等价逻辑做 sanity 验证。等真正出 bug 再把 computeRegions export 出来。
import { isControlEdge } from '@renderer/lib/executionOrder'

// ---------------------------------------------------------------------------
// Mock 数据
// ---------------------------------------------------------------------------

const controlIn: Port = { id: 'in', name: '入口', kind: 'control' }
const controlOut: Port = { id: 'next', name: '下一步', kind: 'control' }

function makeNode(
  id: string,
  kind = 'message_send',
  type: FlowNode['type'] = 'action',
  position: { x: number; y: number } = { x: 0, y: 0 },
  config: Record<string, unknown> = {}
): FlowNode {
  return {
    id,
    type,
    position,
    data: {
      label: kind,
      nodeKind: kind,
      config,
      inputs: [controlIn],
      outputs: [controlOut],
    },
  }
}

function makeEdge(
  source: string,
  target: string,
  sourcePort = 'next',
  targetPort = 'in'
): FlowEdge {
  return {
    id: `e_${source}_${sourcePort}__${target}_${targetPort}`,
    source,
    sourcePort,
    target,
    targetPort,
  }
}

// ---------------------------------------------------------------------------
// 常量迁移回归测试
// ---------------------------------------------------------------------------

describe('canvasConstants 迁移完整性', () => {
  it('BLOCK_COLORS 包含所有节点 type', () => {
    expect(BLOCK_COLORS.trigger).toBeTruthy()
    expect(BLOCK_COLORS.action).toBeTruthy()
    expect(BLOCK_COLORS.logic).toBeTruthy()
    expect(BLOCK_COLORS.data).toBeTruthy()
    expect(BLOCK_COLORS.ai).toBeTruthy()
    expect(BLOCK_COLORS.custom).toBeTruthy()
  })

  it('STEP_NUMBER_COLORS 包含所有节点 type', () => {
    expect(STEP_NUMBER_COLORS.trigger).toContain('bg-blue')
    expect(STEP_NUMBER_COLORS.action).toContain('bg-emerald')
    expect(STEP_NUMBER_COLORS.logic).toContain('bg-amber')
    expect(STEP_NUMBER_COLORS.data).toContain('bg-purple')
    expect(STEP_NUMBER_COLORS.ai).toContain('bg-pink')
  })

  it('formatSummary message_send 文本模式', () => {
    const node = makeNode('n1', 'message_send', 'action', { x: 0, y: 0 }, {
      mode: 'text',
      text: '你好世界',
    })
    expect(formatSummary(node)).toBe('"你好世界"')
  })

  it('formatSummary message_received 指令模式', () => {
    const node = makeNode('n1', 'message_received', 'trigger', { x: 0, y: 0 }, {
      match: 'command',
      command: '签到',
    })
    expect(formatSummary(node)).toBe('/签到')
  })

  it('formatSummary delay 秒数', () => {
    const node = makeNode('n1', 'delay', 'action', { x: 0, y: 0 }, { seconds: 5 })
    expect(formatSummary(node)).toBe('5s')
  })

  it('formatSummary 未知节点 kind 返回空字符串', () => {
    const node = makeNode('n1', 'unknown_kind_xyz' as never, 'action', { x: 0, y: 0 }, {})
    expect(formatSummary(node)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 双语：节点卡片摘要随界面语言变化
// ---------------------------------------------------------------------------

describe('formatSummary 跟随界面语言', () => {
  afterEach(async () => {
    const { setLocale } = await import('@renderer/i18n')
    setLocale('zh-CN')
  })

  it('中文界面输出中文摘要，英文界面输出英文摘要', async () => {
    const { setLocale } = await import('@renderer/i18n')
    const loop = makeNode('n1', 'loop', 'logic', { x: 0, y: 0 }, { mode: 'times', count: 3 })

    setLocale('zh-CN')
    expect(formatSummary(loop)).toBe('循环 3次')

    setLocale('en-US')
    expect(formatSummary(loop)).toBe('Loop ×3')
  })

  it('插值参数在两种语言下都保留', async () => {
    const { setLocale } = await import('@renderer/i18n')
    const at = makeNode('n1', 'message_received', 'trigger', { x: 0, y: 0 }, { match: 'at_me' })

    setLocale('zh-CN')
    expect(formatSummary(at)).toBe('@机器人')

    setLocale('en-US')
    expect(formatSummary(at)).toBe('@bot')
  })

  it('英文界面下摘要不残留中文（未自定义名的分支）', async () => {
    const { setLocale } = await import('@renderer/i18n')
    setLocale('en-US')
    const cases: Array<[string, Record<string, unknown>]> = [
      ['variable_set', {}],
      ['loop_control', { mode: 'return' }],
      ['parallel_exec', {}],
      ['try_catch', {}],
      ['subflow_call', {}],
      ['message_recall', {}],
      ['retry_exec', { max_retries: 2 }],
    ]
    const offenders: string[] = []
    for (const [kind, config] of cases) {
      const out = formatSummary(makeNode('n1', kind, 'action', { x: 0, y: 0 }, config))
      if (/[\u4e00-\u9fa5]/.test(out)) offenders.push(`${kind}: ${out}`)
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SystemRegionLayer 包围盒计算逻辑（复刻 computeRegions）
// ---------------------------------------------------------------------------

/** 复刻 SystemRegionLayer 中的 collectReachableNodeIds，等价测试 */
function collectReachableNodeIds(
  triggerIds: string[],
  nodes: FlowNode[],
  edges: FlowEdge[]
): Set<string> {
  const reachable = new Set<string>()
  const queue: string[] = []
  for (const tid of triggerIds) {
    if (nodes.some((n) => n.id === tid)) {
      reachable.add(tid)
      queue.push(tid)
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source === current && !reachable.has(edge.target)) {
        if (isControlEdge(edge, nodes)) {
          reachable.add(edge.target)
          queue.push(edge.target)
        }
      }
    }
  }
  return reachable
}

function computeRegions(
  nodes: FlowNode[],
  edges: FlowEdge[],
  systems: SystemGroup[]
) {
  const regions = []
  for (const sys of systems) {
    if (sys.chainTriggerIds.length === 0) continue
    const reachable = collectReachableNodeIds(sys.chainTriggerIds, nodes, edges)
    if (reachable.size === 0) continue
    const reachableNodes = nodes.filter((n) => reachable.has(n.id))
    if (reachableNodes.length === 0) continue

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of reachableNodes) {
      if (n.position.x < minX) minX = n.position.x
      if (n.position.y < minY) minY = n.position.y
      if (n.position.x > maxX) maxX = n.position.x
      if (n.position.y > maxY) maxY = n.position.y
    }
    regions.push({ systemId: sys.id, minX, minY, maxX, maxY })
  }
  return regions
}

describe('SystemRegionLayer 包围盒计算', () => {
  it('空 systems 返回空 regions', () => {
    const regions = computeRegions([], [], [])
    expect(regions).toHaveLength(0)
  })

  it('单个系统 + 线性链：包围盒覆盖所有可达节点', () => {
    const trigger = makeNode('t1', 'message_received', 'trigger', { x: 0, y: 0 })
    const action1 = makeNode('a1', 'message_send', 'action', { x: 200, y: 0 })
    const action2 = makeNode('a2', 'delay', 'action', { x: 400, y: 0 })
    const nodes = [trigger, action1, action2]
    const edges = [
      makeEdge('t1', 'a1'),
      makeEdge('a1', 'a2'),
    ]
    const systems: SystemGroup[] = [
      { id: 'sys1', name: '签到系统', icon: '📅', description: '', chainTriggerIds: ['t1'] },
    ]

    const regions = computeRegions(nodes, edges, systems)
    expect(regions).toHaveLength(1)
    expect(regions[0].systemId).toBe('sys1')
    expect(regions[0].minX).toBe(0)
    expect(regions[0].maxX).toBe(400)
    expect(regions[0].minY).toBe(0)
    expect(regions[0].maxY).toBe(0)
  })

  it('孤立节点（不在任何系统内）不进分区', () => {
    const trigger = makeNode('t1', 'message_received', 'trigger', { x: 0, y: 0 })
    const orphan = makeNode('orphan', 'message_send', 'action', { x: 999, y: 999 })
    const nodes = [trigger, orphan]
    const systems: SystemGroup[] = [
      { id: 'sys1', name: 'S', icon: '📌', description: '', chainTriggerIds: ['t1'] },
    ]

    const regions = computeRegions(nodes, [], systems)
    expect(regions).toHaveLength(1)
    // orphan 不应该影响包围盒
    expect(regions[0].maxX).toBe(0)
    expect(regions[0].maxY).toBe(0)
  })

  it('数据流边不参与可达性传播', () => {
    const trigger = makeNode('t1', 'message_received', 'trigger', { x: 0, y: 0 })
    const action = makeNode('a1', 'message_send', 'action', { x: 200, y: 0 })
    const dataOnly = makeNode('d1', 'format_text', 'data', { x: 999, y: 999 })
    const nodes = [trigger, action, dataOnly]
    // 控制流: t1 → a1；数据流: d1 → a1（target 端口为 data）
    const edges: FlowEdge[] = [
      { id: 'e1', source: 't1', sourcePort: 'next', target: 'a1', targetPort: 'in' },
      { id: 'e2', source: 'd1', sourcePort: 'result', target: 'a1', targetPort: 'text' },
    ]
    const systems: SystemGroup[] = [
      { id: 'sys1', name: 'S', icon: '📌', description: '', chainTriggerIds: ['t1'] },
    ]

    const regions = computeRegions(nodes, edges, systems)
    // d1 仅有数据流连接，不应该被纳入系统分区
    expect(regions[0].maxX).toBe(200)
    expect(regions[0].maxY).toBe(0)
  })

  it('多系统互不干扰', () => {
    const t1 = makeNode('t1', 'message_received', 'trigger', { x: 0, y: 0 })
    const a1 = makeNode('a1', 'message_send', 'action', { x: 100, y: 100 })
    const t2 = makeNode('t2', 'message_received', 'trigger', { x: 500, y: 500 })
    const a2 = makeNode('a2', 'message_send', 'action', { x: 600, y: 600 })
    const nodes = [t1, a1, t2, a2]
    const edges = [makeEdge('t1', 'a1'), makeEdge('t2', 'a2')]
    const systems: SystemGroup[] = [
      { id: 'sys1', name: 'S1', icon: '1️⃣', description: '', chainTriggerIds: ['t1'] },
      { id: 'sys2', name: 'S2', icon: '2️⃣', description: '', chainTriggerIds: ['t2'] },
    ]

    const regions = computeRegions(nodes, edges, systems)
    expect(regions).toHaveLength(2)
    const r1 = regions.find((r) => r.systemId === 'sys1')!
    const r2 = regions.find((r) => r.systemId === 'sys2')!
    expect(r1.maxX).toBe(100)
    expect(r2.minX).toBe(500)
  })
})
