// tests/main/services/dataService.test.ts
// dataService 单元测试：覆盖数据库连接池、schema 推断、分页查询、CRUD、
// 玩家聚合查询、索引管理、schema 元数据写入。
//
// 测试策略：
// - 使用 better-sqlite3 兼容替身（node:sqlite），见文件顶部 vi.mock 说明
// - beforeEach 创建临时项目目录（含 data/players/ 和 data/config/ 子目录）
// - afterEach 调用 invalidateDb 清理缓存连接，再删除临时目录
//   （避免连接池持有已删除文件的句柄导致 Windows 上 rm 失败）
// - 每个测试用独立的 tmpDir 路径，连接池缓存不会跨测试干扰
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// 本机 better-sqlite3 只有 Electron ABI，纯 Node 的 vitest 加载不了原生绑定
// （Could not locate the bindings file…）。这里把模块换成 node:sqlite 实现的等价替身：
// SQL 语义（建表/事务/pragma/参数绑定）仍由 SQLite 引擎执行，只是换了加载方式。
vi.mock('better-sqlite3', async () => {
  const { makeSqliteShim } = await import('../../helpers/sqliteShim.js')
  return { default: makeSqliteShim() }
})
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getDb,
  getOrCreateDb,
  invalidateDb,
  listDataSources,
  getSchema,
  queryTable,
  insertRecord,
  updateRecord,
  deleteRecord,
  queryPlayerTables,
  listPlayers,
  searchPlayer,
  ensureIndexes,
  saveSchema
} from '@main/services/dataService'

let tmpDir: string
const createdDbPaths: string[] = []

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qqbat-data-'))
  await mkdir(join(tmpDir, 'data', 'players'), { recursive: true })
  await mkdir(join(tmpDir, 'data', 'config'), { recursive: true })
  createdDbPaths.length = 0
})

afterEach(async () => {
  // 先清理缓存连接，再删除临时目录，避免 Windows 上文件句柄占用导致 rm 失败
  for (const p of createdDbPaths) {
    invalidateDb(p)
  }
  await rm(tmpDir, { recursive: true, force: true })
})

/** 在 data/players/ 下注册一个 db 路径（用于 afterEach 清理连接缓存） */
function trackDb(name: string = 'test.db'): string {
  const p = join(tmpDir, 'data', 'players', name)
  if (!createdDbPaths.includes(p)) createdDbPaths.push(p)
  return p
}

/** 创建一个含 players 表的 .db 文件（qq/nickname/level/gold 四列），返回路径 */
function createPlayersDb(name: string = 'test.db'): string {
  const p = trackDb(name)
  getOrCreateDb(p, (d) => {
    d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT, level INTEGER, gold REAL)').run()
  })
  return p
}

describe('getDb / getOrCreateDb', () => {
  it('getOrCreateDb 首次创建：文件不存在时自动创建并执行 initFn', () => {
    const p = trackDb('create.db')
    expect(existsSync(p)).toBe(false)
    const db = getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE t (id INTEGER)').run()
    })
    expect(existsSync(p)).toBe(true)
    // initFn 已执行：表存在
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'").get()).toBeTruthy()
  })

  it('getOrCreateDb 缓存命中：返回同一连接实例', () => {
    const p = trackDb('cache.db')
    const db1 = getOrCreateDb(p)
    const db2 = getOrCreateDb(p)
    expect(db2).toBe(db1)
  })

  it('getDb 缓存命中：复用 getOrCreateDb 创建的连接', () => {
    const p = trackDb('cache2.db')
    const db1 = getOrCreateDb(p)
    const db2 = getDb(p)
    expect(db2).toBe(db1)
  })

  it('getDb 首次访问已存在文件：创建新连接', () => {
    const p = trackDb('exists.db')
    getOrCreateDb(p) // 创建文件 + 缓存
    invalidateDb(p) // 清除缓存，但文件仍存在
    expect(existsSync(p)).toBe(true)
    const db = getDb(p)
    expect(db).toBeDefined()
    expect(typeof db.prepare).toBe('function')
  })

  it('getDb 文件不存在时抛错', () => {
    const p = join(tmpDir, 'data', 'players', 'nonexistent.db')
    expect(() => getDb(p)).toThrow('数据库文件不存在')
  })

  it('getOrCreateDb 缓存命中时不重复执行 initFn（幂等）', () => {
    const p = trackDb('idempotent.db')
    let initCallCount = 0
    getOrCreateDb(p, (d) => {
      initCallCount++
      d.prepare('CREATE TABLE t (id INTEGER)').run()
    })
    getOrCreateDb(p, (d) => {
      initCallCount++ // 缓存命中时不应执行
      d.prepare('CREATE TABLE should_not_exist (id INTEGER)').run()
    })
    expect(initCallCount).toBe(1)
    const db = getDb(p)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='should_not_exist'").get()
    ).toBeUndefined()
  })
})

describe('invalidateDb', () => {
  it('移除缓存连接：下次 getDb 返回新实例', () => {
    const p = trackDb('invalidate.db')
    const db1 = getOrCreateDb(p)
    invalidateDb(p)
    const db2 = getDb(p) // 文件已存在，getDb 重新打开
    expect(db2).not.toBe(db1)
  })

  it('invalidateDb 对未缓存的路径不报错', () => {
    const p = join(tmpDir, 'data', 'players', 'never-cached.db')
    expect(() => invalidateDb(p)).not.toThrow()
  })
})

describe('listDataSources', () => {
  it('空目录返回 []', () => {
    expect(listDataSources(tmpDir)).toEqual([])
  })

  it('data/players 目录不存在时返回 []', async () => {
    const emptyTmp = await mkdtemp(join(tmpdir(), 'qqbat-empty-'))
    try {
      expect(listDataSources(emptyTmp)).toEqual([])
    } finally {
      await rm(emptyTmp, { recursive: true, force: true })
    }
  })

  it('识别 .db/.sqlite/.json/.yaml 格式，跳过其他扩展名和目录', async () => {
    const playersDir = join(tmpDir, 'data', 'players')
    await writeFile(join(playersDir, 'a.db'), '')
    await writeFile(join(playersDir, 'b.sqlite'), '')
    await writeFile(join(playersDir, 'c.json'), '{}')
    await writeFile(join(playersDir, 'd.yaml'), 'key: value')
    await writeFile(join(playersDir, 'e.txt'), 'ignored') // 非数据源格式
    await mkdir(join(playersDir, 'subdir')) // 目录应被跳过

    const sources = listDataSources(tmpDir)
    expect(sources).toHaveLength(4)
    const byName = Object.fromEntries(sources.map((s) => [s.name, s]))
    expect(byName['a.db'].format).toBe('sqlite')
    expect(byName['b.sqlite'].format).toBe('sqlite')
    expect(byName['c.json'].format).toBe('json')
    expect(byName['d.yaml'].format).toBe('yaml')
    expect(byName['e.txt']).toBeUndefined()
    // 路径为绝对路径
    expect(byName['a.db'].path).toBe(join(playersDir, 'a.db'))
  })
})

describe('getSchema', () => {
  it('从 PRAGMA 推断 schema（无 .schema 目录时回退）', () => {
    const p = createPlayersDb('schema.db')
    const schemas = getSchema(p)
    expect(schemas).toHaveLength(1)
    expect(schemas[0].name).toBe('players')
    const fieldMap = Object.fromEntries(
      schemas[0].fields.map((f: { name: string; type: string }) => [f.name, f.type]),
    )
    expect(fieldMap['qq']).toBe('text')
    expect(fieldMap['nickname']).toBe('text')
    expect(fieldMap['level']).toBe('int')
    expect(fieldMap['gold']).toBe('float')
  })

  it('识别 INT/REAL/TEXT/BOOL 类型，BLOB 回退为 string', () => {
    const p = trackDb('types.db')
    getOrCreateDb(p, (d) => {
      d.prepare(
        'CREATE TABLE typed (id INT, score REAL, name TEXT, active BOOLEAN, note BLOB)'
      ).run()
    })
    const schemas = getSchema(p)
    const table = schemas.find((s: { name: string }) => s.name === 'typed')
    expect(table).toBeDefined()
    const fieldMap = Object.fromEntries(
      table!.fields.map((f: { name: string; type: string }) => [f.name, f.type]),
    )
    expect(fieldMap['id']).toBe('int')
    expect(fieldMap['score']).toBe('float')
    expect(fieldMap['name']).toBe('text')
    expect(fieldMap['active']).toBe('bool')
    expect(fieldMap['note']).toBe('string') // BLOB 不匹配任何已知类型
  })
})

describe('queryTable', () => {
  function seedFiveRows(): string {
    const p = createPlayersDb('paginate.db')
    for (let i = 1; i <= 5; i++) {
      insertRecord(p, 'players', {
        qq: String(100 + i),
        nickname: `p${i}`,
        level: i,
        gold: i * 1.5
      })
    }
    return p
  }

  it('传统 OFFSET 分页：page 1 返回前 2 行', () => {
    const p = seedFiveRows()
    const res = queryTable(p, 'players', 1, 2)
    expect(res.total).toBe(5)
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].nickname).toBe('p1')
    expect(res.rows[1].nickname).toBe('p2')
  })

  it('OFFSET 分页 nextCursor：满页时返回最后一行 rowid', () => {
    const p = seedFiveRows()
    const res = queryTable(p, 'players', 1, 2)
    expect(res.nextCursor).toBe(res.rows[1].rowid)
  })

  it('OFFSET 分页 nextCursor：末页不足 pageSize 时为 null', () => {
    const p = seedFiveRows()
    const res = queryTable(p, 'players', 3, 2) // 第 3 页，只剩 1 行
    expect(res.rows).toHaveLength(1)
    expect(res.nextCursor).toBeNull()
  })

  it('Keyset 分页：传入 cursor 返回下一页', () => {
    const p = seedFiveRows()
    const page1 = queryTable(p, 'players', 1, 2)
    expect(page1.rows).toHaveLength(2)
    // 用 page1 的 nextCursor 取下一页
    const page2 = queryTable(p, 'players', 1, 2, page1.nextCursor!)
    expect(page2.rows).toHaveLength(2)
    expect(page2.rows[0].nickname).toBe('p3')
    expect(page2.rows[1].nickname).toBe('p4')
  })

  it('Keyset 分页：末页结果不足 pageSize 时 nextCursor 为 null', () => {
    const p = seedFiveRows()
    // 跳过前 4 行，只剩第 5 行
    const res = queryTable(p, 'players', 1, 2, 4)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].nickname).toBe('p5')
    expect(res.nextCursor).toBeNull()
  })

  it('cursor=0 时启用 keyset 分页（从第 1 行开始）', () => {
    const p = seedFiveRows()
    const res = queryTable(p, 'players', 1, 2, 0)
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].nickname).toBe('p1')
    expect(res.nextCursor).toBe(res.rows[1].rowid)
  })
})

describe('insertRecord + queryTable', () => {
  it('插入后能查到', () => {
    const p = createPlayersDb('insert.db')
    const rowid = insertRecord(p, 'players', {
      qq: '999',
      nickname: 'Alice',
      level: 10,
      gold: 99.5
    })
    expect(rowid).toBeGreaterThan(0)
    const res = queryTable(p, 'players', 1, 10)
    expect(res.total).toBe(1)
    expect(res.rows[0].qq).toBe('999')
    expect(res.rows[0].nickname).toBe('Alice')
    expect(res.rows[0].level).toBe(10)
    expect(res.rows[0].gold).toBe(99.5)
    expect(res.rows[0].rowid).toBe(rowid)
  })
})

describe('updateRecord', () => {
  it('更新后查询验证：已更新字段变化，未更新字段保持', () => {
    const p = createPlayersDb('update.db')
    const rowid = insertRecord(p, 'players', {
      qq: '999',
      nickname: 'Alice',
      level: 1,
      gold: 0
    })
    updateRecord(p, 'players', rowid, { nickname: 'Bob', level: 99 })
    const res = queryTable(p, 'players', 1, 10)
    expect(res.rows[0].nickname).toBe('Bob')
    expect(res.rows[0].level).toBe(99)
    expect(res.rows[0].qq).toBe('999') // 未更新
    expect(res.rows[0].gold).toBe(0) // 未更新
  })
})

describe('deleteRecord', () => {
  it('删除后查询验证：记录数减少，剩余记录正确', () => {
    const p = createPlayersDb('delete.db')
    const id1 = insertRecord(p, 'players', { qq: '1', nickname: 'A', level: 1, gold: 0 })
    insertRecord(p, 'players', { qq: '2', nickname: 'B', level: 2, gold: 0 })
    deleteRecord(p, 'players', id1)
    const res = queryTable(p, 'players', 1, 10)
    expect(res.total).toBe(1)
    expect(res.rows[0].nickname).toBe('B')
  })
})

describe('queryPlayerTables', () => {
  it('按 QQ 号查询：返回含 qq/user_id 字段的表数据', () => {
    const p = trackDb('qp.db')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT)').run()
      d.prepare('CREATE TABLE scores (user_id TEXT, score INTEGER)').run()
      d.prepare('CREATE TABLE logs (msg TEXT)').run() // 无 QQ 字段，应跳过
    })
    insertRecord(p, 'players', { qq: '123', nickname: 'Alice' })
    insertRecord(p, 'players', { qq: '456', nickname: 'Bob' })
    insertRecord(p, 'scores', { user_id: '123', score: 100 })

    const result = queryPlayerTables(p, '123')
    expect(result).toHaveLength(2) // players + scores，logs 被跳过
    const playersTable = result.find((r) => r.table === 'players')
    expect(playersTable).toBeDefined()
    expect(playersTable!.rows).toHaveLength(1)
    expect(playersTable!.rows[0].nickname).toBe('Alice')
    const scoresTable = result.find((r) => r.table === 'scores')
    expect(scoresTable).toBeDefined()
    expect(scoresTable!.rows[0].score).toBe(100)
  })

  it('无 qq/user_id/qq_number 字段时跳过该表', () => {
    const p = trackDb('noskip.db')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE settings (key TEXT, value TEXT)').run() // 无 QQ 字段
      d.prepare('CREATE TABLE meta (qq_number TEXT, info TEXT)').run() // qq_number 也应识别
    })
    insertRecord(p, 'meta', { qq_number: '789', info: 'x' })
    const result = queryPlayerTables(p, '789')
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('meta')
  })
})

describe('listPlayers', () => {
  it('聚合多个数据源的玩家并按 recordCount 降序', () => {
    // db1: players 表 (qq 字段)，2 条 qq=123，1 条 qq=456
    const p1 = trackDb('db1.db')
    getOrCreateDb(p1, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT)').run()
    })
    insertRecord(p1, 'players', { qq: '123', nickname: 'A' })
    insertRecord(p1, 'players', { qq: '123', nickname: 'A2' })
    insertRecord(p1, 'players', { qq: '456', nickname: 'B' })

    // db2: characters 表 (user_id 字段)，3 条 user_id=123
    const p2 = trackDb('db2.db')
    getOrCreateDb(p2, (d) => {
      d.prepare('CREATE TABLE characters (user_id TEXT, name TEXT)').run()
    })
    insertRecord(p2, 'characters', { user_id: '123', name: 'c1' })
    insertRecord(p2, 'characters', { user_id: '123', name: 'c2' })
    insertRecord(p2, 'characters', { user_id: '123', name: 'c3' })

    const players = listPlayers(tmpDir)
    expect(players).toHaveLength(2)
    // 123: db1(2) + db2(3) = 5; 456: db1(1) = 1
    expect(players[0].qq).toBe('123')
    expect(players[0].recordCount).toBe(5)
    expect(players[0].sources).toContain('db1.db')
    expect(players[0].sources).toContain('db2.db')
    expect(players[1].qq).toBe('456')
    expect(players[1].recordCount).toBe(1)
    expect(players[1].sources).toEqual(['db1.db'])
  })

  it('data/players 不存在时返回 []', async () => {
    const emptyTmp = await mkdtemp(join(tmpdir(), 'qqbat-noplayers-'))
    try {
      expect(listPlayers(emptyTmp)).toEqual([])
    } finally {
      await rm(emptyTmp, { recursive: true, force: true })
    }
  })
})

describe('searchPlayer', () => {
  beforeEach(() => {
    const p = trackDb('search.db')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT)').run()
    })
    insertRecord(p, 'players', { qq: '123', nickname: 'Alice' })
    insertRecord(p, 'players', { qq: '456', nickname: 'Bob the Builder' })
    insertRecord(p, 'players', { qq: '789', nickname: 'Charlie' })
  })

  it('精确匹配 QQ 号', () => {
    const results = searchPlayer(tmpDir, '123')
    expect(results).toHaveLength(1)
    expect(results[0].row.nickname).toBe('Alice')
    expect(results[0].table).toBe('players')
    expect(results[0].source).toBe('search.db')
  })

  it('模糊匹配昵称（LIKE %query%）', () => {
    const results = searchPlayer(tmpDir, 'Bob')
    expect(results).toHaveLength(1)
    expect(results[0].row.nickname).toBe('Bob the Builder')
  })

  it('QQ 精确匹配与昵称模糊匹配不重复（同一行去重）', () => {
    // dup.db 中 qq='123' nickname='user123'，query='123' 同时命中 QQ 精确和昵称 LIKE
    const p = trackDb('dup.db')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT)').run()
    })
    insertRecord(p, 'players', { qq: '123', nickname: 'user123' })

    const results = searchPlayer(tmpDir, '123')
    const dupResults = results.filter((r) => r.source === 'dup.db')
    // 同一行应只出现一次（QQ 精确匹配优先，昵称 LIKE 去重）
    expect(dupResults).toHaveLength(1)
    expect(dupResults[0].row.nickname).toBe('user123')
  })
})

describe('ensureIndexes', () => {
  it('为 qq 字段创建索引 idx_<table>_qq', () => {
    const p = trackDb('idx.db')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT)').run()
    })
    ensureIndexes(p)
    const db = getDb(p)
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_players_qq'")
      .all() as { name: string }[]
    expect(indexes).toHaveLength(1)
    expect(indexes[0].name).toBe('idx_players_qq')
  })

  it('幂等：重复调用不报错且不创建重复索引', () => {
    const p = trackDb('idem.db')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT, nickname TEXT)').run()
    })
    expect(() => ensureIndexes(p)).not.toThrow()
    expect(() => ensureIndexes(p)).not.toThrow()
    const db = getDb(p)
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_players_qq'")
      .all() as { name: string }[]
    expect(indexes).toHaveLength(1) // 仍只有一个索引
  })

  it('非 .db 文件（如 .sqlite）不创建索引', () => {
    const p = trackDb('skip.sqlite')
    getOrCreateDb(p, (d) => {
      d.prepare('CREATE TABLE players (qq TEXT)').run()
    })
    ensureIndexes(p) // 应直接返回（endsWith('.db') 为 false）
    const db = getDb(p)
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    expect(indexes).toHaveLength(0)
  })
})

describe('saveSchema', () => {
  it('写入 schema 元数据文件到 data/config/.schema/', () => {
    const fields = {
      qq: { type: 'string', label: 'QQ号' },
      nickname: { type: 'string', label: '昵称' },
      level: { type: 'int', label: '等级', min: 1 }
    }
    const filePath = saveSchema(tmpDir, 'players', fields)
    expect(existsSync(filePath)).toBe(true)
    expect(filePath).toBe(join(tmpDir, 'data', 'config', '.schema', 'players.schema.json'))
    const content = JSON.parse(readFileSync(filePath, 'utf-8'))
    expect(content.table).toBe('players')
    expect(content.fields.qq).toEqual(fields.qq)
    expect(content.fields.nickname).toEqual(fields.nickname)
    expect(content.fields.level).toEqual(fields.level)
  })

  it('data/config/.schema 目录不存在时自动创建', () => {
    // saveSchema 内部会 mkdirSync recursive
    const filePath = saveSchema(tmpDir, 'newtable', { id: { type: 'int' } })
    expect(existsSync(filePath)).toBe(true)
    expect(existsSync(join(tmpDir, 'data', 'config', '.schema'))).toBe(true)
  })
})
