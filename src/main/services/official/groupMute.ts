// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/** 北京时间（UTC+8）下的「星期 + 当天第几分钟」。星期日用 **7**（不是 0），与官方 `weekdays` 对齐。 */
function beijingClock(now) {
	const bj = new Date(now.getTime() + 288e5);
	const jsDay = bj.getUTCDay();
	return {
		weekday: jsDay === 0 ? 7 : jsDay,
		minutes: bj.getUTCHours() * 60 + bj.getUTCMinutes()
	};
}
/** `HH:mm` → 当天第几分钟；写法不合法（如 `25:00` / `99:99`）返回 `null` */
function parseHm(raw) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}
/** 规则是否启用：**字段缺失按启用**处理（缺失不等于关闭，官方文档示例里是显式 false 才关） */
function ruleEnabled(rule) {
	return rule.enabled !== false;
}
/** 取数组字段；不是数组就当空 */
function asArray(raw) {
	return Array.isArray(raw) ? raw.filter((x) => Boolean(x) && typeof x === "object") : [];
}
/**
* 此刻该群是否处于全员禁言。
*
* @param state 官方「查询群禁言状态」的响应体（结构不可信，全程容错：不抛异常，判不出就 false）
* @param now   当前时刻（测试注入用；默认 `new Date()`）
*/
function isGroupMutedNow(state, now = /* @__PURE__ */ new Date()) {
	if (!state || typeof state !== "object" || Array.isArray(state)) return false;
	const s = state;
	const mode = String(s.mode ?? "");
	if (mode === "always") return true;
	if (mode === "none") return false;
	if (mode === "schedule") {
		const clock = beijingClock(now);
		for (const rule of asArray(s.schedule_rules)) {
			if (!ruleEnabled(rule)) continue;
			const start = Date.parse(String(rule.start_at ?? ""));
			const end = Date.parse(String(rule.end_at ?? ""));
			if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
			const t = now.getTime();
			if (t >= start && t < end) return true;
		}
		for (const rule of asArray(s.recurring_rules)) {
			if (!ruleEnabled(rule)) continue;
			const start = parseHm(rule.start_time);
			const end = parseHm(rule.end_time);
			if (start === null || end === null) continue;
			const weekdays = Array.isArray(rule.weekdays) ? rule.weekdays.map((d) => Number(d)) : [];
			const today = clock.weekday;
			const minute = clock.minutes;
			if (start < end) {
				if (weekdays.includes(today) && minute >= start && minute < end) return true;
			} else if (start > end) {
				if (weekdays.includes(today) && minute >= start) return true;
				const yesterday = today === 1 ? 7 : today - 1;
				if (weekdays.includes(yesterday) && minute < end) return true;
			} else if (weekdays.includes(today)) return true;
		}
	}
	return false;
}

export { beijingClock, parseHm, ruleEnabled, asArray, isGroupMutedNow };
