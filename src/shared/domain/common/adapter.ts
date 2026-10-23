// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { builtinMiddleware, createRouter } from "./router";
import { AdapterConfigValidator } from "./adapterConfig";
import { createStandardEvent, isMessageEvent } from "./standardEvent";

/** 适配器基类 */
var BaseAdapter = class {
	ctx;
	router;
	eventHandlers = /* @__PURE__ */ new Set();
	cleanupFns = [];
	constructor(ctx) {
		this.ctx = ctx;
		this.router = createRouter({
			prefixes: [],
			stripPrefix: true,
			keyPolicy: { maxWords: 2 }
		});
	}
	async init(ctx) {
		this.ctx = ctx;
		const validated = AdapterConfigValidator.validate(ctx.config);
		this.ctx.config = validated;
		this.ctx.status = "disconnected";
	}
	getStatus() {
		return this.ctx.status;
	}
	onEvent(callback) {
		this.eventHandlers.add(callback);
		const remove = () => this.eventHandlers.delete(callback);
		this.cleanupFns.push(remove);
		return remove;
	}
	getConfig() {
		return { ...this.ctx.config };
	}
	async updateConfig(config) {
		const merged = AdapterConfigValidator.mergeWithDefaults({
			...this.ctx.config,
			...config
		});
		const validated = AdapterConfigValidator.validate(merged);
		this.ctx.config = validated;
	}
	getRouter() {
		return this.router;
	}
	getMiddleware() {
		return builtinMiddleware;
	}
	/** 触发事件 */
	emitEvent(event) {
		for (const handler of this.eventHandlers) try {
			handler(event);
		} catch (e) {
			console.error("[Adapter] 事件处理异常:", e);
		}
	}
	/** 创建标准消息事件 */
	createMessageEvent(raw) {
		const event = createStandardEvent({
			...raw,
			type: "message"
		}, this.ctx.config.platform);
		if (!isMessageEvent(event)) throw new Error(`createMessageEvent 造出来的不是消息事件（type=${String(event.type)}）—— 事件契约有问题`);
		return event;
	}
	/** 清理资源 */
	cleanup() {
		for (const cleanup of this.cleanupFns) try {
			cleanup();
		} catch {}
		this.cleanupFns = [];
	}
};
function getOfficialBridge$1() {
	const api = globalThis.qqbat;
	if (!api?.official) throw new Error("OfficialAdapter 仅在渲染进程可用");
	const official = api.official;
	return {
		start: async (projectPath) => {
			return await official.start(projectPath);
		},
		stop: async (projectPath) => {
			return await official.stop(projectPath);
		},
		onStatusChange: official.onStatusChange.bind(official),
		saveConfig: async (projectPath, appId, appSecret) => {
			return await official.saveConfig(projectPath, appId, appSecret);
		},
		sendMessage: async (projectPath, chatType, chatId, content, options) => {
			return await official.sendMessage(projectPath, chatType, chatId, content, options);
		}
	};
}
var OfficialAdapter$1 = class extends BaseAdapter {
	projectPath = "";
	constructor(ctx) {
		super(ctx);
		const meta = ctx.metadata;
		this.projectPath = typeof meta.projectPath === "string" ? meta.projectPath : "";
		this.router = createRouter({
			prefixes: [
				"/",
				"修仙",
				"帮助",
				"帮忙"
			],
			stripPrefix: true,
			keyPolicy: { maxWords: 2 }
		});
	}
	async start() {
		this.ctx.status = "connecting";
		try {
			const bridge = getOfficialBridge$1();
			const result = await bridge.start(this.projectPath);
			if (!result.ok) {
				this.ctx.status = "error";
				throw new Error(result.error || "启动官方 API 失败");
			}
			const removeListener = bridge.onStatusChange((data) => {
				if (data.projectPath === this.projectPath) this.ctx.status = data.status;
			});
			this.cleanupFns.push(removeListener);
			this.ctx.status = "connected";
		} catch (e) {
			this.ctx.status = "error";
			throw e;
		}
	}
	async stop() {
		try {
			await getOfficialBridge$1().stop(this.projectPath);
		} catch {}
		this.cleanup();
		this.ctx.status = "disconnected";
	}
	async sendMessage(message) {
		const bridge = getOfficialBridge$1();
		const msg = message;
		const chatType = msg.message_type === "group" ? "group" : "c2c";
		const chatId = chatType === "group" ? String(msg.group_id ?? "") : String(msg.user_id ?? "");
		if (!chatId) throw new Error("OfficialAdapter.sendMessage: 缺少 user_id 或 group_id");
		let content = "";
		if (typeof msg.message === "string") content = msg.message;
		else if (Array.isArray(msg.message)) content = msg.message.filter((seg) => seg.type === "text").map((seg) => String(seg.data?.text ?? "")).join("");
		else if (typeof msg.raw_message === "string") content = msg.raw_message;
		const result = await bridge.sendMessage(this.projectPath, chatType, chatId, content);
		if (!result.ok) throw new Error(result.error || "官方 API 发送消息失败");
	}
};
({
	adapters: /* @__PURE__ */ new Map(),
	register(type, factory) {
		this.adapters.set(type, factory);
	},
	get(type) {
		return this.adapters.get(type);
	},
	list() {
		return Array.from(this.adapters.keys());
	},
	has(type) {
		return this.adapters.has(type);
	},
	create(type, ctx) {
		const Factory = this.adapters.get(type);
		if (!Factory) throw new Error(`未知的适配器类型: ${type}`);
		return new Factory(ctx);
	},
	/** 验证并创建适配器 */
	createValidated(type, rawConfig) {
		const base = rawConfig && typeof rawConfig === "object" ? { ...rawConfig } : {};
		const ctx = {
			config: AdapterConfigValidator.validate({
				...base,
				platform: type
			}),
			status: "disconnected",
			lastConnectedAt: null,
			reconnectAttempts: 0,
			metadata: {}
		};
		return this.create(type, ctx);
	}
}).register("qq-official", OfficialAdapter$1);

export { BaseAdapter, getOfficialBridge$1, OfficialAdapter$1 };
