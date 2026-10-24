// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { dataService_exports, init_dataService } from "./dataService";
import * as path from "path";
import { activeProjectRegistry } from "./activeProject";
import * as fs from "fs";
import * as crypto from "crypto";
import * as fs_promises from "fs/promises";
import { migrateBotType, translatorPortForBlock } from "../../../shared/config/ports";
import { normalizeFlow } from "../../../shared/nodes/flowNormalize";
import { atomicWrite } from "../infra/fileOps";
import { noteFlowDiskRevisionFromDisk } from "../flow/flowDiskRevision";
import { decryptConfigSecret, encryptConfigSecret } from "./configSecrets";
import { isEncryptionAvailable } from "../infra/safeStorage";
import { init_logger, logger } from "../infra/logger";
import { closeDbUnder } from "../builtinNodes/persistentStore";
import { __toCommonJS } from "../../../shared/runtime/rolldownShim";
import { assertWithinProject } from "../infra/pathGuard";

/**
* 删除项目目录**之前**，先释放占着这个项目的 SQLite 连接。
*
* ## 为什么需要（2026-09-26 实测出来的真缺陷）
*
* 存档库（`persistentStore`）与数据服务（`dataService`）的连接池都是
* **按库文件路径缓存**的进程级连接。项目只要跑过一次流程，
* `{项目}/data/players/persistent.db` 就被打开并一直缓存着 —— Windows 上带着
* 打开的句柄 `rm` 目录会抛 `EBUSY: resource busy or locked`，
* 表现就是「点了删除项目，目录还在」。
*
* 两个 `close*Under` 都按路径判断归属，所以同时跑多个 bot 时只关被删项目那几条。
*
* ## dataService 那一半为什么走 `require`
*
* `dataService` 是**顶层** `import Database from 'better-sqlite3'`，静态引用它会让
* 本模块在加载时就依赖原生模块。删除项目不该有那个前提 —— 所以那一半是尽力而为，
* 拿不到就跳过（真正的错误交给后面的 `rm` 报）。
*/
function releaseProjectDbConnections(projectDir) {
	closeDbUnder(projectDir);
	try {
		(init_dataService(), __toCommonJS(dataService_exports)).closeConnectionsUnder(projectDir);
	} catch {}
}
var APP_DATA_DIR = "qqbat";
/** 最近项目列表最大保留数量 */
var MAX_RECENT_PROJECTS = 20;
function appDataRoot(baseDir) {
	return (0, path.join)(baseDir, APP_DATA_DIR);
}
var ProjectService = class {
	baseDir;
	constructor(baseDir) {
		this.baseDir = baseDir;
	}
	/** 暴露 baseDir 供其他服务做路径校验 */
	getBaseDir() {
		return this.baseDir;
	}
	get appData() {
		return appDataRoot(this.baseDir);
	}
	async createProject(config) {
		const projectPath = (0, path.join)(this.baseDir, config.name);
		const existing = await this._tryLoadExistingProject(projectPath, config.name);
		if (existing) {
			activeProjectRegistry.noteViewed(existing.path);
			return existing;
		}
		await this._createProjectDirectories(projectPath);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const portBlock = await this.findNextPortBlock();
		const fullConfig = this._buildFullConfig(config, portBlock, now);
		await this.saveProjectConfig(projectPath, fullConfig);
		const flow = await this._resolveInitialFlow(config);
		await this._writeFlowJson(projectPath, config, flow, now);
		await this._writeAdapterFiles(projectPath, fullConfig);
		activeProjectRegistry.noteViewed(projectPath);
		return this._buildProjectMeta(config, projectPath, now);
	}
	/** 已存在项目：尝试加载并返回 ProjectMeta；不存在返回 null；存在但无配置文件抛错 */
	async _tryLoadExistingProject(projectPath, projectName) {
		if (!(0, fs.existsSync)(projectPath)) return null;
		const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
		if (!(0, fs.existsSync)(configPath)) throw new Error(`项目已存在：${projectPath}`);
		const existing = await this.loadProjectConfig(projectPath);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return {
			id: (0, crypto.randomUUID)(),
			name: projectName,
			path: projectPath,
			qq: existing.qq,
			adapter: existing.adapter,
			botType: existing.botType,
			createdAt: existing.createdAt ?? now,
			updatedAt: now
		};
	}
	/** 创建项目标准目录结构（.qqbat / data / src/plugins） */
	async _createProjectDirectories(projectPath) {
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, ".qqbat", "history"), { recursive: true });
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "data", "players"), { recursive: true });
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "data", "config"), { recursive: true });
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "data", "config", ".schema"), { recursive: true });
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "data", "logs"), { recursive: true });
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "data", "backups"), { recursive: true });
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "src", "plugins", "generated"), { recursive: true });
	}
	/** 构建完整配置：合并时间戳与端口块，按适配器分配 translatorPort */
	_buildFullConfig(config, portBlock, now) {
		const fullConfig = {
			...config,
			createdAt: now,
			updatedAt: now
		};
		fullConfig.portBlock = portBlock;
		fullConfig.projectSchemaVersion = 1;
		fullConfig.translatorPort = translatorPortForBlock(portBlock);
		return fullConfig;
	}
	/**
	* 解析初始 flow：**没有模板库了**（模板皆为 AI 生成的占位内容，已整体移除）。
	*
	* 新项目从空白画布开始：用户在调色板里自己搭。保留本方法是为了让调用方结构不变，
	* 同时明确记录"这里不再有任何模板来源"。
	*/
	_resolveInitialFlow(_config) {
		return {
			flowNodes: [],
			flowEdges: []
		};
	}
	/**
	* 迁移旧 botType 值为新值（functional/game）
	* 检测到旧值时自动映射并回写 project.json
	*
	* ⚠️ 迁移表**只在 `shared/domain/project/botTypeConfig.ts` 定义一份**：
	* 这里以前又抄了一份（同一个映射两个真相，改一处漏一处）。
	*/
	async _migrateBotType(projectPath, config) {
		if (!config.botType) return config;
		const migrated = migrateBotType(config.botType);
		if (migrated.botType === config.botType) return config;
		config.botType = migrated.botType;
		await this.saveProjectConfig(projectPath, config);
		return config;
	}
	/** 写入 flow.json（空白 schema + 初始 nodes/edges，写入前经统一真相层补全端口） */
	async _writeFlowJson(projectPath, config, flow, now) {
		const { graph: normalized, changes } = normalizeFlow({
			schemaVersion: "1.1",
			systems: [],
			nodes: flow.flowNodes,
			edges: flow.flowEdges,
			variables: [],
			metadata: {
				name: config.name,
				version: "1.0",
				runtime: "typescript",
				createdAt: now,
				updatedAt: now
			}
		});
		if (changes.length > 0) logger.info(`[project] 新建项目：已为 ${changes.length} 个模板节点补全端口定义`);
		const flowPath = (0, path.join)(projectPath, ".qqbat", "flow.json");
		await atomicWrite(flowPath, JSON.stringify(normalized, null, 2));
		await noteFlowDiskRevisionFromDisk(projectPath, flowPath);
	}
	/** 生成 .env（ADR-003：仅官方 API，不再生成 bot.py） */
	async _writeAdapterFiles(projectPath, fullConfig) {
		await this._writeOfficialAdapterFiles(projectPath, fullConfig);
	}
	/** 写入 .env（运行时/部署用），不再生成 bot.py */
	async _writeOfficialAdapterFiles(projectPath, fullConfig) {
		fullConfig.translatorPort;
		const envContent = [
			"ENVIRONMENT=prod",
			"",
			"# 日志级别：debug | info | warn | error",
			"LOG_LEVEL=info",
			"",
			"# QQ 官方机器人凭证（也可在应用内配置，经 safeStorage 加密存于 .qqbat/project.json）",
			"QQ_APP_ID=",
			"QQ_APP_SECRET=",
			"QQ_SANDBOX=false",
			"",
			"# 机器人主人（QQ 号，逗号分隔）。**不填 = 没有超级管理员**：",
			"# 凡是「只有超管能做」的判断（私聊自动回复、管理类节点等）都会失效。",
			"SUPER_ADMIN_IDS=",
			"",
			"# ──────────────── 以下仅供「无头 / 容器部署」───────────────",
			"# 应用内跑机器人时**不读这两行**：内部总线端口按项目的 portBlock 自动分配",
			"# （见 .qqbat/project.json 的 translatorPort），留空 / 注释都不影响运行。",
			"# 只有当你在应用外跑运行时（如 Docker 导出）才需要填。",
			"# QQBOT_BUS_HOST=127.0.0.1",
			"# QQBOT_BUS_PORT=1003",
			""
		].join("\n");
		await (0, fs_promises.writeFile)((0, path.join)(projectPath, ".env"), envContent, "utf-8");
	}
	/** 构建 createProject 返回的 ProjectMeta */
	_buildProjectMeta(config, projectPath, now) {
		return {
			id: (0, crypto.randomUUID)(),
			name: config.name,
			path: projectPath,
			qq: config.qq,
			adapter: config.adapter,
			botType: config.botType,
			createdAt: now,
			updatedAt: now
		};
	}
	/** 查找下一个空闲端口块编号 */
	async findNextPortBlock() {
		let maxBlock = 0;
		try {
			const entries = await (0, fs_promises.readdir)(this.baseDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				try {
					const configPath = (0, path.join)(this.baseDir, entry.name, ".qqbat", "project.json");
					const raw = JSON.parse(await (0, fs_promises.readFile)(configPath, "utf-8"));
					if (raw.portBlock && typeof raw.portBlock === "number") maxBlock = Math.max(maxBlock, raw.portBlock);
				} catch {}
			}
		} catch {}
		return maxBlock + 1;
	}
	async saveProjectConfig(projectPath, config) {
		assertWithinProject(this.baseDir, projectPath);
		const filePath = (0, path.join)(projectPath, ".qqbat", "project.json");
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, ".qqbat"), { recursive: true });
		const persisted = encryptConfigSecret(config);
		await atomicWrite(filePath, JSON.stringify(persisted, null, 2));
	}
	/**
	* 更新翻译器端口 —— **端口落盘的唯一写点**。
	*
	* 2026-10-18 隔离审计 RT-04：此前有 5 个地方各自回写 project.json，其中
	* `ipc/runtime.ts` 与 `ipc/official.ts` 走的是裸 `atomicWrite`（绕过本服务）。
	* 裸写本身不泄漏密钥（它只做 JSON 往返、不解密），但它**绕过了 schema 归一与
	* 未来的迁移钩子**，且同一个字段有 5 套不一致的判定条件（有的比 translatorPort、
	* 有的比 block）。收敛到这里之后，调用方只传端口。
	*
	* 端口一致时**不写盘**，避免每次启动都动一次 project.json（触发 git 脏、备份噪声）。
	*/
	async updateTranslatorPort(projectPath, port) {
		assertWithinProject(this.baseDir, projectPath);
		const config = await this.loadProjectConfig(projectPath);
		if (config.translatorPort === port) return;
		config.translatorPort = port;
		await this.saveProjectConfig(projectPath, config);
	}
	async loadProjectConfig(projectPath) {
		const filePath = (0, path.join)(projectPath, ".qqbat", "project.json");
		const raw = await (0, fs_promises.readFile)(filePath, "utf-8");
		const decrypted = decryptConfigSecret(JSON.parse(raw));
		return await this._migrateBotType(projectPath, decrypted);
	}
	/**
	* 迁移历史明文凭证到加密形式。
	* 在应用启动时遍历所有项目，将未加密的敏感字段一次性加密。
	* 幂等：已加密的会被跳过。
	*/
	async migratePlaintextSecrets() {
		const migrated = [];
		const failed = [];
		if (!isEncryptionAvailable()) {
			logger.warn("[project] 系统不支持 safeStorage，跳过凭证迁移");
			return {
				migrated,
				failed
			};
		}
		let entries = [];
		try {
			entries = await (0, fs_promises.readdir)(this.baseDir);
		} catch {
			return {
				migrated,
				failed
			};
		}
		for (const name of entries) {
			const projectPath = (0, path.join)(this.baseDir, name);
			const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
			if (!(0, fs.existsSync)(configPath)) continue;
			try {
				const raw = await (0, fs_promises.readFile)(configPath, "utf-8");
				const parsed = JSON.parse(raw);
				const officialDone = parsed.official?._encrypted || !parsed.official?.appSecret;
				const aiDone = parsed.ai?._encrypted || !parsed.ai?.apiKey;
				const larkDone = parsed.lark?._encrypted || !parsed.lark?.appSecret;
				const dingtalkDone = parsed.dingtalk?._encrypted || !parsed.dingtalk?.clientSecret;
				if (officialDone && aiDone && larkDone && dingtalkDone) continue;
				await this.saveProjectConfig(projectPath, parsed);
				migrated.push(parsed.name);
				logger.info(`[project] 已迁移明文凭证: ${parsed.name}`);
			} catch (e) {
				failed.push(name);
				logger.error(`[project] 迁移凭证失败: ${projectPath}`, e);
			}
		}
		return {
			migrated,
			failed
		};
	}
	async getProjectMeta(projectPath) {
		try {
			const config = await this.loadProjectConfig(projectPath);
			/**
			* ⚠️ 「当前项目」的登记**已挪到 `ipc/project.ts` 的 `project:getMeta` handler**
			* （2026-10-15 P0 数据丢失事故的收尾）。
			*
			* 为什么不放在这里：`getProjectMeta` 同时暴露给 **AI 能力目录**（`project.getMeta`）——
			* 模型调一次就会把「当前项目」这个镜像挪到它随便指定的路径上，下一次正常的隐式保存
			* 就会被闸门拒掉（不丢数据，但会无故报错）。登记是**渲染层切项目的信号**，
			* 只有 IPC 那一层知道，不该由服务层代劳。
			*/
			return {
				id: (0, crypto.randomUUID)(),
				name: config.name,
				path: projectPath,
				qq: config.qq,
				adapter: config.adapter ?? "official",
				botType: config.botType,
				createdAt: config.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
				updatedAt: config.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
			};
		} catch {
			return null;
		}
	}
	async recordRecentProject(meta) {
		await (0, fs_promises.mkdir)(this.appData, { recursive: true });
		const filtered = (await this.listRecentProjects()).filter((r) => r.path !== meta.path);
		const entry = {
			id: meta.id,
			name: meta.name,
			path: meta.path,
			lastOpenedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		filtered.unshift(entry);
		const trimmed = filtered.slice(0, MAX_RECENT_PROJECTS);
		await atomicWrite((0, path.join)(this.appData, "recent.json"), JSON.stringify(trimmed, null, 2));
	}
	/**
	* 最近项目列表（主页面卡片的数据源）。
	*
	* 除了读 recent.json，还会**扫一遍工作区**把真实存在的项目补回来：
	* 项目目录被改名/迁移、recent.json 丢失或清空后，主页面不该变成空白
	* （2026-10-24 真机踩到：仓库改名后 recent.json 里全是死路径，剪完就剩空列表，
	* 用户看到的是"项目没了"）。扫描只认 <目录>/.qqbat/project.json，一层深。
	*/
	async listRecentProjects() {
		const file = (0, path.join)(this.appData, "recent.json");
		let entries = [];
		if ((0, fs.existsSync)(file)) {
			try {
				const raw = await (0, fs_promises.readFile)(file, "utf-8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) entries = parsed;
			} catch {
				entries = [];
			}
		}
		// 项目目录被改名/移动/删除后 recent.json 会残留死路径：列表照旧返回，点开才报错
		// （"路径越界""ENOENT project.json"）。读的时候按 .qqbat/project.json 过滤并写回，
		// 免得死条目一直占着最近的 MAX_RECENT_PROJECTS 个位置。
		// 外部盘暂时不可用也会被剪掉 —— 项目就在工作区里的话下面会补回来。
		const alive = entries.filter((r) => typeof r?.path === "string" && (0, fs.existsSync)((0, path.join)(r.path, ".qqbat", "project.json")));
		const known = new Set(alive.map((r) => (0, path.resolve)(r.path)));
		const discovered = [];
		try {
			const dirs = await (0, fs_promises.readdir)(this.baseDir, { withFileTypes: true });
			for (const d of dirs) {
				if (!d.isDirectory() || d.name === (0, path.basename)(this.appData)) continue;
				const dirPath = (0, path.join)(this.baseDir, d.name);
				if (known.has((0, path.resolve)(dirPath))) continue;
				const configPath = (0, path.join)(dirPath, ".qqbat", "project.json");
				if (!(0, fs.existsSync)(configPath)) continue;
				let cfg = null;
				try {
					cfg = JSON.parse(await (0, fs_promises.readFile)(configPath, "utf-8"));
				} catch {
					cfg = null;
				}
				if (!cfg || typeof cfg !== "object") continue;
				let openedAt = (/* @__PURE__ */ new Date()).toISOString();
				try {
					openedAt = (await (0, fs_promises.stat)(configPath)).mtime.toISOString();
				} catch {
					// 时间读不到就按现在算：卡片排序不精确，但项目能出现
				}
				discovered.push({
					id: typeof cfg.id === "string" ? cfg.id : `project-${(0, path.basename)(dirPath)}`,
					name: typeof cfg.name === "string" && cfg.name ? cfg.name : d.name,
					path: dirPath,
					lastOpenedAt: openedAt
				});
				known.add((0, path.resolve)(dirPath));
			}
		} catch (e) {
			logger.warn(`[project] 扫描工作区项目失败（不影响 recent.json 的读取）: ${e instanceof Error ? e.message : String(e)}`);
		}
		discovered.sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)));
		const merged = alive.concat(discovered).slice(0, MAX_RECENT_PROJECTS);
		if (merged.length !== entries.length || discovered.length > 0) {
			if (alive.length !== entries.length) logger.warn(`[project] 最近项目列表剪掉 ${entries.length - alive.length} 个已不存在的路径`);
			try {
				await atomicWrite(file, JSON.stringify(merged, null, 2));
			} catch (e) {
				logger.warn(`[project] 回写 recent.json 失败（下次读取仍会再算一遍）: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		return merged;
	}
	async removeRecentProject(path$6) {
		await (0, fs_promises.mkdir)(this.appData, { recursive: true });
		const filtered = (await this.listRecentProjects()).filter((r) => r.path !== path$6);
		await atomicWrite((0, path.join)(this.appData, "recent.json"), JSON.stringify(filtered, null, 2));
	}
	/**
	* 重命名项目。
	*
	* ## 为什么必须**同时**改两个地方的 name
	*
	* 项目名在盘上有两份：
	*   · `.qqbat/project.json` 的 `name` —— 项目选择器/机器人面板读它；
	*   · `.qqbat/flow.json` 的 `metadata.name` —— 流程图自己带的名字，**渲染层每次保存都会把它写回**。
	*
	* 这里原来只改前者。后果（2026-09-21 实测确认）：改名后两处不一致
	* （`project.json` = "RPG测试项目"、`flow.json` = "20指令测试"），
	* 而渲染层保存时用的是**内存里那份旧 metadata** —— 于是下一次自动保存就把
	* 用户看到的名字改回去了，表现就是"**改名没生效/存不住**"。
	*
	* 所以这里两处一起写：先改 project.json，再把新名字同步进 flow.json 的 metadata
	* （flow.json 不存在或损坏时跳过 —— 那是"还没有流程图"，不该拦住改名）。
	*/
	async renameProject(projectPath, newName) {
		assertWithinProject(this.baseDir, projectPath);
		const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
		const config = JSON.parse(await (0, fs_promises.readFile)(configPath, "utf-8"));
		config.name = newName;
		await atomicWrite(configPath, JSON.stringify(config, null, 2));
		const flowPath = (0, path.join)(projectPath, ".qqbat", "flow.json");
		if ((0, fs.existsSync)(flowPath)) try {
			const graph = JSON.parse(await (0, fs_promises.readFile)(flowPath, "utf-8"));
			if (graph && typeof graph === "object") {
				graph.metadata = {
					...graph.metadata ?? {},
					name: newName
				};
				await atomicWrite(flowPath, JSON.stringify(graph, null, 2));
				await noteFlowDiskRevisionFromDisk(projectPath, flowPath);
			}
		} catch (e) {
			logger.warn(`[project] 重命名时未能同步 flow.json 的 metadata.name: ${e instanceof Error ? e.message : String(e)}`);
		}
		const recent = await this.listRecentProjects();
		const entry = recent.find((r) => r.path === projectPath);
		if (entry) {
			entry.name = newName;
			await atomicWrite((0, path.join)(this.appData, "recent.json"), JSON.stringify(recent, null, 2));
		}
	}
	/** 删除整个项目文件夹 */
	async deleteProject(projectPath) {
		assertWithinProject(this.baseDir, projectPath);
		const normalized = (0, path.resolve)(projectPath);
		if (normalized === (0, path.resolve)(this.baseDir)) throw new Error("不能删除项目根目录本身");
		releaseProjectDbConnections(normalized);
		await (0, fs_promises.rm)(normalized, {
			recursive: true,
			force: true
		});
		await this.removeRecentProject(projectPath);
		activeProjectRegistry.clearIfMatches(projectPath);
	}
	/** 移动项目在 recent 列表中的位置（offset: -1 上移, 1 下移） */
	async moveProject(projectPath, offset) {
		const recent = await this.listRecentProjects();
		const idx = recent.findIndex((r) => r.path === projectPath);
		if (idx === -1) return;
		const target = idx + offset;
		if (target < 0 || target >= recent.length) return;
		[recent[idx], recent[target]] = [recent[target], recent[idx]];
		await atomicWrite((0, path.join)(this.appData, "recent.json"), JSON.stringify(recent, null, 2));
	}
	/** 克隆项目（复制整个文件夹，更新名称） */
	async cloneProject(projectPath, newName) {
		assertWithinProject(this.baseDir, projectPath);
		const newPath = (0, path.join)(this.baseDir, newName);
		if ((0, fs.existsSync)(newPath)) throw new Error(`项目「${newName}」已存在`);
		await (0, fs_promises.cp)(projectPath, newPath, { recursive: true });
		const configPath = (0, path.join)(newPath, ".qqbat", "project.json");
		const config = JSON.parse(await (0, fs_promises.readFile)(configPath, "utf-8"));
		config.name = newName;
		await atomicWrite(configPath, JSON.stringify(config, null, 2));
		const meta = {
			id: "",
			name: newName,
			path: newPath,
			qq: config.qq ?? "",
			adapter: config.adapter ?? "official",
			createdAt: config.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		await this.recordRecentProject(meta);
		activeProjectRegistry.noteViewed(meta.path);
		return meta;
	}
};

export { releaseProjectDbConnections, APP_DATA_DIR, MAX_RECENT_PROJECTS, appDataRoot, ProjectService };