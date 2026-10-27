// src/main/runtime/previewRunner.ts
//
// 流程预览：把界面输入的假事件喂给一份**临时克隆**的 FlowInterpreter，回放每一步。
// 本文件从 10/18 编译产物还原（原始 TS 快照缺失），逻辑与线上 10/18 版本一致。
// @ts-nocheck
import { existsSync } from 'fs';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { normalizeFlow, validateFlow } from '@shared/nodes/flowNormalize';
import { onBotLog, onNodeEvent } from '../services/runtimeEvents';
import { setPreviewDataDirOverride } from '../services/builtinNodes/persistentStore';
import { FlowInterpreter } from './FlowInterpreter';
import { logger } from '../services/logger';
import { createTempWorkspace, disposeTempWorkspace } from '../services/infra/tempWorkspace';
import { readProjectPlatform } from '../services/project/projectPlatform';

//#region src/main/runtime/previewRunner.ts

/** 预览串行锁：进程级开关（env / 持久化目录）不能被并发预览互相覆盖 */
var previewRunning = false;
/**
* 把界面的输入合成为一条协议风格**消息**事件。
*
* 触发器匹配（`matchTrigger`）读的是 `raw_message` 等字段，所以这里按真实事件形状构造。
*
* ⚠️ 只管消息类触发（command / text / at_me / button）。`scheduled` / `on_ready` 是生命周期
* 触发，事件形状完全不同，由 `runOnce` 走 `fireLifecycle` 派发 —— 不经过这里。
*/
function synthesizeEvent(input) {
	const userId = Number(input.userId) || 123456;
	const groupId = Number(input.groupId) || 654321;
	const base = {
		post_type: "message",
		time: Math.floor(Date.now() / 1e3),
		self_id: 1e4,
		message_id: 1,
		sender: {
			user_id: userId,
			nickname: "测试用户"
		}
	};
	const isGroup = input.triggerType === "at_me" || input.triggerType === "button";
	const messageType = isGroup ? "group" : "private";
	let rawMessage = "";
	if (input.triggerType === "command") rawMessage = `${input.prefix ?? "/"}${input.command ?? ""}`;
	else if (input.triggerType === "button") rawMessage = input.buttonData ?? "";
	else rawMessage = input.text ?? "";
	return {
		...base,
		message_type: messageType,
		sub_type: messageType === "group" ? "normal" : "friend",
		raw_message: rawMessage,
		message: rawMessage,
		user_id: userId,
		...isGroup ? { group_id: groupId } : {},
		...input.triggerType === "at_me" ? { to_me: true } : {},
		...input.triggerType === "button" && input.buttonData ? { button_data: input.buttonData } : {}
	};
}
/** 常见 action 的合理桩返回，让下游节点拿到可用的数据形状 */
function stubResponseFor(api, params) {
	if (api.includes("login_info")) return {
		user_id: 1e4,
		nickname: "测试机器人"
	};
	if (api.includes("group_list")) return [];
	if (api.includes("friend_list")) return [];
	if (api.includes("stranger_info")) return {
		user_id: Number(params.user_id) || 0,
		nickname: "测试用户"
	};
	if (api.includes("group_member_info")) return {
		user_id: Number(params.user_id) || 0,
		nickname: "测试用户",
		role: "member"
	};
	if (api.includes("get_message")) return {
		message_id: params.message_id ?? 1,
		message: "测试消息"
	};
	if (api.includes("send")) return { message_id: "preview-msg-1" };
	return {
		status: "ok",
		retcode: 0
	};
}
/** 复制项目到临时目录（作为预览沙箱） */
async function cloneProject(projectPath, dest) {
	await (0, fsPromises.mkdir)(dest, { recursive: true });
	const qqbatSrc = (0, path.join)(projectPath, ".qqbat");
	if ((0, fs.existsSync)(qqbatSrc)) await (0, fsPromises.cp)(qqbatSrc, (0, path.join)(dest, ".qqbat"), {
		recursive: true,
		filter: (src) => {
			const name = src.split(/[\\/]/).pop() ?? "";
			if (name === "flow.json" || name === "history") return false;
			return true;
		}
	});
	for (const rel of [
		"data",
		"plugins",
		"src",
		".env"
	]) {
		const from = (0, path.join)(projectPath, rel);
		if (!(0, fs.existsSync)(from)) continue;
		await (0, fsPromises.cp)(from, (0, path.join)(dest, rel), { recursive: true });
	}
}
/**
* 预览里"跑一次"的统一入口 —— 消息类触发与生命周期触发的**分岔就在这里**。
*
* 生命周期触发（定时 / 连接就绪）**不能**走 `handleEvent`：那条路是消息事件，
* 而 `matchTrigger` 只在事件带 `__lifecycle__` 标记时才让生命周期触发器命中
* （这是有意的隔离：生命周期事件不该抢消息流程，反之亦然）。
*
* 之前预览对 `scheduled` 的处理是"伪造一条空消息"，于是定时流程在"本地测试"里
* **永远显示无匹配** —— 用户没有任何办法在界面上验证自己的定时流程。
*/
async function runOnce(interpreter, bot, event, triggerType) {
	if (triggerType !== "scheduled" && triggerType !== "on_ready") return interpreter.handleEvent(bot, event);
	const triggers = interpreter.listTriggers([triggerType]);
	if (triggers.length === 0) return false;
	let any = false;
	for (const trigger of triggers) if (await interpreter.fireLifecycle(triggerType, trigger.id, bot)) any = true;
	return any;
}
/**
* 运行一次预览。
*
* 串行执行；任何情况下都会恢复进程级开关并清理临时目录。
*/
export async function runPreview(request) {
	const startedAt = Date.now();
	const timeoutMs = Math.max(1e3, Math.min(request.timeoutMs ?? 8e3, 3e4));
	if (previewRunning) return {
		ok: false,
		matched: false,
		durationMs: 0,
		actions: [],
		nodes: [],
		variables: {},
		errors: ["已有预览正在运行，请稍候再试"],
		issues: [],
		normalizedNodes: 0,
		timedOut: false
	};
	previewRunning = true;
	const actions = [];
	const nodes = [];
	const errors = [];
	let variables = {};
	let matched = false;
	let timedOut = false;
	let normalizedNodes = 0;
	let issues = [];
	const tempRoot = await createTempWorkspace("preview");
	const clonePath = (0, path.join)(tempRoot, "project");
	const prevProjectRoot = process.env.QQBOT_PROJECT_ROOT;
	try {
		let rawGraph = request.graph;
		if (!rawGraph) {
			const flowPath = (0, path.join)(request.projectPath, ".qqbat", "flow.json");
			rawGraph = (0, fs.existsSync)(flowPath) ? JSON.parse(await (0, fsPromises.readFile)(flowPath, "utf-8")) : null;
		}
		if (!rawGraph) return {
			ok: false,
			matched: false,
			durationMs: Date.now() - startedAt,
			actions,
			nodes,
			variables,
			errors: ["没有可运行的流程（flow.json 不存在）"],
			issues,
			normalizedNodes: 0,
			timedOut: false
		};
		const { graph, changes } = normalizeFlow(rawGraph);
		normalizedNodes = changes.length;
		// 第 65 批：预览与 flow:validate 同一口径 —— 平台专属节点摆错项目会作为
		// error 阻断预览（而不是跑到该节点才静默不工作）。
		issues = validateFlow(graph, { projectPlatform: readProjectPlatform(request.projectPath) });
		const blocking = issues.filter((i) => i.severity === "error");
		if (blocking.length > 0) return {
			ok: false,
			matched: false,
			durationMs: Date.now() - startedAt,
			actions,
			nodes,
			variables,
			errors: blocking.map((i) => i.message),
			issues,
			normalizedNodes,
			timedOut: false
		};
		await cloneProject(request.projectPath, clonePath);
		await (0, fsPromises.mkdir)((0, path.join)(clonePath, ".qqbat"), { recursive: true });
		await (0, fsPromises.writeFile)((0, path.join)(clonePath, ".qqbat", "flow.json"), JSON.stringify(graph, null, 2), "utf-8");
		const dataDir = (0, path.join)(tempRoot, "playerdata");
		await (0, fsPromises.mkdir)(dataDir, { recursive: true });
		const projectDb = (0, path.join)(request.projectPath, "data", "players", "persistent.db");
		const previewDb = (0, path.join)(dataDir, "persistent.db");
		if ((0, fs.existsSync)(projectDb)) try {
			const src = new (require("better-sqlite3"))(projectDb, {
				fileMustExist: true,
				timeout: 5e3
			});
			try {
				await src.backup(previewDb);
			} finally {
				src.close();
			}
		} catch (e) {
			logger.warn(`[preview] 复制持久化库失败（将使用空库预览）: ${String(e)}`);
		}
		setPreviewDataDirOverride(dataDir);
		process.env.QQBOT_PROJECT_ROOT = clonePath;
		const offNode = onNodeEvent((projectPath, event) => {
			if (projectPath !== clonePath) return;
			nodes.push({
				nodeId: event.nodeId,
				status: event.status,
				durationMs: event.duration,
				...event.message ? { message: event.message } : {}
			});
		});
		const offLog = onBotLog((projectPath, entry) => {
			if (projectPath !== clonePath) return;
			if (entry.level === "error" || entry.level === "warn") errors.push(entry.message);
		});
		let seq = 0;
		const fakeBot = {
			self_id: 1e4,
			projectPath: clonePath,
			callApi: async (api, params) => {
				actions.push({
					api,
					params: params ?? {},
					seq: ++seq
				});
				return stubResponseFor(api, params ?? {});
			}
		};
		const interpreter = new FlowInterpreter(clonePath, {
			isPreview: true,
			onChainContext: (ctx) => {
				variables = { ...ctx.variables };
			}
		});
		const event = synthesizeEvent(request.event);
		try {
			matched = await Promise.race([runOnce(interpreter, fakeBot, event, request.event.triggerType), new Promise((_, reject) => setTimeout(() => reject( new Error("PREVIEW_TIMEOUT")), timeoutMs))]) === true;
		} catch (e) {
			if (e instanceof Error && e.message === "PREVIEW_TIMEOUT") {
				timedOut = true;
				errors.push(`预览超时（${timeoutMs}ms）——流程里可能包含等待/延时节点（wait_input、delay），预览会如实截断`);
			} else errors.push(e instanceof Error ? e.message : String(e));
		} finally {
			offNode();
			offLog();
		}
		return {
			ok: errors.length === 0,
			matched,
			durationMs: Date.now() - startedAt,
			actions,
			nodes,
			variables,
			errors,
			issues,
			normalizedNodes,
			timedOut
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		logger.error(`[preview] 运行失败: ${message}`);
		return {
			ok: false,
			matched,
			durationMs: Date.now() - startedAt,
			actions,
			nodes,
			variables,
			errors: [...errors, message],
			issues,
			normalizedNodes,
			timedOut
		};
	} finally {
		setPreviewDataDirOverride(null);
		if (prevProjectRoot === void 0) delete process.env.QQBOT_PROJECT_ROOT;
		else process.env.QQBOT_PROJECT_ROOT = prevProjectRoot;
		previewRunning = false;
		await disposeTempWorkspace(tempRoot);
	}
}

// 运行日志环形缓冲：10/18 时内联在本文件，10/19 拆到 services/runner/runtimeLogStore
// （拆开是为了让「读日志」不依赖预览器）。这里 re-export 保持 10/18 的 import 点不变，
// 且全进程只有一份缓冲区 —— 否则写日志与读日志会各自拿到不同的 Map。
export {
  pushRuntimeLog,
  runtimeLogSeq,
  runtimeLogsSince,
  recentRuntimeLogs,
} from '../services/runner/runtimeLogStore.js';
