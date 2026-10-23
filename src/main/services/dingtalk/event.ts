// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { buildParsedMessage, createStandardEvent } from "../../../shared/domain/common/standardEvent";

/** 只要字符串（钉钉有些字段是数字/布尔，统一转） */
function str(v) {
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
}
/** 毫秒时间戳；拿不到就用当前时间（**不产生 1970**） */
function msOrNow(v) {
	const n = typeof v === "number" ? v : Number(v);
	if (Number.isFinite(n) && n > 0) return n < 0xe8d4a51000 ? n * 1e3 : n;
	return Date.now();
}
/**
* 把钉钉机器人消息解析成 `StandardEvent`。
*
* 返回 `null` 表示**这不是一条能处理的消息**（缺会话或缺发送者）——
* 调用方据此忽略，**不要产出半截事件**。
*/
function parseDingTalkMessage(raw, rawEventType) {
	if (!raw || typeof raw !== "object") return null;
	const msg = raw;
	const conversationId = str(msg.conversationId);
	const userId = str(msg.senderStaffId) || str(msg.senderId);
	if (!conversationId || !userId) return null;
	const isGroup = str(msg.conversationType) === "2";
	/**
	* ⚠️ **群里 @ 机器人后，content 常以空格开头**（官方示例就是 `" 你好"`）——
	* 那个空格是 @ 占位留下的。不清理的话 `/签到` 会变成 ` ／签到`，
	* **触发器的 `/` 前缀匹配直接失效**（症状："机器人对 @ 没反应，私聊却正常"）。
	*/
	const text = extractText$1(msg).trim();
	const mentions = extractMentionNames(msg);
	const sessionWebhook = str(msg.sessionWebhook);
	return {
		event: createStandardEvent({
			platform: "dingtalk",
			type: "message",
			userId,
			displayName: str(msg.senderNick),
			senderType: void 0,
			role: msg.isAdmin === true ? "admin" : "member",
			groupId: isGroup ? conversationId : void 0,
			timestamp: msOrNow(msg.createAt),
			messageId: str(msg.msgId),
			rawEventType,
			subType: isGroup ? "group" : "private",
			rawMessage: text,
			parsed: buildParsedMessage(text, mentions),
			isToMe: isGroup ? msg.isInAtList === true : true,
			replyToken: sessionWebhook,
			replyTokenExpiresAt: sessionWebhook ? msOrNow(msg.sessionWebhookExpiredTime) : void 0,
			reply: async () => {
				throw new Error("DingTalkAdapter: reply 未绑定（应在发送通道就绪后替换）");
			}
		}, "dingtalk"),
		idempotencyKey: str(msg.msgId)
	};
}
/**
* 取出消息文本。
*
* ⚠️ 官方**两份示例对不上**（我在文档里记过这个矛盾）：
*   - Stream 模式示例：`"text": { "content": " 你好" }`（**对象**）
*   - HTTP 模式示例：请求体里直接是 `"content": " 你好"`（**平铺**）
* 所以**两种都认**，别只认一种。
*/
function extractText$1(msg) {
	const text = msg.text;
	if (typeof text === "string") return text;
	if (text && typeof text === "object") {
		const c = text.content;
		if (typeof c === "string") return c;
	}
	const flat = msg.content;
	return typeof flat === "string" ? flat : "";
}
/**
* 被 @ 的人的名字。
*
* 官方 `atUsers` 里只有 `dingtalkId` / `staffId`，**没有名字** ——
* 所以这里通常拿不到显示名，**如实返回空数组**（不编造）。
*/
function extractMentionNames(msg) {
	const at = msg.atUsers;
	if (!Array.isArray(at)) return [];
	const names = [];
	for (const u of at) {
		if (!u || typeof u !== "object") continue;
		const name = u.name;
		if (typeof name === "string" && name) names.push(name);
	}
	return names;
}

export { str, msOrNow, parseDingTalkMessage, extractText$1, extractMentionNames };
