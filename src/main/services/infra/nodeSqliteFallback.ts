// src/main/services/infra/nodeSqliteFallback.ts
//
// better-sqlite3 不可用时的**兜底引擎**：Node 内置的 `node:sqlite`。
//
// 为什么需要：better-sqlite3 是按 ABI 编译的原生模块（Node 24 = 137，
// Electron 42 = 146）；只装了一种 ABI 的原生模块时，另一种运行时报
// NODE_MODULE_VERSION 不匹配，整个数据库功能消失。而 Node 24 / Electron 42
// 自带 `node:sqlite`（N-API，不挑 ABI），让它兜底，开发态也能正常用数据库。
//
// 这层只实现生产代码**真正用过**的那一小片 better-sqlite3 接口：
//   exec / prepare().run|get|all / pragma(source[, { simple }]) /
//   transaction(fn) / backup(dest) / close / open 状态
// 形状差异都在这层吸收：
//   · better-sqlite3 的 `pragma('journal_mode = WAL')` 是"执行"，`pragma('user_version', { simple: true })` 是"取值"
//   · better-sqlite3 的 `transaction(fn)` 返回**函数**，不是直接执行；嵌套事务要用 savepoint
//   · node:sqlite 不收 undefined / boolean 绑定值，这里统一归一化
//
// 注意：这不是"替代 better-sqlite3"，只是不让开发态因为 ABI 问题卡死。
// 打包/部署仍然应该跑 `node scripts/ensure-sqlite.js electron` 用原生模块。

import type { SqliteConstructor } from './sqlite'

/** node:sqlite 的最小形状（不全量声明，避免跟着 Node 版本漂） */
interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

interface NodeSqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): NodeSqliteStatement
  close(): void
}

interface NodeSqliteModule {
  DatabaseSync: new (file: string, options?: Record<string, unknown>) => NodeSqliteDatabase
  backup?: (source: NodeSqliteDatabase, dest: string) => Promise<void>
}

/** 绑定值归一化：node:sqlite 只接受 null/number/bigint/string/Uint8Array */
function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  return value
}

/**
 * 位置参数与命名参数对象混用时逐项归一化。
 * 命名对象的键可能带 better-sqlite3 允许的 :name / @name / $name 前缀，
 * node:sqlite 默认按**不带前缀**的名字匹配，所以这里去掉一层前缀。
 */
function normalizeParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p !== null && typeof p === 'object' && !(p instanceof Uint8Array) && !Array.isArray(p)) {
      const named: Record<string, unknown> = {}
      for (const [rawKey, v] of Object.entries(p as Record<string, unknown>)) {
        const key = /^[:@$]/.test(rawKey) ? rawKey.slice(1) : rawKey
        named[key] = normalizeValue(v)
      }
      return named
    }
    if (Array.isArray(p)) return p.map(normalizeValue)
    return normalizeValue(p)
  })
}

function toNumber(value: number | bigint | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return Number(value ?? 0)
}

/**
 * 造一个 better-sqlite3 兼容的 Database 类。
 *
 * 每次调用返回**新的类**：openSqlite 可能被不同模块持有，闭包里带的
 * 事务计数器不能跨连接共享。
 */
export function createNodeSqliteFallback(): SqliteConstructor | null {
  let mod: NodeSqliteModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('node:sqlite') as NodeSqliteModule
  } catch {
    return null
  }
  if (typeof mod.DatabaseSync !== 'function') return null
  const { DatabaseSync, backup } = mod

  return class NodeSqliteCompatDatabase {
    private db: NodeSqliteDatabase | null
    private txSeq = 0

    constructor(file: string, options?: Record<string, unknown>) {
      this.db = new DatabaseSync(file, {
        // better-sqlite3 的 readonly 对我们只有读场景用；node:sqlite 用 readOnly
        ...(options && options.readonly ? { readOnly: true } : {}),
      }) as unknown as NodeSqliteDatabase
    }

    /** 关掉或已关时给出与 better-sqlite3 相近的报错 */
    private handle(): NodeSqliteDatabase {
      if (!this.db) throw new Error('The database connection is not open')
      return this.db
    }

    exec(sql: string): this {
      this.handle().exec(sql)
      return this
    }

    prepare(sql: string) {
      // 语句在每次 prepare 时创建（node:sqlite 的 StatementSync 可以复用，
      // 但生产代码本来就把 prepare 结果当一次性对象用，没必要缓存）
      const stmt = this.handle().prepare(sql)
      return {
        run: (...params: unknown[]) => {
          const r = stmt.run(...normalizeParams(params))
          return { changes: toNumber(r.changes), lastInsertRowid: toNumber(r.lastInsertRowid) }
        },
        get: (...params: unknown[]) =>
          stmt.get(...normalizeParams(params)) as Record<string, unknown> | undefined,
        all: (...params: unknown[]) =>
          stmt.all(...normalizeParams(params)) as Record<string, unknown>[],
      }
    }

    /**
     * better-sqlite3 的 pragma 语义：
     * - `pragma('journal_mode = WAL')` → 执行并返回结果行
     * - `pragma('journal_mode')` → 返回行数组
     * - `pragma('user_version', { simple: true })` → 返回单列标量
     */
    pragma(source: string, options?: { simple?: boolean }): unknown {
      let rows: Record<string, unknown>[]
      try {
        rows = this.handle().prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[]
      } catch {
        // 有些设置型 PRAGMA 不返回行，prepare().all() 仍会给出空数组，不走到这里；
        // 真出错（语法/不支持）时退回 exec，让调用方拿到真实错误
        this.handle().exec(`PRAGMA ${source}`)
        return []
      }
      if (options?.simple) {
        const first = rows[0]
        return first ? Object.values(first)[0] : undefined
      }
      return rows
    }

    /** better-sqlite3 返回可调用函数；嵌套调用用 savepoint，语义与它一致 */
    transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
      return (...args: TArgs): TResult => {
        const name = `qqbat_tx_${++this.txSeq}`
        const db = this.handle()
        db.exec(`SAVEPOINT ${name}`)
        try {
          const result = fn(...args)
          db.exec(`RELEASE ${name}`)
          return result
        } catch (e) {
          try {
            db.exec(`ROLLBACK TO ${name}`)
            db.exec(`RELEASE ${name}`)
          } catch {
            // 回滚失败（连接已断）时保留原始错误 —— 那个才是有信息量的
          }
          throw e
        }
      }
    }

    /** 异步备份：Node 24 自带 backup()，缺失时退回 VACUUM INTO */
    async backup(dest: string): Promise<void> {
      const db = this.handle()
      if (typeof backup === 'function') {
        await backup(db, dest)
        return
      }
      const escaped = dest.replace(/'/g, "''")
      db.exec(`VACUUM INTO '${escaped}'`)
    }

    close(): void {
      if (this.db) {
        this.db.close()
        this.db = null
      }
    }
  } as unknown as SqliteConstructor
}