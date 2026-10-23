// tests/renderer/lib/commandList.test.ts
//
// 「指令清单」的四列全部是从图里推导出来的，没有第二份数据。推导规则写错的表现是
// "清单和画布说的不是一回事"（子流程被当成指令、问题数算漏、回复取错节点），
// 界面上完全看不出来 —— 所以规则在这里钉死。
import { describe, it, expect } from 'vitest'
import type { FlowNode, FlowEdge } from '@shared/types/flow'
import { createNode, createEdge } from '@renderer/lib/nodeFactory'
import { buildCommandRows, filterCommandRows } from '@renderer/lib/commandList'

function node(kind: string, id: string, config: Record<string, unknown> = {}): FlowNode {
  const n = createNode(kind, { x: 0, y: 0 })
  n.id = id
  n.data.config = { ...n.data.config, ...config }
  return n
}

/** 触发器（createNode 已按目录设置 type，这里显式写一遍以免目录改动影响测试意图） */
function trigger(id: string, kind = 'message_received', config: Record<string, unknown> = {}): FlowNode {
  const n = node(kind, id, config)
  n.type = 'trigger'
  return n
}

/** 控制流边 */
function ctrl(source: string, sourcePort: string, target: string, targetPort = 'in'): FlowEdge {
  const e = createEdge(source, sourcePort, target, targetPort)
  e.id = `e_${source}_${sourcePort}__${target}_${targetPort}`
  return e
}

/** 数据流边（如 文本模板.result → 发消息.text） */
function data(source: string, sourcePort: string, target: string, targetPort: string): FlowEdge {
  const e = createEdge(source, sourcePort, target, targetPort)
  e.id = `d_${source}_${sourcePort}__${target}_${targetPort}`
  return e
}

/** 配置 API 绑定边（伪源，没有源节点） */
function cfgApi(target: string, targetPort: string, table: string): FlowEdge {
  const e = createEdge('__config_api__', '__api__', target, targetPort)
  e.id = `e-cfgapi-${target}-${targetPort}`
  e.configApi = { table, field: 'desc', dbPath: `data/config/${table}.db` }
  return e
}

/** 一条最简单的指令链：/签到 → 发消息 */
function simpleChain() {
  return {
    nodes: [
      trigger('t1', 'message_received', { match: 'command', command: '签到' }),
      node('message_send', 's1', { mode: 'text', text: '✅ 签到成功！当前积分 {var1}' }),
    ],
    edges: [ctrl('t1', 'next', 's1')],
  }
}

describe('buildCommandRows：命令词与回复摘要', () => {
  it('指令行取到命令词（不含斜杠）与回复文案（占位符原样保留）', () => {
    const { nodes, edges } = simpleChain()
    const rows = buildCommandRows(nodes, edges)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      triggerId: 't1',
      command: '签到',
      triggerText: '/签到',
      reply: '✅ 签到成功！当前积分 {var1}',
      nodeCount: 2,
      issueCount: 0,
      configTables: [],
      isSubflow: false,
    })
  })

  it('非「指令」触发不编造命令词，如实显示画布上的节点名', () => {
    const n = trigger('t1', 'message_received', { match: 'at_me' })
    n.data.label = '@机器人'
    const rows = buildCommandRows([n, node('message_send', 's1', { text: 'hi' })], [ctrl('t1', 'next', 's1')])
    expect(rows[0].command).toBeNull()
    expect(rows[0].triggerText).toBe('@机器人')
  })

  it('命令词为空串时不算指令（避免清单出现空的 /）', () => {
    const rows = buildCommandRows(
      [trigger('t1', 'message_received', { match: 'command', command: '   ' })],
      [],
    )
    expect(rows[0].command).toBeNull()
  })

  it('跳过没有文案的发送节点（消息段/合并转发没有 text），取第一个有文案的', () => {
    const rows = buildCommandRows(
      [
        trigger('t1', 'message_received', { match: 'command', command: '菜单' }),
        node('message_send', 's1', { mode: 'segment' }),
        node('message_send', 's2', { mode: 'text', text: '菜单如下' }),
      ],
      [ctrl('t1', 'next', 's1'), ctrl('s1', 'out', 's2')],
    )
    expect(rows[0].reply).toBe('菜单如下')
  })

  // 真机实测踩到的：用户的 20 条链**全部**是这个形状（`文本模板 → 发消息`），
  // 只看 send.text 会 20 条全显示"未设置文案"
  it('send 自己没写文案时，顺着 text 端口的连线取上游文本模板的 template', () => {
    const rows = buildCommandRows(
      [
        trigger('t1', 'message_received', { match: 'command', command: '签到' }),
        node('format_text', 'f1', { template: '✅ 签到成功！当前积分 {var1}' }),
        node('message_send', 's1', { mode: 'text', text: '' }),
      ],
      [
        ctrl('t1', 'next', 'f1'),
        ctrl('f1', 'out', 's1'),
        data('f1', 'result', 's1', 'text'),
      ],
    )
    expect(rows[0].reply).toBe('✅ 签到成功！当前积分 {var1}')
  })

  it('send 自己写了文案时以自己为准（回复即模板，不追上游）', () => {
    const rows = buildCommandRows(
      [
        trigger('t1', 'message_received', { match: 'command', command: '签到' }),
        node('format_text', 'f1', { template: '上游模板' }),
        node('message_send', 's1', { mode: 'text', text: '直接写的文案' }),
      ],
      [
        ctrl('t1', 'next', 'f1'),
        ctrl('f1', 'out', 's1'),
        data('f1', 'result', 's1', 'text'),
      ],
    )
    expect(rows[0].reply).toBe('直接写的文案')
  })

  it('上游不是文本模板时不编造文案（宁可显示未设置，也不显示错误的内容）', () => {
    const rows = buildCommandRows(
      [
        trigger('t1', 'message_received', { match: 'command', command: '签到' }),
        node('get_context', 'c1', { mode: 'message_text' }),
        node('message_send', 's1', { mode: 'text', text: '' }),
      ],
      [ctrl('t1', 'next', 'c1'), ctrl('c1', 'out', 's1'), data('c1', 'result', 's1', 'text')],
    )
    expect(rows[0].reply).toBeNull()
  })

  it('链里没有发送节点时回复为空', () => {
    const rows = buildCommandRows(
      [trigger('t1', 'message_received', { match: 'command', command: '菜单' })],
      [],
    )
    expect(rows[0].reply).toBeNull()
  })
})

describe('buildCommandRows：节点数与问题数', () => {
  it('节点数含触发器；问题数把链内各节点的问题累加', () => {
    const { nodes, edges } = simpleChain()
    const rows = buildCommandRows(nodes, edges, { t1: ['缺命令词'], s1: ['文案为空', '端口未连'] })
    expect(rows[0].nodeCount).toBe(2)
    expect(rows[0].issueCount).toBe(3)
  })

  it('不属于该链的节点问题不计入（否则每条指令都会显示同一批问题）', () => {
    const { nodes, edges } = simpleChain()
    const rows = buildCommandRows(nodes, edges, { other: ['别的问题'] })
    expect(rows[0].issueCount).toBe(0)
  })
})

describe('buildCommandRows：读的配置表', () => {
  it('配置绑定边按目标节点归属到链上，并去重', () => {
    const { nodes, edges } = simpleChain()
    const rows = buildCommandRows(nodes, [
      ...edges,
      cfgApi('s1', 'var1', 'skills'),
      cfgApi('s1', 'var2', 'skills'),
      cfgApi('s1', 'var3', 'items'),
    ])
    expect(rows[0].configTables).toEqual(['skills', 'items'])
  })

  it('配置绑定到别的链的节点时不算这条链读表', () => {
    const { nodes, edges } = simpleChain()
    const rows = buildCommandRows(nodes, [...edges, cfgApi('别的节点', 'var1', 'skills')])
    expect(rows[0].configTables).toEqual([])
  })
})

describe('buildCommandRows：子流程与排序', () => {
  it('子流程定义排到最后并标注 isSubflow', () => {
    const sub = trigger('d1', 'subflow_defined')
    sub.data.label = '回复一个值'
    const rows = buildCommandRows(
      [
        sub,
        trigger('t1', 'message_received', { match: 'command', command: '签到' }),
        node('message_send', 's1', { mode: 'text', text: 'ok' }),
      ],
      [ctrl('t1', 'next', 's1')],
    )
    expect(rows.map((r) => r.triggerId)).toEqual(['t1', 'd1'])
    expect(rows[1].isSubflow).toBe(true)
  })

  it('没有触发器的孤立节点不产生行（清单是"指令清单"，不是节点清单）', () => {
    const rows = buildCommandRows([node('message_send', 's1', { text: 'hi' })], [])
    expect(rows).toEqual([])
  })
})

describe('filterCommandRows', () => {
  const { nodes, edges } = simpleChain()
  const rows = buildCommandRows(nodes, edges)

  it('空查询返回全部', () => {
    expect(filterCommandRows(rows, '   ')).toHaveLength(1)
  })

  it('命令词 / 回复摘要任一命中即保留，大小写不敏感', () => {
    expect(filterCommandRows(rows, '签到')).toHaveLength(1)
    expect(filterCommandRows(rows, '积分')).toHaveLength(1)
    expect(filterCommandRows(rows, '菜单')).toHaveLength(0)
  })
})
