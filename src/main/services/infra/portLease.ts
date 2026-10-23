// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as fs from "fs";
import * as path from "path";
import { init_logger, logger } from "./logger";
import { init_paths, runtimeDir } from "./paths";

/**
* 端口租约（诊断用途，**不参与仲裁**）。
*
* ## 它能做什么
*
* 把「本进程当前占着哪些端口、分别属于哪个项目」写到
* `<userData>/runtime/ports.json`，用于排障：
*   用户报「43103 被谁占了」，打开这个文件就能看到是哪个项目、哪个 pid、什么时候起的。
*
* ## 它不能做什么（别指望）
*
* 它**不是**跨进程锁，也**不是**跨产品仲裁：另一个软件不会读它，本产品另一个进程
* （单实例锁已经拦掉了）也不依赖它。真正的防撞手段是
*   ① 专属端口段（@shared/config/ports）② 启动前探测 ③ 单实例锁。
* 租约只是让「事后追查」这件事有据可查。
*
* ## 失败策略
*
* 全程 `try/catch` 且静默：写不了租约文件不该影响机器人启动。
* 非 Electron 环境（没有 userData）直接跳过。
*/
/** 租约文件的固定文件名（放在 runtime/ 下） */
var LEASE_FILE = "ports.json";
/**
* 把当前占用情况整体覆盖写入租约文件（原子写：先写 .tmp 再 rename）。
*
* 传空数组等价于「本进程不再占任何端口」，会写一个空列表而不是删文件 ——
* 保留文件可以让排查者看见「跑过、但当时没有翻译器」。
*/
function writePortLeases(entries) {
	try {
		const dir = runtimeDir();
		if (!dir) return;
		(0, fs.mkdirSync)(dir, { recursive: true });
		const target = (0, path.join)(dir, LEASE_FILE);
		const payload = {
			pid: process.pid,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			leases: entries.filter((e) => Number.isInteger(e.port) && e.port > 0).map((e) => ({
				port: e.port,
				projectPath: e.projectPath
			})).sort((a, b) => a.port - b.port)
		};
		const tmp = target + ".tmp";
		(0, fs.writeFileSync)(tmp, JSON.stringify(payload, null, 2), "utf-8");
		(0, fs.renameSync)(tmp, target);
	} catch (e) {
		logger.warn("[portLease] 写租约文件失败（不影响运行）:", e);
	}
}
/** 删掉租约文件（进程退出时调用；失败静默） */
function clearPortLeases() {
	try {
		const dir = runtimeDir();
		if (!dir) return;
		(0, fs.unlinkSync)((0, path.join)(dir, LEASE_FILE));
	} catch {}
}

export { LEASE_FILE, writePortLeases, clearPortLeases };
