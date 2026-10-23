// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import better_sqlite3 from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { removeSqliteFiles } from "./sqliteFiles";
import { init_logger, logger } from "./logger";

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
var BaseSqliteStore = class {
	_dbCache = /* @__PURE__ */ new Map();
	/** 获取项目 .qqbat 目录路径 */
	getDir(projectPath) {
		return (0, path.join)(projectPath, ".qqbat");
	}
	/** 获取数据库文件完整路径 */
	getDbFilePath(projectPath) {
		return (0, path.join)(this.getDir(projectPath), this.getDbFileName());
	}
	/**
	* 获取（或创建）指定项目的 SQLite 连接。
	* better-sqlite3 是同步的，单进程内无需连接池，但按项目隔离缓存。
	*/
	getDb(projectPath) {
		const cached = this._dbCache.get(projectPath);
		if (cached) return cached;
		const dir = this.getDir(projectPath);
		if (!(0, fs.existsSync)(dir)) (0, fs.mkdirSync)(dir, { recursive: true });
		const dbPath = this.getDbFilePath(projectPath);
		const db = new better_sqlite3(dbPath);
		db.pragma("journal_mode = WAL");
		this._initSchema(db);
		this._dbCache.set(projectPath, db);
		return db;
	}
	/**
	* 事务执行：better-sqlite3 同步 API，transaction() 保证原子性。
	* 解决原 JSON 实现 read-modify-write 竞态问题。
	*/
	_tx(projectPath, fn) {
		const db = this.getDb(projectPath);
		return db.transaction(fn)(db);
	}
	/** 清除所有持久化状态：关闭连接并删除数据库文件（含 WAL/SHM） */
	clearAll(projectPath) {
		const db = this._dbCache.get(projectPath);
		if (db) {
			try {
				db.close();
			} catch {}
			this._dbCache.delete(projectPath);
		}
		try {
			this._onClearProject(projectPath);
		} catch (e) {
			logger.warn("[BaseSqliteStore] _onClearProject 钩子异常:", e);
		}
		removeSqliteFiles(this.getDbFilePath(projectPath));
	}
	/** 子类可重写：项目级清理钩子（如清理辅助缓存） */
	_onClearProject(_projectPath) {}
	/** 清理所有连接 */
	close() {
		for (const [, db] of this._dbCache) try {
			db.close();
		} catch {}
		this._dbCache.clear();
		this._onClose();
	}
	/** 子类可重写：全局关闭钩子 */
	_onClose() {}
};

export { BaseSqliteStore };
