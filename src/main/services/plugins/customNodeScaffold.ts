// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs_promises from "fs/promises";
import * as fs from "fs";
import { init_schemaService } from "../project/schemaService";
import { init_dataService } from "../project/dataService";
import { init_logger, logger } from "../infra/logger";
import { isValidPluginDirName, nodeKindFromPluginDirName } from "./pluginNamingContract";
import { pluginNodeKind } from "./pluginKindContract";
import { buildPluginManifestJson } from "./pluginManifest";
import { PLUGINS_SUBDIR, isAiGeneratedPluginDirName } from "./pluginDirContract";

/**
* 生成插件包的两个文件内容（纯函数，便于测试）。
*
* ⚠️ **`index.js` 里节点的 `kind` 必须是裸名**（2026-10-16 修）：
* 加载链会**再拼一次**包名 —— `customNodeScanner.pluginNodeToSpecV2` 与
* `pluginLoader.pluginNodeToSpec` 都是 `plugin_<包名>_<节点的 kind>`。
* 以前这里自己先拼了一次，于是画布上的真实 kind 是
* `plugin_my-node_plugin_my-node_my_node`，而按钮回报给界面的是
* `plugin_my-node_my_node` —— **按钮说的和画布上的对不上**。
* AI 路径（`aiNodeScaffold` 写 `funcName`）与 fork 路径（`forkNode` 写 `newName`）
* 写的都是裸名，这里与它们对齐。
*/
function buildCustomNodeFiles(name, label) {
	const nodeKind = nodeKindFromPluginDirName(name);
	/** 画布上的**完整** kind（全局唯一标识，也回报给界面） */
	const kind = pluginNodeKind(name, nodeKind);
	const displayLabel = (label ?? "").trim() || name;
	const handler = `async (ctx) => {
  const text = String(ctx.inputs.text ?? ctx.config.text ?? '');
  ctx.log('${displayLabel}', text);
  // TODO 在这里写你的逻辑。需要发消息时：
  //   await ctx.callBuiltin('message_send', { message: text });
  return { result: text };
}`;
	const manifestJson = buildPluginManifestJson({
		name,
		description: `${displayLabel}（自定义节点）`
	});
	const node = {
		kind: nodeKind,
		type: "action",
		label: displayLabel,
		icon: "🧩",
		group: "自定义",
		description: `${displayLabel}：在代码面板里编辑 plugins/${name}/index.js 即可改行为`,
		defaultConfig: { text: "" },
		inputs: [{
			id: "in",
			name: "入",
			kind: "control"
		}, {
			id: "text",
			name: "输入文本",
			kind: "data",
			dataType: "string"
		}],
		outputs: [{
			id: "out",
			name: "出",
			kind: "control"
		}, {
			id: "result",
			name: "结果",
			kind: "data",
			dataType: "string"
		}],
		handler
	};
	return {
		manifestJson,
		indexJs: `// plugins/${name}/index.js —— 自定义节点（可在代码面板里直接编辑）
//
// 改完保存即生效（plugins/ 有监听器，不用重启应用）。
// 详细说明：应用内「📘 怎么写自定义节点」，或 docs/guides/plugin-authoring.md。
//
// 要点：
//   · handler 是**函数表达式源码字符串**；沙箱内没有 require/process/Buffer，只能用 ctx
//   · 返回对象的 key 要与 outputs 端口 id 一致（这里是 result）
//   · ctx.callBuiltin / ctx.bot.callApi 必须 await

module.exports = {
  name: ${JSON.stringify(name)},
  version: '1.0.0',
  description: ${JSON.stringify(`${displayLabel}（自定义节点）`)},
  nodes: [${JSON.stringify(node, null, 2)}],
};
`,
		kind
	};
}
/**
* 在 `<项目>/plugins/<name>/` 下创建一个可直接编辑的自定义节点骨架。
* 已存在同名目录时**拒绝**（不覆盖用户代码）。
*/
async function createCustomNode(projectPath, name, label) {
	if (!isValidPluginDirName(name)) throw new Error("节点名只能是小写字母开头，含小写字母/数字/连字符或下划线（例如 my-node）");
	/**
	* `ai-` 是**保留前缀**（= AI 用 `create_ai_node` 生成的那一类，见 pluginDirContract）。
	*
	* 为什么人写的这里要拒：目录名是**分类信号**，允许它等于把"人手写的包"混进
	* 「AI 生成」分组（画布分组、AI 上下文都会按它判断）。用户想要的名字去掉前缀即可。
	*/
	if (isAiGeneratedPluginDirName(name)) throw new Error(`"${name}" 以保留前缀 "ai-" 开头（那是 AI 生成节点的前缀），换个名字`);
	const dir = (0, path.join)(projectPath, PLUGINS_SUBDIR, name);
	try {
		await (0, fs_promises.access)(dir, fs.constants.F_OK);
		throw new Error(`plugins/${name} 已存在，换个名字（不会覆盖你已写的代码）`);
	} catch (e) {
		if (e instanceof Error && e.message.includes("已存在")) throw e;
	}
	const { manifestJson, indexJs, kind } = buildCustomNodeFiles(name, label);
	await (0, fs_promises.mkdir)(dir, { recursive: true });
	await (0, fs_promises.writeFile)((0, path.join)(dir, "manifest.json"), manifestJson, "utf-8");
	await (0, fs_promises.writeFile)((0, path.join)(dir, "index.js"), indexJs, "utf-8");
	logger.info(`[customNode] 已创建 plugins/${name}/{manifest.json,index.js}（kind=${kind}）`);
	return {
		pluginName: name,
		dir: `${PLUGINS_SUBDIR}/${name}`,
		manifestRelPath: `${PLUGINS_SUBDIR}/${name}/manifest.json`,
		entryRelPath: `${PLUGINS_SUBDIR}/${name}/index.js`,
		kind
	};
}

export { buildCustomNodeFiles, createCustomNode };
