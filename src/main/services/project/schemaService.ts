// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as fs from "fs";
import * as path from "path";
import { getDb } from "./dataService";

function loadSchemaFile(filePath) {
	if (!fs.existsSync(filePath)) return [];
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const raw = JSON.parse(content);
		return (Array.isArray(raw) ? raw : [raw]).map((def) => {
			if (!def.fields) return def;
			const fields = {};
			for (const [name, cfg] of Object.entries(def.fields)) {
				const c = cfg;
				fields[name] = {
					...c,
					enumValues: c.enumValues ?? c.options
				};
			}
			return {
				...def,
				fields
			};
		});
	} catch {
		return [];
	}
}
function loadSchemaDir(schemaDir) {
	const schemas = /* @__PURE__ */ new Map();
	if (!fs.existsSync(schemaDir)) return schemas;
	const files = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"));
	for (const file of files) {
		const defs = loadSchemaFile(path.join(schemaDir, file));
		for (const def of defs) schemas.set(def.table, def);
	}
	return schemas;
}
function getPragmaSchema(dbPath) {
	if (!fs.existsSync(dbPath)) return /* @__PURE__ */ new Map();
	const db = getDb(dbPath);
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
	const result = /* @__PURE__ */ new Map();
	for (const t of tables) {
		const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
		result.set(t.name, cols.map((c) => ({
			name: c.name,
			type: c.type,
			notNull: c.notnull === 1,
			default: c.dflt_value
		})));
	}
	return result;
}
function getMergedSchema(dbPath, schemaDir) {
	const schemaDefs = loadSchemaDir(schemaDir);
	const pragmaSchemas = getPragmaSchema(dbPath);
	const result = [];
	for (const [tableName, cols] of pragmaSchemas) if (schemaDefs.has(tableName)) result.push({
		table: tableName,
		fields: schemaDefs.get(tableName).fields
	});
	else {
		const fields = {};
		for (const col of cols) fields[col.name] = {
			type: mapSqlType(col.type),
			label: col.name,
			required: col.notNull
		};
		result.push({
			table: tableName,
			fields
		});
	}
	return result;
}
function mapSqlType(sqlType) {
	const t = sqlType.toUpperCase();
	if (t.includes("INT")) return "int";
	if (t.includes("REAL") || t.includes("FLOAT") || t.includes("DOUBLE")) return "float";
	if (t.includes("TEXT")) return "string";
	if (t.includes("BLOB")) return "json";
	return "string";
}
/**
 * 兼容入口：让 dataService 的 init 能"等 schemaService 就绪"。
 *
 * 为什么是空实现：本模块只读 schema 文件（loadSchemaFile / getPragmaSchema / mapSqlType），
 * 不依赖 dataService 的任何状态。原先这里调 init_dataService() 是为了在打包产物里
 * 强制初始化顺序，但在 ESM 下就变成 **模块循环初始化**：
 * dataService 顶部 import schemaService → schemaService 顶层调用 init_dataService()
 * → 此时 dataService 的 let dataServiceInited 还在 TDZ → ReferenceError。
 * 顺序现在已经由 dataService 自己在 init 里显式调用保证，这里回归"只做幂等占位"。
 */
let schemaServiceInited = false;
function init_schemaService() {
	if (schemaServiceInited) return;
	schemaServiceInited = true;
}
export { loadSchemaFile, loadSchemaDir, getPragmaSchema, getMergedSchema, mapSqlType, init_schemaService };
