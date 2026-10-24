// src/main/services/statePersistence.ts
// 机器人运行时状态持久化服务（main 进程内部使用）。
//
// 职责分工：
// - BotStateStore（本类，db 文件 `bot_persistence.db`）：main 进程内部使用，
//   持久化机器人运行时状态（last_stopped_at/last_uptime_seconds/last_crash_count 等）、
//   会话级临时变量（24h 过期）与长期记忆。
// - StateStore（`./stateStore.ts`，db 文件 `state.db`）：渲染层运行状态管理对话框使用，
//   支持可视化浏览/统计/清空所有持久化状态。
// 两者表结构相似但用途不同：本类供 main 进程内部直接调用，StateStore 供 IPC 暴露给渲染层。
//
// 使用方式：必须通过 `BotStateStore.getInstance()` 获取单例。
// 单例化目的：`BaseSqliteStore._dbCache` 是实例属性，若每次 `new` 都创建新实例，
// 会重复打开数据库连接导致连接泄漏；单例保证全进程共享一个连接缓存。
import type Database from 'better-sqlite3'
import { BaseSqliteStore } from './baseSqliteStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreEntryRow {
  key: string
  value: string  // JSON 序列化后的字符串
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  updated_at: number  // unix ms
}

// ---------------------------------------------------------------------------
// BotStateStore
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000  // 惰性清理间隔：1 小时
const STATE_DB_FILE = 'bot_persistence.db'

export class BotStateStore extends BaseSqliteStore {
  // 单例：避免重复打开数据库连接（_dbCache 为实例属性）
  private static _instance: BotStateStore | null = null

  static getInstance(): BotStateStore {
    if (!BotStateStore._instance) {
      BotStateStore._instance = new BotStateStore()
    }
    return BotStateStore._instance
  }

  static resetInstanceForTesting(): void {
    BotStateStore._instance?.close()
    BotStateStore._instance = null
  }

  private _lastCleanup: Map<string, number> = new Map()  // projectPath → 上次清理时间

  // ---- 基类抽象方法实现 --------------------------------------------------

  protected getDbFileName(): string {
    return STATE_DB_FILE
  }

  protected _initSchema(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_vars (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        type TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_memory (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        type TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        type TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_vars_updated ON session_vars(updated_at);
    `)
  }

  // ---- 基类钩子 ----------------------------------------------------------

  protected _onClearProject(projectPath: string): void {
    this._lastCleanup.delete(projectPath)
  }

  protected _onClose(): void {
    this._lastCleanup.clear()
  }

  // ---- 内部工具 ----------------------------------------------------------

  /** 从 type 字段反推 JS 类型（用于 Python 互操作） */
  private detectType(value: unknown): StoreEntryRow['type'] {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    if (Array.isArray(value)) return 'array'
    return 'object'
  }

  /**
   * 惰性清理过期 session：仅在距上次清理超过 CLEANUP_INTERVAL_MS 时触发。
   * 修复原实现 getSession 每次都触发写盘的问题。
   */
  private _maybeCleanupSessions(projectPath: string): void {
    const now = Date.now()
    const last = this._lastCleanup.get(projectPath) ?? 0
    if (now - last < CLEANUP_INTERVAL_MS) return
    this._lastCleanup.set(projectPath, now)
    this._tx(projectPath, (db) => {
      const cutoff = now - SESSION_TTL_MS
      db.prepare('DELETE FROM session_vars WHERE updated_at < ?').run(cutoff)
    })
  }

  // ---- Session: 会话变量（24h 过期） ------------------------------------

  setSession(projectPath: string, key: string, value: unknown): void {
    const serialized = JSON.stringify(value)
    const type = this.detectType(value)
    const now = Date.now()
    this._tx(projectPath, (db) => {
      db.prepare(
        `INSERT INTO session_vars (key, value, type, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at`
      ).run(key, serialized, type, now)
    })
    this._maybeCleanupSessions(projectPath)
  }

  getSession(projectPath: string, key: string): unknown {
    // getSession 不再每次触发写盘，仅每小时低频惰性清理一次过期 session
    this._maybeCleanupSessions(projectPath)
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT value FROM session_vars WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }

  deleteSession(projectPath: string, key: string): void {
    this._tx(projectPath, (db) => {
      db.prepare('DELETE FROM session_vars WHERE key = ?').run(key)
    })
  }

  // ---- Memory: 长期记忆 ------------------------------------------------

  setMemory(projectPath: string, key: string, value: unknown): void {
    const serialized = JSON.stringify(value)
    const type = this.detectType(value)
    const now = Date.now()
    this._tx(projectPath, (db) => {
      db.prepare(
        `INSERT INTO bot_memory (key, value, type, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at`
      ).run(key, serialized, type, now)
    })
  }

  getMemory(projectPath: string, key: string): unknown {
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT value FROM bot_memory WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }

  deleteMemory(projectPath: string, key: string): void {
    this._tx(projectPath, (db) => {
      db.prepare('DELETE FROM bot_memory WHERE key = ?').run(key)
    })
  }

  // ---- Runtime State: 运行时状态（计数器、时间戳等） --------------------

  setState(projectPath: string, key: string, value: unknown): void {
    const serialized = JSON.stringify(value)
    const type = this.detectType(value)
    const now = Date.now()
    this._tx(projectPath, (db) => {
      db.prepare(
        `INSERT INTO runtime_state (key, value, type, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at`
      ).run(key, serialized, type, now)
    })
  }

  getState(projectPath: string, key: string): unknown {
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT value FROM runtime_state WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }

  // ---- 通用工具 ---------------------------------------------------------

  /** 获取所有存储的 key（按存储分类） */
  getAllKeys(projectPath: string): { session: string[]; memory: string[]; state: string[] } {
    const db = this.getDb(projectPath)
    this._maybeCleanupSessions(projectPath)
    const sessionKeys = (db.prepare('SELECT key FROM session_vars ORDER BY key').all() as { key: string }[]).map(r => r.key)
    const memoryKeys = (db.prepare('SELECT key FROM bot_memory ORDER BY key').all() as { key: string }[]).map(r => r.key)
    const stateKeys = (db.prepare('SELECT key FROM runtime_state ORDER BY key').all() as { key: string }[]).map(r => r.key)
    return { session: sessionKeys, memory: memoryKeys, state: stateKeys }
  }
}
