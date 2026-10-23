// tests/main/services/configService.test.ts
// configService 单元测试：覆盖拼音表名转换、配置分类枚举、CRUD、表结构管理
// （建表/删表/重命名/改表结构）。
//
// 测试策略：
// - 使用 better-sqlite3 兼容替身（node:sqlite），见文件顶部 vi.mock 说明
// - beforeEach 创建临时项目目录（含 data/config/ 子目录）
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
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  toPinyinTableName,
  listConfigCategories,
  getConfigTable,
  getConfigSchema,
  updateConfigRecord,
  insertConfigRecord,
  deleteConfigRecord,
  createConfigTable,
  dropConfigTable,
  renameConfigTable,
  alterConfigTable,
  type FieldDefinition
} from '@main/services/configService'
import { getOrCreateDb, invalidateDb, getDb } from '@main/services/dataService'

let tmpDir: string
const trackedPaths: string[] = []

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qqbat-cfg-'))
  await mkdir(join(tmpDir, 'data', 'config'), { recursive: true })
  trackedPaths.length = 0
})

afterEach(async () => {
  // 先清理缓存连接，再删除临时目录，避免 Windows 上文件句柄占用导致 rm 失败
  for (const p of trackedPaths) {
    invalidateDb(p)
  }
  await rm(tmpDir, { recursive: true, force: true })
})

/** 注册一个 db 路径（用于 afterEach 清理连接缓存） */
function track(path: string): string {
  if (!trackedPaths.includes(path)) trackedPaths.push(path)
  return path
}

/** 在 data/config/ 下注册一个 db 路径 */
function trackDb(name: string): string {
  return track(join(tmpDir, 'data', 'config', name))
}

/** 创建一个含指定表的 .db 文件，返回路径 */
function createConfigDb(fileName: string, tableName: string, columnDefs: string): string {
  const p = trackDb(fileName)
  getOrCreateDb(p, (d) => {
    d.prepare(`CREATE TABLE ${tableName} (${columnDefs})`).run()
  })
  return p
}

// ==================== toPinyinTableName ====================

describe('toPinyinTableName', () => {
  it('中文转拼音表名（全小写）', () => {
    // pinyin-pro 逐字转换，不启用分词，音节之间不插入下划线
    expect(toPinyinTableName('装备配置')).toBe('zhuangbeipeizhi')
  })

  it('英文部分原样保留并转小写', () => {
    expect(toPinyinTableName('VIP配置')).toBe('vippeizhi')
    expect(toPinyinTableName('Equipment')).toBe('equipment')
  })

  it('空字符串兜底为 table_ 前缀', () => {
    const result = toPinyinTableName('')
    expect(result.startsWith('table_')).toBe(true)
  })

  it('结果只含小写字母、数字、下划线', () => {
    const cases = ['装备配置', 'VIP配置', 'Equipment', 'Test123']
    for (const c of cases) {
      expect(toPinyinTableName(c)).toMatch(/^[a-z0-9_]+$/)
    }
  })
})

// ==================== listConfigCategories ====================

describe('listConfigCategories', () => {
  it('空目录返回 []', () => {
    expect(listConfigCategories(tmpDir)).toEqual([])
  })

  it('data/config 目录不存在时返回 []', async () => {
    const emptyTmp = await mkdtemp(join(tmpdir(), 'qqbat-empty-'))
    try {
      expect(listConfigCategories(emptyTmp)).toEqual([])
    } finally {
      await rm(emptyTmp, { recursive: true, force: true })
    }
  })

  it('识别 .db/.sqlite/.json 格式，跳过其他扩展名和目录', async () => {
    const configDir = join(tmpDir, 'data', 'config')

    // .db 文件（含 1 张表）
    const dbPath = trackDb('equipment.db')
    getOrCreateDb(dbPath, (d) => {
      d.prepare('CREATE TABLE equipment (id INTEGER PRIMARY KEY, name TEXT)').run()
    })

    // .json 文件
    await writeFile(join(configDir, 'items.json'), '[]')

    // 无效扩展名（应跳过）
    await writeFile(join(configDir, 'notes.txt'), 'ignore me')

    // 子目录（应跳过）
    await mkdir(join(configDir, 'subdir'))

    const categories = listConfigCategories(tmpDir)
    expect(categories).toHaveLength(2)

    const byName = Object.fromEntries(categories.map((c) => [c.name, c]))
    expect(byName['equipment']).toBeDefined()
    expect(byName['equipment'].file).toBe('equipment.db')
    expect(byName['equipment'].tableCount).toBe(1)
    expect(byName['items']).toBeDefined()
    expect(byName['items'].file).toBe('items.json')
  })

  it('displayName 从 .meta 文件读取', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    const dbPath = trackDb('custom.db')
    getOrCreateDb(dbPath, (d) => {
      d.prepare('CREATE TABLE custom (id INTEGER PRIMARY KEY)').run()
    })

    // 写 .meta 文件覆盖 displayName
    await mkdir(join(configDir, '.meta'))
    await writeFile(
      join(configDir, '.meta', 'custom.meta.json'),
      JSON.stringify({ table: 'custom', displayName: '自定义配置' })
    )

    const categories = listConfigCategories(tmpDir)
    expect(categories).toHaveLength(1)
    expect(categories[0].displayName).toBe('自定义配置')
  })

  it('displayName 从 .schema 文件读取（无 .meta 时回退）', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    const dbPath = trackDb('custom.db')
    getOrCreateDb(dbPath, (d) => {
      d.prepare('CREATE TABLE custom (id INTEGER PRIMARY KEY)').run()
    })

    // 仅写 .schema 文件（不写 .meta），displayName 应从 schema 读取
    await mkdir(join(configDir, '.schema'))
    await writeFile(
      join(configDir, '.schema', 'custom.schema.json'),
      JSON.stringify({ table: 'custom', displayName: 'Schema显示名', fields: {} })
    )

    const categories = listConfigCategories(tmpDir)
    expect(categories).toHaveLength(1)
    expect(categories[0].displayName).toBe('Schema显示名')
  })

  it('displayName 回退到内置映射表', () => {
    // 'equipment' 在 CONFIG_DISPLAY_NAMES 中映射为 '装备配置'
    const dbPath = trackDb('equipment.db')
    getOrCreateDb(dbPath, (d) => {
      d.prepare('CREATE TABLE equipment (id INTEGER PRIMARY KEY)').run()
    })

    const categories = listConfigCategories(tmpDir)
    expect(categories).toHaveLength(1)
    expect(categories[0].displayName).toBe('装备配置')
  })

  it('displayName 回退到 baseName（无映射且无 meta）', () => {
    const dbPath = trackDb('unknown_table.db')
    getOrCreateDb(dbPath, (d) => {
      d.prepare('CREATE TABLE unknown_table (id INTEGER PRIMARY KEY)').run()
    })

    const categories = listConfigCategories(tmpDir)
    expect(categories).toHaveLength(1)
    expect(categories[0].displayName).toBe('unknown_table')
  })
})

// ==================== getConfigTable ====================

describe('getConfigTable', () => {
  it('分页查询 .db 文件', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY, name TEXT, atk INTEGER')
    const db = getDb(join(tmpDir, 'data', 'config', 'equipment.db'))
    for (let i = 1; i <= 5; i++) {
      db.prepare('INSERT INTO equipment (name, atk) VALUES (?, ?)').run(`item${i}`, i * 10)
    }

    // 第 1 页（2 条）
    const res1 = getConfigTable(tmpDir, 'equipment', 1, 2)
    expect(res1.total).toBe(5)
    expect(res1.rows).toHaveLength(2)
    expect(res1.rows[0].name).toBe('item1')
    expect(res1.rows[1].name).toBe('item2')

    // 第 3 页（1 条）
    const res3 = getConfigTable(tmpDir, 'equipment', 3, 2)
    expect(res3.rows).toHaveLength(1)
    expect(res3.rows[0].name).toBe('item5')
  })

  it('查询 JSON 数组文件', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    const data = [
      { id: 1, name: 'sword' },
      { id: 2, name: 'shield' },
      { id: 3, name: 'potion' }
    ]
    await writeFile(join(configDir, 'items.json'), JSON.stringify(data))

    const res = getConfigTable(tmpDir, 'items', 1, 2)
    expect(res.total).toBe(3)
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].name).toBe('sword')
    expect(res.rows[1].name).toBe('shield')
  })

  it('查询 JSON 对象文件（转为 key-value 行）', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    const data = { server_name: 'MyServer', max_players: 100 }
    await writeFile(join(configDir, 'global.json'), JSON.stringify(data))

    const res = getConfigTable(tmpDir, 'global', 1, 10)
    expect(res.total).toBe(2)
    const byKey = Object.fromEntries(res.rows.map((r) => [r.key, r.value]))
    expect(byKey['server_name']).toBe('MyServer')
    expect(byKey['max_players']).toBe(100)
  })

  it('page 非正整数时抛错', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY')

    expect(() => getConfigTable(tmpDir, 'equipment', 0, 10)).toThrow('page 必须为正整数')
    expect(() => getConfigTable(tmpDir, 'equipment', -1, 10)).toThrow('page 必须为正整数')
    expect(() => getConfigTable(tmpDir, 'equipment', 1.5, 10)).toThrow('page 必须为正整数')
  })

  it('pageSize 非正整数时抛错', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY')

    expect(() => getConfigTable(tmpDir, 'equipment', 1, 0)).toThrow('pageSize 必须为正整数')
    expect(() => getConfigTable(tmpDir, 'equipment', 1, -5)).toThrow('pageSize 必须为正整数')
    expect(() => getConfigTable(tmpDir, 'equipment', 1, 2.5)).toThrow('pageSize 必须为正整数')
  })
})

// ==================== getConfigSchema ====================

describe('getConfigSchema', () => {
  it('返回 .db 文件的 schema', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY, name TEXT, atk INTEGER')

    const schemas = getConfigSchema(tmpDir, 'equipment')
    expect(schemas).toHaveLength(1)
    expect(schemas[0].name).toBe('equipment')
    const fieldNames = schemas[0].fields.map((f) => f.name)
    expect(fieldNames).toContain('id')
    expect(fieldNames).toContain('name')
    expect(fieldNames).toContain('atk')
  })

  it('JSON 文件返回空 schema', async () => {
    await writeFile(join(tmpDir, 'data', 'config', 'items.json'), '[]')
    const schemas = getConfigSchema(tmpDir, 'items')
    expect(schemas).toEqual([])
  })
})

// ==================== updateConfigRecord ====================

describe('updateConfigRecord', () => {
  it('更新 .db 记录', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY, name TEXT, atk INTEGER')
    const db = getDb(join(tmpDir, 'data', 'config', 'equipment.db'))
    const info = db.prepare('INSERT INTO equipment (name, atk) VALUES (?, ?)').run('sword', 10)
    const rowid = Number(info.lastInsertRowid)

    updateConfigRecord(tmpDir, 'equipment', rowid, { atk: 99 })

    const row = db.prepare('SELECT * FROM equipment WHERE rowid = ?').get(rowid) as {
      name: string
      atk: number
    }
    expect(row.atk).toBe(99)
    expect(row.name).toBe('sword') // 未更新字段保持不变
  })

  it('更新 JSON 数组记录（按 id 匹配）', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    const data = [
      { id: 1, name: 'sword' },
      { id: 2, name: 'shield' }
    ]
    await writeFile(join(configDir, 'items.json'), JSON.stringify(data))

    updateConfigRecord(tmpDir, 'items', 1, { name: 'upgraded_sword' })

    const updated = JSON.parse(readFileSync(join(configDir, 'items.json'), 'utf-8'))
    expect(updated[0].name).toBe('upgraded_sword')
    expect(updated[1].name).toBe('shield')
  })

  it('更新 JSON 对象记录', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    await writeFile(
      join(configDir, 'global.json'),
      JSON.stringify({ server_name: 'Old', max: 10 })
    )

    updateConfigRecord(tmpDir, 'global', 1, { server_name: 'New' })

    const updated = JSON.parse(readFileSync(join(configDir, 'global.json'), 'utf-8'))
    expect(updated.server_name).toBe('New')
    expect(updated.max).toBe(10) // 未更新字段保持不变
  })

  it('rowid 非正整数时抛错', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY')

    expect(() => updateConfigRecord(tmpDir, 'equipment', 0, {})).toThrow('rowid 必须为正整数')
    expect(() => updateConfigRecord(tmpDir, 'equipment', -1, {})).toThrow('rowid 必须为正整数')
    expect(() => updateConfigRecord(tmpDir, 'equipment', 1.5, {})).toThrow('rowid 必须为正整数')
  })
})

// ==================== insertConfigRecord ====================

describe('insertConfigRecord', () => {
  it('插入 .db 记录（返回 rowid）', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY, name TEXT, atk INTEGER')

    const rowid = insertConfigRecord(tmpDir, 'equipment', { name: 'sword', atk: 10 })
    expect(rowid).toBeGreaterThan(0)

    const res = getConfigTable(tmpDir, 'equipment', 1, 10)
    expect(res.total).toBe(1)
    expect(res.rows[0].name).toBe('sword')
    expect(res.rows[0].atk).toBe(10)
  })

  it('插入 JSON 数组记录（返回索引）', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    await writeFile(join(configDir, 'items.json'), JSON.stringify([{ id: 1, name: 'sword' }]))

    const index = insertConfigRecord(tmpDir, 'items', { id: 2, name: 'shield' })
    expect(index).toBe(1)

    const updated = JSON.parse(readFileSync(join(configDir, 'items.json'), 'utf-8'))
    expect(updated).toHaveLength(2)
    expect(updated[1].name).toBe('shield')
  })

  it('插入 JSON 对象记录（返回 0）', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    await writeFile(join(configDir, 'global.json'), JSON.stringify({ a: 1 }))

    const result = insertConfigRecord(tmpDir, 'global', { b: 2 })
    expect(result).toBe(0)
  })
})

// ==================== deleteConfigRecord ====================

describe('deleteConfigRecord', () => {
  it('删除 .db 记录', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY, name TEXT')
    const rowid1 = insertConfigRecord(tmpDir, 'equipment', { name: 'sword' })
    const rowid2 = insertConfigRecord(tmpDir, 'equipment', { name: 'shield' })

    deleteConfigRecord(tmpDir, 'equipment', rowid1)

    const res = getConfigTable(tmpDir, 'equipment', 1, 10)
    expect(res.total).toBe(1)
    expect(res.rows[0].name).toBe('shield')
    // 表声明了 INTEGER PRIMARY KEY，rowid 别名为 id 列
    expect(res.rows[0].id).toBe(rowid2)
  })

  it('删除 JSON 记录为空操作（不抛错）', async () => {
    const configDir = join(tmpDir, 'data', 'config')
    await writeFile(join(configDir, 'items.json'), JSON.stringify([{ id: 1, name: 'sword' }]))

    // JSON 文件的 deleteConfigRecord 是 no-op
    expect(() => deleteConfigRecord(tmpDir, 'items', 1)).not.toThrow()

    const updated = JSON.parse(readFileSync(join(configDir, 'items.json'), 'utf-8'))
    expect(updated).toHaveLength(1) // 记录仍在
  })

  it('rowid 非正整数时抛错', () => {
    createConfigDb('equipment.db', 'equipment', 'id INTEGER PRIMARY KEY')

    expect(() => deleteConfigRecord(tmpDir, 'equipment', 0)).toThrow('rowid 必须为正整数')
    expect(() => deleteConfigRecord(tmpDir, 'equipment', -1)).toThrow('rowid 必须为正整数')
    expect(() => deleteConfigRecord(tmpDir, 'equipment', 1.5)).toThrow('rowid 必须为正整数')
  })
})

// ==================== createConfigTable ====================

describe('createConfigTable', () => {
  it('创建新表（生成 .db + schema + meta 文件）', () => {
    const fields: FieldDefinition[] = [
      { name: 'name', label: '名称', type: 'text' },
      { name: 'level', label: '等级', type: 'integer', defaultValue: 1 }
    ]

    const { tableName, filePath } = createConfigTable(tmpDir, '技能配置', fields)
    track(filePath)

    expect(tableName).toBe('jinengpeizhi')
    expect(filePath).toBe(join(tmpDir, 'data', 'config', 'jinengpeizhi.db'))
    expect(existsSync(filePath)).toBe(true)

    // 验证 .db 中有对应表
    const db = getDb(filePath)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jinengpeizhi'")
      .all()
    expect(tables).toHaveLength(1)

    // 验证 schema 元数据文件
    const schemaFile = join(tmpDir, 'data', 'config', '.schema', 'jinengpeizhi.schema.json')
    expect(existsSync(schemaFile)).toBe(true)
    const schema = JSON.parse(readFileSync(schemaFile, 'utf-8'))
    expect(schema.table).toBe('jinengpeizhi')
    expect(schema.displayName).toBe('技能配置')

    // 验证 meta 文件
    const metaFile = join(tmpDir, 'data', 'config', '.meta', 'jinengpeizhi.meta.json')
    expect(existsSync(metaFile)).toBe(true)
    const meta = JSON.parse(readFileSync(metaFile, 'utf-8'))
    expect(meta.displayName).toBe('技能配置')
  })

  it('表已存在时抛错', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]

    const { filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    expect(() => createConfigTable(tmpDir, '装备配置', fields)).toThrow('表已存在')
  })

  it('字段为空时抛错', () => {
    expect(() => createConfigTable(tmpDir, '空配置', [])).toThrow('至少需要定义一个字段')
  })

  it('非法字段名时抛错', () => {
    // 字段名以数字开头，不匹配 ^[A-Za-z_][A-Za-z0-9_]*$
    const fields: FieldDefinition[] = [
      { name: '1invalid', label: '非法', type: 'text' }
    ]
    expect(() => createConfigTable(tmpDir, '测试配置', fields)).toThrow('非法字段名')
  })
})

// ==================== dropConfigTable ====================

describe('dropConfigTable', () => {
  it('删除表（含 .db + schema + meta 文件）', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    expect(existsSync(filePath)).toBe(true)

    // 关闭数据库连接，避免 Windows 上文件句柄占用导致 unlinkSync 失败
    invalidateDb(filePath)

    dropConfigTable(tmpDir, tableName)

    expect(existsSync(filePath)).toBe(false)
    expect(
      existsSync(join(tmpDir, 'data', 'config', '.schema', `${tableName}.schema.json`))
    ).toBe(false)
    expect(
      existsSync(join(tmpDir, 'data', 'config', '.meta', `${tableName}.meta.json`))
    ).toBe(false)
  })

  it('表不存在时抛错', () => {
    expect(() => dropConfigTable(tmpDir, 'nonexistent')).toThrow('配置表不存在')
  })

  it('非法分类名时抛错', () => {
    // 含连字符，不匹配 ^[A-Za-z0-9_]+$
    expect(() => dropConfigTable(tmpDir, 'invalid-name')).toThrow('非法配置分类名')
  })
})

// ==================== renameConfigTable ====================

describe('renameConfigTable', () => {
  it('重命名表（文件名 + SQLite 表名 + schema + meta）', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]
    const { tableName: oldName, filePath: oldFile } = createConfigTable(
      tmpDir,
      '装备配置',
      fields
    )
    track(oldFile)

    const { oldName: returnedOld, newName } = renameConfigTable(tmpDir, oldName, '武器配置')
    const newFile = join(tmpDir, 'data', 'config', `${newName}.db`)
    track(newFile)

    expect(returnedOld).toBe(oldName)
    expect(newName).toBe('wuqipeizhi')

    // 旧文件不存在
    expect(existsSync(oldFile)).toBe(false)
    // 新文件存在
    expect(existsSync(newFile)).toBe(true)

    // SQLite 内部表名已改
    const db = getDb(newFile)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    expect(tables[0].name).toBe(newName)

    // schema 文件已改名
    expect(
      existsSync(join(tmpDir, 'data', 'config', '.schema', `${newName}.schema.json`))
    ).toBe(true)
    expect(
      existsSync(join(tmpDir, 'data', 'config', '.schema', `${oldName}.schema.json`))
    ).toBe(false)

    // meta 文件已改名
    expect(
      existsSync(join(tmpDir, 'data', 'config', '.meta', `${newName}.meta.json`))
    ).toBe(true)
    expect(
      existsSync(join(tmpDir, 'data', 'config', '.meta', `${oldName}.meta.json`))
    ).toBe(false)

    // schema 内容已更新
    const schema = JSON.parse(
      readFileSync(
        join(tmpDir, 'data', 'config', '.schema', `${newName}.schema.json`),
        'utf-8'
      )
    )
    expect(schema.table).toBe(newName)
    expect(schema.displayName).toBe('武器配置')
  })

  it('目标表已存在时抛错', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]
    const { tableName: name1, filePath: file1 } = createConfigTable(tmpDir, '装备配置', fields)
    track(file1)
    const { filePath: file2 } = createConfigTable(tmpDir, '武器配置', fields)
    track(file2)

    // 把 '装备配置' 重命名为 '武器配置'，但 '武器配置' 已存在
    expect(() => renameConfigTable(tmpDir, name1, '武器配置')).toThrow('目标表已存在')
  })

  it('新旧名称相同时直接返回', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    const result = renameConfigTable(tmpDir, tableName, '装备配置')
    expect(result.oldName).toBe(tableName)
    expect(result.newName).toBe(tableName)
  })

  it('非法旧表名时抛错', () => {
    expect(() => renameConfigTable(tmpDir, 'invalid-name', '新配置')).toThrow('非法旧表名')
  })
})

// ==================== alterConfigTable ====================

describe('alterConfigTable', () => {
  it('添加字段', () => {
    const fields: FieldDefinition[] = [
      { name: 'name', label: '名称', type: 'text' },
      { name: 'level', label: '等级', type: 'integer' }
    ]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    const result = alterConfigTable(tmpDir, tableName, {
      addFields: [{ name: 'price', label: '价格', type: 'real', defaultValue: 0 }]
    })

    expect(result.addedFields).toEqual(['price'])
    expect(result.droppedFields).toEqual([])
    expect(result.rebuilt).toBe(false)

    // 验证新字段存在
    const db = getDb(filePath)
    const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('price')
    expect(colNames).toContain('name')
    expect(colNames).toContain('level')
  })

  it('删除字段（重建表 + 迁移数据）', () => {
    const fields: FieldDefinition[] = [
      { name: 'name', label: '名称', type: 'text' },
      { name: 'level', label: '等级', type: 'integer' },
      { name: 'price', label: '价格', type: 'real' }
    ]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    // 插入 2 条数据
    insertConfigRecord(tmpDir, tableName, { name: 'sword', level: 10, price: 99.5 })
    insertConfigRecord(tmpDir, tableName, { name: 'shield', level: 5, price: 50.0 })

    // 删除 price 字段
    const result = alterConfigTable(tmpDir, tableName, {
      dropFields: ['price']
    })

    expect(result.droppedFields).toEqual(['price'])
    expect(result.addedFields).toEqual([])
    expect(result.rebuilt).toBe(true)
    expect(result.migratedRows).toBe(2)

    // 验证 price 字段已删除
    const db = getDb(filePath)
    const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).not.toContain('price')
    expect(colNames).toContain('name')
    expect(colNames).toContain('level')

    // 验证数据已迁移（name 和 level 保留）
    const rows = db.prepare(`SELECT * FROM "${tableName}"`).all() as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('sword')
    expect(rows[0].level).toBe(10)
    expect(rows[1].name).toBe('shield')
    expect(rows[1].level).toBe(5)
  })

  it('不能删除所有字段', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    // 表有 id 和 name 两列，全部删除应抛错
    expect(() =>
      alterConfigTable(tmpDir, tableName, { dropFields: ['id', 'name'] })
    ).toThrow('不能删除所有字段')
  })

  it('非法分类名时抛错', () => {
    expect(() => alterConfigTable(tmpDir, 'invalid-name', {})).toThrow('非法配置分类名')
  })

  it('非 .db 文件不支持表结构修改', async () => {
    await writeFile(join(tmpDir, 'data', 'config', 'items.json'), '[]')
    expect(() =>
      alterConfigTable(tmpDir, 'items', {
        addFields: [{ name: 'x', label: 'x', type: 'text' }]
      })
    ).toThrow('仅支持 SQLite 表')
  })

  // ===== Round 11 回归：alterConfigTable enum 类型映射 =====

  it('alterConfigTable 添加 enum 字段时 schema 中 type 为 enum（Round 11 回归）', () => {
    const fields: FieldDefinition[] = [{ name: 'name', label: '名称', type: 'text' }]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    alterConfigTable(tmpDir, tableName, {
      addFields: [{ name: 'rarity', label: '稀有度', type: 'enum', enumValues: ['普通', '稀有', '史诗'] }]
    })

    // 验证 schema 文件中 type 为 'enum'（不是 'string'）
    const schemaFile = join(tmpDir, 'data', 'config', '.schema', `${tableName}.schema.json`)
    const schema = JSON.parse(readFileSync(schemaFile, 'utf-8'))
    expect(schema.fields.rarity.type).toBe('enum')
    expect(schema.fields.rarity.enumValues).toEqual(['普通', '稀有', '史诗'])
  })

  it('alterConfigTable 更新 enum 字段 label 时 type 保持 enum（Round 11 回归）', () => {
    const fields: FieldDefinition[] = [
      { name: 'name', label: '名称', type: 'text' },
      { name: 'rarity', label: '稀有度', type: 'enum', enumValues: ['普通', '稀有'] }
    ]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    // 更新 rarity 的 label（不改 type）
    alterConfigTable(tmpDir, tableName, {
      updateFields: [{ name: 'rarity', label: '品级', type: 'enum', enumValues: ['普通', '稀有'] }]
    })

    const schemaFile = join(tmpDir, 'data', 'config', '.schema', `${tableName}.schema.json`)
    const schema = JSON.parse(readFileSync(schemaFile, 'utf-8'))
    // Round 11 修复前：type 会被覆盖为 'string'；修复后：保持 'enum'
    expect(schema.fields.rarity.type).toBe('enum')
    expect(schema.fields.rarity.label).toBe('品级')
  })

  // ===== Round 14a 回归：alterConfigTable NOT NULL 智能默认值 =====

  it('alterConfigTable 添加 NOT NULL 字段无 DEFAULT 时注入智能默认值（Round 14a）', () => {
    const fields: FieldDefinition[] = [
      { name: 'name', label: '名称', type: 'text' }
    ]
    const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
    track(filePath)

    // 插入一条数据（表非空）
    insertConfigRecord(tmpDir, tableName, { name: 'sword' })

    // 添加 NOT NULL 字段但不提供 defaultValue
    // SQLite 通常会报错 "Cannot add a NOT NULL column with default value NULL"
    // 修复后应注入智能默认值（integer=0, text='', enum=首个选项）
    expect(() => {
      alterConfigTable(tmpDir, tableName, {
        addFields: [
          { name: 'level', label: '等级', type: 'integer', notNull: true },
          { name: 'grade', label: '品级', type: 'enum', notNull: true, enumValues: ['凡品', '良品'] },
          { name: 'desc', label: '描述', type: 'text', notNull: true }
        ]
      })
    }).not.toThrow()

    // 验证字段已添加且有默认值
    const db = getDb(filePath)
    const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string; dflt_value: string | null }[]
    const levelCol = cols.find((c) => c.name === 'level')
    expect(levelCol).toBeDefined()
    expect(levelCol!.dflt_value).toBe('0') // integer 智能默认值

    const gradeCol = cols.find((c) => c.name === 'grade')
    expect(gradeCol).toBeDefined()
    expect(gradeCol!.dflt_value).toBe("'凡品'") // enum 首个选项

    // 验证已有数据的 NOT NULL 字段有值（SQLite 会用 DEFAULT 填充已有行）
    const rows = db.prepare(`SELECT * FROM "${tableName}"`).all() as Record<string, unknown>[]
    expect(rows[0].level).toBe(0)
    expect(rows[0].grade).toBe('凡品')
    expect(rows[0].desc).toBe('')
  })

  // ===== Round 13 回归：后端数据验证 =====

  describe('Round 13 后端数据验证', () => {
    it('updateConfigRecord 拒绝非法 enum 值', () => {
      const fields: FieldDefinition[] = [
        { name: 'name', label: '名称', type: 'text' },
        { name: 'rarity', label: '稀有度', type: 'enum', enumValues: ['普通', '稀有', '史诗'] }
      ]
      const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
      track(filePath)

      const rowid = insertConfigRecord(tmpDir, tableName, { name: 'sword', rarity: '普通' })

      // 合法值：不抛错
      expect(() => updateConfigRecord(tmpDir, tableName, rowid, { rarity: '稀有' })).not.toThrow()

      // 非法值：抛错
      expect(() => updateConfigRecord(tmpDir, tableName, rowid, { rarity: '传说' })).toThrow('不在允许的枚举选项中')
    })

    it('insertConfigRecord 拒绝空 required 字段', () => {
      const fields: FieldDefinition[] = [
        { name: 'name', label: '名称', type: 'text', notNull: true },
        { name: 'level', label: '等级', type: 'integer', notNull: true }
      ]
      const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
      track(filePath)

      // 合法插入：不抛错
      expect(() => insertConfigRecord(tmpDir, tableName, { name: 'sword', level: 10 })).not.toThrow()

      // 缺少 required 字段：抛错
      expect(() => insertConfigRecord(tmpDir, tableName, { name: 'shield' })).toThrow('必填字段')
    })

    it('updateConfigRecord 拒绝超范围数值', () => {
      const fields: FieldDefinition[] = [
        { name: 'name', label: '名称', type: 'text' },
        { name: 'level', label: '等级', type: 'integer', min: 1, max: 100 }
      ]
      const { tableName, filePath } = createConfigTable(tmpDir, '装备配置', fields)
      track(filePath)

      const rowid = insertConfigRecord(tmpDir, tableName, { name: 'sword', level: 10 })

      // 合法值：不抛错
      expect(() => updateConfigRecord(tmpDir, tableName, rowid, { level: 50 })).not.toThrow()

      // 小于 min：抛错
      expect(() => updateConfigRecord(tmpDir, tableName, rowid, { level: 0 })).toThrow('小于最小值')

      // 大于 max：抛错
      expect(() => updateConfigRecord(tmpDir, tableName, rowid, { level: 101 })).toThrow('大于最大值')
    })
  })
})
