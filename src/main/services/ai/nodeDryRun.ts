// @ts-nocheck
// 由 10/18 打包产物还原（chunk: aiNodeScaffold-BkYa_pGY.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";
import { getDryRunHandler, registerDynamicHandler, unregisterDynamicHandler } from "../../runtime/dynamicHandlers";
import { allProtocolApiEntries } from "./protocolApiCatalog";
import { NODE_CATALOG_V2 } from "../../../shared/nodes/builtinCatalog";

var DRY_RUN_TIMEOUT_MS = 3e3;
/**
* 干跑一次 handler。
*
* @param kind     目标节点 kind（内部会用 `<kind>__dryrun` 注册，**不会覆盖真节点**）
* @param handler  JS 函数表达式源码
* @param config   节点配置（成为沙箱里的 ctx.config）
* @param inputs   上游数据端口值（沙箱把同一个 kwargs 同时当 config 与 inputs 用，见 sandbox.ts）
* @param outputs  声明的端口（用于校验返回值覆盖）
* @param projectPath 项目路径（沙箱 ctx.projectPath）
*/
async function dryRunAiNode(params) {
	const empty = (over) => ({
		ok: false,
		apiCalls: [],
		unknownApis: [],
		adapterOnlyApis: [],
		builtinCalls: [],
		unknownBuiltins: [],
		returnedKeys: [],
		missingPorts: [],
		timedOut: false,
		...over
	});
	const tmpKind = `${params.kind}__dryrun`;
	const reg = registerDynamicHandler(tmpKind, params.handler);
	if (!reg.ok) return empty({ error: reg.error ?? "干跑注册失败" });
	const recorder = {
		apiCalls: [],
		builtinCalls: []
	};
	const fn = getDryRunHandler(tmpKind, recorder);
	if (!fn) {
		unregisterDynamicHandler(tmpKind);
		return empty({ error: "干跑 handler 未就绪（worker 未启动？）" });
	}
	const stubBot = {
		self_id: "dry-run",
		callApi: async () => ({ dryRun: true })
	};
	const event = {
		post_type: "message",
		message_type: "group",
		raw_message: "/示例",
		user_id: 0,
		group_id: 0,
		self_id: 0,
		message: []
	};
	const kwargs = { ...params.config ?? {} };
	for (const [k, v] of Object.entries(params.inputs ?? {})) if (!(k in kwargs)) kwargs[k] = v;
	const ctx = {
		projectPath: params.projectPath,
		event,
		ctx: {}
	};
	let timedOut = false;
	let result;
	let error;
	try {
		result = await Promise.race([Promise.resolve(fn(stubBot, event, kwargs, ctx)), new Promise((_, reject) => setTimeout(() => {
			timedOut = true;
			reject(/* @__PURE__ */ new Error(`干跑超时（>${DRY_RUN_TIMEOUT_MS}ms）—— handler 里可能有未 await 的调用或死循环`));
		}, DRY_RUN_TIMEOUT_MS))]);
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		unregisterDynamicHandler(tmpKind);
	}
	const isPlainObject = typeof result === "object" && result !== null && !Array.isArray(result);
	const returnedKeys = isPlainObject ? Object.keys(result) : [];
	const known = new Set(allProtocolApisSafe());
	const unknownApis = [...new Set(recorder.apiCalls)].filter((n) => !known.has(n));
	const unsupportedNames = new Set(allProtocolApiEntries().filter((e) => e.officialUnsupported).map((e) => e.name));
	const adapterOnlyApis = [...new Set(recorder.apiCalls)].filter((n) => unsupportedNames.has(n));
	const knownBuiltins = new Set(NODE_CATALOG_V2.map((n) => n.kind));
	const unknownBuiltins = [...new Set(recorder.builtinCalls)].filter((k) => !knownBuiltins.has(k));
	const missingPorts = (params.outputs ?? []).filter((p) => p.kind !== "control").filter((p) => !returnedKeys.includes(p.id)).map((p) => p.id);
	const errors = [];
	if (error) errors.push(`干跑抛错：${error}`);
	if (!error && !isPlainObject) errors.push("handler 必须返回一个对象（key 与数据输出端口 id 一致）");
	if (unknownApis.length > 0) errors.push(`调用了清单里不存在的协议端 API：${unknownApis.join("、")} —— 运行时会失败，请改用清单里的名字`);
	if (unknownBuiltins.length > 0) errors.push(`调用了不存在的内置节点：${unknownBuiltins.join("、")} —— 请用 list_nodes 查真实 kind`);
	if (missingPorts.length > 0) errors.push(`返回值缺少端口：${missingPorts.join("、")}（outputs 声明了但没给值，下游会拿到 undefined）`);
	const out = {
		ok: errors.length === 0,
		apiCalls: recorder.apiCalls,
		unknownApis,
		adapterOnlyApis,
		builtinCalls: recorder.builtinCalls,
		unknownBuiltins,
		returnedKeys,
		missingPorts,
		timedOut,
		...errors.length > 0 ? { error: errors.join("；") } : {}
	};
	if (!out.ok) logger.info(`[nodeDryRun] ${params.kind} 自检未通过：${out.error}`);
	return out;
}
/** 清单读取加一层保护：目录文件坏了也不该让自检崩（那会把整轮 AI 卡死） */
function allProtocolApisSafe() {
	try {
		return allProtocolApiEntries().map((e) => e.name);
	} catch (e) {
		logger.warn("[nodeDryRun] 协议端 API 清单读取失败：" + (e instanceof Error ? e.message : String(e)));
		return [];
	}
}

export { DRY_RUN_TIMEOUT_MS, dryRunAiNode, allProtocolApisSafe };
