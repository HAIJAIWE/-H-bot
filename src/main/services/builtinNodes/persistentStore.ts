/**
 * 持久化存储纯 TS 实现
 * 
 * 历史：由已移除的 qqbat_nodes/builtin/persistent_store.py 移植而来，现状以本文件为准
 * - SQLite + better-sqlite3 (同步，Electron 主进程可用)
 * - WAL 模式 + 连接池 + 写锁
 * - 作用域隔离：user/group/global
 * - TTL 过期自动清理
 * - 原子操作：increment / list_append / batch_save
 * - 并发安全：写锁串行化 + WAL 模式
 */

import * as fs from 'fs';
import * as path from 'path';

// CommonJS 环境下 __dirname 可直接使用

// ============================================================
// 常量与类型定义
// ============================================================

type Scope = 'user' | 'group' | 'global';

/** 存储操作需要的事件形状（本模块只关心触发者与群号） */
export interface StoreEvent {
  user_id?: string | number;
  group_id?: string | number;
}

interface PersistentValue {
  value: unknown;
  expire_at: number | null;
}

interface LoadResult {
  value: unknown;
  expired: boolean;
}

interface SaveOptions {
  key: string;
  value: unknown;
  scope: 'user' | 'group' | 'global';
  event: StoreEvent;
  ttl: number;
}

interface IncrOptions {
  key: string;
  amount: number;
  scope: 'user' | 'group' | 'global';
  defaultVal: number;
  event: StoreEvent;
}

interface ListAppendOptions {
  key: string;
  item: unknown;
  scope: 'user' | 'group' | 'global';
  maxLength: number;
  event: StoreEvent;
}

interface BatchSaveOptions {
  dataDict: Record<string, unknown>;
  scope: 'user' | 'group' | 'global';
  event: StoreEvent;
  ttl: number;
}

interface ListAppendResult {
  result: unknown[];
  length: number;
  new: boolean;
  error: string;
}

interface IncrResult {
  result: number;
  oldValue: number;
  error: string;
}

interface BatchSaveResult {
  saved: number;
  keysList: string[];
  errors: string[];
}

interface LoopControlResult {
  action: 'continue' | 'break' | 'return';
  value?: unknown;
  error: string;
}

interface PersistResult {
  result: unknown;
  success: boolean;
  error: string;
  exists: boolean;
  is_default: boolean;
  old_value: unknown;
  new: boolean;
  saved: number;
  values: Record<string, unknown>;
  count: number;
  length: number;
  keys_list: string[];
}

/** better-sqlite3 结果行（本模块用到的列均为文本/可为空） */
type SqliteRow = Record<string, string>;

/** better-sqlite3 语句的最小形状 */
interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  all(...params: unknown[]): SqliteRow[];
  get(...params: unknown[]): SqliteRow;
}

/** better-sqlite3 连接的最小形状（测试注入的 node:sqlite shim 同样满足） */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(source: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

// ============================================================
// 数据库连接管理（单例，WAL 模式，连接复用）
// ============================================================

let db: SqliteDatabase | null = null;

/**
 * 预览用的数据目录覆盖。
 *
 * 本模块是**进程级单例**（库路径为 `%APPDATA%/qqbot/data/players/persistent.db`，
 * 不区分项目）。流程预览需要在"真实数据的副本"上运行且不能写回真库，因此允许
 * 临时把数据目录切到克隆目录 —— 传 `null` 恢复。
 *
 * 只有 `previewRunner` 会调用它（预览是串行的，且必定在 finally 中恢复）。
 */
let previewDataDirOverride: string | null = null;

export function setPreviewDataDirOverride(dir: string | null): void {
  if (previewDataDirOverride === dir) return;
  // 切换目录必须丢弃已有连接，否则仍然读写旧库
  closeDb();
  previewDataDirOverride = dir;
}

/** 关闭当前连接（切换库路径 / 测试清理用） */
export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* 忽略关闭错误 */
    }
    db = null;
  }
  // ⚠️ 这里必须把 `dbInstance` 也清掉：`getDbSync()` 走的是那个缓存，
  // 只清 `db` 会让它继续返回**已关闭的旧连接** —— 现象就是预览里
  // `[persistentStore] loadValue 失败: TypeError: The database connection is not open`，
  // 于是「本地测试」里所有持久化读写都静默失败（返回 null → 回退默认值）。
  dbInstance = null;
}

/**
 * 关闭**属于某个项目**的连接（删除项目前必须调用）。
 *
 * ## 为什么需要它（2026-09-26 实测出来的真缺陷）
 *
 * 项目只要跑过一次流程，`{项目}/data/players/persistent.db` 就被本模块缓存着。
 * Windows 上带着打开的句柄删目录会抛 `EBUSY: resource busy or locked` ——
 * 用户视角是「点了删除项目，目录还在」，报错还与被删的东西无关。
 *
 * ⚠️ 10/18 产物里这里是「每项目一条连接」的 `dbPool`（Map<库路径, 连接>）；
 * 本文件恢复的是更早的单连接版本，所以按"当前唯一连接是否落在该目录下"判断。
 * 恢复连接池那天，这里要改成遍历池（判据不变：按库文件路径归属）。
 *
 * @returns 实际关闭的连接数（测试与日志用；0 是正常情况）
 */
export function closeDbUnder(projectDir: string): number {
  const norm = (p: string): string => {
    const abs = path.resolve(p);
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  const prefix = norm(projectDir) + path.sep;
  let closed = 0;
  try {
    const current = db;
    if (current && norm(getDbPath()).startsWith(prefix)) {
      closeDb();
      closed++;
    }
  } catch {
    /* 取路径失败（未初始化 / userData 不可用）→ 没有可关的连接 */
  }
  return closed;
}

function getDbPath(): string {
  if (previewDataDirOverride) {
    if (!fs.existsSync(previewDataDirOverride)) {
      fs.mkdirSync(previewDataDirOverride, { recursive: true });
    }
    return path.join(previewDataDirOverride, 'persistent.db');
  }
  const userData = process.env.APPDATA || (process.platform === 'darwin' 
    ? path.join(process.env.HOME || '', 'Library', 'Application Support')
    : path.join(process.env.HOME || '', '.config'));
  const baseDir = path.join(userData, 'qqbot', 'data', 'players');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return path.join(baseDir, 'persistent.db');
}

/**
 * 仅供测试：替换底层 SQLite 打开方式（传 null 恢复真实实现）。
 *
 * 本机 better-sqlite3 只有 electron ABI 的二进制，Node 下跑测试用不了，
 * 所以 `incrValue` 这类**必须验证存储行为**的逻辑靠注入内存后端来测
 * （与 `databaseWrite.setDbOpenerForTesting` 同一套做法）。
 */
type SqliteOpener = (filePath: string, options?: { fileMustExist?: boolean }) => SqliteDatabase;

let dbOpenerOverride: SqliteOpener | null = null;

export function setDbOpenerForTesting(opener: SqliteOpener | null): void {
  closeDb();
  dbOpenerOverride = opener;
}

function getDb(): SqliteDatabase {
  if (!db) {
    const dbPath = getDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    const dbInstance = dbOpenerOverride
      ? dbOpenerOverride(getDbPath(), { fileMustExist: false })
      : new (require('better-sqlite3'))(getDbPath(), {
          fileMustExist: false,
          timeout: 5000,
        });
    
    // 启用 WAL 模式 + 并发优化
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('busy_timeout = 5000');
    dbInstance.pragma('temp_store = MEMORY');
    
    // 创建表
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS _persistent (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        qq TEXT,
        updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
      );
      CREATE INDEX IF NOT EXISTS idx_persistent_scope ON _persistent(scope);
      CREATE INDEX IF NOT EXISTS idx_persistent_qq ON _persistent(qq);
    `);
    
    db = dbInstance;
  }
  return db!;
}

// 写锁管理：所有「读-改-写」型存储操作必须**串行**执行。
//
// ⚠️ 原实现是错的（D3 并发原子时发现）：同一把锁已有 Promise 时，它直接返回**旧 Promise
// 的结果**，既没有排队也没有串行 —— 等于没加锁，两个并发请求会各读各的再各写各的
// （抽卡场景下两人都成功、库存变 -1）。这里改成真正的 FIFO 队列。
let storeLock: Promise<unknown> = Promise.resolve();

/** 串行执行一段存储操作（FIFO；一次异常不会卡死后续操作） */
export function withStoreLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = storeLock.then(() => fn(), () => fn());
  storeLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ============================================================
// 核心工具函数
// ============================================================

export function makeKey(key: string, scope: string, event: StoreEvent): string {
  if (!['user', 'group', 'global'].includes(scope)) {
    throw new Error(`非法 scope: ${scope}`);
  }
  
  if (scope === 'user') {
    const uid = event?.user_id;
    if (!uid) throw new Error('user scope 需要 event.user_id');
    return `user_${uid}:${key}`;
  } else if (scope === 'group') {
    const gid = event?.group_id;
    if (!gid) throw new Error('group scope 需要 event.group_id');
    return `group_${gid}:${key}`;
  }
  return key; // global
}

export function extractStoredValue(valueStr: string): { value: unknown; expired: boolean } {
  try {
    const data = JSON.parse(valueStr);
    if (typeof data !== 'object' || data === null || !('expire_at' in data)) {
      // 旧格式，直接返回
      return { value: data, expired: false };
    }
    
    const expireAt = data.expire_at;
    if (expireAt !== null && Date.now() / 1000 > expireAt) {
      return { value: null, expired: true };
    }
    return { value: data.value, expired: false };
  } catch {
    return { value: valueStr, expired: false };
  }
}

// ============================================================
// 核心 CRUD 操作（load / save / delete 等）
// ============================================================

let dbInstance: SqliteDatabase | null = null;

function getDbInstance(): SqliteDatabase {
  if (!dbInstance) {
    dbInstance = getDb();
  }
  return dbInstance;
}

export function getDbSync(): SqliteDatabase {
  return getDbInstance();
}

/** 读取持久化值 */
export function loadValue(key: string, scope: 'user' | 'group' | 'global', event: StoreEvent): unknown {
  try {
    const fullKey = makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
    const db = getDbSync();
    
    const stmt = db.prepare('SELECT value FROM _persistent WHERE key = ?');
    const row = stmt.get(fullKey);
    
    if (!row) return null;
    
    const { value, expired } = extractStoredValue(row.value);
    if (expired) {
      // 已过期，删除
      const delStmt = db.prepare('DELETE FROM _persistent WHERE key = ?');
      delStmt.run(fullKey);
      return null;
    }
    return value;
  } catch (e) {
    console.warn(`[persistentStore] loadValue 失败: ${e}`);
    return null;
  }
}

/** 保存持久化值 */
export function saveValue(key: string, value: unknown, scope: 'user' | 'group' | 'global', event: StoreEvent, ttl: number = 0): boolean {
  try {
    const fullKey = makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
    
    let valueStr: string;
    
    try {
      valueStr = JSON.stringify({ value, expire_at: ttl > 0 ? Date.now() / 1000 + ttl : null });
    } catch {
      // 降级存储
      valueStr = JSON.stringify({ value: String(value), expire_at: ttl > 0 ? Date.now() / 1000 + ttl : null });
    }
    
    const qq = scope === 'user' ? (event?.user_id ? String(event.user_id) : null) : null;
    const db = getDbSync();
    
    const stmt = db.prepare(`
      INSERT INTO _persistent (key, value, scope, qq, updated_at)
      VALUES (?, ?, ?, ?, datetime('now', '+8 hours'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        scope = excluded.scope,
        qq = excluded.qq,
        updated_at = datetime('now', '+8 hours')
    `);
    
    db.transaction(() => {
      stmt.run(fullKey, valueStr, scope, qq);
    })();
    
    return true;
  } catch (e) {
    console.warn(`[persistentStore] saveValue 失败: ${e}`);
    return false;
  }
}

export function deleteValue(key: string, scope: 'user' | 'group' | 'global', event: StoreEvent): boolean {
  try {
    const fullKey = makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
    const db = getDbSync();
    const stmt = db.prepare('DELETE FROM _persistent WHERE key = ?');
    const result = stmt.run(fullKey);
    return result.changes > 0;
  } catch (e) {
    console.warn(`[persistentStore] deleteValue 失败: ${e}`);
    return false;
  }
}

// 批量保存（事务）
export function batchSaveValues(
  dataDict: Record<string, unknown>,
  scope: 'user' | 'group' | 'global',
  event: StoreEvent,
  ttl: number = 0
): { saved: number; keysList: string[]; errors: string[] } {
  const db = getDbSync();
  
  let saved = 0;
  const keysList: string[] = [];
  const errors: string[] = [];
  
  const dbInstance = getDbSync();
    const tx = dbInstance.transaction((dict: Record<string, unknown>) => {
      const stmt = db.prepare(`
      INSERT INTO _persistent (key, value, scope, qq, updated_at)
      VALUES (?, ?, ?, ?, datetime('now', '+8 hours'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        scope = excluded.scope,
        qq = excluded.qq,
        updated_at = datetime('now', '+8 hours')
    `);
    
    for (const [k, v] of Object.entries(dict)) {
      try {
        const fullKey = makeKey(k, scope, { user_id: event?.user_id, group_id: event?.group_id });
        let valueStr: string;
        try {
          valueStr = JSON.stringify({ value: v, expire_at: ttl > 0 ? Date.now() / 1000 + ttl : null });
        } catch {
          valueStr = JSON.stringify({ value: String(v), expire_at: ttl > 0 ? Date.now() / 1000 + ttl : null });
        }
        
        const qq = scope === 'user' ? (event?.user_id ? String(event.user_id) : null) : null;
        stmt.run(fullKey, valueStr, scope, qq);
        saved++;
        keysList.push(k);
      } catch (e) {
        errors.push(`${k}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });
  
  try {
    tx(dataDict);
  } catch (e) {
    errors.push(`__transaction__: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  return { saved, keysList: Object.keys(dataDict), errors: errors.filter(e => e !== undefined) };
}

/**
 * 原子自增。
 *
 * 修复（2026-09-19，四处缺陷挤在一个函数里）：
 * 1. **`defaultVal` 从来没被读过** —— 目录承诺"缺键时以 default 为初值"，实际是 `0 + amount`，
 *    于是 `default: 100` 拿到 1。**静默错**，用户看不出来。
 * 2. 用临时连接自己拼 INSERT，**并且把 scope 写死成 `'user'`、qq 写死成 `null`** ——
 *    于是 scope=global/group 的数据被标成 user，`query` 节点按 scope/qq 过滤时**永远找不到它们**。
 * 3. 那个临时连接 prepare 出来的 `insertStmt` **从头到尾没被用过**（死代码），又另开一个连接跑。
 * 4. 值不是数字时原来会算出 `NaN` 并**存进去**（`Number()` 不抛错，那个 catch 是死代码）。
 *
 * 现在统一走 `loadValue` / `saveValue`：同一个 db 单例、scope/qq 正确、带事务。
 */
export function incrValue(
  key: string,
  amount: number,
  scope: 'user' | 'group' | 'global',
  defaultVal: number,
  event: StoreEvent
): { result: number; oldValue: number; error: string } {
  try {
    const current = loadValue(key, scope, event);
    const missing = current === null || current === undefined;
    const oldValue = missing ? defaultVal : Number(current);
    if (!Number.isFinite(oldValue)) {
      return {
        result: 0,
        oldValue: 0,
        error: `键「${key}」当前值不是数字（${JSON.stringify(current)}），无法自增`,
      };
    }
    const result = oldValue + amount;
    if (!saveValue(key, result, scope, event)) {
      return { result: 0, oldValue, error: `键「${key}」写入失败` };
    }
    return { result, oldValue, error: '' };
  } catch (e) {
    return { result: 0, oldValue: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================
// D3 · 条件更新：原子地「检查条件 → 变更 → 返回结果」
// ============================================================

export type CompareOp = '>=' | '>' | '<=' | '<' | '==' | '!=';

export interface CompareUpdateOptions {
  /** 比较符（运行时校验：>= > <= < == !=） */
  op: string;
  /** 阈值（"库存 >= 1" 里的 1） */
  threshold: number;
  /** 变更量（"减一" 里的 -1） */
  delta: number;
  /** 键不存在时的当前值（默认 0；想"首次给 10 张卡"就填 10） */
  defaultVal?: number;
}

export interface CompareUpdateResult {
  /** 条件满足且写入成功 */
  ok: boolean;
  oldValue: number;
  newValue: number;
  /** 人类可读的说明（条件不满足时用；这是正常结果，不是错误） */
  reason: string;
  /** 真正的错误（非法比较符 / 值不是数字 / 写入失败）；条件不满足时为空 */
  error: string;
}

/**
 * 多键更新里的一项（`batch_update` 节点 data 端口的 JSON 数组元素）。
 *
 * 形状来自 builtinNodes.ts:2658 的注释：
 * `{key, op, value, expectOp, expect, defaultVal}`；
 * op: 'set'（默认，直接赋 value）/ 'inc' / 'dec'（在事务内基于当前值加减）。
 */
export interface BatchUpdateOp {
  key: string;
  /** 默认 'set' */
  op?: 'set' | 'inc' | 'dec';
  /** set 时是新值；inc/dec 时是增减量 */
  value?: unknown;
  /** 可选前置条件：比较符（>= > <= < == !=） */
  expectOp?: string;
  /** 可选前置条件的阈值 */
  expect?: number;
  /** 键不存在时 inc/dec/条件判定用的当前值（默认 0） */
  defaultVal?: number;
}

/** 一批更新的结果（与产物 batchUpdateValues 返回形状一致） */
export interface BatchUpdateResult {
  /** 全部条件成立且写入成功 */
  ok: boolean;
  /** 成功时是新值；失败时是**当前值**（绝不留半算完的中间值） */
  values: Record<string, unknown>;
  /** 条件不满足的那个键；其它失败为空 */
  failedKey: string;
  /** 人类可读的说明（条件不满足是正常结果，不是错误） */
  reason: string;
  /** 真正的错误（非法 op / 值不是数字 / 写入失败） */
  error: string;
  /** 实际写入的键（条件不满足/出错时为空） */
  writtenKeys: string[];
  /** 写入前各键的旧值 */
  oldValues: Record<string, unknown>;
}

export const COMPARE_OPS: CompareOp[] = ['>=', '>', '<=', '<', '==', '!='];

export function satisfiesCondition(current: number, op: CompareOp, threshold: number): boolean {
  switch (op) {
    case '>=': return current >= threshold;
    case '>': return current > threshold;
    case '<=': return current <= threshold;
    case '<': return current < threshold;
    case '==': return current === threshold;
    case '!=': return current !== threshold;
    default: return false;
  }
}

/**
 * 存储后端接缝（仅供测试注入）。
 *
 * 测试环境里 better-sqlite3 的原生 .node 二进制不可用（与 `tests/main/services/*.test.ts`
 * 的 describe.skip 策略同源），并发用例需要一个不依赖它的后端。**加锁 + 检查 + 写入的逻辑
 * 是同一份**（下面 compareAndUpdate），只有"读一格/写一格"这两个原语被替换 ——
 * 所以并发用例验证的是真实的生产逻辑，替换掉的只是存储原语。
 */
export interface CompareStoreBackend {
  read(fullKey: string): number | null;
  write(fullKey: string, value: number, scope: string, event: StoreEvent): void;
}

let compareBackend: CompareStoreBackend | null = null;

export function setCompareBackendForTesting(backend: CompareStoreBackend | null): void {
  compareBackend = backend;
}

function readNumberFromSqlite(fullKey: string): number | null {
  const db = getDbSync();
  const row = db.prepare('SELECT value FROM _persistent WHERE key = ?').get(fullKey);
  if (!row) return null;
  const { value, expired } = extractStoredValue(row.value);
  if (expired) return null;
  return value as number | null;
}

/**
 * 原子条件更新：**在一个临界区里完成「读 → 判断条件 → 写」**。
 *
 * 为什么需要它：`先查再写` 在并发下会双花 —— 两个玩家同时抽最后一张卡，都读到库存=1、
 * 都扣、库存变 -1。**逻辑写得没错，结果错了**，最容易被误判成"工具坏了"。
 *
 * 保证范围：**同一进程内串行**（QQ 机器人的并发都来自同一进程里并发处理的异步消息，
 * 这正是出问题的场景）。多实例部署需要 SQL 级 CAS（`UPDATE ... WHERE value >= ?`），
 * 属后续工作，已在 docs/basic-nodes.md 标明。
 */
export async function compareAndUpdate(
  key: string,
  scope: 'user' | 'group' | 'global',
  event: StoreEvent,
  options: CompareUpdateOptions,
): Promise<CompareUpdateResult> {
  const bail = (error: string): CompareUpdateResult => ({
    ok: false,
    oldValue: NaN,
    newValue: NaN,
    reason: '',
    error,
  });

  if (!COMPARE_OPS.includes(options.op as CompareOp)) {
    return bail(`非法比较符: ${options.op}（支持 ${COMPARE_OPS.join(' ')}）`);
  }
  const op = options.op as CompareOp;

  return withStoreLock(() => {
    try {
      const fullKey = makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
      const raw = compareBackend ? compareBackend.read(fullKey) : readNumberFromSqlite(fullKey);
      const exists = raw !== null && raw !== undefined;
      const current = Number(exists ? raw : (options.defaultVal ?? 0));

      if (!Number.isFinite(current)) {
        return bail(`变量 ${key} 的当前值不是数字：${JSON.stringify(raw)}`);
      }
      if (!satisfiesCondition(current, op, options.threshold)) {
        return {
          ok: false,
          oldValue: current,
          newValue: current,
          reason: `当前值 ${current} 不满足 ${op} ${options.threshold}（未变更）`,
          error: '',
        };
      }

      const newValue = current + options.delta;
      if (compareBackend) {
        compareBackend.write(fullKey, newValue, scope, event);
      } else if (!saveValue(key, newValue, scope, event, 0)) {
        return bail('写入失败');
      }
      return { ok: true, oldValue: current, newValue, reason: '', error: '' };
    } catch (e) {
      return bail(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * 纯函数：给定各键的当前值，算出这一批变更的结果。
 *
 * 不变量：**要么全部成立，要么一个都不写**。它是纯的，所以"第 3 个键条件不满足时
 * 前两个也不能写"可以直接单测，不需要 sqlite、不需要并发。
 *
 * 两个易错点（实现里挡掉了）：
 * 1. 条件不过 → `values` 必须是**当前值**而不是半算完的新值；
 * 2. 同一批里重复出现同一个键 → 后写的覆盖先写的，条件按**原始**当前值判定（不做链式推进）。
 */
function planBatchUpdate(
  ops: readonly BatchUpdateOp[],
  current: Record<string, unknown>,
): Omit<BatchUpdateResult, 'writtenKeys' | 'oldValues'> {
  const reject = (error: string) => ({
    ok: false,
    values: { ...current },
    failedKey: '',
    reason: '',
    error,
  });
  if (!Array.isArray(ops) || ops.length === 0) return reject('批量更新没有要改的键（ops 为空）');
  const values: Record<string, unknown> = {};
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (!o || typeof o !== 'object') return reject(`第 ${i + 1} 项不是对象`);
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    if (!key) return reject(`第 ${i + 1} 项缺少 key`);
    const mode = o.op ?? 'set';
    if (mode !== 'set' && mode !== 'inc' && mode !== 'dec') {
      return reject(`键 ${key} 的 op 非法: ${o.op}（支持 set / inc / dec）`);
    }
    const rawCur = current[key];
    const numCur = Number(rawCur ?? o.defaultVal ?? 0);
    if (o.expectOp !== undefined && o.expectOp !== '') {
      if (!COMPARE_OPS.includes(o.expectOp as CompareOp)) {
        return reject(`键 ${key} 的比较符非法: ${o.expectOp}（支持 ${COMPARE_OPS.join(' ')}）`);
      }
      if (!Number.isFinite(numCur)) {
        return reject(`键 ${key} 的当前值不是数字：${JSON.stringify(rawCur)}`);
      }
      const threshold = Number(o.expect ?? 0);
      if (!Number.isFinite(threshold)) {
        return reject(`键 ${key} 的 expect 不是数字：${JSON.stringify(o.expect)}`);
      }
      if (!satisfiesCondition(numCur, o.expectOp as CompareOp, threshold)) {
        return {
          ok: false,
          values: { ...current },
          failedKey: key,
          reason: `${key} 当前 ${numCur} 不满足 ${o.expectOp} ${threshold}（整批未变更）`,
          error: '',
        };
      }
    }
    if (mode === 'set') {
      values[key] = o.value;
      continue;
    }
    if (!Number.isFinite(numCur)) {
      return reject(`键 ${key} 的当前值不是数字：${JSON.stringify(rawCur)}`);
    }
    const delta = Number(o.value ?? 0);
    if (!Number.isFinite(delta)) {
      return reject(`键 ${key} 的增减量不是数字：${JSON.stringify(o.value)}`);
    }
    values[key] = mode === 'inc' ? numCur + delta : numCur - delta;
  }
  return { ok: true, values, failedKey: '', reason: '', error: '' };
}

/**
 * 多键原子更新：**在一个临界区 + 一次事务里完成「读全部 → 判全部 → 写全部」**。
 *
 * 为什么需要它：玩法里的"扣 3 种材料 + 加 1 件成品"用 batch_load → 表达式 → batch_save
 * 拼时，"读"和"写"之间是敞开的 —— 两条并发消息可以都读到"材料 3"、都判定通过、
 * 各写一遍，于是材料只扣一次而成果出两件。compare_update 只覆盖单键，多键没有对应物。
 *
 * 保证范围与 compareAndUpdate 一致：**同一进程内串行**。
 */
export async function batchUpdateValues(
  ops: readonly BatchUpdateOp[],
  scope: 'user' | 'group' | 'global',
  event: StoreEvent,
  ttl: number = 0,
): Promise<BatchUpdateResult> {
  return withStoreLock(() => {
    const oldValues: Record<string, unknown> = {};
    try {
      const current: Record<string, unknown> = {};
      for (const o of Array.isArray(ops) ? ops : []) {
        const key = typeof o?.key === 'string' ? o.key.trim() : '';
        if (!key || key in current) continue;
        current[key] = loadValue(key, scope, event);
      }
      for (const k of Object.keys(current)) oldValues[k] = current[k];
      const plan = planBatchUpdate(ops, current);
      if (!plan.ok) return { ...plan, writtenKeys: [], oldValues };
      const res = batchSaveValues(plan.values, scope, event, ttl);
      if (res.errors.length > 0) {
        return {
          ok: false,
          values: current,
          failedKey: '',
          reason: '',
          error: res.errors.join('; '),
          writtenKeys: [],
          oldValues,
        };
      }
      return { ...plan, writtenKeys: Object.keys(plan.values), oldValues };
    } catch (e) {
      return {
        ok: false,
        values: {},
        failedKey: '',
        reason: '',
        error: e instanceof Error ? e.message : String(e),
        writtenKeys: [],
        oldValues,
      };
    }
  });
}

// 列表追加（原子）
export function listAppendValue(
  key: string,
  item: unknown,
  scope: 'user' | 'group' | 'global',
  maxLength: number,
  event: StoreEvent
): { result: unknown[]; length: number; new: boolean; error: string } {
  // 历史实现是空壳：直接 return { result: [item], length: 1 }，**根本没读写数据库** ——
  // variable_persist 的 list_append 模式因此永远只返回一个单元素列表，背包/名单类流程全废。
  try {
    const current = loadValue(key, scope, event);
    let list: unknown[] = [];
    if (Array.isArray(current)) {
      list = [...current];
    } else if (typeof current === 'string' && current.trim()) {
      try {
        const parsed = JSON.parse(current);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        // 不是 JSON 数组，按空列表起手
      }
    }
    list.push(item);
    if (maxLength > 0 && list.length > maxLength) {
      list = list.slice(list.length - maxLength);
    }
    const saved = saveValue(key, list, scope, event, 0);
    return { result: list, length: list.length, new: saved, error: saved ? '' : '写入失败' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { result: [], length: 0, new: false, error: err.message };
  }
}

// ============================================================
// 导出供 variable_persist / query 使用
// ============================================================

export const persistentStore = {
  loadValue,
  saveValue,
  deleteValue,
  batchSaveValues,
  batchUpdateValues,
  incrValue,
  listAppendValue,
  compareAndUpdate,
  satisfiesCondition,
  setCompareBackendForTesting,
  getDbPath,
  getDbSync,
};

export type {
  Scope,
  PersistentValue,
  LoadResult,
  SaveOptions,
  IncrOptions,
  ListAppendOptions,
  BatchSaveOptions,
  ListAppendResult,
  IncrResult,
  BatchSaveResult,
  PersistResult,
  LoopControlResult,
};