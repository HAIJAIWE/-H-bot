// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { init_paths } from "../infra/paths";
import { init_logger } from "../infra/logger";
import { validateHandlerSource } from "../../runtime/dynamicHandlers";

/** 一条触发器校验失败时，错误信息里怎么称呼它 */
function labelOf$1(index, raw) {
	const t = raw;
	const type = typeof t?.type === "string" ? t.type : "(未命名类型)";
	return `触发器 #${index + 1}（${type}）`;
}
/** 非空字符串（trim 后） */
function nonEmptyString(v) {
	return typeof v === "string" && v.trim() !== "";
}
/** cron 必须是 5 段（分 时 日 月 周）—— 写错时不静默，加载期就报 */
function isFiveFieldCron(cron) {
	return cron.trim().split(/\s+/).filter(Boolean).length === 5;
}
var EVENT_ONS = /* @__PURE__ */ new Set([
	"message",
	"request",
	"notice"
]);
var EVENT_MATCHES = /* @__PURE__ */ new Set([
	"any",
	"at_me",
	"keyword",
	"regex"
]);
/** 校验单个 handler 源码，返回 null 表示通过 */
function checkHandlerSource(name, source) {
	if (!nonEmptyString(source)) return `handler「${name}」缺失（必须是函数表达式源码字符串，如 async (ctx) => { ... }）`;
	const check = validateHandlerSource(source);
	if (!check.ok) return `handler「${name}」${check.error ?? "语法校验失败"}`;
	return null;
}
/** 校验单条触发器；返回归一后的对象或错误字符串 */
function validateOneTrigger(index, raw, handlers) {
	const label = labelOf$1(index, raw);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${label}: 必须是对象`;
	const t = raw;
	const handlerName = nonEmptyString(t.handler) ? t.handler.trim() : "";
	if (!handlerName) return `${label}: 缺少 handler（处理函数名）`;
	if (!(handlerName in handlers)) return `${label}: handler「${handlerName}」在 handlers 里不存在（可用: ${Object.keys(handlers).join("、") || "(空)"}）`;
	const description = typeof t.description === "string" && t.description ? t.description : void 0;
	switch (t.type) {
		case "command": {
			const command = nonEmptyString(t.command) ? t.command.trim() : "";
			if (!command) return `${label}: command 必填且为非空字符串（不含前缀，如 "签到"）`;
			const prefixRaw = t.prefix;
			if (prefixRaw !== void 0 && typeof prefixRaw !== "string") return `${label}: prefix 必须为字符串（缺省 "/"）`;
			return {
				type: "command",
				command,
				...typeof prefixRaw === "string" ? { prefix: prefixRaw } : {},
				handler: handlerName,
				...description ? { description } : {}
			};
		}
		case "event": {
			const on = String(t.on ?? "");
			if (!EVENT_ONS.has(on)) return `${label}: on 必须是 message / request / notice 之一（收到 "on=${String(t.on)}"）`;
			const matchRaw = t.match;
			if (matchRaw !== void 0 && typeof matchRaw !== "string") return `${label}: match 必须是 any / at_me / keyword / regex 之一`;
			const match = matchRaw;
			if (match !== void 0 && !EVENT_MATCHES.has(match)) return `${label}: 未知的 match "${match}"（可选 any / at_me / keyword / regex）`;
			if (on !== "message" && match !== void 0) return `${label}: match 只对 on=message 有意义（request / notice 用 sub_type 过滤）`;
			let keywords;
			if (match === "keyword") {
				const rawKeywords = t.keywords;
				if (Array.isArray(rawKeywords)) keywords = rawKeywords.filter(nonEmptyString).map((k) => k.trim());
				else if (nonEmptyString(rawKeywords)) keywords = [rawKeywords.trim()];
				if (!keywords || keywords.length === 0) return `${label}: match=keyword 时 keywords 至少要有 1 个非空关键词`;
			}
			let pattern;
			if (match === "regex") {
				if (!nonEmptyString(t.pattern)) return `${label}: match=regex 时 pattern 必须是非空正则字符串`;
				pattern = t.pattern.trim();
				try {
					new RegExp(pattern, typeof t.flags === "string" ? t.flags : "");
				} catch (e) {
					return `${label}: pattern 不是合法正则: ${e instanceof Error ? e.message : String(e)}`;
				}
			}
			const subType = typeof t.sub_type === "string" && t.sub_type ? t.sub_type : void 0;
			return {
				type: "event",
				on,
				...match ? { match } : {},
				...keywords ? { keywords } : {},
				...pattern ? { pattern } : {},
				...typeof t.flags === "string" && t.flags ? { flags: t.flags } : {},
				...subType ? { sub_type: subType } : {},
				handler: handlerName,
				...description ? { description } : {}
			};
		}
		case "timer": {
			const cron = nonEmptyString(t.cron) ? t.cron.trim() : "";
			const intervalRaw = t.interval_seconds;
			const interval = typeof intervalRaw === "number" ? intervalRaw : Number(intervalRaw);
			const hasInterval = intervalRaw !== void 0 && Number.isFinite(interval) && interval > 0;
			if (!cron && !hasInterval) return `${label}: timer 必须给 cron（5 段）或 interval_seconds（> 0）`;
			if (cron && !isFiveFieldCron(cron)) return `${label}: cron 必须是 5 段（分 时 日 月 周），收到 "${cron}"`;
			return {
				type: "timer",
				...cron ? { cron } : {},
				...hasInterval ? { interval_seconds: interval } : {},
				handler: handlerName,
				...description ? { description } : {}
			};
		}
		default: return `${label}: 未知的触发器类型 "${String(t.type)}"（可选 command / event / timer）`;
	}
}
/**
* 校验纯代码插件的导出：`triggers` + `handlers`。
*
* @param rawTriggers index.js 导出的 triggers（可能是 undefined / 任何垃圾）
* @param rawHandlers index.js 导出的 handlers
*/
function validatePluginCode(rawTriggers, rawHandlers) {
	const errors = [];
	const handlers = {};
	const triggers = [];
	if (rawHandlers !== void 0) {
		if (!rawHandlers || typeof rawHandlers !== "object" || Array.isArray(rawHandlers)) errors.push("handlers 必须是对象（处理函数名 → 函数源码字符串）");
		else for (const [name, source] of Object.entries(rawHandlers)) {
			const reason = checkHandlerSource(name, source);
			if (reason) {
				errors.push(reason);
				continue;
			}
			handlers[name] = source;
		}
	}
	if (rawTriggers !== void 0) {
		if (!Array.isArray(rawTriggers)) errors.push("triggers 必须是数组");
		else rawTriggers.forEach((raw, index) => {
			const result = validateOneTrigger(index, raw, handlers);
			if (typeof result === "string") errors.push(result);
			else triggers.push(result);
		});
	}
	return {
		triggers,
		handlers,
		errors
	};
}

export { labelOf$1, nonEmptyString, isFiveFieldCron, EVENT_ONS, EVENT_MATCHES, checkHandlerSource, validateOneTrigger, validatePluginCode };
