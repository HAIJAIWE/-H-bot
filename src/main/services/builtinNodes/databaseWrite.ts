/**
 * 数据库操作纯 TS 实现
 * 历史：由已移除的 qqbat_nodes/builtin/database_write.py 移植而来，现状以本文件为准
 */

import * as path from 'path';
import { resolveInProject } from './projectPath';
import { DEFAULT_DB_PATH } from '../../../shared/nodes/builtinCatalog';

// ============================================================
// 类型定义
// ============================================================

interface DBResult {
  success: boolean;
  error: string;
  // insert mode
  lastrowid?: number;
  // update mode
  rows_updated?: number;
  // delete mode
  rows_deleted?: number;
  // select mode
  rows?: Record<string, unknown>[];
  rows_count?: number;
  value?: unknown;
  found?: boolean;
}

interface DBOptions {
  mode: 'insert' | 'update' | 'delete' | 'select';
  table: string;
  data?: Record<string, unknown> | null;
  condition?: string;
  db_path?: string;
  where_params?: unknown[] | null;
  result_field?: string;
  limit?: number;
  /**
   * select 的排序子句（不含 `ORDER BY`）。
   *
   * 为什么需要：`SELECT * FROM t LIMIT 1` 永远返回**第一行**，所以"从怪物表里随机遇一只"
   * 这类需求以前做不到 —— 配置表读到的永远是同一行。加 `order` 后写 `RANDOM()` 即可随机取一行，
   * 写 `level DESC` 即可取等级最高的那行。
   */
  order?: string;
  /** 当前项目目录（由运行时按 `HandlerContext.projectPath` 注入），相对 db_path 相对它解析 */
  project_root?: string;
}

// ============================================================
// 独立工具函数 - 每个函数唯一
// ============================================================

/**
 * 解析数据库文件路径为项目内绝对路径。
 *
 * 修复 1：原实现自己拼了一遍（`path.join(process.cwd(), dbPath)`），与默认
 * `db_path` 组合后数据库会落到**进程 cwd**（开发时是仓库根目录，打包后是安装目录）
 * 而不是项目目录；同时路径穿越校验（`resolved.startsWith`）可被 `D:\proj-evil`
 * 这类前缀骗过。
 *
 * 修复 2：默认库名从 `'data.db'` 改为 `DEFAULT_DB_PATH`
 * （`data/players/players.db`）—— 原默认库不在「数据管理」面板扫描的目录里，
 * 于是"插入成功"却哪里都看不到（详见目录里该常量的注释）。
 */
function resolveDbPath(dbPath: string, root?: string): string {
  try {
    return resolveInProject(dbPath, { injectedRoot: root, label: '数据库路径' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('路径穿越')) {
      throw new Error('数据库路径不在项目根目录内');
    }
    throw e;
  }
}

function normalizeWhereParams(whereParams: unknown): unknown[] {
  if (whereParams === null || whereParams === undefined) return [];
  if (Array.isArray(whereParams)) return [...whereParams];
  return [whereParams];
}

function validateCondition(condition: string, whereParams: unknown[]): string | null {
  if (!condition || !condition.trim()) return null;
  
  if (condition.includes("'") || condition.includes('"')) {
    return "condition 包含引号（应使用 ? 占位符 + where_params 绑定值）";
  }
  
  if (condition.includes(';') || condition.includes('--') || condition.includes('/*') || condition.includes('*/')) {
    return "condition 包含非法字符";
  }
  
  if (/\bUNION\b/i.test(condition)) {
    return "condition 包含 UNION 关键字";
  }
  
  // 注意：这里是 `\?`（数问号占位符）。原实现写成 `/\\?/g`——正则字面量里 `\\?`
  // 表示"可选的反斜杠"，会匹配每个位置的空串，于是占位符数量恒等于字符串长度，
  // 带 where_params 的 update/delete 几乎必然报"数量不匹配"。
  const placeholderCount = (condition.match(/\?/g) || []).length;
  if (placeholderCount !== whereParams.length) {
    return `where_params 数量(${whereParams.length})与 condition 占位符(${placeholderCount})不匹配`;
  }
  
  return null;
}

// 说明：这里原有 `getConnection` / `dbPool` / `closeAllConnections` 与三个
// `process.on(...)` 钩子，但**没有任何调用方**——每个操作自己 `new better-sqlite3(...)`
// 开一次连接，池永远为空。已删除，避免"看起来有连接管理"这种误导。
// 另外 `process.on('SIGINT'|'SIGTERM', ... process.exit(0))` 在主进程里注册会在
// 退出时抢走控制权，属于隐性地雷。

/**
 * 打开一个 SQLite 连接。
 *
 * 抽成一个函数是**测试接缝**：`better-sqlite3` 是原生模块，只能为一个 ABI 编译
 * （本仓库给 Electron 用），Node 测试进程加载不了它，于是所有依赖它的用例会整组
 * 静默跳过（见 `tests/helpers/sqliteShim.ts` 的说明）。测试可以注入一个基于
 * Node 内置 `node:sqlite` 的等价实现，让**本文件下面这段真实逻辑**（SQL 拼接、
 * 参数绑定、结果整形）真的跑起来。
 *
 * 与 `persistentStore.ts` 的 `setCompareBackendForTesting` 同一个思路：
 * 只替换"最底层的一个原语"，被测的业务逻辑一行不改。
 *
 * ⚠️ 生产路径**永远**是 `better-sqlite3`：只有显式调用 setter 才会替换。
 */
interface SqliteStatement {
  run(...params: unknown[]): { lastInsertRowid?: number; changes?: number };
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

/** 本模块用到的 SQLite 连接最小接口（生产是 better-sqlite3，测试注入 node:sqlite 等价实现） */
interface SqliteDatabase {
  pragma(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteOpener = (filePath: string, options?: { fileMustExist?: boolean }) => unknown;

let dbOpenerOverride: SqliteOpener | null = null;

function openDb(filePath: string, options?: { fileMustExist?: boolean }): unknown {
  if (dbOpenerOverride) return dbOpenerOverride(filePath, options);
  return new (require('better-sqlite3'))(filePath, options);
}

/** 仅供测试：替换底层 SQLite 打开方式（传 null 恢复真实实现） */
export function setDbOpenerForTesting(opener: SqliteOpener | null): void {
  dbOpenerOverride = opener;
}

// ============================================================
// 核心操作函数 - 每个函数唯一
// ============================================================

function makeError(msg: string): DBResult {
  return {
    success: false,
    error: msg,
    lastrowid: -1,
    rows_updated: 0,
    rows_deleted: 0,
    rows: [],
    rows_count: 0,
    value: null,
    found: false,
  };
}

async function doInsert(table: string, data: Record<string, unknown> | null | undefined, dbPath: string): Promise<DBResult> {
  if (!table) return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'table 不能为空' };
  if (!data) return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'data 不能为空' };
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: '非法表名: ' + table };
  }
  for (const col of Object.keys(data || {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
      return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: '非法列名: ' + col };
    }
  }

  let db: SqliteDatabase | null = null;
  try {
    const cols = Object.keys(data || {});
    const placeholders = cols.map(() => '?').join(', ');
    const colNames = cols.join(', ');
    const values = cols.map(c => (data || {})[c]);
    const sql = 'INSERT INTO ' + table + ' (' + colNames + ') VALUES (' + placeholders + ')';

    db = openDb(path.resolve(dbPath), { fileMustExist: false }) as SqliteDatabase;
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    
    const stmt = db.prepare(sql);
    const result = stmt.run(...values);
    const lastrowid = result.lastInsertRowid ?? -1;
    
    return { 
      success: true, 
      lastrowid, 
      rows_updated: 0, 
      rows_deleted: 0, 
      error: '' 
    };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'SQL 错误: ' + err.message };
  } finally {
    // 每次操作自己开一次连接，就必须自己关掉：
    // 不关的话 WAL 的 `-shm`/`-wal` 文件句柄一直挂着 —— Windows 上删/移动这个库
    // （备份、迁移、测试清理）会直接 EBUSY，而且每个节点执行都泄漏一个句柄。
    try { db?.close(); } catch { /* 关闭失败不影响本次结果 */ }
  }
}

async function doUpdate(table: string, data: Record<string, unknown> | null | undefined, condition: string, dbPath: string, whereParams: unknown[] | null | undefined): Promise<DBResult> {
  if (!condition?.trim()) {
    return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'condition 不能为空，禁止全表更新' };
  }
  
  // 修复：原实现写成 `Array.isArray(data) ? data : [data]` —— 把 SET 的列值
  // 当成了 WHERE 的绑定值。后果有两层：占位符数量按"要改几列"校验（`SET a=?,b=?`
  // 配 `WHERE id=?` 被误判为不匹配），以及 `stmt.run(...values, data对象)` 绑定
  // 了一个对象 → SQLite 直接报错。与 doDelete/doSelect 保持一致用 whereParams。
  const paramsList = normalizeWhereParams(whereParams);
  const errMsg = validateCondition(condition, paramsList);
  if (errMsg) return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: errMsg };
  
  if (!table) return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'table 不能为空' };
  if (!data) return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'data 不能为空' };
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return { success: false, error: '非法表名: ' + table };
  }
  for (const col of Object.keys(data || {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
      return { success: false, error: '非法列名: ' + col };
    }
  }

  let db: SqliteDatabase | null = null;
  try {
    const setClause = Object.keys(data || {}).map(k => k + ' = ?').join(', ');
    const values = Object.values(data || {});
    const params = [...values, ...paramsList];
    const sql = 'UPDATE ' + table + ' SET ' + setClause + ' WHERE ' + condition;
    
    db = openDb(path.resolve(dbPath)) as SqliteDatabase;
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    const rowsUpdated = result.changes ?? 0;
    
    return { 
      success: true, 
      lastrowid: -1, 
      rows_updated: rowsUpdated, 
      rows_deleted: 0, 
      error: '' 
    };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'SQL 错误: ' + err.message };
  } finally {
    try { db?.close(); } catch { /* 关闭失败不影响本次结果 */ }
  }
}

async function doDelete(table: string, condition: string, dbPath: string, whereParams: unknown[] | null | undefined): Promise<DBResult> {
  if (!condition?.trim()) {
    return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'condition 不能为空，禁止全表删除' };
  }
  
  const paramsList = Array.isArray(whereParams) ? whereParams : (whereParams ? [whereParams] : []);
  const errMsg = validateCondition(condition, paramsList);
  if (errMsg) return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: errMsg };
  
  if (!table) return { success: false, error: 'table 不能为空' };
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return { success: false, error: '非法表名: ' + table };
  }

  let db: SqliteDatabase | null = null;
  try {
    const sql = 'DELETE FROM ' + table + ' WHERE ' + condition;
    const params = paramsList;
    
    db = openDb(path.resolve(dbPath)) as SqliteDatabase;
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    const rowsDeleted = result.changes ?? 0;
    
    return { 
      success: true, 
      lastrowid: -1, 
      rows_updated: 0, 
      rows_deleted: rowsDeleted, 
      error: '' 
    };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, lastrowid: -1, rows_updated: 0, rows_deleted: 0, error: 'SQL 错误: ' + err.message };
  } finally {
    try { db?.close(); } catch { /* 关闭失败不影响本次结果 */ }
  }
}

/**
 * 校验 ORDER BY 子句（`order` 会被拼进 SQL，必须挡住注入）。
 *
 * 只放行三种片段，逗号分隔：
 *   · `RANDOM()`                       —— 随机取一行（本参数存在的理由）
 *   · `列名` / `列名 ASC` / `列名 DESC`
 * 引号、括号、分号、子查询等一律拒绝（与 `validateCondition` 同一套思路：宁可拒绝，
 * 不做"聪明"的清洗）。
 */
function validateOrder(order: string): string {
  const trimmed = order.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(',').map((p) => p.trim());
  for (const part of parts) {
    if (/^RANDOM\(\)$/i.test(part)) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?$/i.test(part)) continue;
    return `非法 order 片段: ${part}（只允许 RANDOM() 或「列名 [ASC|DESC]」，逗号分隔）`;
  }
  return '';
}

async function doSelect(table: string, condition: string, dbPath: string, whereParams: unknown[] | null | undefined, resultField: string, limit: number, order: string = ''): Promise<DBResult> {
  if (!table) return { success: false, error: 'table 不能为空' };
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return { success: false, error: '非法表名: ' + table };
  }

  // ⚠️ `condition` 不一定是字符串：端口值为空时 `resolveInputKwargs` 会走 autoResolve 兜底，
  // 把**上游节点的输出**塞进来（布尔/对象都见过）——于是 `condition.trim()` 直接抛
  // "condition.trim is not a function"，select 只要接在别的节点后面就崩。
  // 非字符串一律当"没有条件"（select 全表取，update/delete 另有空条件保护）。
  const cond = typeof condition === 'string' ? condition : '';

  // 同 condition：`where_params` 端口没配时也会被 autoResolve 兜底成上游输出，
  // 而 SQLite 只能绑定 number/string/bigint/Buffer/null —— 非绑定值会让 prepare/all 抛
  // "SQLite3 can only bind numbers, strings, bigints, buffers, and null"。这里过滤掉。
  const rawList = Array.isArray(whereParams) ? whereParams : whereParams ? [whereParams] : [];
  const paramsList = rawList.filter(
    (v) => v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || Buffer.isBuffer(v),
  );
  const errMsg = validateCondition(cond, paramsList);
  if (errMsg) return { success: false, error: errMsg };

  if (resultField && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(resultField)) {
    return { success: false, error: '非法 result_field: ' + resultField };
  }

  // order 同 condition：端口没配时可能被 autoResolve 兜底成非字符串，一律当"不排序"
  const orderClause = typeof order === 'string' ? order : '';
  const orderErr = validateOrder(orderClause);
  if (orderErr) return { success: false, error: orderErr };

  try {
    limit = parseInt(String(limit), 10);
    // ⚠️ 端口没配时 limit 是 undefined → parseInt('undefined') = NaN，
    // NaN 绑到 LIMIT 上 SQLite 报的正是 "datatype mismatch"（真机探针抓到的）。
    if (!Number.isFinite(limit) || limit <= 0) limit = 1000;
    if (limit > 10000) limit = 10000;
  } catch {
    limit = 1000;
  }

  let db: SqliteDatabase | null = null;
  try {
    const sql =
      'SELECT * FROM ' +
      table +
      (cond ? ' WHERE ' + cond : '') +
      (orderClause.trim() ? ' ORDER BY ' + orderClause.trim() : '') +
      ' LIMIT ?';
    const params = [...paramsList, limit];
    
    db = openDb(path.resolve(dbPath)) as SqliteDatabase;
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    const rowsList = rows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row)));
    
    let value = null;
    const found = rowsList.length > 0;
    if (resultField && found) {
      value = rowsList[0][resultField];
    }
    
    return {
      success: true,
      rows: rowsList,
      rows_count: rowsList.length,
      value,
      found,
      lastrowid: -1,
      rows_updated: 0,
      rows_deleted: 0,
      error: '',
    };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, error: 'SQL 错误: ' + err.message };
  } finally {
    try { db?.close(); } catch { /* 关闭失败不影响本次结果 */ }
  }
}

// ============================================================
// 主入口函数
// ============================================================

export function databaseWrite(options: DBOptions): Promise<DBResult> {
  const { mode, table } = options;

  if (!['insert', 'update', 'delete', 'select'].includes(mode)) {
    return Promise.resolve({ 
      success: false, 
      lastrowid: -1, 
      rows_updated: 0, 
      rows_deleted: 0, 
      rows: [], 
      rows_count: 0, 
      value: null, 
      found: false, 
      error: '未知模式: ' + mode + '（必须是 insert/update/delete/select 之一）' 
    });
  }

  let resolvedDbPath: string;
  try {
    // 相对 db_path 相对**项目根**（默认库因此落在项目目录里，而不是 cwd）
    resolvedDbPath = resolveDbPath(options.db_path || DEFAULT_DB_PATH, options.project_root);
  } catch (e: unknown) {
    return Promise.resolve(makeError(e instanceof Error ? e.message : String(e)));
  }
  
  if (mode === 'insert') {
    return doInsert(table, options.data, resolvedDbPath);
  } else if (mode === 'update') {
    return doUpdate(table, options.data, options.condition || '', resolvedDbPath, options.where_params);
  } else if (mode === 'delete') {
    return doDelete(table, options.condition || '', resolvedDbPath, options.where_params);
  } else if (mode === 'select') {
    return doSelect(
      table, 
      options.condition || '', 
      resolvedDbPath, 
      options.where_params, 
      options.result_field || '', 
      options.limit || 1000,
      options.order || ''
    );
  }
  
  return Promise.resolve(makeError('未知模式: ' + mode));
}

export { DBResult, DBOptions, resolveDbPath };