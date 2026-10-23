// tests/shared/flowNormalize.test.ts
//
// 统一真相层的回归测试。
//
// 背景（全部为实测踩到的 bug）：模板创建的 flow.json 节点没有端口定义，
// 导致 ① 解释器拿到空配置（机器人不回复）② 按钮连线被 sanitizeFlowEdges 删除。
// 本文件同时覆盖「补端口」与「校验报告」两条主线。
import { describe, it, expect } from 'vitest'
import {
  normalizeFlow,
  validateFlow,
  hasBlockingIssues,
  dropInvalidEdges
} from '@shared/nodes/flowNormalize'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import type { FlowEdge, FlowGraph, FlowNode, Port } from '@shared/types/flow'

/** 构造"模板风格"节点：只有 config，没有端口定义（内置模板的真实形态） */
function templateNode(
  id: string,
  kind: string,
  config: Record<string, unknown> = {},
  type: FlowNode['type'] = 'action'
): FlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: kind, nodeKind: kind, config, inputs: [], outputs: [] }
  }
}

function makeGraph(nodes: FlowNode[], edges: FlowEdge[] = []): FlowGraph {
  return {
    schemaVersion: '1.1',
    systems: [],
    nodes,
    edges,
    variables: [],
    metadata: { name: 'test', version: '1.0', runtime: 'typescript', createdAt: '', updatedAt: '' }
  }
}

const specOf = (kind: string) => NODE_CATALOG_V2.find((s) => s.kind === kind)!
const ids = (ports: Port[] | undefined) => (ports ?? []).map((p) => p.id)

describe('normalizeFlow — 补齐端口定义', () => {
  it('模板风格节点（无端口）会被补全为节点目录的定义', () => {
    const graph = makeGraph([
      templateNode('t1', 'message_received', { match: 'command', command: '战斗' }, 'trigger'),
      templateNode('a1', 'variable_persist', { mode: 'save', key: 'hp', value: 100 }, 'data')
    ])

    const { graph: out, changes } = normalizeFlow(graph)

    const trigger = out.nodes.find((n) => n.id === 't1')!
    const persist = out.nodes.find((n) => n.id === 'a1')!
    expect(ids(trigger.data.outputs).length).toBeGreaterThan(0)
    expect(ids(persist.data.outputs)).toContain('out')
    expect(changes.map((c) => c.nodeId).sort()).toEqual(['a1', 't1'])
  })

  it('message_send(keyboard) 会补上由 keyboard 推导的 btn_* 动态端口', () => {
    const graph = makeGraph([
      templateNode('n3', 'message_send', {
        mode: 'keyboard',
        markdown: '## 战斗',
        keyboard: {
          rows: [
            {
              buttons: [
                { id: 'attack', render_data: { label: '攻击' }, action: { data: 'attack' } },
                { id: 'flee', render_data: { label: '逃跑' }, action: { data: 'flee' } }
              ]
            }
          ]
        }
      })
    ])

    const { graph: out } = normalizeFlow(graph)
    const outputs = ids(out.nodes[0].data.outputs)

    expect(outputs).toContain('btn_attack')
    expect(outputs).toContain('btn_flee')
    // 基础端口仍在
    expect(outputs).toContain('out')
  })

  it('非破坏性：已有的动态端口不会被删除', () => {
    const node = templateNode('b1', 'branch_switch', { cases: '[]' })
    node.data.inputs = [{ id: 'in', name: '入口', kind: 'control' }]
    node.data.outputs = [{ id: 'case_custom', name: '自定义分支', kind: 'control' }]

    const { graph: out } = normalizeFlow(makeGraph([node]))
    const outputs = ids(out.nodes[0].data.outputs)

    expect(outputs).toContain('case_custom') // 目录里没有，但必须保留
  })

  it('幂等：对已完整的流程不再产生改动', () => {
    const first = normalizeFlow(makeGraph([templateNode('a1', 'message_send', { mode: 'text' })]))
    const second = normalizeFlow(first.graph)

    expect(second.changes).toEqual([])
  })

  it('未知 kind（插件节点）原样保留并记录', () => {
    const graph = makeGraph([templateNode('p1', 'plugin_custom-demo_demo', { city: '上海' })])

    const { graph: out, unknownKinds } = normalizeFlow(graph)

    expect(unknownKinds).toEqual([{ nodeId: 'p1', nodeKind: 'plugin_custom-demo_demo' }])
    expect(out.nodes[0].data.inputs).toEqual([])
  })

  it('不修改入参（纯函数）', () => {
    const graph = makeGraph([templateNode('a1', 'variable_persist', { mode: 'save' })])
    const before = JSON.stringify(graph)

    normalizeFlow(graph)

    expect(JSON.stringify(graph)).toBe(before)
  })
})

describe('validateFlow — 问题清单', () => {
  it('必需配置缺失报 error（含节点名与字段名）', () => {
    const graph = normalizeFlow(
      makeGraph([templateNode('n1', 'message_recall', {})])
    ).graph

    const issues = validateFlow(graph)

    const required = issues.find((i) => i.code === 'missing-required-config')
    expect(required).toBeDefined()
    expect(required!.severity).toBe('error')
    expect(required!.nodeId).toBe('n1')
    expect(hasBlockingIssues(issues)).toBe(true)
  })

  /**
   * `showWhen` 是目录对"这个字段在当前模式下适不适用"的声明，必填校验必须认它。
   *
   * 事故：`expression_eval` 的「表达式」在 formulas 模式下**运行时根本不读**，
   * 却因为 config 里没值被判成"缺必填"并报 error 把整张图标红 —— 搭 RPG 主线时实测到
   * （一条链里有 3 个 formulas 节点，画布直接标红）。
   */
  it('当前模式下不适用的必填字段不算缺失（formulas 模式不要求「表达式」）', () => {
    const formulas = normalizeFlow(
      makeGraph([templateNode('n1', 'expression_eval', { mode: 'formulas', formulas: [{ name: 'a', expression: '1' }] })])
    ).graph
    expect(validateFlow(formulas).filter((i) => i.code === 'missing-required-config')).toEqual([])

    // 反向：single 模式下「表达式」是必填，缺了必须报
    const single = normalizeFlow(makeGraph([templateNode('n1', 'expression_eval', { mode: 'single' })])).graph
    const required = validateFlow(single).find((i) => i.code === 'missing-required-config')
    expect(required?.severity).toBe('error')
    expect(required?.nodeId).toBe('n1')
  })

  it('有数据边绑定时不再报必需缺失', () => {
    const graph = normalizeFlow(
      makeGraph(
        [
          templateNode('t1', 'message_received', { match: 'any' }, 'trigger'),
          templateNode('n1', 'message_recall', {})
        ],
        [{ id: 'e1', source: 't1', sourcePort: 'message_id', target: 'n1', targetPort: 'message_id' }]
      )
    ).graph

    const issues = validateFlow(graph)

    expect(issues.filter((i) => i.code === 'missing-required-config')).toEqual([])
  })

  it('连线指向不存在的端口时报 error（这正是历史上被静默删除的那类边）', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'any' }, 'trigger'), templateNode('n1', 'variable_persist', {})],
        [{ id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: '不存在的端口' }]
      )
    ).graph

    const issues = validateFlow(graph)

    expect(issues.some((i) => i.code === 'edge-invalid-target-port')).toBe(true)
  })

  it('连线两端节点缺失时报 error', () => {
    const graph = makeGraph([], [{ id: 'e1', source: 'ghost', sourcePort: 'next', target: 'ghost2', targetPort: 'in' }])

    const issues = validateFlow(graph)

    expect(issues.some((i) => i.code === 'edge-missing-node')).toBe(true)
  })

  it('不可达节点报 warning（不会执行，但不阻断运行）', () => {
    const graph = normalizeFlow(
      // 用 load 模式：save 模式现在要求 value 端口有绑定（客户端版本把 value 标了 required），
      // 否则这条边上会多出 missing-required-config 错误，掩盖「不可达只是 warning」这个断言。
      makeGraph([templateNode('t1', 'message_received', { match: 'any' }, 'trigger'), templateNode('orphan', 'variable_persist', { mode: 'load', key: 'k' })])
    ).graph

    const issues = validateFlow(graph)

    const unreachable = issues.find((i) => i.code === 'unreachable-node')
    expect(unreachable?.severity).toBe('warning')
    expect(unreachable?.nodeId).toBe('orphan')
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('未知节点类型报 warning（插件节点是合法的）', () => {
    const issues = validateFlow(makeGraph([templateNode('p1', 'plugin_ai-x_x')]))

    const issue = issues.find((i) => i.code === 'unknown-node-kind')
    expect(issue?.severity).toBe('warning')
    expect(issue?.message).toContain('plugin_ai-x_x')
  })

  it('重复节点 id 报 error', () => {
    const issues = validateFlow(
      makeGraph([templateNode('dup', 'variable_persist', {}), templateNode('dup', 'variable_persist', {})])
    )

    expect(issues.some((i) => i.code === 'duplicate-node-id')).toBe(true)
  })

  /**
   * 回归：连线 id 撞车此前**没有任何校验**。
   *
   * 用户项目实测：`rpg_c6` 被两条线共用（脚本批量生成节点/边时手写 id 撞车），
   * 横跨 3 个备份版本没被发现。执行器不读边 id（走 controlOut/dataIn），所以流程照跑，
   * 但画布按 id 找边（删除/更新/React key）会命中错的那条 —— "删一条线，另一条也没了"。
   * 因此定级 warning：报出来，但不拦预览。
   */
  it('重复连线 id 报 warning（不阻断运行）', () => {
    // 必须先 normalize：templateNode 不带端口定义，直接校验会报「连线指向不存在的端口」这类 error，
    // 干扰"是否阻断"的断言（被测的是连线 id 重复，不是端口）
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'command', command: '菜单' }, 'trigger'), templateNode('n1', 'message_send', { mode: 'text', text: 'hi' })],
        [
          { id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' },
          { id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' },
        ]
      )
    ).graph

    const issues = validateFlow(graph)
    const dup = issues.find((i) => i.code === 'duplicate-edge-id')
    expect(dup).toBeDefined()
    expect(dup?.severity).toBe('warning')
    expect(dup?.edgeId).toBe('e1')
    // 只有一条重复（第二条才报），第一条本身不算
    expect(issues.filter((i) => i.code === 'duplicate-edge-id')).toHaveLength(1)
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('连线 id 全唯一时零问题', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'command', command: '菜单' }, 'trigger'), templateNode('n1', 'message_send', { mode: 'text', text: 'hi' })],
        [{ id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' }]
      )
    ).graph

    expect(validateFlow(graph).filter((i) => i.code === 'duplicate-edge-id')).toEqual([])
  })

  it('三条边共用同一 id 时报 N-1 条 warning', () => {
    const e = { source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' }
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'command', command: '菜单' }, 'trigger'), templateNode('n1', 'message_send', { mode: 'text', text: 'hi' })],
        [
          { id: 'e1', ...e },
          { id: 'e1', ...e },
          { id: 'e1', ...e },
        ]
      )
    ).graph

    expect(validateFlow(graph).filter((i) => i.code === 'duplicate-edge-id')).toHaveLength(2)
  })

  it('缺 id 的连线不报「重复: undefined」（那是缺失，不是重复）', () => {
    const e = { source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' }
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'command', command: '菜单' }, 'trigger'), templateNode('n1', 'message_send', { mode: 'text', text: 'hi' })],
        [
          { id: '', ...e },
          { id: '', ...e },
        ]
      )
    ).graph

    expect(validateFlow(graph).filter((i) => i.code === 'duplicate-edge-id')).toEqual([])
  })

  it('dropInvalidEdges 对重复 id 的连线不清理（否则会按 id 删掉一条合法边）', () => {
    // 两条边共用 id 'e1'，其中第二条指向不存在的端口（error）。若按 id 批量删，
    // 第一条合法的也会被删 —— 必须拦截。
    const graph = {
      nodes: [templateNode('t1', 'message_received', { match: 'command', command: '菜单' }, 'trigger'), templateNode('n1', 'message_send', { mode: 'text', text: 'hi' })],
      edges: [
        { id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' },
        { id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'BAD_PORT' },
      ],
    }
    const r = dropInvalidEdges(graph as never)
    // 重复 id 存在 → 完全不清理，两条边都在（而不是误删第一条合法边）
    expect(r.dropped).toEqual([])
    expect((r.graph as { edges: unknown[] }).edges).toHaveLength(2)
  })

  it('健康流程零问题', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'command', command: '菜单' }, 'trigger'), templateNode('n1', 'message_send', { mode: 'text', text: 'hi' })],
        [{ id: 'e1', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' }]
      )
    ).graph

    expect(validateFlow(graph)).toEqual([])
  })
})

// 回归：配置 API 边（source === '__config_api__'）是**伪源**，不代表画布上的真实节点。
// 真机实测：它的豁免判断原来写在"节点必须存在"的报错**之后**，永远没机会生效，
// 于是绑了配置表的流程一律被报 `edge-missing-node` 并**阻断预览/运行**。
describe('validateFlow — 配置 API 边（伪源）不算悬空连线', () => {
  const configApiEdge = (targetPort = 'var1'): FlowEdge => ({
    id: 'cfg1',
    source: '__config_api__',
    sourcePort: '__api__',
    target: 'f1',
    targetPort,
    configApi: { table: 'skills', field: 'name', dbPath: 'data/config/skills.db' },
  })

  it('绑到存在的节点端口：不报 edge-missing-node', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('f1', 'format_text', { template: 'x={var1}' })],
        [configApiEdge()]
      )
    ).graph

    // 只断言关键的那条：不会被错当成"指向不存在的节点"（伪源豁免）
    expect(validateFlow(graph).filter((i) => i.code === 'edge-missing-node')).toEqual([])
    expect(
      validateFlow(graph).filter((i) => i.code === 'edge-missing-node' && i.message.includes('__config_api__'))
    ).toEqual([])
  })

  it('目标节点不存在时仍然报错（豁免的只是"源"，不是整条边不校验）', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('f1', 'format_text', { template: 'x={var1}' })],
        [{ ...configApiEdge(), target: 'nope' }]
      )
    ).graph

    expect(validateFlow(graph).map((i) => i.code)).toContain('edge-missing-node')
  })
})

describe('dropInvalidEdges — 显式清理（替代静默删除）', () => {
  it('返回被丢弃的连线，便于调用方记录', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'any' }, 'trigger'), templateNode('n1', 'variable_persist', {})],
        [
          { id: 'ok', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' },
          { id: 'bad', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'nope' }
        ]
      )
    ).graph

    const { graph: out, dropped } = dropInvalidEdges(graph)

    expect(out.edges.map((e) => e.id)).toEqual(['ok'])
    expect(dropped.map((e) => e.id)).toEqual(['bad'])
  })

  it('全部有效时原样返回', () => {
    const graph = normalizeFlow(
      makeGraph(
        [templateNode('t1', 'message_received', { match: 'any' }, 'trigger'), templateNode('n1', 'variable_persist', {})],
        [{ id: 'ok', source: 't1', sourcePort: 'next', target: 'n1', targetPort: 'in' }]
      )
    ).graph

    const { dropped } = dropInvalidEdges(graph)

    expect(dropped).toEqual([])
  })
})
