// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { issueKey } from "../../../shared/nodes/issueBaseline";

/** 套片段的操作（要看有没有同一个片段被套两遍） */
function appliedTemplates(operations) {
	return operations.filter((op) => op.kind === "apply_template").map((op) => op.templateId);
}
/**
* 诊断开关（与 `QQBAT_PLAN_PHASE` / `QQBAT_AUTO_TX` 同一类）。
*
* 默认**关**：不设这个变量时，验证结论与提案交付路径与改造前**逐字节一致**。
* 打开：`QQBAT_PROPOSAL_SELF_CONSISTENCY=1`。
*/
var SELF_CONSISTENCY_ENV = "QQBAT_PROPOSAL_SELF_CONSISTENCY";
function isSelfConsistencyEnabled(env = process.env) {
	return env[SELF_CONSISTENCY_ENV] === "1";
}
/**
* 哪些 `code` 算"结构被弄坏"（与 `flowNormalize.validateFlow` 的 code 对齐）。
*
* 刻意只列这四条：它们都表示"图跑不起来"。别的码不参与 —— 例如
* `duplicate-command-trigger`（命令词撞车）与"删除留下的孤儿"是两回事，
* 混进来只会让这条闸门变得谁都说不清。
*/
var STRUCTURAL_BREAK_CODES = /* @__PURE__ */ new Set([
	"unreachable-node",
	"edge-missing-node",
	"edge-invalid-source-port",
	"edge-invalid-target-port"
]);
/** 给模型的指引：说清"改什么"+"别下一轮再补"+"用户明确只要删时怎么办" */
function guidanceFor(ids) {
	return "（系统）这份提案**只拆不装**：它会让 " + ids.join("、") + " 变成**不可达**（没有任何控制入口、不会被执行）。\n把**重建/接线**它们的操作放进**同一份提案**里再提一次 —— 例如 add_node + connect_nodes，或用 apply_template / new_command 建一条完整链再接到它们上面。\n⚠️ **不要**打算\"下一轮再重建\"：提案是一份一份让用户确认的，**跨提案的重建没有任何保障**（真机上就是这样永久丢了节点）。\n如果用户已经明确说过\"这些节点不要了\"，那就不要补 —— 用一句话说明，我会照这份提案交付，由用户在卡片上决定。";
}
/** 给人看的一句改法（挂在被升级的那条 issue 上） */
var INCOMPLETE_REBUILD_FIX = "它需要被重新接进流程 —— 重建/接线的操作要和这次删除放在**同一份提案**里（跨提案的重建没有任何保障）；确实要连它一起删掉的话，确认即可。";
/**
* **这份提案自不自洽**（纯函数：只读既有判据，不读盘、不调模型，可穷举测试）。
*
* @param operations 这份提案的操作
* @param introduced `validateProposalOperations` 算出来的"这次引入的问题"（**同一个来源**）
* @returns 不自洽时给出孤儿节点与给模型的指引；自洽/不适用时 `null`
*/
function findIncompleteRebuild(operations, introduced) {
	if (!operations.some((op) => op.kind === "delete_node")) return null;
	const structural = introduced.filter((i) => STRUCTURAL_BREAK_CODES.has(i.code) && !!i.nodeId);
	if (structural.length === 0) return null;
	const wiredRefs = /* @__PURE__ */ new Set();
	for (const op of operations) if (op.kind === "connect") {
		wiredRefs.add(op.sourceRef);
		wiredRefs.add(op.targetRef);
	}
	const orphans = structural.filter((i) => !wiredRefs.has(i.nodeId));
	if (orphans.length === 0) return null;
	const orphanNodeIds = [...new Set(orphans.map((i) => i.nodeId))];
	return {
		orphans,
		orphanNodeIds,
		guidance: guidanceFor(orphanNodeIds)
	};
}
/**
* **复核结论 与 静态结论的合并**（M4b × P0-5）。
*
* M4b 的既定语义是"LLM 复核结论**覆盖**静态结论"。但有一条不该被覆盖：
* **静态已经断定"这份提案会破坏结构"**（`ok === false`）时，一次语义复核说"没问题"，
* 不能把"图会坏"这个**算出来的事实**判没了 —— 那不是分歧，是复核漏了。
*
* 所以只在静态为 false 时合并：复核仍唱主角（`by`/`evidence`/它自己的问题都保留），
* 但 ok 取"与"，静态里那几条 error 并进去（按 `what` 去重）。
*/
function mergeVerdicts(structural, reviewed) {
	if (structural.ok) return reviewed;
	const missing = structural.issues.filter((s) => s.severity === "error" && !reviewed.issues.some((r) => r.what === s.what));
	return {
		...reviewed,
		ok: false,
		issues: [...reviewed.issues, ...missing]
	};
}
/**
* 静态验证：**不调模型**，只看这批操作本身 + 结构校验的结论。
*
* fail-open：拿到的东西不足以判断时，给 `ok: true` + 说明，而不是拦住提案。
*/
function buildVerdict(operations, validation) {
	const issues = [];
	const templates = appliedTemplates(operations);
	const seen = /* @__PURE__ */ new Set();
	for (const id of templates) {
		if (seen.has(id)) issues.push({
			severity: "error",
			what: `片段「${id}」被套用了两次 —— 会产生两条重复的链`,
			howToFix: "删掉其中一次 apply_template；要改就在原链上改（update_node），别重套",
			ref: id
		});
		seen.add(id);
	}
	const introduced = validation?.introduced ?? [];
	/**
	* P0-5 **提案自洽**：会破坏结构的删除，必须与重建在同一份提案里。
	*
	* 这里**不新造判据** —— 用的就是上面那份 `introduced`（提案卡片上那个数字的同一来源），
	* 只把「被留下当孤儿」的那几条**升级成 error**（同一 `issueKey`、同一条 `message`，不新增条目）。
	* 升级而不是硬拦：界面据此把确认按钮降级为「需二次确认」，**要不要就这么提交由用户决定**。
	*/
	const incomplete = isSelfConsistencyEnabled() ? findIncompleteRebuild(operations, introduced) : null;
	const escalatedKeys = new Set((incomplete?.orphans ?? []).map((i) => issueKey(i)));
	for (const issue of introduced) {
		if (issue.severity !== "error") continue;
		const escalated = escalatedKeys.has(issueKey(issue));
		issues.push({
			severity: "error",
			what: issue.message,
			howToFix: escalated ? INCOMPLETE_REBUILD_FIX : issue.fixHint ?? "按提示修掉这条问题再确认",
			...issue.nodeId ? { ref: issue.nodeId } : {}
		});
	}
	const warns = introduced.filter((i) => i.severity !== "error");
	const escalatedWarns = warns.filter((i) => escalatedKeys.has(issueKey(i)));
	const plainWarns = warns.filter((i) => !escalatedKeys.has(issueKey(i))).slice(0, 5);
	for (const issue of [...escalatedWarns, ...plainWarns]) {
		const escalated = escalatedKeys.has(issueKey(issue));
		issues.push({
			severity: escalated ? "error" : "warn",
			what: issue.message,
			howToFix: escalated ? INCOMPLETE_REBUILD_FIX : issue.fixHint ?? "确认是否符合预期",
			...issue.nodeId ? { ref: issue.nodeId } : {}
		});
	}
	return {
		ok: !issues.some((i) => i.severity === "error"),
		issues,
		evidence: [
			`操作 ${operations.length} 条`,
			`结构校验：错误 ${introduced.filter((i) => i.severity === "error").length} / 提醒 ${warns.length}`,
			...incomplete ? [`只拆不装：${incomplete.orphanNodeIds.join("/")} 会被留下不可达`] : [],
			"静态验证（未调用模型）"
		].join("；"),
		by: "static"
	};
}

/** 计划阶段的自我修复最多重跑几轮（与文档一致：≤2） */
export const MAX_PLAN_FIX_KICKS = 2;

export { appliedTemplates, SELF_CONSISTENCY_ENV, isSelfConsistencyEnabled, STRUCTURAL_BREAK_CODES, guidanceFor, INCOMPLETE_REBUILD_FIX, findIncompleteRebuild, mergeVerdicts, buildVerdict };
