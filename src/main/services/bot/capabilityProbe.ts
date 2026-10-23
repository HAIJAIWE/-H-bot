// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { classify, summarizeBody } from "../../../shared/capability/classify";
import { CAPABILITY_CHECKS } from "../../../shared/capability/checks";
import { loadOfficialConfig } from "../official/config";
import { apiBase, fetchAccessToken } from "../official/client";
import { emitSystemLog } from "../runner/runtimeEvents";

/**
* 能力自检服务。
*
* 回答的是「**这一个 bot 现在能用哪些能力**」，而不是「官方有哪些能力」。
* 官方文档没有任何一处集中说明能力分级，门槛分散在三个层面：
*   ① 主体认证级别（未认证 / 个人 / 企业）
*   ② 服务范围开关（好友私聊 / 群聊 / 频道）
*   ③ 接口级白名单（错误码 11253）与内邀接入
* 光看文档无法判断某一个 bot 的实际边界，只能问它自己。
*
* ## 安全约束（重要）
*
* **全程只发 GET**，不调用任何写接口 —— 自检绝不能改动机器人的状态。
* 凭据来自 `loadOfficialConfig`（已解密），但**绝不出现在返回值里**：
* 返回体只有 appId 与检查结果。
*
* 判定规则见 `classify()`。其中一条经验值得记：
*   群成员/黑名单这类接口**先查权限再查目标**，因此对任何 id 都返回 11253；
*   而群信息/禁言等先查目标，于是会返回 11255「资源不存在」。
*   **两套行为的差异正好用来判定「这个 id 到底是不是群」。**
*/
/** 单条检查的超时；自检是诊断用的，不能把界面卡死 */
var PROBE_TIMEOUT_MS = 12e3;
/** 最多用几个候选目标去试群级能力（多试几个是为了提高"命中真实群"的概率） */
var MAX_TARGETS = 3;
/** 从项目目录里读历史出现过的 id（翻译器持久化的 UID 映射） */
function loadKnownIds(projectPath) {
	const file = (0, path.join)(projectPath, ".qqbat", "uid_mapping.json");
	if (!(0, fs.existsSync)(file)) return [];
	try {
		const raw = JSON.parse((0, fs.readFileSync)(file, "utf-8"));
		return Object.keys(raw.mapping ?? {});
	} catch {
		return [];
	}
}
/** 发一条只读 GET 并判定结果 */
async function probeOnce(token, base, path$6, def) {
	const common = {
		id: def.id,
		zhLabel: def.zhLabel,
		group: def.group,
		gate: def.gate,
		endpoint: path$6
	};
	try {
		const res = await fetch(`${base}${path$6}`, {
			method: "GET",
			headers: { Authorization: `QQBot ${token}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
		const text = await res.text().catch(() => "");
		const { verdict, note } = classify(res.status, text);
		return {
			...common,
			verdict,
			status: res.status,
			note,
			summary: verdict === "ok" ? summarizeBody(text) : void 0
		};
	} catch (err) {
		return {
			...common,
			verdict: "other",
			status: 0,
			note: `请求异常：${err instanceof Error ? err.message : String(err)}`
		};
	}
}
/**
* 由检查结果推导结论 id（**不拼文案** —— 展示交给渲染层的翻译）。
*
* 这里编码的是领域判断，不是措辞，所以它属于服务层：
*   · 频道列表可用但为空 → 机器人不在任何频道
*   · 群成员返回 11253     → 接口级白名单，与"进了群没有"是两件事
*   · 群接口全部 bad_target → 那个 id 不是群（机器人只在单聊用过）
*/
function buildConclusions(items, hasTarget, targetIsGroup) {
	const out = [];
	const byId = new Map(items.map((i) => [i.id, i]));
	const guilds = byId.get("bot_guilds");
	if (guilds?.verdict === "ok") out.push(guilds.summary === "空列表" ? "not_in_any_guild" : "in_guilds");
	if (byId.get("group_members")?.verdict === "no_permission") out.push("members_need_whitelist");
	if (!hasTarget) out.push("no_target");
	else if (!targetIsGroup) out.push("target_not_group");
	return out;
}
/** 日志/界面里只展示前 10 位：够认出是哪个目标，又不把完整标识散出去 */
function truncateId(id) {
	return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}
/**
* 执行一次能力自检。
*
* @param projectPath 项目路径（凭据与历史 id 都从这里取）
*/
async function probeCapabilities(projectPath) {
	const config = await loadOfficialConfig(projectPath);
	if (!config) throw new Error("该项目尚未配置 AppID / AppSecret，无法自检");
	const { token } = await fetchAccessToken(config.appId, config.appSecret);
	const sandbox = config.sandbox ?? false;
	const base = apiBase(sandbox);
	const targets = loadKnownIds(projectPath).slice(0, MAX_TARGETS);
	const hasTarget = targets.length > 0;
	const items = [];
	for (const def of CAPABILITY_CHECKS) {
		if (def.needsTarget) continue;
		items.push(await probeOnce(token, base, def.path, def));
	}
	const groupDefs = CAPABILITY_CHECKS.filter((d) => d.needsTarget);
	const idDef = {
		id: "group_bot_state",
		group: "group",
		gate: "whitelist",
		path: "/v2/groups/{target}/bot_state"
	};
	let chosen = null;
	for (const target of targets) if ((await probeOnce(token, base, idDef.path.replace("{target}", target), idDef)).verdict !== "bad_target") {
		chosen = target;
		break;
	}
	const activeTarget = chosen ?? targets[0] ?? null;
	const targetIsGroup = chosen !== null;
	for (const def of groupDefs) {
		if (!activeTarget) {
			items.push({
				id: def.id,
				zhLabel: def.zhLabel,
				group: def.group,
				gate: def.gate,
				endpoint: def.path,
				verdict: "other",
				status: 0,
				note: "无可用目标，无法判定"
			});
			continue;
		}
		items.push(await probeOnce(token, base, def.path.replace("{target}", activeTarget), def));
	}
	let bot;
	if (items.find((i) => i.id === "bot_info")?.verdict === "ok") try {
		const me = await (await fetch(`${base}/users/@me`, {
			headers: { Authorization: `QQBot ${token}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		})).json().catch(() => ({}));
		if (me.id || me.username) bot = {
			id: String(me.id ?? ""),
			username: String(me.username ?? "")
		};
	} catch {}
	const counts = {
		ok: 0,
		no_permission: 0,
		need_admin: 0,
		reachable: 0,
		bad_target: 0,
		auth: 0,
		other: 0
	};
	for (const it of items) counts[it.verdict]++;
	emitSystemLog(projectPath, `能力自检完成：可用 ${counts.ok} 项，无权限 ${counts.no_permission} 项，目标无效 ${counts.bad_target} 项`, "info");
	return {
		appId: config.appId,
		sandbox,
		bot,
		probedAt: (/* @__PURE__ */ new Date()).toISOString(),
		targets: targets.map(truncateId),
		activeTarget: activeTarget ? truncateId(activeTarget) : null,
		targetIsGroup,
		hasTarget,
		items,
		counts,
		conclusions: buildConclusions(items, hasTarget, targetIsGroup)
	};
}

export { PROBE_TIMEOUT_MS, MAX_TARGETS, loadKnownIds, probeOnce, buildConclusions, truncateId, probeCapabilities };
