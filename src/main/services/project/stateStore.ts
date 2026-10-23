// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { BaseSqliteStore } from "../infra/baseSqliteStore";
import * as fs from "fs";

var STATE_DB_FILE = "state.db";
/** 2 = session_vars 改名为 ui_session_vars（2026-10-18） */
var SCHEMA_VERSION = 2;
var StateStore = class StateStore extends BaseSqliteStore {
	static _instance = null;
	/** 获取 StateStore 单例（整个应用共享同一实例） */
	static getInstance() {
		if (!StateStore._instance) StateStore._instance = new StateStore();
		return StateStore._instance;
	}
	/** 重置单例（仅用于测试，生产代码禁止调用） */
	static resetInstanceForTesting() {
		StateStore._instance = null;
	}
	getDbFileName() {
		return STATE_DB_FILE;
	}
	_initSchema(db) {
		db.exec(`
      CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
		if (Number(db.pragma("user_version", { simple: true }) ?? 0) < 2) {
			const hasOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_vars'").get();
			const hasNew = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ui_session_vars'").get();
			if (hasOld && !hasNew) db.exec("ALTER TABLE session_vars RENAME TO ui_session_vars");
			db.exec("DROP INDEX IF EXISTS idx_session_vars_sid");
		}
		db.exec(`
      CREATE TABLE IF NOT EXISTS ui_session_vars (
        session_id TEXT NOT NULL,
        var_name TEXT NOT NULL,
        var_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, var_name)
      );
      CREATE INDEX IF NOT EXISTS idx_ui_session_vars_sid ON ui_session_vars(session_id);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
	}
	/** 写入通用键值对（UPSERT），value 会被 JSON 序列化存储
	* @param key 键名
	* @param value 任意可序列化值
	* @param projectPath 项目根路径，用于定位 db 文件
	*/
	set(key, value, projectPath) {
		const serialized = JSON.stringify(value);
		const now = Date.now();
		this._tx(projectPath, (db) => {
			db.prepare(`INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, serialized, now);
		});
	}
	/** 读取通用键值对，不存在返回 null
	* @typeparam T 期望的返回类型
	* @param key 键名
	* @param projectPath 项目根路径
	* @returns 反序列化后的值，不存在则为 null
	*/
	get(key, projectPath) {
		const row = this.getDb(projectPath).prepare("SELECT value FROM bot_state WHERE key = ?").get(key);
		if (!row) return null;
		try {
			return JSON.parse(row.value);
		} catch {
			return row.value;
		}
	}
	/** 删除通用键值对
	* @param key 键名
	* @param projectPath 项目根路径
	* @returns 是否实际删除了行（changes > 0）
	*/
	delete(key, projectPath) {
		return this._tx(projectPath, (db) => {
			return db.prepare("DELETE FROM bot_state WHERE key = ?").run(key).changes > 0;
		});
	}
	/** 列出通用键名，支持前缀过滤和分页
	* @param prefix 键名前缀过滤（LIKE prefix%），不传则返回全部
	* @param projectPath 项目根路径（必填，缺省返回空数组）
	* @param limit 最大返回条数
	* @param offset 跳过前 N 条
	* @returns 键名字符串数组，按 key 字母序排列
	*/
	listKeys(prefix, projectPath, limit, offset) {
		if (!projectPath) return [];
		const db = this.getDb(projectPath);
		if (prefix) {
			const sql = limit !== void 0 && offset !== void 0 ? "SELECT key FROM bot_state WHERE key LIKE ? ORDER BY key LIMIT ? OFFSET ?" : limit !== void 0 ? "SELECT key FROM bot_state WHERE key LIKE ? ORDER BY key LIMIT ?" : "SELECT key FROM bot_state WHERE key LIKE ? ORDER BY key";
			const params = [`${prefix}%`];
			if (limit !== void 0) params.push(limit);
			if (offset !== void 0) params.push(offset);
			return db.prepare(sql).all(...params).map((r) => r.key);
		}
		const sql = limit !== void 0 && offset !== void 0 ? "SELECT key FROM bot_state ORDER BY key LIMIT ? OFFSET ?" : limit !== void 0 ? "SELECT key FROM bot_state ORDER BY key LIMIT ?" : "SELECT key FROM bot_state ORDER BY key";
		const params = [];
		if (limit !== void 0) params.push(limit);
		if (offset !== void 0) params.push(offset);
		return db.prepare(sql).all(...params).map((r) => r.key);
	}
	/** 获取 bot_state 条目数量 */
	getStateCount(projectPath) {
		return this.getDb(projectPath).prepare("SELECT COUNT(*) as cnt FROM bot_state").get().cnt;
	}
	/** 获取所有 state 条目（含值和更新时间），支持分页
	* @param projectPath 项目根路径
	* @param limit 最大返回条数
	* @param offset 跳过前 N 条
	* @returns 条目数组，按 key 字母序排列
	*/
	getAllStateEntries(projectPath, limit, offset) {
		const db = this.getDb(projectPath);
		const sql = limit !== void 0 && offset !== void 0 ? "SELECT key, value, updated_at FROM bot_state ORDER BY key LIMIT ? OFFSET ?" : limit !== void 0 ? "SELECT key, value, updated_at FROM bot_state ORDER BY key LIMIT ?" : "SELECT key, value, updated_at FROM bot_state ORDER BY key";
		const params = [];
		if (limit !== void 0) params.push(limit);
		if (offset !== void 0) params.push(offset);
		return db.prepare(sql).all(...params).map((row) => ({
			key: row.key,
			value: (() => {
				try {
					return JSON.parse(row.value);
				} catch {
					return row.value;
				}
			})(),
			updatedAt: row.updated_at
		}));
	}
	/** 写入会话变量（UPSERT），value 会被 JSON 序列化存储
	* @param sessionId 会话 ID
	* @param varName 变量名
	* @param value 任意可序列化值
	* @param projectPath 项目根路径
	*/
	setSessionVar(sessionId, varName, value, projectPath) {
		const serialized = JSON.stringify(value);
		const now = Date.now();
		this._tx(projectPath, (db) => {
			db.prepare(`INSERT INTO ui_session_vars (session_id, var_name, var_value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, var_name) DO UPDATE SET var_value = excluded.var_value, updated_at = excluded.updated_at`).run(sessionId, varName, serialized, now);
		});
	}
	/** 读取会话变量，不存在返回 null
	* @typeparam T 期望的返回类型
	* @param sessionId 会话 ID
	* @param varName 变量名
	* @param projectPath 项目根路径
	* @returns 反序列化后的值，不存在则为 null
	*/
	getSessionVar(sessionId, varName, projectPath) {
		const row = this.getDb(projectPath).prepare("SELECT var_value FROM ui_session_vars WHERE session_id = ? AND var_name = ?").get(sessionId, varName);
		if (!row) return null;
		try {
			return JSON.parse(row.var_value);
		} catch {
			return row.var_value;
		}
	}
	/** 清除指定会话的所有变量
	* @param sessionId 会话 ID
	* @param projectPath 项目根路径
	*/
	clearSession(sessionId, projectPath) {
		this._tx(projectPath, (db) => {
			db.prepare("DELETE FROM ui_session_vars WHERE session_id = ?").run(sessionId);
		});
	}
	/** 获取 session 数量（按 sessionId 去重） */
	getSessionCount(projectPath) {
		return this.getDb(projectPath).prepare("SELECT COUNT(DISTINCT session_id) as cnt FROM ui_session_vars").get().cnt;
	}
	/** 获取 database 文件大小 (bytes) */
	getDbSize(projectPath) {
		const fp = this.getDbFilePath(projectPath);
		if (!(0, fs.existsSync)(fp)) return 0;
		try {
			return (0, fs.statSync)(fp).size;
		} catch {
			return 0;
		}
	}
};

export { STATE_DB_FILE, SCHEMA_VERSION, StateStore };
