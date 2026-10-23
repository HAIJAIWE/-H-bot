// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import * as vm from "vm";
import { validatePluginCode } from "./pluginTriggerContract";
import { detectPluginKind } from "../../../shared/plugins/kind";
import { listPluginDirEntries } from "./pluginDirContract";
import { logger } from "../infra/logger";
import { createHardenedContext, runScriptInSandbox } from "../../runtime/sandbox";
import { validateHandlerSource } from "../../runtime/dynamicHandlers";

/** 插件入口脚本的执行超时（毫秒） */
var SCRIPT_TIMEOUT_MS = 5e3;
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
/**
* 扫描结果：继承自 Array<PluginInfo>，向后兼容直接作为数组使用的代码，
* 同时暴露 errors 字段供调用方获取加载失败信息。
*/
var ScanResult = class ScanResult extends Array {
	/** 加载失败的错误列表 */
	errors = [];
	/** 成功加载的插件列表（等于数组本身） */
	get plugins() {
		return this;
	}
	/** 工厂方法：从插件列表和错误列表构造 ScanResult */
	static create(plugins, errors) {
		const result = new ScanResult();
		for (const p of plugins) result.push(p);
		result.errors = errors;
		return result;
	}
};
/** 验证 manifest 格式，返回验证错误信息（空表示通过） */
function validateManifest(manifest) {
	const errors = [];
	if (!manifest || typeof manifest !== "object") {
		errors.push("manifest 必须是 JSON 对象");
		return errors;
	}
	const m = manifest;
	if (typeof m.name !== "string" || !m.name) errors.push("manifest.name 必填且为字符串");
	if (typeof m.version !== "string" || !m.version) errors.push("manifest.version 必填且为字符串");
	if (typeof m.entry !== "string" || !m.entry) errors.push("manifest.entry 必填且为字符串");
	if (m.description !== void 0 && typeof m.description !== "string") errors.push("manifest.description 必须为字符串");
	if (m.permissions !== void 0) {
		if (!Array.isArray(m.permissions)) errors.push("manifest.permissions 必须为数组");
		else if (!m.permissions.every((p) => typeof p === "string")) errors.push("manifest.permissions 元素必须为字符串");
	}
	return errors;
}
/**
* 扫描 {projectPath}/plugins/ 目录（插件管理面板用）
*
* 准入走**唯一判据** `listPluginDirEntries`（目录 + manifest.json，不看目录名）——
* 与画布扫描、运行时装载同一份，避免三处对同一个目录得出不同结论（P0-9 的根因）。
* 返回 ScanResult（可作为数组直接使用，也可通过 .errors 获取加载失败信息）
*/
async function scanPlugins(projectPath) {
	const entries = await listPluginDirEntries(projectPath);
	const plugins = [];
	const errors = [];
	for (const entry of entries) {
		const pluginDir = entry.dir;
		const manifestPath = (0, path.join)(pluginDir, "manifest.json");
		if (!(0, fs.existsSync)(manifestPath)) continue;
		try {
			const raw = await (0, fs_promises.readFile)(manifestPath, "utf-8");
			const manifest = JSON.parse(raw);
			const manifestErrors = validateManifest(manifest);
			if (manifestErrors.length > 0) {
				const msg = `manifest 验证失败: ${manifestErrors.join("; ")}`;
				logger.warn(`[pluginScanner] ${entry.name}: ${msg}`);
				errors.push({
					type: "manifest_invalid",
					message: msg,
					pluginName: entry.name,
					filePath: manifestPath
				});
				continue;
			}
			const entryPath = (0, path.join)(pluginDir, manifest.entry);
			const loaded = (0, fs.existsSync)(entryPath);
			plugins.push({
				name: manifest.name,
				version: manifest.version,
				author: manifest.permissions?.includes("author") ? void 0 : void 0,
				description: manifest.description,
				nodeCount: 0,
				enabled: true,
				loaded,
				path: pluginDir
			});
		} catch (e) {
			const msg = `读取 manifest 失败: ${errorMessage(e)}`;
			logger.warn(`[pluginScanner] ${entry.name}: ${msg}`);
			errors.push({
				type: "manifest_invalid",
				message: msg,
				pluginName: entry.name,
				filePath: manifestPath
			});
		}
	}
	return ScanResult.create(plugins, errors);
}
/**
* 扫描并加载指定插件包，返回 PackageLoadResult
* 包含加载成功的 package（失败时为 null）和加载过程中收集的 errors
*/
async function loadPluginPackage(pluginDir) {
	const manifestPath = (0, path.join)(pluginDir, "manifest.json");
	if (!(0, fs.existsSync)(manifestPath)) return {
		package: null,
		errors: []
	};
	const errors = [];
	const pluginName = (0, path.basename)(pluginDir);
	try {
		const raw = await (0, fs_promises.readFile)(manifestPath, "utf-8");
		const manifest = JSON.parse(raw);
		const manifestErrors = validateManifest(manifest);
		if (manifestErrors.length > 0) {
			const msg = `manifest 验证失败: ${manifestErrors.join("; ")}`;
			logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
			errors.push({
				type: "manifest_invalid",
				message: msg,
				pluginName,
				filePath: manifestPath
			});
			return {
				package: null,
				errors
			};
		}
		// 包类型闸门（必须在跑入口之前）：AI 插件尚未接入装载器、一个包不许两种身份。
		// 只读清单、不执行包内代码 —— 否则用户看到的是插件自己抛的异常，看不出"装错类型"。
		const kind = detectPluginKind(manifest);
		if (kind.kind === "invalid") {
			errors.push({
				type: "manifest_invalid",
				message: "插件包身份冲突：" + kind.error + "（一个包不能同时声明 ai 与 nodes 两种身份）",
				pluginName,
				filePath: manifestPath
			});
			return {
				package: null,
				errors
			};
		}
		if (kind.kind === "ai") {
			errors.push({
				type: "manifest_invalid",
				message: "AI 插件尚未接入装载器（项目 plugins/ 只装节点插件；AI 插件走应用级插件目录或插件市场）",
				pluginName,
				filePath: manifestPath
			});
			return {
				package: null,
				errors
			};
		}
		return {
			package: await loadPluginJs(pluginDir, manifest, errors),
			errors
		};
	} catch (e) {
		const msg = `加载失败: ${errorMessage(e)}`;
		logger.error(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "unknown",
			message: msg,
			pluginName,
			filePath: manifestPath
		});
		return {
			package: null,
			errors
		};
	}
}
/**
* 加载插件的 JavaScript 定义文件（通过 vm 模块）
* 加载过程中的错误会收集到 errors 数组中，同时保留 logger.warn 输出
*/
async function loadPluginJs(pluginDir, manifest, errors) {
	const pluginName = manifest.name || (0, path.basename)(pluginDir);
	const entryPath = (0, path.join)(pluginDir, manifest.entry);
	if (!(0, fs.existsSync)(entryPath)) {
		const msg = `入口文件不存在: ${entryPath}`;
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "entry_missing",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	}
	const code = await (0, fs_promises.readFile)(entryPath, "utf-8");
	if (!code.trim()) {
		const msg = `入口文件为空: ${entryPath}`;
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "entry_empty",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	}
	try {
		vm.compileFunction(code, [], { filename: entryPath });
	} catch (e) {
		const msg = `插件代码语法错误: ${errorMessage(e)}`;
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "syntax_error",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	}
	const timers = /* @__PURE__ */ new Map();
	/** 只告警一次，避免一个插件里多次 setTimeout 刷屏 */
	let timerUnsupportedWarned = false;
	/**
	* 插件脚本的宿主桥：只认日志与定时器。
	*
	* 与旧实现的关键差别：`console.*` / `setTimeout` 现在是**沙箱 realm 函数**，
	* 经它转发；注入沙箱的宿主函数只有 `bridge` 这个唯一入口，而且引导脚本
	* 已经把它从全局删名、关进闭包 —— 插件拿不到宿主 Function。
	*/
	const bridge = (payloadJson) => {
		let msg;
		try {
			msg = JSON.parse(payloadJson);
		} catch {
			return "null";
		}
		if (!msg || typeof msg !== "object") return "null";
		switch (msg.kind) {
			case "log": {
				const args = Array.isArray(msg.args) ? msg.args : [];
				if (msg.level === "error") logger.error("[plugin]", ...args);
				else if (msg.level === "warn") logger.warn("[plugin]", ...args);
				else logger.info("[plugin]", ...args);
				return "null";
			}
			case "timerSet": {
				const id = Number(msg.id);
				const ms = Math.max(0, Number(msg.ms) || 0);
				if (!timerUnsupportedWarned) {
					timerUnsupportedWarned = true;
					logger.warn(`[pluginScanner] ${pluginName}: 加载期不支持 setTimeout —— 脚本同步执行、执行完立即回收定时器，回调不会触发。若需要延迟行为，请放在节点 handler 里，不要依赖加载期定时器。`);
				}
				timers.set(id, setTimeout(() => timers.delete(id), ms));
				return "null";
			}
			case "timerClear": {
				const id = Number(msg.id);
				const handle = timers.get(id);
				if (handle) {
					clearTimeout(handle);
					timers.delete(id);
				}
				return "null";
			}
			default: return "null";
		}
	};
	let exportsJson;
	try {
		const context = createHardenedContext(bridge, {
			name: `plugin:${pluginName}`,
			microtaskMode: "afterEvaluate"
		});
		exportsJson = runScriptInSandbox(context, code, {
			filename: entryPath,
			timeoutMs: SCRIPT_TIMEOUT_MS
		});
	} catch (e) {
		const msg = `执行插件代码失败: ${errorMessage(e)}`;
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "execution_failed",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	} finally {
		for (const handle of timers.values()) clearTimeout(handle);
		timers.clear();
	}
	let pkg = null;
	try {
		const raw = JSON.parse(exportsJson);
		if (raw && typeof raw === "object") pkg = raw;
	} catch {
		pkg = null;
	}
	if (!pkg) {
		const msg = "插件未导出有效对象";
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "no_export",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	}
	if (!pkg.name) pkg.name = manifest.name;
	if (!pkg.version) pkg.version = manifest.version;
	/**
	* ★ 权限的**唯一权威是 manifest.json**（P0-11）。
	*
	* index.js 里自己写的 `permissions` 一律被覆盖 —— 否则插件代码能给自己授权，
	* 白名单就形同虚设。这样"用户装插件时看到的权限"与"运行时真正执行的权限"是同一份。
	*/
	pkg.permissions = Array.isArray(manifest.permissions) ? manifest.permissions.slice() : [];
	/**
	* 验证节点定义。
	*
	* ⚠️ P0-11 起 `nodes` 是**可选**的：插件 = 能力容器，纯代码插件只提供
	* `triggers` + `handlers`（不需要画布、不需要节点）。但"写了 nodes 就必须是数组"
	* 这条不变 —— 写成字符串是作者错误，不能静默当没写（旧行为/旧报错文案原样保留）。
	*/
	if (pkg.nodes !== void 0 && !Array.isArray(pkg.nodes)) {
		const msg = "插件必须导出 nodes 数组";
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "no_export",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	}
	const hasNodesField = Array.isArray(pkg.nodes);
	const nodes = hasNodesField ? pkg.nodes : [];
	const validNodes = [];
	for (const node of nodes) {
		const kind = typeof node?.kind === "string" ? node.kind : "(未命名)";
		const handler = node?.handler;
		if (typeof handler !== "string" || handler.trim() === "") {
			const msg = `节点 ${kind} 的 handler 缺失（必须是函数表达式源码字符串，如 async (ctx) => { ... }）`;
			logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
			errors.push({
				type: "syntax_error",
				message: msg,
				pluginName,
				filePath: entryPath
			});
			continue;
		}
		const check = validateHandlerSource(handler);
		if (!check.ok) {
			const msg = `节点 ${kind} 的 handler 语法错误: ${check.error ?? "无法编译为函数"}`;
			logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
			errors.push({
				type: "syntax_error",
				message: msg,
				pluginName,
				filePath: entryPath
			});
			continue;
		}
		validNodes.push(node);
	}
	pkg.nodes = validNodes;
	const validatedCode = validatePluginCode(pkg.triggers, pkg.handlers);
	for (const msg of validatedCode.errors) {
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "syntax_error",
			message: msg,
			pluginName,
			filePath: entryPath
		});
	}
	pkg.triggers = validatedCode.triggers;
	pkg.handlers = validatedCode.handlers;
	/**
	* 一个插件包至少要能提供**一种**能力，否则它不是插件：
	*   · 节点（`nodes` 写了就是写了，即使是空数组 —— 保持历史行为：空节点包以前也算有效）；
	*   · 或 `triggers` 里至少一条有效触发器 + 至少一个有效 handler。
	*
	* 以前这里唯一判据就是"必须导出 nodes 数组"—— 那正是"插件必须带节点"这个
	* 错误结论在代码里的样子（manifest 本身完全通用，是装载器把它写窄了）。
	*/
	const hasCodeTriggers = validatedCode.triggers.length > 0 && Object.keys(validatedCode.handlers).length > 0;
	if (!hasNodesField && !hasCodeTriggers) {
		const msg = "插件未导出有效能力：nodes / triggers+handlers 至少要有一种（纯代码插件需要 triggers 数组 + handlers 对象，且至少一条触发器指向真实存在的 handler）";
		logger.warn(`[pluginScanner] ${pluginName}: ${msg}`);
		errors.push({
			type: "no_export",
			message: msg,
			pluginName,
			filePath: entryPath
		});
		return null;
	}
	return pkg;
}

export { SCRIPT_TIMEOUT_MS, errorMessage, ScanResult, validateManifest, scanPlugins, loadPluginPackage, loadPluginJs };
