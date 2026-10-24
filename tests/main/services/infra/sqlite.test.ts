// tests/main/services/infra/sqlite.test.ts
//
// 为什么专门测这一层：better-sqlite3 是原生模块，ABI 与运行环境绑定
// （Electron 42 = 146，纯 Node 24 = 137）。以前五个模块在**顶层** import 它，
// ABI 一旦不匹配，主进程在 import 阶段就抛，窗口根本不出现。
// 这个入口负责三件事：懒加载（应用还能起来）+ 失败消息可操作（带重建命令）
// + 原生不可用时的 node:sqlite 兜底（开发态数据库功能照常）。
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  loadSqlite,
  openSqlite,
  setSqliteFallbackForTesting,
  setSqliteLoaderForTesting,
  sqliteEngine,
  sqliteStatus,
  SQLITE_REBUILD_HINT,
} from '@main/services/infra/sqlite'

afterEach(() => {
  setSqliteLoaderForTesting(null)
  setSqliteFallbackForTesting(undefined)
  vi.restoreAllMocks()
})

const ABI_ERROR =
  'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 137. ' +
  'This version of Node.js requires NODE_MODULE_VERSION 146.'

function withBrokenNative(): void {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setSqliteLoaderForTesting(() => {
    throw new Error(ABI_ERROR)
  })
}

describe('sqlite 懒加载入口', () => {
  it('加载失败：错误消息保留底层原因，并带上可照做的重建命令', () => {
    withBrokenNative()

    expect(() => loadSqlite()).toThrowError(/NODE_MODULE_VERSION 137/)

    let message = ''
    let cause = ''
    try {
      loadSqlite()
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
      const c = (e as { cause?: unknown }).cause
      cause = c instanceof Error ? c.message : String(c ?? '')
    }
    expect(message).toContain(SQLITE_REBUILD_HINT)
    expect(message).toContain('SQLite 原生模块不可用')
    // 底层错误挂在 cause 上，排查时还能看到 ABI 原始文本
    expect(cause).toContain('NODE_MODULE_VERSION 137')
  })

  it('sqliteStatus 永不抛错：原生与兜底都不可用时 ok:false + 原因', () => {
    withBrokenNative()
    setSqliteFallbackForTesting(null) // 模拟没有 node:sqlite 的运行时
    const status = sqliteStatus()
    expect(status.ok).toBe(false)
    if (!status.ok) expect(status.error).toContain(SQLITE_REBUILD_HINT)
  })

  it('导出形状兼容：module.exports = 构造函数 或 { default: 构造函数 }', () => {
    function FakeDatabase(this: { readonly: boolean }, file: string) {
      this.readonly = file.startsWith('file:')
    }
    FakeDatabase.prototype.exec = () => undefined

    setSqliteLoaderForTesting(() => FakeDatabase)
    setSqliteFallbackForTesting(null)
    const viaCjs = openSqlite(':memory:')
    expect(viaCjs).toBeInstanceOf(FakeDatabase as unknown as new () => unknown)

    setSqliteLoaderForTesting(() => ({ default: FakeDatabase }))
    setSqliteFallbackForTesting(null)
    const viaEsm = openSqlite(':memory:')
    expect(viaEsm).toBeInstanceOf(FakeDatabase as unknown as new () => unknown)
  })

  it('导出形状不对：报"不是构造函数"，而不是等到调用处才炸', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSqliteLoaderForTesting(() => ({}))
    expect(() => loadSqlite()).toThrowError(/不是构造函数/)
  })

  it('openSqlite 能开库建表（原生可用时走原生，否则由兜底接管）', () => {
    setSqliteLoaderForTesting(null)
    setSqliteFallbackForTesting(undefined)
    const db = openSqlite(':memory:')
    db.exec('CREATE TABLE t (a TEXT)')
    const row = db.prepare('SELECT count(1) AS n FROM t').get() as { n: number }
    expect(row.n).toBe(0)
    db.close()
  })
})

describe('node:sqlite 兜底（原生 ABI 不匹配时的开发态）', () => {
  it('原生加载失败时自动兜底，读写/PRAGMA/事务都能用', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    withBrokenNative()

    const db = openSqlite(':memory:')
    expect(sqliteEngine()).toBe('node:sqlite')

    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER)')
    const info = db.prepare('INSERT INTO items (name, active) VALUES (?, ?)').run('alpha', true)
    expect(info).toMatchObject({ changes: 1 })
    expect(info.lastInsertRowid).toBe(1)

    const row = db.prepare('SELECT * FROM items WHERE name = @name').get({ name: 'alpha' }) as {
      id: number
      active: number
    }
    expect(row).toEqual({ id: 1, name: 'alpha', active: 1 })

    // undefined / boolean 归一化：node:sqlite 原生不收这两种绑定值
    db.prepare('INSERT INTO items (name, active) VALUES (?, ?)').run('beta', undefined)
    expect(db.prepare('SELECT count(1) AS n FROM items').get()).toEqual({ n: 2 })

    // pragma 两种语义：取值用 simple，设置不报错
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    db.pragma('user_version = 3')
    expect(db.pragma('user_version', { simple: true })).toBe(3)

    db.close()
  })

  it('transaction 返回函数，出错回滚且异常原样抛出', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    withBrokenNative()

    const db = openSqlite(':memory:')
    db.exec('CREATE TABLE t (v INTEGER)')
    const insert = db.transaction((v: number) => {
      db.prepare('INSERT INTO t (v) VALUES (?)').run(v)
      if (v < 0) throw new Error('负数不允许')
      return v
    })

    expect(insert(1)).toBe(1)
    expect(insert(2)).toBe(2)
    expect(() => insert(-1)).toThrowError('负数不允许')
    expect(db.prepare('SELECT count(1) AS n FROM t').get()).toEqual({ n: 2 })

    db.close()
  })

  it('把库备份到文件：backup() 可用且内容能再打开', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    withBrokenNative()

    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-sqlite-backup-'))
    try {
      const db = openSqlite(':memory:')
      db.exec('CREATE TABLE t (v INTEGER)')
      db.prepare('INSERT INTO t (v) VALUES (7)').run()
      const dest = join(dir, 'copy.db')
      await db.backup(dest)
      db.close()

      const reopened = openSqlite(dest)
      expect(reopened.prepare('SELECT v FROM t').get()).toEqual({ v: 7 })
      reopened.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('兜底也失败时给出带重建命令的错误，不吞异常', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    withBrokenNative()
    setSqliteFallbackForTesting(
      class {
        constructor() {
          throw new Error('node:sqlite 也不可用')
        }
      } as unknown as new () => never,
    )
    expect(() => openSqlite(':memory:')).toThrowError(/node:sqlite 也不可用/)
  })
})
