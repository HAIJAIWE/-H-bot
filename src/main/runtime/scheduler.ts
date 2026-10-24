// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/** 单段 cron 匹配：支持 `*`、`a`、`a-b`、`a,b,c`、`*​/n`、`a-b/n` */
function fieldMatches(field, value, min, _max) {
	if (field === "*" || field === "?" || field === "") return true;
	for (const part of field.split(",")) {
		const [rangeRaw, stepRaw] = part.split("/");
		const step = stepRaw === void 0 ? 1 : Number(stepRaw);
		if (!Number.isFinite(step) || step <= 0) continue;
		if (rangeRaw === "*" || rangeRaw === "?") {
			if ((value - min) % step === 0) return true;
			continue;
		}
		const [aRaw, bRaw] = rangeRaw.split("-");
		const lo = aRaw === "" || aRaw === void 0 ? min : Number(aRaw);
		const hi = bRaw === void 0 ? lo : Number(bRaw);
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
		if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
	}
	return false;
}
/**
* 5 段 cron 是否命中某个时刻（本地时间）。
*
* 简化说明：日与周同时被限定时按 **同时满足**（AND）处理，而不是传统 cron 的 OR ——
* 对小白来说"两个条件都要满足"更好理解，且常见的 `0 8 * * *`、`0 8 * * 1`、`0 0 1 * *`
* 两种写法结果一致。
*/
function cronMatches(cron, date) {
	const fields = String(cron ?? "").trim().split(/\s+/).filter(Boolean);
	if (fields.length !== 5) return false;
	const [minute, hour, dom, month, dow] = fields;
	const weekday = date.getDay();
	return fieldMatches(minute, date.getMinutes(), 0, 59) && fieldMatches(hour, date.getHours(), 0, 23) && fieldMatches(dom, date.getDate(), 1, 31) && fieldMatches(month, date.getMonth() + 1, 1, 12) && fieldMatches(dow === "7" ? "0" : dow, weekday, 0, 6);
}
/**
* 这一刻该不该触发。
*
* @param lastFiredAtMs 上次触发时间（毫秒）；null = 从没触发过
* @param nowMs 现在（毫秒）
*
* 规则：
* - 配了 `interval_seconds`（> 0）就按间隔，没触发过则立刻触发一次；
* - 否则按 `cron`，且**同一分钟内不重复触发**（防止轮询比 cron 精度更密时连发）；
* - 两者都没配 / cron 非法 → 不触发（宁可不跑，也不要乱跑）。
*/
function isDue(config, lastFiredAtMs, nowMs) {
	const interval = Number(config?.interval_seconds ?? 0);
	if (Number.isFinite(interval) && interval > 0) {
		if (lastFiredAtMs === null || lastFiredAtMs === void 0) return true;
		return nowMs - lastFiredAtMs >= interval * 1e3;
	}
	const cron = String(config?.cron ?? "").trim();
	if (!cron) return false;
	if (lastFiredAtMs !== null && lastFiredAtMs !== void 0) {
		if (Math.floor(nowMs / 6e4) <= Math.floor(lastFiredAtMs / 6e4)) return false;
	}
	return cronMatches(cron, new Date(nowMs));
}
/**
* 这一轮该触发哪些触发器（纯函数，方便用假时钟测）。
*
* 运行时只负责"每秒问一次、把返回值逐个派发出去"；判定与挑选都在这里。
*/
function dueTriggers(triggers, lastFiredAt, nowMs) {
	const due = [];
	for (const trigger of triggers) {
		const last = lastFiredAt.get(trigger.id) ?? null;
		if (isOneShotLifecycle(trigger.kind) ? last === null : isDue(trigger.config, last, nowMs)) due.push(trigger);
	}
	return due;
}
/**
* 是不是"只跑一次"的生命周期触发器。
*
* 这两个 kind 的 `defaultConfig` 是**空的**，拿 `isDue` 判会走成"两者都没配 → 不触发"
* （`isDue` 的注释里写着"宁可不跑也不要乱跑"）—— 那正好又变成"静默不触发"。
* 所以它们在这里单独走"没跑过就跑一次"的判定，**不看 config**。
*/
function isOneShotLifecycle(kind) {
	return kind === "on_ready" || kind === "on_startup";
}
/**
* 生命周期触发器这一轮该派发谁 —— `FlowRuntime` 的调度决策，抽成纯函数。
*
* 抽出来的理由：`FlowRuntime` 直接 `new WebSocket(...)`，单测里起不来；而"该不该跑"
* 恰恰是最容易写错、也最该被锁住的部分（曾经 `on_ready` 在**还没连上**时就跑了，
* 于是流程里的发消息必然失败）。
*
* @param connected 运行时是否已连上网关（`FlowRuntime.status === 'running'`）
*/
function selectDueLifecycle(triggers, lastFiredAt, nowMs, connected) {
	const selection = {
		due: [],
		deferred: []
	};
	for (const trigger of dueTriggers(triggers, lastFiredAt, nowMs)) {
		if (trigger.kind === "on_ready" && !connected) {
			selection.deferred.push(trigger);
			continue;
		}
		selection.due.push(trigger);
	}
	return selection;
}

export { fieldMatches, cronMatches, isDue, dueTriggers, isOneShotLifecycle, selectDueLifecycle };
