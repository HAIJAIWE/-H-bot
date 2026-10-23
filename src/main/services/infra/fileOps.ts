// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { frameworkRoot, isFrameworkDevModeEnabled, isFrameworkRootPath } from "../devBackup/devMode";
import * as path from "path";
import { backupBeforeWrite } from "../devBackup/devBackup";
import * as fs_promises from "fs/promises";
import { isAppManagedReadOnly } from "../../../shared/files/readOnlyPaths";
import { noteSecurityCriticalWrite } from "../devBackup/securityCriticalWrites";
import * as node_crypto from "node:crypto";
import { assertNotForbiddenPath, assertWithinProject, isWithinProject, joinSafe } from "./pathGuard";

/**
* 这次访问的**沙箱根**：有 baseDir 时它才是边界（项目模式 = 项目根目录 /
* 框架模式 = 框架根），没有时（测试、无 baseDir 的调用）以项目自身为根。
*
* 禁区判定必须相对**访问根**做：传绝对路径会把根目录自己的段名也算进来
* （仓库恰好叫 `out` / `dist` 时会误拦一切）。
*/
function accessRoot(projectPath, baseDir) {
	return baseDir ?? projectPath;
}
/**
* 禁区作用域：**访问根就是框架根**时是 `'framework'`，否则是 `'project'`。
*
* 这一层必须由 baseDir 决定（而不是"目标是否落在框架根内"）——
* dev 下 `projects/` 就在仓库里，用后者会把**机器人项目自己的** `dist/` 也判成框架产物。
*/
function scopeFor(baseDir) {
	return isFrameworkRootPath(baseDir) ? "framework" : "project";
}
/**
* 终点校验：命中**禁区**就拒绝。
*
* 分两档（见 pathGuard 的注释）：
*   · **永远拦**：`.git/`、`node_modules/`、`.dev-backups/` —— 项目里、框架里都坏不起；
*   · **只拦框架工作区**：`out/`、`dist/`、`release*`（目录） —— 那是**框架自己**的构建产物，
*     用户机器人项目里同名的目录不该被误伤（且那会让"模式关着时行为逐字节一致"假成立）。
*
* 位置说明：这是"终点"这一层（resolve 之后、syscall 之前），
* 所以 read / write / list 三条路都必然经过它，漏一条都过不了测试。
*/
function assertTargetAllowed(projectPath, fullPath, baseDir) {
	assertNotForbiddenPath((0, path.relative)(accessRoot(projectPath, baseDir), fullPath), scopeFor(baseDir));
}
/**
* 框架开发模式下的**写前强制备份**。
*
* 只对"框架根之内"的写生效（模式开着但写的是某个机器人项目时，目标不在框架根内，
* 走的仍是项目自己的那套回退）。备份失败 → 直接抛出 → 调用方的 writeFile 不会执行。
*/
async function backupFrameworkWrite(fullPath) {
	if (!isFrameworkDevModeEnabled()) return;
	if (!isWithinProject(frameworkRoot(), fullPath)) return;
	await backupBeforeWrite(fullPath);
}
/**
* 目标是**框架根内的安全关键文件**吗（改它 = 改护栏本身）。
*
* ⚠️ 判据是"**在框架根里**"+"命中清单"，两条都要：
*   · 机器人项目里恰好也有个 `src/main/ipc/file.ts`？那不是我们的护栏，**不该告警**
*     （只在框架根内判，与写前备份同一个条件）；
*   · 框架根里的普通文件（`src/renderer/...`）？命中不了清单，也不告警 ——
*     否则告警会变成噪音，用户就不看了。
*
* @returns 框架根相对路径，或 null（不在框架根内）
*/
function frameworkRelativePathOrNull(fullPath) {
	const root = frameworkRoot();
	if (!isWithinProject(root, fullPath)) return null;
	return (0, path.relative)(root, fullPath).split(path.sep).join("/");
}
async function readProjectFile(projectPath, relativePath, baseDir: string | undefined = undefined) {
	if (baseDir) assertWithinProject(baseDir, projectPath);
	const fullPath = joinSafe(projectPath, relativePath);
	assertTargetAllowed(projectPath, fullPath, baseDir);
	return (0, fs_promises.readFile)(fullPath, "utf-8");
}
/**
* 写一个文件。
*
* @returns **写道了护栏文件**时返回那条记录（界面据此给出与普通写入不同的警告），
*   否则 `null`。
*/
async function writeProjectFile(projectPath, relativePath, content, baseDir: string | undefined = undefined) {
	if (baseDir) assertWithinProject(baseDir, projectPath);
	const fullPath = joinSafe(projectPath, relativePath);
	assertTargetAllowed(projectPath, fullPath, baseDir);
	if (isAppManagedReadOnly(relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/"))) throw new Error(`拒绝写入应用管理的文件：${relativePath}（画布数据 / 项目元信息 / 生成物）。这些文件由应用自己整体重写（flow:save / codegen / 项目配置那几条通道），从 file:write 写进去既会被下一次保存冲掉，也绕开了它们各自的校验。要改流程请用画布；要改项目信息请在对应界面里改。`);
	await backupFrameworkWrite(fullPath);
	/**
	* 护栏可见性（2026-10-16）：目标在框架根内且命中安全关键清单 → 记一条日志 +
	* 记进"本次会话动过的护栏文件"，并把结果回给调用方（界面会警告）。
	*
	* 放在备份之后、真正落盘之前：备份失败时这次写根本没发生，不该报警。
	* 也**不做硬拦** —— 硬拦会让"修护栏自己的 bug"做不了，而备份已保证可逆。
	*/
	const fwRel = frameworkRelativePathOrNull(fullPath);
	const securityCritical = fwRel ? noteSecurityCriticalWrite(fwRel) : null;
	await (0, fs_promises.mkdir)((0, path.dirname)(fullPath), { recursive: true });
	await (0, fs_promises.writeFile)(fullPath, content, "utf-8");
	return securityCritical;
}
/**
* 原子写入：先写 .tmp 临时文件，再 rename 替换目标文件。
*
* 保证写入操作的原子性，避免因进程崩溃或异常导致目标文件被写一半。
* rename 在同一文件系统上是原子的（POSIX/Windows 均保证）。
*
* ## ⚠️ 契约：它**不做任何路径 / 禁区校验**（P1-10）
*
* 与上面的 `writeProjectFile`（带路径护栏 + 禁区 + 应用管理文件兜底）不同，这个函数只认
* **绝对路径**，剩下的全靠调用方 —— 路径从哪来、是不是项目内、是不是禁区，这里一概不管。
* 这是**有意的**：应用自己重写文件（画布存 flow.json、codegen 快照、项目元信息回写）
* 必须走得通，而那几处路径都是应用按固定规则拼出来的。
*
* 所以：**凡是路径可能来自用户输入 / 外部客户端，必须走 `writeProjectFile`**（那条路有护栏），
* 不许图省事直接 `atomicWrite`。`tests/guards/projectWritesViaFileOps.test.ts` 会在源码级
* 盯着这件事：新增的直写点必须登记形态，否则闸门红。
*
* 当前调用方（7 个模块，全部是应用自己的写者、路径由应用拼）：
*   · services/flow/flow.ts（flow.json 落盘 + 读档迁移回写）
*   · services/flow/codegen.ts（`src/plugins/generated/flow.generated.ts`）
*   · services/project/project.ts（flow.json / project.json / recent.json）
*   · ipc/project.ts、ipc/runtime.ts、ipc/official.ts（项目元信息回写）
*   · services/bot/botManager.ts、services/bot/officialConfigIo.ts（运行时配置回写）
*
* @param filePath 目标文件**绝对路径**（见下面的断言）
* @param content 文件内容（UTF-8 编码）
*/
/** 进程内自增，配合 pid + 随机后缀保证临时名唯一 */
var atomicWriteSeq = 0;
async function atomicWrite(filePath, content) {
	/**
	* 唯一的硬校验：**必须是绝对路径**。
	*
	* 为什么只加这一条（而不是「必须在项目内」）：本函数没有「哪个项目」这个上下文 ——
	* 它同时服务项目文件、appData、框架根，硬加项目归属判定会把既有调用方全变成噪音。
	* 但「相对路径」这一条**真实存在过**（本模块历史注释原话：`join('', '.qqbat', 'ai-history.jsonl')`
	* 会拼出相对路径，于是去写进程工作目录 —— 不是「没有文件」，是「写错地方」）。
	* 空 projectPath（开荒模式）就会造出这种路径：与其安静地写进 cwd，不如当场拒绝。
	*/
	if (!(0, path.isAbsolute)(filePath)) throw new Error(`atomicWrite 拒绝相对路径：${filePath}。调用方必须给出绝对路径（空 projectPath 会拼出相对路径，那会写进进程工作目录）。路径可能来自用户输入时请改用 writeProjectFile（它带路径护栏 + 禁区判定）。`);
	await (0, fs_promises.mkdir)((0, path.dirname)(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.${++atomicWriteSeq}.${(0, node_crypto.randomBytes)(4).toString("hex")}.tmp`;
	await (0, fs_promises.writeFile)(tmp, content, "utf-8");
	try {
		await (0, fs_promises.rename)(tmp, filePath);
	} catch (e) {
		await (0, fs_promises.rm)(tmp, { force: true }).catch(() => {});
		throw e;
	}
}
async function listProjectFiles(projectPath, relativeDir = "", baseDir: string | undefined = undefined) {
	if (baseDir) assertWithinProject(baseDir, projectPath);
	const fullPath = joinSafe(projectPath, relativeDir);
	assertTargetAllowed(projectPath, fullPath, baseDir);
	const entries = await (0, fs_promises.readdir)(fullPath, { withFileTypes: true });
	const results = [];
	for (const entry of entries) {
		const rel = relativeDir ? (0, path.join)(relativeDir, entry.name) : entry.name;
		const full = (0, path.join)(fullPath, entry.name);
		const s = await (0, fs_promises.stat)(full);
		results.push({
			name: entry.name,
			path: rel,
			isDirectory: entry.isDirectory(),
			size: s.size
		});
	}
	return results.sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
}

export { accessRoot, scopeFor, assertTargetAllowed, backupFrameworkWrite, frameworkRelativePathOrNull, readProjectFile, writeProjectFile, atomicWriteSeq, atomicWrite, listProjectFiles };
