// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
// 命名空间导入，理由同 project/dataTemplateService.ts（具名导入拿到 undefined）
import * as path from "path";
import * as fs from "fs";
import { getDb, init_dataService } from "../project/dataService";
import { init_logger, logger } from "../infra/logger";

var UID_START = 1e4;
/**
* 加载项目的 uid_mapping.json
*/
function getUidMapping(projectPath) {
	const filePath = (0, path.join)(projectPath, ".qqbat", "uid_mapping.json");
	if (!(0, fs.existsSync)(filePath)) return {
		nextUid: UID_START,
		mapping: {}
	};
	try {
		return JSON.parse((0, fs.readFileSync)(filePath, "utf-8"));
	} catch {
		return {
			nextUid: UID_START,
			mapping: {}
		};
	}
}
/**
* 保存 uid_mapping.json
*/
function saveUidMapping(projectPath, data) {
	const dir = (0, path.join)(projectPath, ".qqbat");
	const filePath = (0, path.join)(dir, "uid_mapping.json");
	if (!(0, fs.existsSync)(dir)) (0, fs.mkdirSync)(dir, { recursive: true });
	(0, fs.writeFileSync)(filePath, JSON.stringify(data, null, 2), "utf-8");
}
/**
* 获取所有玩家及其UID映射信息
* 返回合并了 uid_mapping 和数据库玩家列表的结果
*/
function getPlayersWithUid(projectPath) {
	const mapping = getUidMapping(projectPath);
	const uidToOpenid = /* @__PURE__ */ new Map();
	for (const [openid, uid] of Object.entries(mapping.mapping)) uidToOpenid.set(uid, openid);
	const dataDir = (0, path.join)(projectPath, "data", "players");
	if (!(0, fs.existsSync)(dataDir)) return [];
	const playerMap = /* @__PURE__ */ new Map();
	for (const file of (0, fs.readdirSync)(dataDir)) {
		const ext = (0, path.extname)(file).toLowerCase();
		if (ext !== ".db" && ext !== ".sqlite") continue;
		const fullPath = (0, path.join)(dataDir, file);
		const db = getDb(fullPath);
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
		for (const t of tables) {
			const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all();
			const qqCol = columns.find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
			const nameCol = columns.find((c) => c.name === "nickname" || c.name === "name" || c.name === "player_name");
			if (!qqCol) continue;
			const qqRows = db.prepare(`SELECT DISTINCT "${qqCol.name}" as qq_val FROM "${t.name}" WHERE "${qqCol.name}" IS NOT NULL AND "${qqCol.name}" != ''`).all();
			for (const r of qqRows) {
				const uidNum = parseInt(r.qq_val, 10);
				const openid = isNaN(uidNum) ? null : uidToOpenid.get(uidNum) || null;
				if (!playerMap.has(r.qq_val)) {
					const entry = {
						count: 0,
						sources: /* @__PURE__ */ new Set(),
						openid
					};
					if (t.name === "players" && nameCol) {
						const nameRow = db.prepare(`SELECT "${nameCol.name}" as nm FROM "${t.name}" WHERE "${qqCol.name}" = ? LIMIT 1`).get(r.qq_val);
						if (nameRow) entry.nickname = nameRow.nm;
					}
					playerMap.set(r.qq_val, entry);
				}
				playerMap.get(r.qq_val).sources.add(file);
				const cnt = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}" WHERE "${qqCol.name}" = ?`).get(r.qq_val).c;
				playerMap.get(r.qq_val).count += cnt;
			}
		}
	}
	return Array.from(playerMap.entries()).map(([uid, info]) => ({
		uid,
		openid: info.openid,
		nickname: info.nickname,
		recordCount: info.count,
		sources: Array.from(info.sources)
	})).sort((a, b) => b.recordCount - a.recordCount);
}
/**
* 更新玩家的 UID（更新 uid_mapping.json + 所有数据库记录）
* @returns 旧 UID（如果存在）
*/
/**
* 把 `fromUid` 在映射里的**全部 openid 改指到 `toUid`**（合并玩家的身份那一半）。
*
* 为什么要单独一个函数：`dataService.mergePlayers` 只搬**数据库里的行**，
* 而"这个 openid 属于哪个 uid"记在 `uid_mapping.json` 里 —— 只搬数据不改映射，
* 平台下次来消息还会解析出旧 uid，于是又长出一份空存档（合并等于没合）。
*
* ⚠️ 调用前必须**确认机器人已停止**：翻译器把映射缓存在内存里，稍后会用内存状态覆盖这个文件。
*/
function mergeUidMapping(projectPath, fromUid, toUid) {
	if (fromUid === toUid) return { moved: 0 };
	const mapping = getUidMapping(projectPath);
	let moved = 0;
	for (const [openid, uid] of Object.entries(mapping.mapping)) if (String(uid) === fromUid) {
		mapping.mapping[openid] = Number(toUid);
		moved++;
	}
	if (moved > 0) saveUidMapping(projectPath, mapping);
	return { moved };
}
/**
* 修改玩家的 UID（把 `oldUid` 的全部存档迁到 `newUid`）。
*
* ## ⚠️ 这里修过一个真 bug（2026-10-03，由用户真实日志暴露）
*
* 原实现**只改 `qq` 列**，没改 `key`。而运行时读写存档走的是 **`key`**
* （`persistentStore`：`SELECT value FROM _persistent WHERE key = ?`）：
*
* ```
* user_10000:hp  qq='1'   ← 原存档：改 UID 后运行时**再也读不到**（key 不匹配）
* user_1:hp      qq='1'   ← 改完之后运行时新写的
* ```
*
* 症状：**"改完 UID，玩家存档像没了/被重置"**（数据其实还在，只是 key 对不上）。
* 现在 `key` 前缀与 `qq` 列**一起改**，并在改动前**备份**（原实现连备份都没有）。
*
* @returns `moved`/`discarded`/`backups` 供日志与界面提示（冲突丢弃的行原值在备份里）
*/
async function updatePlayerUid(projectPath, openid, newUid) {
	if (newUid < 1) throw new Error("UID 必须大于 0");
	const mapping = getUidMapping(projectPath);
	if (Object.entries(mapping.mapping).find(([o, u]) => u === newUid && o !== openid)) throw new Error(`UID ${newUid} 已被其他玩家占用`);
	const oldUid = mapping.mapping[openid] ?? null;
	mapping.mapping[openid] = newUid;
	if (newUid >= mapping.nextUid) mapping.nextUid = newUid + 1;
	saveUidMapping(projectPath, mapping);
	let moved = 0;
	let discarded = 0;
	const backups = [];
	if (oldUid !== null && oldUid !== newUid) {
		const oldUidStr = String(oldUid);
		const newUidStr = String(newUid);
		const dataDir = (0, path.join)(projectPath, "data", "players");
		if ((0, fs.existsSync)(dataDir)) for (const file of (0, fs.readdirSync)(dataDir)) {
			const ext = (0, path.extname)(file).toLowerCase();
			if (ext !== ".db" && ext !== ".sqlite") continue;
			const fullPath = (0, path.join)(dataDir, file);
			try {
				const db = getDb(fullPath);
				const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
				const plans = [];
				for (const t of tables) {
					const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all();
					const qqCol = columns.find((c) => c.name === "qq" || c.name === "user_id" || c.name === "qq_number");
					if (!qqCol) continue;
					if (db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}" WHERE "${qqCol.name}" = ?`).get(oldUidStr).c > 0) plans.push({
						table: t.name,
						col: qqCol.name,
						hasKeyCol: columns.some((c) => c.name === "key")
					});
				}
				if (plans.length === 0) continue;
				const backupPath = `${fullPath}.bak-uid-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
				await db.backup(backupPath);
				backups.push(backupPath);
				const res = db.transaction((items) => {
					let m = 0;
					let d = 0;
					for (const it of items) if (it.hasKeyCol) {
						const rows = db.prepare(`SELECT rowid, key FROM "${it.table}" WHERE "${it.col}" = ?`).all(oldUidStr);
						for (const row of rows) {
							const newKey = String(row.key).replace(new RegExp(`^([A-Za-z]+)_${oldUidStr}:`), `$1_${newUidStr}:`);
							if (newKey !== row.key ? db.prepare(`SELECT 1 FROM "${it.table}" WHERE key = ? LIMIT 1`).get(newKey) : void 0) {
								db.prepare(`DELETE FROM "${it.table}" WHERE rowid = ?`).run(row.rowid);
								d++;
								continue;
							}
							db.prepare(`UPDATE "${it.table}" SET key = ?, "${it.col}" = ? WHERE rowid = ?`).run(newKey, newUidStr, row.rowid);
							m++;
						}
					} else {
						const info = db.prepare(`UPDATE "${it.table}" SET "${it.col}" = ? WHERE "${it.col}" = ?`).run(newUidStr, oldUidStr);
						m += Number(info.changes ?? 0);
					}
					return {
						m,
						d
					};
				})(plans);
				moved += res.m;
				discarded += res.d;
			} catch (e) {
				logger.warn(`[uidMapping] 迁移存档失败（${file}）: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}
	return {
		oldUid,
		success: true,
		moved,
		discarded,
		backups
	};
}

export { UID_START, getUidMapping, saveUidMapping, getPlayersWithUid, mergeUidMapping, updatePlayerUid };
