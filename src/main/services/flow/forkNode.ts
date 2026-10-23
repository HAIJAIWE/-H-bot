// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { init_logger, logger } from "../infra/logger";
import { isValidPluginNodeKind } from "../plugins/pluginNamingContract";
import { NODE_CATALOG_V2 } from "../../../shared/nodes/builtinCatalog";
import { CUSTOM_PLUGIN_PREFIX, PLUGINS_SUBDIR } from "../plugins/pluginDirContract";
import { buildPluginManifestJson } from "../plugins/pluginManifest";
import { pluginNodeKind } from "../plugins/pluginKindContract";

/** JS 保留字：newName 不得与之冲突（会被用作节点标识与函数名） */
var JS_RESERVED = /* @__PURE__ */ new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"package",
	"private",
	"protected",
	"public",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield"
]);
/**
* 把内置节点复制为可编辑的自定义节点（插件包形式）。
*
* @param projectPath 项目根路径
* @param builtinKind 内置节点 kind（NODE_CATALOG_V2 中的 kind）
* @param newName     新节点标识（蛇形），生成的 kind 为 plugin_custom-<newName>_<newName>
*                    （拼法见 services/plugins/pluginKindContract.ts —— 不在这里自己拼）
*/
async function forkBuiltinNode(projectPath, builtinKind, newName) {
	if (!isValidPluginNodeKind(newName)) return {
		success: false,
		newKind: "",
		error: "newName 必须以小写字母开头，仅含小写字母/数字/下划线"
	};
	if (JS_RESERVED.has(newName)) return {
		success: false,
		newKind: "",
		error: `newName 不能是 JS 保留字: ${newName}`
	};
	if (!/^[a-zA-Z0-9_]+$/.test(builtinKind)) return {
		success: false,
		newKind: "",
		error: "builtinKind 含非法字符"
	};
	const spec = NODE_CATALOG_V2.find((n) => n.kind === builtinKind);
	if (!spec) return {
		success: false,
		newKind: "",
		error: `内置节点 ${builtinKind} 不存在`
	};
	const pluginName = `${CUSTOM_PLUGIN_PREFIX}${newName}`;
	const pluginDir = (0, path.join)(projectPath, PLUGINS_SUBDIR, pluginName);
	if ((0, fs.existsSync)(pluginDir)) return {
		success: false,
		newKind: "",
		error: `插件包已存在: plugins/${pluginName}（如需重建请先删除该目录）`
	};
	const manifestJson = buildPluginManifestJson({
		name: pluginName,
		description: `复制自内置节点 ${builtinKind}`
	});
	const stripPort = (p) => ({
		id: p.id,
		name: p.name,
		kind: p.kind,
		dataType: p.dataType
	});
	const indexJs = `// 从内置节点 ${builtinKind} 复制而来。
// 默认实现委托给内置节点（ctx.callBuiltin），可按需修改为自定义逻辑。
// 运行在 vm 沙箱中：无 require / process / Buffer；可用 ctx = { config, inputs, bot, event, projectPath, log, callBuiltin }。

module.exports = {
  name: ${JSON.stringify(pluginName)},
  version: '1.0.0',
  description: ${JSON.stringify(`复制自内置节点 ${builtinKind}`)},
  nodes: [
    {
      kind: ${JSON.stringify(newName)},
      type: ${JSON.stringify(spec.type)},
      label: ${JSON.stringify(`${spec.label}（自定义）`)},
      icon: ${JSON.stringify(spec.icon || "🧩")},
      group: '自定义',
      description: ${JSON.stringify(spec.description || "")},
      defaultConfig: ${JSON.stringify(spec.defaultConfig ?? {}, null, 6)},
      inputs: ${JSON.stringify((spec.inputs ?? []).map(stripPort), null, 6)},
      outputs: ${JSON.stringify((spec.outputs ?? []).map(stripPort), null, 6)},
      handler: ${JSON.stringify(`async (ctx) => ctx.callBuiltin(${JSON.stringify(builtinKind)}, ctx.config)`)},
    },
  ],
};
`;
	try {
		await (0, fs_promises.mkdir)(pluginDir, { recursive: true });
		await (0, fs_promises.writeFile)((0, path.join)(pluginDir, "manifest.json"), manifestJson, "utf-8");
		await (0, fs_promises.writeFile)((0, path.join)(pluginDir, "index.js"), indexJs, "utf-8");
	} catch (e) {
		return {
			success: false,
			newKind: "",
			error: `写入插件包失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	const newKind = pluginNodeKind(pluginName, newName);
	logger.info(`[forkNode] 已从内置节点 ${builtinKind} 复制出自定义节点: ${newKind}`);
	return {
		success: true,
		newKind,
		pluginPath: pluginDir
	};
}

export { JS_RESERVED, forkBuiltinNode };
