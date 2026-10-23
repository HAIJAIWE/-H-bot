// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import { notifyDataChanged, registerBridgePort, removeBridgePort, startFileWatcher, stopFileWatcher } from "../services/project/dataNotifyService";
import * as path from "path";

function registerDataNotifyIpc() {
	electron.ipcMain.handle("data:notifyChange", async (_e, projectPath, table, action, qq) => {
		try {
			notifyDataChanged(projectPath, table, action, qq);
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	});
	electron.ipcMain.handle("data:registerBridge", async (_e, projectPath, port) => {
		try {
			registerBridgePort(projectPath, port);
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	});
	electron.ipcMain.handle("data:unregisterBridge", async (_e, projectPath) => {
		try {
			removeBridgePort(projectPath);
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	});
	electron.ipcMain.handle("data:startWatch", async (_e, projectPath) => {
		try {
			startFileWatcher(projectPath, (filePath) => {
				notifyDataChanged(projectPath, path.basename(filePath, path.extname(filePath)), "refresh");
			});
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	});
	electron.ipcMain.handle("data:stopWatch", async (_e, projectPath) => {
		try {
			stopFileWatcher(projectPath);
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	});
}

export { registerDataNotifyIpc };
