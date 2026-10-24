// src/main/services/infra/sqlite.ts
//
// better-sqlite3 的唯一入口 —— **必须懒加载**。
//
// 为什么不能 `import Database from 'better-sqlite3'`：
// 它是原生模块，ABI 跟运行环境绑定（Electron 42 = NODE_MODULE_VERSION 146，
// 本机 Node 24 = 137）。ABI 不匹配时，模块在 **import 阶段**就抛
// `NODE_MODULE_VERSION ...`；而主进程有一串模块静态依赖它，于是不是
// 「数据库功能不可用」，而是**窗口根本不出现**（2026-10-24 真实踩到：
// 跑完纯 Node 测试把 .node 重建成 137 再启动 dev，应用直接消失，
// 日志只有一行 ABI 报错）。
//
// 所以这里改成用到时才 require，并且失败时抛**能照着做**的错误：
// 重建命令写在消息里，界面/日志都能看到。

export interface SqliteOpenOptions {
  readonly?: boolean
  fileMustExist?: boolean
  timeout?: number
  verbose?: (message: string) => void
}

import type BetterSqlite3 from 'better-sqlite3'
// 兜底引擎本身只做类型导入（没有运行时环），这里静态引入以便打包器把它编进 main
import { createNodeSqliteFallback } from './nodeSqliteFallback'

/** 与 better-sqlite3 的 Database 类型一致，消费方不用做二次断言 */
export type SqliteDatabase = BetterSqlite3.Database

export type SqliteConstructor = new (file: string, options?: SqliteOpenOptions) => SqliteDatabase

export const SQLITE_REBUILD_HINT =
  '请先跑 node scripts/ensure-sqlite.js electron（dev/打包，Electron ABI）或 node scripts/ensure-sqlite.js node（纯 Node 测试）重建原生模块，再重启应用'

/** 当前连接实际用的引擎；'unknown' = 还没开过库 */
export type SqliteEngine = 'better-sqlite3' | 'node:sqlite'
let activeEngine: SqliteEngine | null = null

let cached: SqliteConstructor | null = null
/** 原生模块失败后记下来，避免每次 open 都重试 require 并刷一遍错误日志 */
let cachedError: Error | null = null
let loaderOverride: (() => unknown) | null = null
/** 兜底引擎的构造器：null 表示当前运行时没有 node:sqlite */
let fallbackCtor: SqliteConstructor | null | undefined

/**
 * 测试接缝：注入一个 loader（可以是会抛错的假实现）验证降级路径。
 * 传 null 恢复真实加载。
 */
export function setSqliteLoaderForTesting(fn: (() => unknown) | null): void {
  loaderOverride = fn
  cached = null
  cachedError = null
  activeEngine = null
}

/** 测试接缝：强制替换/关闭 node:sqlite 兜底（传 undefined 恢复自动探测） */
export function setSqliteFallbackForTesting(ctor: SqliteConstructor | null | undefined): void {
  fallbackCtor = ctor
  activeEngine = null
}

/** 当前实际使用的引擎（open 过一次才有值） */
export function sqliteEngine(): SqliteEngine | null {
  return activeEngine
}

/** 兼容 ESM/CJS 两种导出形状：module.exports = Database 与 { default: Database } */
function normalizeSqliteExport(mod: unknown): SqliteConstructor {
  if (typeof mod === 'function') return mod as SqliteConstructor
  const maybe = (mod as { default?: unknown } | null)?.default
  if (typeof maybe === 'function') return maybe as SqliteConstructor
  throw new Error('better-sqlite3 的导出不是构造函数（模块版本可能不匹配）')
}

/**
 * 把底层错误包成一条「能照着做」的消息。
 *
 * 为什么 require 和 new 都要包：better-sqlite3 的 lib/database.js 把原生 addon
 * 放在**首次 new Database()** 时才加载（DEFAULT_ADDON 懒加载），所以 ABI 不匹配
 * 往往在 openSqlite 才炸，而不是 require 的时候。
 */
function sqliteUnavailable(e: unknown): Error {
  const detail = e instanceof Error ? e.message : String(e)
  const message = `SQLite 原生模块不可用：${detail}。${SQLITE_REBUILD_HINT}`
  // 模块可能早于 logger 初始化被用到，这里刻意只用 console（logger 自己也可能失败）
  console.error(`[sqlite] ${message}`)
  return Object.assign(new Error(message), { cause: e })
}

/** 真正加载原生模块（导出形状校验）；失败时错误消息带重建命令 */
export function loadSqlite(): SqliteConstructor {
  if (cached) return cached
  if (cachedError) throw cachedError
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = loaderOverride ? loaderOverride() : require('better-sqlite3')
    cached = normalizeSqliteExport(mod)
    return cached
  } catch (e) {
    cachedError = sqliteUnavailable(e)
    throw cachedError
  }
}

/** 懒加载兜底引擎；没有 node:sqlite 时返回 null */
function loadFallback(): SqliteConstructor | null {
  if (fallbackCtor !== undefined) return fallbackCtor
  try {
    fallbackCtor = createNodeSqliteFallback()
  } catch {
    fallbackCtor = null
  }
  return fallbackCtor
}

/**
 * 打开连接：优先 better-sqlite3；原生模块不可用（典型是 ABI 不匹配）时
 * 退回 Node 内置的 node:sqlite，保证开发态数据库功能仍然可用。
 *
 * 测试可以注入 loader 或兜底构造器来验证这两条路径。
 */
export function openSqlite(file: string, options?: SqliteOpenOptions): SqliteDatabase {
  try {
    const Ctor = loadSqlite()
    const db = new Ctor(file, options)
    activeEngine = 'better-sqlite3'
    return db
  } catch (nativeError) {
    // 原生 addon 是在 new 时才加载的（见 sqliteUnavailable 注释），ABI 错误从这冒出来
    const Fallback = loadFallback()
    if (!Fallback) throw sqliteUnavailable(nativeError)
    const db = new Fallback(file, options)
    if (activeEngine !== 'node:sqlite') {
      activeEngine = 'node:sqlite'
      // 只在第一次降级时提示，避免每个连接刷一行
      console.warn(
        '[sqlite] better-sqlite3 不可用，已改用 Node 内置 node:sqlite 兜底（功能一致，读写在进程内完成）。' +
          SQLITE_REBUILD_HINT,
      )
    }
    return db
  }
}

/** 启动自检：不抛错，只报告，让主进程能打一条明确的日志/提示 */
export function sqliteStatus():
  | { ok: true; engine: SqliteEngine }
  | { ok: false; error: string } {
  try {
    // 必须真的开一个内存库：只 require 测不出 ABI（addon 懒加载）
    const db = openSqlite(':memory:')
    db.close()
    return { ok: true, engine: activeEngine ?? 'better-sqlite3' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}