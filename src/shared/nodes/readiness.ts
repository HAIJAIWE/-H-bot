// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/** 占位节点运行时的报错文案（用户看到的） */
var PLACEHOLDER_RUNTIME_MESSAGE = "该节点尚未接入（目录里已声明、实现还没完成）：请先换用别的节点，或等待更新";
/** 未标注 status 视为 ready */
function readinessOf(spec) {
	return spec.status ?? "ready";
}
/** 这个 kind 是不是占位节点（未接入） */
function isPlaceholderKind(kind, catalog) {
	const spec = catalog.find((s) => s.kind === kind);
	return spec ? readinessOf(spec) === "placeholder" : false;
}

export { PLACEHOLDER_RUNTIME_MESSAGE, readinessOf, isPlaceholderKind };
