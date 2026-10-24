// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { emitSystemLog } from "../runner/runtimeEvents";
import { emitStatus, emitter, ensureToken, getGatewayUrl, projectPathIndex, sessions } from "./client";
import { loadOfficialConfig } from "./config";
import { BASE_INTENTS, OPTIONAL_INTENTS, dropLowestOptionalIntent, intentLabel, intentsOf, officialIntents } from "./intents";

function connectWs(session, url, isResume) {
	if (session.ws) try {
		session.ws.close();
	} catch (err) {
		emitSystemLog(session.projectPath, "关闭旧 WebSocket 异常: " + (err instanceof Error ? err.message : String(err)), "warn");
	}
	const ws = new WebSocket(url);
	session.ws = ws;
	ws.onopen = () => {
		session.status = "connected";
		session.reconnecting = false;
		emitStatus(session);
	};
	ws.onmessage = (event) => {
		try {
			session.lastMessageAt = Date.now();
			const { op, d, s, t } = JSON.parse(event.data);
			if (s != null) session.seq = s;
			switch (op) {
				case 10:
					emitter.emit("official:message", session.projectPath, {
						type: "hello",
						data: { heartbeat_interval: d.heartbeat_interval }
					});
					startHeartbeat(session, d.heartbeat_interval && d.heartbeat_interval > 0 ? d.heartbeat_interval : DEFAULT_HEARTBEAT_INTERVAL_MS);
					if (isResume && session.sessionId && session.seq) ws.send(JSON.stringify({
						op: 6,
						d: {
							token: `QQBot ${session.accessToken}`,
							session_id: session.sessionId,
							seq: session.seq
						}
					}));
					else ws.send(JSON.stringify({
						op: 2,
						d: {
							token: `QQBot ${session.accessToken}`,
							intents: officialIntents(session.optionalIntents),
							shard: [0, 1],
							properties: {
								$os: "windows",
								$browser: "qqbat",
								$device: "qqbat"
							}
						}
					}));
					break;
				case 0:
					if (t === "READY") {
						session.sessionId = d.session_id;
						session.alive = true;
						session.retryCount = 0;
						emitter.emit("official:message", session.projectPath, {
							type: "READY",
							data: d
						});
					} else if (t === "RESUMED") {
						session.alive = true;
						session.retryCount = 0;
						emitter.emit("official:message", session.projectPath, {
							type: "resumed",
							data: d
						});
					} else emitter.emit("official:message", session.projectPath, {
						type: t,
						data: d,
						parsed: parseOfficialEvent(t, d)
					});
					break;
				case 11:
					session.lastHeartbeatAck = Date.now();
					session.alive = true;
					emitter.emit("official:message", session.projectPath, {
						type: "heartbeat_ack",
						data: {}
					});
					break;
				case 7:
					emitter.emit("official:message", session.projectPath, {
						type: "reconnect",
						data: d
					});
					ws.close();
					break;
				case 9:
					session.sessionId = null;
					session.seq = null;
					ws.close();
			}
		} catch (err) {
			emitSystemLog(session.projectPath, "官方消息解析异常: " + (err instanceof Error ? err.message : String(err)), "error");
		}
	};
	ws.onclose = (event) => {
		stopHeartbeat(session);
		session.ws = null;
		if (event.code === 4014) {
			const fallback = dropLowestOptionalIntent(session.optionalIntents || []);
			if (fallback.dropped) {
				session.optionalIntents = fallback.remaining;
				session.retryCount = 0;
				emitSystemLog(session.projectPath, "官方拒绝订阅「" + intentLabel(fallback.dropped) + "」事件（4014 无权限）—— 已退回重连，其余功能不受影响。要用这个事件，需先在 QQ 开放平台为机器人申请对应权限。");
			} else emitSystemLog(session.projectPath, "官方拒绝了全部事件订阅（4014）—— 请到 QQ 开放平台检查这个机器人的事件权限。", "error");
		}
		emitter.emit("official:message", session.projectPath, {
			type: "ws:close",
			data: {
				code: event.code,
				reason: event.reason
			}
		});
		if ((session.status === "connected" || session.status === "connecting") && !session.reconnecting) {
			session.status = "disconnected";
			emitStatus(session);
			scheduleReconnect(session);
		}
	};
	ws.onerror = () => {
		session.status = "error";
		emitStatus(session);
		if (!session.reconnecting && session.alive) scheduleReconnect(session);
	};
}
/**
* 实际重连逻辑：retryCount++ → 上限检查 → sleep(指数退避) → connectWs
* 失败时通过 scheduleReconnect(session, 0) 调度下一轮，消除原有递归调用，
* 避免维护者误改 `reconnecting = false; void reconnectWs()` 顺序导致重连卡死
*/
async function doReconnect(session) {
	if (session.reconnecting) return;
	if (!session.alive) return;
	session.reconnecting = true;
	stopHeartbeat(session);
	if (session.ws) {
		try {
			session.ws.close();
		} catch (err) {
			emitSystemLog(session.projectPath, "重连时关闭 WebSocket 异常: " + (err instanceof Error ? err.message : String(err)), "warn");
		}
		session.ws = null;
	}
	session.retryCount++;
	if (session.retryCount > session.maxRetries) {
		session.alive = false;
		session.status = "error";
		emitStatus(session);
		session.reconnecting = false;
		return;
	}
	const delay = Math.min(1e3 * Math.pow(2, session.retryCount), RECONNECT_MAX_DELAY_MS);
	await new Promise((r) => setTimeout(r, delay));
	if (!session.alive) {
		session.reconnecting = false;
		return;
	}
	try {
		const token = await ensureToken(session);
		connectWs(session, session.customWsUrl || await getGatewayUrl(token, session.sandbox), true);
	} catch (err) {
		emitSystemLog(session.projectPath, "官方重连异常: " + (err instanceof Error ? err.message : String(err)), "error");
		session.reconnecting = false;
		scheduleReconnect(session, 0);
		return;
	}
	session.reconnecting = false;
}
/**
* 调度延迟重连：统一管理 reconnectTimer，避免重复调度与递归调用
* 调用方一律通过本函数触发重连，doReconnect 失败后也通过本函数调度下一轮
* @param delay 调度延迟（毫秒），默认 0 表示立即触发下一轮 doReconnect（doReconnect 内部会再 sleep 退避时间）
*/
function scheduleReconnect(session, delay = 0) {
	if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
	session.reconnectTimer = setTimeout(() => {
		session.reconnectTimer = null;
		doReconnect(session);
	}, delay);
}
function startHeartbeat(session, interval) {
	stopHeartbeat(session);
	session.heartbeatInterval = interval;
	const sendBeat = () => {
		if (session.heartbeatTimeout) {
			clearTimeout(session.heartbeatTimeout);
			session.heartbeatTimeout = null;
		}
		if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({
			op: 1,
			d: session.seq
		}));
		session.heartbeatTimeout = setTimeout(() => {
			if (session.lastMessageAt && Date.now() - session.lastMessageAt > HEARTBEAT_TIMEOUT_THRESHOLD_MS) scheduleReconnect(session);
		}, HEARTBEAT_CHECK_INTERVAL_MS);
	};
	sendBeat();
	session.heartbeatTimer = setInterval(sendBeat, interval);
}
function stopHeartbeat(session) {
	if (session.heartbeatTimer) {
		clearInterval(session.heartbeatTimer);
		session.heartbeatTimer = null;
	}
	if (session.heartbeatTimeout) {
		clearTimeout(session.heartbeatTimeout);
		session.heartbeatTimeout = null;
	}
}
/**
* 把一个官方事件负载解析成 `OfficialEvent`。
*
* **导出是为了能测**：这里曾经漏读了 `author.username`（昵称）与 `author.union_openid`，
* 而漏读的后果很隐蔽 —— 下游只能把 `sender.nickname` 硬编码成空串，
* 表现为"官方渠道拿不到昵称"，看起来像平台限制。导出后可以对着
* 官方文档的示例负载**逐字段**钉住（见 tests/main/services/officialEventParse.test.ts）。
*/
function parseOfficialEvent(t, d) {
	const event = {
		type: t,
		id: d.id || "",
		content: d.content || "",
		timestamp: d.timestamp || "",
		author: {}
	};
	if (d.author && typeof d.author === "object") {
		const a = d.author;
		event.author.userOpenid = a.user_openid;
		event.author.memberOpenid = a.member_openid;
		event.author.memberRole = a.member_role;
		event.author.bot = a.bot;
		event.author.username = a.username;
		event.author.unionOpenid = a.union_openid;
	}
	event.messageType = Number(d.message_type ?? -1);
	event.arkType = String(d.ark_type ?? "");
	if (d.group_openid) event.groupOpenid = d.group_openid;
	if (d.attachments && Array.isArray(d.attachments)) event.attachments = d.attachments.map((a) => ({
		contentType: a.content_type || "",
		filename: a.filename || "",
		url: a.url || "",
		width: a.width,
		height: a.height,
		size: a.size
	}));
	return event;
}
async function startOfficial(projectPath) {
	for (const [, s] of sessions) if (s.projectPath === projectPath && s.alive) throw new Error("官方 API 已在运行中");
	const config = await loadOfficialConfig(projectPath);
	if (!config) throw new Error("未配置 AppID 和 AppSecret");
	const sessionKey = `${projectPath}-${Date.now()}`;
	const session = {
		projectPath,
		status: "connecting",
		appId: config.appId,
		appSecret: config.appSecret,
		sandbox: config.sandbox ?? false,
		customWsUrl: config.wsUrl || "",
		ws: null,
		heartbeatTimer: null,
		heartbeatTimeout: null,
		heartbeatInterval: 0,
		lastHeartbeatAck: null,
		lastMessageAt: 0,
		seq: null,
		sessionId: null,
		accessToken: "",
		tokenExpiresAt: 0,
		tokenRefreshTimer: null,
		retryCount: 0,
		maxRetries: 5,
		reconnecting: false,
		reconnectTimer: null,
		alive: false,
		optionalIntents: OPTIONAL_INTENTS.slice()
	};
	sessions.set(sessionKey, session);
	projectPathIndex.set(projectPath, sessionKey);
	emitStatus(session);
	try {
		const token = await ensureToken(session);
		connectWs(session, session.customWsUrl || await getGatewayUrl(token, session.sandbox), false);
	} catch (e) {
		session.status = "error";
		emitStatus(session);
		sessions.delete(sessionKey);
		projectPathIndex.delete(projectPath);
		throw e;
	}
}
function stopOfficial(projectPath) {
	for (const [sessionKey, session] of sessions) {
		if (session.projectPath !== projectPath) continue;
		stopHeartbeat(session);
		if (session.tokenRefreshTimer) clearTimeout(session.tokenRefreshTimer);
		if (session.reconnectTimer) {
			clearTimeout(session.reconnectTimer);
			session.reconnectTimer = null;
		}
		if (session.ws) try {
			session.ws.close();
		} catch (err) {
			emitSystemLog(session.projectPath, "停止时关闭 WebSocket 异常: " + (err instanceof Error ? err.message : String(err)), "warn");
		}
		session.ws = null;
		session.alive = false;
		session.status = "disconnected";
		emitStatus(session);
		projectPathIndex.delete(session.projectPath);
		sessions.delete(sessionKey);
	}
}
/** 心跳检测间隔（毫秒）：定期检查 WebSocket 是否存活 */
var HEARTBEAT_CHECK_INTERVAL_MS = 5e3;
/** 心跳超时判定阈值（毫秒）：超过此时间无消息则触发重连 */
var HEARTBEAT_TIMEOUT_THRESHOLD_MS = 3e4;
/** 重连指数退避上限（毫秒） */
var RECONNECT_MAX_DELAY_MS = 3e4;
/** 默认心跳间隔（毫秒，服务端未下发时使用） */
var DEFAULT_HEARTBEAT_INTERVAL_MS = 45e3;

export { connectWs, doReconnect, scheduleReconnect, startHeartbeat, stopHeartbeat, officialIntents, intentsOf, intentLabel, BASE_INTENTS, OPTIONAL_INTENTS, parseOfficialEvent, startOfficial, stopOfficial, HEARTBEAT_CHECK_INTERVAL_MS, HEARTBEAT_TIMEOUT_THRESHOLD_MS, RECONNECT_MAX_DELAY_MS, DEFAULT_HEARTBEAT_INTERVAL_MS };
