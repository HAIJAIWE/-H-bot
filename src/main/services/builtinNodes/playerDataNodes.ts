// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { variablePersist } from "./dataNodes";

/** 拆出来的每个节点负责哪些模式（越界 → 明确报错，不静默兜底） */
var PLAYER_DATA_MODES = {
	load_variable: [
		"load",
		"load_or_default",
		"batch_load"
	],
	save_variable: [
		"save",
		"batch_save",
		"batch_update"
	],
	incr_variable: ["increment"],
	update_if_variable: ["compare_update"],
	append_variable: ["list_append"],
	delete_variable: ["delete"],
	exists_variable: ["exists"]
};
async function runPlayerData(kind, bot, event, opts = {}) {
	const allowed = PLAYER_DATA_MODES[kind];
	const mode = String(opts.mode ?? allowed[0]);
	if (!allowed.includes(mode)) return {
		success: false,
		error: `节点「${kind}」不支持模式「${mode}」（可选：${allowed.join(" / ")}）`,
		result: null
	};
	return variablePersist(bot, event, mode, String(opts.key ?? ""), opts.value ?? null, String(opts.scope ?? "user"), Number(opts.ttl ?? 0), opts.default ?? null, Number(opts.amount ?? 1), opts.auto_save !== false, Number(opts.max_length ?? 0), String(opts.data ?? ""), String(opts.compare_op ?? ">="), Number(opts.threshold ?? 1), Number(opts.delta ?? -1), opts.keys ?? "[]", opts.item ?? null);
}
/** 读玩家数据：读 / 带默认值读 / 批量读 */
function loadVariable(bot, event, opts = {}) {
	return runPlayerData("load_variable", bot, event, opts);
}
/** 写玩家数据：存 / 批量存 / 多键原子更新 */
function saveVariable(bot, event, opts = {}) {
	return runPlayerData("save_variable", bot, event, opts);
}
/** 自增（原子） */
function incrVariable(bot, event, opts = {}) {
	return runPlayerData("incr_variable", bot, event, opts);
}
/** 条件更新（比较 + 增量，防超卖） */
function updateIfVariable(bot, event, opts = {}) {
	return runPlayerData("update_if_variable", bot, event, opts);
}
/** 列表追加（可限长） */
function appendVariable(bot, event, opts = {}) {
	return runPlayerData("append_variable", bot, event, opts);
}
/** 删玩家数据 */
function deleteVariable(bot, event, opts = {}) {
	return runPlayerData("delete_variable", bot, event, opts);
}
/** 判断存在 */
function existsVariable(bot, event, opts = {}) {
	return runPlayerData("exists_variable", bot, event, opts);
}

export { PLAYER_DATA_MODES, runPlayerData, loadVariable, saveVariable, incrVariable, updateIfVariable, appendVariable, deleteVariable, existsVariable };
