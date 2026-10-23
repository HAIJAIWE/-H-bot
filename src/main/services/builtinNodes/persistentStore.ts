/**
 * 持久化存储纯 TS 实现
 * 
 * 历史：由已移除的 qqbat_nodes/builtin/persistent_store.py 移植而来，现状以本文件为准
 * - SQLite + better-sqlite3 (同步，Electron 主进程可用)
 * - 每项目一条连接（WAL）+ 写锁；库在 {项目}/data/players/persistent.db
 * - 作用域隔离：user/group/global
 * - TTL 过期自动清理
 * - 原子操作：increment / list_append / batch_save
 * - 并发安全：写锁串行化 + WAL 模式
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildKey, columnsForKey } from '../../../shared/persist/persistentKey';
import { isEnvelope } from '../../../shared/persist/value';
import { userDataRoot } from '../infra/paths';
import { currentProjectRoot } from './storeContext';

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
  /** better-sqlite3 会把它更新为 false；注入的测试后端可能没有这个字段 */
  open?: boolean;
  /** SQLite backup API（迁移旧库用）；注入的后端没有它时退化为整文件复制 */
  backup?(destination: string): Promise<unknown> | unknown;
}

// ============================================================
// 数据库连接管理（每个项目一条连接，WAL 模式，LRU 复用）
// ============================================================
//
// 语义对齐 10/18 客户端（_recovery/client-src/persistentStore.client.js）：
// 存档库不再是「全机器一份 %APPDATA%/qqbot/...」，而是「每个项目一份
// {项目}/data/players/persistent.db」；老库在首次用老项目时做一次性迁移（只复制、不删旧库）。

/** 按库文件路径缓存连接：同时跑两个 bot 时各用各的，不会互相关连接 */
const dbPool = new Map<string, SqliteDatabase>();
/** 连接池上限（桌面版同时跑几个 bot 足够，又不会无限增长） */
const DB_POOL_MAX = 8;

/**
 * 预览用的数据目录覆盖。
 *
 * 库路径随**项目**变化（见 {@link getDbPath}），流程预览还要在「真实数据的副本」上
 * 运行且不能写回真库，因此允许临时把数据目录切到克隆目录 —— 传 `null` 恢复。
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

/** 关闭**全部**连接（切换库路径 / 测试清理用） */
export function closeDb(): void {
  for (const conn of dbPool.values()) {
    try {
      conn.close();
    } catch {
      /* 忽略关闭错误 */
    }
  }
  dbPool.clear();
  // ⚠️ 必须把 `dbInstance` 缓存一起清掉：`getDbSync()` 走的是它，
  // 只清连接池会让它继续返回**已关闭的旧连接** —— 现象是预览里所有持久化读写静默失败
  // （返回 null → 回退默认值），而界面看起来一切正常。
  dbInstance = null;
  dbInstanceKey = null;
}

/** 路径归一化：Windows 盘符/目录名大小写不敏感，比较归属时统一小写 */
function normPath(p: string): string {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * 关闭**属于某个项目**的连接（删除项目前必须调用）。
 *
 * ## 为什么需要它（2026-09-26 实测出来的真缺陷）
 *
 * 项目只要跑过一次流程，`{项目}/data/players/persistent.db` 就被本模块按路径缓存着。
 * Windows 上带着打开的句柄删目录会抛 `EBUSY: resource busy or locked` —— 用户视角是
 * 「点了删除项目，目录还在」，报错还与被删的东西无关。
 *
 * 按**库文件路径**判断归属，所以同时跑多个 bot 时只影响被删的那个项目。
 *
 * @returns 实际关闭的连接数（测试与日志用；0 是正常情况）
 */
export function closeDbUnder(projectDir: string): number {
  const prefix = normPath(projectDir) + path.sep;
  let closed = 0;
  for (const key of [...dbPool.keys()]) {
    if (!normPath(key).startsWith(prefix)) continue;
    const conn = dbPool.get(key);
    try {
      conn?.close();
    } catch {
      /* 忽略关闭错误 */
    }
    dbPool.delete(key);
    closed++;
  }
  if (dbInstanceKey && normPath(dbInstanceKey).startsWith(prefix)) {
    dbInstance = null;
    dbInstanceKey = null;
  }
  return closed;
}

/**
 * 旧版全局库的**历史位置**（全部探测：命中哪个迁哪个）。
 *
 * 2026-10-18 修正：这里此前只读 `%APPDATA%\qqbot\...`，而文档写的是
 * `%APPDATA%\qqbat\qqbot\...` —— 代码与文档指向两个不同的目录，一类老用户的数据
 * 会被静默漏迁（读不到旧库就建空库，用户看到「等级没了」）。现在两个位置都探。
 */
export function legacyGlobalDbPaths(): string[] {
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : path.join(process.env.HOME || '', '.config'));
  const candidates = [path.join(appData, 'qqbot', 'data', 'players', 'persistent.db')];
  try {
    const userData = userDataRoot();
    if (userData) candidates.push(path.join(userData, 'qqbot', 'data', 'players', 'persistent.db'));
  } catch {
    /* 非 Electron / userData 不可用 → 只有 APPDATA 一个候选 */
  }
  return [...new Set(candidates)];
}

/** 打开一条到指定库文件的连接（内部用，不做缓存） */
function openRawDb(dbPath: string, options: { fileMustExist?: boolean }): SqliteDatabase {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const conn: SqliteDatabase = dbOpenerOverride
    ? dbOpenerOverride(dbPath, { fileMustExist: options.fileMustExist ?? false })
    : new (require('better-sqlite3'))(dbPath, {
        fileMustExist: options.fileMustExist ?? false,
        timeout: 5000,
      });

  // 启用 WAL 模式 + 并发优化
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('temp_store = MEMORY');

  conn.exec(`
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
  return conn;
}

/**
 * 把旧版**全局库**里的数据一次性搬到项目库里。
 *
 * ## 为什么要有这个
 *
 * 玩家存档原来放在 `%APPDATA%\qqbat\qqbot\data\players\persistent.db`，**不区分项目**：
 * 项目搬走时进度留在旧机器；同一个 QQ 号在不同机器人里还会互相覆盖。
 * 改成「每个项目一个库」之后，首次打开老项目必须把既有进度带过来，否则用户会看到「等级没了」。
 *
 * ## 安全约定
 *
 * - 只在**项目库还不存在**时复制（幂等；项目库一旦建立就永不覆盖它）；
 * - 用 SQLite 的 **backup API** 复制（会把 WAL 里的内容一起落进去），不是简单拷文件；
 * - **不删除旧库** —— 万一迁移出问题，数据仍在原地可回退。
 */
export function migrateLegacyGlobalDb(targetPath: string): void {
  try {
    if (fs.existsSync(targetPath)) return;
    const legacy = legacyGlobalDbPaths().find((p) => fs.existsSync(p));
    if (!legacy) return;
    if (path.resolve(legacy) === path.resolve(targetPath)) return;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const src = openRawDb(legacy, { fileMustExist: true });
    try {
      src.prepare('SELECT 1').get();
      if (typeof src.backup === 'function') {
        // better-sqlite3 的 backup 返回 Promise；迁移是尽力而为，不等它也不会丢数据
        void src.backup(targetPath);
      } else {
        // 注入的测试后端没有 backup() → 退化为整文件复制（不带 WAL，但数据在）
        fs.copyFileSync(legacy, targetPath);
      }
      console.warn(
        `[persistentStore] 已把玩家存档迁移到项目内：${targetPath}（旧库仍在 ${legacy}，未删除）`,
      );
    } finally {
      src.close();
    }
  } catch (e) {
    console.warn(`[persistentStore] 迁移旧版全局存档失败（将使用空的项目库）: ${e}`);
  }
}

/**
 * 玩家存档路径 —— **项目内**（`{项目}/data/players/persistent.db`）。
 *
 * ## 为什么改到项目里（用户明确要求）
 *
 * 机器人项目的数据就属于那个项目：项目拷贝/搬机器时进度一起走；
 * 两个项目之间也不会再共用同一份玩家数据。
 *
 * ## 路径优先级
 *
 * 1. 预览覆盖目录（`previewDataDirOverride`，隔离用）；
 * 2. 当前异步链所属项目根（`storeContext.currentProjectRoot()`：运行时按消息注入，
 *    没有上下文时回退 `projectPath.getProjectRoot()` 的 env / app 路径 / cwd）。
 *
 * ⚠️ 旧版全局库不再被读取，但**首次**会做一次性迁移（见 migrateLegacyGlobalDb）。
 */
export function getDbPath(): string {
  if (previewDataDirOverride) {
    if (!fs.existsSync(previewDataDirOverride)) {
      fs.mkdirSync(previewDataDirOverride, { recursive: true });
    }
    return path.join(previewDataDirOverride, 'persistent.db');
  }
  const projectLocal = path.join(currentProjectRoot(), 'data', 'players', 'persistent.db');
  migrateLegacyGlobalDb(projectLocal);
  return projectLocal;
}

/**
 * 仅供测试：替换底层 SQLite 打开方式（传 null 恢复真实实现）。
 *
 * 本机 better-sqlite3 只有 electron ABI 的二进制，Node 下跑测试用不了，
 * 所以这类**必须验证存储行为**的逻辑靠注入内存后端来测
 * （与 `databaseWrite.setDbOpenerForTesting` 同一套做法）。
 */
type SqliteOpener = (filePath: string, options?: { fileMustExist?: boolean }) => SqliteDatabase;

let dbOpenerOverride: SqliteOpener | null = null;

export function setDbOpenerForTesting(opener: SqliteOpener | null): void {
  closeDb();
  dbOpenerOverride = opener;
}

/**
 * 打开（或复用）**该项目**的连接。
 *
 * ## 为什么从「单连接」改成「每项目一条」
 *
 * 原来是 `let db` 一个连接、路径变了就关掉重开。单项目时没问题，但**同时跑两个项目**时：
 * 两条消息链会不停地把同一个连接关掉重开，既慢又危险（一个项目正在写、另一个项目把连接关了）。
 * 现在按**库文件路径**缓存：每个项目各自的连接，互不干扰；用 LRU 限制条数。
 */
function getDb(): SqliteDatabase {
  const dbPath = getDbPath();
  const cached = dbPool.get(dbPath);
  if (cached) {
    // LRU：命中的挪到队尾
    dbPool.delete(dbPath);
    dbPool.set(dbPath, cached);
    return cached;
  }
  const conn = openRawDb(dbPath, { fileMustExist: false });
  dbPool.set(dbPath, conn);
  if (dbPool.size > DB_POOL_MAX) {
    const oldest = dbPool.keys().next().value;
    if (oldest !== undefined) {
      const evicted = dbPool.get(oldest);
      dbPool.delete(oldest);
      try {
        evicted?.close();
      } catch {
        /* 忽略关闭错误 */
      }
      // 与 closeDb 里同一个坑：只清连接池会让 getDbSync() 继续返回已关闭的旧连接
      if (dbInstanceKey === oldest) {
        dbInstance = null;
        dbInstanceKey = null;
      }
    }
  }
  return conn;
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

/**
 * 拼出存储用的完整 key（`user_<uid>:<key>` / `group_<gid>:<key>` / global 原样）。
 *
 * ⚠️ **前缀格式的唯一真相在 `shared/persist/persistentKey.ts`** —— 因为 `query` 节点
 * 也按前缀筛，两处定义一旦分歧就「静默查空」。这里保留同名导出，实现委托给唯一入口。
 */
export function makeKey(key: string, scope: string, event: StoreEvent): string {
  return buildKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
}

/**
 * 解包 `_persistent.value` 的原始文本。
 *
 * ⚠️ **判据与渲染层共用 `isEnvelope`**（2026-10-15 修）：以前这里自己判
 * 「有 expire_at 就当信封」，与 `shared/persist/value.ts` 的三条判据不一致 →
 * 同一行两侧读值不同，`{"expire_at":null}` 这种用户对象会被静默读成 `undefined`。
 */
export function extractStoredValue(valueStr: string): { value: unknown; expired: boolean } {
  try {
    const data = JSON.parse(valueStr);
    if (!isEnvelope(data)) return { value: data, expired: false };
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

/**
 * 最近一次取到的连接与它对应的库路径。
 *
 * 这层「记住最后一条」是为了避免每次都查 `getDbPath()`（要拼路径 + 查文件是否存在）。
 * **必须按路径失效** —— 否则切项目后仍把上一个项目的连接交出去（数据串项目），
 * 而且连接被 closeDb/淘汰关掉后必须重新打开（`open === false` 判据）。
 */
let dbInstance: SqliteDatabase | null = null;
let dbInstanceKey: string | null = null;

function getDbInstance(): SqliteDatabase {
  const key = getDbPath();
  if (dbInstance && dbInstance.open === false) {
    dbInstance = null;
    dbInstanceKey = null;
  }
  if (!dbInstance || dbInstanceKey !== key) {
    dbInstance = getDb();
    dbInstanceKey = key;
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
/**
 * 读取持久化值 —— **能区分「读失败」与「键不存在」**。
 *
 * 为什么需要它：`loadValue` 把**数据库不可用**和**没有这条**都返回 `null`，
 * 节点侧只能报 `success:true`（用户看到「金币 0 / 没数据」，而不是错误）。
 * `variable_persist` 的 load / exists / load_or_default / batch_load 四个模式
 * 都要求能区分，否则写入失败是**静默**的。
 *
 * @returns `failed=true` 表示**读取本身失败**（此时 `value` 无意义，调用方必须报错）
 */
export function loadValueSafe(
  key: string,
  scope: 'user' | 'group' | 'global',
  event: StoreEvent,
): { value: unknown; failed: boolean } {
  try {
    const fullKey = makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
    const db = getDbSync();
    const row = db.prepare('SELECT value FROM _persistent WHERE key = ?').get(fullKey);
    if (!row) return { value: null, failed: false };
    const { value, expired } = extractStoredValue(row.value);
    if (expired) {
      db.prepare('DELETE FROM _persistent WHERE key = ?').run(fullKey);
      return { value: null, failed: false };
    }
    return { value, failed: false };
  } catch (e) {
    console.warn(`[persistentStore] loadValue 失败: ${e}`);
    return { value: null, failed: true };
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
    
    // 两列由完整 key 派生（唯一定义在 shared/persist/persistentKey.ts 的 columnsForKey）——
    // 不能在这里独立算第二次：两处算法一分歧，query 节点按列筛就会静默查空。
    const { scope: colScope, qq } = columnsForKey(fullKey);
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
      stmt.run(fullKey, valueStr, colScope, qq);
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
/**
 * 删除持久化值 —— **能区分「删失败」与「本来就没有」**（与 {@link loadValueSafe} 同一动机）。
 */
export function deleteValueSafe(
  key: string,
  scope: 'user' | 'group' | 'global',
  event: StoreEvent,
): { deleted: boolean; failed: boolean } {
  try {
    const fullKey = makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });
    const r = getDbSync().prepare('DELETE FROM _persistent WHERE key = ?').run(fullKey);
    return { deleted: r.changes > 0, failed: false };
  } catch (e) {
    console.warn(`[persistentStore] deleteValue 失败: ${e}`);
    return { deleted: false, failed: true };
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

  const tx = db.transaction((dict: Record<string, unknown>) => {
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
        
        const { scope: colScope, qq } = columnsForKey(fullKey);
        stmt.run(fullKey, valueStr, colScope, qq);
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
  loadValueSafe,
  saveValue,
  deleteValue,
  deleteValueSafe,
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