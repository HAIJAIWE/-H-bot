// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";

/** 取连接地址的网关（官方常量） */
var GATEWAY_URL = "https://api.dingtalk.com/v1.0/gateway/connections/open";
/** 服务端应答状态（官方枚举，**是字符串不是数字**） */
var EventAck = {
	SUCCESS: "SUCCESS",
	LATER: "LATER"
};
/**
* 钉钉 Stream 长连接。
*
* 状态机：`idle → connecting → connected → registered → (closed|error)`
* （`registered` 是服务端回 `SYSTEM/REGISTERED` 之后 —— 只有到这一步订阅才真正生效）
*/
var DingTalkStreamClient = class {
	opts;
	socket = null;
	stopped = false;
	connecting = false;
	opened = false;
	registered = false;
	endpointUrl = null;
	heartbeatTimer = null;
	reconnectTimer = null;
	reconnectAttempts = 0;
	/** 上次收到任何服务端帧的时间（判断连接是否还活着） */
	lastInboundAt = 0;
	/** 等待 pong 期间置 false；下一次 tick 若仍为 false 说明对端没回 */
	alive = false;
	fetchImpl;
	frameHandlers = /* @__PURE__ */ new Set();
	systemHandlers = /* @__PURE__ */ new Set();
	errorHandlers = /* @__PURE__ */ new Set();
	constructor(opts) {
		this.opts = opts;
		this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	}
	/** 订阅业务帧（EVENT / CALLBACK）。**返回值会被放进 ack** */
	onFrame(cb) {
		this.frameHandlers.add(cb);
		return () => this.frameHandlers.delete(cb);
	}
	/** 订阅 SYSTEM 帧的 topic（`CONNECTED` / `REGISTERED` / `KEEPALIVE`） */
	onSystem(cb) {
		this.systemHandlers.add(cb);
		return () => this.systemHandlers.delete(cb);
	}
	onError(cb) {
		this.errorHandlers.add(cb);
		return () => this.errorHandlers.delete(cb);
	}
	isConnected() {
		return this.opened;
	}
	/**
	* 是否**订阅已生效**。
	*
	* ⚠️ 与飞书不同：钉钉连上之后还要等服务端推 `SYSTEM/REGISTERED`，
	* 在那之前订阅是不生效的（消息不会推过来）。诊断"连上了但收不到消息"要看这个。
	*/
	isRegistered() {
		return this.registered;
	}
	async start() {
		this.stopped = false;
		await this.connectOnce();
	}
	stop() {
		this.stopped = true;
		this.clearHeartbeat();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		try {
			this.socket?.close();
		} catch {}
		this.socket = null;
		this.opened = false;
		this.registered = false;
		this.connecting = false;
	}
	async connectOnce() {
		if (this.stopped || this.connecting) return;
		this.connecting = true;
		try {
			const url = await this.fetchEndpoint();
			if (this.stopped) return;
			this.openSocket(url);
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			this.emitError(err);
			this.scheduleReconnect();
		} finally {
			this.connecting = false;
		}
	}
	/**
	* 取连接地址。
	*
	* 🔴 **`Accept: application/json` 是必需的** —— 官方 SDK 的注释原文：
	* 「这个接口得加个，否则默认返回的会是 xml」。少了它拿到的响应解析不出 `endpoint`。
	*/
	async fetchEndpoint() {
		const subscriptions = this.opts.subscriptions ?? [{
			type: "CALLBACK",
			topic: "/v1.0/im/bot/messages/get"
		}, {
			type: "CALLBACK",
			topic: "/v1.0/card/instances/callback"
		}];
		const res = await this.fetchImpl(this.opts.gatewayUrl ?? GATEWAY_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
			},
			body: JSON.stringify({
				clientId: this.opts.clientId,
				clientSecret: this.opts.clientSecret,
				subscriptions
			})
		});
		if (!res.ok) throw new Error(`钉钉取连接地址失败（HTTP ${res.status}）`);
		const body = await res.json();
		if (!body.endpoint || !body.ticket) throw new Error(`钉钉取连接地址失败（${body.code ?? ""} ${body.message ?? "响应里没有 endpoint/ticket"}）。请核对 AppKey / AppSecret，并确认应用已添加「机器人」能力`);
		this.log("[dingtalk] 已取到长连接地址");
		return `${body.endpoint}?ticket=${encodeURIComponent(body.ticket)}`;
	}
	/**
	* 装配 socket 并挂上处理器。
	*
	* ⚠️ **不等待 `open`**（与 `LarkWsClient` 一致）。
	* 我第一版把这里写成 `Promise` 并 `await` 它直到 `open` ——
	* 结果是**死锁**：`start()` 等 open，而调用方（含测试）习惯"`await start()`
	* 之后再模拟 open"。9 个端到端用例全部 30 秒超时才发现。
	*
	* 语义上也该如此：`start()` 表示"连接流程已发起"，"已连上"看 `isConnected()`。
	*/
	openSocket(url) {
		this.endpointUrl = url;
		const factory = this.opts.wsFactory;
		if (!factory) {
			this.emitError(/* @__PURE__ */ new Error("DingTalkStreamClient: 必须注入 wsFactory（真实装配见 src/main/services/dingtalk/adapter.ts）"));
			return;
		}
		let socket;
		try {
			socket = factory(url);
		} catch (e) {
			this.emitError(e instanceof Error ? e : new Error(String(e)));
			return;
		}
		this.socket = socket;
		socket.on("open", () => {
			if (this.socket !== socket || this.stopped) {
				this.safeClose(socket);
				return;
			}
			this.opened = true;
			this.reconnectAttempts = 0;
			this.lastInboundAt = Date.now();
			this.log("[dingtalk] 长连接已建立（等待服务端 REGISTERED）");
			this.startHeartbeat(socket);
		});
		socket.on("message", (data) => {
			if (this.socket !== socket) return;
			this.handleInbound(data);
		});
		socket.on("pong", () => {
			this.alive = true;
		});
		socket.on("close", () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.opened = false;
			this.registered = false;
			this.clearHeartbeat();
			this.log("[dingtalk] 长连接断开");
			this.scheduleReconnect();
		});
		socket.on("error", (e) => {
			if (this.socket !== socket) return;
			this.emitError(e instanceof Error ? e : new Error(String(e)));
			this.safeClose(socket);
		});
	}
	handleInbound(data) {
		this.lastInboundAt = Date.now();
		this.alive = true;
		const text = typeof data === "string" ? data : String(data);
		let frame;
		try {
			frame = JSON.parse(text);
		} catch (e) {
			this.emitError(/* @__PURE__ */ new Error(`钉钉帧不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`));
			return;
		}
		if (!frame || typeof frame !== "object") return;
		const type = String(frame.type ?? "");
		const topic = String(frame.headers?.topic ?? "");
		if (type === "SYSTEM") {
			this.handleSystem(frame, topic);
			return;
		}
		if (type !== "EVENT" && type !== "CALLBACK") {
			this.log(`[dingtalk] 未知帧类型 type="${type}" topic="${topic}"（已忽略）`);
			return;
		}
		let ackData;
		try {
			for (const h of this.frameHandlers) {
				const r = h(frame);
				if (r !== void 0 && r !== null) ackData = r;
			}
		} catch (e) {
			this.emitError(e instanceof Error ? e : new Error(String(e)));
		}
		this.sendAck(frame, EventAck.SUCCESS, ackData);
	}
	handleSystem(frame, topic) {
		switch (topic) {
			case "CONNECTED":
				this.log("[dingtalk] 服务端已确认连接（CONNECTED）");
				break;
			case "REGISTERED":
				this.registered = true;
				this.log("[dingtalk] 订阅已生效（REGISTERED）—— 现在开始能收到消息了");
				break;
			case "KEEPALIVE": break;
			case "ping":
				this.sendAck(frame, EventAck.SUCCESS, void 0);
				break;
			case "disconnect":
				this.log("[dingtalk] 服务端要求断开（disconnect），回 200 后主动关闭");
				this.sendAck(frame, EventAck.SUCCESS, void 0);
				this.safeClose(this.socket);
				break;
			default: this.log(`[dingtalk] 未知 SYSTEM topic="${topic}"（已忽略）`);
		}
		for (const h of this.systemHandlers) try {
			h(topic);
		} catch {}
	}
	/**
	* 回应答帧（官方 `sendEventAck`）。
	*
	* ```jsonc
	* { "code": 200,
	*   "headers": { "contentType": "application/json", "messageId": "<原帧的>" },
	*   "message": "OK",
	*   "data": "{\"status\":\"SUCCESS\"}"   // ← 注意是**字符串化的 JSON**
	* }
	* ```
	*
	* `messageId` **必须原样带回** —— 服务端靠它认出这是哪条的响应。
	*/
	sendAck(frame, status, data) {
		const payload = {
			code: 200,
			headers: {
				contentType: "application/json",
				messageId: frame.headers?.messageId
			},
			message: "OK",
			data: JSON.stringify(data === void 0 ? { status } : {
				status,
				result: data
			})
		};
		this.sendFrame(payload);
	}
	sendFrame(payload) {
		const socket = this.socket;
		if (!socket || this.opened === false) return;
		try {
			socket.send(JSON.stringify(payload));
		} catch (e) {
			this.emitError(e instanceof Error ? e : new Error(String(e)));
		}
	}
	startHeartbeat(socket) {
		this.clearHeartbeat();
		if (this.opts.keepAlive === false) return;
		if (typeof socket.ping !== "function") return;
		const interval = this.opts.heartbeatIntervalMs ?? 8e3;
		this.alive = true;
		this.heartbeatTimer = setInterval(() => {
			if (this.socket !== socket) return;
			if (!this.alive) {
				this.log("[dingtalk] 心跳超时（没收到 pong），主动断开并重连");
				socket.terminate?.() ?? this.safeClose(socket);
				return;
			}
			this.alive = false;
			try {
				socket.ping?.();
			} catch {}
		}, interval);
		this.heartbeatTimer.unref?.();
	}
	clearHeartbeat() {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
	/** 指数退避重连（官方 SDK 是 1s 起、60s 封顶） */
	scheduleReconnect() {
		if (this.stopped || this.reconnectTimer) return;
		const delay = Math.min(1e3 * 2 ** this.reconnectAttempts, 6e4);
		this.reconnectAttempts++;
		this.log(`[dingtalk] ${Math.round(delay / 1e3)} 秒后重连（第 ${this.reconnectAttempts} 次）`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connectOnce();
		}, delay);
		this.reconnectTimer.unref?.();
	}
	safeClose(socket) {
		if (!socket) return;
		try {
			socket.close();
		} catch {}
	}
	emitError(err) {
		for (const h of this.errorHandlers) try {
			h(err);
		} catch {}
	}
	log(line) {
		logger.info(line);
		this.opts.onLog?.(line);
	}
};

export { GATEWAY_URL, EventAck, DingTalkStreamClient };
