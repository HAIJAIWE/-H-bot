// @ts-nocheck
// 由 10/18 打包产物还原（chunk: standalone.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { startHeadless } from "./headlessAssembly";
import { logger } from "../services/infra/logger";
import { onBotLog, onNodeEvent } from "../services/runner/runtimeEvents";

/**
* 独立（headless）运行时入口 —— Docker / SSH 部署用
*
* 启动的是**完整一条链路**（与桌面版同构）：
*   eventBus（OneBot v11 网关本体）→ 官方适配器 → FlowRuntime（解释执行 flow.json）
*
* ⚠️ 历史坑（2026-10-01 修）：本文件曾经**只** `new FlowRuntime()`。它是 OneBot WS
* **客户端** —— 本机没有翻译器在监听时它永远连不上，于是"部署成功"的镜像一个消息都收不到。
* 现在装配统一走 `headlessAssembly.startHeadless`，并由
* `tests/guards/standaloneAssembly.test.ts` 钉住"必须到达 startTranslator 与 startOfficial"。
*
* 环境变量：
*   QQBOT_PROJECT_ROOT     项目目录（含 .qqbat/flow.json）。默认取第一个命令行参数或 cwd
*   QQBOT_BUS_HOST  翻译器地址。默认 127.0.0.1
*   QQBOT_BUS_PORT  翻译器端口。缺省时读 .qqbat/project.json 的 translatorPort
*   QQ_APP_ID / QQ_APP_SECRET / QQ_SANDBOX
*                        官方适配器凭证。env 优先于本地加密配置 —— 容器里没有 safeStorage，
*                        加密的 appSecret 在 Linux 上根本解不开
*   LOG_LEVEL              debug | info | warn | error（默认 info）
*
* 项目目录下的 `.env` 会在启动时载入（不覆盖已存在的环境变量），
* 因此 `docker run --env-file .env` 与镜像内自带的 `.env` 两种给值方式都有效。
*
* 用法：
*   node out/main/standalone.js /path/to/project
*/
async function main() {
	const projectRoot = (0, path.resolve)(process.env.QQBOT_PROJECT_ROOT || process.argv[2] || process.cwd());
	const host = process.env.QQBOT_BUS_HOST || "127.0.0.1";
	const flowPath = (0, path.join)(projectRoot, ".qqbat", "flow.json");
	if (!(0, fs.existsSync)(flowPath)) {
		logger.error(`[standalone] 找不到流程文件: ${flowPath}`);
		logger.error("[standalone] 请确认 QQBOT_PROJECT_ROOT 指向一个 qqbat 项目目录");
		process.exit(1);
	}
	try {
		JSON.parse((0, fs.readFileSync)(flowPath, "utf-8"));
	} catch (e) {
		logger.error(`[standalone] 流程文件不是合法 JSON: ${flowPath}`);
		logger.error(`[standalone] ${e instanceof Error ? e.message : String(e)}`);
		process.exit(1);
	}
	onBotLog((_projectPath, entry) => {
		const line = `[bot:${entry.level}] ${entry.message}`;
		if (entry.level === "error") logger.error(line);
		else if (entry.level === "warn") logger.warn(line);
		else logger.info(line);
	});
	onNodeEvent((_projectPath, event) => {
		if (event.status !== "error") return;
		logger.error(`[node-error] ${event.nodeId}: ${event.message ?? "(无说明)"}`);
	});
	logger.info(`[standalone] 项目目录: ${projectRoot}`);
	logger.info(`[standalone] 流程文件: ${flowPath}`);
	const handle = await startHeadless({
		projectPath: projectRoot,
		host,
		log: (line) => logger.info(line)
	});
	const st = handle.status();
	logger.info(`[standalone] 已就绪: translator=${st.translator} official=${st.official} runtime=${st.runtime}`);
	let stopping = false;
	const shutdown = (signal) => {
		if (stopping) return;
		stopping = true;
		logger.info(`[standalone] 收到 ${signal}，正在停止运行时...`);
		handle.stop().finally(() => process.exit(0));
	};
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
}
main().catch((e) => {
	logger.error(`[standalone] 启动失败: ${e instanceof Error ? e.stack : String(e)}`);
	process.exit(1);
});

export { main };
