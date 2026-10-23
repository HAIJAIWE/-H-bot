// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as zlib from "zlib";
import * as os from "os";
import * as electron from "electron";
import { botManager } from "../bot/botManager";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import * as path from "path";
import { init_paths, userDataPath, userDataPathOrThrow, userDataRoot } from "../infra/paths";

/** 计算 CRC32 */
function crc32$1(buf) {
	let crc = 4294967295;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) crc = crc & 1 ? crc >>> 1 ^ 3988292384 : crc >>> 1;
	}
	return (crc ^ 4294967295) >>> 0;
}
/** 将 Date 转换为 DOS 时间格式 */
function dosTime$1(date) {
	return date.getSeconds() / 2 | 0 | date.getMinutes() << 5 | date.getHours() << 11;
}
function dosDate$1(date) {
	return date.getDate() | date.getMonth() + 1 << 5 | date.getFullYear() - 1980 << 9;
}
var ZipWriter$1 = class {
	entries = [];
	async addFile(name, data) {
		const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
		const now = /* @__PURE__ */ new Date();
		const crc = crc32$1(buf);
		const compressed = await new Promise((resolve, reject) => {
			const deflater = (0, zlib.createDeflateRaw)({ level: zlib.constants.Z_BEST_COMPRESSION });
			const chunks = [];
			deflater.on("data", (chunk) => chunks.push(chunk));
			deflater.on("end", () => resolve(Buffer.concat(chunks)));
			deflater.on("error", reject);
			deflater.end(buf);
		});
		this.entries.push({
			name: name.replace(/\\/g, "/"),
			buffer: buf,
			compressed,
			crc,
			dosTime: dosTime$1(now),
			dosDate: dosDate$1(now),
			compressedSize: compressed.length,
			uncompressedSize: buf.length
		});
	}
	/** 将 ZIP 写入输出流 */
	writeToStream(outputStream) {
		const localHeaders = [];
		const centralEntries = [];
		let offset = 0;
		for (const entry of this.entries) {
			const nameBuf = Buffer.from(entry.name, "utf-8");
			const localHeader = Buffer.alloc(30);
			localHeader.writeUInt32LE(67324752, 0);
			localHeader.writeUInt16LE(20, 4);
			localHeader.writeUInt16LE(0, 6);
			localHeader.writeUInt16LE(8, 8);
			localHeader.writeUInt16LE(entry.dosTime, 10);
			localHeader.writeUInt16LE(entry.dosDate, 12);
			localHeader.writeUInt32LE(entry.crc, 14);
			localHeader.writeUInt32LE(entry.compressedSize, 18);
			localHeader.writeUInt32LE(entry.uncompressedSize, 22);
			localHeader.writeUInt16LE(nameBuf.length, 26);
			localHeader.writeUInt16LE(0, 28);
			localHeaders.push(localHeader);
			localHeaders.push(nameBuf);
			localHeaders.push(entry.compressed);
			const centralHeader = Buffer.alloc(46);
			centralHeader.writeUInt32LE(33639248, 0);
			centralHeader.writeUInt16LE(20, 4);
			centralHeader.writeUInt16LE(20, 6);
			centralHeader.writeUInt16LE(0, 8);
			centralHeader.writeUInt16LE(8, 10);
			centralHeader.writeUInt16LE(entry.dosTime, 12);
			centralHeader.writeUInt16LE(entry.dosDate, 14);
			centralHeader.writeUInt32LE(entry.crc, 16);
			centralHeader.writeUInt32LE(entry.compressedSize, 20);
			centralHeader.writeUInt32LE(entry.uncompressedSize, 24);
			centralHeader.writeUInt16LE(nameBuf.length, 28);
			centralHeader.writeUInt16LE(0, 30);
			centralHeader.writeUInt16LE(0, 32);
			centralHeader.writeUInt16LE(0, 34);
			centralHeader.writeUInt16LE(0, 36);
			centralHeader.writeUInt32LE(0, 38);
			centralHeader.writeUInt32LE(offset, 42);
			centralEntries.push(centralHeader);
			centralEntries.push(nameBuf);
			offset += 30 + nameBuf.length + entry.compressedSize;
		}
		const centralSize = Buffer.concat(centralEntries).length;
		const centralOffset = Buffer.concat(localHeaders).length;
		const eocd = Buffer.alloc(22);
		eocd.writeUInt32LE(101010256, 0);
		eocd.writeUInt16LE(0, 4);
		eocd.writeUInt16LE(0, 6);
		eocd.writeUInt16LE(this.entries.length, 8);
		eocd.writeUInt16LE(this.entries.length, 10);
		eocd.writeUInt32LE(centralSize, 12);
		eocd.writeUInt32LE(centralOffset, 16);
		eocd.writeUInt16LE(0, 20);
		for (const buf of localHeaders) outputStream.write(buf);
		for (const buf of centralEntries) outputStream.write(buf);
		outputStream.write(eocd);
	}
};
/** 脱敏敏感字段 */
function desensitizeConfig(config) {
	const SENSITIVE_KEYS = /* @__PURE__ */ new Set([
		"apiKey",
		"appSecret",
		"token"
	]);
	const result = {};
	for (const [key, value] of Object.entries(config)) if (value !== null && typeof value === "object" && !Array.isArray(value)) result[key] = desensitizeConfig(value);
	else if (SENSITIVE_KEYS.has(key)) result[key] = "***";
	else result[key] = value;
	return result;
}
function collectEnvironment() {
	return {
		os: {
			platform: process.platform,
			arch: process.arch,
			release: os.release(),
			type: os.type(),
			version: os.version(),
			hostname: os.hostname(),
			cpus: os.cpus().length,
			totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
			freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`
		},
		node: {
			version: process.version,
			arch: process.arch
		},
		electron: { version: process.versions.electron ?? "unknown" },
		app: {
			name: electron.app.getName(),
			version: electron.app.getVersion(),
			userData: userDataRoot(electron.app) ?? "",
			logs: userDataPath("logs", electron.app) ?? ""
		}
	};
}
async function collectRuntimeStatus(projectPath) {
	let botStatus = { running: false };
	try {
		const status = botManager.getBotStatus(projectPath);
		if (status) botStatus = {
			running: status.status === "running",
			pid: status.pid ?? null,
			startedAt: status.startedAt ?? null,
			crashCount: 0,
			lastCrashTime: null,
			uptime: status.uptime ?? null
		};
	} catch {
		botStatus = {
			running: false,
			error: "无法获取 bot 状态"
		};
	}
	return { bot: botStatus };
}
async function collectAppLogs() {
	const logsDir = electron.app.getPath("logs");
	const files = /* @__PURE__ */ new Map();
	if (!(0, fs.existsSync)(logsDir)) return files;
	const entries = await (0, fs_promises.readdir)(logsDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const fullPath = (0, path.join)(logsDir, entry.name);
		try {
			const content = await (0, fs_promises.readFile)(fullPath);
			files.set(entry.name, content);
		} catch {}
	}
	return files;
}
/**
* 收集崩溃报告，同时覆盖两个来源：
*   1. JS 层崩溃（crashes/crash-*.json）—— 由 crashReporter.saveReport 写入，
*      记录 uncaughtException / unhandledRejection / captureException，内容可读
*   2. Electron 原生崩溃（crash-reports/*.dmp）—— 由 crashReporter.start() 写入，
*      记录 C++ 层崩溃（如 segfault），二进制 dump
*
* 修复：原实现只读 crash-reports/，导致 JS 层可读的 crash-*.json 不被诊断包收集。
* 现用前缀区分来源，避免文件名冲突，便于排查时分类查看。
*/
async function collectCrashReports() {
	const files = /* @__PURE__ */ new Map();
	await collectCrashFilesFromDir(userDataPathOrThrow("crashReports", electron.app), "js/", files);
	await collectCrashFilesFromDir(userDataPathOrThrow("nativeCrashDumps", electron.app), "native/", files);
	return files;
}
/** 遍历目录收集文件到 Map，文件名加前缀以区分来源 */
async function collectCrashFilesFromDir(dir, prefix, files) {
	if (!(0, fs.existsSync)(dir)) return;
	const entries = await (0, fs_promises.readdir)(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const fullPath = (0, path.join)(dir, entry.name);
		try {
			const content = await (0, fs_promises.readFile)(fullPath);
			files.set(`${prefix}${entry.name}`, content);
		} catch {}
	}
}
async function exportDiagnostics(projectPath, outputPath, onProgress) {
	const zip = new ZipWriter$1();
	function report(phase, message) {
		onProgress?.({
			phase,
			message
		});
	}
	try {
		report("collecting_logs", "正在收集日志...");
		const logFiles = await collectAppLogs();
		for (const [name, content] of logFiles) zip.addFile(`app-logs/${name}`, content);
		report("collecting_logs", `已收集 ${logFiles.size} 个日志文件`);
		report("collecting_config", "正在收集项目配置...");
		const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
		if ((0, fs.existsSync)(configPath)) {
			const raw = await (0, fs_promises.readFile)(configPath, "utf-8");
			const desensitized = desensitizeConfig(JSON.parse(raw));
			await zip.addFile("project-config.json", JSON.stringify(desensitized, null, 2));
		}
		report("collecting_config", "已完成配置脱敏");
		report("collecting_flow", "正在收集流程数据...");
		const flowPath = (0, path.join)(projectPath, ".qqbat", "flow.json");
		if ((0, fs.existsSync)(flowPath)) {
			const flowContent = await (0, fs_promises.readFile)(flowPath, "utf-8");
			await zip.addFile("flow.json", flowContent);
		}
		report("collecting_flow", "已完成流程数据收集");
		report("collecting_env", "正在收集环境信息...");
		const envInfo = collectEnvironment();
		await zip.addFile("environment.json", JSON.stringify(envInfo, null, 2));
		report("collecting_env", "已完成环境信息收集");
		report("collecting_runtime", "正在收集运行状态...");
		const runtimeStatus = await collectRuntimeStatus(projectPath);
		await zip.addFile("runtime-status.json", JSON.stringify(runtimeStatus, null, 2));
		report("collecting_runtime", "已完成运行状态收集");
		report("collecting_crashes", "正在收集崩溃报告...");
		const crashFiles = await collectCrashReports();
		for (const [name, content] of crashFiles) await zip.addFile(`crashes/${name}`, content);
		report("collecting_crashes", `已收集 ${crashFiles.size} 个崩溃报告`);
		report("packaging", "正在压缩打包...");
		await new Promise((resolve, reject) => {
			const ws = (0, fs.createWriteStream)(outputPath);
			ws.on("finish", resolve);
			ws.on("error", reject);
			zip.writeToStream(ws);
			ws.end();
		});
		const fileStat = await (0, fs_promises.stat)(outputPath);
		report("done", `诊断包已导出: ${outputPath}`);
		return {
			outputPath,
			fileSize: fileStat.size
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		onProgress?.({
			phase: "error",
			message,
			error: message
		});
		throw e;
	}
}

export { crc32$1, dosTime$1, dosDate$1, ZipWriter$1, desensitizeConfig, collectEnvironment, collectRuntimeStatus, collectAppLogs, collectCrashReports, collectCrashFilesFromDir, exportDiagnostics };
