// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as http from "http";
import * as path from "path";
import * as fs from "fs";

var bridgePorts = /* @__PURE__ */ new Map();
function registerBridgePort(projectPath, port) {
	bridgePorts.set(projectPath, port);
}
function removeBridgePort(projectPath) {
	bridgePorts.delete(projectPath);
}
function notifyDataChanged(projectPath, table, action, qq) {
	const port = bridgePorts.get(projectPath);
	if (port) {
		const postData = JSON.stringify({
			table,
			action,
			qq
		});
		const req = http.request({
			hostname: "localhost",
			port,
			path: "/data_changed",
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(postData)
			}
		});
		req.on("error", () => {
			bridgePorts.delete(projectPath);
		});
		req.write(postData);
		req.end();
	}
}
var watchers = /* @__PURE__ */ new Map();
function startFileWatcher(projectPath, callback) {
	const existing = watchers.get(projectPath);
	if (existing) {
		try {
			existing.close();
		} catch {}
		watchers.delete(projectPath);
	}
	const dataDir = path.join(projectPath, "data");
	if (!fs.existsSync(dataDir)) return;
	const watcher = fs.watch(dataDir, { recursive: true }, (eventType, filename) => {
		if (filename && (filename.endsWith(".db") || filename.endsWith(".json") || filename.endsWith(".yaml") || filename.endsWith(".yml"))) callback(path.join(dataDir, filename));
	});
	watchers.set(projectPath, watcher);
}
function stopFileWatcher(projectPath) {
	const watcher = watchers.get(projectPath);
	if (watcher) {
		watcher.close();
		watchers.delete(projectPath);
	}
}

export { bridgePorts, registerBridgePort, removeBridgePort, notifyDataChanged, watchers, startFileWatcher, stopFileWatcher };
