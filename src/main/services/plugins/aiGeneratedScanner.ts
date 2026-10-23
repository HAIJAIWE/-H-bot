// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { listPluginDirs, pluginNodeToSpecV2 } from "./customNodeScanner";
import { init_logger, logger } from "../infra/logger";
import { loadPluginPackage } from "./pluginScanner";

/**
* 扫描 AI 生成节点（plugins/ai-… 目录），返回 NodeSpecV2 列表。
*
* 目录不存在时返回空数组。
*/
async function scanAiGeneratedNodes(projectPath) {
	const dirs = await listPluginDirs(projectPath, "ai-");
	const allNodes = [];
	for (const { name, dir } of dirs) {
		const result = await loadPluginPackage(dir);
		if (!result.package) {
			logger.warn(`[aiGeneratedScanner] 插件 ${name} 加载失败，已跳过`);
			continue;
		}
		for (const node of result.package.nodes ?? []) allNodes.push(pluginNodeToSpecV2(name, node));
	}
	return allNodes;
}

export { scanAiGeneratedNodes };
