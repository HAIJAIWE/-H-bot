import * as fs from 'fs'
import * as path from 'path'
import type { FieldConfig } from '@shared/types/typeSystem'
import { DEFAULT_PAGE_SIZE } from '@shared/types/pagination'
import { getMergedSchema } from './schemaService'
import { ensureIndexes, getDb } from './dataService'
import { logger } from './logger'

/**
 * 校验 SQL 表名（防止 SQL 注入）。
 * tableName 来自 flow.json 的 admin_panel 节点配置（用户编辑），拼接进 SQL 语句前必须校验。
 * 与 dataTransferService.ts 的 validateTableName 保持一致的规则：
 *   1. 拒绝 SQLite 内部系统表（sqlite_ 前缀）
 *   2. 只允许合法 SQL 标识符（字母/下划线开头，只含字母数字下划线）
 */
function validateTableName(tableName: string): void {
  if (typeof tableName !== 'string' || tableName.length === 0) {
    throw new Error(`Invalid table name: ${String(tableName)}`)
  }
  if (tableName.toLowerCase().startsWith('sqlite_')) {
    throw new Error(`Cannot access SQLite internal table: ${tableName}`)
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`)
  }
}

/** 开发环境标记：仅在非生产环境下记录慢查询日志 */
const IS_DEV = process.env.NODE_ENV !== 'production'
const SLOW_QUERY_THRESHOLD_MS = 100

/** 在开发环境下记录慢查询（>100ms），使用 console.debug 避免污染生产日志 */
function logSlowQuery(sql: string, durationMs: number): void {
  if (IS_DEV && durationMs > SLOW_QUERY_THRESHOLD_MS) {
    const compactSql = sql.replace(/\s+/g, ' ').trim().slice(0, 200)
    logger.debug(`[slow-query] ${durationMs}ms | ${compactSql}`)
  }
}

// 注册的管理面板信息
export interface RegisteredPanel {
  panelId: string
  label: string
  description: string
  dataSource: string
  tableName: string
  fields?: Record<string, FieldConfig>
}

// 从 flow.json 中提取 admin_panel 节点
export function getRegisteredPanels(projectPath: string): RegisteredPanel[] {
  const flowPath = path.join(projectPath, '.qqbat', 'flow.json')
  if (!fs.existsSync(flowPath)) return []
  try {
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8'))
    if (!flow.nodes || !Array.isArray(flow.nodes)) return []
    const panels: RegisteredPanel[] = []
    for (const node of flow.nodes) {
      const data = node.data || {}
      const kind = data.nodeKind || (data.data && data.data.nodeKind)
      if (kind === 'admin_panel') {
        const config = data.config || (data.data && data.data.config) || {}
        if (config.panelId && config.label) {
          panels.push({
            panelId: config.panelId,
            label: config.label,
            description: config.description || '',
            dataSource: config.dataSource || '',
            tableName: config.tableName || ''
          })
        }
      }
    }
    return panels
  } catch (e) {
    logger.warn('[panelRegistry] 面板注册表读取失败:', e)
    return []
  }
}

// 获取面板关联的数据表 schema
export function getPanelSchema(projectPath: string, panel: RegisteredPanel): RegisteredPanel {
  if (!panel.tableName || !panel.dataSource) return panel
  // 尝试查找数据源
  const possiblePaths = [
    path.join(projectPath, 'data', 'players', panel.dataSource),
    path.join(projectPath, 'data', 'config', panel.dataSource)
  ]
  for (const dbPath of possiblePaths) {
    if (fs.existsSync(dbPath)) {
      const schemaDir = path.join(path.dirname(dbPath), '.schema')
      const schemas = getMergedSchema(dbPath, schemaDir)
      const match = schemas.find(s => s.table === panel.tableName)
      if (match) {
        panel.fields = match.fields
      }
      break
    }
  }
  return panel
}

// 查询面板关联表的数据
// 支持 keyset pagination：传入 cursor（上一页最后一行的 rowid）时使用 WHERE rowid > cursor 替代 OFFSET
export function queryPanelTable(projectPath: string, panel: RegisteredPanel, page = 1, pageSize = DEFAULT_PAGE_SIZE, cursor?: number): { rows: unknown[]; total: number; nextCursor?: number | null; error?: string } {
  if (!panel.tableName || !panel.dataSource) return { rows: [], total: 0, error: '未配置数据源和表名' }
  // 校验表名（防 SQL 注入），校验失败直接返回错误，不执行查询
  try {
    validateTableName(panel.tableName)
  } catch (e) {
    return { rows: [], total: 0, error: String(e) }
  }
  const possiblePaths = [
    path.join(projectPath, 'data', 'players', panel.dataSource),
    path.join(projectPath, 'data', 'config', panel.dataSource)
  ]
  for (const dbPath of possiblePaths) {
    if (fs.existsSync(dbPath) && dbPath.endsWith('.db')) {
      try {
        // 确保索引存在（QQ 字段等高频查询列），在打开只读连接前以读写模式创建
        ensureIndexes(dbPath)
        const db = getDb(dbPath)
        const startTotal = Date.now()
        const total = (db.prepare(`SELECT COUNT(*) as c FROM \`${panel.tableName}\``).get() as { c: number }).c
        logSlowQuery(`SELECT COUNT(*) FROM \`${panel.tableName}\``, Date.now() - startTotal)

        let rows: Record<string, unknown>[]
        if (cursor !== undefined && cursor >= 0) {
          // keyset pagination：WHERE rowid > cursor ORDER BY rowid ASC LIMIT pageSize
          const startQuery = Date.now()
          rows = db.prepare(`SELECT rowid, * FROM \`${panel.tableName}\` WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`).all(cursor, pageSize) as Record<string, unknown>[]
          logSlowQuery(`SELECT rowid, * FROM \`${panel.tableName}\` WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`, Date.now() - startQuery)
        } else {
          // 向后兼容：传统 OFFSET 分页
          const startQuery = Date.now()
          rows = db.prepare(`SELECT rowid, * FROM \`${panel.tableName}\` LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize) as Record<string, unknown>[]
          logSlowQuery(`SELECT rowid, * FROM \`${panel.tableName}\` LIMIT ? OFFSET ?`, Date.now() - startQuery)
        }

        // 计算 nextCursor
        let nextCursor: number | null = null
        if (rows.length === pageSize && rows.length > 0) {
          const lastRow = rows[rows.length - 1]
          nextCursor = (lastRow as { rowid?: number }).rowid ?? null
        }

        return { rows, total, nextCursor }
      } catch (e) {
        return { rows: [], total: 0, error: String(e) }
      }
    }
  }
  return { rows: [], total: 0, error: '未找到关联数据源' }
}
