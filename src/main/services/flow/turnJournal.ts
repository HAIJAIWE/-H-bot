// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/flow/turnJournal.ts），只保证语法/行为，类型待补。
import * as require_logger from '../infra/logger';
import * as require_pathGuard from '../infra/pathGuard';

import { joinSafe } from '../pathGuard';
import { logger } from '../infra/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fs_promises from 'node:fs/promises';
/**
 * 逐文件的行数变化（readTurn 里算出来的预览，turnProjection 直接转发给界面）。
 * 形状见 readTurn 里 changes.push({path, kind, added, removed, exact})。
 */
export interface TurnFileChange {
	path: string;
	/** added = 这一轮新建；removed = 这一轮删掉；modified = 改过（行数变化见 added/removed） */
	kind: 'added' | 'removed' | 'modified';
	added: number;
	removed: number;
	/** 文件超过 MAX_DIFF_LINES 时不统计（数字为 0），界面显示"行数未统计"而不是假数字 */
	exact: boolean;
}

/**
 * 一轮的元信息（listTurns 返回 / turnProjection 的输入）。
 * 形状见 listTurns 里 map 的 {id, startedAt, userMessage}。
 */
export interface TurnMeta {
	id: string;
	startedAt: string;
	/** 触发这一轮的用户那句话（截到 200 字） */
	userMessage: string;
}


/** 行数统计上限：超过就不统计（宁可标 exact:false，也不猜一个假数字） */
var MAX_DIFF_LINES = 2e3;
/**
* 行级增删计数（LCS）。**只数不猜**：
* · 任一侧超过 `MAX_DIFF_LINES` → 返回 exact:false、数字为 0（界面据此显示「行数未统计」）；
* · 完全相同 → 0/0（exact:true）。
*/
function lineDiffCounts(before, after) {
	/**
	* 拆成行。两条规矩都要，否则数字会系统性偏大：
	*   · `''` = **0 行**（不是 1 行）—— `''.split('\n')` 会得到 `['']`，那会让「新建文件」多算 1 行删除；
	*   · 结尾的换行不代表多一行 —— 否则每个以换行结尾的文件都多算 1 行。
	*/
	const splitLines = (s) => {
		if (s === "") return [];
		return (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
	};
	const a = splitLines(before);
	const b = splitLines(after);
	if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return {
		added: 0,
		removed: 0,
		exact: false
	};
	const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const lcs = dp[0][0];
	return {
		added: b.length - lcs,
		removed: a.length - lcs,
		exact: true
	};
}
/** 读一轮的预览信息（不改任何东西）。找不到返回 null。 */
/**
* **找出「这句话」对应的那一轮，以及之后的所有轮次**（给「编辑后从此处重开」用）。
*
* 轮次 id 可排序，listTurns 新的在前 —— 找到最近一次匹配后 slice(0, idx+1) 就是
* 「它和它之后的全部」。找不到（那一轮已被清掉）→ 返回空数组，调用方如实告知，不猜。
*/
async function turnsFromMessage(projectPath, userMessage) {
	const turns = await listTurns(projectPath);
	const idx = turns.findIndex((t) => t.userMessage === userMessage);
	if (idx < 0) return [];
	return turns.slice(0, idx + 1).map((t) => t.id);
}
async function readTurn(projectPath, turnId): Promise<{
	id: string;
	userMessage: string;
	restore: string[];
	remove: string[];
	data: boolean;
	changes: TurnFileChange[];
} | null> {
	try {
		const raw = await (0, fs_promises.readFile)(turnFile(projectPath, turnId), "utf-8");
		const j = JSON.parse(raw);
		const restore = [];
		const remove = [];
		const changes = [];
		for (const f of j.files ?? []) if (f.before === null) {
			remove.push(f.path);
			let after = "";
			try {
				after = await (0, fs_promises.readFile)(joinSafe(projectPath, f.path), "utf-8");
			} catch {
				after = "";
			}
			const d = lineDiffCounts("", after);
			changes.push({
				path: f.path,
				kind: "added",
				added: d.added,
				removed: d.removed,
				exact: d.exact
			});
		} else {
			restore.push(f.path);
			let after = "";
			let gone = false;
			try {
				after = await (0, fs_promises.readFile)(joinSafe(projectPath, f.path), "utf-8");
			} catch {
				gone = true;
			}
			if (gone) {
				const d = lineDiffCounts(f.before, "");
				changes.push({
					path: f.path,
					kind: "removed",
					added: d.added,
					removed: d.removed,
					exact: d.exact
				});
			} else {
				const d = lineDiffCounts(f.before, after);
				changes.push({
					path: f.path,
					kind: "modified",
					added: d.added,
					removed: d.removed,
					exact: d.exact
				});
			}
		}
		return {
			id: j.id,
			userMessage: j.userMessage,
			restore,
			remove,
			data: Boolean(j.dataSnapshot),
			changes
		};
	} catch (e) {
		logger.warn("[turnJournal] 读轮次预览失败:", turnId, e);
		return null;
	}
}
/** 单文件 before 内容的上限：超了就只记"改过"但不存内容（避免历史目录被大文件撑爆） */
var MAX_INLINE_BYTES = 524288;
/**
* `data/` 整目录快照的上限。
*
* 实测：真实项目 67 个文件 / 1.3 MB（很小），整目录快照完全划得来。
* 上限只是防「某个项目把日志/缓存堆进 data」把历史目录撑爆 —— 超了就**不快照并明确警告**，
* 而不是偷偷记一半（记一半的撤回是骗人）。
*/
var MAX_DATA_SNAPSHOT_BYTES = 134217728;
/** 正在进行中的轮次：projectPath → journal（桌面单用户，模块级即可） */
var RUNNING = /* @__PURE__ */ new Map();
function turnsDir(projectPath) {
	return (0, path.join)(projectPath, ".qqbat", "history", "turns");
}
function turnFile(projectPath, id) {
	return (0, path.join)(turnsDir(projectPath), id + ".json");
}
/** 轮次 id：时间戳 + 计数，**可排序**（取"最近一轮"要靠它） */
var seq = 0;
function nextId() {
	seq += 1;
	return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + "-" + seq;
}
/**
* 开始一轮：快照 flow.json。返回轮次 id。
*
* 快照失败（项目里还没有 flow.json）不算错误 —— 记 null，回滚时按"原本没有"处理。
*/
async function beginTurn(projectPath, userMessage) {
	const id = nextId();
	let flowBefore = null;
	const flowPath = (0, path.join)(projectPath, ".qqbat", "flow.json");
	try {
		if ((0, fs.existsSync)(flowPath)) flowBefore = await (0, fs_promises.readFile)(flowPath, "utf-8");
	} catch (e) {
		logger.warn("[turnJournal] 快照 flow.json 失败（按\"原本不存在\"处理）:", e);
	}
	RUNNING.set(projectPath, {
		id,
		startedAt: (/* @__PURE__ */ new Date()).toISOString(),
		userMessage: String(userMessage ?? "").slice(0, 200),
		flowBefore,
		files: []
	});
	return id;
}
/** 当前轮次 id（没有进行中的轮次时 null） */
function currentTurnId(projectPath) {
	return RUNNING.get(projectPath)?.id ?? null;
}
/**
 * 仅测试引用的自省口：看「当前这一轮记了什么」。
 *
 * 生产路径不需要它 —— 回滚读盘上的轮次文件、UI 走 listTurns。
 * 用例要断言「MCP 加入应用内已有轮次时，before 记到了哪一轮」，只能看内存里的进行中轮次。
 */
function peekTurn(projectPath) {
	return RUNNING.get(projectPath) ?? null;
}
/** 仅测试引用：清掉内存里的进行中轮次（用例间隔离）。生产里由 beginTurn/endTurn 成对管理。 */
function _resetRunningTurns() {
	RUNNING.clear();
}
/**
* **在落盘之前**记下某个文件的原内容（见文件头纪律 1、2）。
*
* 没有进行中的轮次时**静默跳过** —— 手工改文件、其它 IPC 路径写入都不该被日志机制挡住
* （日志是"能撤销"的增强，不是写入的前置条件）。
*/
async function recordFileBefore(projectPath, relPath) {
	const turn = RUNNING.get(projectPath);
	if (!turn) return;
	const clean = String(relPath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
	if (!clean) return;
	if (turn.files.some((f) => f.path === clean)) return;
	let before = null;
	let oversize = false;
	try {
		const abs = joinSafe(projectPath, clean);
		if ((0, fs.existsSync)(abs)) {
			if ((await (0, fs_promises.stat)(abs)).size > MAX_INLINE_BYTES) oversize = true;
			else before = await (0, fs_promises.readFile)(abs, "utf-8");
		}
	} catch (e) {
		logger.warn("[turnJournal] 记 before 失败，跳过这个文件:", relPath, e);
		return;
	}
	if (oversize) {
		logger.warn("[turnJournal] 文件过大，只记\"改过\"不存内容:", clean);
		return;
	}
	turn.files.push({
		path: clean,
		before
	});
}
/** 结束一轮：落盘到 .qqbat/history/turns/。没有进行中的轮次时返回 null。 */
/**
* 结束一轮：落盘到 .qqbat/history/turns/。没有进行中的轮次时返回 null。
*
* `hadChanges` = 这一轮**提出过操作**（哪怕流程要等用户确认之后才落盘）——
* 不能拿「flow.json 变没变」当判据：提案模式下它是**确认后**才写的，那时轮次早就结束了。
*/
/** 递归算目录大小（判断 data/ 是否超过快照上限） */
async function dirSize(dir) {
	let total = 0;
	for (const e of await (0, fs_promises.readdir)(dir, { withFileTypes: true })) {
		const p = (0, path.join)(dir, e.name);
		if (e.isDirectory()) total += await dirSize(p);
		else if (e.isFile()) total += (await (0, fs_promises.stat)(p)).size;
	}
	return total;
}
/**
* **运行前快照 `data/`** —— 撤回「运行」的唯一依据。
*
* 两种入口都要过这里：
*   · AI 调 run_bot / run_test：此时已有 AI 轮次，快照**挂到那一轮**上（撤回该轮连数据一起还原）；
*   · 用户手点【运行】：**没有** AI 轮次 → 这里自建一个「运行检查点」并立刻落盘，
*     于是「撤回上一步」对运行同样成立。
*
* 返回是否真的快照成功（失败/超限返回 false —— 调用方不该因此中止运行，只是这次运行不可撤回）。
*/
async function snapshotBeforeRun(projectPath, label) {
	const existed = RUNNING.has(projectPath);
	if (!existed) await beginTurn(projectPath, label);
	const turn = RUNNING.get(projectPath);
	if (!turn) return false;
	if (turn.dataSnapshot !== void 0) return turn.dataSnapshot !== null;
	turn.dataSnapshot = null;
	try {
		const src = (0, path.join)(projectPath, "data");
		if ((0, fs.existsSync)(src)) {
			const bytes = await dirSize(src);
			if (bytes > MAX_DATA_SNAPSHOT_BYTES) logger.warn("[turnJournal] data/ 超过快照上限，本次运行将无法撤回:", Math.round(bytes / 1024 / 1024), "MB");
			else {
				const dest = (0, path.join)(turnsDir(projectPath), turn.id, "data");
				await (0, fs_promises.cp)(src, dest, { recursive: true });
				turn.dataSnapshot = turn.id + "/data";
				logger.info("[turnJournal] 运行前已快照 data/:", Math.round(bytes / 1024), "KB");
			}
		}
	} catch (e) {
		logger.warn("[turnJournal] 运行前快照 data/ 失败（本次运行将无法撤回）:", e);
	}
	if (!existed) await endTurn(projectPath, { hadChanges: true });
	return turn.dataSnapshot !== null && turn.dataSnapshot !== void 0;
}
async function endTurn(projectPath, opts = {}) {
	const turn = RUNNING.get(projectPath);
	if (!turn) return null;
	RUNNING.delete(projectPath);
	if (turn.files.length === 0 && !opts.hadChanges && !turn.dataSnapshot) return turn;
	try {
		await (0, fs_promises.mkdir)(turnsDir(projectPath), { recursive: true });
		await (0, fs_promises.writeFile)(turnFile(projectPath, turn.id), JSON.stringify(turn, null, 2), "utf-8");
	} catch (e) {
		logger.warn("[turnJournal] 落盘轮次失败（不影响本轮结果）:", e);
	}
	return turn;
}
/** 列出已记录的历史轮次（新的在前） */
async function listTurns(projectPath) {
	const dir = turnsDir(projectPath);
	if (!(0, fs.existsSync)(dir)) return [];
	const out = [];
	for (const name of await (0, fs_promises.readdir)(dir)) {
		if (!name.endsWith(".json")) continue;
		try {
			const j = JSON.parse(await (0, fs_promises.readFile)((0, path.join)(dir, name), "utf-8"));
			out.push({
				id: j.id,
				startedAt: j.startedAt,
				userMessage: j.userMessage,
				fileCount: (j.files ?? []).length
			});
		} catch {}
	}
	return out.sort((a, b) => a.id < b.id ? 1 : -1);
}
/**
* 撤回某一轮：文件按 before 回滚，flow.json 还原。
*
* ⚠️ 与"版本历史"（history.ts）的分工：那个是**按时间戳的流程快照**，这个是**按轮次的整体回滚**。
*/
async function rollbackTurn(projectPath, turnId) {
	const raw = await (0, fs_promises.readFile)(turnFile(projectPath, turnId), "utf-8");
	const journal = JSON.parse(raw);
	const result = {
		turnId,
		restored: [],
		removed: [],
		flowSnapshot: null,
		restoredData: false
	};
	for (const f of journal.files ?? []) {
		let abs;
		try {
			abs = joinSafe(projectPath, f.path);
		} catch {
			logger.warn("[turnJournal] 回滚时路径越界，跳过:", f.path);
			continue;
		}
		if (f.before === null) {
			if ((0, fs.existsSync)(abs)) {
				await (0, fs_promises.rm)(abs, { force: true });
				result.removed.push(f.path);
			}
		} else {
			await (0, fs_promises.writeFile)(abs, f.before, "utf-8");
			result.restored.push(f.path);
		}
	}
	result.flowSnapshot = journal.flowBefore;
	/**
	* ★ **连带还原玩家数据**（2026-10-15，用户原话「撤回本来就是撤回上一步的操作」）。
	*
	* 运行（run_bot / run_test）会真的执行流程、可能写 `data/` —— 那部分不在 `files` 镜像里
	* （镜像只覆盖 AI 写的文件）。所以运行前打了整目录快照，这里整目录还原。
	* 顺序：先删目录再拷回 —— 这样「快照里有、现在被删掉的文件」也能一起回来。
	*/
	if (journal.dataSnapshot) {
		const snap = (0, path.join)(projectPath, ".qqbat", "history", "turns", journal.dataSnapshot);
		if ((0, fs.existsSync)(snap)) {
			const dataDir = (0, path.join)(projectPath, "data");
			await (0, fs_promises.rm)(dataDir, {
				recursive: true,
				force: true
			});
			await (0, fs_promises.cp)(snap, dataDir, { recursive: true });
			result.restoredData = true;
			logger.info("[turnJournal] 已连带还原玩家数据:", journal.dataSnapshot);
		} else logger.warn("[turnJournal] 数据快照缺失，跳过还原（文件部分已还原）:", journal.dataSnapshot);
	}
	await (0, fs_promises.rm)(turnFile(projectPath, turnId), { force: true });
	return result;
}


export { lineDiffCounts, turnsFromMessage, readTurn, turnsDir, turnFile, nextId, beginTurn, currentTurnId, peekTurn, _resetRunningTurns, recordFileBefore, dirSize, snapshotBeforeRun, endTurn, listTurns, rollbackTurn, MAX_DIFF_LINES, MAX_INLINE_BYTES, MAX_DATA_SNAPSHOT_BYTES, RUNNING, seq };
