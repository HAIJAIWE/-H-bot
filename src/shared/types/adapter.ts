// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

function getOfficialBridge() {
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
var OfficialAdapter = class {
	config;
	status = "disconnected";
	messageHandlers = /* @__PURE__ */ new Set();
	projectPath = "";
	cleanupFns = [];
	constructor(config) {
		this.config = config;
		this.projectPath = config.options?.projectPath || "";
	}
	async init(config) {
		this.config = config;
		this.projectPath = config.options?.projectPath || "";
		this.status = "disconnected";
	}
	async start() {
		this.status = "connecting";
		try {
			const bridge = getOfficialBridge();
			const result = await bridge.start(this.projectPath);
			if (!result.ok) {
				this.status = "error";
				throw new Error(result.error || "启动官方 API 失败");
			}
			const removeListener = bridge.onStatusChange((data) => {
				if (data.projectPath === this.projectPath) this.status = data.status;
			});
			this.cleanupFns.push(removeListener);
		} catch (e) {
			this.status = "error";
			throw e;
		}
	}
	async stop() {
		try {
			await getOfficialBridge().stop(this.projectPath);
		} catch {}
		for (const cleanup of this.cleanupFns) cleanup();
		this.cleanupFns = [];
		this.status = "disconnected";
	}
	getStatus() {
		return this.status;
	}
	async sendMessage(message) {
		const bridge = getOfficialBridge();
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
	onMessage(callback) {
		this.messageHandlers.add(callback);
		const remove = () => this.messageHandlers.delete(callback);
		this.cleanupFns.push(remove);
		return remove;
	}
	getConfig() {
		return { ...this.config };
	}
	async updateConfig(config) {
		this.config = {
			...this.config,
			...config,
			options: {
				...this.config.options,
				...config.options
			}
		};
	}
};
var AdapterRegistry = class {
	adapters = /* @__PURE__ */ new Map();
	register(type, factory) {
		this.adapters.set(type, factory);
	}
	get(type) {
		return this.adapters.get(type);
	}
	list() {
		return Array.from(this.adapters.keys());
	}
	has(type) {
		return this.adapters.has(type);
	}
	create(type, config) {
		const Factory = this.adapters.get(type);
		if (!Factory) throw new Error(`未知的适配器类型: ${type}`);
		return new Factory(config);
	}
};
/** 全局适配器注册表单例 */
var adapterRegistry = new AdapterRegistry();
adapterRegistry.register("official", OfficialAdapter);

export { getOfficialBridge, OfficialAdapter, AdapterRegistry, adapterRegistry };
