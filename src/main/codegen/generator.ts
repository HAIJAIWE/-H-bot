// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { migrateLegacyKinds, populateMissingPorts } from "./graphPreprocess";
import { assignOutputVariables, createDataflowContext } from "./dataflow";
import { compileChains, nextNodes } from "./topo";
import { generateButtonEventHandlers } from "./buttonEmitter";
import { generateAvailableTools, generateHeader } from "./headerEmitter";
import { emitNode } from "./emitters";
import { generateBlock } from "./controlFlowEmitter";
import { triggerOutputExpr } from "./triggerOutputMap";
import { createImportCollector, indentStr, tsLiteral } from "./typescriptUtils";
import { emitDebugPausePrint } from "./expressionSafety";

/**
* 嵌套过深时**替用户把话说清楚**（而不是把 `RangeError` 抛到画布上）。
*
* ## 实测（2026-09-29，为审计里"规模/性能（2000 节点会怎样）"补的测量）
*
* | 形状 | 结果 |
* |---|---|
* | 2000 节点**线性链** | 116ms，一个不漏，语法合法 —— 规模本身没问题 |
* | 4000 节点**线性链** | 312ms |
* | 深度 1000 嵌套 branch_if（2002 节点） | 146ms，但生成 **10MB** 代码（嵌套分支每层重发子树，输出是 O(深度²)） |
* | **深度 2000 嵌套（4002 节点）** | **`RangeError: Maximum call stack size exceeded`** |
*
* 线性链走 `generateBlock` 的 `while` 循环（迭代，不占栈）；嵌套分支每层都**递归**
* （`emitIfBranch` → `generateBlock` → `emitIfBranch`…）。所以"节点多"没事，
* "**嵌套深**"才会爆栈 —— 这两件事在图里长得完全不一样，用户看不出来。
*
* 真用户几乎不可能手搭 1000 层嵌套，但模板/AI 生成可以。爆栈的原始报错
* （`Maximum call stack size exceeded`）既没说是哪个节点、也没说该怎么办；
* 而且它发生在 `generateCode` 里，**连"生成到哪一步了"都看不出来**。
*/
var NESTING_ABORT_HINT = "流程嵌套太深：生成器按嵌套层级递归展开分支，实测超过约 1000 层（`branch_if` / `loop` 互相嵌套）会耗尽调用栈。请把深层嵌套拆成子流程，或改成循环 + 条件表达式的写法";
/** 这处异常是不是"调用栈爆了"（只认这一种，别的异常原样抛出去，不掩盖真 bug） */
function isStackOverflow(e) {
	return e instanceof RangeError && /call stack/i.test(e.message);
}
/** 中断处的可见标记 —— 让**产物本身**承认自己不完整（errors 在快照路径里不会写进文件） */
function nestingAbortSection(what) {
	return `// ⚠️ 生成中断：${what} 的嵌套层级过深（调用栈溢出）。\n// 本文件**不完整** —— 这条链的后续节点没有生成。${NESTING_ABORT_HINT}\n`;
}
function nestingAbortReason(what) {
	return `${what} 生成中断：${NESTING_ABORT_HINT}`;
}
/**
* 生成入口 —— 外面这层**只做一件事**：把"嵌套太深把调用栈撑爆"从一句裸 `RangeError`
* 变成「可读原因 + 产物声明自己不完整」。
*
* ## 为什么这层必须包住**整个**函数体，而不只是逐条链
*
* 第一版只包了"逐条链生成"，于是实测出这样一组结果（同一台机器、同一次运行）：
*
* ```
* 深度  2000（4002 节点）: OK 408ms  errors=1   ← 被逐链的兜底接住了
* 深度  4000（8002 节点）: OK 1420ms errors=1
* 深度  6000            : 抛错 RangeError      ← 兜不住
* 深度  8000            : OK 11971ms errors=1  ← 又兜住了
* 深度 12000            : 抛错 RangeError      ← 兜不住
* ```
*
* 6000 抛、8000 不抛 —— 说明爆栈**不发生在被包住的那一段**，而是在它之前：
* `compileChains` / `createDataflowContext` 同样按层递归，且它们在循环之外。
* 换句话说"包住链生成"只是包住了**一半**的爆栈点，而这种一半的兜底比没有更坏：
* 它让人以为已经处理过了。
*
* 所以改成外层整体兜底（内核里逐条链的兜底**保留** —— 它能在还能救的时候给出
* 局部产物，比整份放弃有用）。判据仍然是**只认 `RangeError` + "call stack"**，
* 别的异常原样抛出去，不掩盖真 bug。
*/
function generateCode(graph, debugMode = false) {
	const errors = [];
	try {
		return generateInner(graph, debugMode, errors);
	} catch (e) {
		if (!isStackOverflow(e)) throw e;
		errors.push(nestingAbortReason("流程"));
		return {
			code: nestingAbortSection("流程"),
			errors
		};
	}
}
function generateInner(graph, debugMode, errors) {
	const imports = createImportCollector();
	const customCalls = /* @__PURE__ */ new Set();
	migrateLegacyKinds(graph);
	populateMissingPorts(graph);
	const dataflow = createDataflowContext(graph);
	const chains = compileChains(graph);
	if (chains.length === 0) return {
		code: "# 无触发器节点，不生成任何 matcher\n",
		errors
	};
	const sections = [];
	let needsLifecycleInfra = false;
	for (const chain of chains) {
		const ctx = {
			dataflow,
			imports,
			customCalls,
			matcherVar: "matcher",
			traceVar: "trace_id",
			errors,
			graph
		};
		try {
			sections.push(generateChain(chain, ctx, graph, debugMode));
		} catch (e) {
			if (!isStackOverflow(e)) throw e;
			sections.push(nestingAbortSection(chain.trigger.id));
			errors.push(nestingAbortReason(chain.trigger.id));
			continue;
		}
		const kind = chain.trigger.data.nodeKind;
		if (kind === "scheduled" || kind === "on_schedule" || kind === "on_ready" || kind === "on_startup") needsLifecycleInfra = true;
	}
	let buttonSections = [];
	try {
		buttonSections = generateButtonEventHandlers(graph, dataflow, imports, customCalls, errors, debugMode);
	} catch (e) {
		if (!isStackOverflow(e)) throw e;
		buttonSections = [nestingAbortSection("按钮事件")];
		errors.push(nestingAbortReason("按钮事件"));
	}
	sections.push(...buttonSections);
	const infra = needsLifecycleInfra ? generateLifecycleInfra(imports) : "";
	return {
		code: `${generateHeader(imports, customCalls)}\n\n${generateAvailableTools(graph, errors)}\n${infra}\n${sections.join("\n\n")}\n`,
		errors
	};
}
/**
* 生成生命周期/定时触发器基础设施（模块级代码）：
* - APScheduler 调度器实例（schedule 触发器装饰器使用）
* - 模拟事件类（schedule/on_ready/on_startup 链中下游节点需要 event 参数）
* - 调度器的启动/关闭钩子（挂到 NoneBot driver 生命周期）
*
* 修复前：@scheduler.scheduled_job(...) 装饰器生成后，scheduler 从未定义，
* 生成的 Python 模块在 import 时抛 NameError；datetime.now() 也从未导入。
*/
function generateLifecycleInfra(imports) {
	imports.add("createTimer");
	return `// 定时任务基础设施（使用 setInterval 替代 apscheduler）
const timerRef = setInterval(() => {}, 60000); // 60s 心跳

// on_ready 钩子：机器人启动时触发
export function onReady(): void {
  // 由入口文件在 bot 初始化后调用
}

// on_startup 钩子：兼容旧行为的空实现
export function onStartup(): void {
  // 无特殊处理，由业务代码在入口中调用
}

// on_shutdown 钩子：机器人关闭时触发
export function onShutdown(): void {
  clearInterval(timerRef);
}
`;
}
/** 解析子流程参数配置（JSON 字符串），返回参数名列表 */
function parseSubflowParams(paramsConfig) {
	if (typeof paramsConfig !== "string") return [];
	try {
		const arr = JSON.parse(paramsConfig);
		if (!Array.isArray(arr)) return [];
		return arr.filter((p) => typeof p === "object" && p !== null).map((p) => ({
			name: String(p.name ?? "").replace(/[^a-zA-Z0-9_]/g, "_"),
			type: String(p.type ?? "any"),
			description: String(p.description ?? "")
		})).filter((p) => p.name.length > 0);
	} catch {
		return [];
	}
}
function generateChain(chain, ctx, graph, debugMode = false) {
	const { trigger, isSchedule, isSubflow, isLifecycle, kind } = normalizeTrigger(chain);
	const { matcherVar, handlerSig, decorator } = buildHandlerSignature(trigger, kind, isSchedule, isSubflow, isLifecycle, ctx);
	ctx.matcherVar = matcherVar;
	ctx.isSubflowChain = isSubflow;
	return `${isSchedule || isSubflow || isLifecycle ? "" : `const ${matcherVar} = ${generateMatcherDef(trigger, ctx)};\n`}${decorator}\n${handlerSig} {\n${buildHandlerBody(trigger, chain, graph, ctx, debugMode, isSchedule, isLifecycle, isSubflow, kind).join("\n")}\n}\n`;
}
/** 标准化触发器：处理 start_node 内嵌类型 */
function normalizeTrigger(chain) {
	let trigger = chain.trigger;
	if (trigger.data.nodeKind === "start_node") {
		const triggerType = trigger.data.config.trigger_type ?? "message_received";
		const triggerConfig = { ...trigger.data.config.trigger_config ?? {} };
		if (triggerType === "subflow_defined") {
			triggerConfig.params = trigger.data.config.params ?? "[]";
			if (triggerConfig.subflow_name === void 0) triggerConfig.subflow_name = "";
		}
		trigger = {
			...trigger,
			data: {
				...trigger.data,
				nodeKind: triggerType,
				config: triggerConfig
			}
		};
	}
	const kind = trigger.data.nodeKind;
	return {
		trigger,
		isSchedule: kind === "on_schedule" || kind === "scheduled",
		isSubflow: kind === "subflow_defined",
		isLifecycle: kind === "on_ready" || kind === "on_startup",
		kind
	};
}
/** 构建 handler 签名（纯 TypeScript：返回函数头，函数体由 generateChain 包起来） */
function buildHandlerSignature(trigger, kind, isSchedule, isSubflow, isLifecycle, ctx) {
	const triggerId = trigger.id.replace(/[^a-zA-Z0-9_]/g, "_");
	const matcherVar = isSchedule || isSubflow || isLifecycle ? "" : `matcher_${triggerId}`;
	let handlerName;
	let handlerSig;
	let decorator;
	if (isSchedule) {
		handlerName = `_schedule_${triggerId}`;
		decorator = generateScheduleRegistration(trigger, handlerName, ctx.errors);
		handlerSig = `async function ${handlerName}(ctx: FlowContext, event: TriggerEvent): Promise<void>`;
	} else if (isLifecycle) {
		if (kind === "on_ready") {
			handlerName = `_ready_${triggerId}`;
			decorator = `onReady(${handlerName});`;
		} else {
			handlerName = `_startup_${triggerId}`;
			decorator = `onStartup(${handlerName});`;
		}
		handlerSig = `async function ${handlerName}(ctx: FlowContext): Promise<void>`;
	} else if (isSubflow) {
		handlerName = `subflow_${(trigger.data.config.subflow_name || `unnamed_${triggerId}`).replace(/[^a-zA-Z0-9_]/g, "_")}`;
		const paramList = parseSubflowParams(trigger.data.config.params).map((p) => `${p.name}: unknown`).join(", ");
		handlerSig = `async function ${handlerName}(ctx: FlowContext${paramList ? ", " + paramList : ""}): Promise<void>`;
		decorator = "";
	} else {
		handlerName = `_handle_${triggerId}`;
		decorator = "";
		handlerSig = `async function ${handlerName}(ctx: FlowContext, event: TriggerEvent): Promise<void>`;
	}
	return {
		matcherVar,
		handlerName,
		handlerSig,
		decorator
	};
}
/** 构建 handler 函数体 */
function buildHandlerBody(trigger, chain, graph, ctx, debugMode, isSchedule, isLifecycle, isSubflow, kind) {
	const bodyLines = [];
	injectBotEvent(bodyLines, ctx, isSchedule, isLifecycle, kind);
	injectTraceId(bodyLines, ctx);
	if (isSubflow) injectSubflowParams(bodyLines, ctx, trigger);
	else bodyLines.push(`${indentStr(1)}const _vars: Record<string, unknown> = {};  // 节点变量上下文`);
	const triggerIdx = chain.sequence.findIndex((n) => n.id === trigger.id);
	if (triggerIdx > 0) {
		const dataSourceNodes = chain.sequence.slice(0, triggerIdx);
		for (const dsNode of dataSourceNodes) bodyLines.push(emitNode(dsNode, ctx, 1));
	}
	if (debugMode) bodyLines.push(emitDebugPausePrint(indentStr(1), trigger.id, trigger.data.label, ctx.traceVar));
	assignTriggerOutputs(bodyLines, ctx, trigger, isSchedule);
	const firstNodes = findFirstNodes(trigger, graph);
	if (firstNodes.length > 0) for (const fn of firstNodes) bodyLines.push(generateBlock(fn, graph, ctx, 1, debugMode));
	else if (Object.keys(assignOutputVariables(trigger, ctx.dataflow)).length === 0) bodyLines.push(`${indentStr(1)}// 无后续节点\n`);
	return bodyLines;
}
/** 注入 bot/event（非消息触发器） */
function injectBotEvent(bodyLines, ctx, isSchedule, isLifecycle, kind) {
	if (isSchedule) {
		bodyLines.push(`${indentStr(1)}// 定时任务无事件触发者 - 由入口文件管理`);
		bodyLines.push(`${indentStr(1)}event = { message_type: "group", user_id: "", group_id: "", get_message: () => "" }`);
	} else if (isLifecycle) {
		if (kind === "on_ready") bodyLines.push(`${indentStr(1)}event = { message_type: "group", user_id: "", group_id: "", get_message: () => "" }`);
		else {
			bodyLines.push(`${indentStr(1)}bot = null  # 启动阶段 bot 尚未连接（TypeScript 中为 null}`);
			bodyLines.push(`${indentStr(1)}event = { message_type: "group", user_id: "", group_id: "", get_message: () => "" }`);
		}
	}
}
/** 注入 trace_id */
function injectTraceId(bodyLines, ctx) {
	const traceVar = "trace_id";
	ctx.traceVar = traceVar;
	bodyLines.push(`${indentStr(1)}const ${traceVar} = randomUUID();`);
}
/** 注入子流程参数 */
function injectSubflowParams(bodyLines, ctx, trigger) {
	const varsInit = parseSubflowParams(trigger.data.config.params).map((p) => p.name).join(", ");
	bodyLines.push(`${indentStr(1)}const _vars: Record<string, unknown> = {${varsInit}};  // 子流程参数注入`);
}
/** 赋值触发器输出端口 */
function assignTriggerOutputs(bodyLines, ctx, trigger, isSchedule) {
	const triggerOutVars = assignOutputVariables(trigger, ctx.dataflow);
	for (const [portId, varName] of Object.entries(triggerOutVars)) bodyLines.push(`${indentStr(1)}${varName} = ${triggerOutputExpr(trigger, portId, isSchedule)}`);
}
/** 查找首个下游节点 */
function findFirstNodes(trigger, graph) {
	const nextPortId = trigger.data.outputs.find((p) => p.kind === "control")?.id;
	if (nextPortId) return nextNodes(trigger, nextPortId, graph);
	if (trigger.data.outputs.length === 0) return graph.edges.filter((e) => e.source === trigger.id).map((e) => graph.nodes.find((n) => n.id === e.target)).filter((n) => n !== void 0 && n !== null);
	return [];
}
/**
* 生成触发器 matcher 定义。
*
* 语义与 runtime/trigger_matcher.py 对齐：
* - on_message: match 参数切换匹配方式（any/at_me/command/keyword/regex），
*   message_type 过滤与 match 正交可叠加。
*   旧实现只有 at_me/command 有专门 matcher，keyword/regex/message_type 全部
*   退化为裸 on_message(priority=10)——关键词/正则/消息类型过滤完全失效。
* - on_button_click: NapCat 路径通过消息内容精确匹配 button_data（QQ 官方
*   interaction 事件由运行时适配器处理，生成代码无法用 NoneBot matcher 表达）。
*/
function generateMatcherDef(trigger, ctx) {
	const kind = trigger.data.nodeKind;
	const config = trigger.data.config;
	if (kind === "message_received") {
		const match = config.match ?? (config.command !== void 0 && String(config.command ?? "") !== "" ? "command" : config.keywords && config.keywords.length > 0 ? "keyword" : config.pattern ? "regex" : "any");
		const msgType = config.message_type ?? "any";
		const opts = [];
		if (match === "at_me") opts.push(`match: 'at_me'`);
		else if (match === "command") {
			const cmd = String(config.command ?? "").trim();
			if (!cmd) ctx.errors.push(`on_message 节点 ${trigger.id} 的 match=command 但 command 为空`);
			opts.push(`match: 'command'`, `command: ${tsLiteral(cmd)}`);
		} else if (match === "keyword") {
			const keywords = parseKeywordList(config.keywords);
			if (keywords.length === 0) ctx.errors.push(`on_message 节点 ${trigger.id} 的 match=keyword 但关键词列表为空`);
			else opts.push(`match: 'keyword'`, `keywords: ${JSON.stringify(keywords)}`);
		} else if (match === "regex") {
			const pattern = String(config.pattern ?? "");
			if (!pattern) ctx.errors.push(`on_message 节点 ${trigger.id} 的 match=regex 但 pattern 为空`);
			else opts.push(`match: 'regex'`, `pattern: ${tsLiteral(pattern)}`);
		} else if (match !== "any") ctx.errors.push(`on_message 节点 ${trigger.id} 的未知 match 模式: ${match}`);
		if (msgType && msgType !== "any" && msgType !== "both") opts.push(`messageType: ${tsLiteral(msgType)}`);
		return `onMessage({ ${opts.join(", ")} })`;
	}
	if (kind === "button_clicked") {
		const target = String(config.button_data ?? "");
		if (!target) {
			ctx.errors.push(`button_clicked 节点 ${trigger.id} 缺少 button_data 配置`);
			return `onMessage({ match: 'button' })`;
		}
		return `onMessage({ match: 'button', buttonData: ${tsLiteral(target)} })`;
	}
	if (kind === "request_received") return "onRequest()";
	if (kind === "notice_received") return "onNotice()";
	ctx.errors.push(`未知触发器类型: ${kind} (节点 ${trigger.id})，使用 onMessage 兜底`);
	return "onMessage({})";
}
/** 解析 keywords 配置：支持字符串数组或 JSON 字符串，过滤非字符串/空项 */
function parseKeywordList(value) {
	if (Array.isArray(value)) return value.filter((k) => typeof k === "string" && k.length > 0);
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return [];
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.filter((k) => typeof k === "string" && k.length > 0);
		} catch {}
		return [trimmed];
	}
	return [];
}
/** 生成定时器注册语句（在 handler 声明之前；function 声明会提升，可前向引用） */
function generateScheduleRegistration(trigger, handlerName, errors) {
	const config = trigger.data.config;
	const interval = config.interval_seconds;
	if (interval && interval > 0) return `onTimer(${handlerName}, { seconds: ${interval} });`;
	const cron = config.cron;
	if (!cron) {
		errors.push(`schedule 节点 ${trigger.id} 缺少 interval_seconds 和 cron 配置`);
		return `onTimer(${handlerName}, { seconds: 3600 });  // 配置缺失，使用默认值`;
	}
	return `onTimer(${handlerName}, { cron: ${tsLiteral(cron)} });`;
}

export { NESTING_ABORT_HINT, isStackOverflow, nestingAbortSection, nestingAbortReason, generateCode, generateInner, generateLifecycleInfra, parseSubflowParams, generateChain, normalizeTrigger, buildHandlerSignature, buildHandlerBody, injectBotEvent, injectTraceId, injectSubflowParams, assignTriggerOutputs, findFirstNodes, generateMatcherDef, parseKeywordList, generateScheduleRegistration };
