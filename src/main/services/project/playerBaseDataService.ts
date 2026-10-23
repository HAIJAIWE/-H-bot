// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";
import { runWithProjectRoot } from "../builtinNodes/storeContext";
import { getDbSync } from "../builtinNodes/persistentStore";
import { backfillBaseData } from "../../runtime/baseData";
import { buildKey } from "../../../shared/persist/persistentKey";

/**
* `_persistent` 里 `user_<uid>:<key>` 的前缀解析。
*
* 为什么不用 storeContext 的解析函数：这里**只读**，而且要在
* `runWithProjectRoot` 内直接查库；前缀规则是一行正则，复制它的成本
* 低于把它从 persistentStore 里导出来（那个函数还耦合了 scope 语义）。
*/
var USER_KEY_RE = /^user_(.+?):/;
/** `2026-09-22 08:24:02`（UTC+8）→ `2026-09-22T08:24:02+08:00`（ISO 8601） */
function sqliteUtc8ToIso(value) {
	if (typeof value !== "string" || !value.trim()) return void 0;
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
	if (!m) return void 0;
	const [, y, mo, d, h, mi, s] = m;
	return `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`;
}
/** 从 ISO 串取日期部分（`2026-09-22T08:24:02+08:00` → `2026-09-22`） */
function isoDateOfUtc8(iso) {
	return iso ? iso.slice(0, 10) : void 0;
}
/**
* **纯函数核心**：从 `_persistent` 行算出回填计划（不碰数据库）。
*
* 抽出来的理由有二：
*   1. 可以用**真实存档数据**离线验证推断结果（本机 better-sqlite3 只有 Electron ABI，
*      Node 下跑不了主进程的库；纯函数就绕开了这个限制）；
*   2. 计划与执行分离 —— 能先给用户看"会被填什么"，再决定要不要执行。
*/
function buildBackfillPlans(rows) {
	/** uid → 聚合 */
	const byUid = /* @__PURE__ */ new Map();
	for (const r of rows) {
		const m = USER_KEY_RE.exec(String(r.key));
		if (!m) continue;
		const uid = m[1];
		const at = typeof r.updated_at === "string" ? r.updated_at : "";
		const cur = byUid.get(uid) ?? {
			count: 0,
			min: "",
			max: ""
		};
		cur.count++;
		if (at) {
			if (!cur.min || at < cur.min) cur.min = at;
			if (!cur.max || at > cur.max) cur.max = at;
		}
		byUid.set(uid, cur);
	}
	const plans = [];
	for (const [uid, agg] of [...byUid].sort((a, b) => a[0].localeCompare(b[0]))) {
		const registeredAt = sqliteUtc8ToIso(agg.min);
		const lastActive = sqliteUtc8ToIso(agg.max);
		plans.push({
			uid,
			rowCount: agg.count,
			seed: {
				registeredAt,
				lastActive,
				lastActiveDate: isoDateOfUtc8(lastActive)
			}
		});
	}
	return plans;
}
/**
* 扫一个项目的存档，算出每个玩家的回填计划（**只读，不写**）。
*/
function planBackfill(projectPath) {
	return runWithProjectRoot(projectPath, () => {
		return buildBackfillPlans(getDbSync().prepare("SELECT key, updated_at FROM _persistent WHERE key LIKE ?").all("user_%"));
	});
}
/**
* 执行回填（幂等：已有值的 key 一律不动）。
*
* @param projectPath 项目根目录
* @param onlyUids 只处理这些 UID（缺省 = 全部）
*/
async function backfillPlayerBaseData(projectPath, onlyUids) {
	const plans = planBackfill(projectPath).filter((p) => !onlyUids || onlyUids.length === 0 || onlyUids.includes(p.uid));
	const summary = {
		players: 0,
		written: 0,
		skipped: 0,
		details: []
	};
	for (const plan of plans) {
		const res = await runWithProjectRoot(projectPath, () => backfillBaseData(plan.uid, plan.seed));
		if (res.written.length === 0 && res.skipped.length === 0) continue;
		summary.players++;
		summary.written += res.written.length;
		summary.skipped += res.skipped.length;
		summary.details.push({
			uid: plan.uid,
			written: res.written,
			skipped: res.skipped
		});
	}
	logger.info(`[playerBaseData] 回填完成：${summary.players} 个玩家，写入 ${summary.written} 个字段，跳过 ${summary.skipped} 个（已有值）`);
	return summary;
}
/**
* 某个项目还有多少玩家没有基础数据（供界面提示"可初始化"）。
*/
function countPlayersMissingBaseData(projectPath) {
	const plans = planBackfill(projectPath);
	return runWithProjectRoot(projectPath, () => {
		let missing = 0;
		for (const p of plans) if ((getDbSync().prepare("SELECT COUNT(*) AS c FROM _persistent WHERE key = ?").get(buildKey("__sys_registered_at", "user", { user_id: p.uid }))?.c ?? 0) === 0) missing++;
		return missing;
	});
}

export { USER_KEY_RE, sqliteUtc8ToIso, isoDateOfUtc8, buildBackfillPlans, planBackfill, backfillPlayerBaseData, countPlayersMissingBaseData };
