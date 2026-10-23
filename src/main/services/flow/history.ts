// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs_promises from "fs/promises";
import * as fs from "fs";
import { assertWithinProject } from "../infra/pathGuard";

var MAX_VERSIONS = 50;
function historyDir(projectPath) {
	return (0, path.join)(projectPath, ".qqbat", "history");
}
function sanitizeTimestamp(ts) {
	return ts.replace(/[:.]/g, "-");
}
var HistoryService = class {
	baseDir = "";
	setBaseDir(dir) {
		this.baseDir = dir;
	}
	/** 备份当前 flow.json 到 .qqbat/history/ */
	async backup(projectPath, schemaVersion = "1.0") {
		const dir = historyDir(projectPath);
		await (0, fs_promises.mkdir)(dir, { recursive: true });
		const ts = (/* @__PURE__ */ new Date()).toISOString();
		const fileName = `flow-${sanitizeTimestamp(ts)}.json`;
		const filePath = (0, path.join)(dir, fileName);
		const source = (0, path.join)(projectPath, ".qqbat", "flow.json");
		if (!(0, fs.existsSync)(source)) throw new Error("flow.json 不存在，无法备份");
		await (0, fs_promises.copyFile)(source, filePath);
		const entry = {
			version: schemaVersion,
			timestamp: ts,
			fileName,
			filePath,
			size: (await (0, fs_promises.readFile)(filePath)).length
		};
		await this.prune(projectPath);
		return entry;
	}
	/** 列出历史版本（按时间倒序） */
	async list(projectPath) {
		const dir = historyDir(projectPath);
		if (!(0, fs.existsSync)(dir)) return [];
		const historyFiles = (await (0, fs_promises.readdir)(dir)).filter((f) => f.startsWith("flow-") && f.endsWith(".json")).sort().reverse();
		const entries = [];
		for (const f of historyFiles) {
			const fp = (0, path.join)(dir, f);
			const stats = await (0, fs_promises.readFile)(fp);
			const tsStr = f.replace("flow-", "").replace(/\.json$/, "").replace(/-/g, ":").replace(/\./g, ".");
			entries.push({
				version: "1.0",
				timestamp: tsStr.replace(/T/, " ").replace(/\.\d+Z/, ""),
				fileName: f,
				filePath: fp,
				size: stats.length
			});
		}
		return entries;
	}
	/** 从历史版本恢复 */
	async restore(projectPath, fileName) {
		if (this.baseDir) assertWithinProject(this.baseDir, projectPath);
		const dir = historyDir(projectPath);
		const backupFile = (0, path.resolve)(dir, fileName);
		const rel = (0, path.relative)(dir, backupFile);
		if (rel === "" || rel.startsWith("..") || (0, path.isAbsolute)(rel)) throw new Error(`非法文件路径: ${fileName}`);
		if (!(0, fs.existsSync)(backupFile)) throw new Error(`历史版本不存在: ${fileName}`);
		try {
			await this.backup(projectPath);
		} catch {}
		const target = (0, path.join)(projectPath, ".qqbat", "flow.json");
		await (0, fs_promises.copyFile)(backupFile, target);
	}
	/** 读某个历史版本的 JSON 内容 */
	async read(projectPath, fileName) {
		const dir = historyDir(projectPath);
		const filePath = (0, path.resolve)(dir, fileName);
		const rel = (0, path.relative)(dir, filePath);
		if (rel === "" || rel.startsWith("..") || (0, path.isAbsolute)(rel)) throw new Error(`非法文件路径: ${fileName}`);
		return await (0, fs_promises.readFile)(filePath, "utf-8");
	}
	/** 清理超出版本限制的历史文件 */
	async prune(projectPath) {
		const dir = historyDir(projectPath);
		if (!(0, fs.existsSync)(dir)) return;
		const files = (await (0, fs_promises.readdir)(dir)).filter((f) => f.startsWith("flow-") && f.endsWith(".json")).sort().reverse();
		if (files.length <= MAX_VERSIONS) return;
		const toDelete = files.slice(MAX_VERSIONS);
		for (const f of toDelete) try {
			await (0, fs_promises.unlink)((0, path.join)(dir, f));
		} catch {}
	}
};
var historyService = new HistoryService();

export { MAX_VERSIONS, historyDir, sanitizeTimestamp, HistoryService, historyService };
