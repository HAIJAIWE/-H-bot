// @ts-nocheck
// 由 10/18 打包产物还原（chunk: pathGuard-xM0uqyDY.js）；见 _recovery/README-recovery.md
import * as path from "path";

/**
* 判断目标路径是否在项目根目录内。
* 通过 resolve 规范化后检查 relative 结果不以 `..` 开头且非绝对路径。
*
* @param projectRoot 项目根目录绝对路径
* @param targetPath 待检查路径（相对或绝对）
* @returns true 表示在项目内，false 表示越界
*/
function isWithinProject(projectRoot, targetPath) {
	const resolvedRoot = (0, path.resolve)(projectRoot);
	const resolvedTarget = (0, path.resolve)(resolvedRoot, targetPath);
	if (!(0, path.isAbsolute)(resolvedTarget)) return false;
	const rel = (0, path.relative)(resolvedRoot, resolvedTarget);
	if (rel === "") return true;
	return !rel.startsWith("..") && !(0, path.isAbsolute)(rel);
}
/**
* 断言目标路径在项目根目录内，否则抛出路径越界错误。
*
* @param projectRoot 项目根目录绝对路径
* @param targetPath 待检查路径（相对或绝对）
* @throws {Error} 路径越界时抛出
*/
function assertWithinProject(projectRoot, targetPath) {
	if (!isWithinProject(projectRoot, targetPath)) throw new Error(`路径越界：${targetPath} 不在项目 ${projectRoot} 内`);
}
/**
* 禁区**分两档** —— 这是 2026-10-15 复查时改的（原来 6 条一律拦，误伤了机器人项目）。
*
* ## 第一档：**永远拦**（项目里也拦）
*
* 这三样无论"谁的"目录都坏了回不来：
*   · `.git`          —— 仓库自己的历史；写坏 = 提交与回滚全没了
*   · `node_modules`  —— 依赖；改它 = 本机与别人机器上跑的不是同一份东西
*   · `.dev-backups`  —— 我们自己的回退点；改它 = 把回滚这条后路一起烧掉
*
* ## 第二档：**只在框架工作区拦**
*
* 这三样是**框架自己**的构建产物。用户完全可能在**自己的机器人项目**里
* 有一个 `dist/` / `out/` / `release-xxx/`（打包产物、数据目录）——
* 那是他的目录，拦它属于误伤，还会让"模式关着时行为与从前逐字节一致"这条**假成立**
* （关着也变了）。
*   · `release*`（目录） —— 安装包产物（release / release-new / release-hbot…）
*   · `out`           —— 构建产物（既是 electron 入口，也是代码生成的落点）
*   · `dist`          —— 构建产物
*
* ## 判据
*
* 按**路径段**而不是字符串前缀：`src/main/foo/node_modules/x.js` 这种嵌在深处的
* 依赖目录同样要拦（只匹配第一段会漏）。
*/
var ALWAYS_FORBIDDEN_SEGMENT_NAMES = /* @__PURE__ */ new Set([
	".git",
	"node_modules",
	".dev-backups"
]);
/** 只在**框架工作区**（访问根 = 框架根）才算禁区的段名 */
var FRAMEWORK_ONLY_FORBIDDEN_SEGMENT_NAMES = /* @__PURE__ */ new Set(["out", "dist"]);
/** 把相对路径拆成段（统一分隔符；丢掉空段与 `.`） */
function pathSegments(relativePath) {
	return relativePath.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
}
/**
* 路径是否落在禁区里（按作用域）。
*
* `release*` 这条的判定多说一句：它按**目录段**匹配（非末段一律算目录；
* 末段只有在**没有扩展名**时才当成目录）。这样 `release-new/win-unpacked` 会被拦，
* 而同名的普通文件 `release.yml`（如 `.github/workflows/release.yml`）不会被误伤 ——
* 后者不是"目录产物"，拦它只会让人以为规则坏了。
*/
function isPermanentlyForbiddenPath(relativePath, scope = "project") {
	const segments = pathSegments(relativePath);
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i];
		const lower = segment.toLowerCase();
		if (ALWAYS_FORBIDDEN_SEGMENT_NAMES.has(lower)) return true;
		if (scope === "framework") {
			if (FRAMEWORK_ONLY_FORBIDDEN_SEGMENT_NAMES.has(lower)) return true;
			const isLast = i === segments.length - 1;
			if (/^release/i.test(segment) && (!isLast || !segment.includes("."))) return true;
		}
	}
	return false;
}
/** 报错文案里点名的清单（按作用域给全） */
function forbiddenNamesFor(scope) {
	const always = ".git / node_modules / .dev-backups";
	return scope === "framework" ? `${always} / release* / out / dist（框架工作区）` : `${always}（机器人项目里 out / dist / release* 不拦 —— 那是用户自己的目录）`;
}
/**
* 断言目标相对路径不在禁区里，否则抛出。
*
* 调用方传**相对于访问根**（项目根 / 框架根）的路径 —— 传绝对路径会把
* 根目录自身的段名也算进来（例如仓库恰好位于 `D:/out/` 下），那会误拦一切。
*
* ⚠️ **不查符号链接**：判定全是 `resolve/relative` 字符串比较，框架根内一个
* junction / symlink 指向外面仍会被当成"根内"。这是**沿用既有 pathGuard 的语义**
* （见下面 `assertExternalPathSafe` 的注释：真正的 symlink 防御要 `fs.realpathSync`，
* 那会改变所有既有调用方的口径）。要收紧就在落盘点加 realpath 再比一次。
*
* @param relativePath 相对于访问根的路径
* @param scope 访问根是"机器人项目"还是"框架工作区"（默认 project）
* @throws {Error} 命中禁区时抛出
*/
function assertNotForbiddenPath(relativePath, scope = "project") {
	if (isPermanentlyForbiddenPath(relativePath, scope)) throw new Error(`禁止访问：${relativePath} 属于禁区（${forbiddenNamesFor(scope)}）`);
}
/**
* 安全拼接路径：先校验 relativePath 不越界，再返回 resolve 结果。
*
* @param projectRoot 项目根目录绝对路径
* @param relativePath 项目内的相对路径
* @returns 拼接后的绝对路径
* @throws {Error} 路径越界时抛出
*/
function joinSafe(projectRoot, relativePath) {
	assertWithinProject(projectRoot, relativePath);
	return (0, path.resolve)(projectRoot, relativePath);
}
/**
* 断言文件路径在指定基准目录内，且后缀在白名单中。
*
* 用于校验项目数据文件（如 dbPath），防止越界读取/写入任意文件。
* 校验三层：
*   1. 非空字符串 + 必须绝对路径
*   2. resolve 规范化后 relative 到 basePath 不以 `..` 开头（防路径穿越）
*   3. 后缀在白名单中（防读取非数据文件类型）
*
* @param basePath 基准目录（如 process.cwd() 或项目根路径）
* @param filePath 待校验文件绝对路径
* @param allowedExts 允许的后缀列表（如 ['.db', '.sqlite']）
*/
function assertPathWithinBase(basePath, filePath, allowedExts) {
	if (!filePath || typeof filePath !== "string") throw new Error("文件路径不能为空");
	if (!(0, path.isAbsolute)(filePath)) throw new Error("文件路径必须是绝对路径");
	const normalized = (0, path.resolve)(filePath);
	const rel = (0, path.relative)(basePath, normalized);
	if (rel.startsWith("..") || (0, path.isAbsolute)(rel)) throw new Error(`路径越界：${filePath} 不在 ${basePath} 内`);
	const lower = normalized.toLowerCase();
	if (!allowedExts.some((ext) => lower.endsWith(ext.toLowerCase()))) throw new Error(`不支持的文件类型：${filePath}（允许：${allowedExts.join(", ")}）`);
}
/**
* 系统关键目录黑名单（小写），用于拒绝写入/读取系统目录。
* Windows 与 POSIX 分别维护。
*/
var SYSTEM_DIR_BLACKLIST = process.platform === "win32" ? [
	"c:\\windows",
	"c:\\program files",
	"c:\\program files (x86)",
	"c:\\programdata",
	"c:\\boot"
] : [
	"/etc",
	"/usr",
	"/bin",
	"/sbin",
	"/boot",
	"/dev",
	"/proc",
	"/sys",
	"/root",
	"/lib",
	"/lib64"
];
/**
* 断言"这个绝对路径不是系统关键目录、也不是相对路径"。
*
* 从 {@link assertExternalPathSafe} 里抽出来单独导出，因为**目录**也适用这条规则，
* 但目录没有扩展名、套不进那个"后缀白名单"参数（例如 `docker:export` 的 `outputDir`
* 是目录，传 `allowedExts: []` 会永远抛"不支持的文件类型"）。
*
* 只做：非空 + 必须是绝对路径 + 系统目录黑名单。
* 不限制路径必须落在项目内 —— 导出到桌面是合法用法。
*
* @param targetPath 待校验的目录/文件绝对路径
* @param label 错误文案里的主语（保持调用方原有的报错措辞不变）
*/
function assertNotSystemPath(targetPath, label = "路径") {
	if (!targetPath || typeof targetPath !== "string") throw new Error(`${label}不能为空`);
	if (!(0, path.isAbsolute)(targetPath)) throw new Error("路径必须是绝对路径");
	const normalized = (0, path.resolve)(targetPath);
	const lower = normalized.toLowerCase();
	for (const sysDir of SYSTEM_DIR_BLACKLIST) if (lower === sysDir || lower.startsWith(sysDir + (process.platform === "win32" ? "\\" : "/"))) throw new Error(`禁止访问系统目录：${targetPath}`);
	return normalized;
}
/**
* 断言外部文件路径安全：白名单后缀 + 拒绝系统关键目录。
*
* 用于校验用户选择的导入/导出路径（允许任意合法用户目录，但防止
* 写入系统目录造成破坏，并限制后缀防止误操作）。
*
* 注意：本函数允许路径在 basePath 之外（用户可导出到桌面等任意位置），
* 仅做后缀与系统目录黑名单校验。`..` 段会被 resolve 自动消化，
* 因此不额外检查（符号链接穿越需 fs.realpathSync，属更高级防御，暂不处理）。
*
* @param filePath 待校验文件绝对路径
* @param allowedExts 允许的后缀列表（如 ['.json', '.csv']）
*/
function assertExternalPathSafe(filePath, allowedExts) {
	const lower = assertNotSystemPath(filePath, "文件路径").toLowerCase();
	if (!allowedExts.some((ext) => lower.endsWith(ext.toLowerCase()))) throw new Error(`不支持的文件类型：${filePath}（允许：${allowedExts.join(", ")}）`);
}
/**
* 可执行文件扩展名黑名单（小写）。
*
* `shell.openPath` 在 Windows 上会调用系统默认处理器，直接执行这些扩展名的文件
* 会带来安全风险（任意代码执行）。用于 `assertOpenPathSafe` 校验。
*/
var EXECUTABLE_EXTS = [
	".exe",
	".bat",
	".cmd",
	".com",
	".scr",
	".msi",
	".ps1",
	".sh",
	".bin",
	".run",
	".app",
	".action",
	".workflow"
];
/**
* 断言通过 `shell.openPath` 打开的路径安全。
*
* 用于 `docker:openFolder` / `project:openFolder` 等 IPC handler，防止：
*   1. 打开系统关键目录（C:\\Windows、/etc 等）
*   2. 直接执行可执行文件（.exe/.bat/.sh 等，shell.openPath 可触发系统默认处理器）
*   3. 相对路径（可能被构造为指向意外位置）
*
* 注意：本函数不限制路径必须在项目内（导出目录可在任意用户目录），
* 仅做系统目录黑名单 + 可执行扩展名黑名单校验。
*
* @param targetPath 待校验的目录/文件绝对路径
*/
function assertOpenPathSafe(targetPath) {
	if (!targetPath || typeof targetPath !== "string") throw new Error("路径不能为空");
	if (!(0, path.isAbsolute)(targetPath)) throw new Error("路径必须是绝对路径");
	const lower = (0, path.resolve)(targetPath).toLowerCase();
	for (const sysDir of SYSTEM_DIR_BLACKLIST) if (lower === sysDir || lower.startsWith(sysDir + (process.platform === "win32" ? "\\" : "/"))) throw new Error(`禁止打开系统目录：${targetPath}`);
	if (EXECUTABLE_EXTS.some((ext) => lower.endsWith(ext))) throw new Error(`禁止打开可执行文件：${targetPath}`);
}

export { isWithinProject, assertWithinProject, ALWAYS_FORBIDDEN_SEGMENT_NAMES, FRAMEWORK_ONLY_FORBIDDEN_SEGMENT_NAMES, pathSegments, isPermanentlyForbiddenPath, forbiddenNamesFor, assertNotForbiddenPath, joinSafe, assertPathWithinBase, SYSTEM_DIR_BLACKLIST, assertNotSystemPath, assertExternalPathSafe, EXECUTABLE_EXTS, assertOpenPathSafe };
