// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import * as node_fs from "node:fs";
import * as node_path from "node:path";
import { init_logger, logger } from "../infra/logger";
import { assertNotSystemPath, assertWithinProject, isWithinProject } from "../infra/pathGuard";
import { existingUserDataPath, userDataPath } from "../infra/paths";

/** 用户侧覆盖框架根的环境变量（见文件头"框架根"） */
var FRAMEWORK_ROOT_ENV = "QQBAT_FRAMEWORK_ROOT";
/**
* 覆盖**设置文件位置**的环境变量。
*
* 用途：便携版/多套配置各存各的开关；测试要用真实文件验证"落盘失败即不改状态"。
* 同样属用户侧（模型改不了环境）。
*/
var DEV_MODE_SETTING_ENV = "QQBAT_DEV_MODE_SETTING";
/** `file:setDevMode` 的载荷 */
var devModeRequestSchema = z.object({ enabled: z.boolean() });
/** 进程内状态：默认关。`loaded` 表示是否已经从磁盘读过一次。 */
var enabled = false;
var loaded = false;
/** 候选目录"看起来像一个框架检出"吗（根下有 package.json） */
function looksLikeFrameworkCheckout(dir) {
	try {
		return (0, node_fs.existsSync)((0, node_path.join)(dir, "package.json"));
	} catch {
		return false;
	}
}
/** Electron 的应用目录；非 Electron 进程（纯 Node / 测试）下为 null */
function electronAppPath() {
	try {
		const appPath = require("electron")?.app?.getAppPath?.();
		if (typeof appPath === "string" && appPath.trim()) return (0, node_path.resolve)(appPath);
	} catch {}
	return null;
}
/**
* 收窄框架根：磁盘根（`D:/`、`/`）与系统关键目录一律不认。
*
* @returns 合法则返回 resolve 后的绝对路径，否则 null（调用方换下一个候选）
*/
function sanitizeFrameworkRoot(candidate) {
	const resolved = (0, node_path.resolve)(candidate);
	if ((0, node_path.dirname)(resolved) === resolved) return null;
	try {
		assertNotSystemPath(resolved, "框架根");
	} catch {
		return null;
	}
	return resolved;
}
/**
* 框架根：本仓库自己的源码目录（"框架就是这仓库"）。
*
* 永不抛错 —— 这是安全边界的一部分，取不到就回退到应用目录 / cwd；
* 拿不到根而抛错会让所有文件操作一起挂掉（那是可用性事故，不是安全收益）。
*/
function frameworkRoot() {
	const override = process.env[FRAMEWORK_ROOT_ENV];
	if (typeof override === "string" && override.trim()) {
		const safe = sanitizeFrameworkRoot(override.trim());
		if (safe && looksLikeFrameworkCheckout(safe)) return safe;
		logger.warn(`[devBackup] ${FRAMEWORK_ROOT_ENV} 不可用（磁盘根/系统目录/不像框架检出），已忽略该覆盖，改用应用自己的目录`);
	}
	const candidates = [];
	const appPath = electronAppPath();
	if (appPath) candidates.push(appPath);
	candidates.push((0, node_path.resolve)(process.cwd()));
	let fallback = null;
	for (const candidate of candidates) {
		const safe = sanitizeFrameworkRoot(candidate);
		if (!safe) continue;
		if (fallback === null) fallback = safe;
		if (looksLikeFrameworkCheckout(safe)) return safe;
	}
	if (fallback) {
		logger.warn("[devBackup] 没找到像框架检出的目录，框架根退回应用目录:", fallback);
		return fallback;
	}
	return (0, node_path.resolve)(process.cwd());
}
/** 这个路径**就是**框架根吗（规范化后精确比较；Windows 大小写不敏感） */
function isFrameworkRootPath(candidate) {
	if (typeof candidate !== "string" || !candidate.trim()) return false;
	const a = (0, node_path.resolve)(candidate);
	const b = (0, node_path.resolve)(frameworkRoot());
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
/**
* 设置文件的绝对路径。
*
* 顺序：`QQBAT_DEV_MODE_SETTING` 覆盖 > Electron userData > null（没有可落盘的位置）。
* 返回 null ≠ 抛错：它表示"这个进程没有持久化能力"，此时开关**不能切换**
* （见文件头"内存状态永远跟随磁盘状态"）。
*/
function devModeSettingPath() {
	const override = process.env[DEV_MODE_SETTING_ENV];
	if (typeof override === "string" && override.trim()) return (0, node_path.resolve)(override.trim());
	return userDataPath("devModeSetting");
}
/**
* **读取位置**：新位置（config/dev-mode.json）优先，否则回落 P4.3 之前的
* `framework-dev-mode.json`（双读单写：写入永远走新位置）。
*/
function devModeReadPath() {
	const override = process.env[DEV_MODE_SETTING_ENV];
	if (typeof override === "string" && override.trim()) return (0, node_path.resolve)(override.trim());
	return existingUserDataPath("devModeSetting");
}
/**
* 读设置文件。
*
* **只有明确的 `enabled === true` 才算开**：文件缺失、坏 JSON、字段类型不对
* 一律按关处理（与 guardSettings 的 `=== '1'` 同一套 fail-closed 纪律：
* 宁可"以为关着其实关着"，不要"以为开了其实开着"）。
*/
function readDevModeSettingFile(path) {
	try {
		if (!(0, node_fs.existsSync)(path)) return false;
		const parsed = JSON.parse((0, node_fs.readFileSync)(path, "utf-8"));
		return !!(parsed && typeof parsed === "object" && parsed.enabled === true);
	} catch (e) {
		logger.warn("[devBackup] 框架模式设置读取失败（按关闭处理）:", e);
		return false;
	}
}
/** 写设置文件（幂等覆盖；失败由调用方决定怎么报告） */
function writeDevModeSettingFile(path, value) {
	(0, node_fs.mkdirSync)((0, node_path.dirname)(path), { recursive: true });
	(0, node_fs.writeFileSync)(path, JSON.stringify({ enabled: value }, null, 2), "utf-8");
}
/** 当前是否开着框架开发模式。首次访问时从磁盘惰性读一次。 */
function isFrameworkDevModeEnabled() {
	if (!loaded) {
		loaded = true;
		const path = devModeReadPath();
		enabled = path ? readDevModeSettingFile(path) : false;
	}
	return enabled;
}
/**
* 切换开关（主进程唯一的写入点）。
*
* **顺序不能反**：先落盘 → 读回核对 → 都成功才改内存。
* 任何一步失败都返回 `persisted: false` + `error`，且**状态保持原样**。
*/
function setFrameworkDevModeEnabled(value) {
	const next = value === true;
	const path = devModeSettingPath();
	if (!path) return {
		enabled,
		persisted: false,
		error: "框架开发模式：这个进程没有可落盘的设置位置，开关状态未改动"
	};
	try {
		writeDevModeSettingFile(path, next);
		if (readDevModeSettingFile(path) !== next) return {
			enabled,
			persisted: false,
			error: "框架开发模式：设置写入后读回不一致，开关状态未改动"
		};
	} catch (e) {
		logger.error("[devBackup] 框架模式设置落盘失败（开关状态保持不变）:", e);
		return {
			enabled,
			persisted: false,
			error: `框架开发模式设置落盘失败：${e instanceof Error ? e.message : String(e)}`
		};
	}
	enabled = next;
	loaded = true;
	logger.info(`[devBackup] framework dev mode -> ${enabled ? "on" : "off"}`);
	return {
		enabled,
		persisted: true
	};
}
/**
* 校验请求里的 `projectPath`：既允许"项目根下的项目"，也允许（**仅在框架模式开着时**）
* "框架根下的任意路径"。
*
* 这是 ai.ts / file.ts 共用的那一句 —— 框架模式没开时它**逐字节等价于**
* `assertWithinProject(baseDir, projectPath)`（同一句、同一个报错文案）。
*
* @param baseDir 项目根（框架外的沙箱边界）
* @param projectPath 渲染层 / AI 请求里带上来的路径
* @throws {Error} 越界时抛出
*/
function assertProjectPathAllowed(baseDir, projectPath) {
	if (isFrameworkDevModeEnabled() && isWithinProject(frameworkRoot(), projectPath)) return;
	assertWithinProject(baseDir, projectPath);
}

export { FRAMEWORK_ROOT_ENV, DEV_MODE_SETTING_ENV, devModeRequestSchema, enabled, loaded, looksLikeFrameworkCheckout, electronAppPath, sanitizeFrameworkRoot, frameworkRoot, isFrameworkRootPath, devModeSettingPath, devModeReadPath, readDevModeSettingFile, writeDevModeSettingFile, isFrameworkDevModeEnabled, setFrameworkDevModeEnabled, assertProjectPathAllowed };
