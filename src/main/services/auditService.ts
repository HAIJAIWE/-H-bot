import type Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { DEFAULT_PAGE_SIZE } from '@shared/types/pagination'
import { getOrCreateDb } from './dataService'

export interface AuditEntry {
  id?: number
  time: string
  user: string
  table: string
  action: 'update' | 'insert' | 'delete'
  before: string | null  // JSON string
  after: string | null   // JSON string
}

/**
 * 获取审计日志数据库连接（通过 dataService 连接池复用）。
 * 首次调用时创建数据库文件并初始化表结构（幂等）。
 */
function getAuditDb(projectPath: string): Database.Database {
  const dir = path.join(projectPath, 'data', 'logs')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'audit.db')
  return getOrCreateDb(dbPath, (db: any) => {
    db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      user TEXT NOT NULL,
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      before TEXT,
      after TEXT
    )`)
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(time)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name)')
  })
}

export function logAudit(projectPath: string, entry: Omit<AuditEntry, 'id' | 'time'>): void {
  const db = getAuditDb(projectPath)
  db.prepare('INSERT INTO audit_log (time, user, table_name, action, before, after) VALUES (?, ?, ?, ?, ?, ?)').run(
    new Date().toISOString(), entry.user, entry.table, entry.action, entry.before, entry.after
  )
}

export function listAudit(projectPath: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): { rows: AuditEntry[]; total: number } {
  const db = getAuditDb(projectPath)
  const total = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number }).c
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize) as AuditEntry[]
  return { rows, total }
}

export function searchAudit(projectPath: string, query: string): AuditEntry[] {
  const db = getAuditDb(projectPath)
  return db.prepare('SELECT * FROM audit_log WHERE table_name LIKE ? OR user LIKE ? ORDER BY id DESC LIMIT 50').all(`%${query}%`, `%${query}%`) as AuditEntry[]
}
