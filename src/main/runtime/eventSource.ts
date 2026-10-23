// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import ws from "ws";
import { BUS_WS_PATH } from "../../shared/protocol/bus";
import { init_logger, logger } from "../services/infra/logger";

/**
* 事件源基类：统一管理状态与监听者。
*
* 两个实现（WebSocket / 进程内）都继承它，省掉重复的 setState + 通知逻辑。
*/
var BaseEventSource = class {
	options;
	state = "closed";
	listeners = /* @__PURE__ */ new Set();
	constructor(options) {
		this.options = options;
	}
	getState() {
		return this.state;
	}
	onStatusChange(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	/** 改状态并**同时**通知构造时给的回调与后挂的监听者 */
	setState(state, detail) {
		this.state = state;
		this.options.onStatus(state, detail);
		for (const listener of this.listeners) try {
			listener(state, detail);
		} catch {}
	}
};
var WebSocketEventSource = class extends BaseEventSource {
	ws = null;
	stopped = false;
	reconnectTimer = null;
	reconnectDelayMs;
	wsOptions;
	constructor(options) {
		super(options);
		this.wsOptions = options;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 3e3;
	}
	start() {
		const st = this.getState();
		if (st === "open" || st === "connecting") return;
		this.stopped = false;
		this.connect();
	}
	stop() {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const ws$1 = this.ws;
		this.ws = null;
		if (ws$1) try {
			ws$1.removeAllListeners();
			ws$1.close();
		} catch {}
		this.setState("closed");
	}
	isOpen() {
		return this.ws !== null && this.ws.readyState === ws.OPEN;
	}
	send(payload) {
		if (!this.ws || this.ws.readyState !== ws.OPEN) return false;
		try {
			this.ws.send(JSON.stringify(payload));
			return true;
		} catch {
			return false;
		}
	}
	connect() {
		const { host, port } = this.wsOptions;
		const url = `ws://${host}:${port}${BUS_WS_PATH}`;
		logger.info(`[ts-runtime] 连接翻译器: ${url}`);
		this.setState("connecting");
		try {
			this.ws = new ws(url);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.setState("error", msg);
			this.scheduleReconnect();
			return;
		}
		this.ws.on("open", () => {
			logger.info("[ts-runtime] 已连接翻译器");
			this.wsOptions.onLog("[ts-runtime] 已连接翻译器");
			this.setState("open");
		});
		this.ws.on("message", (raw) => {
			try {
				this.wsOptions.onMessage(JSON.parse(raw.toString()));
			} catch {}
		});
		this.ws.on("close", () => {
			logger.warn("[ts-runtime] 翻译器连接断开");
			this.wsOptions.onLog("[ts-runtime] 翻译器连接断开");
			this.setState("closed");
			this.scheduleReconnect();
		});
		this.ws.on("error", (err) => {
			logger.error(`[ts-runtime] WebSocket 错误: ${err.message}`);
			this.wsOptions.onLog(`[ts-runtime] WebSocket 错误: ${err.message}`);
			this.setState("error", err.message);
		});
		this.ws.on("unexpected-response", (_req, res) => {
			const code = res.statusCode ?? 0;
			const hint = code === 404 ? `端口 ${port} 上的服务不是本项目的翻译器（多半被其它程序占用）。请关闭占用该端口的程序，或删除 .qqbat/project.json 里的 translatorPort 后重新启动机器人` : `端口 ${port} 拒绝 WebSocket 握手（HTTP ${code}）`;
			logger.error(`[ts-runtime] 连接被拒绝: ${hint}`);
			this.wsOptions.onLog(`[ts-runtime] 连接被拒绝: ${hint}`);
			res.resume();
		});
	}
	scheduleReconnect() {
		if (this.stopped || this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.stopped) this.connect();
		}, this.reconnectDelayMs);
	}
};

export { BaseEventSource, WebSocketEventSource };
