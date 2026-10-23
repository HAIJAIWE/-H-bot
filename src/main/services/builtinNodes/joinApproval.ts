// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
// 这两个校验器原本长在 official.ts（10/18 产物里同一模块），恢复时误指到 persistentStore；
// 构建期 rolldown 会报 MISSING_EXPORT，故按真实定义处引入。
import { validateStrategyGroups, validateWhitelistUsers } from "../official";

/** 模式 → 翻译器 action。**这里是模式清单的唯一实现映射**，改模式必须同时改这里。 */
var MODE_ACTION = {
	list: "list_join_approval_strategies",
	create: "create_join_approval_strategy",
	update: "update_join_approval_strategy",
	delete: "delete_join_approval_strategy",
	execute: "execute_join_approval_strategy",
	whitelist: "update_strategy_whitelist"
};
/** 需要 strategy_id 的模式：缺了就地报错，别让官方回一句"请求参数异常" */
var NEEDS_STRATEGY_ID = [
	"update",
	"delete",
	"execute",
	"whitelist"
];
/** 有内容才算「填了」：空串 / 空数组 / 全是空白都当没填（update 分支用它判断要不要校验关联群） */
function hasAny(v) {
	if (Array.isArray(v)) return v.some((x) => String(x).trim() !== "");
	return String(v ?? "").trim() !== "";
}
async function joinApproval(bot, _event = null, options = {}) {
	const mode = String(options.mode ?? "list");
	const action = MODE_ACTION[mode];
	if (!action) return {
		success: false,
		data: null,
		error: `未知的策略模式: ${mode}（可选 ${Object.keys(MODE_ACTION).join(" / ")}）`
	};
	const strategyId = String(options.strategy_id ?? "").trim();
	if (NEEDS_STRATEGY_ID.includes(mode) && !strategyId) return {
		success: false,
		data: null,
		error: `「${mode}」模式需要填写策略 ID（先用「查询策略列表」拿到）`
	};
	const params = { mode };
	switch (mode) {
		case "list":
			params.cursor = String(options.cursor ?? "");
			params.limit = Number(options.limit) || void 0;
			break;
		case "create": {
			const groups = validateStrategyGroups({
				groupOpenids: options.group_openids,
				groupIds: options.group_ids
			});
			if (!groups.ok) return {
				success: false,
				data: null,
				error: groups.error
			};
			params.group_openids = groups.value.group_openids;
			params.group_ids = groups.value.group_ids;
			params.is_enable = String(options.is_enable ?? "on");
			params.expire_at = String(options.expire_at ?? "");
			params.remark = String(options.remark ?? "");
			break;
		}
		case "update":
			if (!(String(options.is_enable ?? "") !== "" || String(options.expire_at ?? "") !== "" || String(options.remark ?? "") !== "" || String(options.group_op ?? "") !== "")) return {
				success: false,
				data: null,
				error: "「修改策略」至少填一项：启用状态 / 过期时间 / 备注 / 关联群操作"
			};
			params.strategy_id = strategyId;
			params.is_enable = options.is_enable;
			params.expire_at = String(options.expire_at ?? "");
			params.remark = String(options.remark ?? "");
			params.group_op = String(options.group_op ?? "");
			if (hasAny(options.group_openids) || hasAny(options.group_ids)) {
				const groups = validateStrategyGroups({
					groupOpenids: options.group_openids,
					groupIds: options.group_ids
				});
				if (!groups.ok) return {
					success: false,
					data: null,
					error: groups.error
				};
				params.group_openids = groups.value.group_openids;
				params.group_ids = groups.value.group_ids;
			}
			break;
		case "delete":
		case "execute":
			params.strategy_id = strategyId;
			break;
		case "whitelist": {
			const wl = validateWhitelistUsers(options.op ?? "add", options.whitelist_users);
			if (!wl.ok) return {
				success: false,
				data: null,
				error: wl.error
			};
			params.strategy_id = strategyId;
			params.op = wl.value.op;
			params.whitelist_users = wl.value.whitelist_users;
			break;
		}
	}
	try {
		return {
			success: true,
			data: await bot.callApi(action, params) ?? {},
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			data: null,
			error: `入群自动审批策略操作失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}

export { MODE_ACTION, NEEDS_STRATEGY_ID, hasAny, joinApproval };
