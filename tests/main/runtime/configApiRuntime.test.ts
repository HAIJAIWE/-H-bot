// tests/main/runtime/configApiRuntime.test.ts
//
// 配置表绑定在 **TS 运行时** 的取值（回归）。
//
// ## 为什么需要这个文件
//
// `tests/main/codegen/config-api-binding.test.ts` 的头注写明："代码生成器不再为 configApi 边注入
// 隐藏的 database_write 调用……**改由 TS 运行时（FlowInterpreter.resolveConfigApiValue）在执行期
// 按绑定边查询配置库**"。但那个文件只断言了「生成器不注入 + 绑定边保留」——
// 也就是只验证了**交棒**，没有验证运行时**接住**。
//
// 结果：运行时侧 `resolveInputKwargs` 是同步方法，而 `databaseWrite` 返回 Promise，
// 于是在"看到 Promise"那一步直接 `return null`（真机实测日志：
// `[ts-interpreter] database_write 返回 Promise，配置 API 同步解析失败`）。
// 表现为：绑了配置表字段的端口**永远是空值**，模板里的 `{var1}` 原样留在消息里。
//
// 本文件锁住修复后的行为：**端口必须真的拿到配置表里的值**。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { databaseWrite, setDbOpenerForTesting } from '@main/services/builtinNodes/databaseWrite'
import { setDbCtorForTesting, closeAllConnectionsForTesting } from '@main/services/dataService'
import { createConfigTable } from '@main/services/configService'
import { makeSqliteShim } from '../../helpers/sqliteShim'
import { runFlowGraph } from '../../helpers/runFlowGraph'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'

// 本机 better-sqlite3 只有 electron ABI，Node 测试进程加载不了 → 注入等价 shim
// （与 tests/runtime/dbAlignmentE2E.test.ts 同一套测试接缝）
const ShimDatabase = makeSqliteShim()

const specOf = (kind: string) => NODE_CATALOG_V2.find((s) => s.kind === kind)!
const node = (id: string, kind: string, config: Record<string, unknown>) => {
  const spec = specOf(kind)
  return {
    id,
    type: spec.type,
    position: { x: 0, y: 0 },
    data: { label: spec.label, nodeKind: kind, config, inputs: spec.inputs, outputs: spec.outputs },
  }
}
const edge = (id: string, s: string, sp: string, t: string, tp: string) => ({
  id,
  source: s,
  sourcePort: sp,
  target: t,
  targetPort: tp,
})

/** 一条配置 API 绑定边：把 targetNode 的 targetPort 绑到 `<table>.<field>` */
const configApiEdge = (
  id: string,
  targetNode: string,
  targetPort: string,
  opts: { table: string; field: string; dbPath: string; where: string; literalValue: unknown },
) => ({
  id,
  source: '__config_api__',
  sourcePort: '__api__',
  target: targetNode,
  targetPort,
  configApi: {
    table: opts.table,
    field: opts.field,
    dbPath: opts.dbPath,
    where: opts.where,
    whereParamRef: { nodeId: '', portId: '', literalValue: opts.literalValue },
  },
})

const DB_REL = 'data/config/skills.db'
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'qqbat-cfgapi-'))
  mkdirSync(join(root, 'data', 'config'), { recursive: true })
  // 数据库路径相对"项目根"解析 → 用环境变量把它指到临时目录，避免写进真实项目
  process.env.QQBOT_PROJECT_ROOT = root
  setDbOpenerForTesting((filePath) => new ShimDatabase(filePath))
  setDbCtorForTesting(ShimDatabase as never)

  // 走与界面「新建表」同一条产品路径
  createConfigTable(root, 'skills', [
    { name: 'name', type: 'text', label: '技能名' },
    { name: 'power', type: 'integer', label: '威力' },
  ] as never)

  const ins = await databaseWrite({
    mode: 'insert',
    table: 'skills',
    db_path: DB_REL,
    data: { name: '火球术', power: 30 },
  })
  expect(ins.success).toBe(true)
})

afterAll(() => {
  setDbOpenerForTesting(null)
  setDbCtorForTesting(null)
  closeAllConnectionsForTesting()
  delete process.env.QQBOT_PROJECT_ROOT
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
})

describe('配置表绑定 → 节点输入端口（TS 运行时）', () => {
  it('前置：同一份数据直接查得到（证明库与表都没问题）', async () => {
    const r = await databaseWrite({
      mode: 'select',
      table: 'skills',
      db_path: DB_REL,
      condition: 'power >= ?',
      where_params: [10],
      result_field: 'name',
      limit: 1,
    })
    expect(r.success).toBe(true)
    expect(r.value).toBe('火球术')
  })

  it('绑定边的值真的进了端口：模板 {var1} 渲染成配置表里的值', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', {
          match: 'command',
          command: '技能',
          prefix: '/',
          message_type: 'any',
        }),
        node('f', 'format_text', { template: '技能={var1}' }),
        node('s', 'message_send', { mode: 'text', text: '' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'f', 'in'),
        edge('e2', 'f', 'out', 's', 'in'),
        edge('e3', 'f', 'result', 's', 'text'),
        // 关键：var1 不接上游节点，而是绑到配置表 skills.name
        configApiEdge('e4', 'f', 'var1', {
          table: 'skills',
          field: 'name',
          dbPath: DB_REL,
          where: 'power >= ?',
          literalValue: 10,
        }),
      ],
    }

    const r = await runFlowGraph(graph, {
      event: { raw_message: '/技能', message: '/技能', get_message: () => '/技能' },
    })

    expect(r.actions.filter((a) => a.api === 'send_message').map((a) => a.params.message)).toEqual([
      '技能=火球术',
    ])
  })

  it('WHERE 参数来自上游端口时同样取到值（不是只支持字面量）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', {
          match: 'command',
          command: '技能',
          prefix: '/',
          message_type: 'any',
        }),
        // 上游给出 WHERE 参数：表达式算出的 10
        node('v', 'expression_eval', { expression: '5 + 5' }),
        node('f', 'format_text', { template: '威力档={var1}' }),
        node('s', 'message_send', { mode: 'text', text: '' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'v', 'in'),
        edge('e2', 'v', 'out', 'f', 'in'),
        edge('e3', 'f', 'out', 's', 'in'),
        edge('e4', 'f', 'result', 's', 'text'),
        // var1 绑到 skills.power，WHERE 参数取自 expression_eval 的 result
        {
          id: 'e5',
          source: '__config_api__',
          sourcePort: '__api__',
          target: 'f',
          targetPort: 'var1',
          configApi: {
            table: 'skills',
            field: 'power',
            dbPath: DB_REL,
            where: 'power >= ?',
            whereParamRef: { nodeId: 'v', portId: 'result' },
          },
        },
      ],
    }

    const r = await runFlowGraph(graph, {
      event: { raw_message: '/技能', message: '/技能', get_message: () => '/技能' },
    })

    expect(r.actions.filter((a) => a.api === 'send_message').map((a) => a.params.message)).toEqual([
      '威力档=30',
    ])
  })

  it('查不到时不抛错：占位符原样保留（与 format_text 的既定规则一致）', async () => {
    // 说明：`format_text` 的规则是"未提供的键原样保留"（见 builtinNodes.formatText），
    // 所以取不到值时 `{var1}` 会留在文案里，而不是被替换成空串。
    // 这是有意为之：占位符可见 = 用户能立刻看出"这里本该有值但没取到"，
    // 比静默发一条缺内容的回复更容易发现（设计原则 6：失败要可见）。
    const graph = {
      nodes: [
        node('t', 'message_received', {
          match: 'command',
          command: '技能',
          prefix: '/',
          message_type: 'any',
        }),
        node('f', 'format_text', { template: 'X[{var1}]' }),
        node('s', 'message_send', { mode: 'text', text: '' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'f', 'in'),
        edge('e2', 'f', 'out', 's', 'in'),
        edge('e3', 'f', 'result', 's', 'text'),
        configApiEdge('e4', 'f', 'var1', {
          table: 'skills',
          field: 'name',
          dbPath: DB_REL,
          where: 'power >= ?',
          literalValue: 9999, // 没有这一行
        }),
      ],
    }

    const r = await runFlowGraph(graph, {
      event: { raw_message: '/技能', message: '/技能', get_message: () => '/技能' },
    })

    // 关键：不抛错、链照常走完（不是"整个流程挂掉"）
    expect(r.actions.filter((a) => a.api === 'send_message').map((a) => a.params.message)).toEqual([
      'X[{var1}]',
    ])
  })
})

// ============================================================
// RPG 主线要用到的三个能力（2026-09-19 补）
//
// 补之前：配置表**只能读一个字段**，而且 `LIMIT 1` 永远返回第一行 ——
// 于是"随机遇一只怪"做不到、"读怪物一行（hp/atk/经验）"要建 N 个绑定各跑一遍同样的 SELECT。
// ============================================================
const MONSTERS_DB = 'data/config/monsters.db'

/** 建一条「读配置表 → 拼文案 → 发消息」的链；绑定落在 expression_eval 的 v1 端口上 */
function rowBindingGraph(opts: { expression: string; order: string }) {
  return {
    nodes: [
      node('t', 'message_received', {
        match: 'command',
        command: '打怪',
        prefix: '/',
        message_type: 'any',
      }),
      node('e', 'expression_eval', { mode: 'single', expression: opts.expression }),
      node('f', 'format_text', { template: 'HP={var1}' }),
      node('s', 'message_send', { mode: 'text', text: '' }),
    ],
    edges: [
      edge('e1', 't', 'next', 'e', 'in'),
      edge('e2', 'e', 'out', 'f', 'in'),
      edge('e3', 'f', 'out', 's', 'in'),
      edge('e4', 'e', 'result', 'f', 'var1'),
      edge('e5', 'f', 'result', 's', 'text'),
      // 整行绑到 v1（query_row 模式，field 留空）
      {
        id: 'e6',
        source: '__config_api__',
        sourcePort: '__api__',
        target: 'e',
        targetPort: 'v1',
        configApi: {
          table: 'monsters',
          field: '',
          dbPath: MONSTERS_DB,
          mode: 'query_row',
          order: opts.order,
        },
      },
    ],
  }
}

const runMonster = async (opts: { expression: string; order: string }) => {
  const r = await runFlowGraph(rowBindingGraph(opts), {
    event: { raw_message: '/打怪', message: '/打怪', get_message: () => '/打怪' },
  })
  return r.actions.filter((a) => a.api === 'send_message').map((a) => a.params.message)
}

describe('配置表：随机取一行 / 按列排序 / 取整行（RPG 主线要用）', () => {
  beforeAll(async () => {
    createConfigTable(root, 'monsters', [
      { name: 'name', type: 'text', label: '怪物名' },
      { name: 'hp', type: 'integer', label: '血量' },
      { name: 'level', type: 'integer', label: '等级' },
    ] as never)
    for (const m of [
      { name: '史莱姆', hp: 30, level: 1 },
      { name: '哥布林', hp: 80, level: 3 },
      { name: '火龙', hp: 500, level: 9 },
    ]) {
      const ins = await databaseWrite({
        mode: 'insert',
        table: 'monsters',
        db_path: MONSTERS_DB,
        data: m,
      })
      expect(ins.success).toBe(true)
    }
  })

  it('order 默认不排序 → 永远第一行（这是补之前的唯一行为）', async () => {
    const a = await runMonster({ expression: 'get(v1, "hp", 0)', order: '' })
    const b = await runMonster({ expression: 'get(v1, "hp", 0)', order: '' })
    expect(a).toEqual(['HP=30'])
    expect(b).toEqual(['HP=30'])
  })

  it('order=RANDOM() → 多次执行取到不同的行（随机遇怪成立）', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const msgs = await runMonster({ expression: 'get(v1, "hp", 0)', order: 'RANDOM()' })
      for (const m of msgs) seen.add(String(m))
    }
    // 3 行里抽 30 次全同的概率约 3*(1/3)^30 ≈ 0
    expect(seen.size).toBeGreaterThan(1)
    for (const m of seen) expect(['HP=30', 'HP=80', 'HP=500']).toContain(m)
  })

  it('order=列名 DESC → 按列排序取第一行（取等级最高的怪）', async () => {
    expect(await runMonster({ expression: 'get(v1, "level", 0)', order: 'level DESC' })).toEqual([
      'HP=9',
    ])
    expect(await runMonster({ expression: 'get(v1, "level", 0)', order: 'level ASC' })).toEqual([
      'HP=1',
    ])
  })

  it('query_row 给的是**整行对象**：一次拿全 hp/level，不用建多个绑定', async () => {
    // 同一个绑定对象，既能取 hp 也能取 level
    expect(await runMonster({ expression: 'get(v1, "hp", 0)', order: 'level DESC' })).toEqual([
      'HP=500',
    ])
    expect(await runMonster({ expression: 'get(v1, "level", 0)', order: 'level DESC' })).toEqual([
      'HP=9',
    ])
    // 拼多字段（打怪回话要的形态）
    expect(
      await runMonster({
        expression: 'get(v1, "name", "?") + " lv" + str(get(v1, "level", 0))',
        order: 'level DESC',
      }),
    ).toEqual(['HP=火龙 lv9'])
  })

  it('order 会被校验：注入片段直接报错，不拼进 SQL', async () => {
    const r = await databaseWrite({
      mode: 'select',
      table: 'monsters',
      db_path: MONSTERS_DB,
      order: 'level DESC; DROP TABLE monsters',
      limit: 1,
    })
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法 order')
    // 表还在
    const after = await databaseWrite({
      mode: 'select',
      table: 'monsters',
      db_path: MONSTERS_DB,
      limit: 10,
    })
    expect(after.rows_count).toBe(3)
  })

  it('query_all 仍然返回全部行（老行为不变）', async () => {
    const r = await databaseWrite({
      mode: 'select',
      table: 'monsters',
      db_path: MONSTERS_DB,
      limit: 10,
    })
    expect(r.success).toBe(true)
    expect(r.rows_count).toBe(3)
    expect(r.rows?.[0]).toHaveProperty('name')
  })
})
