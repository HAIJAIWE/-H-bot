// tests/autoLayout.test.ts
// 阶段 1 画布基础设施单测：autoLayout + reactFlowAdapter 纯逻辑验证

import { describe, it, expect } from 'vitest'
import type { FlowNode, FlowEdge, Port } from '@shared/types/flow'
import {
  NODE_WIDTH,
  estimateNodeHeight,
  needsLayout,
  layoutFlow,
} from '@renderer/lib/autoLayout'
import {
  encodeHandleId,
  toReactFlowNode,
  toReactFlowEdges,
} from '@renderer/lib/reactFlowAdapter'

// ---------------------------------------------------------------------------
// Mock 数据构造（不依赖真实 catalog，保证测试快速可重复）
// ---------------------------------------------------------------------------

const controlIn: Port = { id: 'in', name: '入口', kind: 'control' }
const controlOut: Port = { id: 'next', name: '下一步', kind: 'control' }
const dataOut: Port = { id: 'result', name: '结果', kind: 'data', dataType: 'any' }
const dataIn: Port = { id: 'text', name: '文本', kind: 'data', dataType: 'string' }

/** 构造 mock 节点 */
function makeNode(
  id: string,
  kind: string,
  type: FlowNode['type'] = 'action',
  position = { x: 0, y: 0 },
  extra: Partial<FlowNode> = {}
): FlowNode {
  return {
    id,
    type,
    position,
    data: {
      label: kind,
      nodeKind: kind,
      config: {},
      inputs: [controlIn],
      outputs: [controlOut, dataOut],
      ...extra.data,
    },
    ...extra,
  }
}

/** 构造 mock 控制流边 */
function makeControlEdge(source: string, target: string, sourcePort = 'next', targetPort = 'in'): FlowEdge {
  return {
    id: `edge_${source}_${sourcePort}__${target}_${targetPort}`,
    source,
    sourcePort,
    target,
    targetPort,
    sourceHandle: `${source}__${sourcePort}`,
    targetHandle: `${target}__${targetPort}`,
  }
}

/** 构造 mock 数据流边 */
function makeDataEdge(source: string, target: string, sourcePort = 'result', targetPort = 'text'): FlowEdge {
  return {
    id: `edge_${source}_${sourcePort}__${target}_${targetPort}`,
    source,
    sourcePort,
    target,
    targetPort,
    sourceHandle: `${source}__${sourcePort}`,
    targetHandle: `${target}__${targetPort}`,
  }
}

// ---------------------------------------------------------------------------
// autoLayout 测试
// ---------------------------------------------------------------------------

describe('autoLayout', () => {
  describe('needsLayout', () => {
    it('空数组 → false', () => {
      expect(needsLayout([])).toBe(false)
    })

    it('所有节点 position 全 {0,0} → true', () => {
      const nodes = [makeNode('n1'), makeNode('n2'), makeNode('n3')]
      expect(needsLayout(nodes)).toBe(true)
    })

    it('混合坐标（部分有坐标）→ false（不覆盖用户布局）', () => {
      const nodes = [
        makeNode('n1'),
        makeNode('n2', 'action', 'action', { x: 100, y: 50 }),
        makeNode('n3'),
      ]
      expect(needsLayout(nodes)).toBe(false)
    })

    it('所有节点都有非零坐标 → false', () => {
      const nodes = [
        makeNode('n1', 'action', 'action', { x: 10, y: 20 }),
        makeNode('n2', 'action', 'action', { x: 30, y: 40 }),
      ]
      expect(needsLayout(nodes)).toBe(false)
    })
  })

  describe('estimateNodeHeight', () => {
    // C1 修复后 estimateNodeHeight 与扣子式卡片真实尺寸对齐：
    // 无端口溢出时 = HEADER 30 + Inline 48 + Footer 20 = 98
    it('无端口溢出时返回扣子式卡片高度 98', () => {
      const node = makeNode('n1', 'message_send')
      expect(estimateNodeHeight(node)).toBe(98)
    })

    it('不同节点类型无端口溢出时都返回 98（扣子式卡片高度）', () => {
      const trigger = makeNode('n1', 'message_received', 'trigger')
      const action = makeNode('n2', 'message_send', 'action')
      const logic = makeNode('n3', 'if_branch', 'logic')
      expect(estimateNodeHeight(trigger)).toBe(98)
      expect(estimateNodeHeight(action)).toBe(98)
      expect(estimateNodeHeight(logic)).toBe(98)
    })
  })

  describe('NODE_WIDTH', () => {
    it('节点宽度固定 320（扣子式卡片）', () => {
      expect(NODE_WIDTH).toBe(320)
    })
  })

  describe('layoutFlow', () => {
    it('给定链式 nodes+edges，ELK 输出非零坐标', async () => {
      const nodes = [
        makeNode('n1', 'message_received', 'trigger'),
        makeNode('n2', 'get_context', 'action'),
        makeNode('n3', 'message_send', 'action'),
      ]
      const edges = [
        makeControlEdge('n1', 'n2'),
        makeControlEdge('n2', 'n3'),
      ]

      const positions = await layoutFlow(nodes, edges)

      expect(positions.size).toBe(3)
      // ELK layered 会把链首放在 {0,0}，所以不能要求"每个坐标都非零"；
      // 真正要保证的是：坐标是有限数、且节点确实被摊开了（不是全叠在一点）。
      const seen = new Set<string>()
      for (const pos of positions.values()) {
        expect(Number.isFinite(pos.x)).toBe(true)
        expect(Number.isFinite(pos.y)).toBe(true)
        seen.add(pos.x.toFixed(2) + ',' + pos.y.toFixed(2))
      }
      expect(seen.size).toBeGreaterThanOrEqual(3)
    })

    it('只用控制流边布局，数据流边不影响坐标', async () => {
      const nodes = [
        makeNode('n1', 'message_received', 'trigger'),
        makeNode('n2', 'get_context', 'action'),
        makeNode('n3', 'message_send', 'action'),
      ]
      const controlEdges = [
        makeControlEdge('n1', 'n2'),
        makeControlEdge('n2', 'n3'),
      ]
      const dataEdge = makeDataEdge('n2', 'n3') // 数据流边：result → text

      // 有数据流边
      const withData = await layoutFlow(nodes, [...controlEdges, dataEdge])
      // 无数据流边
      const withoutData = await layoutFlow(nodes, controlEdges)

      // 数据流边不影响控制流拓扑布局，坐标应一致
      for (const id of ['n1', 'n2', 'n3']) {
        const a = withData.get(id)
        const b = withoutData.get(id)
        expect(a).toBeDefined()
        expect(b).toBeDefined()
        expect(a!.x).toBe(b!.x)
        expect(a!.y).toBe(b!.y)
      }
    })

    it('空节点数组 → 空 Map', async () => {
      const positions = await layoutFlow([], [])
      expect(positions.size).toBe(0)
    })

    it('switch_case 动态分支边被纳入布局（不被过滤）', async () => {
      // switch_case 的动态分支端口（case label）不在 catalog outputs 中
      // 但应被 isControlEdge 识别为控制流边，纳入 ELK 布局
      const switchNode = makeNode('n1', 'branch_switch', 'logic', { x: 0, y: 0 }, {
        data: {
          label: '多分支选择',
          nodeKind: 'branch_switch',
          config: { cases: '[{"match":"a","label":"分支A"}]' },
          // 固定 outputs：out(control) + data 端口；动态分支端口不在此列
          inputs: [controlIn],
          outputs: [
            { id: 'out', name: '出口', kind: 'control' },
            { id: 'matched', name: '匹配标签', kind: 'data', dataType: 'string' },
          ],
        },
      })
      const branchNode = makeNode('n2', 'message_send', 'action')
      // 动态分支边：sourcePort = '分支A'（不在 outputs 中）
      const dynamicEdge: FlowEdge = {
        id: 'edge_switch_branch',
        source: 'n1',
        sourcePort: '分支A',
        target: 'n2',
        targetPort: 'in',
        sourceHandle: 'n1__分支A',
        targetHandle: 'n2__in',
      }

      const positions = await layoutFlow([switchNode, branchNode], [dynamicEdge])

      // 动态分支边应被纳入布局，两个节点都有坐标
      expect(positions.size).toBe(2)
      expect(positions.get('n1')).toBeDefined()
      expect(positions.get('n2')).toBeDefined()
    })
  })
})

// ---------------------------------------------------------------------------
// reactFlowAdapter 测试
// ---------------------------------------------------------------------------

describe('reactFlowAdapter', () => {
  describe('encodeHandleId', () => {
    it('control 端口 → control__portId', () => {
      expect(encodeHandleId({ kind: 'control', id: 'next' })).toBe('control__next')
    })

    it('data 端口 → data__portId', () => {
      expect(encodeHandleId({ kind: 'data', id: 'text' })).toBe('data__text')
    })

    it('完整 Port 对象也能传入', () => {
      const port: Port = { id: 'result', name: '结果', kind: 'data', dataType: 'any' }
      expect(encodeHandleId(port)).toBe('data__result')
    })
  })

  describe('toReactFlowNode', () => {
    it('保留 id / type / position / data', () => {
      const node = makeNode('n1', 'message_send', 'action', { x: 100, y: 200 })
      const rfNode = toReactFlowNode(node)
      expect(rfNode.id).toBe('n1')
      expect(rfNode.type).toBe('action')
      expect(rfNode.position).toEqual({ x: 100, y: 200 })
      expect(rfNode.data).toBe(node.data)
    })
  })

  describe('toReactFlowEdges', () => {
    it('过滤掉数据流边，只保留控制流边', () => {
      const nodes = [makeNode('n1', 'message_received', 'trigger'), makeNode('n2', 'message_send', 'action')]
      const controlEdge = makeControlEdge('n1', 'n2')
      const dataEdge = makeDataEdge('n1', 'n2')

      const rfEdges = toReactFlowEdges([controlEdge, dataEdge], nodes)
      expect(rfEdges).toHaveLength(1)
      expect(rfEdges[0].id).toBe(controlEdge.id)
    })

    it('handle 编码从 nodeId__portId 转为 kind__portId', () => {
      const nodes = [makeNode('n1', 'message_received', 'trigger'), makeNode('n2', 'message_send', 'action')]
      const edge = makeControlEdge('n1', 'n2') // sourceHandle 原为 'n1__next'

      const rfEdges = toReactFlowEdges([edge], nodes)
      expect(rfEdges[0].sourceHandle).toBe('control__next')
      expect(rfEdges[0].targetHandle).toBe('control__in')
    })

    it('switch_case 动态端口边被识别为 control（sourceHandle = control__分支A）', () => {
      const switchNode = makeNode('n1', 'branch_switch', 'logic', { x: 0, y: 0 }, {
        data: {
          label: '多分支选择',
          nodeKind: 'branch_switch',
          config: { cases: '[{"match":"a","label":"分支A"}]' },
          inputs: [controlIn],
          outputs: [
            { id: 'out', name: '出口', kind: 'control' },
            { id: 'matched', name: '匹配标签', kind: 'data', dataType: 'string' },
          ],
        },
      })
      const target = makeNode('n2', 'message_send', 'action')
      const dynamicEdge: FlowEdge = {
        id: 'edge_dyn',
        source: 'n1',
        sourcePort: '分支A', // 不在 outputs 中
        target: 'n2',
        targetPort: 'in',
        sourceHandle: 'n1__分支A',
        targetHandle: 'n2__in',
      }

      const rfEdges = toReactFlowEdges([dynamicEdge], [switchNode, target])
      expect(rfEdges).toHaveLength(1)
      // 动态分支端口被识别为 control
      expect(rfEdges[0].sourceHandle).toBe('control__分支A')
      expect(rfEdges[0].targetHandle).toBe('control__in')
      expect(rfEdges[0].type).toBe('control')
    })

    it('空 edges → 空数组', () => {
      const nodes = [makeNode('n1', 'message_received', 'trigger')]
      expect(toReactFlowEdges([], nodes)).toEqual([])
    })

    it('source 节点缺失的边被跳过', () => {
      const nodes = [makeNode('n2', 'message_send', 'action')]
      const edge = makeControlEdge('n1_missing', 'n2')
      const rfEdges = toReactFlowEdges([edge], nodes)
      expect(rfEdges).toHaveLength(0)
    })
  })
})
