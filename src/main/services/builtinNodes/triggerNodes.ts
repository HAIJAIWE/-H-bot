// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";
import { runRegexBounded } from "../../codegen/typescriptUtils";

/** 消息触发器 handler — 统一的消息触发节点
* 合并了 message_received / on_at_me / on_command / on_regex 四个节点的逻辑
* match 模式：any/at_me/command/keyword/regex
* 返回：匹配成功返回 { event, raw_message, args, matched, groups }，失败返回 null
*/
async function messageReceived(bot, event, match = "any", message_type = "any", command = "", prefix = "/", keywords = null, pattern = "", flags = "") {
	const matchMode = String(match || "any").toLowerCase();
	if (!checkMessageType(event, String(message_type || "any").toLowerCase())) return null;
	if (matchMode === "at_me") {
		if (!matchAtMe(event)) return null;
		try {
			return {
				event,
				raw_message: String(event?.get_message?.() || ""),
				args: [],
				matched: "",
				groups: []
			};
		} catch {
			return {
				event,
				raw_message: "",
				args: [],
				matched: "",
				groups: []
			};
		}
	}
	let rawMessage;
	try {
		rawMessage = String(event?.get_message?.() || "");
	} catch {
		return null;
	}
	if (matchMode === "any") return {
		event,
		raw_message: rawMessage,
		args: [],
		matched: "",
		groups: []
	};
	if (matchMode === "command") {
		const cmd = String(command || "").trim();
		const pfx = String(prefix ?? "/");
		const args = matchCommand(rawMessage.trim(), cmd, pfx);
		if (args !== null) return {
			event,
			raw_message: rawMessage,
			args,
			matched: "",
			groups: []
		};
		return null;
	}
	if (matchMode === "keyword") {
		if (matchKeyword(rawMessage, keywords)) return {
			event,
			raw_message: rawMessage,
			args: [],
			matched: "",
			groups: []
		};
		return null;
	}
	if (matchMode === "regex") {
		const regexResult = await matchRegex(rawMessage, pattern, flags);
		if (regexResult) return {
			event,
			raw_message: rawMessage,
			args: [],
			matched: regexResult.matched,
			groups: regexResult.groups
		};
		return null;
	}
	logger.warn(`[message_received] 未知 match 模式: ${matchMode}，拒绝匹配`);
	return null;
}
/** 简易 shlex.split 实现（保留引号参数） */
function splitArgs(text) {
	if (!text?.trim()) return [];
	try {
		return shlexSplit(text);
	} catch {
		return text.trim().split(/\s+/);
	}
}
/** 简易 shlex.split 实现（保留引号参数） */
function shlexSplit(text) {
	const result = [];
	let current = "";
	let inQuotes = false;
	let quoteChar = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if ((char === "\"" || char === "'") && !inQuotes) {
			inQuotes = true;
			quoteChar = char;
		} else if (char === quoteChar && inQuotes) {
			inQuotes = false;
			quoteChar = "";
		} else if (char === "\\" && inQuotes && i + 1 < text.length) current += text[++i];
		else if (/\s/.test(char) && !inQuotes) {
			if (current) {
				result.push(current);
				current = "";
			}
		} else current += char;
	}
	if (current) result.push(current);
	return result;
}
/** 检查消息类型是否符合过滤要求 */
function checkMessageType(event, messageType) {
	if (messageType === "any" || messageType === "both" || !messageType) return true;
	try {
		return messageType === (event.message_type || "");
	} catch {
		return false;
	}
}
/** 判断是否@机器人 */
function matchAtMe(event) {
	try {
		if (event.is_tome && typeof event.is_tome === "function") return Boolean(event.is_tome());
		return String(event.get_message?.() || "").includes("[CQ:at,");
	} catch {
		return false;
	}
}
/** 匹配指令前缀+指令名 */
function matchCommand(rawMessage, command, prefix) {
	if (!command) return null;
	const fullCmd = prefix + command;
	const stripped = rawMessage.trim();
	if (stripped === fullCmd || stripped.startsWith(fullCmd + " ") || stripped.startsWith(fullCmd + "	")) return splitArgs(stripped.slice(fullCmd.length));
	if (stripped === command || stripped.startsWith(command + " ")) return splitArgs(stripped.slice(command.length));
	return null;
}
/** 检查关键词 */
function matchKeyword(rawMessage, keywords) {
	if (!keywords) return false;
	let kwList = [];
	if (typeof keywords === "string") try {
		kwList = JSON.parse(keywords);
	} catch {
		kwList = [keywords];
	}
	else if (Array.isArray(keywords)) kwList = keywords;
	return kwList.some((kw) => typeof kw === "string" && kw && rawMessage.includes(kw));
}
/** 正则匹配（ReDoS 防护：长度上限 + **真的会中断**的超时） */
async function matchRegex(rawMessage, pattern, flags) {
	if (!pattern) return null;
	if (pattern.length > 1e3) {
		logger.warn(`regex pattern 超限: ${pattern.length}`);
		return null;
	}
	if (rawMessage.length > 1e5) {
		logger.warn(`regex 文本超限: ${rawMessage.length}`);
		return null;
	}
	const m = runRegexBounded(pattern, rawMessage, flags);
	if (!m) return null;
	return {
		matched: m[0] ?? "",
		groups: m.slice(1).filter((g) => g !== void 0)
	};
}
async function onRequest(bot, event, action = "") {
	console.info(`[on_request] action=${action}`);
	return {
		success: true,
		error: ""
	};
}
async function onNotice(bot, event, noticeType = "") {
	console.info(`[on_notice] noticeType=${noticeType}`);
	return {
		success: true,
		error: ""
	};
}
async function onButtonClick(bot, event, action = "") {
	console.info(`[on_button_click] action=${action}`);
	return {
		success: true,
		error: ""
	};
}

export { messageReceived, splitArgs, shlexSplit, checkMessageType, matchAtMe, matchCommand, matchKeyword, matchRegex, onRequest, onNotice, onButtonClick };
