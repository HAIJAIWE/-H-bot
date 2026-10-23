// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { StateStore } from "../project/stateStore";
import { getConfigTable } from "../project/configService";

/** 高危能力 → 影响面估算。**没有登记的能力不许提案**（由闸门钉住）。 */
var IMPACT_ESTIMATORS = {
	/** 清空运行状态：把当前有多少键、多少个会话摆出来 */
	"stateStore.clearAll": (_args, projectPath) => {
		const store = StateStore.getInstance();
		const stateCount = store.getStateCount(projectPath);
		const sessionCount = store.getSessionCount(projectPath);
		const total = stateCount + sessionCount;
		return {
			level: total > 0 ? "bulk" : "none",
			summary: total > 0 ? `将清空 ${stateCount} 个状态键与 ${sessionCount} 个会话（清空后无法恢复）` : "当前没有状态键与会话，实际影响为零",
			counts: {
				stateCount,
				sessionCount
			}
		};
	},
	/** 发消息：有界（1 条），但要把"发给谁、多长"说清楚——群发风险靠 target 白名单挡 */
	"official.sendMessage": (args) => {
		const chatId = typeof args.chatId === "string" ? args.chatId : "";
		const content = typeof args.content === "string" ? args.content : "";
		return {
			level: "single",
			summary: `将向 ${chatId || "(未指定会话)"} 发送 **1 条**消息（正文 ${content.length} 字）`,
			counts: {
				messages: 1,
				chars: content.length
			}
		};
	},
	/** 删除配置表：先数这张表有多少行——这正是"删除表"和"删除 1 行"的区别 */
	"launchConfig.dropTable": (args, projectPath) => {
		const category = typeof args.category === "string" ? args.category : "";
		if (!category) return {
			level: "single",
			summary: "未提供 category，无法预估将删除多少行"
		};
		const total = getConfigTable(projectPath, category, 1, 1).total;
		return {
			level: total > 0 ? "bulk" : "single",
			summary: `将删除配置表「${category}」的全部 ${total} 行（整表删除，不可恢复）`,
			counts: { rows: total }
		};
	}
};
/**
* 估算一条高危能力的影响面。
*
* @returns 估算结果；**返回 null = 算不出来**（未登记 / 抛错），调用方必须据此拒绝提案。
*/
function estimateImpact(id, args, projectPath) {
	const estimator = IMPACT_ESTIMATORS[id];
	if (!estimator) return null;
	try {
		return estimator(args, projectPath);
	} catch {
		return null;
	}
}

export { IMPACT_ESTIMATORS, estimateImpact };
