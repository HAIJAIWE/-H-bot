// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";
import { isAiGeneratedPluginDirName, listPluginDirEntries, listPluginDirEntriesByPrefix } from "./pluginDirContract";
import { pluginNodeKind } from "./pluginKindContract";
import { loadPluginPackage } from "./pluginScanner";

/**
* 列出 {project}/plugins 下**匹配前缀**、且含 manifest.json 的插件目录。
*
* ⚠️ 这是**分类**查询（"只看 ai- 那一批"），**不是准入** ——
* 准入用 `pluginDirContract.listPluginDirEntries`（它不看目录名）。
*/
async function listPluginDirs(projectPath, prefix) {
	return listPluginDirEntriesByPrefix(projectPath, prefix);
}
/** 端口：PluginNode 的 Port[] → NodeSpecV2 的 PortSpec[] */
function toPortSpecs(ports, fallback) {
	if (!Array.isArray(ports) || ports.length === 0) return fallback;
	return ports.map((p) => ({
		id: p.id,
		name: p.name || p.id,
		kind: p.kind === "data" ? "data" : "control",
		dataType: p.dataType,
		description: p.description
	}));
}
/**
* 插件节点 → NodeSpecV2。
*
* kind 命名与 pluginLoader.pluginNodeToSpec 保持一致（`plugin_<pkg>_<kind>`），
* 这样代码生成（emitPluginNode）与运行时（dynamicHandlers）都能按同一 kind 命中。
*/
function pluginNodeToSpecV2(pluginName, node) {
	const kind = pluginNodeKind(pluginName, node.kind);
	const description = node.description || `${pluginName}: ${node.label}`;
	return {
		kind,
		type: node.type || "action",
		label: node.label,
		group: node.group || "自定义",
		icon: node.icon || "🧩",
		description,
		summary: description,
		sideEffects: [],
		tags: ["自定义", pluginName],
		handler: {
			source: "plugin",
			pluginName,
			funcName: node.kind
		},
		exposedAsTool: false,
		defaultConfig: node.defaultConfig ?? {},
		inputs: toPortSpecs(node.inputs, [{
			id: "in",
			name: "in",
			kind: "control"
		}]),
		outputs: toPortSpecs(node.outputs, [{
			id: "out",
			name: "out",
			kind: "control"
		}])
	};
}
/** 加载一批插件目录并展开为 NodeSpecV2 列表（坏包 warn 后跳过，不拖垮整次扫描） */
async function scanPluginDirs(dirs) {
	const specs = [];
	for (const { name, dir } of dirs) {
		const result = await loadPluginPackage(dir);
		if (!result.package) {
			logger.warn(`[customNodeScanner] 插件 ${name} 加载失败，已跳过`);
			continue;
		}
		for (const node of result.package.nodes ?? []) specs.push(pluginNodeToSpecV2(name, node));
	}
	return specs;
}
/**
* 扫描**人写**的自定义节点包。
*
* 判据 = `listPluginDirEntries`（目录 + manifest.json，**不看目录名**）
* 减去 `ai-` 那一批（归 `aiGeneratedScanner`）。两者合起来覆盖全部目录：
* 既不漏（按钮建的 `<名字>/` 也在内）也不重（`ai-` 只被扫一次）。
*/
async function scanCustomNodesV2(projectPath) {
	return scanPluginDirs((await listPluginDirEntries(projectPath)).filter((e) => !isAiGeneratedPluginDirName(e.name)));
}
/** 兼容旧接口：返回轻量描述（渲染层旧路径使用） */
async function scanCustomNodes(projectPath) {
	return (await scanCustomNodesV2(projectPath)).map((s) => ({
		name: s.label,
		funcName: s.kind,
		inputs: s.inputs.map((p) => p.id),
		outputs: s.outputs.map((p) => p.id),
		icon: s.icon,
		description: s.description
	}));
}

export { listPluginDirs, toPortSpecs, pluginNodeToSpecV2, scanPluginDirs, scanCustomNodesV2, scanCustomNodes };
