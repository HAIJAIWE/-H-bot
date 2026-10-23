// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { buildParsedMessage, createStandardEvent } from "../../../shared/domain/common/standardEvent";

/** 幂等键：优先 v2.0 的 `header.event_id`，退回 v1.0 的 `uuid` */
function larkEventId(env) {
	return env.header?.event_id ?? env.uuid;
}
/** 事件类型：优先 v2.0 的 `header.event_type`，退回 v1.0 的 `type` */
function larkEventType(env) {
	return env.header?.event_type ?? env.type;
}
/** 飞书时间戳（`create_time` 是**毫秒**字符串） */
function parseLarkTime(raw) {
	if (typeof raw === "string" || typeof raw === "number") {
		const n = Number(raw);
		if (Number.isFinite(n) && n > 0) return n < 0xe8d4a51000 ? n * 1e3 : n;
	}
	return Date.now();
}
/**
* 把飞书事件解析成 `StandardEvent`。
*
* 目前只接 `im.message.receive_v1`；其他类型返回 `null`（加通知/成员变更时在此扩）。
*/
function parseLarkEvent(env) {
	const eventType = larkEventType(env);
	if (!eventType) return null;
	const event = env.event ?? {};
	const eventId = larkEventId(env);
	switch (eventType) {
		case "im.message.receive_v1": return parseMessageEvent(event, eventType, eventId, env);
		default: return null;
	}
}
function parseMessageEvent(event, rawEventType, eventId, env) {
	const message = event.message ?? {};
	const sender = event.sender ?? {};
	const senderId = sender.sender_id ?? {};
	const messageId = str$1(message.message_id);
	const chatId = str$1(message.chat_id);
	const chatType = str$1(message.chat_type);
	const messageType = str$1(message.message_type) ?? "unknown";
	const openId = str$1(senderId.open_id);
	const unionId = str$1(senderId.union_id);
	const userId = str$1(senderId.user_id);
	const userIdForFlow = openId || userId;
	if (!userIdForFlow) return null;
	const displayName = str$1(sender.name) ?? str$1(sender.sender_name) ?? str$1(event.sender_name) ?? void 0;
	const content = parseLarkContent(messageType, message.content, message.mentions);
	const senderTypeRaw = str$1(sender.sender_type);
	return {
		event: createStandardEvent({
			platform: "lark",
			type: "message",
			userId: userIdForFlow,
			displayName,
			unionId,
			senderType: senderTypeRaw === "user" || senderTypeRaw === "bot" ? senderTypeRaw : void 0,
			groupId: chatType === "group" ? chatId : void 0,
			timestamp: parseLarkTime(env.header?.create_time),
			messageId,
			rawEventType,
			subType: chatType === "group" ? "group" : "private",
			threadId: str$1(message.thread_id),
			rawMessage: content.raw,
			parsed: content.parsed,
			isToMe: chatType === "p2p" ? true : content.mentionsBot,
			reply: async () => {
				throw new Error("LarkAdapter: reply 未绑定（应在发送通道就绪后替换）");
			}
		}, "lark"),
		eventId,
		idempotencyKey: messageId ?? eventId
	};
}
/** 从纯文本造 ParsedMessage（统一出口，避免各处手搓形状） */
var textParsed = buildParsedMessage;
/**
* 解析飞书消息 `content`。
*
* ⚠️ `content` 是 **JSON 字符串**，不是对象（这是个容易踩的点）。
* 文本消息形如 `{"text":"<at user_id=\"ou_xxx\">机器人</at> 你好"}`。
*
* ## ⚠️ `mentions` 不在 `content` 里
*
* 我第一版从**解析后的 content** 里找 `mentions` —— 那里根本没有它，
* 于是 `mentionsBot` 恒为 `false`，群消息的 `is_to_me` 永远是假。
* 官方结构里 `mentions` 是 `message` 的字段，与 `content` **平级**
* （见官方「接收消息」事件体的 `message.mentions`），所以由调用方传进来。
*/
function parseLarkContent(messageType, contentRaw, messageMentions) {
	const rawStr = typeof contentRaw === "string" ? contentRaw : "";
	const mentionsRaw = Array.isArray(messageMentions) ? messageMentions : [];
	const mentionNames = [];
	for (const m of mentionsRaw) {
		const mm = m;
		const name = str$1(mm.name) ?? str$1(mm.id) ?? str$1(mm.key);
		if (name) mentionNames.push(name);
	}
	const mentionsBot = mentionsRaw.some((m) => {
		return m.mentioned_type === "bot";
	});
	let obj;
	try {
		obj = rawStr ? JSON.parse(rawStr) : {};
	} catch {
		return {
			raw: rawStr,
			parsed: textParsed(rawStr, mentionNames),
			mentionsBot
		};
	}
	if (messageType === "text") {
		const cleaned = (str$1(obj.text) ?? "").replace(/<at\s+user_id="[^"]*">([^<]*)<\/at>/g, "@$1");
		return {
			raw: cleaned,
			parsed: textParsed(cleaned, mentionNames),
			mentionsBot
		};
	}
	if (messageType === "post") {
		const text = extractPostText(obj);
		return {
			raw: text,
			parsed: textParsed(text, mentionNames),
			mentionsBot
		};
	}
	return {
		raw: `[${messageType}]`,
		parsed: {
			args: [],
			mentions: mentionNames,
			rawSegments: []
		},
		mentionsBot
	};
}
/** 从富文本（post）里抽纯文本 */
function extractPostText(obj) {
	const out = [];
	for (const lang of [
		"zh_cn",
		"en_us",
		"ja_jp"
	]) {
		const block = obj[lang];
		if (!block) continue;
		const title = str$1(block.title);
		if (title) out.push(title);
		const rows = Array.isArray(block.content) ? block.content : [];
		for (const row of rows) {
			if (!Array.isArray(row)) continue;
			for (const seg of row) {
				const s = seg;
				if (s.tag === "text" || s.tag === "md" || s.tag === "a") {
					const t = str$1(s.text);
					if (t) out.push(t);
				} else if (s.tag === "at") {
					const name = str$1(s.user_name) ?? str$1(s.user_id);
					if (name) out.push("@" + name);
				}
			}
		}
		if (out.length > 0) break;
	}
	return out.join(" ").trim();
}
function str$1(v) {
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
}

export { larkEventId, larkEventType, parseLarkTime, parseLarkEvent, parseMessageEvent, textParsed, parseLarkContent, extractPostText, str$1 };
