// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { TRANSLATOR_BASE } from "../../../shared/config/ports";
import * as net from "net";

/**
* 查找空闲端口（从 startPort 开始，最多扫到 65535）。
*
* 默认起点是专属段的首个可用端口（43100 + 1），**不再是 8080**：8080 是全网通用的
* 开发/代理端口，本机实测会被第三方软件占用（见 docs/refactor 计划的 RT-02）。
*
* 注意：探测绑定 **127.0.0.1**（与运行时客户端同一地址族）。
* 若改成默认的 `::`（双栈），当另一个程序只占用了 127.0.0.1:<port> 时，
* 探测会"成功"、监听也能建立，但客户端（IPv4）实际连到的是对方 —— 实测
* 遇到过 8080 被 Steam web helper 占用导致的 404 死循环。
*/
async function findFreePort$1(startPort = TRANSLATOR_BASE + 1) {
	let port = startPort;
	while (port < 65535) {
		if (await isPortFree(port)) return port;
		port++;
	}
	throw new Error("无可用端口");
}
/**
* 判断 127.0.0.1:<port> 是否可绑定。
*
* 正确写法：占用错误（EADDRINUSE）是 **异步 'error' 事件**，
* `try { server.listen() } catch {}` 永远抓不到 —— 那样会几乎无条件
* 认为端口空闲。这里监听 'error' 事件来判定。
*/
function isPortFree(port) {
	return new Promise((resolve) => {
		const server = (0, net.createServer)();
		server.on("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve(true));
		});
	});
}

export { findFreePort$1, isPortFree };
