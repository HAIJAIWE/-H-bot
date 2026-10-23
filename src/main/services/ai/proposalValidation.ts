// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as node_path from "node:path";
import * as node_fs from "node:fs";
import * as node_fs_promises from "node:fs/promises";
import { issueKey, issueKeySet } from "../../../shared/nodes/issueBaseline";
import { applyPendingOperations } from "./pendingGraph";
import { init_logger, logger } from "../infra/logger";
import { normalizeFlow, validateFlow } from "../../../shared/nodes/flowNormalize";

/**
* 算出「这批操作**引入**了哪些结构问题」。
*
* @returns 校验结果；拿不到图或校验失败时返回 `undefined`（调用方照常发提案）
*/
async function validateProposalOperations(projectPath, operations) {
	if (operations.length === 0) return void 0;
	try {
		const flowPath = (0, node_path.join)(projectPath, ".qqbat", "flow.json");
		if (!(0, node_fs.existsSync)(flowPath)) return void 0;
		const base = JSON.parse(await (0, node_fs_promises.readFile)(flowPath, "utf-8"));
		const baseGraph = normalizeFlow(base).graph;
		const baseIssues = validateFlow(baseGraph);
		const baseKeys = issueKeySet(baseIssues);
		const overlay = applyPendingOperations(base, operations);
		const afterGraph = normalizeFlow(overlay.graph).graph;
		return {
			introduced: validateFlow(afterGraph).filter((i) => !baseKeys.has(issueKey(i))),
			preexisting: baseIssues.length,
			checkedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	} catch (e) {
		logger.warn(`[ai] 提案校验失败（不阻断提案）: ${String(e)}`);
		return;
	}
}

export { validateProposalOperations };
