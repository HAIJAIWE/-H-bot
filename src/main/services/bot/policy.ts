// @ts-nocheck
// 由 10/18 打包产物还原（chunk: policy-DnzZxYpc.js）；见 _recovery/README-recovery.md
import * as fs_promises from "fs/promises";
import * as path from "path";
import * as fs from "fs";
import { __exportAll } from "../../../shared/runtime/rolldownShim";
import { init_logger, logger } from "../infra/logger";

var policy_exports = /* @__PURE__ */ __exportAll({
	DEFAULT_BOT_POLICY: () => DEFAULT_BOT_POLICY,
	addDailyUsage: () => addDailyUsage,
	checkBotPolicy: () => checkBotPolicy,
	loadBotPolicy: () => loadBotPolicy,
	logBotCall: () => logBotCall,
	readDailyUsage: () => readDailyUsage,
	resetRateLimiter: () => resetRateLimiter
});
/** 宽松到不打扰正常使用，但能兜住失控 */
var DEFAULT_BOT_POLICY = {
	enabled: true,
	allowedGroups: [],
	dailyTokensPerUser: 5e4,
	perMinutePerUser: 12
};
/** 读项目里的 botPolicy（读不到就用默认值） */
async function loadBotPolicy(projectPath) {
	try {
		const raw = await (0, fs_promises.readFile)((0, path.join)(projectPath, ".qqbat", "project.json"), "utf-8");
		const p = JSON.parse(raw).botPolicy ?? {};
		return {
			enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_BOT_POLICY.enabled,
			allowedGroups: Array.isArray(p.allowedGroups) ? p.allowedGroups.map((g) => String(g)) : DEFAULT_BOT_POLICY.allowedGroups,
			dailyTokensPerUser: typeof p.dailyTokensPerUser === "number" && p.dailyTokensPerUser > 0 ? p.dailyTokensPerUser : DEFAULT_BOT_POLICY.dailyTokensPerUser,
			perMinutePerUser: typeof p.perMinutePerUser === "number" && p.perMinutePerUser > 0 ? p.perMinutePerUser : DEFAULT_BOT_POLICY.perMinutePerUser
		};
	} catch {
		return { ...DEFAULT_BOT_POLICY };
	}
}
/** `projectPath::userKey` → 最近的调用时刻（毫秒） */
var recentCalls = /* @__PURE__ */ new Map();
function rateKey(projectPath, subject) {
	return `${projectPath}::${subject.groupId ?? "-"}::${subject.userId ?? "-"}`;
}
/** 测试与"换项目"时清空（进程内存态，见文件顶部的诚实说明） */
function resetRateLimiter() {
	recentCalls.clear();
}
function today() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function usageFile(projectPath, date = today()) {
	return (0, path.join)(projectPath, "data", "bot-usage", `${date}.json`);
}
/** 读某人今天已用多少 token */
async function readDailyUsage(projectPath, subject) {
	const file = usageFile(projectPath);
	if (!(0, fs.existsSync)(file)) return 0;
	try {
		const raw = JSON.parse(await (0, fs_promises.readFile)(file, "utf-8"));
		return Number(raw[rateKey(projectPath, subject)] ?? 0) || 0;
	} catch {
		return 0;
	}
}
/** 累加今天已用 token */
async function addDailyUsage(projectPath, subject, tokens) {
	if (!Number.isFinite(tokens) || tokens <= 0) return;
	const file = usageFile(projectPath);
	try {
		await (0, fs_promises.mkdir)((0, path.dirname)(file), { recursive: true });
		let all = {};
		if ((0, fs.existsSync)(file)) try {
			all = JSON.parse(await (0, fs_promises.readFile)(file, "utf-8"));
		} catch {
			all = {};
		}
		const key = rateKey(projectPath, subject);
		all[key] = (Number(all[key]) || 0) + tokens;
		await import("fs/promises").then((m) => m.writeFile(file, JSON.stringify(all), "utf-8"));
	} catch (e) {
		logger.warn("[bot-policy] 用量记账失败（本轮照常回复）:", e);
	}
}
/**
* 过一遍策略。**在调用模型之前**调用它。
*
* 返回的 `reason` 会直接作为节点的 error 回传，所以它必须说清"发生了什么 + 该怎么办"，
* 而不是一句"被策略拒绝"。
*/
async function checkBotPolicy(projectPath, subject) {
	const effective = await loadBotPolicy(projectPath);
	if (!effective.enabled) return {
		allowed: true,
		reason: "",
		effective
	};
	if (effective.allowedGroups.length > 0 && subject.groupId && !effective.allowedGroups.includes(subject.groupId)) return {
		allowed: false,
		reason: `本群（${subject.groupId}）不在 AI 功能的白名单里，已拒绝调用。如果你是机器人主人：在 project.json 的 botPolicy.allowedGroups 里加上这个群号即可。`,
		effective
	};
	const key = rateKey(projectPath, subject);
	const now = Date.now();
	const windowStart = now - 6e4;
	const hits = (recentCalls.get(key) ?? []).filter((t) => t > windowStart);
	if (hits.length >= effective.perMinutePerUser) {
		recentCalls.set(key, hits);
		return {
			allowed: false,
			reason: `调用太频繁（每分钟上限 ${effective.perMinutePerUser} 次），请稍后再试。`,
			effective
		};
	}
	hits.push(now);
	recentCalls.set(key, hits);
	if (await readDailyUsage(projectPath, subject) >= effective.dailyTokensPerUser) return {
		allowed: false,
		reason: `今天的 AI 用量已达上限（${effective.dailyTokensPerUser} token），明天恢复。如果你是机器人主人：可在 project.json 的 botPolicy.dailyTokensPerUser 里调整。`,
		effective
	};
	return {
		allowed: true,
		reason: "",
		effective
	};
}
function logFile(projectPath) {
	return (0, path.join)(projectPath, "data", "bot-logs", "ai-calls.jsonl");
}
/**
* 记一条调用日志（追加式 JSONL，一行一次调用）。
*
* 为什么要有它：机器人是在**群里**跑的，出了问题你手边没有调试器 ——
* "谁在什么时候问的、用了几轮工具、花了多少 token、失败在哪一步"，
* 这几件事必须事后查得到。没有它，用户报"机器人不回话"时你只能猜。
*/
async function logBotCall(projectPath, entry) {
	const file = logFile(projectPath);
	try {
		await (0, fs_promises.mkdir)((0, path.dirname)(file), { recursive: true });
		const line = JSON.stringify({
			...entry,
			error: entry.error?.slice(0, 500)
		});
		await (0, fs_promises.appendFile)(file, `${line}\n`, "utf-8");
	} catch (e) {
		logger.warn("[bot-policy] 调用日志写入失败:", e);
	}
}

export { policy_exports, DEFAULT_BOT_POLICY, loadBotPolicy, recentCalls, rateKey, resetRateLimiter, today, usageFile, readDailyUsage, addDailyUsage, checkBotPolicy, logFile, logBotCall };
