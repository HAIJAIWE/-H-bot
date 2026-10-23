// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { normalizePortValueForRuntime } from "./portValue";
import { getHandler } from "./handlerRegistry";
import { emitBotLog } from "../services/runner/runtimeEvents";
import { init_logger, logger } from "../services/infra/logger";
import { NODE_CATALOG_V2 } from "../../shared/nodes/builtinCatalog";
import { refToVarKey } from "../../shared/nodes/varRef";

/**
* 需要拿到**命名变量**的节点（解释器把 `ctx.variables` 里的 `__var__:<名>` 去前缀后
* 合并进 `kwargs.variables_json`，handler 侧由 `mergePortVars` 当变量表底值读）。
*
* - `expression_eval` / `format_text`：目录里有 `variables_json` 端口，本就是变量表入口；
* - `message_send`：**没有**这个端口（只有 `var1`~`var4`），但它是真机上最主要的出话口，
*   没有它命名变量就没法出现在消息里。
*
* 新增节点时请注意：能读 `{名}` 或表达式的节点才放进来，否则只是白写一个没人读的 kwargs 键。
*/
var NAMED_VAR_CONSUMERS = /* @__PURE__ */ new Set([
	"expression_eval",
	"format_text",
	"message_send"
]);
function resolveDataPortIds(node, nodeKind, inputs, config) {
	const declared = inputs.filter((p) => p.kind === "data").map((p) => p.id);
	if (declared.length > 0) return declared;
	const fromCatalog = (NODE_CATALOG_V2.find((s) => s.kind === nodeKind)?.inputs ?? []).filter((p) => p.kind === "data").map((p) => p.id);
	if (fromCatalog.length > 0) {
		logger.debug(`[ts-interpreter] 节点 ${node.id} (${nodeKind}) 缺少端口定义，已按节点目录补全 ${fromCatalog.length} 个入参`);
		return fromCatalog;
	}
	return Object.keys(config);
}
async function resolveInputKwargs(projectPath, node, ctx, bot, event, _handler) {
	const nodeId = node.id;
	const nodeKind = node.data?.nodeKind ?? "";
	const inputs = node.data?.inputs ?? [];
	const config = node.data?.config ?? {};
	const dataPortIds = resolveDataPortIds(node, nodeKind, inputs, config);
	const kwargs = {};
	for (const portId of dataPortIds) {
		const edge = ctx.findDataEdge(nodeId, portId);
		let value;
		if (edge) {
			if (edge.source === "__config_api__" && edge.configApi) value = await resolveConfigApiValue(projectPath, edge, ctx, bot, event);
			else value = ctx.variables[`${edge.source}:${edge.sourcePort}`];
		} else {
			value = config[portId];
			if (inputs.length === 0 && (value === null || value === void 0 || value === "" || value === "\"\"")) {
				const autoValue = ctx.autoResolve(portId);
				if (autoValue !== null && autoValue !== void 0) value = autoValue;
			}
		}
		const portDataType = inputs.find((p) => p.id === portId)?.dataType ?? NODE_CATALOG_V2.find((s) => s.kind === nodeKind)?.inputs.find((p) => p.id === portId)?.dataType;
		const normalized = normalizePortValueForRuntime(value, portDataType);
		if (!normalized.ok) throw new Error(`节点 ${nodeId}（${nodeKind}）的端口「${portId}」值不合法：${normalized.error}`);
		kwargs[portId] = normalized.value;
	}
	for (const [key, value] of Object.entries(config)) if (!(key in kwargs) && value !== void 0) kwargs[key] = value;
	if (NAMED_VAR_CONSUMERS.has(nodeKind)) {
		const globalVars = ctx.collectGlobalVars();
		if (Object.keys(globalVars).length > 0) {
			const existing = kwargs.variables_json;
			if (existing && typeof existing === "object" && !Array.isArray(existing)) kwargs.variables_json = {
				...globalVars,
				...existing
			};
			else if (typeof existing === "string" && existing.trim()) try {
				const parsed = JSON.parse(existing);
				if (parsed && typeof parsed === "object") kwargs.variables_json = {
					...globalVars,
					...parsed
				};
			} catch {}
			else kwargs.variables_json = globalVars;
		}
	}
	if (nodeKind === "expression_eval") {
		if (kwargs.mode === null || kwargs.mode === void 0) {
			const modeCfg = config.mode;
			if (modeCfg !== void 0) kwargs.mode = modeCfg;
		}
		if (kwargs.formulas === null || kwargs.formulas === void 0) {
			const formulasCfg = config.formulas;
			if (formulasCfg !== void 0) kwargs.formulas = formulasCfg;
		}
	}
	return kwargs;
}
async function resolveConfigApiValue(projectPath, edge, ctx, _bot, _event) {
	const api = edge.configApi ?? {};
	const table = api.table ?? "";
	const field = api.field ?? "";
	const dbPath = api.dbPath ?? "";
	const where = api.where ?? "";
	const mode = api.mode ?? "query";
	const isQueryAll = mode === "query_all";
	const isQueryRow = mode === "query_row";
	if (!table || !dbPath) return isQueryAll ? [] : null;
	const whereParams = [];
	const ref = api.whereParamRef;
	if (ref && typeof ref === "object") {
		if ("literalValue" in ref) whereParams.push(ref.literalValue);
		else {
			const key = refToVarKey(ref);
			if (key) {
				const refValue = ctx.variables[key];
				if (refValue !== void 0 && refValue !== null) whereParams.push(refValue);
			}
		}
	}
	const dbHandler = getHandler("database_write");
	if (!dbHandler) return isQueryAll ? [] : null;
	try {
		const result = await dbHandler(_bot, _event, {
			mode: "select",
			table,
			condition: where,
			db_path: dbPath,
			where_params: whereParams,
			result_field: field,
			limit: isQueryAll ? 1e3 : 1,
			order: typeof api.order === "string" ? api.order : ""
		}, {
			projectPath,
			ctx,
			event: _event
		});
		if (!result?.success) return isQueryAll ? [] : null;
		if (isQueryAll) return result.rows ?? [];
		if (isQueryRow) return (result.rows ?? [])[0] ?? null;
		return result.value ?? null;
	} catch (e) {
		logger.warn(`[ts-interpreter] 配置 API 查询失败: ${e instanceof Error ? e.message : e}`);
		return isQueryAll ? [] : null;
	}
}
function normalizeOutputValue(projectPath, nodeId, port, value) {
	if (value === null || value === void 0) return value;
	const r = normalizePortValueForRuntime(value, port.dataType);
	if (r.ok) return r.value;
	const msg = `节点 ${nodeId} 的输出端口「${port.id}」（声明 ${String(port.dataType)}）返回了不合类型的值：${r.error}`;
	logger.warn(`[ts-interpreter] ${msg}`);
	emitBotLog(projectPath, `[节点 ${nodeId}] ${msg}`, "warn");
	return value;
}
function assignOutputs(projectPath, node, ctx, result) {
	const nodeId = node.id;
	const dataOutputs = (node.data?.outputs ?? []).filter((p) => p.kind === "data");
	if (dataOutputs.length > 0) {
		if (dataOutputs.length === 1) ctx.variables[`${nodeId}:${dataOutputs[0].id}`] = normalizeOutputValue(projectPath, nodeId, dataOutputs[0], result);
		else {
			if (!result || typeof result !== "object" || Array.isArray(result)) {
				ctx.variables[`${nodeId}:${dataOutputs[0].id}`] = result;
				return;
			}
			for (const port of dataOutputs) ctx.variables[`${nodeId}:${port.id}`] = normalizeOutputValue(projectPath, nodeId, port, result[port.id]);
		}
		return;
	}
	if (result && typeof result === "object" && !Array.isArray(result)) {
		for (const [key, value] of Object.entries(result)) ctx.variables[`${nodeId}:${key}`] = value;
		if (!("result" in result)) ctx.variables[`${nodeId}:result`] = result;
	} else {
		ctx.variables[`${nodeId}:result`] = result;
		ctx.variables[`${nodeId}:out`] = result;
	}
}

export { NAMED_VAR_CONSUMERS, resolveDataPortIds, resolveInputKwargs, resolveConfigApiValue, normalizeOutputValue, assignOutputs };
