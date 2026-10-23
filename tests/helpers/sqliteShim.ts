// tests/helpers/sqliteShim.ts
//
// better-sqlite3 的测试替身：用 Node 内置的 `node:sqlite`（DatabaseSync）模拟它被用到的形状。
//
// 为什么需要：项目依赖的 better-sqlite3 是为 Electron ABI 编译的，在纯 Node 的 vitest 里
// `require` 会报 `Could not locate the bindings file`。而生产代码只用到很窄的一组 API
// （exec / prepare().run|get|all / pragma / transaction / close），完全可以垫一层。
//
// 注入方式（生产代码留的测试钩子）：
//   import { setDbOpenerForTesting, setDbCtorForTesting } from '@main/services/project/dataService'
//   const ShimDatabase = makeSqliteShim()
//   setDbOpenerForTesting((filePath) => new ShimDatabase(filePath))
//   setDbCtorForTesting(ShimDatabase as never)
//
// 形状差异都在这层吸收：
// - better-sqlite3 的 `pragma('journal_mode = WAL')` 是"执行"，`pragma('user_version', {simple:true})` 是"取值"
// - better-sqlite3 的 `transaction(fn)` 返回**函数**，不是直接执行
// - node:sqlite 不收 `undefined` / `boolean` 绑定值，这里统一归一化

import { DatabaseSync } from 'node:sqlite'

/** better-sqlite3 的 `run()` 返回值（只取生产代码真正读的两个字段） */
export interface ShimRunResult {
  changes: number
  lastInsertRowid: number
}

export interface ShimStatement {
  run(...params: unknown[]): ShimRunResult
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

/** 绑定值归一化：node:sqlite 只接受 null/number/bigint/string/Uint8Array */
function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  return value
}

/** 位置参数与命名参数对象混用时逐项归一化 */
function normalizeParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p !== null && typeof p === 'object' && !(p instanceof Uint8Array)) {
      const named: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(p as Record<string, unknown>)) named[k] = normalizeParam(v)
      return named
    }
    return normalizeParam(p)
  })
}

/**
 * 造一个 better-sqlite3 兼容的 Database 类。
 *
 * 每次调用返回**新的类**（而不是共享单例）：生产代码/测试会把类本身塞进
 * `setDbCtorForTesting`，共享类会让不同测试文件之间的连接状态串味。
 */
export function makeSqliteShim() {
  // 注：测试里要把它当构造器传出/塞进 setDbCtorForTesting，匿名类带 private
  // 成员会触发 TS4094（declaration emit 无法为匿名类生成私有成员声明），故 internals 保持 public。
  return class ShimDatabase {
    db: DatabaseSync | null

    constructor(filePath: string) {
      // ':memory:' 是 node:sqlite 认识的，不用特判
      this.db = new DatabaseSync(filePath)
    }

    /**
     * 连接句柄。
     * close() 之后这里返回 null 而不是留着已关闭的 DatabaseSync —— 两个原因：
     * 1) 与 better-sqlite3 一致：关闭后再用会抛错，而不是无声读写；
     * 2) 断言库做相等比较时会读对象自有属性，而已关闭的 DatabaseSync 的
     *    isOpen/isTransaction/limits 是**会抛 "database is not open" 的 getter**，
     *    留着它会让 expect(db1).not.toBe(db2) 这种普通用例也炸。
     */
    handle(): DatabaseSync {
      if (!this.db) throw new Error('The database connection is not open')
      return this.db
    }

    exec(sql: string): this {
      this.handle().exec(sql)
      return this
    }

    prepare(sql: string): ShimStatement {
      const stmt = this.handle().prepare(sql)
      return {
        run: (...params: unknown[]): ShimRunResult => {
          const r = stmt.run(...(normalizeParams(params) as never[]))
          return {
            changes: Number(r.changes ?? 0),
            lastInsertRowid: Number(r.lastInsertRowid ?? 0),
          }
        },
        get: (...params: unknown[]): Record<string, unknown> | undefined =>
          stmt.get(...(normalizeParams(params) as never[])) as Record<string, unknown> | undefined,
        all: (...params: unknown[]): Record<string, unknown>[] =>
          stmt.all(...(normalizeParams(params) as never[])) as Record<string, unknown>[],
      }
    }

    /**
     * better-sqlite3 的 pragma：
     * - `pragma('journal_mode = WAL')` → 执行后返回结果行
     * - `pragma('journal_mode')` → 返回行数组
     * - `pragma('user_version', { simple: true })` → 返回单列标量
     */
    pragma(source: string, options?: { simple?: boolean }): unknown {
      const rows = this.handle().prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[]
      if (options?.simple) {
        const first = rows[0]
        return first ? Object.values(first)[0] : undefined
      }
      return rows
    }

    /** better-sqlite3 返回可调用函数；参数原样透传 */
    transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs): TResult => {
        this.handle().exec('BEGIN')
        try {
          const result = fn(...args)
          this.handle().exec('COMMIT')
          return result
        } catch (e) {
          try {
            this.handle().exec('ROLLBACK')
          } catch {
            // 回滚失败（连接已断）时保留原始错误 —— 那个才是有信息量的
          }
          throw e
        }
      }
    }

    close(): void {
      if (this.db) {
        this.db.close()
        this.db = null
      }
    }
  }
}

/** 兜底：把未知异常转成可读文本（测试里断言错误消息时用） */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
