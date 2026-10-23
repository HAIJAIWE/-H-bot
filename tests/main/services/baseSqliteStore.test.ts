// tests/main/services/baseSqliteStore.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// 本机 better-sqlite3 只有 Electron ABI，纯 Node 的 vitest 加载不了原生绑定
// （Could not locate the bindings file…）。这里把模块换成 node:sqlite 实现的等价替身：
// SQL 语义（建表/事务/pragma/参数绑定）仍由 SQLite 引擎执行，只是换了加载方式。
vi.mock('better-sqlite3', async () => {
  const { makeSqliteShim } = await import('../../helpers/sqliteShim.js')
  return { default: makeSqliteShim() }
})
import { BaseSqliteStore } from '@main/services/baseSqliteStore'
import { mkdtemp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type Database from 'better-sqlite3'

/** 测试用具体子类 */
class TestStore extends BaseSqliteStore {
  protected getDbFileName(): string {
    return 'test.db'
  }

  protected _initSchema(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)
  }

  // 暴露 protected 方法供测试
  getDbPublic(projectPath: string): Database.Database {
    return this.getDb(projectPath)
  }

  txPublic<T>(projectPath: string, fn: (db: Database.Database) => T): T {
    return this._tx(projectPath, fn)
  }

  // 钩子追踪
  onClearProjectCalled = false
  onCloseCalled = false

  protected _onClearProject(): void {
    this.onClearProjectCalled = true
  }

  protected _onClose(): void {
    this.onCloseCalled = true
  }
}

let tmpDir: string
let store: TestStore

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qqbat-base-sqlite-'))
  store = new TestStore()
})

afterEach(async () => {
  store.close()
  await rm(tmpDir, { recursive: true, force: true })
})

describe('BaseSqliteStore', () => {
  describe('getDb', () => {
    it('首次调用创建连接并初始化 schema', () => {
      const db = store.getDbPublic(tmpDir)
      expect(db).toBeDefined()
      // schema 已初始化：可以查询 kv 表
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'").all() as { name: string }[]
      expect(tables.some(t => t.name === 'kv')).toBe(true)
    })

    it('同一项目路径返回缓存连接（同一实例）', () => {
      const db1 = store.getDbPublic(tmpDir)
      const db2 = store.getDbPublic(tmpDir)
      expect(db1).toBe(db2)
    })

    it('不同项目路径返回不同连接', () => {
      const db1 = store.getDbPublic(tmpDir)
      // 用另一个子目录作为不同项目
      const db2 = store.getDbPublic(join(tmpDir, 'project2'))
      expect(db1).not.toBe(db2)
    })

    it('自动创建 .qqbat 目录', () => {
      const projectPath = join(tmpDir, 'new-project')
      expect(existsSync(join(projectPath, '.qqbat'))).toBe(false)
      store.getDbPublic(projectPath)
      expect(existsSync(join(projectPath, '.qqbat'))).toBe(true)
    })

    it('启用 WAL 模式', () => {
      const db = store.getDbPublic(tmpDir)
      const result = db.pragma('journal_mode') as { journal_mode: string }[]
      expect(result[0].journal_mode).toBe('wal')
    })
  })

  describe('_tx 事务', () => {
    it('事务内操作成功提交', () => {
      store.txPublic(tmpDir, (db) => {
        db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('k1', 'v1')
      })
      const db = store.getDbPublic(tmpDir)
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('k1') as { value: string }
      expect(row.value).toBe('v1')
    })

    it('事务返回值正确传递', () => {
      const result = store.txPublic(tmpDir, (db) => {
        db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('k2', 'v2')
        return db.prepare('SELECT COUNT(*) as c FROM kv').get() as { c: number }
      })
      expect(result.c).toBe(1)
    })

    it('事务内异常时回滚', () => {
      expect(() => {
        store.txPublic(tmpDir, (db) => {
          db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('k3', 'v3')
          throw new Error('test rollback')
        })
      }).toThrow('test rollback')

      // 回滚后不应有 k3
      const db = store.getDbPublic(tmpDir)
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('k3')
      expect(row).toBeUndefined()
    })

    it('多次事务独立提交', () => {
      store.txPublic(tmpDir, (db) => {
        db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('a', '1')
      })
      store.txPublic(tmpDir, (db) => {
        db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('b', '2')
      })
      const db = store.getDbPublic(tmpDir)
      const count = db.prepare('SELECT COUNT(*) as c FROM kv').get() as { c: number }
      expect(count.c).toBe(2)
    })
  })

  describe('clearAll', () => {
    it('删除数据库文件', () => {
      store.getDbPublic(tmpDir)
      const dbPath = join(tmpDir, '.qqbat', 'test.db')
      expect(existsSync(dbPath)).toBe(true)

      store.clearAll(tmpDir)
      expect(existsSync(dbPath)).toBe(false)
    })

    it('删除 WAL/SHM 文件', () => {
      store.getDbPublic(tmpDir)
      // 写入数据触发 WAL 文件创建
      store.txPublic(tmpDir, (db) => {
        db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('x', 'y')
      })
      // checkpoint 后 WAL 文件可能存在也可能不存在，取决于 SQLite 实现
      // 这里主要验证 clearAll 不会因 WAL/SHM 文件存在而崩溃

      store.clearAll(tmpDir)
      const dbPath = join(tmpDir, '.qqbat', 'test.db')
      const walPath = `${dbPath}-wal`
      const shmPath = `${dbPath}-shm`
      expect(existsSync(dbPath)).toBe(false)
      expect(existsSync(walPath)).toBe(false)
      expect(existsSync(shmPath)).toBe(false)
    })

    it('清除缓存连接（下次 getDb 创建新连接）', () => {
      const db1 = store.getDbPublic(tmpDir)
      store.clearAll(tmpDir)
      const db2 = store.getDbPublic(tmpDir)
      expect(db1).not.toBe(db2)
    })

    it('调用 _onClearProject 钩子', () => {
      store.getDbPublic(tmpDir)
      expect(store.onClearProjectCalled).toBe(false)
      store.clearAll(tmpDir)
      expect(store.onClearProjectCalled).toBe(true)
    })

    it('钩子异常不阻止文件删除', () => {
      class ThrowingStore extends TestStore {
        protected _onClearProject(): void {
          throw new Error('hook error')
        }
      }
      const throwingStore = new ThrowingStore()
      throwingStore.getDbPublic(tmpDir)
      const dbPath = join(tmpDir, '.qqbat', 'test.db')
      expect(existsSync(dbPath)).toBe(true)

      // 不应抛出异常
      expect(() => throwingStore.clearAll(tmpDir)).not.toThrow()
      expect(existsSync(dbPath)).toBe(false)

      throwingStore.close()
    })

    it('未缓存的项目路径 clearAll 不崩溃', () => {
      expect(() => store.clearAll(join(tmpDir, 'never-opened'))).not.toThrow()
    })
  })

  describe('close', () => {
    it('关闭所有连接', () => {
      store.getDbPublic(tmpDir)
      store.getDbPublic(join(tmpDir, 'p2'))
      // close 后缓存应清空（通过新 getDb 返回新实例验证）
      const db1 = store.getDbPublic(tmpDir)
      store.close()
      const db2 = store.getDbPublic(tmpDir)
      expect(db1).not.toBe(db2)
    })

    it('调用 _onClose 钩子', () => {
      store.close()
      expect(store.onCloseCalled).toBe(true)
    })

    it('重复 close 不崩溃', () => {
      store.close()
      expect(() => store.close()).not.toThrow()
    })
  })

  describe('路径计算', () => {
    it('getDir 返回 .qqbat 子目录', () => {
      const db = store.getDbPublic(tmpDir)
      expect(db).toBeDefined()
      // 通过文件存在性间接验证路径
      expect(existsSync(join(tmpDir, '.qqbat', 'test.db'))).toBe(true)
    })

    it('不同子类可使用不同 db 文件名', () => {
      class AnotherStore extends TestStore {
        protected getDbFileName(): string {
          return 'another.db'
        }
      }
      const another = new AnotherStore()
      another.getDbPublic(tmpDir)
      expect(existsSync(join(tmpDir, '.qqbat', 'another.db'))).toBe(true)
      another.close()
    })
  })

  describe('schema 幂等性', () => {
    it('重复调用 getDb 不重复创建表', () => {
      const db1 = store.getDbPublic(tmpDir)
      const db2 = store.getDbPublic(tmpDir)
      expect(db1).toBe(db2) // 同一连接

      // kv 表只应有一个
      const tables = db1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'").all() as { name: string }[]
      expect(tables.length).toBe(1)
    })
  })
})
