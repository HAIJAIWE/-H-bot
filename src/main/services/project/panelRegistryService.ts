// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { ensureIndexes, getDb, init_dataService } from "./dataService";
import { init_logger, logger } from "../infra/logger";
import { getMergedSchema } from "./schemaService";

/**
* 校验 SQL 表名（防止 SQL 注入）。
* tableName 来自 flow.json 的 admin_panel 节点配置（用户编辑），拼接进 SQL 语句前必须校验。
* 与 dataTransferService.ts 的 validateTableName 保持一致的规则：
*   1. 拒绝 SQLite 内部系统表（sqlite_ 前缀）
*   2. 只允许合法 SQL 标识符（字母/下划线开头，只含字母数字下划线）
*/
function validateTableName(tableName) {
	if (typeof tableName !== "string" || tableName.length === 0) throw new Error(`Invalid table name: ${String(tableName)}`);
	if (tableName.toLowerCase().startsWith("sqlite_")) throw new Error(`Cannot access SQLite internal table: ${tableName}`);
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new Error(`Invalid table name: ${tableName}`);
}
/** 开发环境标记：仅在非生产环境下记录慢查询日志 */
var IS_DEV = process.env.NODE_ENV !== "production";
var SLOW_QUERY_THRESHOLD_MS = 100;
/** 在开发环境下记录慢查询（>100ms），使用 console.debug 避免污染生产日志 */
function logSlowQuery(sql, durationMs) {
	if (IS_DEV && durationMs > SLOW_QUERY_THRESHOLD_MS) {
		const compactSql = sql.replace(/\s+/g, " ").trim().slice(0, 200);
		logger.debug(`[slow-query] ${durationMs}ms | ${compactSql}`);
	}
}
function getRegisteredPanels(projectPath) {
	const flowPath = path.join(projectPath, ".qqbat", "flow.json");
	if (!fs.existsSync(flowPath)) return [];
	try {
		const flow = JSON.parse(fs.readFileSync(flowPath, "utf-8"));
		if (!flow.nodes || !Array.isArray(flow.nodes)) return [];
		const panels = [];
		for (const node of flow.nodes) {
			const data = node.data || {};
			const kind = data.nodeKind || data.data && data.data.nodeKind;
			if (kind === "admin_panel" || kind === "panel_register") {
				const config = data.config || data.data && data.data.config || {};
				if (config.panelId && config.label) panels.push({
					panelId: config.panelId,
					label: config.label,
					description: config.description || "",
					dataSource: config.dataSource || "",
					tableName: config.tableName || ""
				});
			}
		}
		return panels;
	} catch (e) {
		logger.warn("[panelRegistry] 面板注册表读取失败:", e);
		return [];
	}
}
function getPanelSchema(projectPath, panel) {
	if (!panel.tableName || !panel.dataSource) return panel;
	const possiblePaths = [path.join(projectPath, "data", "players", panel.dataSource), path.join(projectPath, "data", "config", panel.dataSource)];
	for (const dbPath of possiblePaths) if (fs.existsSync(dbPath)) {
		const schemaDir = path.join(path.dirname(dbPath), ".schema");
		const match = getMergedSchema(dbPath, schemaDir).find((s) => s.table === panel.tableName);
		if (match) panel.fields = match.fields;
		break;
	}
	return panel;
}
function queryPanelTable(projectPath, panel, page = 1, pageSize = 50, cursor) {
	if (!panel.tableName || !panel.dataSource) return {
		rows: [],
		total: 0,
		error: "未配置数据源和表名"
	};
	try {
		validateTableName(panel.tableName);
	} catch (e) {
		return {
			rows: [],
			total: 0,
			error: String(e)
		};
	}
	const possiblePaths = [path.join(projectPath, "data", "players", panel.dataSource), path.join(projectPath, "data", "config", panel.dataSource)];
	for (const dbPath of possiblePaths) if (fs.existsSync(dbPath) && dbPath.endsWith(".db")) try {
		ensureIndexes(dbPath);
		const db = getDb(dbPath);
		const startTotal = Date.now();
		const total = db.prepare(`SELECT COUNT(*) as c FROM \`${panel.tableName}\``).get().c;
		logSlowQuery(`SELECT COUNT(*) FROM \`${panel.tableName}\``, Date.now() - startTotal);
		let rows;
		// 注意：cursor 的默认是 null，而 `null >= 0` 在 JS 里是 true —— 只判 undefined 会让
// 「不传 cursor」也走进 keyset 分支，SQL 里 `rowid > NULL` 恒为空，整页数据消失。
// 这是 10/18 构建里的真实 bug（产物 index.js:406331 同样是这个写法），10/20 之后修好。
if (cursor !== void 0 && cursor !== null && cursor >= 0) {
			const startQuery = Date.now();
			rows = db.prepare(`SELECT rowid, * FROM \`${panel.tableName}\` WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`).all(cursor, pageSize);
			logSlowQuery(`SELECT rowid, * FROM \`${panel.tableName}\` WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`, Date.now() - startQuery);
		} else {
			const startQuery = Date.now();
			rows = db.prepare(`SELECT rowid, * FROM \`${panel.tableName}\` LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
			logSlowQuery(`SELECT rowid, * FROM \`${panel.tableName}\` LIMIT ? OFFSET ?`, Date.now() - startQuery);
		}
		let nextCursor = null;
		if (rows.length === pageSize && rows.length > 0) nextCursor = rows[rows.length - 1].rowid ?? null;
		return {
			rows,
			total,
			nextCursor
		};
	} catch (e) {
		return {
			rows: [],
			total: 0,
			error: String(e)
		};
	}
	return {
		rows: [],
		total: 0,
		error: "未找到关联数据源"
	};
}

export { validateTableName, IS_DEV, SLOW_QUERY_THRESHOLD_MS, logSlowQuery, getRegisteredPanels, getPanelSchema, queryPanelTable };
