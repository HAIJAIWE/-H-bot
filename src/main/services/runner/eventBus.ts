// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import ws from "ws";
import { init_dataService, mergePlayers } from "../project/dataService";
import * as fs from "fs";
import { PORT_BAND, TRANSLATOR_BASE, isBlockInRange, isInPortBand, translatorPortForBlock } from "../../../shared/config/ports";
import { findFreePort$1, isPortFree } from "./portFinder";
import { clearPortLeases, writePortLeases } from "../infra/portLease";
import * as path from "path";
import { emitSystemLog } from "./runtimeEvents";
import { planIdentityResolution, planMerge } from "../../../shared/domain/playerIdentity";
import { pruneMessageContexts } from "../translator/messageContext";
import { BUS_WS_PATH } from "../../../shared/protocol/bus";
import { officialApiRequest, onOfficialMessage, onOfficialStatusChange } from "../official/client";
import { noticeEventOf } from "../official/noticeEvents";
import { ALL_ACTION_HANDLERS, normalizeActionName } from "../translator/actions/index";
import { init_logger, logger } from "../infra/logger";

init_dataService();
/** 顺序UID起始值（1~100 预留，10000+ 自动分配） */
var UID_START = 1e4;
/** 待发送消息数上限（背压触发阈值，按端口/翻译器实例隔离） */
var MAX_PENDING_SENDS = 1e3;
/** WebSocket 发送缓冲区字节数上限（背压触发阈值，1MB） */
var MAX_WS_BUFFERED = 1048576;
/** 背压通知限流间隔（毫秒，每分钟最多 1 条通知） */
var BACKPRESSURE_NOTIFY_INTERVAL_MS = 6e4;
/** 带重试的文件写入（失败时重试 maxRetries 次，间隔 100ms） */
async function writeWithRetry(filePath, content, maxRetries = 3) {
	for (let i = 0; i < maxRetries; i++) try {
		(0, fs.writeFileSync)(filePath, content, "utf-8");
		return;
	} catch (e) {
		logger.warn(`[translator] 写入文件失败 (尝试 ${i + 1}/${maxRetries}):`, e);
		if (i < maxRetries - 1) await new Promise((r) => setTimeout(r, 100));
		else throw e;
	}
}
/**
* 项目端口分配基准：translatorPort = TRANSLATOR_BASE + portBlock
* （见 ProjectService._buildFullConfig 与 @shared/config/ports）。
*
* 2026-10-18 起从 1000 公用人造段迁到专属段 43100–43199 —— 不要在这里写死数字。
*/
var BUS_PORT_BASE = TRANSLATOR_BASE + 1;
/**
* 解析项目应使用的翻译器端口（确定性，不探测）。
*
* 优先级：
*   1. 已保存的 translatorPort —— **仅当它落在专属段内**（43100–43199）；
*   2. 由 portBlock 推导（TRANSLATOR_BASE + block）；
*   3. 已保存的 translatorPort（没有块可推导时，尊重手工/测试项目写死的值）；
*   4. 默认基准端口（43101）。
*
* ⚠️ 第 1 条带「段内」限定是刻意的：历史项目里存着 1001 / 10302 这类公用人造段的值，
* 若照旧沿用，端口就永远迁不出 1000 段。正常项目一定有 portBlock，所以旧值会被
* 推导结果覆盖，并由调用方回写 project.json（见 ipc/official.ts、botManager.ts）。
*/
function resolveTranslatorPort(config) {
	const saved = Number(config?.translatorPort ?? 0);
	const block = Number(config?.portBlock ?? 0);
	const hasSaved = Number.isInteger(saved) && saved > 0;
	const hasBlock = Number.isInteger(block) && block > 0;
	if (hasSaved && isInPortBand(saved)) return saved;
	if (hasBlock) {
		if (!isBlockInRange(block)) logger.warn(`[translator] portBlock=${block} 超出可分配区间 [1, 80]，已夹到边界`);
		return translatorPortForBlock(block);
	}
	if (hasSaved) return saved;
	return BUS_PORT_BASE;
}
/**
* 解析一个真正可用的翻译器端口：优先项目规范端口，被占用时才顺延。
*
* 修复背景（实测线上问题：运行时对 127.0.0.1:8080 反复 404）：
* 1. 旧实现在端口缺失时直接 `findFreePort(8080)`，而 8080 是极易被第三方
*    软件占用的端口（本机实测被 Steam web helper 占用）；
* 2. 旧的 `findFreePort` 用 `try { server.listen() } catch` 判断占用，
*    但 EADDRINUSE 是异步 'error' 事件，catch 永不触发 → 几乎无条件返回 8080；
* 3. 旧探测绑定 `::`（双栈），与 127.0.0.1 上的既有监听不冲突，于是"探测成功"，
*    而运行时客户端连的是 IPv4 → 连到别人的服务上。
*/
async function resolveUsableTranslatorPort(config, projectPath) {
	if (projectPath) {
		for (const translator of translators.values()) if (translator["projectPath"] === projectPath) return translator.port;
	}
	const preferred = resolveTranslatorPort(config);
	if (!translators.has(preferred) && await isPortFree(preferred)) return preferred;
	logger.warn(`[translator] 端口 ${preferred} 不可用，顺延寻找空闲端口`);
	return findFreePort(preferred + 1);
}
/**
* 查找空闲端口。
*
* · **起点在专属段内**：扫到段尾 → 回到段首 → 段满才退回全端口扫描（并告警）。
*   回绕是必要的：否则 43180 号块的项目一旦被占，就永远抢不到 43101 空出来的位置。
* · **起点在段外**（测试/手工场景）：沿用旧语义，从起点往后找 100 个。
*
* 跳过已在用的翻译器端口；探测统一绑定 127.0.0.1（与运行时客户端同一地址族）。
*/
async function findFreePort(startPort) {
	if (isInPortBand(startPort)) {
		for (let port = startPort; port <= PORT_BAND.max; port++) {
			if (translators.has(port)) continue;
			if (await isPortFree(port)) return port;
		}
		for (let port = PORT_BAND.min; port < startPort; port++) {
			if (translators.has(port)) continue;
			if (await isPortFree(port)) return port;
		}
		logger.warn("[translator] 专属端口段 43100-43199 已用尽，退回全端口扫描");
		return findFreePort$1(PORT_BAND.max + 1);
	}
	const limit = Math.min(startPort + 100, 65535);
	for (let port = startPort; port < limit; port++) {
		if (translators.has(port)) continue;
		if (await isPortFree(port)) return port;
	}
	return findFreePort$1(limit);
}
/**
* QQ 官方 `author.bot` → 统一侧的 `sender_type`。
*
* 官方给的是**布尔**，而 `StandardEvent` / 扩展字段统一用 `'user'` / `'bot'`
* （见 `shared/domain/common/standardEvent.ts` 的 `BaseEvent.senderType`）。
*
* ⚠️ **字段缺失时返回 `undefined`，不猜成 `'user'`** ——
* 猜错会把机器人消息当人处理，而这条字段存在的意义正是防这个。
* （导出是为了能单测：三种取值都要钉住。）
*/
function officialSenderType(author) {
	const bot = author?.bot;
	if (bot === true) return "bot";
	if (bot === false) return "user";
}
/** 按端口管理多个翻译器实例（支持同时运行多个机器人项目） */
var translators = /* @__PURE__ */ new Map();
var retryTimers = /* @__PURE__ */ new Map();
/**
* 把当前端口占用快照写到 userData/runtime/ports.json（诊断用，见 infra/portLease）。
*
* 只在「翻译器集合发生变化」时调用；本身吞掉一切异常，不影响启动/停止。
*/
function syncPortLeases() {
	writePortLeases([...translators.entries()].map(([port, translator]) => ({
		port,
		projectPath: String(translator["projectPath"] ?? "")
	})));
}
/**
* 启动（或复用）某项目的翻译器，返回**实际绑定**的端口。
*
* ## 端口被占时的行为（2026-10-18 改）
*
* · 请求端口在**专属段内**（43100–43199）：绑定失败就**换一个块**再试，最多 5 次。
*   旧实现是死磕同一个端口重试 5 次然后抛错 —— 对确定性分配的端口来说，
*   重试同一个端口毫无意义（占它的那个进程不会自己让开），只会把启动拖慢 5 秒。
* · 请求端口在段外（测试 / 手工指定的端口）：保持旧语义（同端口重试 + 延时），
*   因为这类调用方明确要求「就是这一号端口」，换号会让断言与部署脚本对不上。
*
* 返回值是**真实端口**：调用方必须用它（而不是传入值）去连运行时、回写 project.json。
*/
async function startTranslator(projectPath, port, delay = 1e3) {
	if (translators.has(port)) {
		logger.info(`[translator] 端口 ${port} 已有翻译器在运行，跳过`);
		return port;
	}
	for (const [existingPort, existing] of translators) if (existing["projectPath"] === projectPath) logger.warn(`[translator] 项目已存在端口 ${existingPort} 的翻译器，端口 ${port} 将再创建一个实例（可能导致消息重复处理）`);
	const timerKey = port;
	if (retryTimers.has(timerKey)) {
		clearTimeout(retryTimers.get(timerKey));
		retryTimers.delete(timerKey);
	}
	const MAX_START_RETRIES = 5;
	const allowReassign = isInPortBand(port);
	let currentPort = port;
	let translator = new EventBus(projectPath, currentPort);
	translators.set(currentPort, translator);
	let retries = 0;
	let ok = await waitForTranslatorReady(translator);
	while (!ok && retries < MAX_START_RETRIES) {
		translator.stop();
		translators.delete(currentPort);
		retries++;
		if (allowReassign) {
			const next = await findFreePort(currentPort + 1);
			if (next !== currentPort) {
				logger.warn(`[translator] 端口 ${currentPort} 绑定失败，换到 ${next}（专属段内换块）`);
				currentPort = next;
			}
		} else await new Promise((r) => {
			retryTimers.set(currentPort, setTimeout(r, delay));
		});
		translator = new EventBus(projectPath, currentPort);
		translators.set(currentPort, translator);
		ok = await waitForTranslatorReady(translator);
	}
	if (!ok) {
		translator.stop();
		translators.delete(currentPort);
		syncPortLeases();
		throw new Error(`启动翻译器失败（端口 ${currentPort} 不可用，已重试 ${MAX_START_RETRIES} 次）`);
	}
	syncPortLeases();
	return currentPort;
}
/** 等待翻译器完成绑定（带超时，避免绑定事件丢失时永久挂起） */
async function waitForTranslatorReady(translator, timeoutMs = 3e3) {
	return Promise.race([translator.ready, new Promise((resolve) => {
		setTimeout(() => resolve(false), timeoutMs).unref?.();
	})]);
}
/** 停掉满足条件的翻译器（含重试定时器清理） */
function stopMatchingTranslators(match) {
	for (const [port, translator] of translators) {
		if (!match(translator)) continue;
		if (retryTimers.has(port)) {
			clearTimeout(retryTimers.get(port));
			retryTimers.delete(port);
		}
		translator.stop();
		translators.delete(port);
	}
	syncPortLeases();
}
/**
* 停止**指定项目**的翻译器。
*
* `projectPath` 是**必填**的。旧签名是 `stopTranslator(projectPath?)`，"不传 = 停全部"，
* 结果 IPC 侧 schema 一旦把路径 strip 掉，一次普通调用就变成"停掉所有项目"
* （2026-10-01 评估 P1）。把"停全部"挪到下面那个必须写出来的名字，就没有 undefined
* 能意外命中这条路径了。
*/
function stopTranslator(projectPath) {
	stopMatchingTranslators((t) => t.projectPath === projectPath);
}
/**
* 停止**所有**翻译器。
*
* 显式 API：调用点必须写出这个名字才可能停全部。正常停机**不需要**它 ——
* 翻译器按端口复用设计，故意不随 `stopBot()` 关闭，进程退出时自然回收。
*/
function stopAllTranslators() {
	stopMatchingTranslators(() => true);
	clearPortLeases();
}
function getTranslatorStatus(port?: number, projectPath?: string) {
	let t;
	if (port !== void 0) t = translators.get(port);
	else if (projectPath) {
		for (const translator of translators.values()) if (translator["projectPath"] === projectPath) {
			t = translator;
			break;
		}
	} else for (const translator of translators.values()) {
		t = translator;
		break;
	}
	if (!t) return {
		running: false,
		clients: 0,
		port: port ?? 0
	};
	return {
		running: true,
		clients: t.clientCount,
		port: t.port,
		messageCount: t.msgCount,
		recentEvents: t.events
	};
}
/**
* 注入一条测试消息，模拟群聊/私聊消息经过翻译器 → bot 的完整流程
* @param chatType 'group'（默认）或 'c2c'，原实现硬编码 group 导致私聊测试无效
* @param chatId 群聊时为 group_id，私聊时为 user_id；缺省使用测试占位值
*/
function injectTestMessage(projectPath, message, chatType = "group", chatId) {
	let targetTranslator;
	for (const [, t] of translators) if (t.projectPath === projectPath) {
		targetTranslator = t;
		break;
	}
	if (!targetTranslator || targetTranslator.clientCount === 0) return false;
	const now = Math.floor(Date.now() / 1e3);
	const isGroup = chatType === "group";
	targetTranslator.broadcast({
		post_type: "message",
		message_type: isGroup ? "group" : "private",
		sub_type: isGroup ? "normal" : "friend",
		group_id: isGroup ? chatId ?? 99999 : void 0,
		user_id: isGroup ? 1e4 : chatId ?? 1e4,
		message: [{
			type: "text",
			data: { text: message }
		}],
		raw_message: message,
		font: 0,
		message_id: now,
		self_id: 0,
		time: now
	});
	return true;
}
/**
* QQ 官方 API ↔ 网关协议的翻译器。
*
* ⚠️ 下面有 11 个成员**故意不写 private**（`projectPath` / `selfIdNum` / `messageIdToContext` /
* `ctxFor` / `getOpenidByUid` / `getOrCreateUid` / `messageExtras` / `extractText` /
* `extractMarkdownKeyboard` / `resolveOpenid` / `callOfficialApi`）：它们是 `ActionContext`
* 的那 11 项能力，而 50 个 action 分支住在 `translator/actions/*.ts`，只能通过接口拿。
* 这个类**不导出**，所以这不是"对外 API"，只是"给那个接口的可见性"；
* 一旦 `implements ActionContext` 报错，就说明接口与实现漂了。
*/
var EventBus = class {
	projectPath;
	wss = null;
	clients = /* @__PURE__ */ new Set();
	/**
	* 事件订阅者（传输无关的出口）。
	*
	* `broadcast` 只负责把事件分发给订阅者；"怎么送到客户端"（readyState 判定、
	* 背压、逐个 ws.send）是 WS 侧订阅者自己的事（见 start() 里注册的 broadcastToClients）。
	*/
	eventSubscribers = /* @__PURE__ */ new Set();
	/** WS 转发订阅的退订函数（stop 时对称退订） */
	unsubClients = null;
	ctx = /* @__PURE__ */ new Map();
	/**
	* 按**触发消息**索引的同一份上下文：`hashToInt(eventId)` → ctx。
	*
	* 为什么需要第二张表：`ctx` 的键是**目标 openid**（群聊时即群 openid），
	* 同一群里后一条消息会**覆盖**前一条 —— 于是 A 触发的流程回复时可能带上 B 的 event_id。
	* 运行时手里本来就有 `message_id`（翻译器给的就是 `hashToInt(eventId)`），
	* 发送时带回来即可精确定位，**不必改对外协议**。
	*/
	ctxByMsgId = /* @__PURE__ */ new Map();
	/** UID 映射: uid ↔ openid */
	uidToOpenid = /* @__PURE__ */ new Map();
	openidToUid = /* @__PURE__ */ new Map();
	uidNext = UID_START;
	/** message_id → {chatType, chatId} 映射，用于 delete_message 撤回消息 */
	messageIdToContext = /* @__PURE__ */ new Map();
	unsubMessage = null;
	unsubStatus = null;
	alive = false;
	botUserId = "";
	uidMappingPath = "";
	failed = false;
	/** 当前待发送消息数（用于背压检测，按翻译器实例隔离） */
	pendingSends = 0;
	/** 上次背压通知时间戳（限流：每分钟最多 1 条） */
	lastBackpressureNotify = 0;
	/** saveUidMapping 的延迟定时器引用（用于 stop 时清理） */
	saveUidTimer = null;
	/** 消息计数（用于仪表盘显示） */
	messageCount = 0;
	/** 最近事件记录（用于仪表盘"最近动态"，最多保留 50 条） */
	recentEvents = [];
	MAX_RECENT_EVENTS = 50;
	/**
	* 绑定结果：true=已开始监听，false=端口不可用等错误。
	* 用于让 startTranslator 能 await 真实的绑定结果（EADDRINUSE 是异步事件）。
	*/
	ready;
	readyResolve = null;
	port;
	constructor(projectPath, port) {
		this.projectPath = projectPath;
		this.port = port;
		this.ready = new Promise((resolve) => {
			this.readyResolve = resolve;
		});
		this.uidMappingPath = (0, path.join)(projectPath, ".qqbat", "uid_mapping.json");
		this.loadUidMapping();
		this.start();
	}
	get clientCount() {
		return this.clients.size;
	}
	get msgCount() {
		return this.messageCount;
	}
	get events() {
		return this.recentEvents;
	}
	/** 记录一条消息事件（用于仪表盘） */
	recordEvent(content, type) {
		this.messageCount++;
		const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
		this.recentEvents.unshift({
			time,
			content,
			type
		});
		if (this.recentEvents.length > this.MAX_RECENT_EVENTS) this.recentEvents.length = this.MAX_RECENT_EVENTS;
	}
	/** 从磁盘加载 UID 映射 */
	loadUidMapping() {
		const bakPath = this.uidMappingPath + ".bak";
		try {
			if ((0, fs.existsSync)(this.uidMappingPath)) {
				const data = JSON.parse((0, fs.readFileSync)(this.uidMappingPath, "utf-8"));
				this.uidNext = data.nextUid || UID_START;
				for (const [openid, uid] of Object.entries(data.mapping || {})) {
					const n = uid;
					this.uidToOpenid.set(n, openid);
					this.openidToUid.set(openid, n);
				}
				logger.info(`[translator] 加载 UID 映射: ${this.openidToUid.size} 个用户, nextUid=${this.uidNext}`);
			}
		} catch (e) {
			logger.error("[translator] 加载 UID 映射失败:", e);
			if ((0, fs.existsSync)(bakPath)) try {
				const bakRaw = (0, fs.readFileSync)(bakPath, "utf-8");
				const data = JSON.parse(bakRaw);
				this.uidNext = data.nextUid || UID_START;
				for (const [openid, uid] of Object.entries(data.mapping || {})) {
					const n = uid;
					this.uidToOpenid.set(n, openid);
					this.openidToUid.set(openid, n);
				}
				logger.info(`[translator] 从备份恢复 UID 映射: ${this.openidToUid.size} 个用户, nextUid=${this.uidNext}`);
				try {
					(0, fs.writeFileSync)(this.uidMappingPath, bakRaw, "utf-8");
				} catch (e2) {
					logger.warn("[translator] 恢复后写回主文件失败:", e2);
				}
			} catch (e2) {
				logger.error("[translator] 从备份恢复 UID 映射失败:", e2);
			}
		}
	}
	/** 保存 UID 映射到磁盘 */
	saveUidMapping() {
		try {
			const mapping = {};
			for (const [openid, uid] of this.openidToUid) mapping[openid] = uid;
			const dir = (0, path.join)(this.projectPath, ".qqbat");
			if (!(0, fs.existsSync)(dir)) (0, fs.mkdirSync)(dir, { recursive: true });
			if ((0, fs.existsSync)(this.uidMappingPath)) try {
				const current = (0, fs.readFileSync)(this.uidMappingPath, "utf-8");
				(0, fs.writeFileSync)(this.uidMappingPath + ".bak", current, "utf-8");
			} catch (e) {
				logger.warn("[translator] 备份 UID 映射文件失败:", e);
			}
			const content = JSON.stringify({
				nextUid: this.uidNext,
				mapping
			}, null, 2);
			writeWithRetry(this.uidMappingPath, content).catch((e) => {
				logger.error("[translator] 保存 UID 映射失败:", e);
				emitSystemLog(this.projectPath, "保存 UID 映射失败（已重试3次）: " + String(e), "error");
			});
		} catch (e) {
			logger.error("[translator] 保存 UID 映射失败:", e);
		}
	}
	/** 延迟保存映射（避免每条消息都写盘），并记录定时器以便 stop 时清理 */
	scheduleSaveUidMapping() {
		if (this.saveUidTimer) clearTimeout(this.saveUidTimer);
		this.saveUidTimer = setTimeout(() => {
			this.saveUidTimer = null;
			this.saveUidMapping();
		}, 0);
	}
	/** 获取或创建用户的顺序 UID（**按单个 id** —— 组身份等非玩家场景用它） */
	getOrCreateUid(openid) {
		const existing = this.openidToUid.get(openid);
		if (existing !== void 0) return existing;
		const uid = this.uidNext++;
		this.uidToOpenid.set(uid, openid);
		this.openidToUid.set(openid, uid);
		this.scheduleSaveUidMapping();
		return uid;
	}
	/**
	* **解析玩家 uid** —— 跨群"同一个人"的关键。
	*
	* 旧实现是 `memberOpenid || userOpenid`，而 `member_openid` 是**群内唯一**的，
	* 于是同一个 QQ 号在 A 群和 B 群 = 两个 uid = 两份存档。
	*
	* 现在：优先级 union > user > member，并把一次事件里出现的**所有** id 都登记成同一个 uid 的别名
	* （纯逻辑见 `@shared/domain/playerIdentity`）。只要**任意一次**事件同时带了多个 id，
	* 就能把之前按群拆开的身份认出来，并把数据并起来。
	*
	* ⚠️ 诚实的边界：如果平台在群事件里**只给 member_openid**、且从不给 union/user openid，
	* 那么**任何算法都无法**知道两个群的 member_openid 是同一个人 —— 那种情况只能手动合并。
	*/
	resolvePlayerUid(ids) {
		const plan = planIdentityResolution(this.openidToUid, ids);
		const merge = planMerge(plan.hitUids);
		/**
		* 诊断：**只在"首次建 uid"或"学到新别名"时**打一行，避免每条消息都刷屏。
		*
		* 为什么要打：平台在群事件里到底给不给 `user_openid`/`union_openid`，
		* 决定了"跨群同一个玩家"能不能自动识别 —— 这件事**只能从真实事件里看**：
		*   · 依据=user_openid / union_openid → 跨群稳定 ✅
		*   · 依据=member_openid（且 user/union 都是 —）→ 该群身份是群内唯一的，
		*     不同群会被当成不同人，只能靠手动合并。
		*/
		const describeIds = () => {
			const s = `union=${ids.unionOpenid ? ids.unionOpenid.slice(0, 8) + "…" : "—"} user=${ids.userOpenid ? ids.userOpenid.slice(0, 8) + "…" : "—"} member=${ids.memberOpenid ? ids.memberOpenid.slice(0, 8) + "…" : "—"}`;
			return !!ids.memberOpenid && !ids.userOpenid && !ids.unionOpenid ? s + " ← 只有群内 id" : s;
		};
		if (plan.uid !== null) {
			const learned = plan.aliases.filter((a) => !this.openidToUid.has(a));
			for (const alias of plan.aliases) this.openidToUid.set(alias, plan.uid);
			logger.info(`[translator] 身份解析: uid=${plan.uid}（已存在${learned.length > 0 ? `，新学 ${learned.length} 个别名` : ""}） · ${describeIds()}`);
			if (!this.uidToOpenid.has(plan.uid) && plan.primaryAlias) this.uidToOpenid.set(plan.uid, plan.primaryAlias);
			if (merge) for (const from of merge.from) mergePlayers(this.projectPath, String(from), String(merge.to)).then((res) => {
				logger.info(`[translator] 身份合并: uid ${from} → ${merge.to}（搬迁 ${res.moved} 条，冲突丢弃 ${res.discarded} 条）`);
				for (const [k, v] of this.openidToUid) if (v === from) this.openidToUid.set(k, merge.to);
				this.scheduleSaveUidMapping();
			}).catch((e) => logger.error("[translator] 身份合并失败:", e));
			this.scheduleSaveUidMapping();
			return plan.uid;
		}
		const uid = this.uidNext++;
		for (const alias of plan.aliases) this.openidToUid.set(alias, uid);
		if (plan.primaryAlias) this.uidToOpenid.set(uid, plan.primaryAlias);
		const anchor = ids.unionOpenid ? "union_openid(跨应用)" : ids.userOpenid ? "user_openid(应用级)" : "member_openid(群内唯一！跨群不会自动合并)";
		logger.info(`[translator] 身份解析: 新建 uid=${uid} 依据=${anchor} · ${describeIds()}`);
		this.scheduleSaveUidMapping();
		return uid;
	}
	/** 通过 UID 查找 openid（用于发消息时回查） */
	getOpenidByUid(uid) {
		return this.uidToOpenid.get(uid);
	}
	/** 记下被动回复上下文（统一在这里打时间戳，供 pruneCtx 回收） */
	rememberContext(key, ctx) {
		const entry = {
			...ctx,
			at: Date.now()
		};
		this.ctx.set(key, entry);
		this.ctxByMsgId.set(this.hashToInt(ctx.eventId), entry);
		const now = Date.now();
		if (this.ctx.size > 256) pruneMessageContexts(this.ctx, now);
		if (this.ctxByMsgId.size > 256) pruneMessageContexts(this.ctxByMsgId, now);
	}
	/**
	* 消息 id / REFIDX → REFIDX 的映射（设计文档模块 4）。
	*
	* 为什么必须有映射层：**REFIDX ≠ 消息 id**，两者不是一回事。
	* 事件侧从 `message_scene.ext`（`["msg_idx=REFIDX_xxx"]`）登记进来，
	* 发送侧就能把流程里拿到的"消息 id"换算成官方要的引用标识。
	*/
	refIdxByMessageId = /* @__PURE__ */ new Map();
	/** 登记一次"消息 id → REFIDX"（幂等；空值直接忽略） */
	rememberRefIdx(messageId, refIdx) {
		const id = messageId === void 0 || messageId === null ? "" : String(messageId);
		const ref = refIdx === void 0 || refIdx === null ? "" : String(refIdx);
		if (!id || !ref) return;
		this.refIdxByMessageId.set(id, ref);
		if (this.refIdxByMessageId.size > 256) {
			const keys = [...this.refIdxByMessageId.keys()];
			for (const k of keys.slice(0, keys.length - 256)) this.refIdxByMessageId.delete(k);
		}
	}
	/**
	* 把流程层给的"引用标识"换算成官方要的 REFIDX。
	*
	* · 已经是 `REFIDX…` 形态 → **原样透传**（这是「取上下文 → 引用标识」的常见输出）
	* · 否则查映射表（事件侧登记）
	* · 都认不出 → **返回空串**，由调用方**明确报错**（不静默丢掉引用）
	*
	* 刻意**不做格式猜测**：REFIDX 的具体形态只来自文档、未经真机验证
	* （设计文档「七、风险」第 1 条），猜错比报错更糟。
	*/
	resolveRefIdx(v) {
		const raw = v === void 0 || v === null ? "" : String(v).trim();
		if (!raw) return "";
		if (/^REFIDX/i.test(raw)) return raw;
		return this.refIdxByMessageId.get(raw) ?? "";
	}
	/**
	* 把网关侧的 `reply_to` / `is_wakeup` 换算成官方发送选项。
	*
	* 认不出引用目标时**抛错**（`run().catch` 会把它变成 sendError）——
	* 静默丢掉引用会让用户以为"回复了某条消息"，实际是普通消息。
	*/
	messageExtras(params) {
		const extras = {};
		const rawReply = params.reply_to;
		const replyTo = rawReply === void 0 || rawReply === null ? "" : String(rawReply).trim();
		if (replyTo) {
			const ref = this.resolveRefIdx(replyTo);
			if (!ref) throw new Error(`引用回复失败：认不出要引用的消息「${replyTo}」（既不是 REFIDX 形态，也不在"消息 id → REFIDX"映射表里）`);
			extras.messageReference = { message_id: ref };
		}
		if (params.is_wakeup === true) extras.isWakeup = true;
		return extras;
	}
	/**
	* 取"这条回复该引用哪条触发消息"的被动回复上下文。
	*
	* **优先按触发消息定位**：运行时会把它收到的那条事件的 `message_id`
	* （= `hashToInt(eventId)`）随发送带回来，于是能精确命中发起这条链的那条消息。
	*
	* 为什么必须这样：`ctx` 的键是**目标 openid**，群聊时就是**群 openid** ——
	* 同一个群里 A 触发流程、B 随后发言会把槽位**覆盖掉**，A 的回复于是带着 **B 的 event_id**
	* 发出去，被官方按错条归属或按重复去重。
	*
	* 带不回来（老调用方、裸网关客户端）时就退回原来的单槽位行为 —— **不能把老路径弄坏**。
	*/
	ctxFor(params, targetKey) {
		const mid = params.message_id;
		if (mid !== void 0 && mid !== null && String(mid) !== "") {
			const byMsg = this.ctxByMsgId.get(Number(mid));
			if (byMsg) return byMsg;
		}
		return this.ctx.get(targetKey);
	}
	/**
	* 把网关侧的**顺序 UID** 还原成官方 **openid**（群号与用户都适用）。
	*
	* ## 为什么必须有这个回查
	*
	* 本翻译器对外是运行时事件语义：事件里的 `group_id` / `user_id` 是**自己分配的顺序
	* 整数**（见 {@link getOrCreateUid} —— `uidNext++`），因为官方 openid 是长串、无法当
	* 运行时的 int 字段用。**群号也一样**：事件构造处用
	* `this.getOrCreateUid(groupOpenid)` 把 `group_openid` 换成了顺序 UID。
	*
	* 所以凡是把 `params.group_id` / `params.user_id` 拼进官方接口的地方，
	* **都必须先回查**：官方 `/v2/groups/...` 的路径参数与 `user_openid` 字段要的都是 openid。
	*
	* 发消息那几条路（send_private_message / send_group_message / …）一直是回查的；
	* 群管理这一组当初漏了，于是 6 个动作全都拿着顺序 UID 去调 openid 接口 —— 必然失败
	* （表现为"禁言/踢人/查群成员点了没反应"，而且报的是官方接口的错，很难反查到翻译器）。
	*
	* 回查不到时**原样返回**：这样"映射缺失"会如实表现为官方接口报错（可诊断），
	* 而不是我们在这里编一个值出来；同时也让"调用方本来就传了真 openid"这一情况继续可用。
	*/
	resolveOpenid(raw) {
		const s = String(raw ?? "").trim();
		if (!s) return "";
		const n = Number(s);
		if (!Number.isFinite(n)) return s;
		return this.getOpenidByUid(n) ?? s;
	}
	/** 将字符串哈希为正整数（协议要求 message_id 为 int） */
	hashToInt(s) {
		let hash = 0;
		for (let i = 0; i < s.length; i++) {
			hash = (hash << 5) - hash + s.charCodeAt(i);
			hash = hash & 2147483647;
		}
		return hash || 1;
	}
	/** 获取 self_id 的整数表示 */
	get selfIdNum() {
		return Number(this.botUserId) || 0;
	}
	start() {
		try {
			this.wss = new ws.WebSocketServer({
				host: "127.0.0.1",
				port: this.port,
				path: BUS_WS_PATH
			});
		} catch (e) {
			this.failed = true;
			logger.error(`[translator] 端口 ${this.port} 创建 WebSocket 服务失败: ${e instanceof Error ? e.message : String(e)}`);
			this.readyResolve?.(false);
			this.readyResolve = null;
			return;
		}
		this.wss.on("error", (err) => {
			this.failed = true;
			logger.error(`[translator] 端口 ${this.port} WebSocket 服务错误: ${err.message}`);
			this.readyResolve?.(false);
			this.readyResolve = null;
		});
		this.wss.on("listening", () => {
			logger.info(`[translator] 已监听 127.0.0.1:${this.port}`);
			this.readyResolve?.(true);
			this.readyResolve = null;
		});
		this.wss.on("connection", (ws$2) => {
			this.clients.add(ws$2);
			logger.info(`[translator] 运行时已连接 (当前客户端: ${this.clients.size})`);
			emitSystemLog(this.projectPath, "运行时已连接 (当前客户端: " + this.clients.size + ")");
			this.sendMetaEvent(ws$2, "lifecycle", {
				post_type: "meta_event",
				meta_event_type: "lifecycle",
				sub_type: "connect",
				self_id: this.selfIdNum,
				time: Math.floor(Date.now() / 1e3)
			});
			this.sendMetaEvent(ws$2, "heartbeat", {
				post_type: "meta_event",
				meta_event_type: "heartbeat",
				status: {
					online: true,
					good: true
				},
				interval: 5e3,
				self_id: this.selfIdNum,
				time: Math.floor(Date.now() / 1e3)
			});
			ws$2.on("message", (raw) => {
				try {
					const msg = JSON.parse(raw.toString());
					this.handleAction(this.responderFor(ws$2), msg);
				} catch {}
			});
			ws$2.on("close", () => {
				this.clients.delete(ws$2);
				logger.info(`[translator] 运行时断开 (剩余客户端: ${this.clients.size})`);
				emitSystemLog(this.projectPath, "运行时断开 (剩余客户端: " + this.clients.size + ")");
			});
			ws$2.on("error", () => {
				this.clients.delete(ws$2);
				logger.info(`[translator] 运行时连接错误 (剩余客户端: ${this.clients.size})`);
			});
		});
		this.unsubClients = this.onEvent((data) => this.broadcastToClients(data));
		this.unsubMessage = onOfficialMessage((path$3, message) => {
			if (path$3 !== this.projectPath) return;
			this.handleOfficialEvent(message.type, message.data);
		});
		this.unsubStatus = onOfficialStatusChange((path$4, status) => {
			if (path$4 !== this.projectPath) return;
			if (status === "connected") this.alive = true;
			else if (status === "disconnected" || status === "error") this.alive = false;
			this.broadcast({
				post_type: "meta_event",
				meta_event_type: "lifecycle",
				sub_type: status === "connected" ? "connect" : "disable",
				self_id: this.selfIdNum,
				time: Math.floor(Date.now() / 1e3)
			});
		});
	}
	stop() {
		this.saveUidMapping();
		if (this.saveUidTimer) {
			clearTimeout(this.saveUidTimer);
			this.saveUidTimer = null;
		}
		this.unsubMessage?.();
		this.unsubMessage = null;
		this.unsubStatus?.();
		this.unsubStatus = null;
		this.unsubClients?.();
		this.unsubClients = null;
		for (const ws$3 of this.clients) {
			try {
				ws$3.removeAllListeners();
			} catch {}
			try {
				ws$3.close();
			} catch {}
		}
		this.clients.clear();
		this.wss?.close();
		this.wss = null;
		this.ctx.clear();
		this.uidToOpenid.clear();
		this.openidToUid.clear();
		this.messageIdToContext.clear();
		this.pendingSends = 0;
		this.lastBackpressureNotify = 0;
	}
	/**
	* 订阅翻译器事件（传输无关的出口），返回退订函数。
	*
	* WS 服务器自己订阅一次把事件转发给所有 client；进程内事件源订阅后
	* 直接推给 FlowRuntime。这条接缝让"事件从哪来"不再绑定某一种传输。
	*/
	onEvent(listener) {
		this.eventSubscribers.add(listener);
		return () => {
			this.eventSubscribers.delete(listener);
		};
	}
	/**
	* 广播一条事件给所有订阅者。
	*
	* 这里**不再**直接遍历 `this.clients`：传输细节（readyState、背压、逐个 send）
	* 收在 WS 订阅者 `broadcastToClients` 里，于是同一份事件可以同时喂给别的传输
	* （进程内直连）而互不干扰。
	*/
	broadcast(data) {
		for (const listener of this.eventSubscribers) try {
			listener(data);
		} catch (e) {
			logger.error("[translator] 事件订阅者处理失败:", e);
		}
	}
	/**
	* WS 侧转发：行为与旧 `broadcast` 逐字一致
	* （背压判定、丢弃非关键消息、发送计数、错误日志）。
	*/
	broadcastToClients(data) {
		const raw = JSON.stringify(data);
		const postType = String(data.post_type || "");
		const metaEventType = String(data.meta_event_type || "");
		const isCritical = !(postType === "meta_event" && metaEventType === "heartbeat");
		for (const ws$4 of this.clients) {
			if (ws$4.readyState !== ws.WebSocket.OPEN) continue;
			if (this.pendingSends > MAX_PENDING_SENDS && !isCritical) {
				this.notifyBackpressure(`待发送消息数超限 (${this.pendingSends}/${MAX_PENDING_SENDS})，丢弃非关键消息(heartbeat)`);
				continue;
			}
			if (ws$4.bufferedAmount > MAX_WS_BUFFERED && !isCritical) {
				this.notifyBackpressure(`WebSocket 缓冲区满 (${ws$4.bufferedAmount} bytes)，丢弃非关键消息(heartbeat)`);
				continue;
			}
			this.pendingSends++;
			ws$4.send(raw, (err) => {
				this.pendingSends--;
				if (err) logger.error("[translator] ws.send 失败:", err);
			});
		}
	}
	/**
	* 通知背压触发（限流：每分钟最多 1 条通知，避免日志风暴）。
	* 通过 emitSystemLog 推送到前端"输出"面板。
	*/
	notifyBackpressure(reason) {
		const now = Date.now();
		if (now - this.lastBackpressureNotify < BACKPRESSURE_NOTIFY_INTERVAL_MS) return;
		this.lastBackpressureNotify = now;
		emitSystemLog(this.projectPath, `背压触发: ${reason}`, "warn");
	}
	sendMetaEvent(ws$5, _type, data) {
		if (ws$5.readyState === ws.WebSocket.OPEN) ws$5.send(JSON.stringify(data));
	}
	/**
	* 把"往这个 WS 客户端回帧"包装成传输无关的响应器。
	* 形状与历史 `sendResponse`/`sendError` 完全一致（含 readyState 判定）。
	*/
	responderFor(ws$6) {
		return {
			respond: (echo, data) => this.sendResponse(ws$6, echo, data),
			fail: (echo, msg) => this.sendError(ws$6, echo, msg)
		};
	}
	sendResponse(ws$7, echo, data = {}) {
		if (ws$7.readyState !== ws.WebSocket.OPEN) return;
		ws$7.send(JSON.stringify({
			v: 1,
			status: "ok",
			retcode: 0,
			data,
			echo
		}));
	}
	sendError(ws$8, echo, msg) {
		if (ws$8.readyState !== ws.WebSocket.OPEN) return;
		ws$8.send(JSON.stringify({
			v: 1,
			status: "failed",
			retcode: 100,
			data: null,
			echo,
			message: msg
		}));
	}
	handleOfficialEvent(type, data) {
		const eventId = data.id;
		const author = data.author;
		const content = data.content || "";
		const ts = Math.floor(Date.now() / 1e3);
		if (type === "hello") emitSystemLog(this.projectPath, "收到官方事件: type=" + type + ", content=\"" + content.slice(0, 50) + "\"");
		if (type === "READY") {
			const user = data.user;
			if (user) {
				this.botUserId = String(user.id || "");
				emitSystemLog(this.projectPath, "READY: botUserId=" + this.botUserId);
			}
		}
		const notice = noticeEventOf(type, data);
		if (notice) {
			const uid = notice.userOpenid ? this.resolvePlayerUid({ userOpenid: notice.userOpenid }) : "";
			emitSystemLog(this.projectPath, "通知事件: " + type + " → " + notice.noticeType);
			this.broadcast({
				post_type: "notice",
				notice_type: notice.noticeType,
				sub_type: notice.noticeType,
				time: ts,
				self_id: this.selfIdNum,
				user_id: uid,
				group_id: notice.groupOpenid,
				operator_id: notice.operatorOpenid,
				channel_id: notice.channelId ?? ""
			});
			return;
		}
		/**
		* 频道@机器人消息（intent `1<<30` 送达；频道**全量**消息 `MESSAGE_CREATE` 要私域权限 `1<<9`，
		* 同一分支也认它）。2026-10-05 补：此前**只能发到频道、收不到频道消息** ✗
		*（能力清单 §7.9 的"频道事件翻译"一直列着 `AT_MESSAGE_CREATE` / `MESSAGE_CREATE` 这个计划）。
		*
		* 广播成运行时的 `message_type: 'guild'` 形状（带 `guild_id` / `channel_id`），
		* 于是「收到消息」触发器选「频道消息」就能匹配 ✓
		*/
		if (type === "AT_MESSAGE_CREATE" || type === "MESSAGE_CREATE") {
			const f = guildMessageFields(data);
			if (!f) return;
			const uid = this.resolvePlayerUid({ userOpenid: f.userOpenid });
			emitSystemLog(this.projectPath, "频道消息: channel=" + f.channelId.slice(0, 10) + ", user=" + f.userOpenid.slice(0, 10) + ", content=\"" + f.content.slice(0, 50) + "\"");
			this.recordEvent(f.content, "message");
			this.rememberContext(f.channelId, {
				eventId: f.eventId,
				msgId: f.eventId,
				msgSeq: 1,
				userOpenid: f.userOpenid,
				groupOpenid: void 0
			});
			this.broadcast({
				post_type: "message",
				message_type: "guild",
				sub_type: "normal",
				to_me: type === "AT_MESSAGE_CREATE",
				time: ts,
				self_id: this.selfIdNum,
				user_id: uid,
				guild_id: f.guildId,
				channel_id: f.channelId,
				message_id: this.hashToInt(f.eventId),
				_openid: f.userOpenid,
				message: [{
					type: "text",
					data: { text: f.content }
				}],
				raw_message: f.content,
				font: 0,
				sender: {
					user_id: uid,
					nickname: f.nickname,
					sex: "unknown",
					age: 0,
					sender_type: officialSenderType(author)
				}
			});
		}
		if (type === "C2C_MESSAGE_CREATE") {
			const userOpenid = author?.user_openid || author?.id || "";
			if (!userOpenid) return;
			const uid = this.resolvePlayerUid({
				unionOpenid: author?.union_openid || "",
				userOpenid
			});
			/**
			* 昵称：官方文档的 `User` 对象**有 `username`**（示例里是 `"username": "小明"`）。
			* 以前这里硬编码 `nickname: ''` —— 那时 `parseOfficialEvent` 也没解析 username，
			* 所以看起来"平台不给"。现在解析层已带上，这里如实透出。
			* 拿不到时留空串（下游 `ensureBaseData` 见到空串会**跳过**，不会清掉已缓存的昵称）。
			*/
			const nickname = author?.username || "";
			emitSystemLog(this.projectPath, "C2C消息: user=" + userOpenid + ", UID=" + uid + ", content=\"" + content.slice(0, 50) + "\"");
			this.recordEvent(content, "message");
			this.rememberContext(userOpenid, {
				eventId,
				msgId: eventId,
				msgSeq: 1,
				userOpenid,
				groupOpenid: void 0
			});
			this.broadcast({
				post_type: "message",
				ark_type: String(data.ark_type ?? ""),
				message_type: "private",
				sub_type: "friend",
				to_me: true,
				time: ts,
				self_id: this.selfIdNum,
				user_id: uid,
				message_id: this.hashToInt(eventId),
				_openid: userOpenid,
				message: [{
					type: "text",
					data: { text: content }
				}],
				raw_message: content,
				font: 0,
				sender: {
					user_id: uid,
					nickname,
					sex: "unknown",
					age: 0,
					sender_type: officialSenderType(author)
				}
			});
		}
		if (type === "GROUP_AT_MESSAGE_CREATE") {
			const groupOpenid = data.group_openid;
			const memberOpenid = author?.member_openid || "";
			const userOpenid = author?.user_openid || "";
			const unionOpenid = author?.union_openid || "";
			const chatUid = memberOpenid || userOpenid;
			const nickname = author?.username || "";
			const role = author?.member_role || "member";
			if (!groupOpenid || !(chatUid || unionOpenid)) return;
			const uid = this.resolvePlayerUid({
				unionOpenid,
				userOpenid,
				memberOpenid
			});
			const groupUid = this.getOrCreateUid(groupOpenid);
			emitSystemLog(this.projectPath, "群@消息: group=" + groupOpenid + ", user=" + chatUid + ", 用户UID=" + uid + ", content=\"" + content.slice(0, 50) + "\"");
			this.recordEvent(content, "message");
			this.rememberContext(groupOpenid, {
				eventId,
				msgId: eventId,
				msgSeq: data.msg_seq ?? 1,
				userOpenid,
				memberOpenid,
				groupOpenid
			});
			this.broadcast({
				post_type: "message",
				ark_type: String(data.ark_type ?? ""),
				message_type: "group",
				sub_type: "normal",
				to_me: true,
				time: ts,
				self_id: this.selfIdNum,
				group_id: groupUid,
				user_id: uid,
				message_id: this.hashToInt(eventId),
				_openid: chatUid,
				message: [{
					type: "at",
					data: { qq: String(uid) }
				}, {
					type: "text",
					data: { text: content }
				}],
				raw_message: content,
				font: 0,
				sender: {
					user_id: uid,
					nickname,
					sex: "unknown",
					age: 0,
					role,
					area: "",
					sender_type: officialSenderType(author)
				}
			});
		}
		if (type === "GROUP_MESSAGE_CREATE") {
			const groupOpenid = data.group_openid;
			const memberOpenid = author?.member_openid || "";
			const userOpenid = author?.user_openid || "";
			const unionOpenid = author?.union_openid || "";
			const chatUid = memberOpenid || userOpenid;
			if (!groupOpenid || !(chatUid || unionOpenid)) return;
			const groupUid = this.getOrCreateUid(groupOpenid);
			const nickname = author?.username || "";
			const role = author?.member_role || "member";
			const isToMe = content.includes("<@") || content.startsWith("/");
			const uid = this.resolvePlayerUid({
				unionOpenid,
				userOpenid,
				memberOpenid
			});
			emitSystemLog(this.projectPath, "群消息: group=" + groupOpenid + ", user=" + chatUid + ", 用户UID=" + uid + ", content=\"" + content.slice(0, 50) + "\", to_me=" + isToMe);
			this.rememberContext(groupOpenid, {
				eventId,
				msgId: eventId,
				msgSeq: data.msg_seq ?? 1,
				userOpenid,
				memberOpenid,
				groupOpenid
			});
			const cleanContent = content.replace(/<@[^>]+>\s*/g, "").trim();
			this.recordEvent(cleanContent || content, "message");
			this.broadcast({
				post_type: "message",
				ark_type: String(data.ark_type ?? ""),
				message_type: "group",
				sub_type: "normal",
				to_me: isToMe,
				time: ts,
				self_id: this.selfIdNum,
				group_id: groupUid,
				user_id: uid,
				message_id: this.hashToInt(eventId),
				_openid: chatUid,
				message: [{
					type: "text",
					data: { text: cleanContent }
				}],
				raw_message: cleanContent,
				font: 0,
				sender: {
					user_id: uid,
					nickname,
					sex: "unknown",
					age: 0,
					role,
					area: "",
					sender_type: officialSenderType(author)
				}
			});
		}
	}
	/**
	* action 分派（传输无关）。
	*
	* 谁提供 `responder`，成功/失败的响应就从哪回去：WS 侧传 `responderFor(ws)`，
	* 进程内事件源传一个把帧 emit 给运行时的实现。
	*
	* 分支逻辑与历史完全一致 —— 差别只在**实现搬去了 `translator/actions/*.ts`**：
	* 这里只剩"查表 + 兜底"，新增一个 action = 在某个域文件里写 handler + 在总表登记，
	* 不必再动这个文件。
	*/
	handleAction(responder, msg) {
		// 旧动作名（存量 flow.json / 第三方插件）在这里归一化成现行命名，新名原样透传
		const action = normalizeActionName(msg.action);
		const params = msg.params || {};
		const echo = msg.echo;
		const run = async () => {
			const handler = ALL_ACTION_HANDLERS[action];
			if (!handler) {
				const errMsg = `不支持的 协议动作: ${action}（已在 SUPPORTED_ACTIONS 登记的都支持；新增能力请先登记再写实现）`;
				emitSystemLog(this.projectPath, errMsg, "warn");
				responder.fail(echo, errMsg);
				return;
			}
			await handler(this, {
				action,
				params,
				echo,
				responder
			});
		};
		run().catch((e) => {
			logger.error(`[translator] 发送消息失败:`, e);
			emitSystemLog(this.projectPath, "发送消息失败: " + String(e), "error");
			responder.fail(echo, String(e));
		});
	}
	/**
	* 调一次官方 API，把结果归一化成 `{ ok, data }` / `{ ok:false, error }`。
	*
	* 为什么要有这层：`handleAction` 里的分支都是"要么 sendResponse、要么 sendError"，
	* 而 `officialApiRequest` 是抛异常的。包一层之后每个 case 都是三行，
	* 不必各自写 try/catch（那种重复很容易漏掉一处，漏了就会变成"静默无响应"）。
	*/
	async callOfficialApi(method, path$5, body) {
		try {
			return {
				ok: true,
				data: await officialApiRequest(this.projectPath, method, path$5, body)
			};
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	extractText(message) {
		if (typeof message === "string") return message;
		if (Array.isArray(message)) return message.filter((s) => s.type === "text").map((s) => String(s.data?.text || "")).join("");
		return "";
	}
	/** 检测消息段中的 markdown + keyboard（消息段扩展格式）。
	*  返回 {markdown, keyboard} 或 null（非键盘消息时）。
	*  用于 send_message 等标准 action 中识别按钮消息并路由到 Official API keyboard 端点。
	*/
	extractMarkdownKeyboard(message) {
		if (!Array.isArray(message)) return null;
		let markdown = "";
		let keyboard = null;
		for (const seg of message) if (seg.type === "markdown" && seg.data) markdown = String(seg.data.content || "");
		else if (seg.type === "keyboard" && seg.data) {
			const data = seg.data;
			const raw = data.content ?? data;
			if (typeof raw === "string") try {
				const parsed = JSON.parse(raw);
				keyboard = parsed && typeof parsed === "object" ? parsed : null;
			} catch {
				keyboard = null;
			}
			else keyboard = raw || null;
		}
		if (markdown && keyboard) return {
			markdown,
			keyboard
		};
		return null;
	}
};
/**
* 频道消息事件（`AT_MESSAGE_CREATE` / `MESSAGE_CREATE`）的字段提取 —— **纯函数**，便于单测。
*
* 官方频道事件的负载与群/单聊不同：给的是 `guild_id` + `channel_id` + `author.id`（不是 openid）。
* 返回 `null` 表示"缺关键字段（没有 channel_id），丢弃"—— **不猜** ✓
*/
function guildMessageFields(data) {
	const channelId = String(data.channel_id ?? "").trim();
	if (!channelId) return null;
	const author = data.author ?? {};
	return {
		channelId,
		guildId: String(data.guild_id ?? ""),
		userOpenid: String(author.id ?? author.user_openid ?? ""),
		content: String(data.content ?? ""),
		eventId: String(data.id ?? ""),
		nickname: String(author.username ?? "")
	};
}

export { UID_START, MAX_PENDING_SENDS, MAX_WS_BUFFERED, BACKPRESSURE_NOTIFY_INTERVAL_MS, writeWithRetry, BUS_PORT_BASE, resolveTranslatorPort, resolveUsableTranslatorPort, findFreePort, officialSenderType, translators, retryTimers, syncPortLeases, startTranslator, waitForTranslatorReady, stopMatchingTranslators, stopTranslator, stopAllTranslators, getTranslatorStatus, injectTestMessage, EventBus, guildMessageFields };
