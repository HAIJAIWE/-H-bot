// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { isPersistenceKind } from "../../../shared/nodes/kindSets";
import { KNOWN_ENUM_OPTIONS, canonicalFieldName, groupFor, inferDefaultValue, inferFieldType, isAutoManaged, isTemplateExcludedField, semanticLabel, semanticOf, toFieldCategory } from "../../../shared/persist/fieldSemantics";
import { path } from "path";
import { fs } from "fs";
import { getDb, init_dataService } from "./dataService";
import { BASE_DATA_KEYS, BASE_DATA_KEY_LIST, isBaseDataKey } from "../../../shared/persist/baseKeys";
import { buildKey, columnsForKey } from "../../../shared/persist/persistentKey";

/**
* 从单个 `variable_persist` 节点的 config 里取出它**读写了哪些 key**。
*
* 单个 key 放 `config.key`；**批量模式把键放在别处**：
*   - `batch_load` / `batch_save` / `batch_update`：`config.keys` 是 JSON 数组字符串
*     （实测格式 `'["lv","exp","gold"]'`），也兼容真数组；
*   - 批量保存的值是 `{key: value}` 对象（`config.data`），它的键同样是字段名。
*
* ⚠️ 少读这一处会**静默漏字段**：实测 RPG 项目靠 `config.keys` 声明了 `battle`、`mp_max`，
* 只读 `config.key` 时它们不出现在推导结果里（而这两条数据是真的存在）。
*/
function extractFieldKeysFromConfig(cfg) {
	const out = [];
	const single = typeof cfg.key === "string" ? cfg.key.trim() : "";
	if (single) out.push(single);
	const rawKeys = cfg.keys;
	if (typeof rawKeys === "string" && rawKeys.trim()) try {
		const parsed = JSON.parse(rawKeys);
		if (Array.isArray(parsed)) {
			for (const k of parsed) if (typeof k === "string" && k.trim()) out.push(k.trim());
		}
	} catch {}
	else if (Array.isArray(rawKeys)) {
		for (const k of rawKeys) if (typeof k === "string" && k.trim()) out.push(k.trim());
	}
	const rawData = cfg.data;
	if (typeof rawData === "string" && rawData.trim()) try {
		const parsed = JSON.parse(rawData);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			for (const k of Object.keys(parsed)) if (k.trim()) out.push(k.trim());
		}
	} catch {}
	else if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
		for (const k of Object.keys(rawData)) if (k.trim()) out.push(k.trim());
	}
	return out;
}
/**
* 所有"持久化（玩家数据）"节点的 kind —— **从目录派生**，不手抄。
*
* 为什么需要：2026-10-03 把 `variable_persist` 按"会不会拼错"拆成了 7 个节点
* （读/写/自增/条件更新/列表追加/删/判断存在），但本文件原来硬编码只认老 kind ✗ ——
* 拆完后**玩家字段识别会空掉**（审查发现的）。按 resource 派生之后，
* 以后再加持久化节点也会自动被认到。
*/
/**
* 从流程里收集持久化节点声明并在读写的字段。
*
* 只看一个 kind：它是持久化的**唯一**读写节点（旧 kind 会先被
* `graphPreprocess.migrateLegacyKinds` 迁移成它）。
*/
function collectFieldUsageFromFlow(graph) {
	const out = /* @__PURE__ */ new Map();
	const nodes = graph?.nodes;
	if (!Array.isArray(nodes)) return out;
	for (const raw of nodes) {
		const node = raw;
		if (!isPersistenceKind(String(node?.data?.nodeKind))) continue;
		const cfg = node?.data?.config;
		if (!cfg) continue;
		for (const key of extractFieldKeysFromConfig(cfg)) {
			const prev = out.get(key) ?? {
				key,
				modes: /* @__PURE__ */ new Set(),
				hasStoredValue: false
			};
			prev.modes.add(String(cfg.mode ?? "save"));
			out.set(key, prev);
		}
	}
	return out;
}
/** 从存档里补充"真实存在 + 样值"（用于类型推断） */
function mergeStoredValues(usages, storedRows, unwrap) {
	for (const row of storedRows) {
		const full = String(row.key ?? "");
		const idx = full.indexOf(":");
		const key = idx >= 0 ? full.slice(idx + 1) : full;
		if (!key) continue;
		const info = usages.get(key) ?? {
			key,
			modes: /* @__PURE__ */ new Set(),
			hasStoredValue: false
		};
		info.hasStoredValue = true;
		const value = unwrap(row.value);
		if ((Array.isArray(value) || typeof value === "object" && value !== null) && Object.keys(value).length === 0) info.observedContainer = true;
		else if (info.sampleValue === void 0) info.sampleValue = value;
		usages.set(key, info);
	}
}
/**
* 引擎基础数据 → 模板字段（注册时间 / 最后在线 / 最后在线日期 / 消息计数 / 昵称）。
*
* 为什么**无条件**并入推导结果：它们不是"项目声明的字段"，而是**每个项目初始就该有的**
* ——由运行时维护（`runtime/baseData.ts`）。用户如果想改中文名，可以在模板编辑器里改。
*
* 全部 `auto: true` 且**不给 default**：值由引擎在事件到达时写入，
* 模板预填充只会写进去一个错的初始值（例如把"最后在线"写成模板保存那天）。
*/
function buildBaseDataFields() {
	const NUMBER_HINT = {
		[BASE_DATA_KEYS.msgCount]: "number",
		[BASE_DATA_KEYS.registeredAt]: "datetime",
		[BASE_DATA_KEYS.lastActive]: "datetime",
		[BASE_DATA_KEYS.lastActiveDate]: "date",
		[BASE_DATA_KEYS.nickname]: "text"
	};
	return BASE_DATA_KEY_LIST.map((key) => ({
		key,
		label: semanticLabel(key) ?? key,
		type: NUMBER_HINT[key] ?? "text",
		auto: true,
		category: "status"
	}));
}
/**
* 把字段使用情况整理成一份数据模板。
*
* 分组顺序固定（**基础数据** → 等级经验 → 战斗属性 → 经济 → 物品 → 状态），
* 组内按 key 排序 —— 让同一份项目数据每次推导出**一样**的模板（便于 diff 与测试）。
*/
function buildTemplateFromUsages(usages) {
	const buckets = /* @__PURE__ */ new Map();
	const order = [
		"base",
		"level",
		"growth",
		"combat",
		"economy",
		"collection",
		"status"
	];
	buckets.set("base", {
		spec: groupFor("base"),
		fields: buildBaseDataFields()
	});
	const keys = [...usages.keys()].filter((k) => !isBaseDataKey(k) && !isTemplateExcludedField(k)).sort();
	for (const key of keys) {
		const info = usages.get(key);
		const semantic = semanticOf(key, info.sampleValue);
		const type = info.observedContainer && info.sampleValue === void 0 ? "json" : inferFieldType(key, info.sampleValue);
		const enumOptions = KNOWN_ENUM_OPTIONS[canonicalFieldName(key)];
		const finalType = enumOptions ? "enum" : type;
		const field = {
			key,
			label: semanticLabel(key) ?? key,
			type: finalType
		};
		const def = inferDefaultValue(key, finalType, [...info.modes]);
		if (def !== void 0) field.default = def;
		if (enumOptions) field.options = enumOptions;
		if (isAutoManaged(key)) field.auto = true;
		field.category = toFieldCategory(semantic);
		let bucket = buckets.get(semantic);
		if (!bucket) {
			bucket = {
				spec: groupFor(semantic),
				fields: []
			};
			buckets.set(semantic, bucket);
		}
		bucket.fields.push(field);
	}
	const groups = [];
	const indexById = /* @__PURE__ */ new Map();
	for (const semantic of order) {
		const bucket = buckets.get(semantic);
		if (!bucket || bucket.fields.length === 0) continue;
		const existing = indexById.get(bucket.spec.id);
		if (existing === void 0) {
			indexById.set(bucket.spec.id, groups.length);
			groups.push({
				...bucket.spec,
				fields: [...bucket.fields]
			});
		} else groups[existing].fields.push(...bucket.fields);
	}
	return {
		version: 1,
		groups
	};
}
/**
* 读项目的 `flow.json`（不存在/损坏 → null，不抛）。
*
* 这里用同步读：模板是**打开面板时按需推导**的，不是热路径；
* 而且调用方（IPC handler）本身就是同步风格。
*/
function readProjectFlow(projectPath) {
	try {
		const filePath = (0, path.join)(projectPath, ".qqbat", "flow.json");
		if (!(0, fs.existsSync)(filePath)) return null;
		return JSON.parse((0, fs.readFileSync)(filePath, "utf-8"));
	} catch {
		return null;
	}
}
/** 读存档里该项目的全部 `_persistent` 行（库/表不存在 → 空数组，不抛） */
function readStoredRows(projectPath) {
	const dbPath = (0, path.join)(projectPath, "data", "players", "persistent.db");
	if (!(0, fs.existsSync)(dbPath)) return [];
	try {
		return getDb(dbPath).prepare("SELECT key, value FROM _persistent").all();
	} catch {
		return [];
	}
}
/**
* 从项目自身推导默认数据模板。
*
* 两个来源都是"项目里真实存在的"：
*   1. `flow.json` 的 `variable_persist` 声明；
*   2. `persistent.db` 的 `_persistent` 实际行。
*
* 两者都空（新项目、还没跑过）→ 返回**空模板**（不是一份编的示例）。
*/
function deriveTemplateFromProject(projectPath) {
	const usages = collectFieldUsageFromFlow(readProjectFlow(projectPath));
	mergeStoredValues(usages, readStoredRows(projectPath), (raw) => {
		if (typeof raw !== "string") return raw;
		const trimmed = raw.trim();
		if (!trimmed.startsWith("{")) return raw;
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "value" in parsed && "expire_at" in parsed) return parsed.value;
		} catch {}
		return raw;
	});
	return buildTemplateFromUsages(usages);
}
/**
* 读取项目的数据模板。
*
* 文件位于 `projectPath/.qqbat/data_template.json`：
*   - 存在 → 用它（用户声明优先）；
*   - 不存在 → **从项目自身推导**（不再回退到硬编码示例）。
*/
function getDataTemplate(projectPath) {
	const filePath = (0, path.join)(projectPath, ".qqbat", "data_template.json");
	if (!(0, fs.existsSync)(filePath)) return deriveTemplateFromProject(projectPath);
	try {
		const parsed = JSON.parse((0, fs.readFileSync)(filePath, "utf-8"));
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.groups)) return deriveTemplateFromProject(projectPath);
		return parsed;
	} catch {
		return deriveTemplateFromProject(projectPath);
	}
}
/**
* 保存数据模板到 `projectPath/.qqbat/data_template.json`。
* 保存后自动将新字段同步到已有玩家的 _persistent 表。
*/
function saveDataTemplate(projectPath, template) {
	const dir = (0, path.join)(projectPath, ".qqbat");
	const filePath = (0, path.join)(dir, "data_template.json");
	if (!(0, fs.existsSync)(dir)) (0, fs.mkdirSync)(dir, { recursive: true });
	(0, fs.writeFileSync)(filePath, JSON.stringify(template, null, 2), "utf-8");
	syncTemplateToPlayers(projectPath, template);
}
/**
* 将模板中所有字段同步到已有玩家的 _persistent 表。
* 仅对当前不存在的字段写入默认值，不覆盖已有数据。
*/
function syncTemplateToPlayers(projectPath, template) {
	const dbPath = (0, path.join)(projectPath, "data", "players", "persistent.db");
	if (!(0, fs.existsSync)(dbPath)) return;
	const db = getDb(dbPath);
	const uids = db.prepare("SELECT DISTINCT qq AS uid FROM _persistent WHERE scope = 'user'").all().map((r) => r.uid).filter(Boolean);
	if (uids.length === 0) return;
	const insertStmt = db.prepare("INSERT OR IGNORE INTO _persistent (key, value, scope, qq) VALUES (?, ?, 'user', ?)");
	db.transaction(() => {
		for (const group of template.groups) for (const field of group.fields) {
			if (field.auto) continue;
			const defVal = field.default !== void 0 ? field.default : "";
			const valStr = JSON.stringify(defVal);
			for (const uid of uids) {
				const fullKey = buildKey(field.key, "user", { user_id: uid });
				insertStmt.run(fullKey, valStr, columnsForKey(fullKey).qq);
			}
		}
	})();
}

export { extractFieldKeysFromConfig, collectFieldUsageFromFlow, mergeStoredValues, buildBaseDataFields, buildTemplateFromUsages, readProjectFlow, readStoredRows, deriveTemplateFromProject, getDataTemplate, saveDataTemplate, syncTemplateToPlayers };
