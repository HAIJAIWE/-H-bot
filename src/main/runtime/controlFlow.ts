// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { isSubflowDefinitionNode } from "./triggerMatcher";
import { ExecContext } from "./ExecContext";
import { init_logger, logger } from "../services/infra/logger";
import { safeEvalExpression } from "./safeEval";
import { clearAbort, clearLastError, readLastError, readReturn, setLastError, takeBreak } from "./signals";
import { namedVarKey } from "../../shared/nodes/varRef";

/** 链提前返回信号（`subflow_call` / `retry_exec` 的 return 靠它跃出当前链） */
var ChainReturnError = class extends Error {
	value;
	constructor(value = null) {
		super("chain_return");
		this.value = value;
		this.name = "ChainReturnError";
	}
};
/** 默认循环最大迭代次数 */
var DEFAULT_LOOP_MAX_ITERATIONS = 1e4;
/** subflow 最大递归深度 */
var MAX_SUBFLOW_DEPTH = 16;
async function execIfBranch(host, node, ctx, bot, event, visited) {
	const nodeId = node.id;
	const config = node.data?.config ?? {};
	const valueEdge = ctx.findDataEdge(nodeId, "value");
	let upstreamValue = null;
	if (valueEdge) upstreamValue = ctx.variables[`${valueEdge.source}:${valueEdge.sourcePort}`];
	else upstreamValue = ctx.autoResolve("value");
	const variables = ctx.buildExprVariables(upstreamValue);
	const expression = config.expression ?? "";
	let result;
	if (expression) result = Boolean(safeEvalExpression(expression, variables));
	else result = Boolean(upstreamValue);
	logger.debug(`[ts-interpreter:${ctx.traceId}] branch_if ${nodeId} expression=${expression} → ${result}`);
	const branchPort = result ? "true" : "false";
	const nextNode = ctx.findControlNext(node, branchPort);
	if (nextNode) await host.execBlock(nextNode, ctx, bot, event, new Set(visited));
}
async function execLoop(host, node, ctx, bot, event, visited) {
	const nodeId = node.id;
	const config = node.data?.config ?? {};
	let mode = config.mode ?? "times";
	if (mode === "count") mode = "times";
	let maxIter = parseInt(String(config.max_iterations ?? DEFAULT_LOOP_MAX_ITERATIONS), 10);
	if (Number.isNaN(maxIter)) maxIter = DEFAULT_LOOP_MAX_ITERATIONS;
	const bodyStart = ctx.findControlNext(node, "body");
	if (mode === "while") {
		const expression = config.expression ?? "";
		let iteration = 0;
		while (iteration < maxIter) {
			ctx.variables[`${nodeId}:index`] = iteration;
			ctx.variables[`${nodeId}:count`] = maxIter;
			const valueEdge = ctx.findDataEdge(nodeId, "value");
			let upstreamValue = null;
			if (valueEdge) upstreamValue = ctx.variables[`${valueEdge.source}:${valueEdge.sourcePort}`];
			else upstreamValue = ctx.autoResolve("value");
			const variables = ctx.buildExprVariables(upstreamValue);
			if (!safeEvalExpression(expression, variables)) break;
			if (bodyStart) {
				await host.execBlock(bodyStart, ctx, bot, event, new Set(visited));
				if (takeBreak(ctx.variables)) break;
			}
			iteration++;
		}
		ctx.variables[`${nodeId}:result`] = iteration;
		return ctx.findControlNext(node, "done");
	}
	if (mode === "iterate") {
		const listEdge = ctx.findDataEdge(nodeId, "list");
		let data;
		if (!listEdge) {
			data = ctx.autoResolve("list");
			if (data === null || data === void 0) return ctx.findControlNext(node, "done");
		} else data = ctx.variables[`${listEdge.source}:${listEdge.sourcePort}`];
		let items;
		if (data && typeof data === "object" && !Array.isArray(data)) items = Object.entries(data);
		else if (Array.isArray(data)) items = data.map((v, i) => [i, v]);
		else items = [];
		if (items.length > maxIter) items = items.slice(0, maxIter);
		const total = items.length;
		for (const [key, item] of items) {
			ctx.variables[`${nodeId}:item`] = item;
			ctx.variables[`${nodeId}:key`] = key;
			ctx.variables[`${nodeId}:count`] = total;
			ctx.variables[`${nodeId}:index`] = typeof key === "number" ? key : 0;
			if (bodyStart) {
				await host.execBlock(bodyStart, ctx, bot, event, new Set(visited));
				if (takeBreak(ctx.variables)) break;
			}
		}
		return ctx.findControlNext(node, "done");
	}
	let count = parseInt(String(config.count ?? 0), 10);
	if (Number.isNaN(count)) count = 0;
	if (count > maxIter) count = maxIter;
	const total = count;
	for (let i = 0; i < count; i++) {
		ctx.variables[`${nodeId}:index`] = i;
		ctx.variables[`${nodeId}:count`] = total;
		if (bodyStart) {
			await host.execBlock(bodyStart, ctx, bot, event, new Set(visited));
			if (takeBreak(ctx.variables)) break;
		}
	}
	return ctx.findControlNext(node, "done");
}
async function execSwitchCase(host, node, ctx, bot, event, visited) {
	const nodeId = node.id;
	const config = node.data?.config ?? {};
	await host.execNormalNode(node, ctx, bot, event);
	const matched = ctx.variables[`${nodeId}:matched`];
	const matchedPort = !matched || matched === "default" ? config.default ?? "default" : matched;
	const nextNode = ctx.findControlNext(node, matchedPort);
	if (nextNode) await host.execBlock(nextNode, ctx, bot, event, new Set(visited));
	return null;
}
async function execTryCatch(host, node, ctx, bot, event, visited) {
	const nodeId = node.id;
	const tryNode = ctx.findControlNext(node, "try");
	const catchNode = ctx.findControlNext(node, "catch");
	const finallyNode = ctx.findControlNext(node, "finally");
	try {
		try {
			if (tryNode) {
				clearLastError(ctx.variables);
				clearAbort(ctx.variables);
				await host.execBlock(tryNode, ctx, bot, event, new Set(visited));
			}
			const chainError = readLastError(ctx.variables);
			if (chainError) {
				ctx.variables[`${nodeId}:error_message`] = String(chainError);
				ctx.variables[`${nodeId}:result`] = "error";
				clearAbort(ctx.variables);
				if (catchNode) await host.execBlock(catchNode, ctx, bot, event, new Set(visited));
			} else {
				ctx.variables[`${nodeId}:result`] = "ok";
				ctx.variables[`${nodeId}:error_message`] = "";
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			ctx.variables[`${nodeId}:error_message`] = msg;
			ctx.variables[`${nodeId}:result`] = "error";
			if (catchNode) await host.execBlock(catchNode, ctx, bot, event, new Set(visited));
		}
	} finally {
		if (finallyNode) try {
			await host.execBlock(finallyNode, ctx, bot, event, new Set(visited));
		} catch (e) {
			logger.warn(`[ts-interpreter:${ctx.traceId}] try_catch finally 异常: ${e instanceof Error ? e.message : e}`);
		}
	}
}
async function execRetryExec(host, node, ctx, bot, event, visited) {
	const config = node.data?.config ?? {};
	let maxRetries = parseInt(String(config.max_retries ?? 3), 10);
	if (Number.isNaN(maxRetries) || maxRetries < 1) maxRetries = 1;
	let delaySec = parseFloat(String(config.delay ?? 1));
	if (Number.isNaN(delaySec) || delaySec < 0) delaySec = 0;
	const bodyNode = ctx.findControlNext(node, "body");
	const successNode = ctx.findControlNext(node, "success");
	const failedNode = ctx.findControlNext(node, "failed");
	let lastError = "";
	let attempts = 0;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		attempts = attempt;
		if (!bodyNode) {
			lastError = "";
			break;
		}
		clearLastError(ctx.variables);
		clearAbort(ctx.variables);
		try {
			await host.execBlock(bodyNode, ctx, bot, event, new Set(visited));
		} catch (e) {
			if (e instanceof ChainReturnError) throw e;
			setLastError(ctx.variables, e instanceof Error ? e.message : String(e));
		}
		const attemptError = readLastError(ctx.variables);
		if (!attemptError) {
			lastError = "";
			break;
		}
		lastError = String(attemptError);
		if (attempt < maxRetries && delaySec > 0) await new Promise((r) => setTimeout(r, delaySec * 1e3));
	}
	clearAbort(ctx.variables);
	host.assignOutputs(node, ctx, {
		attempts,
		error: lastError
	});
	const nextNode = lastError ? failedNode : successNode;
	if (nextNode) await host.execBlock(nextNode, ctx, bot, event, new Set(visited));
}
async function execParallel(host, node, ctx, bot, event, visited) {
	let branches = (node.data?.config ?? {}).branches ?? "[]";
	let parseError = "";
	if (typeof branches === "string") try {
		branches = JSON.parse(branches);
	} catch (e) {
		parseError = `branches JSON 解析失败: ${e instanceof Error ? e.message : e}`;
		branches = [];
	}
	else if (!Array.isArray(branches)) {
		parseError = "branches 类型非法";
		branches = [];
	}
	if (!branches || branches.length === 0) {
		host.assignOutputs(node, ctx, {
			results: [],
			count: 0,
			error: parseError || "无并行分支"
		});
		const next = ctx.findControlNext(node, "out");
		if (next) await host.execBlock(next, ctx, bot, event, new Set(visited));
		return;
	}
	const subContexts = [];
	const tasks = [];
	for (const branch of branches) {
		const headId = branch?.chain_head ?? branch?.head ?? branch?.node_id;
		if (headId && !visited.has(headId)) {
			const subCtx = ctx.spawn();
			subContexts.push(subCtx);
			const headNode = ctx.nodesById.get(headId);
			if (headNode) tasks.push(host.execBlock(headNode, subCtx, bot, event, new Set(visited)));
		}
	}
	if (tasks.length > 0) {
		const results = await Promise.allSettled(tasks);
		const outputResults = [];
		const errors = [];
		results.forEach((r, i) => {
			if (r.status === "rejected") {
				const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
				errors.push(`分支${i}: ${msg}`);
				outputResults.push({
					success: false,
					error: msg
				});
			} else outputResults.push({
				success: true,
				error: ""
			});
		});
		for (const subCtx of subContexts) for (const [k, v] of Object.entries(subCtx.variables)) ctx.variables[k] = v;
		host.assignOutputs(node, ctx, {
			results: outputResults,
			count: outputResults.length,
			errors,
			error: errors.join("; ")
		});
	} else host.assignOutputs(node, ctx, {
		results: [],
		count: 0,
		error: ""
	});
	const outPorts = (node.data?.outputs ?? []).filter((p) => p.kind === "control");
	if (outPorts.length > 0) {
		const nextNode = ctx.findControlNext(node, outPorts[0].id);
		if (nextNode) await host.execBlock(nextNode, ctx, bot, event, visited);
	}
}
async function execSubflowCall(host, node, ctx, bot, event, _visited) {
	const nodeId = node.id;
	const config = node.data?.config ?? {};
	const subflowId = config.subflow_id ?? "";
	const setResult = (result, error) => {
		ctx.variables[`${nodeId}:result`] = result;
		ctx.variables[`${nodeId}:error`] = error;
	};
	if (ctx.subflowDepth >= MAX_SUBFLOW_DEPTH) {
		setResult(null, `子流程递归深度超过 ${MAX_SUBFLOW_DEPTH}，可能存在循环调用`);
		return ctx.findControlNext(node);
	}
	if (!subflowId) {
		setResult(null, "subflow_id 未配置");
		return ctx.findControlNext(node);
	}
	const defineNode = ctx.nodesById.get(subflowId);
	if (!defineNode || !isSubflowDefinitionNode(defineNode)) {
		setResult(null, `找不到 ID 为 ${subflowId} 的子流程定义`);
		return ctx.findControlNext(node);
	}
	const argsEdge = ctx.findDataEdge(nodeId, "args");
	let argsValue;
	if (argsEdge) argsValue = ctx.variables[`${argsEdge.source}:${argsEdge.sourcePort}`];
	else {
		argsValue = config.args;
		if (argsValue === null || argsValue === void 0) argsValue = ctx.autoResolve("args");
	}
	let argsDict = {};
	if (argsValue && typeof argsValue === "object" && !Array.isArray(argsValue)) argsDict = argsValue;
	else if (typeof argsValue === "string" && argsValue.trim()) try {
		const parsed = JSON.parse(argsValue);
		if (parsed && typeof parsed === "object") argsDict = parsed;
	} catch {}
	const subCtx = new ExecContext(ctx.graph, ctx.nodesById, ctx.edges, {}, ctx.traceId, void 0, void 0, ctx.subflowDepth + 1);
	for (const [k, v] of Object.entries(argsDict)) subCtx.variables[namedVarKey(k)] = v;
	try {
		const bodyStart = ctx.findControlNext(defineNode, "next") ?? ctx.findControlNext(defineNode);
		if (bodyStart) await host.execBlock(bodyStart, subCtx, bot, event, /* @__PURE__ */ new Set());
		setResult(readReturn(subCtx.variables), "");
	} catch (e) {
		if (e instanceof ChainReturnError) setResult(e.value, "");
		else setResult(null, e instanceof Error ? e.message : String(e));
	}
	return ctx.findControlNext(node);
}
/**
* 控制流终止型执行器（执行后 return，不继续走链）。
*
* ⚠️ 值是**函数引用**：改表就是改代码，打错名字编译不过（旧版是方法名字符串，见文件头）。
* `tests/runtime/control-flow-dispatch.test.ts` 做结构性校验。
*/
var CONTROL_FLOW_TERMINATING = {
	branch_if: execIfBranch,
	try_catch: execTryCatch,
	parallel_exec: execParallel,
	retry_exec: execRetryExec,
	parallelExec: execParallel
};
/** 控制流继续型执行器（返回下一个节点则继续） */
var CONTROL_FLOW_CONTINUING = {
	loop: execLoop,
	branch_switch: execSwitchCase,
	subflow_call: execSubflowCall
};

export { ChainReturnError, DEFAULT_LOOP_MAX_ITERATIONS, MAX_SUBFLOW_DEPTH, execIfBranch, execLoop, execSwitchCase, execTryCatch, execRetryExec, execParallel, execSubflowCall, CONTROL_FLOW_TERMINATING, CONTROL_FLOW_CONTINUING };
