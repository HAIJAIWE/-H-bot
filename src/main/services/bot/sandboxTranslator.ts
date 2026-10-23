// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import ws from "ws";
import { AdapterConfigSchema } from "../../../shared/domain/common/adapterConfig";
import { SandboxAdapter } from "../../../shared/domain/common/sandboxAdapter";
import { toRuntimeEvent } from "../../../shared/domain/common/runtimeEventConvert";
import { actionsForCapabilities } from "../../../shared/domain/common/capabilities";
import { init_logger, logger } from "../infra/logger";

var SandboxTranslator = class {
	wss;
	adapter;
	clients = /* @__PURE__ */ new Set();
	/**
	* 等到 WebSocket 服务真的开始监听。
	*
	* ⚠️ **不能构造完就读 `port`**：`new WebSocketServer({port})` 是异步绑定的，
	* 在 `'listening'` 之前 `wss.address()` 返回 `null` —— 传 `port: 0`（让系统分配）时
	* 读出来就是 `0`，调用方会拿 `0` 去连（踩过：运行时"连上了"其实连的是 0 端口，
	* `clientCount` 一直是 0，表现为"管线没通"）。
	*/
	listening;
	/** 运行时发来的动作（可断言"机器人有没有回复、回了什么"） */
	actions = [];
	/** 已推送出去的假事件 */
	emitted = [];
	options;
	started = false;
	constructor(options) {
		this.options = {
			port: options.port,
			fakeUsers: options.fakeUsers ?? ["10001", "10002"],
			fakeGroupId: options.fakeGroupId ?? "20001",
			selfId: options.selfId ?? "10000"
		};
		const ctx = {
			config: AdapterConfigSchema.parse({
				platform: "sandbox",
				fakeUsers: this.options.fakeUsers,
				fakeGroupId: this.options.fakeGroupId
			}),
			status: "disconnected",
			lastConnectedAt: null,
			reconnectAttempts: 0,
			metadata: {}
		};
		this.adapter = new SandboxAdapter(ctx);
		this.adapter.onEvent((event) => {
			const onebot = toRuntimeEvent(event);
			if (onebot) this.broadcast(onebot);
		});
		this.wss = new ws.WebSocketServer({
			host: "127.0.0.1",
			port: this.options.port
		});
		this.listening = new Promise((resolve) => {
			if (this.wss.address()) {
				resolve();
				return;
			}
			this.wss.once("listening", () => resolve());
		});
		this.wss.on("connection", (ws$1) => this.onConnection(ws$1));
	}
	/**
	* 真正监听的端口。
	*
	* 传 `port: 0`（系统分配）时**必须先 `await start()`**，否则还没绑定完，
	* 这里会返回 0 —— 调用方拿 0 去连就会连到别处。
	*/
	get port() {
		const addr = this.wss.address();
		return typeof addr === "object" && addr ? addr.port : this.options.port;
	}
	/** 当前连着的运行时数量 */
	get clientCount() {
		return this.clients.size;
	}
	async start() {
		if (this.started) return;
		await this.listening;
		await this.adapter.start();
		this.started = true;
	}
	async stop() {
		await this.adapter.stop();
		for (const ws$2 of this.clients) try {
			ws$2.close();
		} catch {}
		this.clients.clear();
		await new Promise((resolve) => this.wss.close(() => resolve()));
		this.started = false;
	}
	/**
	* 推一条假群消息。
	*
	* 返回推出去的文本；**没连运行时也照样生成**（`adapter.emitGroupMessage` 会派发，
	* `broadcast` 时没有客户端就自然没人收）—— 这样测试可以先起服务再连客户端。
	*/
	pushGroupMessage(text) {
		this.adapter.emitGroupMessage(text);
		this.emitted.push({
			text,
			at: Date.now()
		});
	}
	/** 推一条假私聊消息 */
	pushPrivateMessage(text) {
		this.adapter.emitPrivateMessage(text);
		this.emitted.push({
			text,
			at: Date.now()
		});
	}
	/** 等到至少收到一个动作（测试用；超时返回 false） */
	async waitForAction(action, timeoutMs = 3e3) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const hit = this.actions.find((a) => a.action === action);
			if (hit) return hit;
			await new Promise((r) => setTimeout(r, 20));
		}
		return null;
	}
	onConnection(ws$3) {
		this.clients.add(ws$3);
		logger.info(`[sandbox] 运行时已连接（当前 ${this.clients.size}）`);
		this.send(ws$3, {
			post_type: "meta_event",
			meta_event_type: "lifecycle",
			sub_type: "connect",
			self_id: this.options.selfId,
			time: Math.floor(Date.now() / 1e3)
		});
		this.send(ws$3, {
			post_type: "meta_event",
			meta_event_type: "heartbeat",
			status: {
				online: true,
				good: true
			},
			interval: 5e3,
			self_id: this.options.selfId,
			time: Math.floor(Date.now() / 1e3)
		});
		ws$3.on("message", (raw) => {
			try {
				this.handleAction(JSON.parse(raw.toString()));
			} catch {}
		});
		ws$3.on("close", () => {
			this.clients.delete(ws$3);
			logger.info(`[sandbox] 运行时断开（剩余 ${this.clients.size}）`);
		});
		ws$3.on("error", () => this.clients.delete(ws$3));
	}
	/**
	* 处理运行时发来的动作。
	*
	* ⚠️ `protected` 是**有意的扩展点**：真实平台（飞书/KOOK…）把它当翻译器用时，
	* 需要在这里把 `send_msg` 之类的动作**真的发出去**（而不是只记在 `actions` 里），
	* 同时保留原有的记录 + 回 echo 行为。子类覆写后调 `super` 即可。
	* 改成 private 会逼出一个"复制整份 SandboxTranslator"的坏方案。
	*
	* @returns **这条动作有没有被真正受理**。
	*   - 基类：不支持 → `false`（已回错误）；支持 → `true`（已回应答）
	*   - 子类：真的发出去了 → `true`；参数不全 / 没内容 → `false`
	*
	*   子类**必须**用 `if (!super.handleAction(msg)) return false;` 承接 ——
	*   我第一版只记日志不回传，结果子类在基类拒绝之后**继续往下跑**：
	*   那次恰好被后面的 chatId 检查挡住，但如果动作带了 chatId（比如 `send_media`
	*   带 `group_id`），子类会**照样发出去**，等于没拦。
	*/
	handleAction(msg) {
		const action = String(msg.action ?? "");
		const params = msg.params ?? {};
		this.actions.push({
			action,
			params
		});
		const echo = msg.echo;
		const supported = this.supportedActions();
		if (supported && !supported.includes(action)) {
			const reason = `本绑定不支持动作「${action}」，已拒绝执行。当前支持：${supported.join(" / ")}。若流程里用了对应节点，请换成该绑定支持的节点。`;
			logger.warn(`[translator] ${reason}`);
			this.sendActionReply(echo, {
				status: "failed",
				retcode: 100,
				data: null,
				message: reason
			});
			return false;
		}
		if (echo === void 0) return true;
		let data = {};
		if (action === "get_login_info") data = {
			user_id: Number(this.options.selfId) || 1e4,
			nickname: "沙箱机器人"
		};
		else if (action.includes("send")) data = { message_id: Date.now() };
		this.sendActionReply(echo, {
			status: "ok",
			retcode: 0,
			data
		});
		return true;
	}
	/**
	* **本绑定支持哪些能力**（子类覆写）—— 绑定能力的**唯一来源**。
	*
	* | 返回值 | 含义 |
	* | --- | --- |
	* | `null`（默认） | **不限制** —— 沙箱/测试的既有行为，保持不变 |
	* | `CapabilityId[]` | 只支持这些能力；动作名由 `actionsForCapabilities` 算出来 |
	*
	* ⚠️ **子类不要再覆写 `supportedActions()`** —— 能力与动作名分开写迟早对不上。
	* 词表见 `shared/domain/common/capabilities.ts`。
	*/
	capabilities() {
		return null;
	}
	/**
	* **本绑定实现了哪些动作**（由 `capabilities()` 派生，子类**不必**覆写）。
	*
	* | 返回值 | 含义 |
	* | --- | --- |
	* | `null` | **不限制** —— 沙箱/测试的现有行为，保持不变 |
	* | `string[]` | 只支持列出的动作，其余**显式拒绝** |
	*
	* ## 为什么要有这个（**这是一个真实 bug 的修复**）
	*
	* 以前子类对不认识的动作直接 `return`（比如飞书适配器开头的
	* `if (!action.includes('send')) return;`），而基类**统一回 `{status:'ok'}`** ——
	* 于是：**运行时以为成功了，平台侧什么也没发生，日志里一个字都没有**。
	*
	* 症状是"流程图跑完了、也没有报错、但机器人没反应"，用户完全无从下手。
	* 更糟的是反过来：**用户会以为自己配错了**，而去改一个其实没问题的流程。
	*
	* ## 这个模式项目里本来就有
	*
	* QQ 官方那条链（`eventBus.ts`）一直是这么做的：
	* `SUPPORTED_ACTIONS` 白名单 + `UNSUPPORTED_ACTIONS`（带人类可读原因）+
	* `default` 分支**回错误而不是静默成功**。新适配器只是没沿用 —— 这里把它补上。
	*/
	supportedActions() {
		const caps = this.capabilities();
		return caps === null ? null : actionsForCapabilities(caps);
	}
	/**
	* 把一条应答帧发给所有连着的运行时。
	*
	* 帧形状与 `eventBus` 的 `sendResponse` / `sendError` 保持一致
	* （运行时 `FlowRuntime.ts` 按 `status === 'failed'` 或 `retcode !== 0` 判失败，
	* 失败时**会 reject `callApi`** —— 这正是我们想要的：让它显式报错，而不是静默）。
	*/
	sendActionReply(echo, payload) {
		if (echo === void 0) return;
		const reply = JSON.stringify({
			...payload,
			echo
		});
		for (const ws$4 of this.clients) if (ws$4.readyState === ws$4.OPEN) ws$4.send(reply);
	}
	/**
	* 受保护的适配器访问器（**有意的扩展点**）。
	*
	* 真实平台接入（`lark/adapter.ts`）要用 `emitGroupMessage(text, over)` 推**真实**消息：
	* 父类构造函数里已经接好 `adapter.onEvent → toRuntimeEvent → broadcast`，
	* 所以子类只需 `emit*`，**不要**自己再造一份 OneBot 事件
	* （踩过：自己造的那份让运行时"说处理了"但流程图读到的内容不对）。
	*/
	get sandboxAdapter() {
		return this.adapter;
	}
	/**
	* 向所有连着的运行时广播一条 OneBot 事件。
	*
	* `protected` 是**有意的扩展点**：需要广播**任意** OneBot 事件时用
	* （`pushGroupMessage` 只能发固定文本）。事件形状与它内部产出的完全一致。
	*/
	broadcastOneBot(event) {
		this.broadcast(event);
	}
	broadcast(event) {
		for (const ws$5 of this.clients) this.send(ws$5, event);
	}
	send(ws$6, event) {
		if (ws$6.readyState !== ws$6.OPEN) return;
		try {
			ws$6.send(JSON.stringify(event));
		} catch {}
	}
};

export { SandboxTranslator };
