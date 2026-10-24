// tests/main/runtime/configQueryNode.test.ts
//
// `config_query` 节点：让流程读项目里的配置表（data/config/<表名>.db）。
//
// ## 为什么补这个文件
//
// 这个节点的存在理由写在它自己的头注里：「把静默失败变响」。所以它的**错误路径**
// （表名拼错、筛选条件写成写操作、用了引号字面量、库文件不存在）比成功路径更重要 ——
// 成功路径下游还有 databaseWrite 兜着，错误路径写错就会变成"查不到 → 空值 → 模板里 {var1} 原样发出去"。
//
// 迁移前它由 pytest 的 test_config_query_* 覆盖（含"非法字符""写关键字""引号"三类负例），
// Python 栈删除后 TS 侧 0 断言。这里按运行时表（getHandler('config_query')）测，而不是只测纯函数，
// 因为项目根是从 hctx.projectPath 注进来的，接错就整个节点查不到库。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { databaseWrite, setDbOpenerForTesting } from '@main/services/builtinNodes/databaseWrite'
import { setDbCtorForTesting, closeAllConnectionsForTesting } from '@main/services/dataService'
import { createConfigTable } from '@main/services/configService'
import { getHandler } from '@main/runtime/handlerRegistry'
import { makeSqliteShim } from '../../helpers/sqliteShim'

// better-sqlite3 只有 electron ABI → 注入 node:sqlite 写的 shim（与 configApiRuntime.test.ts 同一接缝）
const ShimDatabase = makeSqliteShim()
const DB_REL = 'data/config/items.db'
let projectRoot: string

/** 以配置查询节点的身份跑一次（hctx 只带项目根，这正是运行时传的东西） */
function query(kwargs: Record<string, unknown>, withRoot = true) {
  const handler = getHandler('config_query')
  expect(handler).toBeTruthy()
  return (handler as any)(null, null, kwargs, withRoot ? { projectPath: projectRoot } : {})
}

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'qqbat-cfgquery-'))
  mkdirSync(join(projectRoot, 'data', 'config'), { recursive: true })
  process.env.QQBOT_PROJECT_ROOT = projectRoot
  setDbOpenerForTesting((filePath: string) => new ShimDatabase(filePath) as never)
  setDbCtorForTesting(ShimDatabase as never)

  // 走界面「新建表」同一条产品路径，保证 .schema 元数据与 .db 都是真的
  createConfigTable(projectRoot, 'items', [
    { name: 'name', type: 'text', label: '名称' },
    { name: 'type', type: 'text', label: '类型' },
    { name: 'power', type: 'integer', label: '威力' },
  ] as never)

  for (const row of [
    { name: '木剑', type: 'weapon', power: 5 },
    { name: '铁剑', type: 'weapon', power: 12 },
    { name: '火球术', type: 'skill', power: 30 },
  ]) {
    const ins = await databaseWrite({ mode: 'insert', table: 'items', db_path: DB_REL, data: row })
    expect(ins.success).toBe(true)
  }
})

afterAll(() => {
  setDbOpenerForTesting(null)
  setDbCtorForTesting(null)
  closeAllConnectionsForTesting()
  delete process.env.QQBOT_PROJECT_ROOT
  try {
    rmSync(projectRoot, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
})

describe('查得到：all / row / 字段 / 条件 / 排序', () => {
  it('all：返回全部行，count 对得上，first 是第一行', async () => {
    const r = await query({ table: 'items', mode: 'all' })
    expect(r.success).toBe(true)
    expect(r.error).toBe('')
    expect(r.count).toBe(3)
    expect(r.rows).toHaveLength(3)
    expect(r.first).toEqual(r.rows[0])
    expect(r.rows.map((x: any) => x.name)).toContain('火球术')
  })

  it('row：只取一行（下游拿 first 用的就是它）', async () => {
    const r = await query({ table: 'items', mode: 'row' })
    expect(r.count).toBe(1)
    expect(r.first.name).toBeTruthy()
  })

  it('field：value 直接给这一行的该字段（模板里 {var1} 的来源）', async () => {
    const r = await query({ table: 'items', mode: 'row', field: 'name' })
    expect(r.value).toBe(r.first.name)
  })

  it('没填 field 时 value = first（整行对象，不是 undefined）', async () => {
    const r = await query({ table: 'items', mode: 'row' })
    expect(r.value).toEqual(r.first)
  })

  it('where + ? 占位符 + 条件参数：筛出武器两行', async () => {
    const r = await query({ table: 'items', mode: 'all', where: 'type = ?', where_params: ['weapon'] })
    expect(r.success).toBe(true)
    expect(r.count).toBe(2)
    expect(r.rows.every((x: any) => x.type === 'weapon')).toBe(true)
  })

  it('limit 生效；mode=all 时默认上限 1000（不是 1）', async () => {
    expect((await query({ table: 'items', mode: 'all', limit: 1 })).count).toBe(1)
    expect((await query({ table: 'items', mode: 'all' })).count).toBe(3)
  })

  it('order 生效（排序片段也过只读检查，但允许正常语句）', async () => {
    const r = await query({ table: 'items', mode: 'all', order: 'power DESC' })
    expect(r.success).toBe(true)
    expect(r.rows[0].power).toBe(30)
  })

  it('条件参数以 JSON 字符串传入也认（面板把数组存成字符串）', async () => {
    const r = await query({ table: 'items', mode: 'all', where: 'type = ?', where_params: '["skill"]' })
    expect(r.count).toBe(1)
    expect(r.first.name).toBe('火球术')
  })
})

describe('查不到 / 配错：必须说清原因（这个节点的存在理由）', () => {
  it('表名为空 → 提示填表名', async () => {
    const r = await query({ table: '' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('配置表名不能为空')
  })

  it('非法表名（注入形状）→ 拒绝并列规则', async () => {
    const r = await query({ table: 'items; DROP TABLE x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法表名')
  })

  it('未知查询模式 → 明确报错，不静默当成 all', async () => {
    const r = await query({ table: 'items', mode: 'some' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('未知的查询模式')
  })

  it('筛选条件里出现写关键字 → 拒绝（只读保护）', async () => {
    for (const frag of ['1=1 DELETE FROM items', 'drop table items', 'type = ?; update items set power=0']) {
      const r = await query({ table: 'items', where: frag })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/写操作关键字|非法字符/)
    }
  })

  it('排序里出现注释/分号 → 拒绝', async () => {
    const r = await query({ table: 'items', order: 'power DESC -- x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法字符')
  })

  it('筛选条件用引号字面量 → 提示改用 ? 占位符', async () => {
    const r = await query({ table: 'items', where: "type = 'weapon'" })
    expect(r.success).toBe(false)
    expect(r.error).toContain('不能写引号字面量')
    expect(r.error).toContain('?')
  })

  it('库文件不存在 → 报期望路径，并列出项目里已有的配置表', async () => {
    const r = await query({ table: 'not_exists' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('找不到配置表「not_exists」')
    expect(r.error).toContain('data/config/not_exists.db')
    expect(r.error).toContain('items') // 已有表清单，避免"猜表名"
  })

  it('hctx 缺 projectPath 时回退到 QQBOT_PROJECT_ROOT（两条项目根的来源都认）', async () => {
    // 运行时正常会给 projectPath；但无头运行（standalone.js）没有 hctx，只能靠环境变量。
    // 这条断言锁住"回退链存在"，否则无头环境下所有配置表节点都会静默查不到。
    const r = await query({ table: 'items' }, false)
    expect(r.success).toBe(true)
    expect(r.count).toBe(3)
  })

  it('两条根都没有 → 明确报"找不到配置表"，不抛异常也不静默成功', async () => {
    const saved = process.env.QQBOT_PROJECT_ROOT
    delete process.env.QQBOT_PROJECT_ROOT
    try {
      const r = await query({ table: 'items' }, false)
      expect(r.success).toBe(false)
      expect(r.error).toContain('找不到配置表')
    } finally {
      process.env.QQBOT_PROJECT_ROOT = saved
    }
  })

  it('失败时 rows/count 一定是空值，不会把 undefined 漏给下游', async () => {
    const r = await query({ table: '' })
    expect(r.rows).toEqual([])
    expect(r.count).toBe(0)
    expect(r.first).toBeNull()
    expect(r.value).toBeNull()
  })
})
