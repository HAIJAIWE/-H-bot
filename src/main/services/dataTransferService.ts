import fs from 'fs'
import { getDb } from './dataService'

/**
 * SQL 标识符白名单与校验工具
 *
 * 设计依据（来自 project_memory.md 硬约束）：
 *   "SQL identifiers (table names, columns) must pass whitelist validation
 *    to prevent injection"
 *
 * 项目实际使用的表名（通过 CREATE TABLE / FROM / INTO 扫描得出）：
 *   系统表：audit_log, bot_state, session_vars, bot_memory, runtime_state,
 *           messages, groups, _persistent
 *   配置表：由 configService.ts 动态创建，命名规则与 CATEGORY_RE 一致
 *           (configService.ts: /^[A-Za-z0-9_]+$/)
 *
 * 由于配置表名是用户自定义的，无法用纯静态白名单覆盖，因此采用
 * 「系统表白名单 + 严格标识符正则」双重校验：
 *   1. 命中系统表白名单 → 直接放行
 *   2. 未命中 → 必须匹配 /^[A-Za-z_][A-Za-z0-9_]*$/
 * 该正则会拒绝所有 SQL 元字符（` ; ' " -- 空格 等），从根本上阻断 SQL 注入。
 */
const SYSTEM_TABLE_WHITELIST = new Set<string>([
  'audit_log',
  'bot_state',
  'session_vars',
  'bot_memory',
  'runtime_state',
  'messages',
  'groups',
  '_persistent'
])

// 与 configService.ts 的 CATEGORY_RE 保持兼容，但禁止以数字开头（更贴合 SQL 标识符规范）
const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 校验 SQL 表名，防止 SQL 注入。校验失败抛出 Error。
 *
 * 三层校验：
 *   1. 拒绝 SQLite 内部系统表（sqlite_master / sqlite_sequence / sqlite_schema 等）：
 *      这些表名能通过 SQL_IDENTIFIER_RE（合法标识符），但禁止用户访问，避免泄露
 *      库结构元数据或破坏自增序列。
 *   2. 命中系统表白名单 → 直接放行（项目业务表）。
 *   3. 未命中 → 必须匹配 /^[A-Za-z_][A-Za-z0-9_]*$/，拒绝所有 SQL 元字符。
 */
function validateTableName(tableName: string): void {
  if (typeof tableName !== 'string' || tableName.length === 0) {
    throw new Error(`Invalid table name: ${String(tableName)}`)
  }
  // 拒绝 SQLite 内部系统表（不区分大小写，前缀 sqlite_ 一律禁止）
  if (tableName.toLowerCase().startsWith('sqlite_')) {
    throw new Error(`Cannot access SQLite internal table: ${tableName}`)
  }
  if (SYSTEM_TABLE_WHITELIST.has(tableName)) return
  if (!SQL_IDENTIFIER_RE.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`)
  }
}

/**
 * 校验 SQL 列名（用于 INSERT 语句中动态拼接的列名），防止 SQL 注入。
 * 校验失败抛出 Error。
 */
function validateColumnName(columnName: string): void {
  if (typeof columnName !== 'string' || columnName.length === 0) {
    throw new Error(`Invalid column name: ${String(columnName)}`)
  }
  if (!SQL_IDENTIFIER_RE.test(columnName)) {
    throw new Error(`Invalid column name: ${columnName}`)
  }
}

export function exportTableToJson(dbPath: string, tableName: string, outputPath: string): void {
  validateTableName(tableName)
  const db = getDb(dbPath)
  const rows = db.prepare(`SELECT * FROM \`${tableName}\``).all()
  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2), 'utf-8')
}

export function exportTableToCsv(dbPath: string, tableName: string, outputPath: string): void {
  validateTableName(tableName)
  const db = getDb(dbPath)
  const rows = db.prepare(`SELECT * FROM \`${tableName}\``).all() as Record<string, unknown>[]
  if (rows.length === 0) { fs.writeFileSync(outputPath, ''); return }
  const headers = Object.keys(rows[0])
  const csvLines = [headers.join(',')]
  for (const row of rows) {
    csvLines.push(headers.map(h => {
      const v = row[h]
      if (v === null || v === undefined) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
  }
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf-8')
}

export function importFromJson(dbPath: string, tableName: string, jsonPath: string): number {
  validateTableName(tableName)
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  if (!Array.isArray(data) || data.length === 0) return 0
  const columns = Object.keys(data[0])
  // 列名来自用户提供的 JSON 文件，必须逐个校验后再拼接进 SQL
  for (const col of columns) {
    validateColumnName(col)
  }
  const db = getDb(dbPath)
  let imported = 0
  const insert = db.prepare(`INSERT INTO \`${tableName}\` (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
  const tx = db.transaction(() => {
    for (const row of data) {
      insert.run(...Object.values(row))
      imported++
    }
  })
  tx()
  return imported
}

export function importFromCsv(dbPath: string, tableName: string, csvPath: string): number {
  validateTableName(tableName)
  const content = fs.readFileSync(csvPath, 'utf-8').trim()
  const lines = content.split('\n')
  if (lines.length < 2) return 0
  const headers = parseCsvLine(lines[0])
  // 列名来自用户提供的 CSV 文件首行，必须逐个校验后再拼接进 SQL
  for (const header of headers) {
    validateColumnName(header)
  }
  const db = getDb(dbPath)
  let imported = 0
  const insert = db.prepare(`INSERT INTO \`${tableName}\` (${headers.join(',')}) VALUES (${headers.map(() => '?').join(',')})`)
  const tx = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i])
      if (values.length === headers.length) {
        insert.run(...values)
        imported++
      }
    }
  })
  tx()
  return imported
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (line[i] === ',' && !inQuotes) { result.push(current); current = '' }
    else current += line[i]
  }
  result.push(current)
  return result
}
