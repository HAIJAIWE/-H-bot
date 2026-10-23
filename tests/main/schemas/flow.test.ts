import { describe, it, expect } from 'vitest'
import { flowGraphSchema, flowEdgeSchema, portSchema } from '@main/schemas/flow'
import type { FlowGraph, FlowEdge, Port } from '@shared/types/flow'

// 修复 C1: flowGraphSchema 缺失字段导致 Zod 默认 strip 行为静默删除
// configApi/nodeGroups/systemId/required/default 等字段。
// 这些测试验证 schema 与 FlowGraph 类型同步，保存/加载往返不丢字段。

const basePort: Port = {
  id: 'in',
  name: '入口',
  kind: 'data',
  dataType: 'string',
  required: true,
  description: '必填输入端口',
  default: 'fallback'
}

/**
 * ⚠️ 这个样本必须**填满 `ConfigApiBinding` 的每一个字段**：
 * 下面的「往返不丢字段」断言拿它和 parse 结果做深比较，少填一个字段就等于放弃守那条字段。
 * `ConfigApiBinding` 新增字段时，这里和 `src/main/schemas/flow.ts` 都要加。
 */
const baseEdge: FlowEdge = {
  id: 'e1',
  source: '__config_api__',
  sourcePort: 'out',
  target: 'n1',
  targetPort: 'in',
  configApi: {
    table: 'realms',
    field: 'name',
    dbPath: 'data/config/realms.db',
    where: 'level_min <= ?',
    whereParamRef: {
      nodeId: 'n0',
      portId: 'level',
      literalValue: 10
    },
    mode: 'query',
    order: 'level DESC'
  }
}

const baseFlow: FlowGraph = {
  schemaVersion: '1.0',
  systems: [],
  nodes: [
    {
      id: 'n1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        label: '测试节点',
        nodeKind: 'message_send',
        systemId: 'battle',
        description: '战斗系统中发送胜利消息',
        config: {},
        inputs: [basePort],
        outputs: []
      }
    }
  ],
  edges: [baseEdge],
  variables: [],
  nodeGroups: [
    {
      id: 'g1',
      title: '组1',
      nodeIds: ['n1'],
      collapsed: false
    }
  ],
  metadata: {
    name: 'test',
    version: '1.0',
    runtime: 'nonebot2',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }
}

describe('修复 C1: flowGraphSchema 字段保留', () => {
  it('portSchema 保留 required/description/default 字段', () => {
    const result = portSchema.safeParse(basePort)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.required).toBe(true)
      expect(result.data.description).toBe('必填输入端口')
      expect(result.data.default).toBe('fallback')
    }
  })

  it('flowEdgeSchema 保留 configApi 字段', () => {
    const result = flowEdgeSchema.safeParse(baseEdge)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.configApi).toBeDefined()
      expect(result.data.configApi?.table).toBe('realms')
      expect(result.data.configApi?.field).toBe('name')
      expect(result.data.configApi?.where).toBe('level_min <= ?')
      expect(result.data.configApi?.whereParamRef?.literalValue).toBe(10)
      expect(result.data.configApi?.mode).toBe('query')
    }
  })

  it('flowGraphSchema 保留 configApi 边（关键：防止 Zod strip 导致配置 API 边丢失）', () => {
    const json = JSON.stringify(baseFlow)
    const parsed = JSON.parse(json)
    const result = flowGraphSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (result.success) {
      // 关键断言：configApi 边不应被 Zod 静默删除
      expect(result.data.edges[0].configApi).toBeDefined()
      expect(result.data.edges[0].configApi?.table).toBe('realms')
    }
  })

  it('flowGraphSchema 保留 nodeGroups 字段', () => {
    const json = JSON.stringify(baseFlow)
    const parsed = JSON.parse(json)
    const result = flowGraphSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.nodeGroups).toBeDefined()
      expect(result.data.nodeGroups).toHaveLength(1)
      expect(result.data.nodeGroups?.[0].title).toBe('组1')
    }
  })

  it('flowGraphSchema 保留 FlowNodeData.systemId 和 description 字段', () => {
    const json = JSON.stringify(baseFlow)
    const parsed = JSON.parse(json)
    const result = flowGraphSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.nodes[0].data.systemId).toBe('battle')
      expect(result.data.nodes[0].data.description).toBe('战斗系统中发送胜利消息')
    }
  })

  it('flowGraphSchema 保留端口 required/description/default（节点级）', () => {
    const json = JSON.stringify(baseFlow)
    const parsed = JSON.parse(json)
    const result = flowGraphSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (result.success) {
      const port = result.data.nodes[0].data.inputs[0]
      expect(port.required).toBe(true)
      expect(port.description).toBe('必填输入端口')
      expect(port.default).toBe('fallback')
    }
  })

  it('flowGraphSchema 允许缺失 nodeGroups（向后兼容）', () => {
    const flowWithoutGroups = { ...baseFlow } as Partial<FlowGraph>
    delete flowWithoutGroups.nodeGroups
    const result = flowGraphSchema.safeParse(flowWithoutGroups)
    expect(result.success).toBe(true)
  })

  /**
   * 这一条是**兜住"schema 落后于类型"这类事故的闸门**（踩过两次，其中一次直接把画布打死）：
   *
   * 加载项目用的是 `flowGraphSchema.safeParse(...)` 的**结果**（`services/flow.ts`），所以
   *   · 枚举里没有的值 → 校验失败 → 整个画布报「流程加载失败，画布没有载入内容」
   *     （`mode: 'query_row'` 加进类型却没加进 schema，实测就是这个现象）
   *   · schema 里没有的字段 → 被 Zod strip 掉、静默丢失
   *     （`order: 'RANDOM()'` 不在 schema 里 → 存一次就没了，"随机遇怪"退化成"永远第一只怪"）
   *
   * 所以这里断言的是**深相等**：样本里有什么，parse 之后就必须一字不差地还在。
   */
  it('configApi 绑定往返不丢字段（含 query_row 与 order）', () => {
    const parsed = JSON.parse(JSON.stringify(baseFlow))
    const result = flowGraphSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.edges[0].configApi).toEqual(parsed.edges[0].configApi)
    }
  })

  it('三种查询模式都能通过校验（query / query_row / query_all）', () => {
    for (const mode of ['query', 'query_row', 'query_all'] as const) {
      const edge = { ...baseEdge, configApi: { ...baseEdge.configApi!, mode } }
      const result = flowEdgeSchema.safeParse(edge)
      expect(result.success, `mode=${mode} 应当被接受`).toBe(true)
      if (result.success) expect(result.data.configApi?.mode).toBe(mode)
    }
  })

  it('随机取一行（order: RANDOM()）不会被 schema 丢掉', () => {
    const edge = { ...baseEdge, configApi: { ...baseEdge.configApi!, order: 'RANDOM()' } }
    const result = flowEdgeSchema.safeParse(edge)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.configApi?.order).toBe('RANDOM()')
  })

  it('flowGraphSchema 允许缺失 configApi（普通边）', () => {
    const normalEdge: FlowEdge = {
      id: 'e2',
      source: 'n1',
      sourcePort: 'out',
      target: 'n2',
      targetPort: 'in'
    }
    const result = flowEdgeSchema.safeParse(normalEdge)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.configApi).toBeUndefined()
    }
  })
})
