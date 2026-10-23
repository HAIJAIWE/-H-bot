// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as electron from "electron";

var captured = /* @__PURE__ */ new Map();
/**
* 在 `register()` 执行期间捕获所有 `ipcMain.handle(channel, fn)`。
*
* @param register 真正做注册的函数（`registerAllIpc` 的主体）
* @param ipcMainLike 默认用真的 ipcMain；测试传假对象
* @returns 本次捕获到的 channel → listener
*/
function captureIpcHandlers(register, ipcMainLike = electron.ipcMain) {
	const original = ipcMainLike.handle.bind(ipcMainLike);
	const found = /* @__PURE__ */ new Map();
	ipcMainLike.handle = (channel, listener) => {
		found.set(channel, listener);
		return original(channel, listener);
	};
	try {
		register();
	} finally {
		ipcMainLike.handle = original;
	}
	for (const [channel, listener] of found) captured.set(channel, listener);
	return found;
}
/**
* 构造一个**合成 event**。
*
* 绝大多数 handler 不看 event（形参写作 `_event`），但有几个会用它推 UI 进度
* （`BrowserWindow.fromWebContents(event.sender)`）。所以尽量给一个真实的 webContents；
* 没有窗口（无头模式 / 测试）就给 undefined —— 那些 handler 会自己报错，
* 我们把它**如实返回**，而不是假装成功。
*/
function syntheticEvent() {
	try {
		const win = electron.BrowserWindow.getAllWindows()[0];
		return { sender: win && !win.isDestroyed() ? win.webContents : void 0 };
	} catch {
		return { sender: void 0 };
	}
}
/**
* 调用一条已捕获的通道。
*
* **永不抛错** —— 失败以 `{ ok: false, error }` 返回，由调用方决定怎么呈现。
*/
async function invokeRegisteredChannel(channel, positional) {
	const listener = captured.get(channel);
	if (!listener) return {
		ok: false,
		error: `通道 ${channel} 没有注册（或捕获发生在注册之前）`
	};
	try {
		return {
			ok: true,
			value: await listener(syntheticEvent(), ...positional)
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

export { captured, captureIpcHandlers, syntheticEvent, invokeRegisteredChannel };
