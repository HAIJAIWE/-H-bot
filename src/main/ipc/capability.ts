// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import { probeCapabilitiesSchema } from "../schemas/capability";
import { tryIpcAsync } from "./_shared";
import { probeCapabilities } from "../services/bot/capabilityProbe";

function registerCapabilityIpc() {
	/**
	* capability:probe — 对当前项目执行一次能力自检。
	*
	* 只读：服务内部全程只发 GET，不会改动机器人状态。
	* 凭据不会出现在返回值里。
	*/
	electron.ipcMain.handle("capability:probe", async (_event, args) => {
		const parsed = probeCapabilitiesSchema.safeParse(args);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpcAsync(() => probeCapabilities(parsed.data.projectPath));
	});
}

export { registerCapabilityIpc };
