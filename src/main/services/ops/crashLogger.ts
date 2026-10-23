// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { collectOsString, crashReporter_exports, makeId, saveReport } from "./crashReporter";
import * as electron from "electron";

function initCrashLogger() {
	checkPreviousCrash();
	process.on("uncaughtException", (error) => {
		saveReport({
			id: makeId(),
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			type: "uncaughtException",
			message: error.message,
			stack: error.stack ?? "",
			version: electron.app.getVersion(),
			os: collectOsString(),
			extra: {
				node: process.version,
				electron: process.versions.electron ?? "unknown",
				pid: process.pid
			}
		}).catch(() => {});
		setTimeout(() => {
			process.exit(1);
		}, 1e3);
	});
	process.on("unhandledRejection", (reason) => {
		const message = reason instanceof Error ? reason.message : String(reason);
		const stack = reason instanceof Error ? reason.stack ?? "" : "";
		saveReport({
			id: makeId(),
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			type: "unhandledRejection",
			message,
			stack,
			version: electron.app.getVersion(),
			os: collectOsString(),
			extra: {
				node: process.version,
				electron: process.versions.electron ?? "unknown",
				pid: process.pid
			}
		}).catch(() => {});
	});
}
async function checkPreviousCrash() {
	try {
		const { getRecentReports } = await Promise.resolve().then(() => crashReporter_exports);
		const reports = await getRecentReports(1);
		if (reports.length > 0) showCrashNotification(reports[0].timestamp);
	} catch {}
}
function showCrashNotification(lastCrashTime) {
	try {
		const notification = new electron.Notification({
			title: "H Bot 制造",
			body: `H Bot 制造 上次异常退出（${formatTime(lastCrashTime)}），点击查看详情`,
			silent: false
		});
		notification.on("click", () => {
			const { BrowserWindow } = require("electron");
			const win = BrowserWindow.getAllWindows()[0];
			if (win) win.webContents.send("crash:showPanel");
		});
		notification.show();
	} catch {}
}
function formatTime(iso) {
	try {
		const d = new Date(iso);
		const pad = (n) => String(n).padStart(2, "0");
		return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	} catch {
		return iso;
	}
}

export { initCrashLogger, checkPreviousCrash, showCrashNotification, formatTime };
