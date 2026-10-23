// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { isExpressionVarKey, makeListHandler, mapKwargsToParams, mergePortVars, parseFormulas, resolveEndNodeReturns, runListOp } from "./support";
import { setReturn } from "../signals";
import { delay, errorOp, loopControl, switchCaseRoute, systemLog, timerOp } from "../../services/builtinNodes/controlNodes";
import { safeEvalDetailed } from "../safeEval";
import { formatText, messageSend } from "../../services/builtinNodes/messageDomain";
import { jsonOp, random, timeOp } from "../../services/builtinNodes/dataNodes";
import { namedVarKey } from "../../../shared/nodes/varRef";
import { cloneForEdit, isTruthyFlag } from "../handlerUtils";
import { regexExtract } from "../../services/builtinNodes/builtinNodes";

/** 非位置参数 handler（直接以 kwargs 对象调用） */
var KWARGS_HANDLERS = {
	end_node: (_bot, _event, kwargs, hctx) => {
		const ctx = hctx?.ctx;
		const { value, errors } = resolveEndNodeReturns(kwargs.returns, ctx?.variables ?? {}, ctx ? (id) => ctx.nodesById.has(id) : void 0);
		if (ctx) setReturn(ctx.variables, value);
		return {
			returns: value,
			error: errors.join("；")
		};
	},
	delay: (_bot, _event, kwargs) => delay(Number(kwargs.seconds) * 1e3 || 0),
	expression_eval: (_bot, _event, kwargs) => {
		const vars = mergePortVars(kwargs, isExpressionVarKey, { includeNull: true });
		if (String(kwargs.mode ?? "single") === "formulas") {
			const formulas = parseFormulas(kwargs.formulas);
			if (formulas.length === 0) return {
				result: null,
				error: "formulas 模式但没有配置任何公式"
			};
			const out = { result: null };
			const errors = [];
			for (const f of formulas) {
				const r = safeEvalDetailed(f.expression, vars);
				out[f.name] = r.ok ? r.value : null;
				if (!r.ok) errors.push(`${f.name}: ${r.error}`);
			}
			out.error = errors.join("；");
			return out;
		}
		const r = safeEvalDetailed(String(kwargs.expression ?? ""), vars);
		return {
			result: r.ok ? r.value : null,
			error: r.error
		};
	},
	format_text: (_bot, _event, kwargs) => formatText(String(kwargs.template ?? ""), mergePortVars(kwargs, (k) => /^var\d+$/.test(k))),
	message_send: (bot, event, kwargs) => {
		const p = mapKwargsToParams(kwargs);
		return messageSend(bot, event, p.text, p.mode, p.markdown, p.keyboard, p.segments, p.messages, p.userId, p.targetType, p.targetId, mergePortVars(kwargs, (k) => /^var\d+$/.test(k)), p.mediaUrl, p.mediaType, p.fileName, p.replyTo, p.isWakeup, p.streamContentType, p.streamChunkSize, p.streamIntervalMs, p.inputSecond, p.arkTemplateId ?? "", p.arkKv ?? "", p.embedTitle ?? "", p.embedPrompt ?? "", p.embedDescription ?? "", p.embedThumbnail ?? "", p.embedFields ?? "", p.forceVerifyImageResource ?? false);
	},
	json_op: (_bot, _event, kwargs, hctx) => {
		const mode = kwargs.mode ?? "get";
		const key = kwargs.key ?? kwargs.path ?? "";
		const value = kwargs.value ?? null;
		const rawSource = kwargs.source ?? kwargs.data ?? "";
		const varName = String(kwargs.var_name ?? "").trim();
		if (!(String(kwargs.source_from ?? "port") === "variable" && varName.length > 0)) return jsonOp(mode, rawSource, key, value);
		const ctx = hctx?.ctx;
		if (!ctx) return {
			result: null,
			error: "内部错误：拿不到执行上下文，无法读写命名变量"
		};
		const existing = ctx.variables[namedVarKey(varName)];
		const out = jsonOp(mode, existing === void 0 || existing === null ? mode === "get" ? "" : {} : cloneForEdit(existing), key, value);
		const wasError = Boolean(out.error);
		if (mode !== "get" && !wasError && isTruthyFlag(kwargs.write_back)) ctx.variables[namedVarKey(varName)] = out.result;
		return out;
	},
	list_op: (_bot, _event, kwargs, hctx) => runListOp(kwargs, hctx),
	list_edit: makeListHandler("list_edit"),
	list_query: makeListHandler("list_query"),
	list_transform: makeListHandler("list_transform"),
	list_combine: makeListHandler("list_combine"),
	random: (_bot, _event, kwargs) => random(kwargs.mode ?? "int", kwargs.min_value ?? kwargs.min ?? 0, kwargs.max_value ?? kwargs.max ?? 100, kwargs.items ?? kwargs.list ?? []),
	regex_extract: (_bot, _event, kwargs) => regexExtract(String(kwargs.text ?? ""), String(kwargs.pattern ?? ""), String(kwargs.flags ?? ""), kwargs.group ?? 0, kwargs.as_list === true),
	system_log: (_bot, _event, kwargs) => systemLog(kwargs.level ?? "info", kwargs.message ?? ""),
	timer: (_bot, _event, kwargs) => timerOp(kwargs.mode ?? "elapsed", String(kwargs.timer_id ?? "default")),
	time_op: (_bot, _event, kwargs) => timeOp(kwargs.mode ?? "now", kwargs.timestamp ?? null, kwargs.fmt ?? void 0, kwargs.timezone ?? "", kwargs.target ?? null, kwargs.unit ?? "seconds", kwargs.target_fmt ?? void 0, kwargs.offset ?? null),
	branch_switch: (_bot, _event, kwargs) => switchCaseRoute(kwargs.value, kwargs.cases, String(kwargs.default ?? "default")),
	switch_case: (_bot, _event, kwargs) => switchCaseRoute(kwargs.value, kwargs.cases, String(kwargs.default ?? "default")),
	loop_control: (_bot, _event, kwargs) => loopControl(kwargs.mode ?? kwargs.action ?? "continue", kwargs.value ?? null),
	error_op: (_bot, _event, kwargs) => {
		const mode = String(kwargs.mode ?? "assert");
		const message = String(kwargs.message ?? "断言失败");
		if (mode === "throw") return errorOp(message, "throw");
		if (kwargs.condition === true || kwargs.condition === "true" || kwargs.condition === 1) return {
			success: true,
			passed: true,
			error: ""
		};
		return {
			...errorOp(message, "return"),
			passed: false
		};
	},
	scheduled: () => ({
		success: true,
		error: ""
	}),
	on_ready: () => ({
		success: true,
		error: ""
	}),
	on_startup: () => ({
		success: true,
		error: ""
	}),
	request_received: () => ({
		success: true,
		error: ""
	}),
	notice_received: () => ({
		success: true,
		error: ""
	}),
	subflow_defined: () => ({
		success: true,
		error: ""
	}),
	memory_op: () => ({
		success: true,
		error: ""
	})
};

export { KWARGS_HANDLERS };
