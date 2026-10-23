// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { pinyin_pro } from "pinyin-pro";
import * as path from "path";
import * as fs from "fs";
import { deleteRecord, ensureIndexes, getDb, getOrCreateDb, getSchema, init_dataService, insertRecord, invalidateDb, queryTable, updateRecord } from "./dataService";
import { init_logger, logger } from "../infra/logger";
import { assertWithinProject } from "../infra/pathGuard";

/** 配置分类名白名单：仅允许字母、数字、下划线 */
var CATEGORY_RE = /^[A-Za-z0-9_]+$/;
/**
* 中文 → 拼音表名（下划线分隔，全小写）
* "装备配置" → "zhuangbei_peizhi"
* "VIP配置" → "vip_peizhi"（英文部分原样保留）
*/
function toPinyinTableName(chinese) {
	const result = (0, pinyin_pro.pinyin)(chinese, {
		toneType: "none",
		type: "array",
		nonZh: "consecutive"
	});
	let joined = Array.isArray(result) ? result.join("") : String(result);
	joined = joined.replace(/\s+/g, "").toLowerCase();
	joined = joined.replace(/[^a-z0-9]+/g, "_");
	joined = joined.replace(/^_+|_+$/g, "");
	if (!joined) joined = "table_" + Date.now();
	return joined;
}
/**
* 按字段类型返回智能默认值（用于 ALTER TABLE ADD COLUMN NOT NULL 场景）
* SQLite 限制：ALTER TABLE ADD COLUMN 对 NOT NULL 列必须提供非 NULL DEFAULT，
* 否则报错 "Cannot add a NOT NULL column with default value NULL"。
* 前端 TableDesignModal 添加新字段表单未提供 defaultValue 输入时，这里兜底注入。
*/
function getSmartDefaultValue(type, enumValues) {
	switch (type) {
		case "integer": return 0;
		case "real": return 0;
		case "boolean": return 0;
		case "json": return "{}";
		case "enum": return enumValues && enumValues.length > 0 ? enumValues[0] : "";
		default: return "";
	}
}
/** 把 FieldDefinition 转为 SQLite 列定义 SQL 片段 */
function fieldToColumnSql(f) {
	const name = f.name;
	let sqlType;
	switch (f.type) {
		case "integer":
			sqlType = "INTEGER";
			break;
		case "real":
			sqlType = "REAL";
			break;
		case "boolean":
			sqlType = "INTEGER";
			break;
		case "json":
			sqlType = "TEXT";
			break;
		case "enum":
			sqlType = "TEXT";
			break;
		case "ref":
			sqlType = "TEXT";
			break;
		default: sqlType = "TEXT";
	}
	const parts = [`"${name}" ${sqlType}`];
	if (f.notNull) parts.push("NOT NULL");
	if (f.defaultValue !== void 0 && f.defaultValue !== null) {
		const v = f.defaultValue;
		if (typeof v === "number") parts.push(`DEFAULT ${v}`);
		else if (typeof v === "boolean") parts.push(`DEFAULT ${v ? 1 : 0}`);
		else {
			const escaped = String(v).replace(/'/g, "''");
			parts.push(`DEFAULT '${escaped}'`);
		}
	}
	return parts.join(" ");
}
/** 将 FieldDefinition 数组写入 schema 元数据文件 */
function saveSchemaMetadata(projectPath, tableName, displayName, fields) {
	const schemaDir = path.join(projectPath, "data", "config", ".schema");
	if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true });
	const filePath = path.join(schemaDir, `${tableName}.schema.json`);
	const fieldConfig = {};
	const typeMap = {
		integer: "int",
		real: "float",
		text: "string",
		boolean: "bool",
		json: "json",
		enum: "enum",
		ref: "string"
	};
	for (const f of fields) fieldConfig[f.name] = {
		type: typeMap[f.type] || "string",
		label: f.label,
		description: f.description,
		enumValues: f.enumValues,
		min: f.min,
		max: f.max,
		required: !!f.notNull,
		refTable: f.refTable,
		refField: f.refField
	};
	const schema = {
		table: tableName,
		displayName,
		fields: fieldConfig
	};
	fs.writeFileSync(filePath, JSON.stringify(schema, null, 2), "utf-8");
}
/** 读取 schema 元数据（含 displayName） */
function loadSchemaMetadata(projectPath, tableName) {
	const schemaFile = path.join(projectPath, "data", "config", ".schema", `${tableName}.schema.json`);
	if (!fs.existsSync(schemaFile)) return null;
	try {
		return JSON.parse(fs.readFileSync(schemaFile, "utf-8"));
	} catch (e) {
		logger.warn(`[configService] schema 文件解析失败: ${schemaFile}`, e);
		return null;
	}
}
/**
* 验证写入值是否符合 schema 约束（enum 值、数值范围）
* 在 updateConfigRecord 和 insertConfigRecord 中调用，防止 AI 工具绕过前端写入非法数据
*/
function validateRecordValues(tableName, values, schemaFields) {
	for (const [name, value] of Object.entries(values)) {
		if (name === "rowid") continue;
		const cfg = schemaFields[name];
		if (!cfg) continue;
		if (cfg.enumValues && cfg.enumValues.length > 0 && value !== null && value !== void 0 && value !== "") {
			if (!cfg.enumValues.includes(String(value))) throw new Error(`字段 ${tableName}.${name} 的值 "${value}" 不在允许的枚举选项中: ${cfg.enumValues.join(", ")}`);
		}
		if (typeof value === "number") {
			if (cfg.min !== void 0 && value < cfg.min) throw new Error(`字段 ${tableName}.${name} 的值 ${value} 小于最小值 ${cfg.min}`);
			if (cfg.max !== void 0 && value > cfg.max) throw new Error(`字段 ${tableName}.${name} 的值 ${value} 大于最大值 ${cfg.max}`);
		}
	}
}
/**
* 验证必填字段（仅 insert 时调用）
* 检查 schema 中 required=true 的字段是否都有值
*/
function validateRequiredFields(tableName, values, schemaFields) {
	for (const [name, cfgRaw] of Object.entries(schemaFields)) if (cfgRaw.required) {
		if (!(name in values) || values[name] === null || values[name] === void 0) throw new Error(`字段 ${tableName}.${name} 是必填字段，不能为空`);
	}
}
/** 配置文件名 → 中文显示名映射 */
var CONFIG_DISPLAY_NAMES = {
	equipment: "装备配置",
	skills: "技能配置",
	pets: "宠物配置",
	mounts: "坐骑配置",
	items: "道具配置",
	quests: "任务配置",
	achievements: "成就配置",
	dungeons: "副本配置",
	guilds: "公会配置",
	rankings: "排行榜配置",
	vip: "VIP配置",
	sign_in: "签到配置",
	lottery: "抽奖配置",
	trading: "交易配置",
	titles: "称号配置",
	global: "全局参数"
};
/** 配置分类描述（按 spec 4.3 配置管理预置分类表） */
var CONFIG_DESCRIPTIONS = {
	equipment: "武器、防具、饰品的模板属性（攻击力、稀有度、套装效果）",
	skills: "主动/被动技能的倍率、冷却、伤害、目标类型",
	pets: "宠物基础属性、进化链、天赋技能",
	mounts: "坐骑速度加成、外观、等级要求",
	items: "消耗品效果、持续时间、堆叠规则",
	quests: "日常/主线/支线任务目标、奖励、重复规则",
	achievements: "成就条件、奖励、稀有度",
	dungeons: "副本入口、难度、BOSS、掉落表",
	guilds: "公会等级、资金、权限设置",
	rankings: "排行类型、刷新周期、展示数量",
	vip: "VIP 等级、价格、权益、持续时间",
	sign_in: "每日奖励、连签加成、VIP 翻倍",
	lottery: "奖池内容、概率、每日次数限制",
	trading: "交易税率、货币类型、上下架规则",
	titles: "称号属性加成、颜色、过期时间",
	global: "掉落率、经验倍率、签到基数、全局公告"
};
/**
* 列出项目中所有配置分类（.db/.sqlite/.json 文件）
* @param projectPath - 项目根路径
* @returns 配置分类数组，包含名称、文件名、表数量、显示名和描述
*/
function listConfigCategories(projectPath) {
	const configDir = path.join(projectPath, "data", "config");
	if (!fs.existsSync(configDir)) return [];
	const categories = [];
	for (const file of fs.readdirSync(configDir)) {
		const fullPath = path.join(configDir, file);
		if (!fs.statSync(fullPath).isFile()) continue;
		const ext = path.extname(file).toLowerCase();
		if (ext !== ".db" && ext !== ".sqlite" && ext !== ".json") continue;
		const baseName = path.basename(file, ext);
		let displayName = CONFIG_DISPLAY_NAMES[baseName] ?? baseName;
		const metaFile = path.join(configDir, ".meta", `${baseName}.meta.json`);
		if (fs.existsSync(metaFile)) try {
			const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
			if (meta.displayName) displayName = meta.displayName;
		} catch (e) {
			logger.warn(`[configService] meta 文件损坏: ${metaFile}`, e);
		}
		else {
			const schemaMeta = loadSchemaMetadata(projectPath, baseName);
			if (schemaMeta?.displayName) displayName = schemaMeta.displayName;
		}
		const description = CONFIG_DESCRIPTIONS[baseName];
		let tableCount = 1;
		if (ext === ".db" || ext === ".sqlite") try {
			invalidateDb(fullPath);
			tableCount = getSchema(fullPath).length;
		} catch (e) {
			logger.warn(`[configService] getSchema 失败: ${fullPath}`, e);
			tableCount = 1;
		}
		categories.push({
			name: baseName,
			file,
			tableCount,
			displayName,
			description
		});
	}
	return categories;
}
function resolveConfigFile(projectPath, category) {
	if (!CATEGORY_RE.test(category)) throw new Error(`非法配置分类名: ${category}（仅允许字母、数字、下划线）`);
	const configDir = path.join(projectPath, "data", "config");
	const exact = path.join(configDir, category);
	assertWithinProject(configDir, exact);
	if (fs.existsSync(exact)) return exact;
	for (const file of fs.readdirSync(configDir)) if (path.basename(file, path.extname(file)).toLowerCase() === category.toLowerCase()) {
		const resolved = path.join(configDir, file);
		assertWithinProject(configDir, resolved);
		return resolved;
	}
	throw new Error(`配置分类不存在: ${category}`);
}
/**
* 获取指定配置分类的表数据（分页查询）
* @param projectPath - 项目根路径
* @param category - 配置分类名
* @param page - 页码（从 1 开始）
* @param pageSize - 每页条数
* @returns 分页查询结果，包含行数据和总数
* @throws 分类不存在、分页参数非法时抛出错误
*/
function getConfigTable(projectPath, category, page, pageSize) {
	if (typeof page !== "number" || !Number.isInteger(page) || page < 1) throw new Error(`page 必须为正整数，收到: ${JSON.stringify(page)}`);
	if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1) throw new Error(`pageSize 必须为正整数，收到: ${JSON.stringify(pageSize)}`);
	const filePath = resolveConfigFile(projectPath, category);
	if (filePath.endsWith(".json")) {
		const raw = fs.readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		const rows = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => ({
			key: k,
			value: v
		}));
		const total = rows.length;
		const start = (page - 1) * pageSize;
		return {
			rows: rows.slice(start, start + pageSize),
			total
		};
	}
	const schemas = getSchema(filePath);
	if (schemas.length > 0) {
		const target = schemas.find((s) => s.name.toLowerCase() === category.toLowerCase()) ?? schemas[0];
		const result = queryTable(filePath, target.name, page, pageSize);
		if (result.total === 0) {
			invalidateDb(filePath);
			return queryTable(filePath, target.name, page, pageSize);
		}
		return result;
	}
	const tables = getDb(filePath).prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
	if (tables.length === 0) return {
		rows: [],
		total: 0
	};
	return queryTable(filePath, tables[0].name, page, pageSize);
}
/**
* 获取指定配置分类的表结构 Schema
* @param projectPath - 项目根路径
* @param category - 配置分类名
* @returns 表结构数组，JSON 文件返回空数组
*/
function getConfigSchema(projectPath, category) {
	const filePath = resolveConfigFile(projectPath, category);
	if (filePath.endsWith(".json")) return [];
	invalidateDb(filePath);
	return getSchema(filePath);
}
/**
* 更新配置表中的指定记录
* @param projectPath - 项目根路径
* @param category - 配置分类名
* @param rowid - 记录行号（正整数）
* @param changes - 要更新的字段键值对
* @throws rowid 非法、分类不存在、字段值违反 schema 约束时抛出错误
*/
function updateConfigRecord(projectPath, category, rowid, changes) {
	if (typeof rowid !== "number" || !Number.isInteger(rowid) || rowid <= 0) throw new Error(`rowid 必须为正整数，收到: ${JSON.stringify(rowid)}`);
	const filePath = resolveConfigFile(projectPath, category);
	if (filePath.endsWith(".json")) {
		const raw = fs.readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		if (Array.isArray(data)) {
			const row = data.find((r) => r.rowid === rowid || r.id === rowid);
			if (row) Object.assign(row, changes);
		} else for (const [k, v] of Object.entries(changes)) data[k] = v;
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
		return;
	}
	const schemas = getSchema(filePath);
	if (schemas.length > 0) {
		const schemaMeta = loadSchemaMetadata(projectPath, category);
		if (schemaMeta?.fields) validateRecordValues(category, changes, schemaMeta.fields);
		updateRecord(filePath, schemas[0].name, rowid, changes);
	}
}
/**
* 向配置表插入新记录
* @param projectPath - 项目根路径
* @param category - 配置分类名
* @param values - 要插入的字段键值对
* @returns 新记录的 rowid（JSON 文件返回数组索引）
* @throws 必填字段缺失、字段值违反 schema 约束时抛出错误
*/
function insertConfigRecord(projectPath, category, values) {
	const filePath = resolveConfigFile(projectPath, category);
	if (filePath.endsWith(".json")) {
		const raw = fs.readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		if (Array.isArray(data)) {
			data.push(values);
			fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
			return data.length - 1;
		}
		return 0;
	}
	const schemas = getSchema(filePath);
	if (schemas.length > 0) {
		const schemaMeta = loadSchemaMetadata(projectPath, category);
		if (schemaMeta?.fields) {
			validateRequiredFields(category, values, schemaMeta.fields);
			validateRecordValues(category, values, schemaMeta.fields);
		}
		return insertRecord(filePath, schemas[0].name, values);
	}
	return 0;
}
/**
* 删除配置表中的指定记录
* @param projectPath - 项目根路径
* @param category - 配置分类名
* @param rowid - 记录行号（正整数）
* @throws rowid 非法、分类不存在时抛出错误
*/
function deleteConfigRecord(projectPath, category, rowid) {
	if (typeof rowid !== "number" || !Number.isInteger(rowid) || rowid <= 0) throw new Error(`rowid 必须为正整数，收到: ${JSON.stringify(rowid)}`);
	const filePath = resolveConfigFile(projectPath, category);
	if (filePath.endsWith(".json")) return;
	const schemas = getSchema(filePath);
	if (schemas.length > 0) deleteRecord(filePath, schemas[0].name, rowid);
}
/** 创建新配置表 */
function createConfigTable(projectPath, displayName, fields) {
	if (!fields || fields.length === 0) throw new Error("至少需要定义一个字段");
	const idField = fields.find((f) => f.name.toLowerCase() === "id");
	const hasIdPrimaryKey = idField && (idField.type === "integer" || idField.type === "real");
	const tableName = toPinyinTableName(displayName);
	if (!CATEGORY_RE.test(tableName)) throw new Error(`生成的表名不合法: ${tableName}`);
	const configDir = path.join(projectPath, "data", "config");
	if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
	const filePath = path.join(configDir, `${tableName}.db`);
	if (fs.existsSync(filePath)) throw new Error(`表已存在: ${tableName}.db`);
	const columnDefs = [];
	if (!hasIdPrimaryKey) columnDefs.push("\"id\" INTEGER PRIMARY KEY AUTOINCREMENT");
	else if (idField) {
		const idIdx = fields.indexOf(idField);
		const idDef = { ...idField };
		fields.splice(idIdx, 1);
		columnDefs.push(`"${idDef.name}" INTEGER PRIMARY KEY AUTOINCREMENT`);
	}
	for (const f of fields) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) throw new Error(`非法字段名: ${f.name}`);
		columnDefs.push(fieldToColumnSql(f));
	}
	const db = getOrCreateDb(filePath);
	const sql = `CREATE TABLE "${tableName}" (\n  ${columnDefs.join(",\n  ")}\n)`;
	db.exec(sql);
	ensureIndexes(filePath);
	saveSchemaMetadata(projectPath, tableName, displayName, idField ? [idField, ...fields] : fields);
	saveDisplayName(projectPath, tableName, displayName);
	return {
		tableName,
		filePath
	};
}
/** 删除整张配置表（含 .db 文件和 schema 元数据） */
function dropConfigTable(projectPath, category) {
	if (!CATEGORY_RE.test(category)) throw new Error(`非法配置分类名: ${category}`);
	const configDir = path.join(projectPath, "data", "config");
	const candidateExts = [
		".db",
		".sqlite",
		".json"
	];
	let deleted = false;
	for (const ext of candidateExts) {
		const filePath = path.join(configDir, category + ext);
		if (fs.existsSync(filePath)) {
			assertWithinProject(configDir, filePath);
			fs.unlinkSync(filePath);
			deleted = true;
		}
	}
	if (!deleted) throw new Error(`配置表不存在: ${category}`);
	const schemaFile = path.join(configDir, ".schema", `${category}.schema.json`);
	if (fs.existsSync(schemaFile)) {
		assertWithinProject(configDir, schemaFile);
		fs.unlinkSync(schemaFile);
	}
	const metaFile = path.join(configDir, ".meta", `${category}.meta.json`);
	if (fs.existsSync(metaFile)) {
		assertWithinProject(configDir, metaFile);
		fs.unlinkSync(metaFile);
	}
}
/**
* 重命名配置表 —— **只改显示名（给人看的中文名）**，不动文件名、不动 SQLite 表名、不丢数据。
*
* ## 为什么必须只改显示名（实测事故）
*
* 原来这个函数会把 `drops.db` 改名成 `diaoluo.db`（按拼音）并把 SQLite 表名一起改掉。
* 后果：**流程里的配置绑定写死了 `dbPath: 'data/config/drops.db'`** ——
* 文件一改名，绑定就指向不存在的文件，读表**静默为空**（`/打怪` 再也不掉落，但不报错）。
* 而界面上这个入口在「设计表结构」里的输入框叫「表中文名」、按钮叫「重命名表」，
* 用户以为只是改个显示名 —— **实现超出了它承诺的范围，代价是悄悄弄断流程**。
*
* ## 分工
*
* - 本函数：`displayName` 变了，`.schema` / `.meta` 里的显示名跟着变，`table` 与文件名**不变**；
* - {@link renameConfigFile}：真的要把库文件与表名搬走时用它 —— 那是**危险操作**
*   （必须同步改掉所有引用 `dbPath` 的地方），所以保留成显式的独立入口，不再由"重命名"顺手做。
*/
function renameConfigTable(projectPath, oldCategory, newDisplayName) {
	if (!CATEGORY_RE.test(oldCategory)) throw new Error(`非法旧表名: ${oldCategory}`);
	const displayName = newDisplayName.trim();
	if (!displayName) throw new Error("表中文名不能为空");
	const configDir = path.join(projectPath, "data", "config");
	resolveConfigFile(projectPath, oldCategory);
	const schemaFile = path.join(configDir, ".schema", `${oldCategory}.schema.json`);
	if (fs.existsSync(schemaFile)) try {
		const data = JSON.parse(fs.readFileSync(schemaFile, "utf-8"));
		data.displayName = displayName;
		fs.writeFileSync(schemaFile, JSON.stringify(data, null, 2), "utf-8");
	} catch (e) {
		logger.warn(`[configService] schema 文件损坏，重建: ${schemaFile}`, e);
		saveDisplayName(projectPath, oldCategory, displayName);
	}
	else saveDisplayName(projectPath, oldCategory, displayName);
	const metaFile = path.join(configDir, ".meta", `${oldCategory}.meta.json`);
	if (fs.existsSync(metaFile)) try {
		const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
		meta.displayName = displayName;
		fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf-8");
	} catch (e) {
		logger.warn(`[configService] meta 文件损坏，重建: ${metaFile}`, e);
		saveDisplayName(projectPath, oldCategory, displayName);
	}
	else saveDisplayName(projectPath, oldCategory, displayName);
	return {
		oldName: oldCategory,
		newName: oldCategory
	};
}
/**
* 修改表结构：增加字段、删除字段（重建迁移）、修改字段元数据
* 注意：SQLite ALTER TABLE 只支持 ADD COLUMN，删字段需要重建表+迁移数据
*/
function alterConfigTable(projectPath, category, options) {
	if (!CATEGORY_RE.test(category)) throw new Error(`非法配置分类名: ${category}`);
	const filePath = resolveConfigFile(projectPath, category);
	if (!filePath.endsWith(".db") && !filePath.endsWith(".sqlite")) throw new Error("仅支持 SQLite 表的表结构修改");
	const addFields = options.addFields ?? [];
	const dropFields = options.dropFields ?? [];
	const updateFields = options.updateFields ?? [];
	const result = {
		addedFields: [],
		droppedFields: [],
		migratedRows: 0,
		rebuilt: false
	};
	if (addFields.length > 0) {
		const db = getDb(filePath);
		for (let f of addFields) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) throw new Error(`非法字段名: ${f.name}`);
			if (f.notNull && (f.defaultValue === void 0 || f.defaultValue === null || f.defaultValue === "")) f = {
				...f,
				defaultValue: getSmartDefaultValue(f.type, f.enumValues)
			};
			const colDef = fieldToColumnSql(f);
			db.exec(`ALTER TABLE "${category}" ADD COLUMN ${colDef}`);
			result.addedFields.push(f.name);
		}
	}
	if (dropFields.length > 0) {
		const db = getDb(filePath);
		const columns = db.prepare(`PRAGMA table_info("${category}")`).all();
		const dropSet = new Set(dropFields);
		const keepColumns = columns.filter((c) => !dropSet.has(c.name));
		if (keepColumns.length === 0) throw new Error("不能删除所有字段，至少保留一个");
		const keepColNames = keepColumns.map((c) => `"${c.name}"`).join(", ");
		const oldRows = db.prepare(`SELECT ${keepColNames} FROM "${category}"`).all();
		result.migratedRows = oldRows.length;
		const newColumnDefs = [];
		for (const c of keepColumns) {
			let colDef = `"${c.name}" ${c.type || "TEXT"}`;
			if (c.pk) colDef += " PRIMARY KEY";
			if (c.notnull) colDef += " NOT NULL";
			if (c.dflt_value !== null && c.dflt_value !== void 0) colDef += ` DEFAULT ${c.dflt_value}`;
			newColumnDefs.push(colDef);
		}
		db.transaction(() => {
			db.exec(`DROP TABLE "${category}"`);
			db.exec(`CREATE TABLE "${category}" (\n  ${newColumnDefs.join(",\n  ")}\n)`);
			if (oldRows.length > 0) {
				const placeholders = keepColumns.map(() => "?").join(", ");
				const insertSql = `INSERT INTO "${category}" (${keepColNames}) VALUES (${placeholders})`;
				const stmt = db.prepare(insertSql);
				for (const row of oldRows) stmt.run(...keepColumns.map((c) => row[c.name]));
			}
		})();
		result.droppedFields = [...dropFields];
		result.rebuilt = true;
		ensureIndexes(filePath);
	}
	const oldMeta = loadSchemaMetadata(projectPath, category);
	const oldFields = oldMeta?.fields ?? {};
	for (const dropName of dropFields) delete oldFields[dropName];
	const allFields = [...addFields, ...updateFields];
	const typeMap = {
		integer: "int",
		real: "float",
		text: "string",
		boolean: "bool",
		json: "json",
		enum: "enum",
		ref: "string"
	};
	for (const f of allFields) oldFields[f.name] = {
		type: typeMap[f.type] || "string",
		label: f.label,
		description: f.description,
		enumValues: f.enumValues,
		min: f.min,
		max: f.max,
		required: !!f.notNull,
		refTable: f.refTable,
		refField: f.refField
	};
	const schemaDir = path.join(projectPath, "data", "config", ".schema");
	if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true });
	const schemaFile = path.join(schemaDir, `${category}.schema.json`);
	const newSchema = {
		table: category,
		displayName: oldMeta?.displayName ?? category,
		fields: oldFields
	};
	fs.writeFileSync(schemaFile, JSON.stringify(newSchema, null, 2), "utf-8");
	return result;
}
/** 保存 displayName 到 .meta/{table}.meta.json */
function saveDisplayName(projectPath, tableName, displayName) {
	const metaDir = path.join(projectPath, "data", "config", ".meta");
	if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true });
	const metaFile = path.join(metaDir, `${tableName}.meta.json`);
	fs.writeFileSync(metaFile, JSON.stringify({
		table: tableName,
		displayName
	}, null, 2), "utf-8");
}

export { CATEGORY_RE, toPinyinTableName, getSmartDefaultValue, fieldToColumnSql, saveSchemaMetadata, loadSchemaMetadata, validateRecordValues, validateRequiredFields, CONFIG_DISPLAY_NAMES, CONFIG_DESCRIPTIONS, listConfigCategories, resolveConfigFile, getConfigTable, getConfigSchema, updateConfigRecord, insertConfigRecord, deleteConfigRecord, createConfigTable, dropConfigTable, renameConfigTable, alterConfigTable, saveDisplayName };
