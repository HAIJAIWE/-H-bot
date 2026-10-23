// @ts-nocheck
// 由 10/18 打包产物还原（chunk: standalone.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { init_logger } from "../services/infra/logger";
import { getTranslatorStatus, startTranslator, stopTranslator } from "../services/runner/eventBus";
import { startOfficial, stopOfficial } from "../services/official/ws";
import { BUS_WS_PATH } from "../../shared/protocol/bus";
import { FlowRuntime } from "./FlowRuntime";

/**
* 载入项目目录下的 `.env`（最小解析器，不引 dotenv）。
*
* 规则：
* · 整行 `#` 注释与空行跳过
* · 支持 `export KEY=VALUE` 前缀
* · 值两端**成对**的单/双引号会被去掉（只有一个引号则原样保留）
* · **不覆盖**已存在的环境变量（`env[key] !== undefined` 即视为已存在）
* · 非法键名（不是 `[A-Za-z_][A-Za-z0-9_]*`）跳过
*
* ⚠️ 刻意**不**剥行尾注释：appSecret 里出现 `#` 是合法的，按 `#` 截断会静默改坏凭据。
*
* @param env 目标环境表（默认 `process.env`，测试可注入）
* @returns 实际写入的键名清单（用于日志与断言，值不回显以免泄密）
*/
function loadDotEnvFile(projectPath, env = process.env) {
	const file = (0, path.join)(projectPath, ".env");
	if (!(0, fs.existsSync)(file)) return [];
	let text;
	try {
		text = (0, fs.readFileSync)(file, "utf-8");
	} catch {
		return [];
	}
	const applied = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const body = line.startsWith("export ") ? line.slice(7).trim() : line;
		const eq = body.indexOf("=");
		if (eq <= 0) continue;
		const key = body.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = body.slice(eq + 1).trim();
		const quote = value[0];
		if ((quote === "\"" || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
		if (env[key] !== void 0) continue;
		env[key] = value;
		applied.push(key);
	}
	return applied;
}
/** 从 `.qqbat/project.json` 读 translatorPort（与桌面版 botManager 同一来源） */
function readProjectTranslatorPort(projectPath) {
	const configPath = (0, path.join)(projectPath, ".qqbat", "project.json");
	if (!(0, fs.existsSync)(configPath)) return null;
	try {
		const raw = JSON.parse((0, fs.readFileSync)(configPath, "utf-8"));
		const port = Number(raw.translatorPort);
		return Number.isFinite(port) && port > 0 ? port : null;
	} catch {
		return null;
	}
}
/** 端口解析优先级：显式参数 > 环境变量 > project.json */
function resolveTranslatorPort(explicit, projectPath) {
	if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit;
	const fromEnv = Number((process.env.QQBOT_BUS_PORT ?? "").trim());
	if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
	return readProjectTranslatorPort(projectPath);
}
/**
* 拉起无头运行时（翻译器 + 官方适配器 + TS 运行时）。
*
* 抛错的只有"装配前置条件"（缺少项目路径、端口无法确定、翻译器起不来）——
* 官方适配器失败会被记录到日志但**不**抛出，与桌面版 `startBot` 的策略一致。
*/
async function startHeadless(opts) {
	const log = opts.log ?? ((line) => console.log(line));
	const projectPath = opts.projectPath;
	if (!projectPath) throw new Error("[headless] 缺少 projectPath");
	const host = opts.host || "127.0.0.1";
	const applied = loadDotEnvFile(projectPath, process.env);
	if (applied.length > 0) log(`[headless] 已从 .env 载入 ${applied.length} 个环境变量: ${applied.join(", ")}`);
	const requestedPort = resolveTranslatorPort(opts.port, projectPath);
	if (!requestedPort) throw new Error("[headless] 未指定翻译器端口：请设置 QQBOT_BUS_PORT，或在 .qqbat/project.json 中提供 translatorPort");
	let translatorPort;
	if (getTranslatorStatus(requestedPort).running) {
		log(`[headless] 端口 ${requestedPort} 已有翻译器在运行，复用`);
		translatorPort = requestedPort;
	} else {
		log(`[headless] 启动翻译器（端口 ${requestedPort}）...`);
		translatorPort = await startTranslator(projectPath, requestedPort);
		log("[headless] 翻译器已启动");
	}
	const actualPort = getTranslatorStatus(void 0, projectPath).port;
	if (actualPort > 0 && actualPort !== translatorPort) {
		log(`[headless] 翻译器实际端口为 ${actualPort}（请求 ${requestedPort}），运行时改用实际端口`);
		translatorPort = actualPort;
	}
	let officialStarted = false;
	try {
		log("[headless] 启动官方适配器...");
		await startOfficial(projectPath);
		officialStarted = true;
		log("[headless] 官方适配器已启动");
	} catch (e) {
		log(`[headless] 官方适配器启动失败（不阻塞运行时）: ${e instanceof Error ? e.message : String(e)}`);
	}
	log(`[headless] 启动 TS 运行时（连 ws://${host}:${translatorPort}${BUS_WS_PATH}）...`);
	const runtime = new FlowRuntime(projectPath, translatorPort, host);
	let runtimeStatus = "stopped";
	runtime.onStatusChange((info) => {
		runtimeStatus = info.status;
		if (info.status === "running") log(`[headless] 运行时已就绪（事件数 ${info.eventCount}）`);
		else if (info.status === "error") log(`[headless] 运行时错误: ${info.error ?? "未知"}`);
		else log(`[headless] 运行时状态: ${info.status}`);
	});
	runtime.onLog((line) => log(line));
	await runtime.start();
	log("[headless] 运行时已启动");
	let stopped = false;
	return {
		async stop() {
			if (stopped) return;
			stopped = true;
			runtime.stop();
			stopOfficial(projectPath);
			stopTranslator(projectPath);
			runtimeStatus = "stopped";
		},
		status() {
			return {
				translator: getTranslatorStatus(void 0, projectPath).running,
				official: officialStarted,
				runtime: runtimeStatus
			};
		}
	};
}

export { loadDotEnvFile, readProjectTranslatorPort, resolveTranslatorPort, startHeadless };
