// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import better_sqlite3 from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { getMergedSchema, init_schemaService } from "./schemaService";
import { __exportAll } from "../../../shared/runtime/rolldownShim";
import { init_logger, logger } from "../infra/logger";

var dataService_exports = /* @__PURE__ */ __exportAll({
	closeAllConnectionsForTesting: () => closeAllConnectionsForTesting,
	closeConnectionsUnder: () => closeConnectionsUnder,
	deletePlayer: () => deletePlayer,
	deleteRecord: () => deleteRecord,
	ensureIndexes: () => ensureIndexes,
	getDb: () => getDb,
	getOrCreateDb: () => getOrCreateDb,
	getRecord: () => getRecord,
	getSchema: () => getSchema,
	insertRecord: () => insertRecord,
	invalidateDb: () => invalidateDb,
	listDataSources: () => listDataSources,
	listPlayers: () => listPlayers,
	mergePlayers: () => mergePlayers,
	queryPlayerTables: () => queryPlayerTables,
	queryTable: () => queryTable,
	saveSchema: () => saveSchema,
	searchPlayer: () => searchPlayer,
	setDbCtorForTesting: () => setDbCtorForTesting,
	updateRecord: () => updateRecord
});
/**
* 在开发环境下记录慢查询（>100ms），使用 logger.debug 避免污染生产日志。
* 生产环境（NODE_ENV === 'production'）下完全静默，零开销。
*/
function logSlowQuery(sql, durationMs) {
	if (IS_DEV && durationMs > SLOW_QUERY_THRESHOLD_MS) {
		const compactSql = sql.replace(/\s+/g, " ").trim().slice(0, 200);
		logger.debug(`[slow-query] ${durationMs}ms | ${compactSql}`);
	}
}
/**
* 将连接加入连接池。如果池已满，先按 LRU 策略淘汰并关闭最久未使用的连接。
*/
function addToPool(filePath, db) {
	if (dbPool.size >= DB_POOL_MAX_SIZE) {
		let oldestKey = null;
		let oldestTime = Infinity;
		for (const [key, entry] of dbPool) if (entry.lastUsed < oldestTime) {
			oldestTime = entry.lastUsed;
			oldestKey = key;
		}
		if (oldestKey !== null) {
			const evicted = dbPool.get(oldestKey);
			if (evicted) try {
				evicted.db.close();
			} catch {}
			dbPool.delete(oldestKey);
		}
	}
	dbPool.set(filePath, {
		db,
		lastUsed: Date.now()
	});
}
/**
* 获取（或创建）指定数据库文件的缓存连接，替代每次 `new Database(filePath)`。
*
* 每次调用会更新 lastUsed 时间戳用于 LRU 淘汰。当缓存大小达到 DB_POOL_MAX_SIZE 时，
* 淘汰并关闭最久未使用的连接。所有连接以读写模式打开（原 readonly 查询改用读写连接
* 是安全的：better-sqlite3 同步且单进程，无并发问题；且 ensureIndexes 已先以读写模式
* 打开同一文件）。
*
* 文件必须已存在，否则抛出错误（避免意外创建空 db 文件）。
* 需要首次创建数据库文件的场景请使用 {@link getOrCreateDb}。
*/
function getDb(filePath) {
	const cached = dbPool.get(filePath);
	if (cached) {
		cached.lastUsed = Date.now();
		return cached.db;
	}
	if (!fs.existsSync(filePath)) throw new Error(`数据库文件不存在: ${filePath}`);
	const db = createDb(filePath);
	addToPool(filePath, db);
	return db;
}
function createDb(filePath) {
	const db = dbCtorOverride ? new dbCtorOverride(filePath) : new better_sqlite3(filePath);
	applyOpenPragmas(db);
	return db;
}
/**
* 打开连接时统一应用的 PRAGMA。
*
* 2026-10-18 补（计划里的 RT-20）：本项目四类库（state / persistent / config / audit）
* 里只有 persistentStore、databaseWrite、baseSqliteStore 开了 WAL，而「配置管理」「审计」
* 这两个库走的正是 dataService.createDb —— 于是 `backupService.ts` 里"本项目库都是 WAL"
* 的假设对它们不成立（备份/恢复行为在这种库上会不一致）。
*
* 放在**唯一打开点**而不是各调用方：新增一类库不用再记得补 pragma。
* 失败不抛：只读库（历史 `messages.db`）设 WAL 可能被拒绝，那不是致命错误。
*/
function applyOpenPragmas(db) {
	try {
		db.pragma("journal_mode = WAL");
		db.pragma("busy_timeout = 5000");
	} catch (e) {
		logger.debug("[dataService] 设置 PRAGMA 失败（连接仍可用）:", e);
	}
}
/** 仅供测试：替换底层 SQLite 打开方式（传 null 恢复真实实现） */
function setDbCtorForTesting(ctor) {
	dbCtorOverride = ctor;
}
/**
* 获取（或创建）指定数据库文件的缓存连接，允许首次创建数据库文件。
*
* 与 {@link getDb} 的区别：如果文件不存在，better-sqlite3 会自动创建空数据库文件，
* 适用于需要首次创建数据库的场景（如审计日志、配置表初始化）。
*
* @param filePath 数据库文件路径。调用方需自行确保父目录存在。
* @param initFn 可选的初始化回调，仅在首次创建连接时执行（如 CREATE TABLE IF NOT EXISTS）。
*               缓存命中时不执行（表已存在），保证幂等。
*/
function getOrCreateDb(filePath, initFn: ((db: any) => void) | null = null) {
	const cached = dbPool.get(filePath);
	if (cached) {
		cached.lastUsed = Date.now();
		return cached.db;
	}
	const db = createDb(filePath);
	if (initFn) initFn(db);
	addToPool(filePath, db);
	return db;
}
/**
* 关闭连接池中所有连接。在进程退出时调用，避免资源泄漏。
*/
function closeAllConnections() {
	for (const [, entry] of dbPool) try {
		entry.db.close();
	} catch {}
	dbPool.clear();
}
/**
* 从连接池中移除并关闭指定 filePath 的连接。
*
* 在表结构变更（如 saveSchema）等场景调用，避免后续查询复用过期连接
* （旧连接可能持有基于旧 schema 的 prepared statement 缓存）。
*/
function invalidateDb(filePath) {
	const entry = dbPool.get(filePath);
	if (entry) {
		try {
			entry.db.close();
		} catch {}
		dbPool.delete(filePath);
	}
}
/** 路径归一化：Windows 盘符/目录名大小写不敏感，比较归属时统一小写 */
function normPath(p) {
	const abs = path.resolve(p);
	return process.platform === "win32" ? abs.toLowerCase() : abs;
}
/**
* 关闭**属于某个项目**的连接（删除项目前必须调用）。
*
* 与 `persistentStore.closeDbUnder` 配套、同一个缺陷的两半（2026-09-26 实测）：
* 连接池按库文件路径缓存，项目跑过一次就会攥着 `{项目}/data/...` 下的库文件句柄，
* Windows 上随后 `rm` 项目目录会抛 `EBUSY: resource busy or locked`。
*
* 只关落在这个项目目录下的连接 —— 同时跑多个 bot 时不会误伤别的项目。
*
* @returns 实际关闭的连接数（0 是正常情况）
*/
function closeConnectionsUnder(projectDir) {
	const prefix = normPath(projectDir) + path.sep;
	let closed = 0;
	for (const key of [...dbPool.keys()]) {
		if (!normPath(key).startsWith(prefix)) continue;
		const entry = dbPool.get(key);
		try {
			entry?.db.close();
		} catch {}
		dbPool.delete(key);
		closed++;
	}
	return closed;
}
/**
* 仅供测试：立刻关掉连接池里的所有连接。
*
* 真实进程靠上面的 `exit` / `before-quit` 兜底，但**测试里进程不会退出** ——
* 连接池会一直攥着 SQLite 文件句柄，Windows 上随后删临时目录就报
* `EBUSY: resource busy or locked`。用例的 afterEach 调它即可。
*/
function closeAllConnectionsForTesting() {
	closeAllConnections();
}
function assertIdentifier(name, label) {
	if (!IDENTIFIER_RE.test(name)) throw new Error(`非法${label}: ${name}（仅允许字母、数字、下划线，且不以数字开头）`);
}
/** 校验对象的所有键均为合法 SQL 标识符 */
function assertKeysIdentifiers(obj, label) {
	for (const k of Object.keys(obj)) assertIdentifier(k, label);
}
/** 扫描 data/players/ 目录下所有数据文件 */
function listDataSources(projectPath) {
	const dataDir = path.join(projectPath, "data", "players");
	if (!fs.existsSync(dataDir)) return [];
	const result = [];
	for (const file of fs.readdirSync(dataDir)) {
		const fullPath = path.join(dataDir, file);
		if (!fs.statSync(fullPath).isFile()) continue;
		const ext = path.extname(file).toLowerCase();
		if (ext === ".db" || ext === ".sqlite") result.push({
			name: file,
			path: fullPath,
			format: "sqlite"
		});
		else if (ext === ".json") result.push({
			name: file,
			path: fullPath,
			format: "json"
		});
		else if (ext === ".yaml" || ext === ".yml") result.push({
			name: file,
			path: fullPath,
			format: "yaml"
		});
	}
	return result;
}
function fieldConfigToFieldSchema(name, cfg) {
	const withRef = cfg;
	return {
		name,
		type: String(cfg.type),
		label: cfg.label,
		options: cfg.enumValues,
		min: cfg.min,
		max: cfg.max,
		refTable: withRef.refTable,
		refField: withRef.refField
	};
}
function getSchema(filePath) {
	const schemaDir = path.join(path.dirname(filePath), ".schema");
	let schemas;
	if (fs.existsSync(schemaDir)) schemas = getMergedSchema(filePath, schemaDir).map((m) => ({
		name: m.table,
		fields: Object.entries(m.fields).map(([name, cfg]) => fieldConfigToFieldSchema(name, cfg))
	}));
	else {
		const db = getDb(filePath);
		schemas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => {
			const fields = db.prepare(`PRAGMA table_info("${t.name}")`).all().map((col) => {
				const sqlType = col.type.toUpperCase();
				let inferredType = "string";
				if (sqlType.includes("INT")) inferredType = "int";
				else if (sqlType.includes("REAL") || sqlType.includes("FLOAT") || sqlType.includes("NUM")) inferredType = "float";
				else if (sqlType.includes("TEXT") || sqlType.includes("CHAR")) inferredType = "text";
				else if (sqlType.includes("BOOL")) inferredType = "bool";
				return {
					name: col.name,
					type: inferredType
				};
			});
			return {
				name: t.name,
				fields
			};
		});
	}
	mergeEnumOptionsFromConfigSchema(filePath, schemas);
	return schemas;
}
/**
* 从 data/config/.schema/ 元数据文件加载 enumValues，合并到 FieldSchema.options
*
* 元数据文件由 configService.saveSchemaMetadata 写入，路径为
* <project>/data/config/.schema/{tableName}.schema.json，格式为：
* { table, displayName, fields: { [name]: { type, label, enumValues, ... } } }
*
* 现有 schema 加载逻辑查找的是 path.dirname(filePath)/.schema（通常是 data/players/.schema），
* 不会读取 data/config/.schema，因此 PRAGMA 回退路径返回的 FieldSchema 缺少 enum 选项。
* 本函数在 getSchema 末尾补充合并 enumValues，仅在 options 未设置时填充，避免覆盖已有数据。
*/
function mergeEnumOptionsFromConfigSchema(filePath, schemas) {
	let dataDir = null;
	let current = path.dirname(filePath);
	for (let i = 0; i < 3; i++) {
		if (path.basename(current) === "data") {
			dataDir = current;
			break;
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	if (!dataDir) return;
	const configSchemaDir = path.join(dataDir, "config", ".schema");
	if (!fs.existsSync(configSchemaDir)) return;
	for (const schema of schemas) {
		const schemaFile = path.join(configSchemaDir, `${schema.name}.schema.json`);
		if (!fs.existsSync(schemaFile)) continue;
		try {
			const content = fs.readFileSync(schemaFile, "utf-8");
			const def = JSON.parse(content);
			if (!def.fields) continue;
			for (const field of schema.fields) {
				const cfg = def.fields[field.name];
				const enumVals = cfg?.enumValues ?? cfg?.options;
				if (enumVals && enumVals.length > 0) {
					if (!field.options || field.options.length === 0) field.options = enumVals;
				}
				if (cfg?.refTable) {
					field.refTable = cfg.refTable;
					field.refField = cfg.refField;
				}
			}
		} catch (e) {
			logger.warn(`[dataService] schema 文件解析失败: ${schemaFile}`, e);
		}
	}
}
/**
* 把查询结果里的 rowid 归一成**调用方约定的 `rowid` 键**。
*
* ## 为什么必须有这个（实测踩到的真故障）
*
* SQL 里写 `SELECT rowid, * FROM t`，当表里有 `id INTEGER PRIMARY KEY` 时
* （本项目的配置表、玩家表**全都是**这个形状，`id` 就是 rowid 的别名），
* **`rowid` 这个名字会被 `id` 撞掉**，结果对象里根本没有 `rowid` 键：
*
* ```
* SELECT rowid, *              -> 键 [id, monster_name, item_name, chance]   ← rowid 丢了
* SELECT rowid AS _rid, *      -> 键 [_rid, id, monster_name, ...]           ← 换个名字就有
* ```
*
* 后果不是报错，而是**界面上的"编辑/删除"永远保存不了**：
* 渲染层读 `row.rowid` 拿到 `undefined`，IPC 的 zod 校验报
* `expected number, received undefined`（而且 `path:[2]` 指到 category，看着像别的问题）。
*
* 所以约定：SQL 统一用 `rowid AS _rid` 取，出结果前用本函数归一成 `rowid`，
* 并把 `_rid` 从行里删掉（它是内部别名，不该泄漏到界面）。
* **不要**把 SQL 改回 `SELECT rowid, *`，也不要删这个函数。
*/
function withRowIdAlias(rows) {
	for (const row of rows) if ("_rid" in row) {
		row.rowid = row._rid;
		delete row._rid;
	}
	return rows;
}
/**
* 查询表数据（分页）。
*
* 支持两种分页模式：
* 1. 传统 OFFSET 分页（默认，向后兼容）：传入 page 和 pageSize，使用 LIMIT/OFFSET
* 2. Keyset 分页（高性能）：额外传入 cursor（上一页最后一行的 rowid），
*    使用 WHERE rowid > cursor ORDER BY rowid ASC LIMIT pageSize，避免大偏移量全表扫描
*
* 返回结果中包含 nextCursor 字段：
* - 当本页结果数 === pageSize 时，nextCursor = 最后一行的 rowid（可能还有下一页）
* - 当本页结果数 < pageSize 时，nextCursor = null（已到末页）
* - 旧调用方可忽略 nextCursor，行为完全不变
*
* @param cursor 可选，上一页最后一行的 rowid。传入后启用 keyset 分页，忽略 page 参数
*/
function queryTable(filePath, tableName, page, pageSize, cursor: number | null = null) {
	assertIdentifier(tableName, "表名");
	ensureIndexes(filePath);
	const db = getDb(filePath);
	const startTotal = Date.now();
	const total = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c;
	logSlowQuery(`SELECT COUNT(*) as c FROM "${tableName}"`, Date.now() - startTotal);
	let rows;
	// 注意：cursor 的默认是 null，而 `null >= 0` 在 JS 里是 true —— 只判 undefined 会让
// 「不传 cursor」也走进 keyset 分支，SQL 里 `rowid > NULL` 恒为空，整页数据消失。
// 这是 10/18 构建里的真实 bug（产物 index.js:406331 同样是这个写法），10/20 之后修好。
if (cursor !== void 0 && cursor !== null && cursor >= 0) {
		const startQuery = Date.now();
		rows = db.prepare(`SELECT rowid AS _rid, * FROM "${tableName}" WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`).all(cursor, pageSize);
		logSlowQuery(`SELECT rowid AS _rid, * FROM "${tableName}" WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`, Date.now() - startQuery);
	} else {
		const startQuery = Date.now();
		rows = db.prepare(`SELECT rowid AS _rid, * FROM "${tableName}" LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
		logSlowQuery(`SELECT rowid AS _rid, * FROM "${tableName}" LIMIT ? OFFSET ?`, Date.now() - startQuery);
	}
	withRowIdAlias(rows);
	let nextCursor = null;
	if (rows.length === pageSize && rows.length > 0) nextCursor = rows[rows.length - 1].rowid ?? null;
	return {
		rows,
		total,
		nextCursor
	};
}
function updateRecord(filePath, tableName, rowid, changes) {
	assertIdentifier(tableName, "表名");
	const db = getDb(filePath);
	const columnChanges = {};
	for (const [k, v] of Object.entries(changes)) {
		if (k === "rowid" || k === "_rid") continue;
		columnChanges[k] = v;
	}
	if (Object.keys(columnChanges).length === 0) throw new Error("没有可更新的字段（changes 里全是 rowid/_rid 这类伪列）");
	assertKeysIdentifiers(columnChanges, "列名");
	const sets = Object.keys(columnChanges).map((k) => `"${k}" = @${k}`).join(", ");
	db.prepare(`UPDATE "${tableName}" SET ${sets} WHERE rowid = @rowid`).run({
		...columnChanges,
		rowid
	});
}
function insertRecord(filePath, tableName, values) {
	assertIdentifier(tableName, "表名");
	assertKeysIdentifiers(values, "列名");
	const db = getDb(filePath);
	const keys = Object.keys(values);
	const columns = keys.map((k) => `"${k}"`).join(", ");
	const placeholders = keys.map((k) => `@${k}`).join(", ");
	const result = db.prepare(`INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`).run(values);
	return Number(result.lastInsertRowid);
}
/** 查询某个玩家在指定数据源中的所有表数据（按 QQ 号匹配） */
function queryPlayerTables(filePath, qq) {
	ensureIndexes(filePath);
	const result = [];
	const db = getDb(filePath);
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
	for (const t of tables) {
		const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all();
		const qqCol = columns.find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
		if (!qqCol) continue;
		const startQuery = Date.now();
		const rows = db.prepare(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE "${qqCol.name}" = ?`).all(qq);
		logSlowQuery(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE "${qqCol.name}" = ?`, Date.now() - startQuery);
		withRowIdAlias(rows);
		const fields = columns.map((col) => {
			const sqlType = col.type.toUpperCase();
			let inferredType = "string";
			if (sqlType.includes("INT")) inferredType = "int";
			else if (sqlType.includes("REAL") || sqlType.includes("FLOAT") || sqlType.includes("NUM")) inferredType = "float";
			else if (sqlType.includes("TEXT") || sqlType.includes("CHAR")) inferredType = "text";
			else if (sqlType.includes("BOOL")) inferredType = "bool";
			return {
				name: col.name,
				type: inferredType
			};
		});
		result.push({
			table: t.name,
			fields,
			rows
		});
	}
	return result;
}
/**
* 归档旧备份：保留**最近 keep 份** `<db>.bak-*`，更早的**移动**到 `<数据目录>/.backups/`。
*
* 为什么不是删除：备份是"后悔药"，删掉等于没有；归档既让目录干净、又可随时捞回。
* 实测（2026-10-03）：一个真实项目的 `data/players/` 里躺了十几个 `.bak-*` 文件。
*
* 排序用 **mtime** 而不是文件名：文件名里有 `basedata-…` 这种非时间戳的变体，
* 字典序会把它们排到最新（那样就会误留旧的、归档新的）。
*/
function archiveOldBackups(fullPath, keep = BACKUP_KEEP) {
	const dir = path.dirname(fullPath);
	const base = path.basename(fullPath);
	let entries;
	try {
		entries = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.bak-`));
	} catch {
		return 0;
	}
	if (entries.length <= keep) return 0;
	const withTime = entries.map((f) => {
		const p = path.join(dir, f);
		let mtime = 0;
		try {
			mtime = fs.statSync(p).mtimeMs;
		} catch {}
		return {
			f,
			p,
			mtime
		};
	});
	withTime.sort((a, b) => b.mtime - a.mtime);
	const toArchive = withTime.slice(keep);
	const archiveDir = path.join(dir, BACKUP_ARCHIVE_DIR);
	let moved = 0;
	for (const it of toArchive) try {
		fs.mkdirSync(archiveDir, { recursive: true });
		fs.renameSync(it.p, path.join(archiveDir, it.f));
		moved++;
	} catch {}
	return moved;
}
/**
* 把 `fromUid` 的**全部存档**并进 `toUid`（跨所有数据源）。
*
* ## 什么时候用
* 身份解析发现"同一个人被拆成了两个 uid"时（见 `shared/domain/playerIdentity.ts`）：
* 例如先在 A 群以 `member_openid_A` 建了 uid 10000，又在 B 群以 `member_openid_B` 建了 10001，
* 后来某次事件同时带上了 `user_openid`，于是能确认两者是同一个人。
*
* ## 冲突怎么办
* 同一个字段两边都有值时，**保留 `toUid`（存活者）的值**，源行的那条**删除**并记入 `discarded`。
*
* ⚠️ 为什么必须**删掉**源行、不能"留着不管"：留着的话旧 uid 在 `_persistent` 里还有数据，
* 于是面板上"同一个人的两份存档"里的那一份**根本不会消失** —— 合并看起来成功了，实际上没合。
* （这是测试抓出来的：一开始实现成"跳过"，测试断言"旧归属不残留"直接红了。）
*
* 为什么不取"更新的那个值"：这里拿不到可靠的逐字段时间戳（只有信封里的 expire_at），
* 猜错的代价比"少一条"更大。**原值不会丢** —— 合并前对整个库做了备份。
*/
async function mergePlayers(projectPath, fromUid, toUid) {
	const dataDir = path.join(projectPath, "data", "players");
	if (fromUid === toUid || !fs.existsSync(dataDir)) return {
		moved: 0,
		discarded: 0,
		backups: []
	};
	let moved = 0;
	let discarded = 0;
	const backups = [];
	for (const file of fs.readdirSync(dataDir)) {
		const ext = path.extname(file).toLowerCase();
		if (ext !== ".db" && ext !== ".sqlite") continue;
		const fullPath = path.join(dataDir, file);
		const db = getDb(fullPath);
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
		let hasFrom = false;
		const plans = [];
		for (const t of tables) {
			const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all();
			const col = columns.find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
			if (!col) continue;
			if (db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}" WHERE "${col.name}" = ?`).get(fromUid).c > 0) {
				hasFrom = true;
				plans.push({
					table: t.name,
					col: col.name,
					hasKeyCol: columns.some((c) => c.name === "key")
				});
			}
		}
		if (!hasFrom) continue;
		const backupPath = `${fullPath}.bak-merge-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
		try {
			await db.backup(backupPath);
			backups.push(backupPath);
		} catch (e) {
			throw new Error(`备份失败，已中止合并（${file}）: ${e instanceof Error ? e.message : String(e)}`);
		}
		const r = db.transaction((items) => {
			let m = 0;
			let s = 0;
			for (const it of items) if (it.hasKeyCol) {
				const rows = db.prepare(`SELECT rowid, key FROM "${it.table}" WHERE "${it.col}" = ?`).all(fromUid);
				for (const row of rows) {
					const newKey = String(row.key).replace(new RegExp(`^([A-Za-z]+)_${fromUid}:`), `$1_${toUid}:`);
					if (newKey !== row.key ? db.prepare(`SELECT 1 FROM "${it.table}" WHERE key = ? LIMIT 1`).get(newKey) : void 0) {
						db.prepare(`DELETE FROM "${it.table}" WHERE rowid = ?`).run(row.rowid);
						s++;
						continue;
					}
					db.prepare(`UPDATE "${it.table}" SET key = ?, "${it.col}" = ? WHERE rowid = ?`).run(newKey, toUid, row.rowid);
					m++;
				}
			} else {
				const info = db.prepare(`UPDATE "${it.table}" SET "${it.col}" = ? WHERE "${it.col}" = ?`).run(toUid, fromUid);
				m += Number(info.changes ?? 0);
			}
			return {
				m,
				s
			};
		})(plans);
		moved += r.m;
		discarded += r.s;
	}
	return {
		moved,
		discarded,
		backups
	};
}
/**
* 删除某个玩家的**全部存档数据**（跨所有数据源）。
*
* 与 {@link deleteRecord}（删一行）的区别：这里按 `qq` 列删掉该玩家在各表里的所有行 ——
* 对应数据浏览器里"删掉这个玩家"。
*
* ⚠️ 不可逆，所以**先备份**：用 better-sqlite3 的 `db.backup()`（WAL 下直接 copy 文件
* 会漏掉未落盘的内容）。备份文件为 `<db>.bak-<时间戳>`，与仓库既有做法一致。
*/
async function deletePlayer(projectPath, qq) {
	const dataDir = path.join(projectPath, "data", "players");
	if (!fs.existsSync(dataDir)) return {
		deleted: 0,
		backups: []
	};
	let deleted = 0;
	const backups = [];
	for (const file of fs.readdirSync(dataDir)) {
		const ext = path.extname(file).toLowerCase();
		if (ext !== ".db" && ext !== ".sqlite") continue;
		const fullPath = path.join(dataDir, file);
		const db = getDb(fullPath);
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
		/** 该玩家在这个库里命中的表（先全部找出来，确认有数据再备份/删除） */
		const hits = [];
		for (const t of tables) {
			const qqCol = db.prepare(`PRAGMA table_info("${t.name}")`).all().find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
			if (!qqCol) continue;
			if (db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}" WHERE "${qqCol.name}" = ?`).get(qq).c > 0) hits.push({
				table: t.name,
				col: qqCol.name
			});
		}
		if (hits.length === 0) continue;
		const backupPath = `${fullPath}.bak-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
		try {
			await db.backup(backupPath);
			backups.push(backupPath);
			const archived = archiveOldBackups(fullPath);
			if (archived > 0) logger.info(`[dataService] 已归档 ${archived} 个旧备份到 ${BACKUP_ARCHIVE_DIR}/`);
		} catch (e) {
			throw new Error(`备份失败，已中止删除（${file}）: ${e instanceof Error ? e.message : String(e)}`);
		}
		const runAll = db.transaction((items) => {
			let n = 0;
			for (const it of items) {
				const info = db.prepare(`DELETE FROM "${it.table}" WHERE "${it.col}" = ?`).run(qq);
				n += Number(info.changes ?? 0);
			}
			return n;
		});
		deleted += runAll(hits);
	}
	return {
		deleted,
		backups
	};
}
function deleteRecord(filePath, tableName, rowid) {
	assertIdentifier(tableName, "表名");
	getDb(filePath).prepare(`DELETE FROM "${tableName}" WHERE rowid = ?`).run(rowid);
}
/**
* 按 rowid 读一行。
*
* 为什么需要它：审计日志要能回答「**改/删之前是什么**」。原先
* 已删除的 `aiDataService`（数据工具面，见 docs/ai/ai-data-tools-redesign.md）的
* `delete_item` 与 `update_config` 曾在审计里写 `before: null` ——
* 结果是"谁删了什么、改前是什么"事后**查不出来**（同一个文件里 `update_player` 是记旧值的，
* 只有这两个漏了）。
*
* 放在 dataService 里而不是让调用方自己 `prepare`：表名会**直接拼进 SQL**，
* 必须过 `assertIdentifier`（模块私有，外部拿不到）。
*/
function getRecord(filePath, tableName, rowid) {
	assertIdentifier(tableName, "表名");
	return getDb(filePath).prepare(`SELECT * FROM "${tableName}" WHERE rowid = ?`).get(rowid);
}
function saveSchema(projectPath, tableName, fields) {
	assertIdentifier(tableName, "表名");
	const schemaDir = path.join(projectPath, "data", "config", ".schema");
	if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true });
	const filePath = path.join(schemaDir, `${tableName}.schema.json`);
	const schema = {
		table: tableName,
		fields
	};
	fs.writeFileSync(filePath, JSON.stringify(schema, null, 2), "utf-8");
	invalidateDb(path.join(projectPath, "data", "config", `${tableName}.db`));
	return filePath;
}
/**
* 在已打开的数据库连接上创建索引（内部方法）。
*
* 索引命名规范：idx_<table>_<column>
* - 仅对 INDEXED_FIELDS 中列出的高频查询字段创建索引
* - 使用 CREATE INDEX IF NOT EXISTS 确保幂等，可安全重复执行
* - 单条索引创建失败时静默跳过（如字段类型不支持索引、只读文件系统等）
*
* 注意：CREATE INDEX 在 SQLite 中不应在事务内执行（会持有排他锁过久），
* 本函数在调用方需确保不在事务内使用。
*/
function ensureIndexesOnDb(db) {
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
	for (const t of tables) {
		if (!IDENTIFIER_RE.test(t.name)) continue;
		const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
		for (const col of cols) {
			if (!IDENTIFIER_RE.test(col.name)) continue;
			if (INDEXED_FIELDS.includes(col.name.toLowerCase())) try {
				db.prepare(`CREATE INDEX IF NOT EXISTS "idx_${t.name}_${col.name}" ON "${t.name}"("${col.name}")`).run();
			} catch (e) {
				logger.warn(`[dataService] 索引创建失败: idx_${t.name}_${col.name}`, e);
			}
		}
	}
}
/**
* 自动为 QQ 号等高频查询字段创建索引。
*
* 在打开只读连接进行查询前调用此函数，确保所需的索引已存在。
* 此函数以读写模式打开数据库（创建索引需要写权限），通过连接池复用连接。
* 如果文件系统只读或索引已存在，函数静默返回不影响后续查询。
*
* 幂等性：使用 CREATE INDEX IF NOT EXISTS，可安全重复调用。
*/
function ensureIndexes(dbPath) {
	if (!fs.existsSync(dbPath) || !dbPath.endsWith(".db")) return;
	try {
		ensureIndexesOnDb(getDb(dbPath));
	} catch (e) {
		logger.warn(`[dataService] ensureIndexes 失败: ${dbPath}`, e);
	}
}
/** 列出所有玩家及记录数（跨所有数据源） */
function listPlayers(projectPath) {
	const dataDir = path.join(projectPath, "data", "players");
	if (!fs.existsSync(dataDir)) return [];
	const playerMap = /* @__PURE__ */ new Map();
	for (const file of fs.readdirSync(dataDir)) {
		const ext = path.extname(file).toLowerCase();
		if (ext !== ".db" && ext !== ".sqlite") continue;
		const fullPath = path.join(dataDir, file);
		ensureIndexes(fullPath);
		const db = getDb(fullPath);
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
		for (const t of tables) {
			const qqCol = db.prepare(`PRAGMA table_info("${t.name}")`).all().find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
			if (!qqCol) continue;
			const startQuery = Date.now();
			const groupRows = db.prepare(`SELECT "${qqCol.name}" as qq_val, COUNT(*) as cnt FROM "${t.name}" WHERE "${qqCol.name}" IS NOT NULL AND "${qqCol.name}" != '' GROUP BY "${qqCol.name}"`).all();
			logSlowQuery(`SELECT "${qqCol.name}", COUNT(*) FROM "${t.name}" GROUP BY "${qqCol.name}"`, Date.now() - startQuery);
			for (const r of groupRows) {
				if (!playerMap.has(r.qq_val)) playerMap.set(r.qq_val, {
					count: 0,
					sources: /* @__PURE__ */ new Set()
				});
				playerMap.get(r.qq_val).sources.add(file);
				playerMap.get(r.qq_val).count += r.cnt;
			}
		}
	}
	return Array.from(playerMap.entries()).map(([qq, info]) => ({
		qq,
		recordCount: info.count,
		sources: Array.from(info.sources)
	})).sort((a, b) => b.recordCount - a.recordCount);
}
function searchPlayer(projectPath, query) {
	const dataDir = path.join(projectPath, "data", "players");
	if (!fs.existsSync(dataDir)) return [];
	const results = [];
	const likePattern = `%${query}%`;
	for (const file of fs.readdirSync(dataDir)) {
		const ext = path.extname(file).toLowerCase();
		if (ext !== ".db" && ext !== ".sqlite") continue;
		const fullPath = path.join(dataDir, file);
		ensureIndexes(fullPath);
		const db = getDb(fullPath);
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
		for (const t of tables) {
			const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all();
			const qqCol = columns.find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
			const nameCol = columns.find((c) => c.name === "nickname" || c.name === "name" || c.name === "player_name");
			if (qqCol) {
				const startQq = Date.now();
				const rows = db.prepare(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE "${qqCol.name}" = ?`).all(query);
				logSlowQuery(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE "${qqCol.name}" = ?`, Date.now() - startQq);
				withRowIdAlias(rows);
				for (const row of rows) results.push({
					source: file,
					table: t.name,
					rowid: row.rowid,
					row
				});
			}
			if (nameCol && nameCol.name !== qqCol?.name) {
				const startName = Date.now();
				const nameRows = db.prepare(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE "${nameCol.name}" LIKE ?`).all(likePattern);
				logSlowQuery(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE "${nameCol.name}" LIKE ?`, Date.now() - startName);
				withRowIdAlias(nameRows);
				for (const row of nameRows) if (!results.some((r) => r.source === file && r.table === t.name && r.rowid === row.rowid)) results.push({
					source: file,
					table: t.name,
					rowid: row.rowid,
					row
				});
			}
		}
	}
	return results;
}
var IDENTIFIER_RE, IS_DEV, SLOW_QUERY_THRESHOLD_MS, DB_POOL_MAX_SIZE, dbPool, dbCtorOverride, BACKUP_KEEP, BACKUP_ARCHIVE_DIR, INDEXED_FIELDS;
let dataServiceInited = false;
function init_dataService() {
	if (dataServiceInited) return;
	dataServiceInited = true;
	init_schemaService();
	IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
	IS_DEV = process.env.NODE_ENV !== "production";
	SLOW_QUERY_THRESHOLD_MS = 100;
	DB_POOL_MAX_SIZE = 10;
	dbPool = /* @__PURE__ */ new Map();
	dbCtorOverride = null;
	process.on("exit", closeAllConnections);
	try {
		require("electron").app?.on("before-quit", () => {
			closeAllConnections();
		});
	} catch {}
	BACKUP_KEEP = 5;
	BACKUP_ARCHIVE_DIR = ".backups";
	INDEXED_FIELDS = [
		"qq",
		"user_id",
		"sender_id",
		"owner_id",
		"player_id",
		"qq_number"
	];
}

init_dataService();
export { dataService_exports, logSlowQuery, addToPool, getDb, createDb, applyOpenPragmas, setDbCtorForTesting, getOrCreateDb, closeAllConnections, invalidateDb, normPath, closeConnectionsUnder, closeAllConnectionsForTesting, assertIdentifier, assertKeysIdentifiers, listDataSources, fieldConfigToFieldSchema, getSchema, mergeEnumOptionsFromConfigSchema, withRowIdAlias, queryTable, updateRecord, insertRecord, queryPlayerTables, archiveOldBackups, mergePlayers, deletePlayer, deleteRecord, getRecord, saveSchema, ensureIndexesOnDb, ensureIndexes, listPlayers, searchPlayer, IDENTIFIER_RE, IS_DEV, SLOW_QUERY_THRESHOLD_MS, DB_POOL_MAX_SIZE, dbPool, dbCtorOverride, BACKUP_KEEP, BACKUP_ARCHIVE_DIR, INDEXED_FIELDS, init_dataService };
