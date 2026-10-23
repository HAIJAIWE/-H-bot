// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import * as path from "path";

/** 读取环境变量（去空白；空串视为未设置） */
function envPath(name) {
	const value = process.env[name];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
/** Electron 的应用目录；非 Electron 进程（纯 Node / 测试）下为 undefined */
function electronAppPath() {
	try {
		const appPath = require("electron").app?.getAppPath?.();
		return typeof appPath === "string" && appPath.trim() ? appPath : void 0;
	} catch {
		return;
	}
}
/**
* 解析项目根目录（绝对路径）。
*
* @param injectedRoot 运行时注入的项目目录（`HandlerContext.projectPath`）
*/
function getProjectRoot(injectedRoot) {
	const candidates = [
		envPath("QQBOT_PROJECT_ROOT"),
		envPath("QQBOT_PROJECT_PATH"),
		typeof injectedRoot === "string" && injectedRoot.trim() ? injectedRoot.trim() : void 0,
		electronAppPath(),
		process.cwd()
	];
	for (const candidate of candidates) if (candidate) return path.resolve(candidate);
	return path.resolve(process.cwd());
}
/** target 是否位于 root 之内（含 root 自身） */
function isInsideProject(root, target) {
	const rel = path.relative(path.resolve(root), path.resolve(target));
	return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
/**
* 把节点里填写的路径解析为项目内的绝对路径。
*
* - 相对路径：相对**项目根**（不是进程 cwd）
* - 绝对路径：允许，但必须仍在项目根之内
* - 越界（`../..`、指向项目外的绝对路径）：抛错，由调用方转成节点错误
*
* @param label 出错信息里显示的字段名（如 `file_path`、`db_path`）
*/
function resolveInProject(rawPath, opts = {}) {
	const label = opts.label ?? "路径";
	if (!rawPath || !rawPath.trim()) throw new Error(`${label} 为空`);
	const root = getProjectRoot(opts.injectedRoot);
	const resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
	if (!isInsideProject(root, resolved)) throw new Error(`非法${label}（路径穿越被拒绝）: ${rawPath}`);
	return resolved;
}

export { envPath, electronAppPath, getProjectRoot, isInsideProject, resolveInProject };
