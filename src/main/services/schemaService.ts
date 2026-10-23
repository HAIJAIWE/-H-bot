import fs from 'fs'
import path from 'path'
import { getDb } from './dataService'
import type { SchemaDefinition, FieldConfig } from '@shared/types/typeSystem'

export function loadSchemaFile(filePath: string): SchemaDefinition[] {
  // 从 .schema/*.schema.json 文件读取
  // 返回 SchemaDefinition[]
  if (!fs.existsSync(filePath)) return []
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const raw = JSON.parse(content)
    const defs = Array.isArray(raw) ? raw : [raw]
    // 兼容：schema JSON 中用 options 存储枚举值，但 FieldConfig 期望 enumValues
    return defs.map((def: SchemaDefinition) => {
      if (!def.fields) return def
      const fields: Record<string, FieldConfig> = {}
      for (const [name, cfg] of Object.entries(def.fields)) {
        const c = cfg as FieldConfig & { options?: string[] }
        fields[name] = {
          ...c,
          enumValues: c.enumValues ?? c.options,
        }
      }
      return { ...def, fields }
    })
  } catch { return [] }
}

export function loadSchemaDir(schemaDir: string): Map<string, SchemaDefinition> {
  // 扫描 schema 目录，加载所有 .schema.json 文件
  const schemas = new Map<string, SchemaDefinition>()
  if (!fs.existsSync(schemaDir)) return schemas
  const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.schema.json'))
  for (const file of files) {
    const defs = loadSchemaFile(path.join(schemaDir, file))
    for (const def of defs) {
      schemas.set(def.table, def)
    }
  }
  return schemas
}

export function getPragmaSchema(dbPath: string): Map<string, { name: string; type: string; notNull: boolean; default: unknown }[]> {
  // 从 SQLite PRAGMA table_info 获取表结构
  if (!fs.existsSync(dbPath)) return new Map()
  const db = getDb(dbPath)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  const result = new Map<string, { name: string; type: string; notNull: boolean; default: unknown }[]>()
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[]
    result.set(t.name, cols.map(c => ({ name: c.name, type: c.type, notNull: c.notnull === 1, default: c.dflt_value })))
  }
  return result
}

export function getMergedSchema(dbPath: string, schemaDir: string): { table: string; fields: Record<string, FieldConfig> }[] {
  // 合并 schema 文件和 PRAGMA：schema 优先，PRAGMA 兜底
  const schemaDefs = loadSchemaDir(schemaDir)
  const pragmaSchemas = getPragmaSchema(dbPath)
  const result: { table: string; fields: Record<string, FieldConfig> }[] = []

  for (const [tableName, cols] of pragmaSchemas) {
    if (schemaDefs.has(tableName)) {
      // 有 schema 声明：使用 schema
      result.push({ table: tableName, fields: schemaDefs.get(tableName)!.fields })
    } else {
      // 无 schema 声明：从 PRAGMA 推断
      const fields: Record<string, FieldConfig> = {}
      for (const col of cols) {
        fields[col.name] = {
          type: mapSqlType(col.type),
          label: col.name,
          required: col.notNull
        }
      }
      result.push({ table: tableName, fields })
    }
  }

  return result
}

function mapSqlType(sqlType: string): FieldConfig['type'] {
  const t = sqlType.toUpperCase()
  if (t.includes('INT')) return 'int'
  if (t.includes('REAL') || t.includes('FLOAT') || t.includes('DOUBLE')) return 'float'
  if (t.includes('TEXT')) return 'string'
  if (t.includes('BLOB')) return 'json'
  return 'string'
}

export function getCompositeTypeDef(typeName: string): FieldConfig | null {
  // 从 TypeRegistry 获取复合类型定义
  try {
    const { TypeRegistry } = require('@shared/types/typeSystem')
    const def = TypeRegistry.get(typeName)
    if (def) {
      return { type: 'dict' as const, label: def.label }
    }
  } catch {}
  return null
}
