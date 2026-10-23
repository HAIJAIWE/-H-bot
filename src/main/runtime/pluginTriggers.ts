// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as path from "path";
import { emitBotLog } from "../services/runner/runtimeEvents";
import { matchTrigger } from "./triggerMatcher";
import { isDue } from "./scheduler";
import { init_logger, logger } from "../services/infra/logger";
import { getDynamicHandler } from "./dynamicHandlers";

/** 诊断开关名（=0 关闭整个通道；其它值/未设置 = 开启） */
var PLUGIN_TRIGGERS_ENV = "QQBAT_PLUGIN_TRIGGERS";
/**
* 插件触发器通道是否开启。
*
* 每次调用都读环境变量（不缓存）：测试要在同一个进程里对照"开/关"两种行为，
* 与 `isPlanPhaseEnabled` 的做法一致。
*/
function isPluginTriggersEnabled() {
	return process.env[PLUGIN_TRIGGERS_ENV] !== "0";
}
/** projectPath 归一化：加载侧与派发侧可能一个带尾斜杠一个有，统一成绝对路径 */
function projectKey(projectPath) {
	try {
		return (0, path.resolve)(projectPath);
	} catch {
		return projectPath;
	}
}
/** 进程级触发器表：项目 → 插件名 → 该插件的触发器（插入顺序 = 装载顺序） */
var REGISTRY = /* @__PURE__ */ new Map();
/**
* 登记一个插件的全部触发器。
*
* 卸载由 {@link unregisterPluginTriggers} 对称完成；重复登记同一插件**整体覆盖**
* （reload 语义与 pluginLoader 的 reload 一致：改完代码重启机器人就生效）。
*
* @returns 实际登记的触发器数量
*/
function registerPluginTriggers(projectPath, pluginName, inputs) {
	if (inputs.length === 0) {
		unregisterPluginTriggers(projectPath, pluginName);
		return 0;
	}
	const key = projectKey(projectPath);
	let byPlugin = REGISTRY.get(key);
	if (!byPlugin) {
		byPlugin = /* @__PURE__ */ new Map();
		REGISTRY.set(key, byPlugin);
	}
	byPlugin.set(pluginName, inputs.map((input, index) => ({
		...input,
		pluginName,
		id: `${pluginName}#${index}`,
		lastFiredAtMs: null
	})));
	return inputs.length;
}
/** 注销一个插件的全部触发器（卸载 / 禁用时调用） */
function unregisterPluginTriggers(projectPath, pluginName) {
	const key = projectKey(projectPath);
	const byPlugin = REGISTRY.get(key);
	if (!byPlugin || !byPlugin.has(pluginName)) return false;
	byPlugin.delete(pluginName);
	if (byPlugin.size === 0) REGISTRY.delete(key);
	return true;
}
/** 某个项目当前登记的全部触发器（按插件装载顺序，拍平） */
function getPluginTriggers(projectPath) {
	const byPlugin = REGISTRY.get(projectKey(projectPath));
	if (!byPlugin) return [];
	const out = [];
	for (const list of byPlugin.values()) out.push(...list);
	return out;
}
/** 把一条触发器声明映射成**合成触发器节点**，交给 triggerMatcher 匹配（唯一语义来源） */
function syntheticTriggerNode(entry) {
	const trigger = entry.trigger;
	const id = entry.id;
	if (trigger.type === "command") return {
		id,
		data: {
			nodeKind: "message_received",
			config: {
				match: "command",
				command: trigger.command,
				prefix: trigger.prefix ?? "/"
			}
		}
	};
	if (trigger.type === "event") {
		if (trigger.on === "message") return {
			id,
			data: {
				nodeKind: "message_received",
				config: {
					match: trigger.match ?? "any",
					...trigger.keywords ? { keywords: trigger.keywords } : {},
					...trigger.pattern ? { pattern: trigger.pattern } : {},
					...trigger.flags ? { flags: trigger.flags } : {}
				}
			}
		};
		if (trigger.on === "request") return {
			id,
			data: {
				nodeKind: "request_received",
				config: { request_type: trigger.sub_type ?? "any" }
			}
		};
		return {
			id,
			data: {
				nodeKind: "notice_received",
				config: { notice_type: trigger.sub_type ?? "any" }
			}
		};
	}
	return null;
}
/** 日志里怎么称呼一条触发器 */
function describePluginTrigger(trigger) {
	if (trigger.type === "command") return `命令「${trigger.prefix ?? "/"}${trigger.command}」`;
	if (trigger.type === "event") {
		const filter = trigger.match && trigger.match !== "any" ? `/${trigger.match}` : "";
		const sub = trigger.sub_type ? `(${trigger.sub_type})` : "";
		return `事件 ${trigger.on}${filter}${sub}`;
	}
	return `定时 ${trigger.cron ?? `每 ${trigger.interval_seconds ?? "?"} 秒`}`;
}
/** 报一条"插件触发器出了问题"：logger + 运行时输出面板（用户在界面上能看见） */
function report(projectPath, message) {
	logger.warn("[pluginTrigger] " + message);
	emitBotLog(projectPath, "[插件触发器] " + message, "error");
}
/** handler 的 ctx.config：触发器上下文（与节点入参区分开，字段稳定） */
function payloadFor(entry, outputs) {
	return {
		trigger: entry.trigger,
		...typeof outputs.raw_message === "string" ? { raw_message: outputs.raw_message } : {},
		args: Array.isArray(outputs.args) ? outputs.args : [],
		matched: typeof outputs.matched === "string" ? outputs.matched : "",
		groups: Array.isArray(outputs.groups) ? outputs.groups : []
	};
}
/**
* 调一次插件 handler。
*
* 走 dynamicHandlers 的 **worker 执行路径**（与节点 handler 完全同一条）；
* 权限（manifest.permissions）在宿主桥那一层逐次校验，所以这里不需要再判。
*
* @returns null = 成功；否则是**可读的失败原因**（已同时写进日志/输出面板）
*/
async function invokeEntry(entry, bot, event, projectPath, config) {
	const handler = getDynamicHandler(entry.handlerKind);
	if (!handler) {
		const msg = `插件「${entry.pluginName}」触发器 ${describePluginTrigger(entry.trigger)} 找不到已注册的 handler（${entry.handlerKind}）——插件可能未装载，或插件里的该 handler 源码写坏了`;
		report(projectPath, msg);
		return msg;
	}
	try {
		await handler(bot, event, config, {
			projectPath,
			event
		});
		return null;
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		const msg = `插件「${entry.pluginName}」触发器 ${describePluginTrigger(entry.trigger)} 执行失败: ${reason}`;
		report(projectPath, msg);
		return msg;
	}
}
var NONE = {
	handled: false,
	pluginNames: [],
	errors: []
};
/**
* **事件入口的前置检查**：有没有插件声明处理这个事件？
*
* 三种情况都返回 `handled: false`，调用方继续走原有流程（一个字节都不改）：
*   ① 诊断开关关闭（`QQBAT_PLUGIN_TRIGGERS=0`）；
*   ② 项目里没有登记任何触发器；
*   ③ 登记的触发器都不匹配这条事件。
*/
async function dispatchPluginTriggers(bot, event, projectPath) {
	if (!isPluginTriggersEnabled()) return NONE;
	if (!event) return NONE;
	const entries = getPluginTriggers(projectPath);
	if (entries.length === 0) return NONE;
	const matched = [];
	for (const entry of entries) {
		if (entry.trigger.type === "timer") continue;
		const node = syntheticTriggerNode(entry);
		if (!node) continue;
		const outputs = matchTrigger(node, event);
		if (!outputs) continue;
		matched.push({
			entry,
			outputs
		});
	}
	if (matched.length === 0) return NONE;
	const errors = [];
	for (const { entry, outputs } of matched) {
		const err = await invokeEntry(entry, bot, event, projectPath, payloadFor(entry, outputs));
		if (err) errors.push(err);
	}
	return {
		handled: true,
		pluginNames: [...new Set(matched.map((m) => m.entry.pluginName))],
		errors
	};
}
/**
* 驱动插件的**定时触发器**（由 FlowRuntime 的 1 秒心跳调用，与内置定时触发器同一条心跳）。
*
* 判定复用 `scheduler.isDue`（同一套 cron / interval 语义、同一套"同一分钟不重复触发"）。
* 没有插件定时器时是空循环（不产生任何行为）。
*
* @returns 这一轮真的触发了几个
*/
async function tickPluginTimers(projectPath, bot, nowMs = Date.now()) {
	if (!isPluginTriggersEnabled()) return 0;
	const timers = getPluginTriggers(projectPath).filter((e) => e.trigger.type === "timer");
	if (timers.length === 0) return 0;
	let fired = 0;
	for (const entry of timers) {
		const trigger = entry.trigger;
		if (!isDue({
			cron: trigger.cron,
			interval_seconds: trigger.interval_seconds
		}, entry.lastFiredAtMs, nowMs)) continue;
		entry.lastFiredAtMs = nowMs;
		await invokeEntry(entry, bot, null, projectPath, {
			trigger,
			fired_at_ms: nowMs
		});
		fired++;
	}
	return fired;
}

export { PLUGIN_TRIGGERS_ENV, isPluginTriggersEnabled, projectKey, REGISTRY, registerPluginTriggers, unregisterPluginTriggers, getPluginTriggers, syntheticTriggerNode, describePluginTrigger, report, payloadFor, invokeEntry, NONE, dispatchPluginTriggers, tickPluginTimers };
