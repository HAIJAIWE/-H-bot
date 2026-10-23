// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import events from "events";
import { emitSystemLog } from "../runner/runtimeEvents";

var emitter = new events.EventEmitter();
var sessions = /* @__PURE__ */ new Map();
var projectPathIndex = /* @__PURE__ */ new Map();
function getSession(projectPath) {
	const sessionKey = projectPathIndex.get(projectPath);
	if (!sessionKey) return void 0;
	return sessions.get(sessionKey);
}
function emitStatus(session) {
	emitter.emit("official:status", session.projectPath, session.status, session.appId);
}
function onOfficialStatusChange(cb) {
	emitter.on("official:status", cb);
	return () => emitter.off("official:status", cb);
}
function onOfficialMessage(cb) {
	emitter.on("official:message", cb);
	return () => emitter.off("official:message", cb);
}
function getOfficialStatus(projectPath) {
	const session = getSession(projectPath);
	if (!session) return {
		status: "disconnected",
		appId: "",
		alive: false
	};
	return {
		status: session.status,
		appId: session.appId,
		alive: session.alive
	};
}
function apiBase(sandbox) {
	return sandbox ? SANDBOX_API_BASE : API_BASE;
}
async function authFetch(session, url, options = {}) {
	const token = session.accessToken || await ensureToken(session);
	return fetch(url, {
		...options,
		headers: {
			...options.headers,
			Authorization: `QQBot ${token}`,
			"Content-Type": "application/json"
		}
	});
}
/**
* 通用官方 API 请求（带鉴权 + 错误归一化）。
*
* ## 为什么需要它
*
* 之前每个官方能力都在本文件里写一个专用函数（`sendOfficialMessage`、
* `recallOfficialMessage`…），翻译器只能调这几个。而"菜单/指令面板/频道/入群审批/
* 互动响应"这类能力的共同点是：**就是一次带鉴权的 HTTP 调用**，形态完全一样。
* 给每个都写一个专用函数既啰嗦又容易漏 —— 于是这里给一个通用入口，由调用方给
* method + path + body。
*
* ## 错误处理
*
* 非 2xx 时**把官方返回的 message 带出来**：官方错误体是
* `{ code, message, err_code, trace_id }`，光报 `HTTP 400` 等于没说
* （真机上"参数错"和"没权限"都可能是 400）。拿不到 body 才退回状态码。
*
* @returns 解析后的 JSON（空响应体返回 `{}`）
*/
async function officialApiRequest(projectPath, method, path, body) {
	const session = getSession(projectPath);
	if (!session) throw new Error("官方适配器会话未就绪（机器人没在运行？）");
	const base = apiBase(session.sandbox);
	const res = await authFetch(session, path.startsWith("http") ? path : `${base}${path}`, {
		method,
		...body === void 0 ? {} : { body: JSON.stringify(body) }
	});
	const text = await res.text();
	let parsed = {};
	if (text) try {
		parsed = JSON.parse(text);
	} catch {
		parsed = { raw: text };
	}
	if (!res.ok) {
		const detail = parsed && typeof parsed === "object" ? String(parsed.message ?? parsed.msg ?? text) : text;
		throw new Error(`官方接口失败 HTTP ${res.status}: ${detail || "(无返回内容)"}`);
	}
	return parsed;
}
async function ensureToken(session) {
	if (!session.accessToken || session.tokenExpiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
		const { token, expiresIn } = await fetchAccessToken(session.appId, session.appSecret);
		session.accessToken = token;
		session.tokenExpiresAt = Date.now() + expiresIn * 1e3;
		scheduleTokenRefresh(session);
	}
	return session.accessToken;
}
async function refreshToken(session) {
	try {
		const { token, expiresIn } = await fetchAccessToken(session.appId, session.appSecret);
		session.accessToken = token;
		session.tokenExpiresAt = Date.now() + expiresIn * 1e3;
		scheduleTokenRefresh(session);
	} catch (err) {
		emitSystemLog(session.projectPath, "Token 刷新失败: " + (err instanceof Error ? err.message : String(err)), "error");
		session.tokenRefreshTimer = setTimeout(() => {
			if (session.alive) refreshToken(session).catch(() => {});
		}, TOKEN_REFRESH_RETRY_DELAY_MS);
	}
}
function scheduleTokenRefresh(session) {
	if (session.tokenRefreshTimer) clearTimeout(session.tokenRefreshTimer);
	const refreshIn = session.tokenExpiresAt - Date.now() - TOKEN_REFRESH_SCHEDULE_LEAD_MS;
	if (refreshIn <= 0) {
		refreshToken(session);
		return;
	}
	session.tokenRefreshTimer = setTimeout(() => refreshToken(session), refreshIn);
}
async function fetchAccessToken(appId, appSecret) {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			appId,
			clientSecret: appSecret
		})
	});
	if (!res.ok) throw new Error(`获取 token 失败: HTTP ${res.status}`);
	const data = await res.json();
	if (!data.access_token) throw new Error("获取 token 失败: 无 access_token");
	return {
		token: data.access_token,
		expiresIn: Number(data.expires_in) || 7200
	};
}
async function getGatewayUrl(token, sandbox) {
	const base = apiBase(sandbox);
	const res = await fetch(`${base}/gateway/bot`, { headers: { Authorization: `QQBot ${token}` } });
	if (!res.ok) throw new Error(`获取网关地址失败: HTTP ${res.status}`);
	const data = await res.json();
	if (!data.url) throw new Error("获取网关地址失败: 无 url");
	return data.url;
}
async function testOfficialConnection(appId, appSecret) {
	try {
		const res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				appId,
				clientSecret: appSecret
			})
		});
		if (!res.ok) return false;
		return !!(await res.json()).access_token;
	} catch (err) {
		emitSystemLog("", "官方连接测试失败 appId=" + appId + ": " + (err instanceof Error ? err.message : String(err)), "error");
		return false;
	}
}
var TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
var API_BASE = "https://api.sgroup.qq.com";
var SANDBOX_API_BASE = "https://sandbox.api.sgroup.qq.com";
/** Token 提前刷新阈值（毫秒）：过期前 10 秒即视为需刷新 */
var TOKEN_REFRESH_THRESHOLD_MS = 1e4;
/** Token 刷新调度提前量（毫秒）：过期前 45 秒安排刷新 */
var TOKEN_REFRESH_SCHEDULE_LEAD_MS = 45e3;
/** Token 刷新失败后的重试延迟（毫秒） */
var TOKEN_REFRESH_RETRY_DELAY_MS = 6e4;

export { emitter, sessions, projectPathIndex, getSession, emitStatus, onOfficialStatusChange, onOfficialMessage, getOfficialStatus, apiBase, authFetch, officialApiRequest, ensureToken, refreshToken, scheduleTokenRefresh, fetchAccessToken, getGatewayUrl, testOfficialConnection, TOKEN_URL, API_BASE, SANDBOX_API_BASE, TOKEN_REFRESH_THRESHOLD_MS, TOKEN_REFRESH_SCHEDULE_LEAD_MS, TOKEN_REFRESH_RETRY_DELAY_MS };
