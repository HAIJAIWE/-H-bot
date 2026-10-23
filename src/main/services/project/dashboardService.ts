// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { botManager } from "../bot/botManager";
import { getDb, init_dataService } from "./dataService";
import { init_logger, logger } from "../infra/logger";
import { getTranslatorStatus } from "../runner/eventBus";

/**
* 旧版（NapCat 时代）消息库的落点。
*
* 2026-10-18 隔离审计 RT-19 / 4.8：这个库**已经没有写入方**，但面板在
* 「翻译器没跑」时会回落到它来展示消息数 / 时间线 / 群列表，于是历史数据
* 会被当成当前数据看。这里把它收成一个具名常量 + 首次使用时打一条 warn，
* 至少让"这个数字来自历史库"在日志里有据可查。
*
* 为什么**不删**：那是用户真实的历史消息，删了就再也找不回来。
* 要彻底消除歧义得让 UI 标出数据来源（返回结构加字段），那是另一个改动，
* 见计划 §3.1 的 P4 未做项。
*/
var LEGACY_MESSAGES_DB = [
	"data",
	"logs",
	"messages.db"
];
var legacyMessagesWarned = false;
/** 旧消息库路径；不存在时返回 null */
function legacyMessagesDbPath(projectPath) {
	const dbPath = path.join(projectPath, ...LEGACY_MESSAGES_DB);
	if (!fs.existsSync(dbPath)) return null;
	if (!legacyMessagesWarned) {
		legacyMessagesWarned = true;
		logger.warn("[dashboard] 面板数据回落到旧版 messages.db（历史消息库，已无写入方）—— 这些数字来自历史数据，不是当前运行状态");
	}
	return dbPath;
}
function getDashboardStatus(projectPath) {
	const botStatus = botManager.getBotStatus(projectPath);
	const running = botStatus?.status === "running";
	const startedAt = botStatus?.startedAt;
	const onlineTime = running && startedAt ? Date.now() - new Date(startedAt).getTime() : 0;
	let messageCount = 0;
	const translatorStatus = getTranslatorStatus(void 0, projectPath);
	if (translatorStatus?.running) messageCount = translatorStatus.messageCount ?? 0;
	if (messageCount === 0) {
		const messagesDbPath = legacyMessagesDbPath(projectPath);
		if (messagesDbPath) try {
			messageCount = getDb(messagesDbPath).prepare("SELECT COUNT(*) as c FROM messages").get().c;
		} catch {}
	}
	return {
		running,
		onlineTime,
		messageCount,
		groupCount: 0,
		memberCount: 0
	};
}
function getTimeline(projectPath) {
	const translatorStatus = getTranslatorStatus(void 0, projectPath);
	if (translatorStatus?.running && translatorStatus.recentEvents?.length) return translatorStatus.recentEvents.map((e, i) => ({
		id: Date.now() - i,
		time: e.time,
		content: e.content,
		type: e.type
	}));
	const messagesDbPath = path.join(projectPath, "data", "logs", "messages.db");
	if (!fs.existsSync(messagesDbPath)) return [];
	try {
		return getDb(messagesDbPath).prepare("SELECT rowid as id, * FROM messages ORDER BY rowid DESC LIMIT 20").all().map((r) => ({
			id: r.id,
			time: r.time ?? (/* @__PURE__ */ new Date()).toLocaleTimeString(),
			content: r.content ?? JSON.stringify(r),
			type: r.type ?? "message"
		}));
	} catch (e) {
		logger.warn("[dashboardService] 时间线查询失败:", e);
		return [];
	}
}
function getGroups(projectPath) {
	const messagesDbPath = legacyMessagesDbPath(projectPath);
	if (!messagesDbPath) return [];
	try {
		const db = getDb(messagesDbPath);
		if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'").get()) return db.prepare("SELECT * FROM groups").all().map((g) => ({
			groupId: String(g.group_id ?? g.id ?? ""),
			groupName: String(g.group_name ?? g.name ?? g.group_id ?? ""),
			memberCount: g.member_count ?? 0
		}));
		return db.prepare("SELECT DISTINCT group_id FROM messages WHERE group_id IS NOT NULL").all().map((g) => ({
			groupId: String(g.group_id),
			groupName: String(g.group_id),
			memberCount: 0
		}));
	} catch (e) {
		logger.warn("[dashboardService] 群组查询失败:", e);
		return [];
	}
}

export { LEGACY_MESSAGES_DB, legacyMessagesWarned, legacyMessagesDbPath, getDashboardStatus, getTimeline, getGroups };
