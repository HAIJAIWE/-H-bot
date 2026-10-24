// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
// 打包产物里的 `_sentry_electron_main` 只是打包器的命名空间变量，运行时根本不存在
// （没有 DSN 时不会暴露，配了 DSN 会在 init 处直接 TypeError）。这里改成真实具名导出。
import { init, flush, close, captureMessage, getDefaultIntegrations } from "@sentry/electron/main";
import { init_paths, userDataPathOrThrow } from "../infra/paths";
import { init_logger, logger } from "../infra/logger";

var initialized = false;
/** Sentry 是否真的完成 init（没有 DSN 时只启用本地收集，退出时不该去 flush） */
var sentryStarted = false;
var currentUserId = null;
var currentProjectPath = null;
/** 初始化 Sentry（需在 app.whenReady() 之后调用） */
function initErrorMonitoring(config = {}) {
	if (initialized) {
		logger.warn("[errorMonitoring] 已初始化，跳过重复初始化");
		return;
	}
	const dsn = config.dsn ?? process.env.SENTRY_DSN;
	const environment = config.environment ?? (electron.app.isPackaged ? "production" : "development");
	const release = config.release ?? electron.app.getVersion();
	if (!dsn) {
		logger.info("[errorMonitoring] 未配置 SENTRY_DSN，仅启用本地错误收集");
		setupLocalErrorHandlers();
		initialized = true;
		return;
	}
	init({
		dsn,
		environment,
		release,
		tracesSampleRate: config.tracesSampleRate ?? .1,
		attachStacktrace: true,
		sendDefaultPii: false,
		beforeSend(event, hint) {
			const error = hint.originalException;
			if (error instanceof Error) {
				if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) return null;
				if (error.message.includes("canceled") || error.message.includes("aborted")) return null;
			}
			event.tags = {
				...event.tags,
				app_version: release,
				platform: process.platform,
				arch: process.arch
			};
			if (currentUserId) event.user = { id: currentUserId };
			if (currentProjectPath) event.tags.project_path = currentProjectPath;
			return event;
		},
		integrations: getDefaultIntegrations({})
	});
	logger.setRemoteReporter((level, message, _meta) => {
		if (level === "error" || level === "warn") {
			const sentryLevel = level === "warn" ? "warning" : "error";
			captureMessage(message, sentryLevel);
		}
	});
	initialized = true;
	sentryStarted = true;
	logger.info("[errorMonitoring] Sentry 初始化完成", {
		environment,
		release
	});
}
/** 设置本地错误处理（无 Sentry DSN 时的降级方案） */
function setupLocalErrorHandlers() {
	process.on("uncaughtException", (error) => {
		logger.error("[uncaughtException]", error);
		saveErrorToLocal("uncaughtException", error);
	});
	process.on("unhandledRejection", (reason, promise) => {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		logger.error("[unhandledRejection]", error, { promise: String(promise) });
		saveErrorToLocal("unhandledRejection", error);
	});
}
/** 保存错误到本地文件（用于离线分析） */
function saveErrorToLocal(type, error) {
	try {
		const { join } = require("path");
		const { writeFile, mkdir } = require("fs/promises");
		const logDir = userDataPathOrThrow("crashLogs", electron.app);
		mkdir(logDir, { recursive: true }).then(() => {
			const file = join(logDir, `${type}-${Date.now()}.json`);
			writeFile(file, JSON.stringify({
				type,
				message: error.message,
				stack: error.stack,
				timestamp: (/* @__PURE__ */ new Date()).toISOString(),
				version: electron.app.getVersion(),
				platform: process.platform
			}, null, 2));
		});
	} catch {}
}
/** 刷新并关闭（应用退出时调用） */
async function flushAndClose(timeoutMs = 2e3) {
	// 只有真的 init 过才 flush/close：没有 DSN 时 Sentry 客户端根本不存在，
	// 以前这里会抛 "Cannot read properties of undefined (reading 'flush')"，
	// 让每次正常退出都打一条吓人的 warn（2026-10-24 退出日志实撞）。
	if (sentryStarted) {
		await flush(timeoutMs);
		close();
	}
	sentryStarted = false;
	initialized = false;
}

export { initialized, currentUserId, currentProjectPath, initErrorMonitoring, setupLocalErrorHandlers, saveErrorToLocal, flushAndClose };
