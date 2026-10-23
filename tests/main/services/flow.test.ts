// tests/main/services/flow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FlowService, sanitizeFlowEdges, runMigrations, CURRENT_SCHEMA_VERSION } from '@main/services/flow'
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FLOW_SCHEMA_VERSION, type FlowGraph } from '@shared/types/flow'

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qqbat-flow-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('FlowService', () => {
  it('加载空 flow.json 返回 null', async () => {
    const svc = new FlowService()
    const result = await svc.loadFlow(join(tmpRoot, 'nonexistent'))
    expect(result).toBeNull()
  })

  it('保存并加载 flow.json', async () => {
    const svc = new FlowService()
    const flow = {
      schemaVersion: '1.0',
      systems: [],
      nodes: [],
      edges: [],
      variables: [],
      metadata: {
        name: 'test',
        version: '1.0',
        runtime: 'nonebot2' as const,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      }
    }
    await svc.saveFlow(join(tmpRoot, 'proj'), flow)
    expect(existsSync(join(tmpRoot, 'proj', '.qqbat', 'flow.json'))).toBe(true)

    const loaded = await svc.loadFlow(join(tmpRoot, 'proj'))
    expect(loaded?.metadata.name).toBe('test')
  })

  it('保存时原子写入不残留 tmp 文件', async () => {
    const svc = new FlowService()
    const flow = {
      schemaVersion: '1.0',
      systems: [],
      nodes: [],
      edges: [],
      variables: [],
      metadata: {
        name: 't',
        version: '1.0',
        runtime: 'nonebot2' as const,
        createdAt: '',
        updatedAt: ''
      }
    }
    await svc.saveFlow(join(tmpRoot, 'p'), flow)
    expect(existsSync(join(tmpRoot, 'p', '.qqbat', 'flow.json.tmp'))).toBe(false)
  })

  it('保存时更新 updatedAt', async () => {
    const svc = new FlowService()
    const flow = {
      schemaVersion: '1.0',
      systems: [],
      nodes: [],
      edges: [],
      variables: [],
      metadata: {
        name: 't',
        version: '1.0',
        runtime: 'nonebot2' as const,
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: '2020-01-01T00:00:00Z'
      }
    }
    await svc.saveFlow(join(tmpRoot, 'p'), flow)
    const raw = await readFile(join(tmpRoot, 'p', '.qqbat', 'flow.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.metadata.updatedAt).not.toBe('2020-01-01T00:00:00Z')
  })
})

describe('sanitizeFlowEdges', () => {
  const makeFlow = (edges: any[] = []): FlowGraph => ({
    schemaVersion: '1.1',
    systems: [],
    nodes: [
      {
        id: 'n1', type: 'trigger', position: { x: 0, y: 0 },
        data: {
          label: '收到消息', nodeKind: 'message_received', config: {},
          inputs: [],
          outputs: [
            { id: 'next', name: '下一步', kind: 'control' },
            { id: 'raw_message', name: '原始消息', kind: 'data', dataType: 'string' },
            { id: 'event', name: '事件对象', kind: 'data', dataType: 'event' },
          ],
        },
      },
      {
        id: 'n2', type: 'action', position: { x: 0, y: 100 },
        data: {
          label: '发消息', nodeKind: 'message_send', config: {},
          inputs: [
            { id: 'in', name: '入口', kind: 'control' },
            { id: 'text', name: '文本内容', kind: 'data', dataType: 'string' },
          ],
          outputs: [
            { id: 'next', name: '下一步', kind: 'control' },
            { id: 'success', name: '成功', kind: 'data', dataType: 'boolean' },
          ],
        },
      },
    ],
    edges,
    variables: [],
    metadata: { name: 'test', version: '1.0', runtime: 'nonebot2', createdAt: '', updatedAt: '' },
  })

  it('保留有效 edges', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n1', sourcePort: 'next', target: 'n2', targetPort: 'in' },
      { id: 'e2', source: 'n1', sourcePort: 'raw_message', target: 'n2', targetPort: 'text' },
    ])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(2)
  })

  it('清理引用不存在输出端口的 edge', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n1', sourcePort: 'nonexistent_port', target: 'n2', targetPort: 'text' },
    ])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(0)
  })

  it('清理引用不存在输入端口的 edge', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n1', sourcePort: 'raw_message', target: 'n2', targetPort: 'nonexistent_port' },
    ])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(0)
  })

  it('清理引用不存在节点的 edge', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n99', sourcePort: 'next', target: 'n2', targetPort: 'in' },
    ])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(0)
  })

  it('混合有效和无效 edges 时只保留有效的', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n1', sourcePort: 'next', target: 'n2', targetPort: 'in' },
      { id: 'e2', source: 'n1', sourcePort: 'bad_port', target: 'n2', targetPort: 'text' },
      { id: 'e3', source: 'n1', sourcePort: 'raw_message', target: 'n2', targetPort: 'bad_port' },
    ])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].id).toBe('e1')
  })

  it('空 edges 数组不影响 flow', () => {
    const flow = makeFlow([])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(0)
    expect(result.nodes).toHaveLength(2)
  })

  it('catalog spec 覆盖 node.data 中的端口定义', () => {
    // message_received 在 catalog 中有 next/event/raw_message/args/matched/groups 端口
    // sanitizeFlowEdges 优先使用 catalog，所以 catalog 中有的端口 edge 都有效
    const flow = makeFlow([
      { id: 'e1', source: 'n1', sourcePort: 'next', target: 'n2', targetPort: 'in' },
    ])
    const result = sanitizeFlowEdges(flow)
    expect(result.edges).toHaveLength(1)
  })

  // 回归（实测：按钮点击失效）：按钮端口 btn_<id> 由 keyboard 配置推导，
  // 部分流程（旧版本 / 模板导入 / 脚本生成）不保存节点 outputs，
  // 只认 catalog + node.data.outputs 会把合法的按钮连线当无效边删掉。
  it('节点未保存 outputs 时，仍保留 keyboard 推导出的按钮端口连线', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n1', sourcePort: 'next', target: 'n2', targetPort: 'in' },
      { id: 'e2', source: 'n2', sourcePort: 'btn_attack', target: 'n2', targetPort: 'in' },
      { id: 'e3', source: 'n2', sourcePort: 'btn_flee', target: 'n2', targetPort: 'in' },
    ])
    // 模拟"没有保存端口定义"的流程：清空 outputs，只留 keyboard 配置
    const send = flow.nodes.find((n) => n.id === 'n2')!
    send.data.outputs = []
    send.data.config = {
      mode: 'keyboard',
      keyboard: {
        rows: [
          {
            buttons: [
              { id: 'attack', render_data: { label: '⚔️ 攻击' }, action: { data: '/攻击' } },
              { id: 'flee', render_data: { label: '🏃 逃跑' }, action: { data: '/逃跑' } },
            ],
          },
        ],
      },
    }

    const result = sanitizeFlowEdges(flow)

    expect(result.edges).toHaveLength(3)
    expect(result.edges.map((e: { sourcePort: string }) => e.sourcePort).sort()).toEqual([
      'btn_attack',
      'btn_flee',
      'next',
    ])
  })

  it('未配置 keyboard 时按钮端口连线仍会被清理', () => {
    const flow = makeFlow([
      { id: 'e1', source: 'n2', sourcePort: 'btn_attack', target: 'n2', targetPort: 'in' },
    ])
    const send = flow.nodes.find((n) => n.id === 'n2')!
    send.data.outputs = []
    send.data.config = { mode: 'text' }

    const result = sanitizeFlowEdges(flow)

    expect(result.edges).toHaveLength(0)
  })
})

// ── schema 版本号一致性 
// 回归（真机实测）：写入方 `FLOW_SCHEMA_VERSION` 停在 '1.0'，主进程加载判定却是 '1.1'
// → 保存出来的文件下次打开必然"迁移一次"：多写一份 history 备份 + 原地重写 flow.json
//（实测备份与现文件逐行对比只差 schemaVersion 一行）。
describe('flow schema 版本号一致性', () => {
  const emptyGraph = (schemaVersion: string): FlowGraph => ({
    schemaVersion,
    systems: [],
    nodes: [],
    edges: [],
    variables: [],
    nodeGroups: [],
    metadata: {
      name: 'ver',
      version: '1.0',
      runtime: 'typescript' as FlowGraph['metadata']['runtime'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  })

  it('写入方常量必须与加载判定常量相等', () => {
    expect(FLOW_SCHEMA_VERSION).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('保存当前版本的图后加载：不重写文件、不新增 history 备份', async () => {
    const svc = new FlowService()
    const proj = join(tmpRoot, 'ver-proj')
    await svc.saveFlow(proj, emptyGraph(FLOW_SCHEMA_VERSION))

    const file = join(proj, '.qqbat', 'flow.json')
    const before = await readFile(file, 'utf-8')

    await svc.loadFlow(proj)

    expect(await readFile(file, 'utf-8')).toBe(before) // 逐字不变 = 没走迁移写盘
    const historyDir = join(proj, '.qqbat', 'history')
    expect(existsSync(historyDir) ? await readdir(historyDir) : []).toEqual([])
  })

  it('旧版本（1.0）仍然会被迁移到当前版本并留下备份', async () => {
    const proj = join(tmpRoot, 'ver-old')
    const dir = join(proj, '.qqbat')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'flow.json')
    await writeFile(file, JSON.stringify(emptyGraph('1.0'), null, 2), 'utf-8')

    await new FlowService().loadFlow(proj)

    expect(JSON.parse(await readFile(file, 'utf-8')).schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(await readdir(join(dir, 'history'))).toHaveLength(1)
  })

  it('1.0→1.1 的节点改名规则仍然生效（版本号改动没有顺手废掉迁移）', () => {
    const migrated = runMigrations({
      schemaVersion: '1.0',
      nodes: [
        { id: 'n1', type: 'action', position: { x: 0, y: 0 }, data: { label: '发按钮', nodeKind: 'send_keyboard_message', config: {} } },
      ],
      edges: [],
    })
    const node = (migrated.nodes as Array<{ data: { nodeKind: string; config: Record<string, unknown> } }>)[0]
    expect(node.data.nodeKind).toBe('message_send')
    expect(node.data.config.mode).toBe('keyboard')
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})
