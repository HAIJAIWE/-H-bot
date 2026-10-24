// src/main/services/stateStore.ts
// 渲染层运行状态管理服务（F3）。
//
// 职责分工：
// - StateStore（本类，db 文件 `state.db`）：仅通过 IPC 暴露给渲染层使用，
//   支持运行状态对话框的可视化浏览/统计/清空（stateStore:* IPC）。
//   表结构：bot_state（通用 key-value）+ session_vars（session_id+var_name 主键）。
// - BotStateStore（`./statePersistence.ts`，db 文件 `bot_persistence.db`）：
//   main 进程内部使用，持久化机器人运行时状态（last_stopped_at 等）。
//
// 两者 db 文件相互独立，避免渲染层浏览操作影响 main 进程运行时状态读写。
// 使用方式：必须通过 `StateStore.getInstance()` 获取单例（与 BotStateStore 一致）。

import type Database from 'better-sqlite3'
import { existsSync, statSync } from 'fs'
import { BaseSqliteStore } from './baseSqliteStore'

// ---------------------------------------------------------------------------
// StateStore
// ---------------------------------------------------------------------------

const STATE_DB_FILE = 'state.db'
const SCHEMA_VERSION = 1

export class StateStore extends BaseSqliteStore {
  // 单例
  private static _instance: StateStore | null = null

  /** 获取 StateStore 单例（整个应用共享同一实例） */
  static getInstance(): StateStore {
    if (!StateStore._instance) {
      StateStore._instance = new StateStore()
    }
    return StateStore._instance
  }

  /** 重置单例（仅用于测试，生产代码禁止调用） */
  static resetInstanceForTesting(): void {
    StateStore._instance = null
  }

  // ---- 基类抽象方法实现 --------------------------------------------------

  protected getDbFileName(): string {
    return STATE_DB_FILE
  }

  protected _initSchema(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_vars (
        session_id TEXT NOT NULL,
        var_name TEXT NOT NULL,
        var_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, var_name)
      );
      CREATE INDEX IF NOT EXISTS idx_session_vars_sid ON session_vars(session_id);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  }

  // ---- bot_state 表操作 --------------------------------------------------

  /** 写入通用键值对（UPSERT），value 会被 JSON 序列化存储
   * @param key 键名
   * @param value 任意可序列化值
   * @param projectPath 项目根路径，用于定位 db 文件
   */
  set(key: string, value: unknown, projectPath: string): void {
    const serialized = JSON.stringify(value)
    const now = Date.now()
    this._tx(projectPath, (db) => {
      db.prepare(
        `INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, serialized, now)
    })
  }

  /** 读取通用键值对，不存在返回 null
   * @typeparam T 期望的返回类型
   * @param key 键名
   * @param projectPath 项目根路径
   * @returns 反序列化后的值，不存在则为 null
   */
  get<T = unknown>(key: string, projectPath: string): T | null {
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value) as T
    } catch {
      return row.value as unknown as T
    }
  }

  /** 删除通用键值对
   * @param key 键名
   * @param projectPath 项目根路径
   * @returns 是否实际删除了行（changes > 0）
   */
  delete(key: string, projectPath: string): boolean {
    return this._tx(projectPath, (db) => {
      const result = db.prepare('DELETE FROM bot_state WHERE key = ?').run(key)
      return result.changes > 0
    })
  }

  /** 列出通用键名，支持前缀过滤和分页
   * @param prefix 键名前缀过滤（LIKE prefix%），不传则返回全部
   * @param projectPath 项目根路径（必填，缺省返回空数组）
   * @param limit 最大返回条数
   * @param offset 跳过前 N 条
   * @returns 键名字符串数组，按 key 字母序排列
   */
  listKeys(prefix?: string, projectPath?: string, limit?: number, offset?: number): string[] {
    if (!projectPath) return []
    const db = this.getDb(projectPath)
    if (prefix) {
      const sql = limit !== undefined && offset !== undefined
        ? 'SELECT key FROM bot_state WHERE key LIKE ? ORDER BY key LIMIT ? OFFSET ?'
        : limit !== undefined
          ? 'SELECT key FROM bot_state WHERE key LIKE ? ORDER BY key LIMIT ?'
          : 'SELECT key FROM bot_state WHERE key LIKE ? ORDER BY key'
      const params: (string | number)[] = [`${prefix}%`]
      if (limit !== undefined) params.push(limit)
      if (offset !== undefined) params.push(offset)
      return (db.prepare(sql).all(...params) as { key: string }[]).map(r => r.key)
    }
    const sql = limit !== undefined && offset !== undefined
      ? 'SELECT key FROM bot_state ORDER BY key LIMIT ? OFFSET ?'
      : limit !== undefined
        ? 'SELECT key FROM bot_state ORDER BY key LIMIT ?'
        : 'SELECT key FROM bot_state ORDER BY key'
    const params: number[] = []
    if (limit !== undefined) params.push(limit)
    if (offset !== undefined) params.push(offset)
    return (db.prepare(sql).all(...params) as { key: string }[]).map(r => r.key)
  }

  /** 获取 bot_state 条目数量 */
  getStateCount(projectPath: string): number {
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT COUNT(*) as cnt FROM bot_state').get() as { cnt: number }
    return row.cnt
  }

  /** 获取所有 state 条目（含值和更新时间），支持分页
   * @param projectPath 项目根路径
   * @param limit 最大返回条数
   * @param offset 跳过前 N 条
   * @returns 条目数组，按 key 字母序排列
   */
  getAllStateEntries(projectPath: string, limit?: number, offset?: number): Array<{ key: string; value: unknown; updatedAt: number }> {
    const db = this.getDb(projectPath)
    const sql = limit !== undefined && offset !== undefined
      ? 'SELECT key, value, updated_at FROM bot_state ORDER BY key LIMIT ? OFFSET ?'
      : limit !== undefined
        ? 'SELECT key, value, updated_at FROM bot_state ORDER BY key LIMIT ?'
        : 'SELECT key, value, updated_at FROM bot_state ORDER BY key'
    const params: number[] = []
    if (limit !== undefined) params.push(limit)
    if (offset !== undefined) params.push(offset)
    const rows = db.prepare(sql).all(...params) as Array<{ key: string; value: string; updated_at: number }>
    return rows.map((row) => ({
      key: row.key,
      value: (() => { try { return JSON.parse(row.value) } catch { return row.value } })(),
      updatedAt: row.updated_at
    }))
  }

  // ---- session_vars 表操作 -----------------------------------------------

  /** 写入会话变量（UPSERT），value 会被 JSON 序列化存储
   * @param sessionId 会话 ID
   * @param varName 变量名
   * @param value 任意可序列化值
   * @param projectPath 项目根路径
   */
  setSessionVar(sessionId: string, varName: string, value: unknown, projectPath: string): void {
    const serialized = JSON.stringify(value)
    const now = Date.now()
    this._tx(projectPath, (db) => {
      db.prepare(
        `INSERT INTO session_vars (session_id, var_name, var_value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, var_name) DO UPDATE SET var_value = excluded.var_value, updated_at = excluded.updated_at`
      ).run(sessionId, varName, serialized, now)
    })
  }

  /** 读取会话变量，不存在返回 null
   * @typeparam T 期望的返回类型
   * @param sessionId 会话 ID
   * @param varName 变量名
   * @param projectPath 项目根路径
   * @returns 反序列化后的值，不存在则为 null
   */
  getSessionVar<T = unknown>(sessionId: string, varName: string, projectPath: string): T | null {
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT var_value FROM session_vars WHERE session_id = ? AND var_name = ?')
      .get(sessionId, varName) as { var_value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.var_value) as T
    } catch {
      return row.var_value as unknown as T
    }
  }

  /** 清除指定会话的所有变量
   * @param sessionId 会话 ID
   * @param projectPath 项目根路径
   */
  clearSession(sessionId: string, projectPath: string): void {
    this._tx(projectPath, (db) => {
      db.prepare('DELETE FROM session_vars WHERE session_id = ?').run(sessionId)
    })
  }

  /** 获取 session 数量（按 sessionId 去重） */
  getSessionCount(projectPath: string): number {
    const db = this.getDb(projectPath)
    const row = db.prepare('SELECT COUNT(DISTINCT session_id) as cnt FROM session_vars').get() as { cnt: number }
    return row.cnt
  }

  /** 获取 database 文件大小 (bytes) */
  getDbSize(projectPath: string): number {
    const fp = this.getDbFilePath(projectPath)
    if (!existsSync(fp)) return 0
    try {
      return statSync(fp).size
    } catch {
      return 0
    }
  }
}
