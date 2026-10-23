// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

/**
* 官方错误码 → 自检结论。
*
* 最容易混淆的两条，这里刻意分开：
*   · `no_permission`（11253 / 11254）—— **接口级**没对你的机器人开放，需要申请
*   · `bad_target`  （11255 / 404）   —— 接口是通的，只是用来测的 id 不对
* 把这两者混为一谈，会让用户去申请根本不需要的权限。
*/
function classify(status, body) {
	if (status === 0) return {
		verdict: "other",
		note: "请求失败"
	};
	if (status === 401) return {
		verdict: "auth",
		note: "AccessToken 无效或已过期"
	};
	if (body.includes("11253")) return {
		verdict: "no_permission",
		note: "11253 应用无接口访问权限"
	};
	if (body.includes("11254")) return {
		verdict: "no_permission",
		note: "11254 应用接口被封禁"
	};
	if (body.includes("11282") || body.includes("11264")) return {
		verdict: "need_admin",
		note: "缺管理员身份"
	};
	if (body.includes("11703")) return {
		verdict: "need_admin",
		note: "11703 机器人不是群管理员"
	};
	if (status >= 200 && status < 300) return {
		verdict: "ok",
		note: ""
	};
	if (status === 404 || body.includes("11255") || body.includes("10003") || body.includes("10004")) return {
		verdict: "bad_target",
		note: `资源不存在（HTTP ${status}）`
	};
	if (body.includes("12002") || body.includes("12001") || body.includes("40054")) return {
		verdict: "reachable",
		note: "参数类错误"
	};
	try {
		const parsed = JSON.parse(body);
		const code = parsed.code ?? parsed.err_code;
		if (code !== void 0 || parsed.message !== void 0) return {
			verdict: "other",
			note: `官方返回 code=${String(code ?? "?")}${parsed.message ? ` ${String(parsed.message)}` : ""}`
		};
	} catch {}
	return {
		verdict: "other",
		note: `HTTP ${status}`
	};
}
/**
* 把响应体压成一行短摘要。
*
* 「可用」还不够 —— 还要看**里面有没有东西**。
* 例如频道列表可用但返回空数组，意味着「机器人不在任何频道」，
* 这比一句「可用」重要得多，也正是自检要回答的问题之一。
*/
function summarizeBody(text) {
	if (!text || !text.trim()) return "空响应";
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return text.slice(0, 60);
	}
	if (Array.isArray(data)) return data.length === 0 ? "空列表" : `列表 ${data.length} 条`;
	if (typeof data !== "object" || data === null) return String(data).slice(0, 60);
	const obj = data;
	for (const key of [
		"guilds",
		"panels",
		"items",
		"members",
		"strategies"
	]) if (Array.isArray(obj[key])) {
		const arr = obj[key];
		return arr.length === 0 ? `${key} 为空` : `${key} ${arr.length} 条`;
	}
	const keys = Object.keys(obj);
	return keys.length ? keys.slice(0, 5).join(", ") : "空对象";
}

export { classify, summarizeBody };
