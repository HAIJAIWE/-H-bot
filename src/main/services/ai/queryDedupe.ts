// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

/** 无参调用代表「全量」的工具（其余工具有没有这种包含关系要单独确认，别想当然） */
var FULL_SCOPE_QUERY_TOOLS = /* @__PURE__ */ new Set(["read_flow", "list_nodes"]);
/** 参数 cache 的 key 形状 —— 与 chatRun 里的写法保持一致（就一个地方生成） */
function queryCacheKey(toolName, args) {
	return toolName + ":" + JSON.stringify(args ?? {});
}
/** 无参调用的 key（代表全量那次） */
function fullScopeKey(toolName) {
	return queryCacheKey(toolName, {});
}
/**
* 这次调用是不是「已经查过更大范围」的重复。
*
* @param cache 本次运行里真正执行过的查询 key 集合（chatRun 的 state.queryCache）
*/
function isSubsumedByFullScope(toolName, args, cache) {
	if (!FULL_SCOPE_QUERY_TOOLS.has(toolName)) return false;
	if (Object.keys(args ?? {}).length === 0) return false;
	return cache.has(fullScopeKey(toolName));
}

export { FULL_SCOPE_QUERY_TOOLS, queryCacheKey, fullScopeKey, isSubsumedByFullScope };
