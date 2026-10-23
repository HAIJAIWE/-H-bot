// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { getUidMapping } from "./uidMappingService";
import { init_dataService, listPlayers } from "../project/dataService";

/** 需要处理的问题（`empty_mapping` 只是"注册了没用过"，不算问题） */
var SEVERE_KINDS = /* @__PURE__ */ new Set([
	"uid_collision",
	"orphan_data",
	"missing_mapping"
]);
/**
* 检查身份一致性。**只读**：不写文件、不修数据 —— 修不修、怎么修由用户决定。
*/
function checkIdentity(projectPath) {
	const mapping = getUidMapping(projectPath).mapping ?? {};
	const openidsByUid = /* @__PURE__ */ new Map();
	for (const [openid, uid] of Object.entries(mapping)) {
		const key = String(uid);
		if (!openidsByUid.has(key)) openidsByUid.set(key, []);
		openidsByUid.get(key).push(openid);
	}
	const players = listPlayers(projectPath);
	const dataUids = new Set(players.map((p) => String(p.qq)));
	const issues = [];
	for (const [uid, openids] of openidsByUid) if (openids.length > 1) issues.push({
		kind: "uid_collision",
		uid,
		detail: `${openids.length} 个 openid 映射到同一个 uid（${openids.map((o) => o.slice(0, 8) + "…").join(", ")}）—— 两人的存档会混在一起`
	});
	for (const uid of dataUids) if (!openidsByUid.has(uid)) {
		const p = players.find((x) => String(x.qq) === uid);
		issues.push({
			kind: "orphan_data",
			uid,
			detail: `存档里有该玩家（${p?.recordCount ?? 0} 条记录），但 uid_mapping 里没有它 —— 无法对应到任何平台用户`
		});
	}
	for (const [uid] of openidsByUid) if (!dataUids.has(uid)) issues.push({
		kind: "empty_mapping",
		uid,
		detail: "映射里有该 uid，但没有任何存档（注册了没用过）"
	});
	if (Object.keys(mapping).length === 0 && dataUids.size > 0) issues.push({
		kind: "missing_mapping",
		uid: "",
		detail: `有 ${dataUids.size} 个玩家的存档，但 uid_mapping 为空 —— 全部数据都无法对应到平台用户`
	});
	return {
		ok: !issues.some((i) => SEVERE_KINDS.has(i.kind)),
		mappedCount: Object.keys(mapping).length,
		dataPlayerCount: dataUids.size,
		issues
	};
}

export { SEVERE_KINDS, checkIdentity };
