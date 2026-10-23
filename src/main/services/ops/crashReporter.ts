// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as fs_promises from "fs/promises";
import * as zlib from "zlib";
import { __exportAll } from "../../../shared/runtime/rolldownShim";
import { init_paths, userDataPath, userDataPathOrThrow, userDataRoot } from "../infra/paths";
import { init_logger, logger } from "../infra/logger";

var crashReporter_exports = /* @__PURE__ */ __exportAll({
	captureException: () => captureException,
	clearReports: () => clearReports,
	collectOsString: () => collectOsString,
	exportDiagnostic: () => exportDiagnostic,
	getRecentReports: () => getRecentReports,
	makeId: () => makeId,
	readReport: () => readReport,
	saveReport: () => saveReport
});
var MAX_REPORTS = 20;
function getReportsDir() {
	const dir = userDataPathOrThrow("crashReports", electron.app);
	if (!(0, fs.existsSync)(dir)) try {
		require("fs").mkdirSync(dir, { recursive: true });
	} catch {}
	return dir;
}
function reportFilePath(id) {
	return (0, path.join)(getReportsDir(), `crash-${id}.json`);
}
function makeId() {
	const now = /* @__PURE__ */ new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
function collectOsString() {
	return `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`;
}
async function saveReport(report) {
	const dir = getReportsDir();
	if (!(0, fs.existsSync)(dir)) await (0, fs_promises.mkdir)(dir, { recursive: true });
	const filePath = reportFilePath(report.id);
	await (0, fs_promises.writeFile)(filePath, JSON.stringify(report, null, 2), "utf-8");
	await pruneOldReports();
}
async function pruneOldReports() {
	try {
		const dir = getReportsDir();
		if (!(0, fs.existsSync)(dir)) return;
		const jsonFiles = (await (0, fs_promises.readdir)(dir)).filter((f) => f.startsWith("crash-") && f.endsWith(".json")).sort().reverse();
		if (jsonFiles.length > MAX_REPORTS) {
			const toRemove = jsonFiles.slice(MAX_REPORTS);
			await Promise.all(toRemove.map((f) => (0, fs_promises.unlink)((0, path.join)(dir, f)).catch(() => {})));
		}
	} catch {}
}
function captureException(error, extra) {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack ?? "" : "";
	saveReport({
		id: makeId(),
		timestamp: (/* @__PURE__ */ new Date()).toISOString(),
		type: "captured",
		message,
		stack,
		version: electron.app.getVersion(),
		os: collectOsString(),
		extra: {
			...extra,
			node: process.version,
			electron: process.versions.electron ?? "unknown",
			pid: process.pid
		}
	}).catch(() => {});
}
async function getRecentReports(count) {
	try {
		const dir = getReportsDir();
		if (!(0, fs.existsSync)(dir)) return [];
		const jsonFiles = (await (0, fs_promises.readdir)(dir)).filter((f) => f.startsWith("crash-") && f.endsWith(".json")).sort().reverse();
		const limit = count ?? MAX_REPORTS;
		const targets = jsonFiles.slice(0, limit);
		const reports = [];
		for (const filename of targets) {
			const filePath = (0, path.join)(dir, filename);
			try {
				const content = await (0, fs_promises.readFile)(filePath, "utf-8");
				const parsed = JSON.parse(content);
				reports.push({
					id: parsed.id,
					timestamp: parsed.timestamp,
					type: parsed.type,
					message: parsed.message
				});
			} catch {}
		}
		return reports;
	} catch (e) {
		logger.warn("[crashReporter] 读取崩溃报告列表失败:", e);
		return [];
	}
}
async function readReport(id) {
	try {
		const dir = getReportsDir();
		const filePath = reportFilePath(id);
		const resolvedPath = (0, path.resolve)(filePath);
		const rel = (0, path.relative)(dir, resolvedPath);
		if (rel === "" || rel.startsWith("..") || (0, path.isAbsolute)(rel)) return null;
		const content = await (0, fs_promises.readFile)(filePath, "utf-8");
		return JSON.parse(content);
	} catch (e) {
		logger.warn("[crashReporter] 读取崩溃报告失败:", e);
		return null;
	}
}
async function clearReports() {
	try {
		const dir = getReportsDir();
		if (!(0, fs.existsSync)(dir)) return;
		const jsonFiles = (await (0, fs_promises.readdir)(dir)).filter((f) => f.startsWith("crash-") && f.endsWith(".json"));
		await Promise.all(jsonFiles.map((f) => (0, fs_promises.unlink)((0, path.join)(dir, f)).catch(() => {})));
	} catch {}
}
/** CRC32 */
function crc32(buf) {
	let crc = 4294967295;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) crc = crc & 1 ? crc >>> 1 ^ 3988292384 : crc >>> 1;
	}
	return (crc ^ 4294967295) >>> 0;
}
function dosTime(date) {
	return date.getSeconds() / 2 | 0 | date.getMinutes() << 5 | date.getHours() << 11;
}
function dosDate(date) {
	return date.getDate() | date.getMonth() + 1 << 5 | date.getFullYear() - 1980 << 9;
}
var ZipWriter = class {
	entries = [];
	async addFile(name, data) {
		const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
		const now = /* @__PURE__ */ new Date();
		const crc = crc32(buf);
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
			dosTime: dosTime(now),
			dosDate: dosDate(now),
			compressedSize: compressed.length,
			uncompressedSize: buf.length
		});
	}
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
async function exportDiagnostic(outputPath) {
	const zip = new ZipWriter();
	const reportsDir = getReportsDir();
	if ((0, fs.existsSync)(reportsDir)) {
		const jsonFiles = (await (0, fs_promises.readdir)(reportsDir)).filter((f) => f.startsWith("crash-") && f.endsWith(".json"));
		for (const name of jsonFiles) try {
			const content = await (0, fs_promises.readFile)((0, path.join)(reportsDir, name));
			await zip.addFile(`crash-reports/${name}`, content);
		} catch {}
	}
	const envInfo = {
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
		node: process.version,
		electron: process.versions.electron ?? "unknown",
		app: {
			name: electron.app.getName(),
			version: electron.app.getVersion(),
			userData: userDataRoot(electron.app) ?? "",
			logs: userDataPath("logs", electron.app) ?? ""
		},
		memory: process.memoryUsage(),
		uptime: process.uptime()
	};
	await zip.addFile("environment.json", JSON.stringify(envInfo, null, 2));
	const logsDir = electron.app.getPath("logs");
	if ((0, fs.existsSync)(logsDir)) {
		const logEntries = await (0, fs_promises.readdir)(logsDir, { withFileTypes: true });
		for (const entry of logEntries) {
			if (!entry.isFile()) continue;
			try {
				const content = await (0, fs_promises.readFile)((0, path.join)(logsDir, entry.name));
				await zip.addFile(`app-logs/${entry.name}`, content);
			} catch {}
		}
	}
	await new Promise((resolve, reject) => {
		const ws = (0, fs.createWriteStream)(outputPath);
		ws.on("finish", resolve);
		ws.on("error", reject);
		zip.writeToStream(ws);
		ws.end();
	});
	return {
		outputPath,
		fileSize: (await (0, fs_promises.stat)(outputPath)).size
	};
}

export { crashReporter_exports, MAX_REPORTS, getReportsDir, reportFilePath, makeId, collectOsString, saveReport, pruneOldReports, captureException, getRecentReports, readReport, clearReports, crc32, dosTime, dosDate, ZipWriter, exportDiagnostic };
