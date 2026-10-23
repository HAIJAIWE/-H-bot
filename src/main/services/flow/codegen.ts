// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { registerAllBuiltinNodes } from "../../nodes/builtin/index";
import { getNodeRegistry } from "../../nodes/registry";
import { generateCode } from "../../codegen/generator";
import * as path from "path";
import * as fs_promises from "fs/promises";
import { gitService } from "../ops/git";
import { __exportAll } from "../../../shared/runtime/rolldownShim";
import { init_logger, logger } from "../infra/logger";
import { assertWithinProject } from "../infra/pathGuard";
import { loadProjectPlugins } from "../plugins/pluginLoader";
import { atomicWrite } from "../infra/fileOps";

var codegen_exports = /* @__PURE__ */ __exportAll({ CodegenService: () => CodegenService });
var CodegenService = class {
	baseDir;
	constructor(baseDir = "") {
		this.baseDir = baseDir;
	}
	/**
	* 生成流程代码快照：src/plugins/generated/flow.generated.ts。
	*
	* 解释执行模式（默认）：
	*   - 运行时不加载这个文件：FlowInterpreter 直接读取 {project}/.qqbat/flow.json
	*     （mtime 热重载），改完流程下一条命令即时生效，无需重启
	*   - 这里只保留一份 TypeScript 快照，供调试、审查与回滚
	*
	* 原子写入：写 .tmp → rename。
	* 同时确保 plugins/ 目录存在。
	*/
	/**
	* @param version 版本三态：undefined=自动命名；null=只生成不打版本；对象=用用户填的名字。
	*   默认 undefined —— generate_code 工具按两参调用，语义就是「顺手记个版本」。
	*/
	async generate(projectPath, graph, debugMode = false, version: { name?: string; message?: string } | null | undefined = undefined) {
		if (this.baseDir) assertWithinProject(this.baseDir, projectPath);
		registerAllBuiltinNodes(getNodeRegistry());
		await this.ensureCustomTemplate(projectPath);
		try {
			await loadProjectPlugins(projectPath);
		} catch (e) {
			logger.warn("[codegen] 装载项目插件失败（插件节点可能无法解析）:", e);
		}
		const result = generateCode(graph, debugMode);
		const generatedDir = (0, path.join)(projectPath, "src", "plugins", "generated");
		await (0, fs_promises.mkdir)(generatedDir, { recursive: true });
		const snapshotPath = (0, path.join)(generatedDir, "flow.generated.ts");
		const snapshot = `// H Bot 制造 生成代码快照（自动生成，请勿手动编辑）
// 由 CodegenService.generate 写入，来源: ${projectPath}/.qqbat/flow.json
// 运行时不加载本文件（FlowInterpreter 直接执行 flow.json），仅用于调试与审查。

${result.code}`;
		await atomicWrite(snapshotPath, snapshot);
		let versionName = null;
		/** 打版本失败的原因。**不能只写日志** —— 用户点了「生成并记版本」却没记上，
		*  必须由界面说出来，否则又回到"什么都没发生"的体验。 */
		let versionError = null;
		if (!debugMode && version !== null) try {
			const tag = await gitService.tagVersion(projectPath, version?.name, version?.message ?? `生成代码 · ${graph.nodes.length} 节点 · ${graph.edges.length} 连线`);
			versionName = tag.name;
			logger.info(`[codegen] 已记为版本 ${tag.name}（${tag.hash.slice(0, 7)}）`);
		} catch (e) {
			versionError = e instanceof Error ? e.message : String(e);
			logger.warn(`[codegen] 记录版本失败（代码已正常生成）: ${versionError}`);
		}
		return {
			version: versionName,
			versionError
		};
	}
	/**
	* 确保项目的扩展目录存在。
	*
	* 迁移说明：旧实现往 `src/plugins/custom/` 写 Python 脚手架
	* （`__init__.py` + 定义 `@node` 装饰器的 `qqbat.py`）。Python 运行时已移除，
	* 自建节点改为**插件包**（`plugins/custom-…/{manifest.json,index.js}`），
	* 由 AI 工具 create_ai_node 或「复制内置节点」生成 —— 不需要预置脚手架文件。
	* 这里只保证 `plugins/` 目录存在，便于用户/工具直接放置插件包。
	*/
	async ensureCustomTemplate(projectPath) {
		if (this.baseDir) assertWithinProject(this.baseDir, projectPath);
		await (0, fs_promises.mkdir)((0, path.join)(projectPath, "plugins"), { recursive: true });
	}
};

export { codegen_exports, CodegenService };
