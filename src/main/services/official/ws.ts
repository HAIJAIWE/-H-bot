// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { emitSystemLog } from "../runner/runtimeEvents";
import { emitStatus, emitter, ensureToken, getGatewayUrl, projectPathIndex, sessions } from "./client";
import { loadOfficialConfig } from "./config";
import { BASE_INTENTS, OPTIONAL_INTENTS, dropLowestOptionalIntent, intentLabel, intentsOf, officialIntents } from "./intents";
import { closeActionOf, closeReasonOf, fatalAdviceOf } from "./gatewayClose";
import { parseMessageSceneExt } from "./scene";
import type { ParsedOfficialEvent } from "./types";

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
						session.authFailureCount = 0;
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
		// 旧连接的 close 事件可能迟到（connectWs 会先关旧 ws）；
		// 此时 session.ws 已经指向新连接，别让旧事件停掉新连接的心跳。
		if (session.ws && session.ws !== ws) return;
		stopHeartbeat(session);
		session.ws = null;
		emitter.emit("official:message", session.projectPath, {
			type: "ws:close",
			data: {
				code: event.code,
				reason: event.reason,
				detail: closeReasonOf(event.code)
			}
		});
		// 主动 stop：不要当成断线去重连或报错
		if (session.stopping) return;
		const action = closeActionOf(event.code, Boolean(session.sessionId && session.seq));
		if (action === "fatal") {
			stopSession(session, "官方网关拒绝连接（" + event.code + " " + closeReasonOf(event.code) + "）：" + fatalAdviceOf(event.code, Boolean(session.sandbox)));
			return;
		}
		if (action === "refresh") {
			// 4004：旧 token 已失效。清 token 与 session，交给 doReconnect 里的 ensureToken 重新取。
			session.accessToken = "";
			session.tokenExpiresAt = 0;
			session.sessionId = null;
			session.seq = null;
			session.authFailureCount = (session.authFailureCount || 0) + 1;
			if (session.authFailureCount > 2) {
				stopSession(session, "官方网关连续 3 次鉴权失败（4004 TOKEN_INVALID）：AppID/AppSecret 可能不正确，或机器人已被下架/封禁。请到 QQ 开放平台核对凭证与机器人状态后再启动。");
				return;
			}
			emitSystemLog(session.projectPath, "官方网关鉴权失败（4004）：已清掉旧 token，重新获取后再连（连续第 " + session.authFailureCount + " 次）。", "warn");
		}
		if (action === "intents") {
			const fallback = dropLowestOptionalIntent(session.optionalIntents || []);
			if (!fallback.dropped) {
				// 基础 intents 也被拒：再重连只会重复撞墙，直接停下让用户去开权限
				stopSession(session, "官方拒绝了全部事件订阅（" + event.code + " " + closeReasonOf(event.code) + "）—— 连基础 intents 也被拒，请到 QQ 开放平台检查这个机器人的事件权限。");
				return;
			}
			session.optionalIntents = fallback.remaining;
			session.retryCount = 0;
			emitSystemLog(session.projectPath, "官方拒绝订阅「" + intentLabel(fallback.dropped) + "」事件（" + event.code + " " + closeReasonOf(event.code) + "）—— 已退回重连，其余功能不受影响。要用这个事件，需先在 QQ 开放平台为机器人申请对应权限。");
		}
		if (action === "identify") {
			// 协议参数类错误：保留 session 去 resume 会再次被拒，清掉重新鉴权
			session.sessionId = null;
			session.seq = null;
		}
		// 能走到这里的都是「值得再试一次」的情况（fatal / 连续 4004 / 基础 intents 被拒都已 return）。
		// 不按 status 判断：上一次断线已经把 status 置成 disconnected，按它判断会漏掉下一次重连。
		if (!session.reconnecting) {
			session.status = "disconnected";
			emitStatus(session);
			scheduleReconnect(session);
		}
	};
	ws.onerror = () => {
		if (session.stopping) return;
		session.status = "error";
		emitStatus(session);
		// 首次连接失败也要能重试：只按 stopping / reconnecting 判断，不看 alive（READY 前它是 false）
		if (!session.reconnecting) scheduleReconnect(session);
	};
}
/**
* 实际重连逻辑：retryCount++ → 上限检查 → sleep(指数退避) → connectWs
* 失败时通过 scheduleReconnect(session, 0) 调度下一轮，消除原有递归调用，
* 避免维护者误改 `reconnecting = false; void reconnectWs()` 顺序导致重连卡死
*/
async function doReconnect(session) {
	if (session.reconnecting) return;
	// 主动 stop 之后不再重连；但**首次连接失败**时 alive 还是 false，
	// 不能拿 alive 当闸门 —— 否则首次连不上就永远停在 error（以前就是这样）。
	if (session.stopping) return;
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
		session.reconnecting = false;
		stopSession(session, "官方网关连续 " + session.maxRetries + " 次重连失败，已停止重试。请检查网络与 AppID/AppSecret 后重新启动机器人。");
		return;
	}
	const delay = Math.min(1e3 * Math.pow(2, session.retryCount), RECONNECT_MAX_DELAY_MS);
	await new Promise((r) => setTimeout(r, delay));
	if (session.stopping) {
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
/**
* 不可恢复的断开：停掉所有定时器、交给界面「错误 + 原因」、清掉会话索引。
*
* 与 stopOfficial 的区别：stopOfficial 是用户主动停（状态 disconnected，正常收尾），
* 这里是被官方拒绝（4914/4915/连续 4004/全部 intents 被拒）——重试不会恢复，
* 所以不排重连，并把原因写进 session.lastError，供诊断页/日志直接读到。
*/
function stopSession(session, message) {
	stopHeartbeat(session);
	if (session.tokenRefreshTimer) {
		clearTimeout(session.tokenRefreshTimer);
		session.tokenRefreshTimer = null;
	}
	if (session.reconnectTimer) {
		clearTimeout(session.reconnectTimer);
		session.reconnectTimer = null;
	}
	session.alive = false;
	session.reconnecting = false;
	session.stopping = true;
	session.status = "error";
	session.lastError = message;
	if (session.ws) try {
		session.ws.close();
	} catch {}
	session.ws = null;
	emitStatus(session);
	emitSystemLog(session.projectPath, message, "error");
	projectPathIndex.delete(session.projectPath);
	for (const [key, s] of sessions) {
		if (s === session) {
			sessions.delete(key);
			break;
		}
	}
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
/** 对象或 JSON 字符串都认（官方部分字段在事件里是 JSON 字符串形态） */
function asRecord(v) {
	if (v && typeof v === "object" && !Array.isArray(v)) return v;
	if (typeof v === "string" && v.trim().startsWith("{")) try {
		const parsed = JSON.parse(v);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
	} catch {}
	return null;
}
/** 数组或 JSON 字符串都认 */
function asArray(v) {
	if (Array.isArray(v)) return v;
	if (typeof v === "string" && v.trim().startsWith("[")) try {
		const parsed = JSON.parse(v);
		if (Array.isArray(parsed)) return parsed;
	} catch {}
	return null;
}
function parseOfficialEvent(t, d): ParsedOfficialEvent {
	const event: ParsedOfficialEvent = {
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
	const rawAttachments = asArray(d.attachments);
	if (rawAttachments) event.attachments = rawAttachments.map((a) => ({
		contentType: a.content_type || "",
		filename: a.filename || "",
		url: a.url || "",
		width: a.width,
		height: a.height,
		size: a.size
	}));
	// 结构化卡片（官方只支持收，不支持发）
	const ark = asRecord(d.ark_data);
	if (ark) {
		const fields = asRecord(ark.fields);
		event.arkData = {
			arkType: String(ark.ark_type || ""),
			arkName: String(ark.ark_name || ""),
			prompt: String(ark.prompt || ""),
			fields: fields ?? {}
		};
	}
	// 嵌套消息元素（引用消息 103 / 聊天记录 102 等），原样保留给翻译器
	const elements = asArray(d.msg_elements);
	if (elements) event.msgElements = elements;
	// 消息场景上下文：msg_idx 就是引用回复要用的 REFIDX
	const scene = asRecord(d.message_scene);
	if (scene) {
		const ext = asArray(scene.ext) ?? [];
		const kv = parseMessageSceneExt(ext);
		event.messageScene = {
			source: String(scene.source || ""),
			ext: ext.filter((x) => typeof x === "string"),
			refIdx: kv.msg_idx || ""
		};
	}
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
		// 连续 4004 次数（token 刷新后仍然鉴权失败 → 多半是 AppSecret 错了/机器人下架）
		authFailureCount: 0,
		// 用户主动 stop 标志：让迟到的 onclose 知道「不是断线」
		stopping: false,
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
		session.stopping = true;
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
