// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import * as node_path from "node:path";
import { frameworkRoot, isFrameworkDevModeEnabled } from "./devMode";
import * as node_fs from "node:fs";
import * as node_fs_promises from "node:fs/promises";
import { init_logger, logger } from "../infra/logger";
import { assertNotForbiddenPath, isWithinProject } from "../infra/pathGuard";

/** 回退点根目录名（禁区清单里也有它，两处必须一致） */
var DEV_BACKUPS_DIR = ".dev-backups";
/** 每个回退点里的清单文件名 */
var MANIFEST_FILE = ".manifest.json";
/**
* 回退点**保留上限**：只留最近这么多份，超出的在每次写之后删掉最老的。
*
* 为什么必须有：一次写 = 一份原内容，框架模式下的密集改动会**无上限增长**，
* 最后就是"谁也不敢开这个模式"（Lead 2026-10-15 定的）。100 份 ≈ 够回退一整天的密集改动。
*
* ⚠️ 清理**只在写入路径**做（见 backupBeforeWrite），**不在 createRevision 里** ——
* 否则"回滚一个最老的回退点"时，回滚前那次备份可能把**正在恢复的**那份删掉，
* 于是 restore 走到一半源文件没了（半还原）。回滚路径只增不减，最多比上限多 1 份。
*/
var MAX_BACKUP_REVISIONS = 100;
/** `file:restoreDevBackup` 的载荷（放这里，避免动 schemas/ 目录） */
var restoreRequestSchema = z.object({
	/** 回退点 id（`.dev-backups/` 下的一级目录名） */
	revisionId: z.string().min(1).max(80),
	/** 只恢复其中一条（不传 = 恢复整个回退点） */
	relativePath: z.string().min(1).max(1024).optional()
});
/** 备份目录根：`<框架根>/.dev-backups` */
function backupsRoot() {
	return (0, node_path.join)(frameworkRoot(), DEV_BACKUPS_DIR);
}
/** 进程内自增，保证临时名唯一（与 fileOps.atomicWrite 同一套理由） */
var tmpSeq = 0;
/** 生成时间戳 id：`2026-10-15T15-30-00-123Z`（冒号/点在 Windows 上是非法文件名字符） */
function timestampId(now = /* @__PURE__ */ new Date()) {
	return now.toISOString().replace(/[:.]/g, "-");
}
/**
* 回退点 id 必须是**唯一**且**字典序 = 时间序**的。
*
* 为什么要后者：保留策略按 id 排序删"最老的"，回退点列表也按 id 排序。
* ⚠️ 原来撞车时补的是 `${base}-${n}` —— 而 `'-'` 的码点小于 base 结尾的 `'Z'`，
* 于是 `...Z-2` **排在** `...Z` **前面**：同毫秒的第二份会被当成"更老"的，
* 清理时删错人、列表顺序也反了（2026-10-15 写保留策略的用例时抓到）。
* 现在补的是**数字**后缀（`'0'-'9'` > `'Z'`），且记住上一个 id 保证严格递增
* （连时钟回拨也不会退序）。
*/
var lastRevisionId = "";
var revisionTick = 0;
function uniqueRevisionId(root) {
	for (let attempt = 0; attempt < 1e3; attempt += 1) {
		const id = `${timestampId()}${revisionTick > 0 ? String(revisionTick).padStart(4, "0") : ""}`;
		revisionTick += 1;
		if (id > lastRevisionId && !(0, node_fs.existsSync)((0, node_path.join)(root, id))) {
			lastRevisionId = id;
			return id;
		}
	}
	revisionTick += 1;
	const forced = `${lastRevisionId}${String(revisionTick).padStart(8, "0")}`;
	lastRevisionId = forced;
	return forced;
}
/** 把相对路径切成段（只接受正斜杠形式） */
function segmentsOf(relPath) {
	return relPath.split("/").filter((s) => s !== "" && s !== ".");
}
/** 原子替换：先写临时文件再 rename（同 fileOps.atomicWrite 的理由） */
async function copyAtomic(src, dest) {
	tmpSeq += 1;
	const tmp = `${dest}.${process.pid}.${tmpSeq}.restore.tmp`;
	await (0, node_fs_promises.copyFile)(src, tmp);
	try {
		await (0, node_fs_promises.rename)(tmp, dest);
	} catch (e) {
		await (0, node_fs_promises.rm)(tmp, { force: true }).catch(() => {});
		throw e;
	}
}
/** 写一个回退点：把 items 里的"原内容"逐个复制进去，最后落清单 */
async function createRevision(kind, items) {
	const root = backupsRoot();
	const id = uniqueRevisionId(root);
	const dir = (0, node_path.join)(root, id);
	const entries = [];
	await (0, node_fs_promises.mkdir)(dir, { recursive: true });
	for (const item of items) {
		if (!item.existed) {
			entries.push({
				path: item.rel,
				existed: false,
				bytes: 0
			});
			continue;
		}
		const dest = (0, node_path.join)(dir, ...segmentsOf(item.rel));
		await (0, node_fs_promises.mkdir)((0, node_path.dirname)(dest), { recursive: true });
		const info = await (0, node_fs_promises.stat)(item.source);
		await (0, node_fs_promises.copyFile)(item.source, dest);
		entries.push({
			path: item.rel,
			existed: true,
			bytes: info.size
		});
	}
	await (0, node_fs_promises.writeFile)((0, node_path.join)(dir, MANIFEST_FILE), JSON.stringify({
		id,
		kind,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		entries
	}, null, 2), "utf-8");
	return id;
}
/**
* **写前强制备份**：把目标文件的当前内容存进一个新回退点。
*
* 只在框架根内使用；任何一步失败都向上抛 —— 调用方（fileOps.writeProjectFile）
* 因此在 mkdir/writeFile 之前就中断，这次写不会发生。
*
* @param fullPath 目标文件的绝对路径
* @returns 回退点 id
*/
async function backupBeforeWrite(fullPath) {
	const root = frameworkRoot();
	if (!isWithinProject(root, fullPath)) throw new Error("框架模式备份：目标不在框架根内，拒绝写入");
	const rel = (0, node_path.relative)(root, fullPath).split(node_path.sep).join("/");
	assertNotForbiddenPath(rel, "framework");
	const id = await createRevision("write", [{
		rel,
		source: fullPath,
		existed: (0, node_fs.existsSync)(fullPath)
	}]);
	await pruneOldRevisions();
	return id;
}
/**
* 按保留策略清理最老的回退点（**只在写入路径调用**，理由见 MAX_BACKUP_REVISIONS）。
*
* 永不抛错：删不掉就留着，下一次写再试。删掉的每一份都记一行日志
* （回退点被自动清掉这件事必须留痕，不能静默）。
*/
async function pruneOldRevisions() {
	try {
		const root = backupsRoot();
		const names = (await (0, node_fs_promises.readdir)(root)).filter((n) => !n.startsWith(".")).sort();
		const excess = names.length - MAX_BACKUP_REVISIONS;
		if (excess <= 0) return;
		for (const name of names.slice(0, excess)) {
			await (0, node_fs_promises.rm)((0, node_path.join)(root, name), {
				recursive: true,
				force: true
			});
			logger.info(`[devBackup] pruned old backup revision ${name}`);
		}
	} catch (e) {
		logger.warn("[devBackup] 清理旧回退点失败（保留策略未生效，不影响本次写）:", e);
	}
}
/**
* 回退点占用情况（界面显示"回退点 N/上限 · 占多少"）。
*
* 为什么要给界面看：无上限的回退点最终会让人不敢开这个模式（见 MAX_BACKUP_REVISIONS），
* 而"敢不敢开"取决于用户看得见它占了多少。
*/
async function backupsUsage() {
	const root = backupsRoot();
	let names;
	try {
		names = await (0, node_fs_promises.readdir)(root);
	} catch {
		return {
			count: 0,
			bytes: 0,
			limit: MAX_BACKUP_REVISIONS
		};
	}
	const revisions = names.filter((n) => !n.startsWith("."));
	let bytes = 0;
	for (const name of revisions) bytes += await dirSize((0, node_path.join)(root, name));
	return {
		count: revisions.length,
		bytes,
		limit: MAX_BACKUP_REVISIONS
	};
}
/** 目录总字节数（读不动的条目按 0 算 —— 占用显示不值得因此抛错） */
async function dirSize(dir) {
	let total = 0;
	let entries;
	try {
		entries = await (0, node_fs_promises.readdir)(dir);
	} catch {
		return 0;
	}
	for (const name of entries) {
		const full = (0, node_path.join)(dir, name);
		try {
			const info = await (0, node_fs_promises.stat)(full);
			if (info.isDirectory()) total += await dirSize(full);
			else total += info.size;
		} catch {}
	}
	return total;
}
/** 读一个回退点的清单；读不动时返回不完整条目（而不是抛错） */
async function readManifest(dir, id) {
	try {
		const obj = JSON.parse(await (0, node_fs_promises.readFile)((0, node_path.join)(dir, MANIFEST_FILE), "utf-8"));
		const entries = Array.isArray(obj.entries) ? obj.entries.filter((e) => e && typeof e.path === "string").map((e) => ({
			path: String(e.path),
			existed: e.existed === true,
			bytes: typeof e.bytes === "number" ? e.bytes : 0
		})) : [];
		return {
			id,
			createdAt: typeof obj.createdAt === "string" ? obj.createdAt : "",
			kind: obj.kind === "write" || obj.kind === "restore" ? obj.kind : "unknown",
			incomplete: false,
			entries
		};
	} catch (e) {
		logger.warn("[devBackup] 回退点清单读不动（标记为不完整）:", id, e);
		return {
			id,
			createdAt: "",
			kind: "unknown",
			incomplete: true,
			entries: []
		};
	}
}
/** 列出全部回退点（新的在前）。目录不存在 = 一个都没有，不算错误。 */
async function listDevBackups() {
	const root = backupsRoot();
	let names;
	try {
		names = await (0, node_fs_promises.readdir)(root);
	} catch {
		return [];
	}
	const out = [];
	for (const name of names) {
		if (name.startsWith(".")) continue;
		const dir = (0, node_path.join)(root, name);
		try {
			if (!(await (0, node_fs_promises.stat)(dir)).isDirectory()) continue;
		} catch {
			continue;
		}
		out.push(await readManifest(dir, name));
	}
	return out.sort((a, b) => b.id.localeCompare(a.id));
}
/** 回退点 id 只允许一级目录名（防 `../` 把恢复目标指到别处） */
function assertSafeRevisionId(id) {
	if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") throw new Error(`回退点 id 非法：${id}`);
	return id;
}
/**
* 从某个回退点恢复。
*
* 顺序（**不能反**）：
*   ① 把"当前内容"也备份成一个新回退点（否则回滚本身成了不可逆操作）
*   ② 逐条还原：原本存在 → 覆盖回去；原本不存在（那次写是新建）→ 删掉
*
* ⚠️ 要求框架模式**开着**才允许恢复：框架根下的写只有一条路（模式开 + 先备份），
* 不留第二条。模式关着时"改不了"也包括"改回去"，这保证规则①（关着时行为与从前一致）。
*/
async function restoreDevBackup(revisionId, relativePath) {
	if (!isFrameworkDevModeEnabled()) throw new Error("框架开发模式未开启，不能从回退点恢复（先在界面上打开它）");
	const root = frameworkRoot();
	const id = assertSafeRevisionId(revisionId);
	const dir = (0, node_path.join)(backupsRoot(), id);
	if (!(0, node_fs.existsSync)(dir)) throw new Error(`回退点不存在：${id}`);
	const revision = await readManifest(dir, id);
	if (revision.incomplete) throw new Error(`回退点不完整（清单缺失/读不动），拒绝恢复：${id}`);
	const wanted = relativePath ? revision.entries.filter((e) => e.path === relativePath.replace(/\\/g, "/")) : revision.entries;
	if (wanted.length === 0) throw new Error(`回退点 ${id} 里没有这个文件：${relativePath ?? ""}`);
	/**
	* 清单就在磁盘上，**是可以被手改的** —— 所以里面的每条路径都当"外部输入"重新校验，
	* 而且必须在**任何副作用之前**（第 ① 步的 existsSync 也算一次探路）。
	*/
	const targets = wanted.map((entry) => {
		assertNotForbiddenPath(entry.path, "framework");
		const target = (0, node_path.resolve)(root, ...segmentsOf(entry.path));
		if (!isWithinProject(root, target)) throw new Error(`回退点清单里的路径越界，拒绝恢复：${entry.path}`);
		const source = (0, node_path.join)(dir, ...segmentsOf(entry.path));
		if (entry.existed && !(0, node_fs.existsSync)(source)) throw new Error(`回退点不完整：缺少 ${entry.path} 的备份内容，拒绝恢复（未改动任何文件）`);
		return {
			entry,
			target,
			source
		};
	});
	const rollbackPoint = await createRevision("restore", targets.map(({ entry, target }) => ({
		rel: entry.path,
		source: target,
		existed: (0, node_fs.existsSync)(target)
	})));
	const restored = [];
	const removed = [];
	for (const { entry, target, source } of targets) {
		if (!entry.existed) {
			await (0, node_fs_promises.rm)(target, { force: true });
			removed.push(entry.path);
			continue;
		}
		await (0, node_fs_promises.mkdir)((0, node_path.dirname)(target), { recursive: true });
		await copyAtomic(source, target);
		restored.push(entry.path);
	}
	logger.info(`[devBackup] restored ${restored.length} file(s), removed ${removed.length} from ${id}`);
	return {
		revisionId: id,
		rollbackPoint,
		restored,
		removed
	};
}

export { DEV_BACKUPS_DIR, MANIFEST_FILE, MAX_BACKUP_REVISIONS, restoreRequestSchema, backupsRoot, tmpSeq, timestampId, lastRevisionId, revisionTick, uniqueRevisionId, segmentsOf, copyAtomic, createRevision, backupBeforeWrite, pruneOldRevisions, backupsUsage, dirSize, readManifest, listDevBackups, assertSafeRevisionId, restoreDevBackup };
