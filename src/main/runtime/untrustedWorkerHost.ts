// @ts-nocheck
// 由 10/18 打包产物还原（chunk: dynamicHandlers-BJxkF_cY.js）；见 _recovery/README-recovery.md
import * as node_path from "node:path";
import * as node_fs from "node:fs";
import * as node_child_process from "node:child_process";
import { init_logger, logger } from "../services/infra/logger";

/** 控制类请求（register/unregister/list/info）的超时：必须大于 worker 内的编译上限 */
var CONTROL_TIMEOUT_MS = 35e3;
/** 当前进程是否是 Electron（决定 fork 纯 Node 还是复用自身可执行文件） */
function isElectron() {
	return Boolean(process.versions.electron);
}
/**
* 本模块所在目录。
*
* 打包后是 CJS（__dirname 指向 out/main 或 out/main/chunks）。
* vitest 直跑源码时是 ESM、没有 __dirname —— 而 vitest 以仓库根为 cwd 启动，
* 源码位置可由 cwd 推出（这是**仅测试**的降级路径，生产永远走 __dirname）。
*
* 不用 import.meta.url：tsconfig 的 module=NodeNext 且包没有 type=module，
* 该文件按 CJS 编译，import.meta 会直接报 TS1470。
*/
function thisModuleDir() {
	if (typeof __dirname !== "undefined") return __dirname;
	return (0, node_path.join)(process.cwd(), "src", "main", "runtime");
}
/**
* asar 内的路径 → asar.unpacked 的真实路径。
*
* child_process.fork 不能执行 asar 归档里的文件；electron-builder.yml 已把
* out/main/untrustedWorker.js 与 out/main/chunks/** 解包，这里把路径改写到
* .unpacked 树，子进程才能读到真实文件（以及它 require 的同目录 chunks）。
*/
function toUnpackedPath(p) {
	const marker = "app.asar" + node_path.sep;
	const idx = p.indexOf(marker);
	if (idx < 0) return p;
	return p.slice(0, idx) + "app.asar.unpacked" + node_path.sep + p.slice(idx + marker.length);
}
/**
* 默认的 worker 入口路径。
*
* 三个候选覆盖两种形态：
*   · out/main/untrustedWorker.js           打包/构建后（宿主在 out/main 根）
*   · out/main/../untrustedWorker.js        打包后宿主被拆进 out/main/chunks
*   · src/main/runtime/untrustedWorker.ts   vitest/源码直跑（Node 26 原生剥类型）
*/
function defaultWorkerEntryPath() {
	const dir = thisModuleDir();
	const candidates = [
		(0, node_path.join)(dir, "untrustedWorker.js"),
		(0, node_path.join)(dir, "..", "untrustedWorker.js"),
		(0, node_path.join)(dir, "untrustedWorker.ts")
	];
	return toUnpackedPath(candidates.find((c) => (0, node_fs.existsSync)(c)) ?? candidates[0]);
}
/**
* 不可信节点 worker 的宿主。
*
* 一个实例对应一个常驻子进程；register 的源码会留在宿主，子进程崩溃重启后自动重放，
* 因此调用方不需要感知"重启"这件事。
*/
var UntrustedWorkerHost = class {
	entryPath;
	child = null;
	startPromise = null;
	/** 当前这一代子进程的"重放已注册 kind"任务；重启时置空 */
	replayPromise = null;
	stdoutBuf = "";
	seq = 0;
	pending = /* @__PURE__ */ new Map();
	/** kind → handler 源码：重启后按它重放注册 */
	sources = /* @__PURE__ */ new Map();
	childCallHandler = null;
	/**
	* 正在执行中的 invoke id 集合。
	*
	* ⚠️ 为什么要记（2026-10-02 逐行审查发现 S1）：子进程发来的 callBuiltin / callApi 请求里
	* 带着 `invokeId`，宿主靠它把这次能力调用路由回**对应的那次节点调用**（取那次的 bot/event）。
	* 而这个 id **完全由子进程提供**，此前不做任何校验 —— 内层沙箱一旦被逃逸，就可以在并发
	* 调用期间填上**别人的** invokeId，从而拿到另一个调用的 bot/event。
	* 有了这张表，只有"宿主确实正在跑"的 invocation 才可能被路由。
	*/
	activeInvokes = /* @__PURE__ */ new Set();
	constructor(opts = {}) {
		this.entryPath = opts.entryPath ?? defaultWorkerEntryPath();
		process.once("exit", () => {
			try {
				this.child?.kill("SIGKILL");
			} catch {}
		});
	}
	/** 入口绝对路径（诊断用） */
	get entry() {
		return this.entryPath;
	}
	/** 子进程是否在运行 */
	isRunning() {
		return this.child !== null && this.child.exitCode === null;
	}
	/** 注入 callBuiltin / bot.callApi 的实现（由 dynamicHandlers 接线） */
	setChildCallHandler(fn) {
		this.childCallHandler = fn;
	}
	/**
	* 为一次 invoke 分配全局唯一的 id。
	*
	* 这个 id 同时用于：宿主 → 子的请求关联、子进程里沙箱的 callId、
	* 以及宿主把 callBuiltin/callApi 路由回正确那次调用。三者必须同一个 id，
	* 否则并发调用会串上下文（WI-1 的 token+callId 路由解决的正是这个问题）。
	*/
	nextInvokeId() {
		return ++this.seq;
	}
	/** 惰性启动（幂等）。入口不存在或 fork 失败会 reject。 */
	start() {
		if (this.isRunning()) return Promise.resolve();
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.spawnWorker().finally(() => {
			this.startPromise = null;
		});
		return this.startPromise;
	}
	/** 注册（或覆盖）一个 kind 的源码；子进程编译失败会 reject */
	async register(kind, source) {
		await this.ensureSettled();
		await this.request("register", {
			kind,
			source
		}, CONTROL_TIMEOUT_MS, "worker 注册超时");
		this.sources.set(kind, source);
	}
	/** 注销单个 kind（尽力而为：失败不影响本地表） */
	unregister(kind) {
		this.sources.delete(kind);
		this.fireAndForget("unregister", { kind });
	}
	/** 按前缀注销（尽力而为） */
	unregisterPrefix(prefix) {
		for (const kind of [...this.sources.keys()]) if (kind.startsWith(prefix)) this.sources.delete(kind);
		this.fireAndForget("unregisterPrefix", { prefix });
	}
	/** 清空全部注册（测试 / 项目关闭时用） */
	clear() {
		this.sources.clear();
		this.fireAndForget("unregisterPrefix", { prefix: "" });
	}
	/**
	* 执行一次 handler 调用。
	*
	* @param kind 节点 kind
	* @param invokeId 由 nextInvokeId() 分配，必须已写进 payload.callId
	* @param payload 沙箱可执行的 JSON 安全负载
	* @param timeoutMs 主进程侧计时（子进程已经不可信，超时只能由主进程判定）
	*/
	async invoke(kind, invokeId, payload, timeoutMs) {
		if (!this.sources.has(kind)) throw new Error("动态节点未注册到 worker: " + kind);
		await this.ensureSettled();
		this.activeInvokes.add(invokeId);
		try {
			return await this.request("invoke", {
				kind,
				payload
			}, timeoutMs, "节点执行超时（" + timeoutMs + "ms）", invokeId);
		} finally {
			this.activeInvokes.delete(invokeId);
		}
	}
	/** worker 进程信息（诊断 / 测试：证明 handler 跑在另一个 PID 里） */
	async info() {
		await this.ensureSettled();
		return await this.request("info", {}, CONTROL_TIMEOUT_MS, "worker info 超时");
	}
	/** 让 worker 报告它当前真实注册的 kind（验证 RPC 注册/注销确实到达）。 */
	async listRemote() {
		await this.ensureSettled();
		return await this.request("list", {}, CONTROL_TIMEOUT_MS, "worker list 超时");
	}
	/**
	* worker 外层 realm 的逃逸自查（**测试/诊断专用**）。
	*
	* 在子进程外层用与 handler 逃逸向量完全相同的表达式求值，返回它拿到的 pid。
	* 用途：证明第一层边界的语义 —— 同样的表达式在主进程能拿到主进程，在这里只能
	* 拿到子进程。它不执行任何传入代码，也不暴露给沙箱里的 handler。
	*/
	async selfEscapeProbe() {
		await this.ensureSettled();
		return await this.request("selfProbe", {}, CONTROL_TIMEOUT_MS, "worker 自查超时");
	}
	/** 优雅停止：清空源码并杀掉子进程（测试收尾 / 应用退出） */
	stop() {
		this.sources.clear();
		this.terminate("stop()");
	}
	/** 确保进程已启动且"重放已注册 kind"完成（重放失败只记日志，不阻断新请求） */
	async ensureSettled() {
		await this.start();
		if (this.replayPromise) try {
			await this.replayPromise;
		} catch {}
	}
	spawnWorker() {
		return new Promise((resolve, reject) => {
			if (!(0, node_fs.existsSync)(this.entryPath)) {
				reject(/* @__PURE__ */ new Error("不可信节点 worker 入口不存在: " + this.entryPath));
				return;
			}
			const env = {};
			for (const key of [
				"PATH",
				"Path",
				"PATHEXT",
				"SystemRoot",
				"SystemDrive",
				"windir",
				"TEMP",
				"TMP",
				"HOME",
				"USERPROFILE",
				"LANG",
				"LC_ALL"
			]) {
				const value = process.env[key];
				if (value !== void 0) env[key] = value;
			}
			for (const [key, value] of Object.entries(process.env)) if (key.startsWith("QQBAT_WORKER_") && value !== void 0) env[key] = value;
			if (isElectron()) env.ELECTRON_RUN_AS_NODE = "1";
			let child;
			try {
				child = (0, node_child_process.fork)(this.entryPath, [], {
					silent: true,
					execArgv: [],
					env
				});
			} catch (e) {
				reject(e instanceof Error ? e : new Error(String(e)));
				return;
			}
			this.child = child;
			this.stdoutBuf = "";
			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk) => this.onStdout(chunk, child));
			child.stderr?.on("data", (chunk) => this.onStderr(chunk));
			child.unref();
			unrefStream(child.stdout);
			unrefStream(child.stderr);
			unrefStream(child.stdin);
			let settled = false;
			child.once("spawn", () => {
				if (settled) return;
				settled = true;
				if (this.child !== child) {
					try {
						child.kill("SIGKILL");
					} catch {}
					reject(/* @__PURE__ */ new Error("worker 在启动完成前已被终止"));
					return;
				}
				this.replayPromise = this.replayAll();
				resolve();
			});
			child.once("error", (e) => {
				logger.warn("[untrusted-worker] 子进程错误: " + e.message);
				if (!settled) {
					settled = true;
					reject(e);
				}
			});
			child.on("exit", (code, signal) => {
				if (this.child !== child) return;
				this.onExit(code, signal);
			});
		});
	}
	/** 把 sources 里所有 kind 重新注册进当前子进程（重启后调用） */
	async replayAll() {
		if (!this.isRunning()) return;
		for (const [kind, source] of [...this.sources]) {
			if (!this.isRunning()) return;
			try {
				await this.request("register", {
					kind,
					source
				}, CONTROL_TIMEOUT_MS, "worker 重放注册超时");
			} catch (e) {
				logger.warn("[untrusted-worker] 重启后重放 " + kind + " 失败: " + (e instanceof Error ? e.message : String(e)));
			}
		}
	}
	onExit(code, signal) {
		this.child = null;
		this.replayPromise = null;
		const err = /* @__PURE__ */ new Error("不可信节点 worker 已退出（code=" + String(code) + ", signal=" + String(signal) + "）");
		for (const p of this.pending.values()) {
			if (p.timer) clearTimeout(p.timer);
			p.reject(err);
		}
		this.pending.clear();
	}
	onStdout(chunk, origin) {
		this.stdoutBuf += chunk;
		if (this.stdoutBuf.length > MAX_PROTOCOL_BUFFER) {
			logger.error(`[untrusted-worker] 协议缓冲超过 ${MAX_PROTOCOL_BUFFER} 字节，判定为协议污染并丢弃`);
			this.stdoutBuf = "";
			return;
		}
		let idx;
		while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
			const line = this.stdoutBuf.slice(0, idx).trim();
			this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
			if (!line) continue;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				logger.warn("[untrusted-worker] 无法解析的协议行: " + line.slice(0, 200));
				continue;
			}
			if (!msg || typeof msg !== "object") {
				logger.warn("[untrusted-worker] 协议行不是对象，已忽略: " + line.slice(0, 200));
				continue;
			}
			this.onMessage(msg, origin);
		}
	}
	onStderr(chunk) {
		const text = String(chunk);
		if (!text.trim()) return;
		if (text.includes("MODULE_TYPELESS_PACKAGE_JSON")) return;
		for (const line of text.split("\n")) if (line.trim()) logger.warn("[untrusted-worker] " + line.trim());
	}
	onMessage(msg, origin) {
		const t = msg.t;
		if (t === "log") {
			this.emitLog(msg);
			return;
		}
		if (t === "callBuiltin" || t === "callApi") {
			this.handleChildCall(msg, origin);
			return;
		}
		if (t === "reply" || t === "result" || t === "error") {
			this.settle(msg);
			return;
		}
		logger.warn("[untrusted-worker] 未知消息类型: " + String(t));
	}
	/** 把子进程的 ctx.log / console.* 写回主进程 logger（附带 kind 标签） */
	emitLog(msg) {
		const kind = String(msg.kind ?? "unknown");
		const args = (Array.isArray(msg.args) ? msg.args : []).slice(0, 32);
		const label = "[node:" + kind + "]";
		if (msg.level === "error") logger.error(label, ...args);
		else if (msg.level === "warn") logger.warn(label, ...args);
		else logger.info(label, ...args);
	}
	/** 子进程请求宿主代跑 callBuiltin / bot.callApi */
	async handleChildCall(msg, origin) {
		const id = Number(msg.id);
		const invokeId = Number(msg.invokeId);
		const isApi = msg.t === "callApi";
		let ok = true;
		let value;
		let error;
		try {
			if (!this.childCallHandler) throw new Error("worker 请求宿主能力，但宿主未接线");
			if (!this.activeInvokes.has(invokeId)) throw new Error("worker 请求的 invokeId=" + invokeId + " 不在执行中（拒绝路由宿主能力）");
			value = await this.childCallHandler({
				invokeId,
				req: isApi ? "callApi" : "callBuiltin",
				name: String(isApi ? msg.api : msg.kind),
				args: (isApi ? msg.params : msg.kwargs) ?? {}
			});
		} catch (e) {
			ok = false;
			error = e instanceof Error ? e.message : String(e);
		}
		if (this.child !== origin) return;
		this.writeToChild({
			t: "reply",
			id,
			req: isApi ? "callApi" : "callBuiltin",
			ok,
			value: ok ? value : void 0,
			error
		});
	}
	/** 结算一条主 → 子的请求 */
	settle(msg) {
		const id = Number(msg.id);
		const p = this.pending.get(id);
		if (!p) return;
		this.pending.delete(id);
		if (p.timer) clearTimeout(p.timer);
		if (msg.t === "error" || msg.ok === false) p.reject(new Error(String(msg.message ?? msg.error ?? "worker 返回错误")));
		else p.resolve(msg.value);
	}
	/**
	* 发一条需要回复的请求。
	*
	* @param fixedId 指定 id（invoke 用：必须与 payload.callId 一致）；省略则自增
	*/
	request(t, payload, timeoutMs, timeoutMessage, fixedId) {
		const id = fixedId ?? ++this.seq;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(timeoutMessage));
				this.terminate("请求 " + t + " 超时");
			}, timeoutMs);
			this.pending.set(id, {
				resolve,
				reject,
				timer
			});
			if (!this.writeToChild({
				t,
				id,
				...payload
			})) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(/* @__PURE__ */ new Error("不可信节点 worker 不可用（写入失败）"));
			}
		});
	}
	/** 不等回复的命令（unregister 等） */
	fireAndForget(t, payload) {
		if (!this.isRunning()) return;
		this.writeToChild({
			t,
			id: ++this.seq,
			...payload
		});
	}
	writeToChild(msg) {
		const child = this.child;
		if (!child || !child.stdin || child.stdin.destroyed) return false;
		let line;
		try {
			line = JSON.stringify(msg);
		} catch {
			line = JSON.stringify(stripUnserializable(msg));
		}
		try {
			child.stdin.write(line + "\n");
			return true;
		} catch (e) {
			logger.warn("[untrusted-worker] 写入子进程失败: " + (e instanceof Error ? e.message : String(e)));
			return false;
		}
	}
	/**
	* 杀掉子进程（崩溃隔离的一部分：主进程始终掌握生杀权）。
	*
	* 先把 this.child 置空、并立即 reject 全部未决请求，**再**发 kill：
	*   · 置空之后 isRunning() 立刻为 false，下一次请求会 fork 新进程；
	*   · 旧进程的 exit 事件被上面的守卫忽略，不会误伤新进程的请求。
	* 如果反过来（先 kill 等 exit），在新进程已经起来的窗口里旧 exit 会 reject 新请求 ——
	* 实测过：超时杀进程后，紧接着的那次调用会莫名收到"worker 已退出"。
	*/
	terminate(reason) {
		const child = this.child;
		if (!child) return;
		this.child = null;
		this.replayPromise = null;
		logger.warn("[untrusted-worker] 终止子进程: " + reason);
		const err = /* @__PURE__ */ new Error("不可信节点 worker 已被终止: " + reason);
		for (const p of this.pending.values()) {
			if (p.timer) clearTimeout(p.timer);
			p.reject(err);
		}
		this.pending.clear();
		try {
			child.kill("SIGKILL");
		} catch {
			try {
				child.kill();
			} catch {}
		}
	}
};
/** 尽力把一个流从事件循环引用里摘掉（Readable/Writable 类型未暴露 unref） */
function unrefStream(s) {
	if (!s || typeof s !== "object") return;
	const unref = s.unref;
	if (typeof unref === "function") unref.call(s);
}
/** 兜底的 JSON 安全化：函数/undefined 丢弃，BigInt 转字符串，循环引用转 null */
function stripUnserializable(v) {
	const seen = /* @__PURE__ */ new WeakSet();
	return JSON.parse(JSON.stringify(v, (_key, val) => {
		if (typeof val === "function" || val === void 0) return void 0;
		if (typeof val === "bigint") return String(val);
		if (val && typeof val === "object") {
			if (seen.has(val)) return null;
			seen.add(val);
		}
		return val;
	}) ?? "null");
}
/** 协议缓冲上限：正常协议行远小于它；超过即视为协议污染（见 onStdout） */
var MAX_PROTOCOL_BUFFER = 1048576;
var singleton = null;
/** 进程级单例：dynamicHandlers 与测试共用同一个 worker */
function getUntrustedWorkerHost() {
	if (!singleton) singleton = new UntrustedWorkerHost();
	return singleton;
}
/**
* 应用退出时调用：只停**已经存在**的 worker，不为了停它而先造一个。
*
* ## 为什么必须显式停（2026-10-02 审查发现）
*
* worker 用 `child.unref()` + 流 `unref()` 把自己从父进程的事件循环里摘出去了 ——
* 好处是它不阻止退出，**代价是退出时也不会被自动回收**：
* Electron/Node 都不会替父进程杀死 forked 子进程，于是它就变成一个孤儿 Node 进程
* （持有内存与已注册的节点源码）。
*
* 这与 `services/runner/terminal.ts` 记录过的是**同一类问题**（那里的注释写着"Electron 默认不会在
* 退出时杀死 spawn 的子进程，cmd.exe/bash 会残留为孤儿进程"），所以处理方式也照抄它：
* 在 `before-quit` 里显式停。
*/
function stopUntrustedWorkerIfRunning() {
	singleton?.stop();
}

export { CONTROL_TIMEOUT_MS, isElectron, thisModuleDir, toUnpackedPath, defaultWorkerEntryPath, UntrustedWorkerHost, unrefStream, stripUnserializable, MAX_PROTOCOL_BUFFER, singleton, getUntrustedWorkerHost, stopUntrustedWorkerIfRunning };
