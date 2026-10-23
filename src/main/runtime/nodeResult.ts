// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

function isRecord(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** 把处理器返回值归一成统一判据（**唯一规则**） */
function readNodeOutcome(result) {
	if (!isRecord(result)) return {
		hasSignal: true,
		failed: false,
		error: ""
	};
	const hasSignal = "success" in result || "ok" in result || "error" in result;
	const rawError = result.error;
	const error = typeof rawError === "string" ? rawError.trim() : "";
	return {
		hasSignal,
		failed: error.length > 0 || result.success === false || result.success === void 0 && result.ok === false,
		error
	};
}

export { isRecord, readNodeOutcome };
