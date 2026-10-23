// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/threads.ts），只保证语法/行为，类型待补。
import * as require_historyStore from './historyStore';

import { clearHistoryFile, historyFilePath, loadHistory } from './historyStore';
import * as node_path from 'node:path';
import * as node_crypto from 'node:crypto';
import * as node_fs from 'node:fs';
/**
* 老记忆（`.qqbat/ai-history.jsonl`）的线程 id。
*
* **不清不丢**：升级后它作为"最早的那条线程"出现在列表里，用户能点回去看。
*/
var DEFAULT_THREAD_ID = "default";
function threadsDir(projectPath) {
	return (0, node_path.join)(projectPath, ".qqbat", "ai-history");
}
/**
* 线程 id 会被拼进文件名 —— 必须白名单。
*
* 与 B 侧 sanitizeKey 同一个思路：`../../etc/passwd` 这种输入只会得到一个无害文件名。
*
* 合法 id（`[A-Za-z0-9_-]{1,64}`）**由渲染层生成**（形如 `t-<时间>-<随机>`）——
* 主进程不产 id，只负责"任何 id 都不会变成越界路径"。
*/
function sanitizeThreadId(threadId) {
	const t = String(threadId ?? "").trim();
	if (/^[A-Za-z0-9_-]{1,64}$/.test(t)) return t;
	return `h${(0, node_crypto.createHash)("sha1").update(t).digest("hex").slice(0, 16)}`;
}
/** 线程 → 记忆文件路径。`default` 指回老文件（兼容升级前的历史） */
function threadFile(projectPath, threadId) {
	if (!threadId || threadId === "default") return historyFilePath(projectPath);
	return (0, node_path.join)(threadsDir(projectPath), `${sanitizeThreadId(threadId)}.jsonl`);
}
/** 标题：第一条用户消息的首行，截断；没有用户消息就用时间 */
function titleOf(entries, fallbackAt) {
	const first = entries.find((e) => e.role === "user" && e.content.trim());
	if (!first) return new Date(fallbackAt).toLocaleString();
	const line = first.content.trim().split("\n")[0]?.trim() ?? "";
	return line.length > 28 ? `${line.slice(0, 28)}…` : line;
}
function infoOf(id, file) {
	try {
		const st = (0, node_fs.statSync)(file);
		if (!st.isFile()) return null;
		return {
			id,
			title: "",
			updatedAt: st.mtimeMs,
			messageCount: 0
		};
	} catch {
		return null;
	}
}
/**
* 列出该项目的全部任务线程，**按最后活动时间倒序**。
*
* 任何单个文件读不出来（损坏/权限）都只跳过它 —— 列表不能因为一条坏记忆整个消失。
*/
async function listThreads(projectPath) {
	const found = [];
	const legacy = historyFilePath(projectPath);
	if ((0, node_fs.existsSync)(legacy)) {
		const info = infoOf(DEFAULT_THREAD_ID, legacy);
		if (info) found.push(info);
	}
	const dir = threadsDir(projectPath);
	if ((0, node_fs.existsSync)(dir)) {
		let names = [];
		try {
			names = (0, node_fs.readdirSync)(dir).filter((f) => f.endsWith(".jsonl"));
		} catch {
			names = [];
		}
		for (const name of names) {
			const info = infoOf(name.slice(0, -6), (0, node_path.join)(dir, name));
			if (info) found.push(info);
		}
	}
	const out = [];
	for (const t of found) try {
		const entries = await loadHistory(projectPath, threadFile(projectPath, t.id));
		out.push({
			...t,
			messageCount: entries.length,
			title: titleOf(entries, t.updatedAt)
		});
	} catch {
		out.push(t);
	}
	out.sort((a, b) => b.updatedAt - a.updatedAt);
	return out;
}
/** 忘掉一条线程（清空它的记忆文件；线程本身随之从列表消失） */
async function clearThread(projectPath, threadId) {
	await clearHistoryFile(projectPath, threadFile(projectPath, threadId));
}


export { threadsDir, sanitizeThreadId, threadFile, titleOf, infoOf, listThreads, clearThread, DEFAULT_THREAD_ID };
