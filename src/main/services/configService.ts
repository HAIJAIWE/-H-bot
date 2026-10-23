import path from 'path'
import fs from 'fs'
import { pinyin } from 'pinyin-pro'
import { getSchema, queryTable, updateRecord, insertRecord, deleteRecord, ensureIndexes, getDb, getOrCreateDb, invalidateDb } from './dataService'
import { assertWithinProject } from './pathGuard'
import { logger } from './logger'
import type { ConfigCategory, QueryResult, TableSchema } from '@shared/types/launch'

/** 配置分类名白名单：仅允许字母、数字、下划线 */
const CATEGORY_RE = /^[A-Za-z0-9_]+$/

/** 字段定义（建表/改表时由前端传入） */
export interface FieldDefinition {
  /** 英文字段名，如 'attack' */
  name: string
  /** 中文显示名，如 '攻击力' */
  label: string
  /** 字段类型 */
  type: 'integer' | 'real' | 'text' | 'boolean' | 'json' | 'enum'
  /** 描述 */
  description?: string
  /** 默认值（已序列化为字符串） */
  defaultValue?: unknown
  /** 是否非空 */
  notNull?: boolean
  /** enum 选项（仅 type='enum' 时有效） */
  enumValues?: string[]
  /** 数值最小值 */
  min?: number
  /** 数值最大值 */
  max?: number
}

/** 表结构变更结果（用于删字段重建时返回迁移统计） */
export interface AlterTableResult {
  addedFields: string[]
  droppedFields: string[]
  migratedRows: number
  rebuilt: boolean
}

/**
 * 中文 → 拼音表名（下划线分隔，全小写）
 * "装备配置" → "zhuangbei_peizhi"
 * "VIP配置" → "vip_peizhi"（英文部分原样保留）
 */
export function toPinyinTableName(chinese: string): string {
  // 用 pinyin-pro：保留非中文字符，中文转无声调拼音
  const result = pinyin(chinese, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive' // 非中文字符原样保留
  })
  // 数组拼成字符串，再处理分隔
  let joined = Array.isArray(result) ? result.join('') : String(result)
  // 去空格、转小写、非字母数字替换为下划线、压缩重复下划线
  joined = joined.replace(/\s+/g, '').toLowerCase()
  joined = joined.replace(/[^a-z0-9]+/g, '_')
  joined = joined.replace(/^_+|_+$/g, '')
  if (!joined) joined = 'table_' + Date.now()
  return joined
}

/**
 * 按字段类型返回智能默认值（用于 ALTER TABLE ADD COLUMN NOT NULL 场景）
 * SQLite 限制：ALTER TABLE ADD COLUMN 对 NOT NULL 列必须提供非 NULL DEFAULT，
 * 否则报错 "Cannot add a NOT NULL column with default value NULL"。
 * 前端 TableDesignModal 添加新字段表单未提供 defaultValue 输入时，这里兜底注入。
 */
function getSmartDefaultValue(type: FieldDefinition['type'], enumValues?: string[]): unknown {
  switch (type) {
    case 'integer': return 0
    case 'real': return 0.0
    case 'boolean': return 0  // SQLite 用 0/1
    case 'json': return '{}'
    case 'enum': return enumValues && enumValues.length > 0 ? enumValues[0] : ''
    case 'text':
    default: return ''
  }
}

/** 把 FieldDefinition 转为 SQLite 列定义 SQL 片段 */
function fieldToColumnSql(f: FieldDefinition): string {
  const name = f.name
  let sqlType: string
  switch (f.type) {
    case 'integer': sqlType = 'INTEGER'; break
    case 'real': sqlType = 'REAL'; break
    case 'boolean': sqlType = 'INTEGER'; break // 0/1
    case 'json': sqlType = 'TEXT'; break
    case 'enum': sqlType = 'TEXT'; break
    case 'text':
    default: sqlType = 'TEXT'; break
  }
  const parts = [`"${name}" ${sqlType}`]
  if (f.notNull) parts.push('NOT NULL')
  // 注意：空字符串 '' 是合法的字符串默认值（如 getSmartDefaultValue 对 text 类型返回 ''），
  // 不能与 undefined/null 一样视为"未设置"，否则 NOT NULL + DEFAULT '' 会变成无 DEFAULT 导致 SQLite 报错
  if (f.defaultValue !== undefined && f.defaultValue !== null) {
    const v = f.defaultValue
    if (typeof v === 'number') parts.push(`DEFAULT ${v}`)
    else if (typeof v === 'boolean') parts.push(`DEFAULT ${v ? 1 : 0}`)
    else {
      // 字符串默认值：转义单引号
      const escaped = String(v).replace(/'/g, "''")
      parts.push(`DEFAULT '${escaped}'`)
    }
  }
  return parts.join(' ')
}

/** 将 FieldDefinition 数组写入 schema 元数据文件 */
function saveSchemaMetadata(projectPath: string, tableName: string, displayName: string, fields: FieldDefinition[]): void {
  const schemaDir = path.join(projectPath, 'data', 'config', '.schema')
  if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true })
  const filePath = path.join(schemaDir, `${tableName}.schema.json`)
  // 转为 typeSystem 兼容的 FieldConfig 格式
  const fieldConfig: Record<string, unknown> = {}
  for (const f of fields) {
    const typeMap: Record<string, string> = {
      integer: 'int', real: 'float', text: 'string',
      boolean: 'bool', json: 'json', enum: 'enum'
    }
    fieldConfig[f.name] = {
      type: typeMap[f.type] || 'string',
      label: f.label,
      description: f.description,
      enumValues: f.enumValues,
      min: f.min,
      max: f.max,
      required: !!f.notNull
    }
  }
  const schema = {
    table: tableName,
    displayName,
    fields: fieldConfig
  }
  fs.writeFileSync(filePath, JSON.stringify(schema, null, 2), 'utf-8')
}

/** 读取 schema 元数据（含 displayName） */
function loadSchemaMetadata(projectPath: string, tableName: string): { displayName?: string; fields?: Record<string, unknown> } | null {
  const schemaFile = path.join(projectPath, 'data', 'config', '.schema', `${tableName}.schema.json`)
  if (!fs.existsSync(schemaFile)) return null
  try {
    return JSON.parse(fs.readFileSync(schemaFile, 'utf-8'))
  } catch (e) {
    // schema 文件损坏时返回 null，但记录警告
    logger.warn(`[configService] schema 文件解析失败: ${schemaFile}`, e)
    return null
  }
}

/** schema 字段配置类型 */
interface SchemaFieldConfig {
  type?: string
  enumValues?: string[]
  min?: number
  max?: number
  required?: boolean
}

/**
 * 验证写入值是否符合 schema 约束（enum 值、数值范围）
 * 在 updateConfigRecord 和 insertConfigRecord 中调用，防止 AI 工具绕过前端写入非法数据
 */
function validateRecordValues(
  tableName: string,
  values: Record<string, unknown>,
  schemaFields: Record<string, unknown>
): void {
  for (const [name, value] of Object.entries(values)) {
    // rowid 是 SQLite 内部字段，不在 schema 中，跳过
    if (name === 'rowid') continue
    const cfg = schemaFields[name] as SchemaFieldConfig | undefined
    if (!cfg) continue  // schema 中无此字段定义，跳过

    // enum 值验证：值必须在 enumValues 列表中
    if (cfg.enumValues && cfg.enumValues.length > 0 && value !== null && value !== undefined && value !== '') {
      if (!cfg.enumValues.includes(String(value))) {
        throw new Error(`字段 ${tableName}.${name} 的值 "${value}" 不在允许的枚举选项中: ${cfg.enumValues.join(', ')}`)
      }
    }

    // 数值范围验证
    if (typeof value === 'number') {
      if (cfg.min !== undefined && value < cfg.min) {
        throw new Error(`字段 ${tableName}.${name} 的值 ${value} 小于最小值 ${cfg.min}`)
      }
      if (cfg.max !== undefined && value > cfg.max) {
        throw new Error(`字段 ${tableName}.${name} 的值 ${value} 大于最大值 ${cfg.max}`)
      }
    }
  }
}

/**
 * 验证必填字段（仅 insert 时调用）
 * 检查 schema 中 required=true 的字段是否都有值
 */
function validateRequiredFields(
  tableName: string,
  values: Record<string, unknown>,
  schemaFields: Record<string, unknown>
): void {
  for (const [name, cfgRaw] of Object.entries(schemaFields)) {
    const cfg = cfgRaw as SchemaFieldConfig
    if (cfg.required) {
      if (!(name in values) || values[name] === null || values[name] === undefined) {
        throw new Error(`字段 ${tableName}.${name} 是必填字段，不能为空`)
      }
    }
  }
}

/** 配置文件名 → 中文显示名映射 */
const CONFIG_DISPLAY_NAMES: Record<string, string> = {
  equipment: '装备配置',
  skills: '技能配置',
  pets: '宠物配置',
  mounts: '坐骑配置',
  items: '道具配置',
  quests: '任务配置',
  achievements: '成就配置',
  dungeons: '副本配置',
  guilds: '公会配置',
  rankings: '排行榜配置',
  vip: 'VIP配置',
  sign_in: '签到配置',
  lottery: '抽奖配置',
  trading: '交易配置',
  titles: '称号配置',
  global: '全局参数',
}

/** 配置分类描述（按 spec 4.3 配置管理预置分类表） */
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  equipment: '武器、防具、饰品的模板属性（攻击力、稀有度、套装效果）',
  skills: '主动/被动技能的倍率、冷却、伤害、目标类型',
  pets: '宠物基础属性、进化链、天赋技能',
  mounts: '坐骑速度加成、外观、等级要求',
  items: '消耗品效果、持续时间、堆叠规则',
  quests: '日常/主线/支线任务目标、奖励、重复规则',
  achievements: '成就条件、奖励、稀有度',
  dungeons: '副本入口、难度、BOSS、掉落表',
  guilds: '公会等级、资金、权限设置',
  rankings: '排行类型、刷新周期、展示数量',
  vip: 'VIP 等级、价格、权益、持续时间',
  sign_in: '每日奖励、连签加成、VIP 翻倍',
  lottery: '奖池内容、概率、每日次数限制',
  trading: '交易税率、货币类型、上下架规则',
  titles: '称号属性加成、颜色、过期时间',
  global: '掉落率、经验倍率、签到基数、全局公告',
}

/**
 * 列出项目中所有配置分类（.db/.sqlite/.json 文件）
 * @param projectPath - 项目根路径
 * @returns 配置分类数组，包含名称、文件名、表数量、显示名和描述
 */
export function listConfigCategories(projectPath: string): ConfigCategory[] {
  const configDir = path.join(projectPath, 'data', 'config')
  if (!fs.existsSync(configDir)) return []
  const categories: ConfigCategory[] = []
  for (const file of fs.readdirSync(configDir)) {
    const fullPath = path.join(configDir, file)
    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) continue
    const ext = path.extname(file).toLowerCase()
    if (ext !== '.db' && ext !== '.sqlite' && ext !== '.json') continue
    const baseName = path.basename(file, ext)
    // 优先从 .meta 读取用户自定义 displayName，其次从 schema 文件，最后回退到硬编码映射
    let displayName = CONFIG_DISPLAY_NAMES[baseName] ?? baseName
    const metaFile = path.join(configDir, '.meta', `${baseName}.meta.json`)
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
        if (meta.displayName) displayName = meta.displayName
      } catch (e) {
        // meta 文件损坏时忽略，但记录警告
        logger.warn(`[configService] meta 文件损坏: ${metaFile}`, e)
      }
    } else {
      // 尝试从 schema 文件读 displayName
      const schemaMeta = loadSchemaMetadata(projectPath, baseName)
      if (schemaMeta?.displayName) displayName = schemaMeta.displayName
    }
    const description = CONFIG_DESCRIPTIONS[baseName]
    let tableCount = 1
    if (ext === '.db' || ext === '.sqlite') {
      try {
        // 清除缓存的数据库连接，确保读取最新的文件内容
        // （解决外部脚本重建 .db 文件后，缓存连接仍指向旧文件句柄的问题）
        invalidateDb(fullPath)
        const schemas = getSchema(fullPath)
        tableCount = schemas.length
      } catch (e) {
        // getSchema 失败时回退到 1，但记录警告
        logger.warn(`[configService] getSchema 失败: ${fullPath}`, e)
        tableCount = 1
      }
    }
    categories.push({ name: baseName, file, tableCount, displayName, description })
  }
  return categories
}

function resolveConfigFile(projectPath: string, category: string): string {
  // 校验分类名，防止路径遍历（如 ../../etc/passwd）
  if (!CATEGORY_RE.test(category)) {
    throw new Error(`非法配置分类名: ${category}（仅允许字母、数字、下划线）`)
  }
  const configDir = path.join(projectPath, 'data', 'config')
  const exact = path.join(configDir, category)
  // 双重校验：确保解析后的路径仍在 configDir 内
  assertWithinProject(configDir, exact)
  if (fs.existsSync(exact)) return exact
  for (const file of fs.readdirSync(configDir)) {
    const baseName = path.basename(file, path.extname(file))
    if (baseName.toLowerCase() === category.toLowerCase()) {
      const resolved = path.join(configDir, file)
      assertWithinProject(configDir, resolved)
      return resolved
    }
  }
  throw new Error(`配置分类不存在: ${category}`)
}

/**
 * 获取指定配置分类的表数据（分页查询）
 * @param projectPath - 项目根路径
 * @param category - 配置分类名
 * @param page - 页码（从 1 开始）
 * @param pageSize - 每页条数
 * @returns 分页查询结果，包含行数据和总数
 * @throws 分类不存在、分页参数非法时抛出错误
 */
export function getConfigTable(projectPath: string, category: string, page: number, pageSize: number): QueryResult {
  // 运行时校验分页参数：防止 AI 传入非法值导致负数索引或除零
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    throw new Error(`page 必须为正整数，收到: ${JSON.stringify(page)}`)
  }
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`pageSize 必须为正整数，收到: ${JSON.stringify(pageSize)}`)
  }
  const filePath = resolveConfigFile(projectPath, category)
  if (filePath.endsWith('.json')) {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    const rows = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => ({ key: k, value: v }))
    const total = rows.length
    const start = (page - 1) * pageSize
    return { rows: rows.slice(start, start + pageSize), total }
  }
  // 优先用 schema 找表名，回退到 PRAGMA
  const schemas = getSchema(filePath)
  if (schemas.length > 0) {
    const result = queryTable(filePath, schemas[0].name, page, pageSize)
    // 如果查询返回空数据，可能是数据库连接缓存问题（外部脚本重建 .db 文件后缓存连接仍指向旧句柄）
    // 清除缓存后重试一次，确保读到最新数据
    if (result.total === 0) {
      invalidateDb(filePath)
      return queryTable(filePath, schemas[0].name, page, pageSize)
    }
    return result
  }
  // PRAGMA 回退：直接查第一个表
  const db = getDb(filePath)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
  if (tables.length === 0) return { rows: [], total: 0 }
  return queryTable(filePath, tables[0].name, page, pageSize)
}

/**
 * 获取指定配置分类的表结构 Schema
 * @param projectPath - 项目根路径
 * @param category - 配置分类名
 * @returns 表结构数组，JSON 文件返回空数组
 */
export function getConfigSchema(projectPath: string, category: string): TableSchema[] {
  const filePath = resolveConfigFile(projectPath, category)
  if (filePath.endsWith('.json')) return []
  // 清除缓存的数据库连接，确保读取最新的表结构
  // （解决外部脚本重建 .db 文件后，缓存连接仍指向旧文件句柄的问题）
  invalidateDb(filePath)
  return getSchema(filePath)
}

/**
 * 更新配置表中的指定记录
 * @param projectPath - 项目根路径
 * @param category - 配置分类名
 * @param rowid - 记录行号（正整数）
 * @param changes - 要更新的字段键值对
 * @throws rowid 非法、分类不存在、字段值违反 schema 约束时抛出错误
 */
export function updateConfigRecord(projectPath: string, category: string, rowid: number, changes: Record<string, unknown>): void {
  // 运行时校验 rowid：函数签名虽为 number，但 AI 调用 update_config 工具时
  // 可能传入字符串/undefined，导致 Number(rowid) 产生 NaN 传入 SQL 后行为未定义
  if (typeof rowid !== 'number' || !Number.isInteger(rowid) || rowid <= 0) {
    throw new Error(`rowid 必须为正整数，收到: ${JSON.stringify(rowid)}`)
  }
  const filePath = resolveConfigFile(projectPath, category)
  if (filePath.endsWith('.json')) {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) {
      const row = data.find((r: Record<string, unknown>) => r.rowid === rowid || r.id === rowid)
      if (row) Object.assign(row, changes)
    } else {
      for (const [k, v] of Object.entries(changes)) { data[k] = v }
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return
  }
  const schemas = getSchema(filePath)
  if (schemas.length > 0) {
    // 后端数据验证：防止 AI 工具绕过前端写入非法 enum 值或超出范围的数值
    const schemaMeta = loadSchemaMetadata(projectPath, category)
    if (schemaMeta?.fields) {
      validateRecordValues(category, changes, schemaMeta.fields)
    }
    updateRecord(filePath, schemas[0].name, rowid, changes)
  }
}

/**
 * 向配置表插入新记录
 * @param projectPath - 项目根路径
 * @param category - 配置分类名
 * @param values - 要插入的字段键值对
 * @returns 新记录的 rowid（JSON 文件返回数组索引）
 * @throws 必填字段缺失、字段值违反 schema 约束时抛出错误
 */
export function insertConfigRecord(projectPath: string, category: string, values: Record<string, unknown>): number {
  const filePath = resolveConfigFile(projectPath, category)
  if (filePath.endsWith('.json')) {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) { data.push(values); fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8'); return data.length - 1 }
    return 0
  }
  const schemas = getSchema(filePath)
  if (schemas.length > 0) {
    // 后端数据验证：必填字段 + enum 值 + 数值范围，防止 AI 工具绕过前端写入非法数据
    const schemaMeta = loadSchemaMetadata(projectPath, category)
    if (schemaMeta?.fields) {
      validateRequiredFields(category, values, schemaMeta.fields)
      validateRecordValues(category, values, schemaMeta.fields)
    }
    return insertRecord(filePath, schemas[0].name, values)
  }
  return 0
}

/**
 * 删除配置表中的指定记录
 * @param projectPath - 项目根路径
 * @param category - 配置分类名
 * @param rowid - 记录行号（正整数）
 * @throws rowid 非法、分类不存在时抛出错误
 */
export function deleteConfigRecord(projectPath: string, category: string, rowid: number): void {
  // 运行时校验 rowid：同 updateConfigRecord，防止 AI 传入字符串/undefined/NaN
  if (typeof rowid !== 'number' || !Number.isInteger(rowid) || rowid <= 0) {
    throw new Error(`rowid 必须为正整数，收到: ${JSON.stringify(rowid)}`)
  }
  const filePath = resolveConfigFile(projectPath, category)
  if (filePath.endsWith('.json')) return
  const schemas = getSchema(filePath)
  if (schemas.length > 0) deleteRecord(filePath, schemas[0].name, rowid)
}

// ==================== 表结构管理（建表/删表/重命名/改表结构） ====================

/** 创建新配置表 */
export function createConfigTable(
  projectPath: string,
  displayName: string,
  fields: FieldDefinition[]
): { tableName: string; filePath: string } {
  // 校验字段
  if (!fields || fields.length === 0) {
    throw new Error('至少需要定义一个字段')
  }
  // 第一个字段如果是 id/integer，作为主键；否则自动补一个 id 主键
  const idField = fields.find(f => f.name.toLowerCase() === 'id')
  const hasIdPrimaryKey = idField && (idField.type === 'integer' || idField.type === 'real')
  const tableName = toPinyinTableName(displayName)
  if (!CATEGORY_RE.test(tableName)) {
    throw new Error(`生成的表名不合法: ${tableName}`)
  }
  const configDir = path.join(projectPath, 'data', 'config')
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
  const filePath = path.join(configDir, `${tableName}.db`)
  if (fs.existsSync(filePath)) {
    throw new Error(`表已存在: ${tableName}.db`)
  }
  // 列定义
  const columnDefs: string[] = []
  if (!hasIdPrimaryKey) {
    columnDefs.push('"id" INTEGER PRIMARY KEY AUTOINCREMENT')
  } else if (idField) {
    // 用户已定义 id 字段，将其设为主键
    const idIdx = fields.indexOf(idField)
    const idDef = { ...idField }
    fields.splice(idIdx, 1)
    columnDefs.push(`"${idDef.name}" INTEGER PRIMARY KEY AUTOINCREMENT`)
  }
  for (const f of fields) {
    // 校验字段名
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) {
      throw new Error(`非法字段名: ${f.name}`)
    }
    columnDefs.push(fieldToColumnSql(f))
  }
  // 创建数据库和表（filePath 是新建的，使用 getOrCreateDb 允许首次创建文件）
  const db = getOrCreateDb(filePath)
  const sql = `CREATE TABLE "${tableName}" (\n  ${columnDefs.join(',\n  ')}\n)`
  db.exec(sql)
  // 建表后创建索引（如果用户定义了 qq/user_id 等高频字段）
  // ensureIndexes 使用 CREATE INDEX IF NOT EXISTS，幂等安全
  ensureIndexes(filePath)
  // 写 schema 元数据
  saveSchemaMetadata(projectPath, tableName, displayName, idField ? [idField, ...fields] : fields)
  // 写 displayName 映射（更新 CONFIG_DISPLAY_NAMES 不现实，存到 meta 文件）
  saveDisplayName(projectPath, tableName, displayName)
  return { tableName, filePath }
}

/**
 * 建表并批量插入种子数据（用于项目创建时初始化配置表模板）
 * 若表已存在会抛错（与 createConfigTable 语义一致），调用方需自行处理
 * @param projectPath 项目根路径
 * @param displayName 表显示名（会通过 toPinyinTableName 转换为表名）
 * @param fields 字段定义
 * @param seedRows 种子数据行（字段名 → 值）
 * @returns 表名、文件路径、插入行数
 */
export function createConfigTableWithSeed(
  projectPath: string,
  displayName: string,
  fields: FieldDefinition[],
  seedRows?: Record<string, unknown>[]
): { tableName: string; filePath: string; insertedRows: number } {
  // 建表（若已存在会抛错，调用方需处理）
  const { tableName, filePath } = createConfigTable(projectPath, displayName, fields)

  let insertedRows = 0
  if (seedRows && seedRows.length > 0) {
    const db = getDb(filePath)
    // 使用事务批量插入，失败时回滚
    const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        // 过滤掉不属于 fields 的字段，避免 INSERT 失败
        const allowedKeys = new Set(fields.map(f => f.name))
        const filteredRow: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) {
          if (allowedKeys.has(k)) filteredRow[k] = v
        }
        const keys = Object.keys(filteredRow)
        if (keys.length === 0) continue
        const columns = keys.map(k => `"${k}"`).join(', ')
        const placeholders = keys.map(k => `@${k}`).join(', ')
        db.prepare(`INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`).run(filteredRow)
        insertedRows++
      }
    })
    insertMany(seedRows)
  }

  return { tableName, filePath, insertedRows }
}

/** 删除整张配置表（含 .db 文件和 schema 元数据） */
export function dropConfigTable(projectPath: string, category: string): void {
  if (!CATEGORY_RE.test(category)) {
    throw new Error(`非法配置分类名: ${category}`)
  }
  const configDir = path.join(projectPath, 'data', 'config')
  // 删除 .db / .sqlite / .json 主文件
  const candidateExts = ['.db', '.sqlite', '.json']
  let deleted = false
  for (const ext of candidateExts) {
    const filePath = path.join(configDir, category + ext)
    if (fs.existsSync(filePath)) {
      // 双重校验路径
      assertWithinProject(configDir, filePath)
      fs.unlinkSync(filePath)
      deleted = true
    }
  }
  if (!deleted) {
    throw new Error(`配置表不存在: ${category}`)
  }
  // 删除 schema 元数据
  const schemaFile = path.join(configDir, '.schema', `${category}.schema.json`)
  if (fs.existsSync(schemaFile)) {
    assertWithinProject(configDir, schemaFile)
    fs.unlinkSync(schemaFile)
  }
  // 删除 displayName 元数据
  const metaFile = path.join(configDir, '.meta', `${category}.meta.json`)
  if (fs.existsSync(metaFile)) {
    assertWithinProject(configDir, metaFile)
    fs.unlinkSync(metaFile)
  }
}

/** 重命名配置表（改文件名 + 改表名 + 改 schema） */
export function renameConfigTable(
  projectPath: string,
  oldCategory: string,
  newDisplayName: string
): { oldName: string; newName: string } {
  if (!CATEGORY_RE.test(oldCategory)) {
    throw new Error(`非法旧表名: ${oldCategory}`)
  }
  const newTableName = toPinyinTableName(newDisplayName)
  if (!CATEGORY_RE.test(newTableName)) {
    throw new Error(`生成的新表名不合法: ${newTableName}`)
  }
  if (oldCategory === newTableName) {
    return { oldName: oldCategory, newName: newTableName }
  }
  const configDir = path.join(projectPath, 'data', 'config')
  // 找旧文件
  const oldFile = resolveConfigFile(projectPath, oldCategory)
  const ext = path.extname(oldFile)
  const newFile = path.join(configDir, newTableName + ext)
  if (fs.existsSync(newFile)) {
    throw new Error(`目标表已存在: ${newTableName}`)
  }
  // 改 SQLite 内部表名（如果是 .db）
  if (ext === '.db' || ext === '.sqlite') {
    const db = getDb(oldFile)
    // SQLite 改表名语法
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    for (const t of tables) {
      if (t.name === oldCategory) {
        db.exec(`ALTER TABLE "${oldCategory}" RENAME TO "${newTableName}"`)
      }
    }
    // 表结构变更后清理连接缓存，避免后续查询复用过期连接；同时为文件 rename 做准备
    invalidateDb(oldFile)
  }
  // 改文件名
  fs.renameSync(oldFile, newFile)
  // 改 schema 文件名 + 内部 table 字段
  const oldSchema = path.join(configDir, '.schema', `${oldCategory}.schema.json`)
  const newSchema = path.join(configDir, '.schema', `${newTableName}.schema.json`)
  if (fs.existsSync(oldSchema)) {
    assertWithinProject(configDir, oldSchema)
    assertWithinProject(configDir, newSchema)
    try {
      const data = JSON.parse(fs.readFileSync(oldSchema, 'utf-8'))
      data.table = newTableName
      data.displayName = newDisplayName
      fs.writeFileSync(newSchema, JSON.stringify(data, null, 2), 'utf-8')
      fs.unlinkSync(oldSchema)
    } catch (e) {
      // schema 文件损坏，直接删，但记录警告
      logger.warn(`[configService] schema 文件损坏，删除: ${oldSchema}`, e)
      fs.unlinkSync(oldSchema)
    }
  } else {
    // 没有 schema，新建一份
    saveSchemaMetadata(projectPath, newTableName, newDisplayName, [])
  }
  // 改 meta 文件
  const oldMeta = path.join(configDir, '.meta', `${oldCategory}.meta.json`)
  const newMeta = path.join(configDir, '.meta', `${newTableName}.meta.json`)
  if (fs.existsSync(oldMeta)) {
    assertWithinProject(configDir, oldMeta)
    assertWithinProject(configDir, newMeta)
    fs.renameSync(oldMeta, newMeta)
  } else {
    saveDisplayName(projectPath, newTableName, newDisplayName)
  }
  return { oldName: oldCategory, newName: newTableName }
}

/**
 * 修改表结构：增加字段、删除字段（重建迁移）、修改字段元数据
 * 注意：SQLite ALTER TABLE 只支持 ADD COLUMN，删字段需要重建表+迁移数据
 */
export function alterConfigTable(
  projectPath: string,
  category: string,
  options: {
    addFields?: FieldDefinition[]
    dropFields?: string[]  // 字段名列表
    updateFields?: FieldDefinition[]  // 修改 label/description/enumValues/min/max（不改 type 和 name）
  }
): AlterTableResult {
  if (!CATEGORY_RE.test(category)) {
    throw new Error(`非法配置分类名: ${category}`)
  }
  const filePath = resolveConfigFile(projectPath, category)
  if (!filePath.endsWith('.db') && !filePath.endsWith('.sqlite')) {
    throw new Error('仅支持 SQLite 表的表结构修改')
  }
  const addFields = options.addFields ?? []
  const dropFields = options.dropFields ?? []
  const updateFields = options.updateFields ?? []
  const result: AlterTableResult = {
    addedFields: [],
    droppedFields: [],
    migratedRows: 0,
    rebuilt: false
  }
  // 加字段：直接 ALTER TABLE ADD COLUMN
  if (addFields.length > 0) {
    const db = getDb(filePath)
    for (let f of addFields) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) {
        throw new Error(`非法字段名: ${f.name}`)
      }
      // SQLite 限制：ALTER TABLE ADD COLUMN 对 NOT NULL 列必须提供非 NULL DEFAULT
      // 前端 TableDesignModal 添加新字段表单未提供 defaultValue 输入时，这里兜底注入智能默认值
      if (f.notNull && (f.defaultValue === undefined || f.defaultValue === null || f.defaultValue === '')) {
        f = { ...f, defaultValue: getSmartDefaultValue(f.type, f.enumValues) }
      }
      const colDef = fieldToColumnSql(f)
      db.exec(`ALTER TABLE "${category}" ADD COLUMN ${colDef}`)
      result.addedFields.push(f.name)
    }
  }
  // 删字段：重建表
  if (dropFields.length > 0) {
    const db = getDb(filePath)
    // 1. 读取当前表结构
    const columns = db.prepare(`PRAGMA table_info("${category}")`).all() as {
      cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number
    }[]
    const dropSet = new Set(dropFields)
    const keepColumns = columns.filter(c => !dropSet.has(c.name))
    if (keepColumns.length === 0) {
      throw new Error('不能删除所有字段，至少保留一个')
    }
    // 2. 读取旧表数据
    const keepColNames = keepColumns.map(c => `"${c.name}"`).join(', ')
    const oldRows = db.prepare(`SELECT ${keepColNames} FROM "${category}"`).all() as Record<string, unknown>[]
    result.migratedRows = oldRows.length
    // 3. 构建新表 SQL
    const newColumnDefs: string[] = []
    for (const c of keepColumns) {
      let colDef = `"${c.name}" ${c.type || 'TEXT'}`
      if (c.pk) colDef += ' PRIMARY KEY'
      if (c.notnull) colDef += ' NOT NULL'
      if (c.dflt_value !== null && c.dflt_value !== undefined) {
        colDef += ` DEFAULT ${c.dflt_value}`
      }
      newColumnDefs.push(colDef)
    }
    // 4. 事务：删旧表 → 建新表 → 复制数据
    const transaction = db.transaction(() => {
      db.exec(`DROP TABLE "${category}"`)
      db.exec(`CREATE TABLE "${category}" (\n  ${newColumnDefs.join(',\n  ')}\n)`)
      if (oldRows.length > 0) {
        const placeholders = keepColumns.map(() => '?').join(', ')
        const insertSql = `INSERT INTO "${category}" (${keepColNames}) VALUES (${placeholders})`
        const stmt = db.prepare(insertSql)
        for (const row of oldRows) {
          stmt.run(...keepColumns.map(c => row[c.name]))
        }
      }
    })
    transaction()
    result.droppedFields = [...dropFields]
    result.rebuilt = true
    // 重建表后重新创建索引（DROP TABLE 会删除旧表上的所有索引）
    // ensureIndexes 在事务外执行（CREATE INDEX 不应在事务内运行），幂等安全
    ensureIndexes(filePath)
  }
  // 更新 schema 元数据（合并所有变更）
  const oldMeta = loadSchemaMetadata(projectPath, category)
  const oldFields: Record<string, unknown> = oldMeta?.fields ?? {}
  // 移除删掉的字段
  for (const dropName of dropFields) {
    delete oldFields[dropName]
  }
  // 添加新字段 + 更新已有字段
  const allFields: FieldDefinition[] = [...addFields, ...updateFields]
  const typeMap: Record<string, string> = {
    integer: 'int', real: 'float', text: 'string',
    boolean: 'bool', json: 'json', enum: 'enum'
  }
  for (const f of allFields) {
    oldFields[f.name] = {
      type: typeMap[f.type] || 'string',
      label: f.label,
      description: f.description,
      enumValues: f.enumValues,
      min: f.min,
      max: f.max,
      required: !!f.notNull
    }
  }
  // 写回 schema 文件
  const schemaDir = path.join(projectPath, 'data', 'config', '.schema')
  if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true })
  const schemaFile = path.join(schemaDir, `${category}.schema.json`)
  const displayName = oldMeta?.displayName ?? category
  const newSchema = {
    table: category,
    displayName,
    fields: oldFields
  }
  fs.writeFileSync(schemaFile, JSON.stringify(newSchema, null, 2), 'utf-8')
  return result
}

/** 保存 displayName 到 .meta/{table}.meta.json */
function saveDisplayName(projectPath: string, tableName: string, displayName: string): void {
  const metaDir = path.join(projectPath, 'data', 'config', '.meta')
  if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true })
  const metaFile = path.join(metaDir, `${tableName}.meta.json`)
  fs.writeFileSync(metaFile, JSON.stringify({ table: tableName, displayName }, null, 2), 'utf-8')
}
