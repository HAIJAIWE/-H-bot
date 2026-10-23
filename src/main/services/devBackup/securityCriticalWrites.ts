// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { securityCriticalEntryFor } from "../../../shared/files/securityCriticalPaths";
import { init_logger, logger } from "../infra/logger";

var MAX_ENTRIES = 50;
var writes = [];
/**
* 记一次"写到了护栏文件"。
*
* @param relativePath **框架根相对**路径（调用方已确认目标在框架根内）
* @returns 命中的那条记录；不在清单里返回 null（调用方据此决定要不要告警）
*/
function noteSecurityCriticalWrite(relativePath) {
	const entry = securityCriticalEntryFor(relativePath);
	if (!entry) return null;
	const path = relativePath.replace(/\\/g, "/");
	const item = {
		path,
		why: entry.why,
		at: (/* @__PURE__ */ new Date()).toISOString()
	};
	const idx = writes.findIndex((w) => w.path === path);
	if (idx >= 0) writes.splice(idx, 1);
	writes.unshift(item);
	if (writes.length > MAX_ENTRIES) writes.length = MAX_ENTRIES;
	logger.warn(`[devBackup] security-critical file write: ${path} — ${entry.why}`);
	return item;
}
/** 本次会话动过的护栏文件（最近一次在前） */
function listSecurityCriticalWrites() {
	return [...writes];
}

export { MAX_ENTRIES, writes, noteSecurityCriticalWrite, listSecurityCriticalWrites };
