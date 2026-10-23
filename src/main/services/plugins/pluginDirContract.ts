// @ts-nocheck
// 由 10/18 打包产物还原（chunk: pluginKindContract-wHH7ArbE.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import * as fs_promises from "fs/promises";

/** 项目里放插件的子目录名 */
var PLUGINS_SUBDIR = "plugins";
/**
* **分类**信号：从内置节点复制出来的包用这个前缀（`forkNode` 写的就是它）。
*
* 与 `AI_PLUGIN_PREFIX` 一样只是**命名/分类**约定，**不参与准入**（准入 = 目录 +
* manifest.json，不看目录名）。放在这里是因为"前缀字面量"应该只有一个来源 ——
* forkNode 不再自己写一份 `'custom-'`。
*/
var CUSTOM_PLUGIN_PREFIX = "custom-";
/** 名字是不是 `ai-` 开头（= AI 生成的那一类） */
function isAiGeneratedPluginDirName(name) {
	return name.startsWith("ai-");
}
/**
* 列出项目里**所有**插件包目录 —— 就这一条判据：目录 + `manifest.json`。
*
* 与旧实现的三处差异（都是有意的）：
*   · **不按前缀过滤**（修 P0-9：按钮建的 <名字>/ 也要能被扫到）；
*   · 跳过 `.` 开头的目录（编辑器/系统的隐藏目录不是插件）；
*   · 只认目录（文件不是插件包）。
*
* @returns 按名字排序的条目；`plugins/` 不存在时返回空数组
*/
async function listPluginDirEntries(projectPath) {
	const pluginsDir = (0, path.join)(projectPath, PLUGINS_SUBDIR);
	if (!(0, fs.existsSync)(pluginsDir)) return [];
	let entries = [];
	try {
		entries = await (0, fs_promises.readdir)(pluginsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((name) => !name.startsWith(".")).map((name) => ({
		name,
		dir: (0, path.join)(pluginsDir, name)
	})).filter(({ dir }) => (0, fs.existsSync)((0, path.join)(dir, "manifest.json"))).sort((a, b) => a.name.localeCompare(b.name));
}
/**
* 按**字面前缀**列插件目录（保留给"只想要 ai- 那一批"的调用方）。
*
* ⚠️ 这是**分类**查询，不是准入：准入用 {@link listPluginDirEntries}。
*/
async function listPluginDirEntriesByPrefix(projectPath, prefix) {
	return (await listPluginDirEntries(projectPath)).filter((e) => e.name.startsWith(prefix));
}

export { PLUGINS_SUBDIR, CUSTOM_PLUGIN_PREFIX, isAiGeneratedPluginDirName, listPluginDirEntries, listPluginDirEntriesByPrefix };
