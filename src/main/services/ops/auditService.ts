// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { getOrCreateDb, init_dataService } from "../project/dataService";

/**
* 获取审计日志数据库连接（通过 dataService 连接池复用）。
* 首次调用时创建数据库文件并初始化表结构（幂等）。
*/
function getAuditDb(projectPath) {
	const dir = path.join(projectPath, "data", "logs");
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const dbPath = path.join(dir, "audit.db");
	return getOrCreateDb(dbPath, (db) => {
		db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      user TEXT NOT NULL,
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      before TEXT,
      after TEXT
    )`);
		db.exec("CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(time)");
		db.exec("CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name)");
	});
}
function logAudit(projectPath, entry) {
	getAuditDb(projectPath).prepare("INSERT INTO audit_log (time, user, table_name, action, before, after) VALUES (?, ?, ?, ?, ?, ?)").run((/* @__PURE__ */ new Date()).toISOString(), entry.user, entry.table, entry.action, entry.before, entry.after);
}
function listAudit(projectPath, page = 1, pageSize = 50) {
	const db = getAuditDb(projectPath);
	const total = db.prepare("SELECT COUNT(*) as c FROM audit_log").get().c;
	return {
		rows: db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?").all(pageSize, (page - 1) * pageSize),
		total
	};
}
function searchAudit(projectPath, query) {
	return getAuditDb(projectPath).prepare("SELECT * FROM audit_log WHERE table_name LIKE ? OR user LIKE ? ORDER BY id DESC LIMIT 50").all(`%${query}%`, `%${query}%`);
}

export { getAuditDb, logAudit, listAudit, searchAudit };
