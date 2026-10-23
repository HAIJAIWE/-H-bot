// tests/shared/nodes/connectionIssues.test.ts
//
// 共享连线规则（`@shared/nodes/connectionIssues`）—— 主进程与渲染层共用的唯一实现。
//
// 事故背景：合并前项目里有**两套校验引擎**、互不包含，同一份 246 节点的流程
// 画布右下角提示「61 个警告 + 1 个提示」，工具栏却显示「43 个提醒」。
import { describe, it, expect } from 'vitest'
import { validateFlow } from '@shared/nodes/flowNormalize'
import type { FlowNode, FlowEdge } from '@shared/types/flow'
import {
  collectConnectionIssues,
  edgePortId,
  isDataTypeCompatible,
} from '@shared/nodes/connectionIssues'

const node = (id: string, type: string, kind: string, inputs: unknown[] = [], outputs: unknown[] = []): FlowNode =>
  ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, nodeKind: kind, config: {}, inputs, outputs },
  }) as unknown as FlowNode

const trigger = node('t1', 'trigger', 'message_received', [], [{ id: 'next', kind: 'control' }])
const sender = node(
  'a1',
  'action',
  'message_send',
  [
    { id: 'in', kind: 'control', name: '入口' },
    { id: 'text', kind: 'data', name: '文本', required: true },
  ],
  [],
)
/** 既没有任何入口、也没有任何连线 —— 两条规则都会命中它 */
const orphan = node('x1', 'action', 'message_send', [{ id: 'in', kind: 'control', name: '入口' }], [])

const diskEdges: FlowEdge[] = [
  { id: 'e1', source: 't1', target: 'a1', sourcePort: 'next', targetPort: 'in' },
]
/** 画布上的边：端口信息在 handle 里（"nodeId__portId"） */
const canvasEdges: FlowEdge[] = [
  { id: 'e1', source: 't1', target: 'a1', sourceHandle: 't1__next', targetHandle: 'a1__in' } as unknown as FlowEdge,
]

const codes = (list: Array<{ code: string }>) => list.map((i) => i.code).sort()

describe('统一校验引擎', () => {
  it('两种边形态（flow.json 的 sourcePort / 画布的 handle）结果一致', () => {
    const a = validateFlow({ nodes: [trigger, sender, orphan], edges: diskEdges } as never)
    const b = validateFlow({ nodes: [trigger, sender, orphan], edges: canvasEdges } as never)
    expect(codes(a)).toEqual(codes(b))
  })

  it('同时报出结构层与连线层的规则：无入口 + 必填端口未连', () => {
    const issues = validateFlow({ nodes: [trigger, sender, orphan], edges: diskEdges } as never)
    expect(codes(issues)).toContain('unreachable-node')
    expect(codes(issues)).toContain('CONN_MISSING_REQUIRED_INPUT')
  })

  it('孤立节点不与"无入口"重复上报（同一件事只说一次）', () => {
    const issues = validateFlow({ nodes: [trigger, sender, orphan], edges: diskEdges } as never)
    expect(issues.filter((i) => i.nodeId === 'x1').map((i) => i.code)).toEqual(['unreachable-node'])
  })

  it('触发器既不算孤立也不算无入口（画布节点 type 仍是领域类型）', () => {
    const issues = validateFlow({ nodes: [trigger], edges: [] } as never)
    expect(issues.filter((i) => i.nodeId === 't1')).toEqual([])
  })

  // 回归：画布上的节点 type 是 canvasNode（React Flow 组件类型），领域类型只在 data.nodeKind。
  // 可达性起点如果只认 type === 'trigger'，画布上就一个起点都找不到 → 200 多个节点被判"没有入口"。
  it('画布形态（type=canvasNode）的触发器仍被认作入口，其下游可达', () => {
    const canvasTrigger = node('ct1', 'canvasNode', 'message_received', [], [{ id: 'next', kind: 'control' }])
    const canvasSender = node('cs1', 'canvasNode', 'message_send', [{ id: 'in', kind: 'control', name: '入口' }], [])
    const edges = [
      { id: 'e1', source: 'ct1', target: 'cs1', sourceHandle: 'ct1__next', targetHandle: 'cs1__in' },
    ] as unknown as FlowEdge[]

    const issues = validateFlow({ nodes: [canvasTrigger, canvasSender], edges } as never)
    expect(issues.filter((i) => i.nodeId === 'ct1')).toEqual([])
    expect(issues.some((i) => i.code === 'unreachable-node')).toBe(false)
  })

  // 值存在 config 里（属性面板填的）也算"端口已满足" —— 运行时取值顺序是
  // 「数据边 > config > 默认值」（`FlowInterpreter.resolveInputKwargs`）。
  // 少了这一条，`expression_eval` 的「表达式」、`format_text` 的「模板」这类
  // "填在面板里"的必填端口会全部误报（搭一条 RPG 主线就能刷出 17 条假警告）。
  it('属性面板里填了值的必填数据端口不报缺失', () => {
    const filled = {
      id: 'a3',
      type: 'logic',
      position: { x: 0, y: 0 },
      data: {
        label: 'a3',
        nodeKind: 'expression_eval',
        config: { expression: 'v1 + 1' },
        inputs: [{ id: 'expression', kind: 'data', name: '表达式', required: true }],
        outputs: [],
      },
    } as unknown as FlowNode
    const issues = collectConnectionIssues([trigger, filled], diskEdges)
    expect(issues.filter((i) => i.code === 'CONN_MISSING_REQUIRED_INPUT')).toEqual([])
  })

  // 目录里的 showWhen 是"这个字段在当前模式下适不适用"的唯一判定入口。
  // `expression_eval` 的「表达式」在 formulas 模式下运行时根本不读，不该报"必填端口没接上"。
  it('当前模式下不适用的必填端口不报缺失（formulas 模式不要求「表达式」）', () => {
    const formulasNode = {
      id: 'a5',
      type: 'logic',
      position: { x: 0, y: 0 },
      data: {
        label: 'a5',
        nodeKind: 'expression_eval',
        config: { mode: 'formulas', formulas: [{ name: 'a', expression: '1' }] },
        inputs: [{ id: 'expression', kind: 'data', name: '表达式', required: true }],
        outputs: [],
      },
    } as unknown as FlowNode
    const issues = collectConnectionIssues([trigger, formulasNode], diskEdges)
    expect(issues.filter((i) => i.code === 'CONN_MISSING_REQUIRED_INPUT')).toEqual([])
  })

  it('config 里是空串/空值仍算缺失（不能把真空的也放过）', () => {
    const empty = {
      id: 'a4',
      type: 'logic',
      position: { x: 0, y: 0 },
      data: {
        label: 'a4',
        nodeKind: 'expression_eval',
        config: { expression: '' },
        inputs: [{ id: 'expression', kind: 'data', name: '表达式', required: true }],
        outputs: [],
      },
    } as unknown as FlowNode
    const issues = collectConnectionIssues([trigger, empty], diskEdges)
    expect(issues.filter((i) => i.code === 'CONN_MISSING_REQUIRED_INPUT')).toHaveLength(1)
  })

  it('没有默认值的必填数据端口才报缺失；给了默认值就不报', () => {
    const withDefault = node(
      'a2',
      'action',
      'message_send',
      [{ id: 'text', kind: 'data', name: '文本', required: true, default: '你好' }],
      [],
    )
    const issues = collectConnectionIssues([trigger, withDefault], diskEdges)
    // 有默认值 → 不报"必填端口未绑定"（它没接线，所以只会有孤立的提示）
    expect(issues.filter((i) => i.nodeId === 'a2').map((i) => i.code)).toEqual(['CONN_ISOLATED_NODE'])
  })
})

describe('共享连线规则的形态适配', () => {
  it('edgePortId 同时认识 sourcePort 与 sourceHandle', () => {
    expect(edgePortId(diskEdges[0], 'source')).toBe('next')
    expect(edgePortId(diskEdges[0], 'target')).toBe('in')
    expect(edgePortId(canvasEdges[0], 'source')).toBe('next')
    expect(edgePortId(canvasEdges[0], 'target')).toBe('in')
  })

  it('数据类型兼容规则（number → string 允许，string → number 不允许）', () => {
    expect(isDataTypeCompatible('number', 'string')).toBe(true)
    expect(isDataTypeCompatible('string', 'number')).toBe(false)
    expect(isDataTypeCompatible('any', 'number')).toBe(true)
  })

  it('collectConnectionIssues 可单独调用（带"已报节点"去重集合）', () => {
    const issues = collectConnectionIssues([trigger, sender, orphan], diskEdges, new Set(['x1']))
    expect(issues.some((i) => i.code === 'CONN_ISOLATED_NODE')).toBe(false)
    expect(issues.some((i) => i.code === 'CONN_MISSING_REQUIRED_INPUT')).toBe(true)
  })
})
