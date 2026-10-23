// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { FrameType, HeaderKey, LarkWsErrorCode, MessageType, decodeFrame, encodeFrame, getHeader, makePingFrame, makePongFrame } from "./frame";
import { init_logger, logger } from "../infra/logger";

/** 活跃连接数超限 */
var ERR_EXCEED_CONN_LIMIT = LarkWsErrorCode.exceed_conn_limit;
/** 鉴权失败 */
var ERR_AUTH_FAILED = LarkWsErrorCode.auth_failed;
/** 禁止 */
var ERR_FORBIDDEN = LarkWsErrorCode.forbidden;
/** 分片过期时间（官方 SDK 是 10 秒） */
var FRAGMENT_TTL_MS = 1e4;
/**
* 飞书长连接客户端。
*
* 状态机：`idle → connecting → connected → (closed|error)`。
* 断线由 `autoReconnect` 决定是否重连（默认重连，间隔与次数跟随服务端下发的 ClientConfig）。
*/
var LarkWsClient = class {
	opts;
	socket = null;
	connected = false;
	stopped = false;
	serviceId = 0;
	pingTimer = null;
	reconnectTimer = null;
	reconnectAttempts = 0;
	/** 服务端下发的重连策略 */
	cfg = {
		count: -1,
		interval: 120,
		nonce: 30,
		pingInterval: 120
	};
	/** 分片缓存（key = message_id） */
	fragments = /* @__PURE__ */ new Map();
	fragmentSweeper = null;
	/** 每个事件的回调（幂等键 + 已解析的 JSON） */
	messageHandlers = /* @__PURE__ */ new Set();
	errorHandlers = /* @__PURE__ */ new Set();
	fetchImpl;
	constructor(opts) {
		this.opts = opts;
		this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	}
	/**
	* 订阅事件。
	*
	* 回调**可以返回响应体**：卡片回调必须 3 秒内响应，返回的对象会作为响应体
	* 回写给飞书（`{code:200, data:base64(响应体)}`）。返回 `undefined` 表示不响应。
	*/
	onMessage(cb) {
		this.messageHandlers.add(cb);
		return () => this.messageHandlers.delete(cb);
	}
	onError(cb) {
		this.errorHandlers.add(cb);
		return () => this.errorHandlers.delete(cb);
	}
	isConnected() {
		return this.connected;
	}
	/** 建立长连接（会先探测端点） */
	async start() {
		this.stopped = false;
		await this.connectOnce();
		if (!this.fragmentSweeper) {
			this.fragmentSweeper = setInterval(() => this.sweepFragments(), FRAGMENT_TTL_MS);
			this.fragmentSweeper.unref?.();
		}
	}
	stop() {
		this.stopped = true;
		this.clearTimers();
		const s = this.socket;
		this.socket = null;
		this.connected = false;
		if (s) try {
			s.close();
		} catch {}
		this.fragments.clear();
	}
	/**
	* 探测 WebSocket 端点。
	*
	* 错误信息**要能直接指导用户**：514 是凭据错、403 是权限、超限要关掉别处连接。
	* 只抛 "fetch failed" 之类的原始错误，用户完全不知道该怎么办（QQ 官方那次的教训）。
	*/
	async fetchEndpoint() {
		const domain = this.opts.domain ?? "https://open.feishu.cn";
		const endpoint = `${domain}/callback/ws/endpoint`;
		this.log(`[lark] 探测长连接端点: ${endpoint}`);
		let res;
		try {
			res = await this.fetchImpl(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "qqbat-lark-ws/1.0"
				},
				body: JSON.stringify({
					AppID: this.opts.appId,
					AppSecret: this.opts.appSecret
				})
			});
		} catch (e) {
			throw new Error(`无法连接飞书开放平台（${domain}）：${e instanceof Error ? e.message : String(e)}。请检查网络或代理设置`);
		}
		let body;
		try {
			body = await res.json();
		} catch {
			throw new Error(`飞书端点探测返回了非 JSON 内容（HTTP ${res.status}）`);
		}
		const code = body.code ?? 0;
		if (code !== 0 || !body.data?.URL) throw new Error(this.explainEndpointError(code, body.msg));
		const cc = body.data.ClientConfig;
		if (cc) this.cfg = {
			count: numOr(cc.ReconnectCount, this.cfg.count),
			interval: posNumOr(cc.ReconnectInterval, this.cfg.interval),
			nonce: nonNegNumOr(cc.ReconnectNonce, this.cfg.nonce),
			pingInterval: posNumOr(cc.PingInterval, this.cfg.pingInterval)
		};
		return {
			url: body.data.URL,
			clientConfig: body.data
		};
	}
	/** 把服务端错误码翻译成用户能照做的提示 */
	explainEndpointError(code, msg) {
		const suffix = msg ? `（服务端消息：${msg}）` : "";
		switch (code) {
			case ERR_AUTH_FAILED: return `飞书鉴权失败（514）${suffix}。请核对 App ID / App Secret 是否正确`;
			case ERR_FORBIDDEN: return `飞书拒绝了这次连接（403）${suffix}。请确认应用已发布、且开通了 im:message 权限`;
			case ERR_EXCEED_CONN_LIMIT: return `飞书长连接数超限（${ERR_EXCEED_CONN_LIMIT}）${suffix}。同一个应用最多 50 个长连接 —— 请先关掉其它正在运行的本应用实例（比如别的项目里也开了机器人）`;
			default: return `飞书端点探测失败（code=${code}）${suffix}`;
		}
	}
	async connectOnce() {
		if (this.stopped) return;
		const { url } = await this.fetchEndpoint();
		try {
			const sid = new URL(url).searchParams.get("service_id");
			if (sid) this.serviceId = Number(sid) || 0;
		} catch {}
		const factory = this.opts.wsFactory;
		if (!factory) throw new Error("LarkWsClient: 必须注入 wsFactory（真实装配见 lark/adapter.ts）");
		const socket = factory(url);
		this.socket = socket;
		socket.on("open", () => {
			this.connected = true;
			this.reconnectAttempts = 0;
			this.log(`[lark] 长连接已建立（service_id=${this.serviceId}）`);
			this.startPingTimer();
		});
		socket.on("message", (raw) => {
			try {
				const buf = toUint8Array(raw);
				this.handleFrame(decodeFrame(buf));
			} catch (e) {
				this.emitError(/* @__PURE__ */ new Error(`飞书帧解析失败: ${e instanceof Error ? e.message : String(e)}`));
			}
		});
		socket.on("close", () => {
			this.connected = false;
			this.stopPingTimer();
			this.log("[lark] 长连接断开");
			this.scheduleReconnect();
		});
		socket.on("error", (err) => {
			this.emitError(err instanceof Error ? err : new Error(String(err)));
		});
	}
	scheduleReconnect() {
		if (this.stopped || this.reconnectTimer) return;
		const { count, interval, nonce } = this.cfg;
		if (count >= 0 && this.reconnectAttempts >= count) {
			this.log(`[lark] 已达重连上限（${count} 次），停止重连`);
			return;
		}
		this.reconnectAttempts++;
		const jitterMs = Math.floor(Math.random() * nonce * 1e3);
		const delayMs = interval * 1e3 + jitterMs;
		this.log(`[lark] ${Math.round(delayMs / 1e3)} 秒后重连（第 ${this.reconnectAttempts} 次）`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.stopped) return;
			this.connectOnce().catch((e) => {
				this.emitError(e instanceof Error ? e : new Error(String(e)));
				this.scheduleReconnect();
			});
		}, delayMs);
	}
	handleFrame(frame) {
		const type = getHeader(frame, HeaderKey.type);
		if (type === MessageType.ping) {
			this.sendFrame(makePongFrame(this.serviceId, frame.headers));
			return;
		}
		if (type === MessageType.pong) {
			this.applyPongConfig(frame.payload);
			return;
		}
		if (frame.method === FrameType.data || type === MessageType.event || type === MessageType.card) {
			const merged = this.mergeFragments(frame);
			if (merged === null) return;
			let payload;
			try {
				payload = JSON.parse(Buffer.from(merged).toString("utf8"));
			} catch (e) {
				this.emitError(/* @__PURE__ */ new Error(`飞书事件 payload 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`));
				return;
			}
			const eventId = extractEventId(payload);
			let responseData;
			for (const h of this.messageHandlers) try {
				const r = h(payload, eventId);
				if (r !== void 0 && r !== null) responseData = r;
			} catch (e) {
				this.emitError(e instanceof Error ? e : new Error(String(e)));
			}
			if (frame.method === FrameType.data || type === MessageType.event) {
				const respPayload = { code: 200 };
				if (responseData !== void 0 && responseData !== null) respPayload.data = Buffer.from(JSON.stringify(responseData), "utf8").toString("base64");
				this.sendFrame({
					...frame,
					headers: [...frame.headers, {
						key: HeaderKey.bizRt,
						value: "0"
					}],
					payload: new Uint8Array(Buffer.from(JSON.stringify(respPayload), "utf8"))
				});
			}
		}
	}
	/**
	* 分片合并。
	*
	* 大事件会被拆成多帧，每帧带 `message_id` / `sum` / `seq` 三个头。
	* 返回 `null` 表示"还没凑齐"。
	*
	* 对**畸形分片元数据**要报错而不是静默：`sum` 非法会让 `new Array(sum)` 抛
	* RangeError，`seq` 越界会造出空洞让 JSON.parse 失败（官方 SDK 修过这个 bug，
	* 见其 issue #201）。这里同样显式校验。
	*/
	mergeFragments(frame) {
		const payload = frame.payload ?? /* @__PURE__ */ new Uint8Array(0);
		const messageId = getHeader(frame, HeaderKey.messageId);
		const sumRaw = getHeader(frame, HeaderKey.sum);
		const seqRaw = getHeader(frame, HeaderKey.seq);
		if (messageId === void 0 || sumRaw === void 0 || seqRaw === void 0) return payload;
		const sum = Number(sumRaw);
		const seq = Number(seqRaw);
		if (!Number.isInteger(sum) || sum <= 0 || !Number.isInteger(seq) || seq < 0 || seq >= sum) throw new Error(`飞书分片元数据非法（sum=${sumRaw}, seq=${seqRaw}）`);
		let entry = this.fragments.get(messageId);
		if (!entry) {
			entry = {
				parts: new Array(sum),
				createdAt: Date.now()
			};
			this.fragments.set(messageId, entry);
		} else if (entry.parts.length !== sum) throw new Error(`飞书分片 sum 不一致（首片 ${entry.parts.length}，本片 ${sum}），无法拼接`);
		entry.parts[seq] = payload;
		if (entry.parts.some((p) => p === void 0)) return null;
		const parts = entry.parts;
		const total = parts.reduce((n, p) => n + p.length, 0);
		const merged = new Uint8Array(total);
		let off = 0;
		for (const p of parts) {
			merged.set(p, off);
			off += p.length;
		}
		this.fragments.delete(messageId);
		return merged;
	}
	sweepFragments() {
		const now = Date.now();
		for (const [id, e] of this.fragments) if (now - e.createdAt > FRAGMENT_TTL_MS) this.fragments.delete(id);
	}
	/** 发一个帧（未连接时静默丢弃并返回 false） */
	sendFrame(frame) {
		if (!this.socket || !this.connected) return false;
		try {
			this.socket.send(Buffer.from(encodeFrame(frame)));
			return true;
		} catch (e) {
			this.emitError(e instanceof Error ? e : new Error(String(e)));
			return false;
		}
	}
	/**
	* 应用 **pong 里带回的心跳/重连配置**。
	*
	* 官方 node-sdk 的 `handleControlData` 就是干这个的：收到 pong 后解析
	* `PingInterval` / `ReconnectCount` / `ReconnectInterval` / `ReconnectNonce`
	* 并**更新本地配置**。pong 里的值是**权威值** —— 服务端可以调整它。
	*
	* ⚠️ 我第一版收到 pong 直接 `return`，把这些全丢了：端点探测给的是初值，
	* 服务端之后要求"改心跳间隔"就收不到，只能一直按旧值发。
	*
	* 解析失败**只记日志不抛** —— 一个坏 pong 不该把连接搞崩
	* （官方 SDK 在这里也是 catch 住并记日志，见其 issue #201 的教训）。
	*/
	applyPongConfig(payload) {
		if (!payload || payload.length === 0) return;
		let pong;
		try {
			pong = JSON.parse(Buffer.from(payload).toString("utf8"));
		} catch (e) {
			this.log(`[lark] pong 的 payload 不是合法 JSON（已忽略）: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		const prevPing = this.cfg.pingInterval;
		const nextPing = posNumOr(pong.PingInterval, prevPing);
		this.cfg = {
			count: numOr(pong.ReconnectCount, this.cfg.count),
			interval: posNumOr(pong.ReconnectInterval, this.cfg.interval),
			nonce: nonNegNumOr(pong.ReconnectNonce, this.cfg.nonce),
			pingInterval: nextPing
		};
		if (nextPing !== prevPing) {
			this.log(`[lark] 服务端调整了心跳间隔: ${prevPing}s → ${nextPing}s`);
			this.startPingTimer();
		}
	}
	startPingTimer() {
		this.stopPingTimer();
		const ms = Math.max(1, this.cfg.pingInterval) * 1e3;
		this.pingTimer = setInterval(() => {
			if (!this.sendFrame(makePingFrame(this.serviceId))) this.log("[lark] 心跳发送失败（连接可能已断）");
		}, ms);
		this.pingTimer.unref?.();
	}
	stopPingTimer() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}
	clearTimers() {
		this.stopPingTimer();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.fragmentSweeper) {
			clearInterval(this.fragmentSweeper);
			this.fragmentSweeper = null;
		}
	}
	emitError(err) {
		logger.error(`[lark] ${err.message}`);
		this.log(`[lark] 错误: ${err.message}`);
		for (const h of this.errorHandlers) try {
			h(err);
		} catch {}
	}
	log(line) {
		if (this.opts.onLog) this.opts.onLog(line);
		else logger.info(line);
	}
};
/**
* 数值兜底：**只有"不是有限数字"才算缺失**。
*
* ⚠️ 曾经写成 `v > 0 ? v : 默认` —— 把**合法的 0 当成没给**。
* 后果：服务端下发 `ReconnectNonce: 0`（明确表示"不要随机抖动"）时，
* 我们退回默认 30，于是重连被随机推迟最多 30 秒，
* 表现是"断线后半天不重连"（踩过：日志里写着"6 秒后重连"而配置是 0）。
*/
function numOr(v, fallback) {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
/** 正数兜底（0/负数是无效配置才退回默认） */
function posNumOr(v, fallback) {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}
/** 非负数兜底（**允许 0** —— 0 是有意义的值） */
function nonNegNumOr(v, fallback) {
	return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}
/** 从事件 payload 里取幂等键（v2.0 header.event_id / v1.0 uuid） */
function extractEventId(payload) {
	if (!payload || typeof payload !== "object") return void 0;
	const p = payload;
	const fromHeader = p.header?.event_id;
	if (typeof fromHeader === "string" && fromHeader) return fromHeader;
	if (typeof p.uuid === "string" && p.uuid) return p.uuid;
}
/**
* 把 ws 给的各种形态（Buffer / ArrayBuffer / 类型化数组 / Buffer[]）统一成 Uint8Array。
*
* ⚠️ **不要用 `instanceof Uint8Array`**：`Buffer` 虽然是 `Uint8Array` 的子类，
* 但跨 realm（不同 vm 上下文 / Electron 多进程边界 / 测试环境）时原型链不同，
* `instanceof` 会返回 false —— 表现是"帧收到了却报'无法识别的帧数据类型'"，
* 逻辑明明没错却收不到任何事件（踩过，排查成本很高）。
* `ArrayBuffer.isView` 按内部槽判断，跨 realm 依然可靠。
*/
function toUint8Array(raw) {
	if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
	if (Array.isArray(raw)) {
		const parts = raw.map((r) => toUint8Array(r));
		const total = parts.reduce((n, p) => n + p.length, 0);
		const out = new Uint8Array(total);
		let off = 0;
		for (const p of parts) {
			out.set(p, off);
			off += p.length;
		}
		return out;
	}
	if (typeof raw === "string") return new Uint8Array(Buffer.from(raw, "binary"));
	throw new Error("无法识别的帧数据类型");
}

export { ERR_EXCEED_CONN_LIMIT, ERR_AUTH_FAILED, ERR_FORBIDDEN, FRAGMENT_TTL_MS, LarkWsClient, numOr, posNumOr, nonNegNumOr, extractEventId, toUint8Array };
