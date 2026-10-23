// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as crypto from "crypto";
import * as child_process from "child_process";

var sessions = /* @__PURE__ */ new Map();
function createTerminal(projectPath) {
	const id = `term-${Date.now()}-${(0, crypto.randomUUID)().slice(0, 8)}`;
	const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
	const proc = (0, child_process.spawn)(shell, [], {
		cwd: projectPath,
		env: {
			...process.env,
			TERM: "xterm-256color"
		}
	});
	if (process.platform === "win32") proc.stdin?.write("chcp 65001>nul\r\n");
	sessions.set(id, {
		id,
		process: proc,
		projectPath,
		dataCallbacks: /* @__PURE__ */ new Set()
	});
	return id;
}
function writeTerminal(id, data) {
	const session = sessions.get(id);
	if (!session) throw new Error(`终端不存在: ${id}`);
	session.process.stdin?.write(data);
}
function killTerminal(id) {
	const session = sessions.get(id);
	if (!session) return;
	for (const cb of session.dataCallbacks) {
		session.process.stdout?.off("data", cb);
		session.process.stderr?.off("data", cb);
	}
	session.dataCallbacks.clear();
	session.process.kill("SIGTERM");
	session.sigkillTimer = setTimeout(() => {
		if (sessions.has(id)) {
			sessions.get(id)?.process.kill("SIGKILL");
			sessions.delete(id);
		}
	}, 3e3);
	session.process.once("exit", () => {
		if (session.sigkillTimer) {
			clearTimeout(session.sigkillTimer);
			session.sigkillTimer = void 0;
		}
		if (sessions.has(id)) sessions.delete(id);
	});
}
/**
* 终止所有终端会话（应用退出前清理使用）。
*
* 场景：Electron 默认不会在退出时杀死 spawn 的子进程，cmd.exe/bash 会残留为孤儿进程，
* 占用终端资源并可能持有文件句柄。before-quit 时遍历所有 session 调用 killTerminal，
* 确保每个 shell 子进程都收到 SIGTERM（Windows 上由 killTerminal 内部 kill 发送）。
*
* 注意：复制 keys 数组再迭代，避免 killTerminal 内部 sessions.delete 修改 Map 影响迭代。
*/
function killAllTerminals() {
	const ids = Array.from(sessions.keys());
	for (const id of ids) try {
		killTerminal(id);
	} catch {}
}
function registerTerminalDataHandler(id, callback) {
	const session = sessions.get(id);
	if (!session) return;
	const wrapped = (chunk) => callback(typeof chunk === "string" ? chunk : chunk.toString());
	session.dataCallbacks.add(wrapped);
	session.process.stdout?.on("data", wrapped);
	session.process.stderr?.on("data", wrapped);
}

export { sessions, createTerminal, writeTerminal, killTerminal, killAllTerminals, registerTerminalDataHandler };
