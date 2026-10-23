// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { emitBotLog, emitNodeEvent } from "../services/runner/runtimeEvents";
import { readNodeOutcome } from "./nodeResult";
import { init_logger, logger } from "../services/infra/logger";

/** 造一组节点事件出口（工厂：项目路径被捕获一次） */
function createNodeEvents(projectPath) {
	function emit(nodeId, status, traceId, duration, message) {
		try {
			emitNodeEvent(projectPath, {
				nodeId,
				timestamp: (/* @__PURE__ */ new Date()).toISOString(),
				status,
				...duration !== void 0 ? { duration } : {},
				...message ? { message } : {},
				...traceId ? { traceId } : {}
			});
		} catch (e) {
			logger.debug(`[ts-interpreter] 节点事件广播失败: ${String(e)}`);
		}
	}
	function reportFailure(nodeId, nodeKind, result, traceId, duration) {
		if (!result || typeof result !== "object") return;
		const outcome = readNodeOutcome(result);
		if (!outcome.failed) return;
		const errorMsg = outcome.error || `${nodeKind} 报告执行失败，但没有给出原因（建议补上 error 文案）`;
		const success = result.success;
		const level = success === true ? "warn" : "error";
		emitBotLog(projectPath, `[节点 ${nodeId} ${nodeKind}] 返回失败: ${errorMsg}`, level, traceId);
		if (success !== true) emit(nodeId, "error", traceId, duration, errorMsg);
	}
	return {
		emit,
		reportFailure
	};
}

export { createNodeEvents };
