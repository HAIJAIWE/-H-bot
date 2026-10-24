// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as events from "events";
import * as electron from "electron";
import * as path from "path";
import * as fs_promises from "fs/promises";
import { LarkTranslator } from "../lark/adapter";
import { DingTalkTranslator } from "../dingtalk/adapter";
import { parseRuntimeLogLine } from "../runner/runtimeLogParser";
import * as fs from "fs";
import { init_logger, logger } from "../infra/logger";
import { userDataPath } from "../infra/paths";
import { emitStatusChange } from "../runner/runtimeEvents";
import { snapshotBeforeRun } from "../flow/turnJournal";
import { loadProjectPlugins } from "../plugins/pluginLoader";
import { getTranslatorStatus, resolveUsableTranslatorPort, startTranslator } from "../runner/eventBus";
import { atomicWrite } from "../infra/fileOps";
import { startOfficial, stopOfficial } from "../official/ws";
import { FlowRuntime } from "../../runtime/FlowRuntime";
import { clearWaits } from "../../runtime/waitRegistry";

var BotManager = class extends events.EventEmitter {
	bots = /* @__PURE__ */ new Map();
	baseDir;
	/** 注册的 ProjectService 引用，用于启动时同步多平台 .env（避免循环依赖，使用 type import） */
	projectService;
	/** TS 运行时实例（每个项目一个） */
	runtimes = /* @__PURE__ */ new Map();
	/**
	* **平台翻译器**实例（按项目）。
	*
	* 为什么要单独记：它们**不是** QQ 那个共享的翻译器 ——
	* 每个都自己就是"运行时连的服务"，且持有平台长连接，stop 时必须显式关掉，
	* 否则长连接会一直挂着（**飞书 / 钉钉 / 企业微信都限制同一应用 50 条连接**）。
	*
	* 用一个 Map 装所有平台：加平台时不用再加一个字段、再改一次 stopBot
	* （原来只有飞书时这里叫 `larkTranslators`）。
	*/
	platformTranslators = /* @__PURE__ */ new Map();
	constructor(baseDir) {
		super();
		this.baseDir = baseDir ?? userDataPath("projects", electron.app) ?? (0, path.join)(process.cwd(), "projects");
		this.setMaxListeners(50);
	}
	/** 设置项目根目录（需在 scanProjectBots 前调用） */
	setBaseDir(dir) {
		this.baseDir = dir;
	}
	/** 注入 ProjectService 实例（main/index.ts 初始化时调用），用于启动时同步多平台 .env */
	setProjectService(service) {
		this.projectService = service;
	}
	/**
	* 把实例状态映射为运行时事件总线的 `BotState`。
	*
	* BotManager 的状态集合（starting/stopping/error）比 `BotState`
	* （stopped/running/crashed）更细，这里做一次收敛映射：
	* error → crashed，starting/stopping/stopped → stopped。
	* TS 运行时由 FlowRuntime 自行重连，不再有子进程崩溃计数，
	* 因此 crashCount 恒为 0、lastCrashTime 恒为 null。
	*/
	toBotState(instance) {
		const status = instance.status === "running" ? "running" : instance.status === "error" ? "crashed" : "stopped";
		const startedAtMs = instance.startedAt ? new Date(instance.startedAt).getTime() : 0;
		return {
			status,
			pid: instance.pid,
			startedAt: instance.startedAt,
			crashCount: 0,
			lastCrashTime: null,
			uptime: status === "running" && startedAtMs > 0 ? Math.floor((Date.now() - startedAtMs) / 1e3) : null
		};
	}
	/** 广播状态到运行时事件总线（渲染层状态订阅与指标自动启停依赖它） */
	broadcastStatus(instance) {
		emitStatusChange(instance.projectPath, this.toBotState(instance));
	}
	/** 从 project.json 加载元信息 */
	async loadProjectMeta(projectPath) {
		try {
			const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
			const raw = await (0, fs_promises.readFile)(configPath, "utf-8");
			const config = JSON.parse(raw);
			return {
				name: config.name ?? projectPath.split("\\").pop()?.split("/").pop() ?? "未知",
				qq: config.qq,
				adapter: config.adapter
			};
		} catch {
			return { name: projectPath.split("\\").pop()?.split("/").pop() ?? "未知" };
		}
	}
	toStatus(instance) {
		let uptime;
		if (instance.startedAt && (instance.status === "running" || instance.status === "starting")) uptime = Math.floor((Date.now() - new Date(instance.startedAt).getTime()) / 1e3);
		return {
			projectPath: instance.projectPath,
			name: instance.name,
			status: instance.status,
			qq: instance.qq,
			adapter: instance.adapter,
			error: instance.error ?? void 0,
			startedAt: instance.startedAt ?? void 0,
			uptime,
			pid: instance.pid ?? void 0
		};
	}
	/** 注册/添加一个 bot（如果已存在则忽略） */
	async registerBot(projectPath) {
		if (this.bots.has(projectPath)) return;
		const meta = await this.loadProjectMeta(projectPath);
		const instance = {
			projectPath,
			name: meta.name,
			status: "stopped",
			botSession: null,
			startedAt: null,
			error: null,
			pid: null,
			qq: meta.qq,
			adapter: meta.adapter
		};
		this.bots.set(projectPath, instance);
		this.emit("statusChanged", this.toStatus(instance));
	}
	/** 取消注册一个 bot（如正在运行则先停止） */
	unregisterBot(projectPath) {
		const instance = this.bots.get(projectPath);
		if (!instance) return;
		if (instance.status === "running" || instance.status === "starting") try {
			const runtime = this.runtimes.get(projectPath);
			if (runtime) {
				runtime.stop();
				this.runtimes.delete(projectPath);
			}
		} catch {}
		this.bots.delete(projectPath);
	}
	/** 启动指定 bot（一键启动：翻译器 + 官方适配器 + TS 运行时） */
	async startBot(projectPath) {
		const instance = this.bots.get(projectPath);
		if (!instance) throw new Error(`Bot 未注册: ${projectPath}`);
		if (instance.status === "running" || instance.status === "starting") throw new Error(`Bot 已在运行中: ${projectPath}`);
		/**
		* ★ **运行前快照玩家数据**（2026-10-15）。
		*
		* 运行会真的执行流程、可能写 `data/`；而数据**不在**「AI 写的文件」镜像里。
		* 没有这份快照，「撤回」就撤不回运行造成的数据变化 —— 用户的原话是
		* 「撤回本来就是撤回上一步的操作」。
		*
		* 放在拦截检查**之后**：被拒绝的启动不该留下快照（否则历史里堆垃圾）。
		* 失败**不阻断启动**（只是这次运行不可撤回），所以单独兜住、记 warn。
		*/
		try {
			await snapshotBeforeRun(projectPath, "运行机器人");
		} catch (e) {
			logger.warn("[botManager] 运行前快照数据失败（本次运行将无法撤回）:", e);
		}
		instance.status = "starting";
		instance.error = null;
		this.emit("statusChanged", this.toStatus(instance));
		try {
			await loadProjectPlugins(projectPath, { reload: true });
			const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
			let projectConfig = null;
			try {
				if (this.projectService) projectConfig = await this.projectService.loadProjectConfig(projectPath);
				else {
					const raw = await (0, fs_promises.readFile)(configPath, "utf-8");
					projectConfig = JSON.parse(raw);
					logger.warn("[botManager] 未注入 ProjectService，project.json 中的平台凭据可能仍是密文（无法解密）");
				}
			} catch (e) {
				logger.warn(`[botManager] project.json 读取失败，按默认端口段分配`, e);
			}
			let translatorPort = await resolveUsableTranslatorPort(projectConfig, projectPath);
			if (projectConfig && projectConfig.translatorPort !== translatorPort) {
				projectConfig.translatorPort = translatorPort;
				if (this.projectService) await this.projectService.saveProjectConfig(projectPath, projectConfig);
				else await atomicWrite(configPath, JSON.stringify(projectConfig, null, 2));
				logger.info(`[botManager] 已分配翻译器端口 ${translatorPort} 并写入 project.json`);
			}
			const adapterKind = String(projectConfig?.adapter ?? "official");
			if (adapterKind === "lark") {
				const larkCfg = projectConfig?.lark;
				if (!larkCfg?.appId || !larkCfg?.appSecret) throw new Error("飞书配置缺失：请在项目设置里填写 App ID 与 App Secret（.qqbat/project.json 的 lark 段）");
				logger.info("[botManager] 启动飞书长连接翻译器...");
				const larkTr = new LarkTranslator({
					appId: larkCfg.appId,
					appSecret: larkCfg.appSecret,
					domain: larkCfg.domain,
					port: 0,
					projectPath,
					onLog: (line) => this.emit("log", {
						projectPath,
						line
					})
				});
				await larkTr.start();
				this.platformTranslators.set(projectPath, larkTr);
				await this.attachRuntime(projectPath, instance, larkTr.port, "飞书");
				return;
			}
			if (adapterKind === "dingtalk") {
				const dingCfg = projectConfig?.dingtalk;
				if (!dingCfg?.clientId || !dingCfg?.clientSecret) throw new Error("钉钉配置缺失：请在项目设置里填写 AppKey 与 AppSecret（.qqbat/project.json 的 dingtalk 段）");
				logger.info("[botManager] 启动钉钉 Stream 翻译器...");
				const dingTr = new DingTalkTranslator({
					clientId: dingCfg.clientId,
					clientSecret: dingCfg.clientSecret,
					port: 0,
					projectPath,
					onLog: (line) => this.emit("log", {
						projectPath,
						line
					})
				});
				await dingTr.start();
				this.platformTranslators.set(projectPath, dingTr);
				await this.attachRuntime(projectPath, instance, dingTr.port, "钉钉");
				return;
			}
			if (!getTranslatorStatus(translatorPort).running) {
				logger.info(`[botManager] 启动翻译器 (端口 ${translatorPort})...`);
				translatorPort = await startTranslator(projectPath, translatorPort);
				logger.info(`[botManager] 翻译器已启动`);
			}
			const actualPort = getTranslatorStatus(void 0, projectPath).port;
			if (actualPort > 0 && actualPort !== translatorPort) {
				logger.warn(`[botManager] 翻译器实际端口为 ${actualPort}（请求 ${translatorPort}），运行时改用实际端口`);
				translatorPort = actualPort;
			}
			if (projectConfig && projectConfig.translatorPort !== translatorPort) {
				projectConfig.translatorPort = translatorPort;
				try {
					await this.projectService?.updateTranslatorPort(projectPath, translatorPort);
					logger.info(`[botManager] 已把实际端口 ${translatorPort} 回写到 project.json`);
				} catch (e) {
					logger.warn("[botManager] 端口回写失败（本次运行不受影响）:", e);
				}
			}
			try {
				logger.info(`[botManager] 启动官方适配器...`);
				await startOfficial(projectPath);
				logger.info(`[botManager] 官方适配器已启动`);
			} catch (e) {
				logger.warn(`[botManager] 官方适配器启动失败:`, e instanceof Error ? e.message : e);
			}
			logger.info(`[botManager] 启动 TS 运行时...`);
			const runtime = new FlowRuntime(projectPath, translatorPort);
			runtime.onStatusChange((info) => {
				const inst = this.bots.get(projectPath);
				if (!inst) return;
				if (info.status === "running") {
					inst.status = "running";
					inst.startedAt = inst.startedAt ?? (/* @__PURE__ */ new Date()).toISOString();
				} else if (info.status === "error") {
					inst.status = "error";
					inst.error = info.error ?? "运行时错误";
				} else if (info.status === "stopped") {
					inst.status = "stopped";
					inst.botSession = null;
					inst.pid = null;
					inst.startedAt = null;
				}
				this.emit("statusChanged", this.toStatus(inst));
				this.broadcastStatus(inst);
			});
			runtime.onLog((line) => {
				this.emit("log", {
					projectPath,
					line
				});
				parseRuntimeLogLine(projectPath, line);
			});
			this.runtimes.set(projectPath, runtime);
			await runtime.start();
			instance.botSession = `ts-runtime:${translatorPort}`;
			this.emit("statusChanged", this.toStatus(instance));
			logger.info(`[botManager] TS 运行时已启动 (session=${instance.botSession})`);
		} catch (e) {
			instance.status = "error";
			instance.error = e instanceof Error ? e.message : String(e);
			instance.startedAt = null;
			this.emit("statusChanged", this.toStatus(instance));
			throw e;
		}
	}
	/**
	* 把运行时（`FlowRuntime`）接到**平台翻译器**上，并接好状态/日志回调。
	*
	* ## 为什么抽出来
	*
	* 这段有 30 行，而且**与平台完全无关**：飞书、钉钉、以后的平台都一模一样。
	* 原来它内联在飞书分支里；加钉钉时如果再抄一遍，以后改状态回调就要改 N 处
	* （漏一处 = 某个平台的状态在界面上永远不更新，而且不报错）。
	*
	* @param port 翻译器**实际监听**的端口（它自己知道，不要用配置里的请求端口）
	* @param label 日志里显示的平台名（"飞书" / "钉钉"）
	*/
	async attachRuntime(projectPath, instance, port, label) {
		logger.info(`[botManager] ${label}翻译器已启动 (端口 ${port})`);
		const runtime = new FlowRuntime(projectPath, port);
		runtime.onStatusChange((info) => {
			const inst = this.bots.get(projectPath);
			if (!inst) return;
			if (info.status === "running") {
				inst.status = "running";
				inst.startedAt = inst.startedAt ?? (/* @__PURE__ */ new Date()).toISOString();
			} else if (info.status === "error") {
				inst.status = "error";
				inst.error = info.error ?? "运行时错误";
			} else if (info.status === "stopped") {
				inst.status = "stopped";
				inst.botSession = null;
				inst.pid = null;
				inst.startedAt = null;
			}
			this.emit("statusChanged", this.toStatus(inst));
			this.broadcastStatus(inst);
		});
		runtime.onLog((line) => {
			this.emit("log", {
				projectPath,
				line
			});
			parseRuntimeLogLine(projectPath, line);
		});
		this.runtimes.set(projectPath, runtime);
		await runtime.start();
		instance.botSession = "ts-runtime:" + port;
		this.emit("statusChanged", this.toStatus(instance));
		logger.info(`[botManager] ${label}运行时已启动 (session=${instance.botSession})`);
	}
	/** 停止指定 bot（一键停止：TS 运行时 + 官方适配器） */
	async stopBot(projectPath) {
		const instance = this.bots.get(projectPath);
		if (!instance) throw new Error(`Bot 未注册: ${projectPath}`);
		if (instance.status === "stopped" || instance.status === "stopping") return;
		instance.status = "stopping";
		this.emit("statusChanged", this.toStatus(instance));
		try {
			const runtime = this.runtimes.get(projectPath);
			if (runtime) {
				runtime.stop();
				this.runtimes.delete(projectPath);
			}
			try {
				await stopOfficial(projectPath);
				logger.info(`[botManager] 官方适配器已停止`);
			} catch (e) {
				logger.warn(`[botManager] 官方适配器停止失败:`, e instanceof Error ? e.message : e);
			}
			const platTr = this.platformTranslators.get(projectPath);
			if (platTr) {
				try {
					await platTr.stop();
					logger.info(`[botManager] 平台翻译器已停止`);
				} catch (e) {
					logger.warn(`[botManager] 平台翻译器停止失败:`, e instanceof Error ? e.message : e);
				}
				this.platformTranslators.delete(projectPath);
			}
			const clearedWaits = clearWaits(projectPath);
			if (clearedWaits > 0) logger.info(`[botManager] 已清空 ${clearedWaits} 条挂起等待（项目停止）`);
		} catch (e) {
			instance.status = "error";
			instance.error = e instanceof Error ? e.message : String(e);
			this.emit("statusChanged", this.toStatus(instance));
			throw e;
		}
	}
	/** 重启指定 bot */
	async restartBot(projectPath) {
		await this.stopBot(projectPath);
		await this.startBot(projectPath);
	}
	/** 获取单个 bot 状态 */
	getBotStatus(projectPath) {
		const instance = this.bots.get(projectPath);
		if (!instance) return null;
		return this.toStatus(instance);
	}
	/** 获取所有 bot 状态 */
	listBots() {
		return Array.from(this.bots.values()).map((instance) => this.toStatus(instance));
	}
	/**
	* 停止所有运行中的 bot（应用退出时调用）。
	*
	* 迁移说明：旧实现由 `botProcess.listRunningBots()` 枚举 Python 子进程后逐个 kill；
	* TS 运行时是主进程内的 WebSocket 客户端，不需要杀进程，只需停止连接与适配器。
	*/
	async stopAllBots() {
		const targets = Array.from(this.bots.values()).filter((instance) => instance.status === "running" || instance.status === "starting");
		for (const instance of targets) try {
			await this.stopBot(instance.projectPath);
		} catch (e) {
			logger.warn(`[botManager] 退出时停止 bot 失败: ${instance.projectPath}`, e);
		}
	}
	/** 扫描项目目录获取所有已注册 bot */
	async scanProjectBots() {
		const results = [];
		try {
			const entries = await (0, fs_promises.readdir)(this.baseDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const projectPath = (0, path.join)(this.baseDir, entry.name);
				const flowFile = (0, path.join)(projectPath, ".qqbat", "flow.json");
				if ((0, fs.existsSync)(flowFile)) results.push(projectPath);
			}
		} catch {}
		return results;
	}
};
var botManager = new BotManager();

export { BotManager, botManager };
