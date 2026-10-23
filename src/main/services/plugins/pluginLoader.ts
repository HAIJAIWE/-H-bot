// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { loadPluginPackage } from "./pluginScanner";
import { init_logger, logger } from "../infra/logger";
import { pluginHandlerKind, pluginKindPrefix, pluginNodeKind } from "./pluginKindContract";
import { listPluginDirEntries } from "./pluginDirContract";
import { PLUGIN_TRIGGERS_ENV, isPluginTriggersEnabled, registerPluginTriggers, unregisterPluginTriggers } from "../../runtime/pluginTriggers";
import { isKnownPermission } from "../../runtime/pluginPermissions";
import { registerDynamicHandler, unregisterDynamicHandlersByPrefix } from "../../runtime/dynamicHandlers";

var registerNodesCallback = null;
/**
* 插件目录 → 项目根。
*
* 插件包的磁盘位置固定是 `<项目>/plugins/<目录>/`（唯一判据见 pluginDirContract），
* 上两级就是项目根。寄存器（触发器表）是**按项目**存的，所以每个登记点都要能拿到它。
* 现有入口（loadProjectPlugins / plugin:load / plugin:install）传的都是插件目录本身，形状一致。
*/
function projectPathOfPackage(pluginPath) {
	return (0, path.dirname)((0, path.dirname)((0, path.resolve)(pluginPath)));
}
/** 已加载的插件注册表（name -> LoadedPlugin） */
var registry = /* @__PURE__ */ new Map();
/** 将 PluginNode 转换为 NodeSpec */
function pluginNodeToSpec(pluginName, node) {
	return {
		kind: pluginNodeKind(pluginName, node.kind),
		type: node.type,
		label: node.label,
		group: node.group || "自定义",
		icon: node.icon || "🧩",
		description: node.description || `${pluginName}: ${node.label}`,
		defaultConfig: node.defaultConfig || {},
		inputs: node.inputs || [{
			id: "in",
			name: "in",
			kind: "control"
		}],
		outputs: node.outputs || [{
			id: "out",
			name: "out",
			kind: "control"
		}]
	};
}
/**
* 把项目 `plugins/` 下的插件包**装进当前进程**（加载 + 注册可执行 handler）。
*
* ## 为什么必须有这个函数（2026-10-01 查出的缺口）
*
* `loadPlugin` / `registerPlugin` / `registerDynamicHandler` 这条链一直是**完整且单测过的**，
* 但**没有任何生产代码调用它** —— 于是：
*
*   · 编辑器侧正常（`customNodeScanner` 扫描 → 插件节点出现在步骤节点库里，能拖进流程）
*   · **运行时侧是空的**：`getDynamicHandler(kind)` 查一个永远空的 Map，
*     流程里的 `plugin_*` 节点找不到 handler
*
* 也就是说"AI 能创建节点"这个能力**只完成了前半截**。
* 而单元测试**直接调** `registerDynamicHandler` 造夹具，所以测试全绿也发现不了 ——
* 本项目反复出现的"写好了没接线"（`initDebugListener` 零调用点、`required` 声明没人读，同一形态）。
*
* ## 语义
*
* · **绝不抛错**：一个插件包坏了不该让机器人起不来（记 warn 并跳过）
* · `reload: true` 时先卸载再注册 —— 否则 AI 用同名重建节点时，
*   `registerPlugin` 会因"已注册"直接跳过，用户看到的是**改动没生效**
* · **幂等**：重复调用是安全的（已注册的会跳过或按 reload 刷新）
*/
async function loadProjectPlugins(projectPath, opts = {}) {
	const pluginsDir = (0, path.join)(projectPath, "plugins");
	const loaded = [];
	const failed = [];
	if (!(0, fs.existsSync)(pluginsDir)) return {
		loaded,
		failed
	};
	/**
	* 准入：**目录 + manifest.json**（唯一判据，见 pluginDirContract）。
	*
	* 这里不再看目录名前缀 —— 那正是"按钮建的节点运行时装载不到"的根因；
	* 也仍然不会误收"别的东西"（数据/缓存目录没有 manifest.json）。
	*/
	let dirNames = [];
	try {
		dirNames = (await listPluginDirEntries(projectPath)).map((e) => e.name);
	} catch (e) {
		logger.warn(`[pluginLoader] 读取 plugins/ 失败: ${String(e)}`);
		return {
			loaded,
			failed
		};
	}
	for (const dirName of dirNames) {
		const pkgPath = (0, path.join)(pluginsDir, dirName);
		try {
			const pkg = await loadPlugin(pkgPath);
			if (!pkg) {
				failed.push(dirName);
				continue;
			}
			if (opts.reload && registry.has(pkg.name)) unregisterPlugin(pkg.name);
			registerPlugin(pkg, pkgPath);
			loaded.push(pkg.name);
		} catch (e) {
			failed.push(dirName);
			logger.warn(`[pluginLoader] 插件包「${dirName}」加载失败，已跳过: ${String(e)}`);
		}
	}
	if (loaded.length > 0 || failed.length > 0) logger.info(`[pluginLoader] 项目插件装载完成：成功 ${loaded.length} 个${failed.length > 0 ? `，失败 ${failed.length} 个（${failed.join("、")}）` : ""}`);
	return {
		loaded,
		failed
	};
}
/**
* 动态加载节点的 JS 定义文件
* 读取指定插件目录的 manifest.json + index.js，返回 PluginPackage
*/
async function loadPlugin(packagePath) {
	if (!(0, fs.existsSync)(packagePath)) return null;
	return (await loadPluginPackage(packagePath)).package;
}
/**
* 注册插件节点到流程可用节点列表
* 调用后插件节点会出现在 NodePalette 的"插件"分组
*/
function registerPlugin(pluginPkg, pluginPath) {
	const name = pluginPkg.name;
	if (registry.has(name)) {
		logger.warn(`[pluginLoader] 插件 "${name}" 已注册，跳过`);
		return false;
	}
	const nodes = pluginPkg.nodes ?? [];
	const specs = nodes.map((node) => pluginNodeToSpec(name, node));
	registry.set(name, {
		pkg: pluginPkg,
		specs,
		enabled: true,
		path: pluginPath
	});
	registerPluginHandlers(name, nodes);
	const triggerCount = registerPluginCode(name, pluginPkg, pluginPath);
	if (registerNodesCallback) registerNodesCallback(getAllPluginSpecs());
	logger.info(`[pluginLoader] 插件 "${name}" v${pluginPkg.version} 已注册，${specs.length} 个节点` + (triggerCount > 0 ? `、${triggerCount} 个声明式触发器` : ""));
	return true;
}
/**
* 注册纯代码插件的能力（P0-11）：
*   · `handlers` → 沙箱动态 handler（**与节点 handler 完全同一条路径**，
*     键用 `pluginHandlerKind`，与节点 kind 不共用命名空间）；
*   · `triggers` → 运行时触发器表（pluginTriggers），由 dispatchEvent 前置检查消费。
*
* ## 权限
*
* 把 `manifest.permissions`（pluginScanner 已强制以它为准）作为**白名单**传给
* `registerDynamicHandler`：宿主桥在执行 callApi / callBuiltin 之前逐次校验。
* 注意老通道（节点 handler）**不传** permissions —— 见 pluginPermissions.ts 的说明。
*
* ## 开关
*
* `QQBAT_PLUGIN_TRIGGERS=0` 时**整条通道不装载**（handler 也不注册、触发器也不登记），
* 于是行为与改动前逐字节一致（那时这类插件本来就无法运行）。
*
* @returns 实际登记的触发器数量（0 = 这个插件没有声明式触发器）
*/
function registerPluginCode(pluginName, pkg, pluginPath) {
	const triggers = pkg.triggers ?? [];
	const handlers = pkg.handlers ?? {};
	if (triggers.length === 0) return 0;
	if (!isPluginTriggersEnabled()) {
		logger.info(`[pluginLoader] 插件 "${pluginName}" 声明了 ${triggers.length} 个触发器，但 ${PLUGIN_TRIGGERS_ENV}=0（诊断开关），已跳过装载`);
		return 0;
	}
	const permissions = pkg.permissions ?? [];
	for (const permission of permissions) if (!isKnownPermission(permission)) logger.warn(`[pluginLoader] 插件 "${pluginName}" 的权限 "${permission}" 不被识别（当前只认 message.send / api.<name> / builtin.<kind>），它不会授予任何能力`);
	for (const [handlerName, source] of Object.entries(handlers)) {
		const kind = pluginHandlerKind(pluginName, handlerName);
		const result = registerDynamicHandler(kind, source, {
			pluginName,
			permissions
		});
		if (!result.ok) logger.warn(`[pluginLoader] 插件 "${pluginName}" 的 handler "${handlerName}" 注册失败: ${result.error}`);
	}
	const count = registerPluginTriggers(projectPathOfPackage(pluginPath), pluginName, triggers.map((trigger) => ({
		trigger,
		handlerKind: pluginHandlerKind(pluginName, trigger.handler),
		permissions
	})));
	logger.info(`[pluginLoader] 插件 "${pluginName}" 已登记 ${count} 个声明式触发器（权限: ${permissions.join("、") || "无"}）`);
	return count;
}
/**
* 为插件节点注册动态 handler（在沙箱中编译 `handler` 函数字符串）。
*
* kind 命名与 `pluginNodeToSpec` **必须逐字一致**：两处都走
* `pluginKindContract.pluginNodeKind`。对不上就是"节点能拖出来、一跑没反应"。
* 编译失败的节点会被跳过并记录原因 —— 单个坏节点不影响同插件其它节点。
*/
function registerPluginHandlers(pluginName, nodes) {
	for (const node of nodes) {
		const kind = pluginNodeKind(pluginName, node.kind);
		if (!node.handler || typeof node.handler !== "string") {
			logger.warn(`[pluginLoader] 插件 "${pluginName}" 节点 "${node.kind}" 缺少 handler，跳过执行注册`);
			continue;
		}
		const result = registerDynamicHandler(kind, node.handler);
		if (!result.ok) logger.warn(`[pluginLoader] 插件 "${pluginName}" 节点 "${node.kind}" 注册失败: ${result.error}`);
	}
}
/**
* 卸载插件
* 从注册表中移除并通知渲染进程
*/
function unregisterPlugin(pluginName) {
	const plugin = registry.get(pluginName);
	if (!plugin) {
		logger.warn(`[pluginLoader] 插件 "${pluginName}" 未注册`);
		return false;
	}
	unregisterPluginTriggers(projectPathOfPackage(plugin.path), pluginName);
	registry.delete(pluginName);
	unregisterDynamicHandlersByPrefix(pluginKindPrefix(pluginName));
	if (registerNodesCallback) registerNodesCallback(getAllPluginSpecs());
	logger.info(`[pluginLoader] 插件 "${pluginName}" 已卸载`);
	return true;
}
/**
* 启用/禁用插件
*/
function setPluginEnabled(pluginName, enabled) {
	const plugin = registry.get(pluginName);
	if (!plugin) return false;
	plugin.enabled = enabled;
	/**
	* 声明式触发器跟随插件启停。
	*
	* 节点只是"从节点面板消失"（画布上已有节点仍可被执行，这是历史语义，不改）；
	* 但触发器是**主动响应**——禁用后如果还继续回命令，用户会认为开关坏了。
	* 所以禁用 = 从运行时触发器表摘掉，启用 = 重新登记（幂等）。
	*/
	if (enabled) registerPluginCode(pluginName, plugin.pkg, plugin.path);
	else unregisterPluginTriggers(projectPathOfPackage(plugin.path), pluginName);
	if (registerNodesCallback) registerNodesCallback(getAllPluginSpecs());
	return true;
}
/** 获取所有已注册插件的 NodeSpec（仅启用的插件） */
function getAllPluginSpecs() {
	const result = [];
	for (const [, plugin] of registry) if (plugin.enabled) result.push(...plugin.specs);
	return result;
}
/**
* 按完整 kind（plugin_<pluginName>_<nodeKind>）反查插件节点定义。
*
* 修复前代码生成器用 split('_') 解析 nodeKind 还原插件名/节点名，
* 插件名或节点名含下划线时（如 plugin_my_plugin_hello）解析错位。
* 插件注册表才是唯一可靠的信息源：按已注册插件名最长匹配前缀。
*
* @returns { pluginName, nodeKind } — 插件名与节点在插件中的原始 kind；未注册返回 null
*/
function findPluginNode(kind) {
	let best = null;
	for (const [name, plugin] of registry) {
		if (!plugin.enabled) continue;
		const prefix = pluginKindPrefix(name);
		if (kind.startsWith(prefix)) {
			if (!best || name.length > best.pluginName.length) best = {
				pluginName: name,
				nodeKind: kind.slice(prefix.length)
			};
		}
	}
	return best;
}
/** 获取插件信息列表 */
function getPluginInfos() {
	return Array.from(registry.entries()).map(([name, plugin]) => ({
		name,
		version: plugin.pkg.version,
		author: plugin.pkg.author,
		description: plugin.pkg.description,
		nodeCount: plugin.specs.length,
		triggerCount: plugin.pkg.triggers?.length ?? 0,
		enabled: plugin.enabled,
		loaded: true,
		path: plugin.path
	}));
}

export { registerNodesCallback, projectPathOfPackage, registry, pluginNodeToSpec, loadProjectPlugins, loadPlugin, registerPlugin, registerPluginCode, registerPluginHandlers, unregisterPlugin, setPluginEnabled, getAllPluginSpecs, findPluginNode, getPluginInfos };
