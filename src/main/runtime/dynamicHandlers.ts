// @ts-nocheck
// 由 10/18 打包产物还原（chunk: dynamicHandlers-BJxkF_cY.js）；见 _recovery/README-recovery.md
import vm from "vm";
import { getUntrustedWorkerHost } from "./untrustedWorkerHost";
import { denyReason } from "./pluginPermissions";
import { init_logger, logger } from "../services/infra/logger";

/** 单次调用超时（毫秒）：由**主进程侧**计时（子进程已经不可信，它自己说了不算） */
var DEFAULT_CALL_TIMEOUT_MS = 3e4;
/**
* 当前调用超时。允许环境变量覆盖 —— 只为测试能跑"死循环 → 超时"这条路径，
* 生产默认仍是 30s。
*/
function callTimeoutMs() {
	const raw = Number(process.env.QQBAT_NODE_CALL_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CALL_TIMEOUT_MS;
}
/** 把异常转成可读消息 */
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
/** 本地注册表：kind → handler 源码。worker 崩溃重启后由 host 按它重放 */
var REGISTERED = /* @__PURE__ */ new Map();
/** kind → 这一版在 worker 里的编译/注册 Promise（invoke 前 await 它） */
var REGISTER_PROMISES = /* @__PURE__ */ new Map();
/**
* invokeId → 本次调用的宿主侧上下文（桥用它把 callBuiltin/callApi 路由回来）。
*
* `permissions` / `pluginName` 只有**纯代码插件的 handler** 会带上（P0-11）：
* 宿主桥在真正执行能力调用之前按它做白名单校验。**undefined = 老通道（节点 handler）**，
* 不限制 —— 老插件的脚手架一律生成 `permissions: []`，严格执行会让它们全部失去 callBuiltin。
*/
var ACTIVE = /* @__PURE__ */ new Map();
/**
* **干跑登记表**：invokeId → 本次干跑收集到的调用记录。
*
* 为什么必须在这里拦（2026-10-10）：`ctx.bot.callApi` 走 `active.bot`，传个假 bot 就拦住了；
* 但 `ctx.callBuiltin` 走的是**全局** `builtinResolver` —— 干跑一个会 `callBuiltin('message_send')` 的
* 节点会**真的往群里发消息**。改全局 resolver 又和正在跑的流程抢，所以按 invokeId 判定。
*/
var DRY_RUN = /* @__PURE__ */ new Map();
/**
* 内置 handler 解析器（由 handlerRegistry 在模块初始化时注入）。
*
* 用于向 worker 里的节点暴露 callBuiltin(kind, kwargs)：自建节点（含从内置节点
* fork 出来的节点）需要能调用内置能力（发消息、读写库等）。
* 只解析**静态内置表**，避免与 getHandler 的动态回退形成递归。
*/
var builtinResolver = null;
/** 由 handlerRegistry 注入内置 handler 解析器 */
function setBuiltinResolver(fn) {
	builtinResolver = fn;
}
/** 进程级 worker 宿主（与测试共用） */
var host = getUntrustedWorkerHost();
host.setChildCallHandler(async (req) => {
	const active = ACTIVE.get(req.invokeId);
	if (!active) throw new Error("调用上下文已结束（callBuiltin / bot.callApi 必须在本次调用内等待）");
	const dry = DRY_RUN.get(req.invokeId);
	if (dry) {
		if (req.req === "callApi") dry.apiCalls.push(req.name);
		else dry.builtinCalls.push(req.name);
		return {
			ok: true,
			dryRun: true
		};
	}
	const denied = denyReason(active.pluginName, active.permissions, {
		req: req.req,
		name: req.name
	});
	if (denied) throw new Error(denied);
	if (req.req === "callApi") {
		if (typeof active.bot?.callApi !== "function") throw new Error("当前上下文不支持 bot.callApi");
		return await active.bot.callApi(req.name, req.args);
	}
	const target = builtinResolver?.(req.name) ?? null;
	if (!target) throw new Error("callBuiltin: 未找到内置节点 " + req.name);
	return await target(active.bot, active.event, req.args, active.ctx);
});
/**
* 把宿主值转成"JSON 能表达"的副本。
*
* 跨进程序列化只允许 JSON，所以任何要送进 worker 的宿主对象都必须先过这一关：
* 函数 / undefined 丢弃，BigInt 转字符串；循环引用退化成一次带 seen 集合的序列化。
*/
function toJsonSafe(v) {
	if (v === void 0) return null;
	try {
		const s = JSON.stringify(v);
		return s === void 0 ? null : JSON.parse(s);
	} catch {
		const seen = /* @__PURE__ */ new WeakSet();
		try {
			const s = JSON.stringify(v, (_key, val) => {
				if (typeof val === "function" || val === void 0) return void 0;
				if (typeof val === "bigint") return String(val);
				if (val && typeof val === "object") {
					if (seen.has(val)) return null;
					seen.add(val);
				}
				return val;
			});
			return s === void 0 ? null : JSON.parse(s);
		} catch {
			return null;
		}
	}
}
/**
* 构造给 worker 沙箱的 payload（全部经 JSON 序列化，不含任何宿主对象）。
*
* bot 只给 self_id：协议端能力一律走 ctx.bot.callApi(...)（系统提示词也是这么教的）。
* 把宿主 bot 对象整包 JSON 化既有循环引用风险，也等于把宿主对象结构送进沙箱。
*/
function buildPayload(callId, bot, event, kwargs, ctx) {
	return {
		callId,
		config: toJsonSafe(kwargs),
		event: toJsonSafe(event),
		projectPath: typeof ctx?.projectPath === "string" ? ctx.projectPath : "",
		bot: { self_id: toJsonSafe(bot?.self_id) }
	};
}
/**
* 取源码里第一个"有效 token"（跳过空白与注释）。
*
* 只用于**本地快速否定**明显不是函数表达式的源码（如对象字面量 { ... }）。
* 真正的"是不是函数"由 worker 里的沙箱 install 判定（source 绝不在本地执行）。
*/
function firstSignificantToken(src) {
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
			i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			const nl = src.indexOf("\n", i);
			if (nl < 0) return "";
			i = nl + 1;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			if (end < 0) return "";
			i = end + 2;
			continue;
		}
		break;
	}
	if (i >= src.length) return "";
	if (/[A-Za-z_$]/.test(src[i])) {
		let j = i;
		while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
		return src.slice(i, j);
	}
	return src[i];
}
/** 保守的"像函数表达式"判断：只用来把 { ... } 这类明显不是的挡在本地 */
function looksLikeFunctionExpression(src) {
	const tok = firstSignificantToken(src);
	if (!tok) return false;
	if (tok === "(") return true;
	if (tok === "async" || tok === "function") return true;
	if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tok)) return true;
	return false;
}
/**
* 本地把关：只编译不执行。
*
* 返回的 error 文案沿用旧实现（含"编译失败"），现有测试直接断言它。
*/
function checkHandlerSource(source) {
	if (typeof source !== "string" || !source.trim()) return {
		ok: false,
		error: "handler 源码不能为空"
	};
	try {
		new vm.Script("(" + source + "\n)", { filename: "dynamic-node-check" });
	} catch (e) {
		return {
			ok: false,
			error: "节点代码编译失败: " + errorMessage(e)
		};
	}
	if (!looksLikeFunctionExpression(source)) return {
		ok: false,
		error: "节点代码编译失败: handler 必须是一个函数表达式，例如 async (ctx) => { ... }"
	};
	return { ok: true };
}
/** kind → 注册选项（只有传了 options 的 kind 才有记录） */
var OPTIONS = /* @__PURE__ */ new Map();
/**
* 注册（或覆盖）一个动态节点 handler。
*
* @param kind 节点 kind（示例：plugin_my-pkg_do_something / plugin_my-pkg_handler_onPing）
* @param handlerSource JS 函数字符串，形如 async (ctx) => { ... }
* @param options 可选；纯代码插件的 handler 传 permissions 以启用白名单执行
*/
function registerDynamicHandler(kind, handlerSource, options) {
	if (!kind || typeof handlerSource !== "string" || !handlerSource.trim()) return {
		ok: false,
		error: "kind 与 handler 源码均不能为空"
	};
	const check = checkHandlerSource(handlerSource);
	if (!check.ok) return check;
	if (options) OPTIONS.set(kind, options);
	else OPTIONS.delete(kind);
	REGISTERED.set(kind, handlerSource);
	const promise = host.register(kind, handlerSource);
	promise.catch((e) => {
		logger.warn("[dynamicHandlers] " + kind + " 在 worker 中编译失败: " + errorMessage(e));
	});
	REGISTER_PROMISES.set(kind, promise);
	return { ok: true };
}
/**
* 取动态 handler（无则 null）。
*
* 返回的函数维持运行时统一签名 (bot, event, kwargs, ctx)；内部做三件事：
*   1. 等 worker 里这一版源码编译完成（失败则抛出编译错误，不静默）；
*   2. 分配 invokeId 并把本次的宿主上下文登记进 ACTIVE（供桥路由）；
*   3. 让 worker 执行，并把子进程的结果/错误原样带回。
*/
function getDynamicHandler(kind) {
	return makeDynamicHandler(kind, null);
}
/**
* **干跑**用 handler：与 `getDynamicHandler` 走**同一条执行路径**（同一个 worker、同一套桥），
* 区别只有一处 —— invokeId 登记进 DRY_RUN，于是 callApi / callBuiltin 在桥里被记名而**不真执行**。
*
* 为什么复用同一条路径：自检要是另写一套解释器，检的就不是真机行为（那还不如不检）。
*/
function getDryRunHandler(kind, recorder) {
	return makeDynamicHandler(kind, recorder);
}
function makeDynamicHandler(kind, recorder) {
	if (!REGISTERED.has(kind)) return null;
	return async (bot, event, kwargs, ctx) => {
		if (!REGISTERED.has(kind)) throw new Error("动态节点 " + kind + " 已注销");
		const pending = REGISTER_PROMISES.get(kind);
		if (pending) await pending;
		const invokeId = host.nextInvokeId();
		const options = OPTIONS.get(kind);
		ACTIVE.set(invokeId, {
			bot,
			event,
			ctx,
			pluginName: options?.pluginName,
			permissions: options?.permissions
		});
		if (recorder) DRY_RUN.set(invokeId, recorder);
		try {
			return await host.invoke(kind, invokeId, buildPayload(invokeId, bot, event, kwargs, ctx), callTimeoutMs());
		} finally {
			ACTIVE.delete(invokeId);
			DRY_RUN.delete(invokeId);
		}
	};
}
/** 注销单个动态 handler（插件卸载时调用） */
function unregisterDynamicHandler(kind) {
	if (!REGISTERED.has(kind)) return false;
	REGISTERED.delete(kind);
	REGISTER_PROMISES.delete(kind);
	OPTIONS.delete(kind);
	host.unregister(kind);
	return true;
}
/**
* 按前缀批量注销（插件卸载时按 plugin_<name>_ 前缀清理）。
* 返回被移除的 kind 数量。
*/
function unregisterDynamicHandlersByPrefix(prefix) {
	let removed = 0;
	for (const kind of [...REGISTERED.keys()]) {
		if (!kind.startsWith(prefix)) continue;
		REGISTERED.delete(kind);
		REGISTER_PROMISES.delete(kind);
		OPTIONS.delete(kind);
		removed++;
	}
	if (removed > 0) host.unregisterPrefix(prefix);
	return removed;
}
/**
* 仅校验 handler 源码能否编译成函数（不注册、不执行）。
*
* 供「创建自建节点」流程在写文件前做语法把关 —— 替代原先调用
* python -c "ast.parse(...)" 的子进程校验（Python 运行时已移除）。
* 与 registerDynamicHandler 共用同一套本地把关；真正的可执行性由 worker 判定。
*/
function validateHandlerSource(handlerSource) {
	const r = checkHandlerSource(handlerSource);
	if (r.ok) return r;
	return {
		ok: false,
		error: (r.error ?? "handler 校验失败").replace(/^节点代码编译失败: /, "handler 语法错误: ")
	};
}
/** 列出已注册的动态 handler kind（供 listHandlers 汇总） */
function listDynamicHandlerKinds() {
	return [...REGISTERED.keys()];
}

export { DEFAULT_CALL_TIMEOUT_MS, callTimeoutMs, errorMessage, REGISTERED, REGISTER_PROMISES, ACTIVE, DRY_RUN, builtinResolver, setBuiltinResolver, host, toJsonSafe, buildPayload, firstSignificantToken, looksLikeFunctionExpression, checkHandlerSource, OPTIONS, registerDynamicHandler, getDynamicHandler, getDryRunHandler, makeDynamicHandler, unregisterDynamicHandler, unregisterDynamicHandlersByPrefix, validateHandlerSource, listDynamicHandlerKinds };
