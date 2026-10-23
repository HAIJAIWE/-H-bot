// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/**
* 候选 id，按**跨群稳定性**从高到低。
*
* 顺序是有意义的：解析时第一个命中的就是"最稳的那个身份"。
*/
function identityCandidates(ids) {
	const out = [];
	for (const v of [
		ids.unionOpenid,
		ids.userOpenid,
		ids.memberOpenid
	]) {
		const s = typeof v === "string" ? v.trim() : "";
		if (s && !out.includes(s)) out.push(s);
	}
	return out;
}
/**
* 根据"别名表 + 本次事件的身份"算出解析计划。**纯函数**。
*
* @param aliasToUid 任何 id → uid 的别名表（历史 `mapping` 本身就是它的一种形态）
*/
function planIdentityResolution(aliasToUid, ids) {
	const candidates = identityCandidates(ids);
	const hitUids = [];
	for (const c of candidates) {
		const uid = aliasToUid.get(c);
		if (uid !== void 0 && !hitUids.includes(uid)) hitUids.push(uid);
	}
	const primaryAlias = ids.memberOpenid && ids.memberOpenid.trim() || ids.userOpenid && ids.userOpenid.trim() || ids.unionOpenid && ids.unionOpenid.trim() || null;
	return {
		uid: hitUids.length > 0 ? Math.min(...hitUids) : null,
		hitUids,
		aliases: candidates,
		primaryAlias
	};
}
/** 合并时把哪个并进哪个：返回 `{ from: number[]; to: number }`（to 是存活者） */
function planMerge(hitUids) {
	if (hitUids.length < 2) return null;
	const to = Math.min(...hitUids);
	return {
		from: hitUids.filter((u) => u !== to),
		to
	};
}

export { identityCandidates, planIdentityResolution, planMerge };
