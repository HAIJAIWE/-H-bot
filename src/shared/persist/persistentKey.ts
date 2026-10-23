// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

var USER_PREFIX = "user_";
var GROUP_PREFIX = "group_";
/**
* 拼出存储用的完整 key —— **唯一入口**。
*
* `user_<user_id>:<key>` / `group_<group_id>:<key>` / global 直接是 `<key>`。
*/
function buildKey(key, scope, identity) {
	if (scope === "user") {
		const uid = identity?.user_id;
		if (!uid) throw new Error("user scope 需要 event.user_id");
		return `${USER_PREFIX}${uid}:${key}`;
	}
	if (scope === "group") {
		const gid = identity?.group_id;
		if (!gid) throw new Error("group scope 需要 event.group_id");
		return `${GROUP_PREFIX}${gid}:${key}`;
	}
	if (scope === "global") return key;
	throw new Error(`非法 scope: ${String(scope)}`);
}
/**
* 拆解完整 key → `{ key, scope, owner }`。
*
* 与 {@link buildKey} **互为逆运算**（由不变量测试锁定）。
* 无法识别的形状按 global 处理（老数据/手工写入的 key 不至于因此丢失）。
*/
function parseKey(fullKey) {
	const m = /^(user|group)_([^:]+):(.*)$/.exec(fullKey);
	if (!m) return {
		key: fullKey,
		scope: "global",
		owner: null
	};
	const scope = m[1];
	return {
		key: m[3],
		scope,
		owner: m[2]
	};
}
/**
* 由**完整 key** 派生要写进表里的 `scope` / `qq` 两列。
*
* ⚠️ 列必须这样派生，**不能**再独立算一次（原来 `saveValue` 就是独立算的 ✗ ——
* 两处算法一分歧，查询就会按列筛空）。
* `qq` 只对 user 有值（保持既有表语义：group 行的 qq 为 null）。
*/
function columnsForKey(fullKey) {
	const parsed = parseKey(fullKey);
	return {
		scope: parsed.scope,
		qq: parsed.scope === "user" ? parsed.owner : null
	};
}
/**
* 某个 scope 的查询谓词（**唯一定义**）—— 给 `query` 节点用。
*
* 语义：user/group 按**带身份的前缀**筛（`user_12345:%`）；global 用 `scope = 'global'` 列筛
* （global 的 key 没有前缀，靠列区分最可靠；而列的取值由 {@link columnsForKey} 保证一致）；
* all 不加条件（跨玩家排行榜）。
*/
function scopeQuery(scope, identity) {
	if (scope === "all") return {};
	if (scope === "user" || scope === "group") return { prefixLike: `${scopePrefixFor(scope, identity)}%` };
	return { columnScope: "global" };
}
/** 身份前缀（给 `query` 的"只查当前用户/群"用） */
function scopePrefixFor(scope, identity) {
	if (scope === "user") return `${USER_PREFIX}${identity?.user_id ?? ""}:`;
	if (scope === "group") return `${GROUP_PREFIX}${identity?.group_id ?? ""}:`;
	return "";
}

export { USER_PREFIX, GROUP_PREFIX, buildKey, parseKey, columnsForKey, scopeQuery, scopePrefixFor };
