// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
// 命名空间导入，理由同 project/dataTemplateService.ts（具名导入拿到 undefined）
import * as path from "path";
import * as fs from "fs";
import { collectFieldUsages } from "../../../shared/persist/fieldUsages";
import { inferFieldType, isEngineStateField, semanticLabel, semanticOf, toFieldCategory } from "../../../shared/persist/fieldSemantics";
import { getDb, init_dataService } from "./dataService";
import { init_logger, logger } from "../infra/logger";
import { unwrapPersistentValue } from "../../../shared/persist/value";
import { isBaseDataKey } from "../../../shared/persist/baseKeys";

/** 合法分类白名单 —— schema 文件是**人可编辑**的，写错了不该污染界面 */
var FIELD_CATEGORIES = /* @__PURE__ */ new Set([
	"identity",
	"level",
	"economy",
	"combat",
	"exploration",
	"cultivation",
	"collection",
	"business",
	"martial",
	"social_base",
	"status",
	"stats"
]);
var PLAYERS_DIR = ["data", "players"];
var SCHEMA_FILE = "player.schema.json";
var DISPLAY_NAME = "玩家存档";
/** 玩家 schema 文件的绝对路径 */
function playerSchemaPath(projectPath) {
	return (0, path.join)(projectPath, ...PLAYERS_DIR, SCHEMA_FILE);
}
/** 读流程（读不到就当没有 —— 派生允许降级到"只看存档"） */
function readFlowGraph(projectPath) {
	try {
		const raw = (0, fs.readFileSync)((0, path.join)(projectPath, ".qqbat", "flow.json"), "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
/** 存档里真实存在的字段 key → 解包后的第一个值（用来推导类型） */
function listPersistedKeys(projectPath) {
	const out = /* @__PURE__ */ new Map();
	const dbPath = (0, path.join)(projectPath, ...PLAYERS_DIR, "persistent.db");
	if (!(0, fs.existsSync)(dbPath)) return out;
	try {
		const rows = getDb(dbPath).prepare("SELECT key, value FROM _persistent").all();
		for (const r of rows) {
			const full = String(r.key ?? "");
			const idx = full.indexOf(":");
			const key = idx >= 0 ? full.slice(idx + 1) : full;
			if (!key || out.has(key)) continue;
			let parsed = r.value;
			try {
				parsed = JSON.parse(r.value);
			} catch {}
			out.set(key, unwrapPersistentValue(parsed));
		}
	} catch (e) {
		logger.warn(`[playerSchema] 读取玩家存档失败（降级为只看流程声明）: ${e instanceof Error ? e.message : String(e)}`);
	}
	return out;
}
/** 读项目自己的覆盖（可选文件） */
function readSchemaOverride(projectPath) {
	const p = playerSchemaPath(projectPath);
	if (!(0, fs.existsSync)(p)) return null;
	try {
		return JSON.parse((0, fs.readFileSync)(p, "utf-8"));
	} catch (e) {
		logger.warn(`[playerSchema] ${SCHEMA_FILE} 解析失败，已忽略: ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
}
/** 节点名常是句子（「读取当前HP」），不适合直接当字段名 —— 只在"像名字"时采用 */
function labelFromUsage(nodeLabel) {
	if (!nodeLabel) return void 0;
	const l = nodeLabel.trim();
	if (!l || l.length > 8) return void 0;
	if (/读取|保存|删除|检查|自增|批量|更新|写入|查询/.test(l)) return void 0;
	return l;
}
/**
* 合并三方得到玩家 schema：
*   项目覆盖（player.schema.json） > 流程声明 > 存档实际值 > 语义表 > key 本身
*/
function getPlayerSchema(projectPath) {
	const usages = collectFieldUsages(readFlowGraph(projectPath));
	const observed = listPersistedKeys(projectPath);
	const override = readSchemaOverride(projectPath);
	const keys = /* @__PURE__ */ new Set([
		...usages.keys(),
		...observed.keys(),
		...Object.keys(override?.fields ?? {})
	]);
	const fields = [];
	for (const key of keys) {
		const usage = usages.get(key);
		const hasValue = observed.has(key);
		const value = observed.get(key);
		const ov = override?.fields?.[key];
		const semantic = semanticOf(key, value);
		const base = isBaseDataKey(key);
		const source = usage ? "declared" : hasValue ? "observed" : "manual";
		const label = ov?.label ?? labelFromUsage(usage?.label) ?? semanticLabel(key) ?? key;
		fields.push({
			key,
			label,
			type: ov?.type ?? inferFieldType(key, value),
			category: (ov?.category && FIELD_CATEGORIES.has(ov.category) ? ov.category : void 0) ?? (base ? "status" : toFieldCategory(semantic)),
			isBaseData: base,
			isEngineState: !base && isEngineStateField(key),
			source,
			...usage ? { usage: {
				modes: [...usage.modes],
				nodeCount: usage.nodeCount,
				scope: usage.scope
			} } : {}
		});
	}
	fields.sort((a, b) => {
		if (a.isBaseData !== b.isBaseData) return a.isBaseData ? -1 : 1;
		if (a.isEngineState !== b.isEngineState) return a.isEngineState ? 1 : -1;
		return a.key.localeCompare(b.key);
	});
	return {
		table: "player",
		displayName: override?.displayName ?? DISPLAY_NAME,
		fields
	};
}
/** 把当前 schema 落成文件（让项目"拥有"这份契约：可以手改 label/type/category） */
function savePlayerSchema(projectPath, schema) {
	const dir = (0, path.join)(projectPath, ...PLAYERS_DIR);
	(0, fs.mkdirSync)(dir, { recursive: true });
	const out = {
		displayName: schema.displayName,
		fields: Object.fromEntries(schema.fields.map((f) => [f.key, {
			label: f.label,
			type: f.type,
			category: f.category
		}]))
	};
	(0, fs.writeFileSync)(playerSchemaPath(projectPath), JSON.stringify(out, null, 2) + "\n", "utf-8");
}

export { FIELD_CATEGORIES, PLAYERS_DIR, SCHEMA_FILE, DISPLAY_NAME, playerSchemaPath, readFlowGraph, listPersistedKeys, readSchemaOverride, labelFromUsage, getPlayerSchema, savePlayerSchema };
