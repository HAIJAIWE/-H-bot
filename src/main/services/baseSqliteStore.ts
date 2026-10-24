// src/main/services/baseSqliteStore.ts
// SQLite 存储基类：封装 better-sqlite3 连接缓存、事务包装、清理等通用逻辑。
// 子类需实现 getDbFileName 和 _initSchema。

import type Database from 'better-sqlite3'
import { openSqlite } from './infra/sqlite'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'

/**
 * SQLite 存储基类。
 *
 * 提取 StateStore 与 BotStateStore 共享的逻辑：
 * - 按项目隔离的连接缓存（_dbCache）
 * - 目录/文件路径计算（.qqbat/<dbFileName>）
 * - 连接初始化（WAL 模式 + 子类 schema）
 * - 事务包装器（_tx）
 * - clearAll/close 资源清理（含 WAL/SHM 文件）
 *
 * 子类需实现：
 * - getDbFileName(): 返回数据库文件名（如 'state.db'）
 * - _initSchema(db): 初始化表结构（幂等）
 *
 * 子类可重写钩子：
 * - _onClearProject(projectPath): 项目级清理（如清理辅助缓存）
 * - _onClose(): 全局关闭钩子
 */
export abstract class BaseSqliteStore {
  protected _dbCache: Map<string, Database.Database> = new Map()

  /** 子类提供数据库文件名（如 'state.db'） */
  protected abstract getDbFileName(): string

  /** 子类提供 schema 初始化 SQL（幂等执行） */
  protected abstract _initSchema(db: Database.Database): void

  /** 获取项目 .qqbat 目录路径 */
  protected getDir(projectPath: string): string {
    return join(projectPath, '.qqbat')
  }

  /** 获取数据库文件完整路径 */
  protected getDbFilePath(projectPath: string): string {
    return join(this.getDir(projectPath), this.getDbFileName())
  }

  /**
   * 获取（或创建）指定项目的 SQLite 连接。
   * better-sqlite3 是同步的，单进程内无需连接池，但按项目隔离缓存。
   */
  protected getDb(projectPath: string): Database.Database {
    const cached = this._dbCache.get(projectPath)
    if (cached) return cached

    const dir = this.getDir(projectPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const dbPath = this.getDbFilePath(projectPath)
    const db = openSqlite(dbPath)
    // 启用 WAL 模式提升并发读性能
    db.pragma('journal_mode = WAL')
    // 初始化 schema（幂等）
    this._initSchema(db)
    this._dbCache.set(projectPath, db)
    return db
  }

  /**
   * 事务执行：better-sqlite3 同步 API，transaction() 保证原子性。
   * 解决原 JSON 实现 read-modify-write 竞态问题。
   */
  protected _tx<T>(projectPath: string, fn: (db: Database.Database) => T): T {
    const db = this.getDb(projectPath)
    const tx = db.transaction(fn)
    return tx(db)
  }

  /** 清除所有持久化状态：关闭连接并删除数据库文件（含 WAL/SHM） */
  clearAll(projectPath: string): void {
    const db = this._dbCache.get(projectPath)
    if (db) {
      try { db.close() } catch { /* ignore */ }
      this._dbCache.delete(projectPath)
    }
    // 钩子异常不应阻塞文件删除（防御性：子类钩子可能不遵守不抛异常约定）
    try {
      this._onClearProject(projectPath)
    } catch (e) {
      logger.warn('[BaseSqliteStore] _onClearProject 钩子异常:', e)
    }
    const fp = this.getDbFilePath(projectPath)
    if (existsSync(fp)) {
      try { unlinkSync(fp) } catch { /* ignore */ }
    }
    // 同时删除 WAL/SHM 文件
    for (const suffix of ['-wal', '-shm']) {
      const walPath = `${fp}${suffix}`
      if (existsSync(walPath)) {
        try { unlinkSync(walPath) } catch { /* ignore */ }
      }
    }
  }

  /** 子类可重写：项目级清理钩子（如清理辅助缓存） */
  protected _onClearProject(_projectPath: string): void {
    // 默认无操作
  }

  /** 清理所有连接 */
  close(): void {
    for (const [, db] of this._dbCache) {
      try { db.close() } catch { /* ignore */ }
    }
    this._dbCache.clear()
    this._onClose()
  }

  /** 子类可重写：全局关闭钩子 */
  protected _onClose(): void {
    // 默认无操作
  }
}
