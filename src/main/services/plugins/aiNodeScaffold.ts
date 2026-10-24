// @ts-nocheck
// 由 10/18 打包产物还原（chunk: aiNodeScaffold-BkYa_pGY.js）；见 _recovery/README-recovery.md
import * as path from "path";
import { dryRunAiNode } from "../ai/nodeDryRun";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { init_logger, logger } from "../infra/logger";
import { isValidPluginDirName, isValidPluginNodeKind } from "./pluginNamingContract";
import { PLUGINS_SUBDIR } from "./pluginDirContract";
import { pluginNodeKind } from "./pluginKindContract";
import { validateHandlerSource } from "../../runtime/dynamicHandlers";
import { buildPluginManifestJson } from "./pluginManifest";
import { recordFileBefore } from "../flow/turnJournal";
import { NODE_CATALOG_V2 } from "../../../shared/nodes/builtinCatalog";

/**
* **自动追加区的标记**。
*
* 为什么要有它（2026-10-10，一域一包）：一个包要能装多个节点，就得**往已有的 index.js 里插**。
* 而 index.js 是用户可以手改的 —— 用标记圈出自动区，插入只发生在标记之间，
* 用户手写的节点不受影响；标记被删掉了就**拒绝追加**（宁可报错，也不猜着改用户文件）。
*/
var PKG_BEGIN = "// >>> qqbat:ai-nodes";
var PKG_END = "// <<< qqbat:ai-nodes";
/** 包名归一化：只允许安全 ASCII；不合法一律退回 funcName（绝不把中文塞进目录名） */
function resolvePackageName(raw, funcName) {
	const lower = String(raw ?? "").trim().toLowerCase();
	if (!lower) return funcName;
	const cleaned = lower.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
	return isValidPluginDirName(cleaned) ? cleaned : funcName;
}
/** 插件包所在目录（子目录名来自 pluginDirContract，别处不再写 'plugins' 字面量） */
function projectPluginsDir(projectPath) {
	return (0, path.join)(projectPath, PLUGINS_SUBDIR);
}
/** 默认端口：单个控制输入 + 单个控制输出 */
var DEFAULT_INPUTS = [{
	id: "in",
	name: "in",
	kind: "control"
}];
var DEFAULT_OUTPUTS = [{
	id: "out",
	name: "out",
	kind: "control"
}];
async function createAiNode(projectPathOrReq, funcNameArg, labelArg, summaryArg, handlerArg) {
	const req = typeof projectPathOrReq === "string" ? {
		projectPath: projectPathOrReq,
		funcName: funcNameArg ?? "",
		label: labelArg ?? "",
		summary: summaryArg ?? "",
		handler: handlerArg ?? ""
	} : projectPathOrReq;
	const { projectPath, funcName, label, summary, handler } = req;
	if (!isValidPluginNodeKind(funcName)) return {
		ok: false,
		error: `funcName 不合法：必须为蛇形命名（小写字母开头，仅含小写字母/数字/下划线），收到: ${funcName}`
	};
	if (!handler || handler.trim().length === 0) return {
		ok: false,
		error: "handler 不能为空（应为 JS 函数表达式，如 async (ctx) => { ... }）"
	};
	/**
	* 0.5 **节点包解析（一域一包）**。
	*
	* 同域的多个节点传同一个 packageName → 都进 `plugins/ai-<包名>/`；
	* 不传则退回老行为（一个节点一个包，包名 = funcName）。
	*/
	const pkg = resolvePackageName(req.packageName, funcName);
	const pluginName = `ai-${pkg}`;
	const pluginDir = (0, path.join)(projectPluginsDir(projectPath), pluginName);
	/** 同一个目录的**相对路径**（轮次日志按相对路径记，撤回时才不依赖绝对路径） */
	const pluginRelDir = `${PLUGINS_SUBDIR}/${pluginName}`;
	const inputs = req.inputs && req.inputs.length > 0 ? req.inputs : DEFAULT_INPUTS;
	const outputs = req.outputs && req.outputs.length > 0 ? req.outputs : DEFAULT_OUTPUTS;
	const nodeKind = pluginNodeKind(pluginName, funcName);
	try {
		const conflict = await detectNamingConflict(projectPath, pluginDir, pluginName, funcName, nodeKind);
		if (conflict) return {
			ok: false,
			error: conflict
		};
	} catch (e) {
		return {
			ok: false,
			error: `命名冲突检测失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	const validationErrors = [];
	const syntax = validateHandlerSource(handler);
	if (!syntax.ok) validationErrors.push(syntax.error ?? "handler 语法校验失败");
	if (validationErrors.length > 0) return {
		ok: false,
		validationErrors
	};
	/**
	* 2.5 **干跑自检**（2026-10-10）。
	*
	* 语法过了**不等于跑得对**：在写文件之前用假 bot 真跑一次，把这三类挡在门口 ——
	*   · 运行期异常、· 幻觉 API、· 返回值与端口对不上。
	* 不通过就**不落盘**（否则用户的项目里会堆一堆跑不起来的插件）。
	*/
	const dry = await dryRunAiNode({
		kind: nodeKind,
		handler,
		inputs: Object.fromEntries((inputs ?? []).filter((p) => p.kind === "data").map((p) => [p.id, p.dataType === "list" ? [] : p.dataType === "number" ? 0 : "示例值"])),
		outputs: (outputs ?? []).map((p) => ({
			id: p.id,
			kind: p.kind
		})),
		projectPath
	});
	if (!dry.ok) return {
		ok: false,
		validationErrors: [`干跑自检未通过：${dry.error}`, "提示：若某一步依赖运行时才有的数据，请先给它默认值（如 String(ctx.config.x ?? \"\")）再重试；调协议端 API 请只用「可用协议端 API」清单里的名字。"]
	};
	const manifestJson = buildPluginManifestJson({
		name: pluginName,
		description: summary || label || `AI 生成节点 ${funcName}`
	});
	const nodeSnippet = [
		"    {",
		`      kind: ${JSON.stringify(funcName)},`,
		"      type: 'action',",
		`      label: ${JSON.stringify(label || funcName)},`,
		`      icon: ${JSON.stringify(req.icon || "🤖")},`,
		"      group: 'AI 生成',",
		`      description: ${JSON.stringify(summary || "")},`,
		`      inputs: ${JSON.stringify(inputs, null, 6)},`,
		`      outputs: ${JSON.stringify(outputs, null, 6)},`,
		"      // ctx = { config, inputs, bot, event, projectPath, log }",
		`      handler: ${JSON.stringify(handler)},`,
		"    },"
	].join("\n");
	const newPackageSource = [
		`// AI 生成节点包：${pkg}`,
		"// 由 qqbat create_ai_node 维护；运行在 vm 沙箱中（无 require / process / Buffer）。",
		"// 两行 qqbat:ai-nodes 标记之间是**自动追加区** —— 同域新增节点会插在这里，请不要手改这一段。",
		"// 标记之外你可以自由加自己的节点（手写的不会被覆盖）。",
		"",
		"module.exports = {",
		`  name: ${JSON.stringify(pluginName)},`,
		"  version: '1.0.0',",
		`  description: ${JSON.stringify(summary || "")},`,
		"  nodes: [",
		`    ${PKG_BEGIN}`,
		nodeSnippet,
		`    ${PKG_END}`,
		"  ],",
		"};",
		""
	].join("\n");
	const indexPath = (0, path.join)(pluginDir, "index.js");
	try {
		if ((0, fs.existsSync)(indexPath)) {
			const src = await (0, fs_promises.readFile)(indexPath, "utf-8");
			const bi = src.indexOf(PKG_BEGIN);
			const ei = src.indexOf(PKG_END);
			if (bi < 0 || ei < 0 || ei < bi) return {
				ok: false,
				validationErrors: [`节点包 ${pluginName} 的 index.js 里找不到自动追加标记（${PKG_BEGIN} / ${PKG_END}）——`, "多半是你手改过这个文件。两个选择：① 换一个 packageName；② 手动把新节点合并进去。"]
			};
			await recordFileBefore(projectPath, `${pluginRelDir}/index.js`);
			await (0, fs_promises.writeFile)(indexPath, src.slice(0, ei) + nodeSnippet + "\n" + src.slice(ei), "utf-8");
		} else {
			await (0, fs_promises.mkdir)(pluginDir, { recursive: true });
			await recordFileBefore(projectPath, `${pluginRelDir}/manifest.json`);
			await recordFileBefore(projectPath, `${pluginRelDir}/index.js`);
			await (0, fs_promises.writeFile)((0, path.join)(pluginDir, "manifest.json"), manifestJson, "utf-8");
			await (0, fs_promises.writeFile)(indexPath, newPackageSource, "utf-8");
		}
	} catch (e) {
		return {
			ok: false,
			error: `写入节点包失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	logger.info(`[aiNodeScaffold] 已创建 AI 节点: ${nodeKind} (label=${label}, summary=${summary})`);
	return {
		ok: true,
		nodeKind,
		pluginPath: pluginDir,
		...dry.adapterOnlyApis.length > 0 ? { warning: `这个节点用了只在 NapCat 这类 第三方桥接实现上有效的 API（${dry.adapterOnlyApis.join("、")}）——官方 QQ 适配器下运行会失败。` } : {}
	};
}
/**
* 命名冲突检测。
*
* ⚠️ 判据在 2026-10-10 变了：**从「目录存在就拒」改成「包内已有同名节点才拒」**。
* 因为一域一包的前提就是**允许目录已存在**（同域第二个节点要追加进去）。
*
* 三条判据：
*  · nodeKind 不得与内置节点冲突；
*  · 包内不得已有同名 kind（否则 loader 会导出两个同名节点）；
*  · 目录存在但没有 index.js —— 那不是本流程建的包，别往里塞。
*/
async function detectNamingConflict(projectPath, pluginDir, pluginName, funcName, nodeKind) {
	for (const n of NODE_CATALOG_V2) if (n.kind === funcName) return `命名冲突：内置节点 kind "${funcName}" 已被占用`;
	const indexPath = (0, path.join)(pluginDir, "index.js");
	if ((0, fs.existsSync)(indexPath)) {
		let src = "";
		try {
			src = await (0, fs_promises.readFile)(indexPath, "utf-8");
		} catch {
			src = "";
		}
		if (new RegExp(`kind:\\s*"${funcName}"`).test(src)) return `命名冲突：节点包 ${pluginName} 里已经有同名节点 ${funcName}（改用别的 funcName，或改成更新它）`;
		return null;
	}
	if ((0, fs.existsSync)(pluginDir)) return `命名冲突：plugins/${pluginName} 目录已存在，但里面没有 index.js —— 这不是本流程建的包，请换一个 packageName`;
	return null;
}

export { PKG_BEGIN, PKG_END, resolvePackageName, projectPluginsDir, DEFAULT_INPUTS, DEFAULT_OUTPUTS, createAiNode, detectNamingConflict };
