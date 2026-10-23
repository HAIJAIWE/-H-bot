// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as node_path from "node:path";
import { frameworkRoot, isFrameworkDevModeEnabled } from "./devMode";
import { isWithinProject } from "../infra/pathGuard";

/** 框架工作区在渲染层的稳定 id（不是真项目，别进"最近项目"列表） */
var FRAMEWORK_WORKSPACE_ID = "framework-workspace";
/**
* 这个路径能不能当"框架工作区"：**框架模式开着** + 落在**框架根之内**。
*
* 非字符串/空串一律 false（这个函数会被直接喂 IPC 载荷）。
*/
function isFrameworkWorkspacePath(candidate) {
	if (typeof candidate !== "string" || !candidate.trim()) return false;
	if (!isFrameworkDevModeEnabled()) return false;
	return isWithinProject(frameworkRoot(), (0, node_path.resolve)(candidate));
}
/**
* 合成框架工作区的 meta。
*
* `adapter` 只能填一个合法值（`ProjectMeta` 没有"无适配器"这一档）：这里填 'official'，
* 但**它不会被保存** —— 任何往这个路径写项目配置的通道（`project:saveConfig` 等）
* 都仍然被 `assertWithinProject` 挡在框架根外。
*/
function frameworkWorkspaceMeta(projectPath) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		id: FRAMEWORK_WORKSPACE_ID,
		name: "qqbat (framework)",
		path: (0, node_path.resolve)(projectPath),
		adapter: "official",
		createdAt: now,
		updatedAt: now
	};
}

export { FRAMEWORK_WORKSPACE_ID, isFrameworkWorkspacePath, frameworkWorkspaceMeta };
