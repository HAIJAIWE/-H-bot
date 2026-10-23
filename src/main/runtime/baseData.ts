// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../services/infra/logger";
import { BASE_DATA_KEYS, isoDatePart } from "../../shared/persist/baseKeys";
import { loadValue, saveValue, withStoreLock } from "../services/builtinNodes/persistentStore";

/** 事件里能拿到的昵称（拿不到返回空串） */
function nicknameOf(event) {
	const raw = event?.sender?.nickname;
	return typeof raw === "string" ? raw.trim() : "";
}
/** user_id 归一成字符串（空/0 → 空串，表示"这个事件没有操作者"） */
function uidOf(event) {
	const raw = event?.user_id;
	if (raw === void 0 || raw === null) return "";
	const s = String(raw).trim();
	return s === "" || s === "0" ? "" : s;
}
/**
* 对一条事件维护基础数据。
*
* 行为（见 docs/game/player-base-data.md）：
*   - 首次见到该玩家 → 写 `registered_at`（之后**不再改**）；
*   - 每条事件 → 覆盖 `last_active` / `last_active_date`，`msg_count` +1；
*   - 事件带昵称时 → 覆盖 `nickname`（官方渠道事件不带昵称，跳过）。
*
* 约束：
*   - **不抛异常**：基础数据是附属信息，任何失败只 warn，绝不阻断事件处理；
*   - 一个事务写完（`withStoreLock` 串行）；
*   - 无 `user_id` 的事件（群通知里没有操作者之类）直接返回，不建行。
*
* @param event 当前事件
* @param nowMs 当前时间（注入便于测试；缺省 `Date.now()`）
*/
async function ensureBaseData(event, nowMs) {
	const uid = uidOf(event);
	if (!uid) return;
	try {
		const iso = new Date(nowMs ?? Date.now()).toISOString();
		const datePart = isoDatePart(iso);
		const storeEvent = { user_id: uid };
		const nickname = nicknameOf(event);
		const keys = [
			BASE_DATA_KEYS.lastActive,
			BASE_DATA_KEYS.lastActiveDate,
			BASE_DATA_KEYS.msgCount,
			...nickname ? [BASE_DATA_KEYS.nickname] : []
		];
		await withStoreLock(() => {
			if (loadValue(BASE_DATA_KEYS.registeredAt, "user", storeEvent) === null) saveValue(BASE_DATA_KEYS.registeredAt, iso, "user", storeEvent);
			saveValue(BASE_DATA_KEYS.lastActive, iso, "user", storeEvent);
			saveValue(BASE_DATA_KEYS.lastActiveDate, datePart, "user", storeEvent);
			const currentRaw = loadValue(BASE_DATA_KEYS.msgCount, "user", storeEvent);
			const current = typeof currentRaw === "number" ? currentRaw : Number(currentRaw) || 0;
			saveValue(BASE_DATA_KEYS.msgCount, current + 1, "user", storeEvent);
			if (nickname) saveValue(BASE_DATA_KEYS.nickname, nickname, "user", storeEvent);
		});
		logger.debug(`[baseData] uid=${uid} keys=${keys.length + 1} last_active=${iso} msg_count+1`);
	} catch (e) {
		logger.warn("[baseData] 维护基础数据失败（已忽略）:", e);
	}
}
/**
* 给**一个**还没有基础数据的玩家回填。
*
* ## 为什么需要它
*
* 基础数据是"从功能上线那一刻起"才开始记的 —— 上线之前的玩家档案里
* 只有业务字段，卡片上就看不到注册时间/最后在线。这个函数用**已有的存档行**
* 反推一个参考值填进去（数据来源：`_persistent.updated_at` 的最早/最晚时间）。
*
* ## 三条纪律
*
* 1. **只填空缺，绝不覆盖**：`registered_at` 一旦存在就永不改（这是它的语义），
*    所以重复调用是幂等的；
* 2. **不编**：拿不到的值就不写（例如没有存档行 → 什么都不写），
*    而不是填一个"看起来像"的时间；
* 3. `msg_count` **不反推历史条数**（存档里没有这个信息），填 `0`：
*    "引擎观察到 0 条消息"是事实，比编一个数字诚实。
*
* @param uid 玩家 UID
* @param seed 从存档推断出的值
*/
async function backfillBaseData(uid, seed) {
	const result = {
		written: [],
		skipped: []
	};
	const resolved = uidOf({ user_id: uid });
	if (!resolved) return result;
	const storeEvent = { user_id: resolved };
	const candidates = [];
	if (seed.registeredAt) candidates.push({
		key: BASE_DATA_KEYS.registeredAt,
		value: seed.registeredAt
	});
	if (seed.lastActive) candidates.push({
		key: BASE_DATA_KEYS.lastActive,
		value: seed.lastActive
	});
	if (seed.lastActiveDate) candidates.push({
		key: BASE_DATA_KEYS.lastActiveDate,
		value: seed.lastActiveDate
	});
	if (seed.nickname) candidates.push({
		key: BASE_DATA_KEYS.nickname,
		value: seed.nickname
	});
	candidates.push({
		key: BASE_DATA_KEYS.msgCount,
		value: 0
	});
	try {
		await withStoreLock(() => {
			for (const { key, value } of candidates) {
				if (loadValue(key, "user", storeEvent) !== null) {
					result.skipped.push(key);
					continue;
				}
				saveValue(key, value, "user", storeEvent);
				result.written.push(key);
			}
		});
	} catch (e) {
		logger.warn(`[baseData] 回填 uid=${resolved} 失败:`, e);
	}
	return result;
}

export { nicknameOf, uidOf, ensureBaseData, backfillBaseData };
