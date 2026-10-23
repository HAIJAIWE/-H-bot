// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { resolveInProject } from "./projectPath";
import { databaseWrite } from "./databaseWrite";

/** 只读保护：这些关键字出现在 where/order 里直接拒绝 */
var WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|pragma|vacuum)\b/i;
function asString$1(v) {
	return v === null || v === void 0 ? "" : String(v);
}
/** where_params 归一化：数组就用，单值包一层，空串/null 当没有 */
function asParams(v) {
	if (v === null || v === void 0 || v === "") return [];
	if (Array.isArray(v)) return v.filter((x) => x !== null && x !== void 0);
	if (typeof v === "string") {
		const t = v.trim();
		if (!t) return [];
		if (t.startsWith("[")) try {
			const parsed = JSON.parse(t);
			return Array.isArray(parsed) ? parsed.filter((x) => x !== null && x !== void 0) : [parsed];
		} catch {
			return [v];
		}
		return [v];
	}
	return [v];
}
/**
* 列出项目里已有的配置表名（读 `.schema/*.json`）。
*
* 用途有两个：拼错表名时给出**可选清单**（比"查不到"有用得多），
* 以及在没有 `.schema` 元数据时判断库文件是否存在。
*/
function listConfigTables(projectRoot) {
	const dir = path.join(projectRoot, "data", "config");
	try {
		return fs.readdirSync(dir).filter((f) => f.endsWith(".db")).map((f) => f.slice(0, -3)).sort();
	} catch {
		return [];
	}
}
/** 判断某个库文件是否存在（pathGuard 会挡住越界路径） */
function dbFileExists(dbPath, projectRoot) {
	try {
		const abs = resolveInProject(dbPath, {
			injectedRoot: projectRoot,
			label: "数据库路径"
		});
		return fs.existsSync(abs);
	} catch {
		return false;
	}
}
/**
* 读配置表。**只读**，不发送、不写库。
*
* @param config 由运行时按目录端口解析出的 kwargs
* @param projectRoot 当前项目目录（取配置表的根）
*/
async function configQuery(config = {}, projectRoot) {
	const empty = {
		rows: [],
		count: 0,
		first: null,
		value: null
	};
	const fail = (error) => ({
		...empty,
		success: false,
		error
	});
	const table = asString$1(config.table).trim();
	if (!table) return fail("配置表名不能为空（例如 items / monsters / levels）");
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return fail(`非法表名: ${table}（只能用字母/数字/下划线，且不以数字开头）`);
	/**
	* 查询模式（目录 `CONFIG_QUERY_MODE_OPTIONS`：`all` = 所有行 / `row` = 只取一行）。
	*
	* 未知取值**明确报错**，不静默当成 `all`：静默降级正是这个节点存在的理由的反面
	* （它的头注写着"把静默失败变响"）。
	*/
	const mode = asString$1(config.mode).trim() || "all";
	if (mode !== "all" && mode !== "row") return fail(`未知的查询模式: ${mode}（可选：all = 所有行 / row = 只取一行）`);
	const where = asString$1(config.where).trim();
	const order = asString$1(config.order).trim();
	for (const [label, frag] of [["筛选条件", where], ["排序", order]]) {
		if (!frag) continue;
		if (WRITE_KEYWORDS.test(frag)) return fail(`${label}里含写操作关键字，本节点只读: ${frag}`);
		if (/[;]|--|\/\*/.test(frag)) return fail(`${label}含非法字符（; / -- / 注释）: ${frag}`);
	}
	if (where.includes("'") || where.includes("\"")) return fail(`筛选条件里不能写引号字面量，请用 ? 占位符并把值放进「条件参数」: ${where}\n例如把 \`type = 'weapon'\` 写成条件 \`type = ?\` + 参数 ["weapon"]`);
	const dbPath = asString$1(config.db_path).trim() || `data/config/${table}.db`;
	const params = asParams(config.where_params);
	if (!dbFileExists(dbPath, projectRoot)) {
		const available = projectRoot ? listConfigTables(projectRoot) : [];
		return fail(`找不到配置表「${table}」（期望库文件 ${dbPath}）。` + (available.length ? `当前项目里有: ${available.join(", ")}` : "项目里还没有任何配置表"));
	}
	const limit = mode === "row" ? 1 : Number(config.limit) > 0 ? Number(config.limit) : 1e3;
	const field = asString$1(config.field).trim();
	const result = await databaseWrite({
		mode: "select",
		table,
		condition: where,
		db_path: dbPath,
		where_params: params,
		result_field: field,
		limit,
		order,
		project_root: projectRoot
	});
	if (!result?.success) return fail(result?.error ? `查询配置表 ${table} 失败: ${result.error}` : `查询配置表 ${table} 失败`);
	const rows = Array.isArray(result.rows) ? result.rows : [];
	return {
		rows,
		count: rows.length,
		first: rows[0] ?? null,
		value: field ? result.value ?? null : rows[0] ?? null,
		success: true,
		error: ""
	};
}

export { WRITE_KEYWORDS, asString$1, asParams, listConfigTables, dbFileExists, configQuery };
