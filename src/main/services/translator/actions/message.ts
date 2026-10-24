// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { emitSystemLog } from "../../runner/runtimeEvents";
import { recallOfficialMessage, sendOfficialMedia, sendOfficialMessage, sendOfficialStreamMessage } from "../../official/messages";
import { mediaFileTypeOf } from "../../official/media";

var sendPrivateMsg = async (host, { params, echo, responder }) => {
	const uid = Number(params.user_id || 0);
	const openid = host.getOpenidByUid(uid) || String(params.user_id || "");
	const text = host.extractText(params.message);
	const ctx = host.ctxFor(params, openid);
	const opts = { ...host.messageExtras(params) };
	if (ctx) {
		opts.eventId = ctx.eventId;
		opts.msgId = ctx.msgId;
		if (ctx.msgSeq != null) {
			opts.msgSeq = ctx.msgSeq;
			ctx.msgSeq = ctx.msgSeq + 1 & 2147483647;
		}
	}
	emitSystemLog(host.projectPath, "准备发送: 用户UID=" + uid + ", openid=" + openid + ", text=\"" + text.slice(0, 50) + "\"");
	const sentId = (await sendOfficialMessage(host.projectPath, "c2c", openid, text, opts)).data?.id || "";
	if (sentId) host.messageIdToContext.set(String(sentId), {
		chatType: "c2c",
		chatId: openid
	});
	responder.respond(echo, { message_id: sentId });
};
var sendInputNotify = async (host, { params, echo, responder }) => {
	const niOpenidParam = String(params.user_openid || "");
	const niUid = Number(params.user_id || 0);
	if (params.group_id || String(params.message_type || "") === "group") {
		responder.fail(echo, "输入中状态只有单聊：官方 msg_type=6 仅 C2C 端点有这个字段，群聊发不出去");
		return;
	}
	const niOpenid = niOpenidParam || host.getOpenidByUid(niUid) || String(params.user_id || "");
	if (!niOpenid) {
		responder.fail(echo, "send_input_notify 缺少目标：需要 user_id 或 user_openid");
		return;
	}
	const niOpts = {
		msgType: 6,
		inputNotifySeconds: params.input_second
	};
	const niCtx = host.ctxFor(params, niOpenid);
	if (niCtx) {
		niOpts.eventId = niCtx.eventId;
		niOpts.msgId = niCtx.msgId;
		if (niCtx.msgSeq != null) {
			niOpts.msgSeq = niCtx.msgSeq;
			niCtx.msgSeq = niCtx.msgSeq + 1 & 2147483647;
		}
	}
	const niRes = await sendOfficialMessage(host.projectPath, "c2c", niOpenid, "", niOpts);
	if (!niRes.ok) responder.fail(echo, "输入中状态发送失败：QQ 官方 API 返回失败（详见日志）");
	else responder.respond(echo, { message_id: niRes.data?.id || "" });
};
var sendMsg = async (host, { params, echo, responder }) => {
	const msgType = params.message_type;
	/**
	* 频道消息（guild）的回复：目标是 **channel_id**，没有 uid 可反查（频道不是"人"）。
	*
	* 2026-10-05 补：此前这里一律要求 user_id/group_id → 「频道消息触发 → 直接回复」必然报
	* 「send_message 缺少目标」✗，用户只能改成"填死目标"的频道推送模式。
	*/
	const isChannel = msgType === "channel";
	const channelId = isChannel ? String(params.channel_id ?? "").trim() : "";
	const uid = Number(msgType === "group" ? params.group_id || 0 : params.user_id || 0);
	if (isChannel && !channelId) {
		responder.fail(echo, "send_message 频道消息缺少 channel_id（\"回复当前会话\"应从频道事件里带上）");
		return;
	}
	if (!isChannel && !uid) {
		responder.fail(echo, "send_message 缺少目标：需要 user_id / group_id（频道消息用 channel_id）；\"回复当前会话\"请带上来源事件的目标");
		return;
	}
	const openid = isChannel ? channelId : host.getOpenidByUid(uid) || String(uid);
	const ctx = host.ctxFor(params, openid);
	const chatType = msgType === "group" ? "group" : isChannel ? "channel" : "c2c";
	const mk = host.extractMarkdownKeyboard(params.message);
	if (mk) {
		const kOpts = {
			msgType: 2,
			markdown: { content: mk.markdown },
			keyboard: mk.keyboard
		};
		if (Array.isArray(params.message) && params.message.some((s) => s?.type === "markdown" && s.data?.force_verify_image_resource === true)) kOpts.forceVerifyImageResource = true;
		if (ctx) {
			kOpts.eventId = ctx.eventId;
			kOpts.msgId = ctx.msgId;
			if (ctx.msgSeq != null) {
				kOpts.msgSeq = ctx.msgSeq;
				ctx.msgSeq = ctx.msgSeq + 1 & 2147483647;
			}
		}
		emitSystemLog(host.projectPath, "send_message 检测到按钮消息段，路由到 keyboard API: chatType=" + chatType + ", openid=" + openid);
		const kRes = await sendOfficialMessage(host.projectPath, chatType, openid, "", kOpts);
		emitSystemLog(host.projectPath, "发送结果: ok=" + kRes.ok + ", id=" + (kRes.data?.id || "无"));
		const kSentId = kRes.data?.id || "";
		if (kSentId) host.messageIdToContext.set(String(kSentId), {
			chatType,
			chatId: openid
		});
		if (!kRes.ok) responder.fail(echo, "发送按钮消息失败：QQ 官方 API 返回失败（详见日志）");
		else responder.respond(echo, { message_id: kSentId });
		return;
	}
	const text = host.extractText(params.message);
	const opts = { ...host.messageExtras(params) };
	if (ctx) {
		opts.eventId = ctx.eventId;
		opts.msgId = ctx.msgId;
		if (ctx.msgSeq != null) {
			opts.msgSeq = ctx.msgSeq;
			ctx.msgSeq = ctx.msgSeq + 1 & 2147483647;
		}
	}
	emitSystemLog(host.projectPath, "准备发送: chatType=" + chatType + (chatType === "group" ? ", 群UID=" : ", 用户UID=") + uid + ", openid=" + openid + ", text=\"" + text.slice(0, 50) + "\"");
	const res = await sendOfficialMessage(host.projectPath, chatType, openid, text, opts);
	emitSystemLog(host.projectPath, "发送结果: ok=" + res.ok + ", id=" + (res.data?.id || "无"));
	const sSentId = res.data?.id || "";
	if (sSentId) host.messageIdToContext.set(String(sSentId), {
		chatType,
		chatId: openid
	});
	responder.respond(echo, { message_id: sSentId });
};
var sendGroupMsg = async (host, { params, echo, responder }) => {
	const uid = Number(params.group_id || 0);
	const openid = host.getOpenidByUid(uid) || String(params.group_id || "");
	const text = host.extractText(params.message);
	const ctx = host.ctxFor(params, openid);
	const opts = { ...host.messageExtras(params) };
	if (ctx) {
		opts.eventId = ctx.eventId;
		opts.msgId = ctx.msgId;
		if (ctx.msgSeq != null) {
			opts.msgSeq = ctx.msgSeq;
			ctx.msgSeq = ctx.msgSeq + 1 & 2147483647;
		}
	}
	const gSentId = (await sendOfficialMessage(host.projectPath, "group", openid, text, opts)).data?.id || "";
	if (gSentId) host.messageIdToContext.set(String(gSentId), {
		chatType: "group",
		chatId: openid
	});
	responder.respond(echo, { message_id: gSentId });
};
var sendKeyboardMsg = async (host, { params, echo, responder }) => {
	const markdown = params.markdown;
	const keyboard = params.keyboard;
	const msgId = params.msg_id;
	const kMsgType = params.message_type;
	const kUid = Number(kMsgType === "group" ? params.group_id || 0 : params.user_id || 0);
	const kOpenid = host.getOpenidByUid(kUid) || String(kUid);
	const kCtx = host.ctxFor(params, kOpenid);
	const kChatType = kMsgType === "group" ? "group" : "c2c";
	const kOpts = {
		msgType: 2,
		markdown: { content: markdown },
		keyboard
	};
	if (msgId) kOpts.msgId = msgId;
	if (kCtx) {
		kOpts.eventId = kCtx.eventId;
		kOpts.msgId = kOpts.msgId || kCtx.msgId;
		if (kCtx.msgSeq != null) {
			kOpts.msgSeq = kCtx.msgSeq;
			kCtx.msgSeq = kCtx.msgSeq + 1 & 2147483647;
		}
	}
	emitSystemLog(host.projectPath, "发送按钮消息: chatType=" + kChatType + ", openid=" + kOpenid);
	const kRes = await sendOfficialMessage(host.projectPath, kChatType, kOpenid, "", kOpts);
	emitSystemLog(host.projectPath, "发送结果: ok=" + kRes.ok + ", id=" + (kRes.data?.id || "无"));
	const kSentId = kRes.data?.id || "";
	if (kSentId) host.messageIdToContext.set(String(kSentId), {
		chatType: kChatType,
		chatId: kOpenid
	});
	if (!kRes.ok) responder.fail(echo, "发送按钮消息失败：QQ 官方 API 返回失败（详见日志）");
	else responder.respond(echo, { message_id: kSentId });
};
var sendMedia = async (host, { params, echo, responder }) => {
	const url = String(params.url ?? "").trim();
	if (!url) {
		responder.fail(echo, "富媒体缺少 url");
		return;
	}
	const mMsgType = params.message_type;
	const mUid = Number(mMsgType === "group" ? params.group_id || 0 : params.user_id || 0);
	const mOpenid = host.getOpenidByUid(mUid) || String((mMsgType === "group" ? params.group_id : params.user_id) || "");
	if (!mOpenid || mOpenid === "0") {
		responder.fail(echo, "富媒体发送缺少有效目标（message_type + 目标 id）");
		return;
	}
	const mCtx = host.ctxFor(params, mOpenid);
	const mFileType = mediaFileTypeOf(params.media_type) ?? 1;
	const mFileName = typeof params.file_name === "string" && params.file_name.trim() ? params.file_name.trim() : void 0;
	emitSystemLog(host.projectPath, "发送富媒体: openid=" + mOpenid + ", fileType=" + mFileType + ", url=" + url.slice(0, 60));
	const mRes = await sendOfficialMedia(host.projectPath, mMsgType === "group" ? "group" : "c2c", mOpenid, url, mFileType, mFileName, mCtx ? {
		eventId: mCtx.eventId,
		msgId: mCtx.msgId
	} : void 0);
	if (!mRes.ok) responder.fail(echo, "发送富媒体失败：" + (mRes.error || "官方 API 返回失败（详见日志）"));
	else responder.respond(echo, { message_id: "" });
};
var sendStreamMsg = async (host, { params, echo, responder }) => {
	if (params.message_type === "group" || params.group_id) {
		responder.fail(echo, "流式消息仅支持单聊（官方只有单聊流式端点）");
		return;
	}
	const sUid = Number(params.user_id || 0);
	const sOpenid = host.getOpenidByUid(sUid) || String(params.user_id || "");
	if (!sOpenid || sOpenid === "0") {
		responder.fail(echo, "流式发送缺少有效目标（user_id）");
		return;
	}
	const sCtx = host.ctxFor(params, sOpenid);
	const sRes = await sendOfficialStreamMessage(host.projectPath, sOpenid, String(params.content_raw ?? ""), {
		contentType: typeof params.content_type === "string" ? params.content_type : "text",
		index: Number(params.index ?? 0),
		inputState: Number(params.input_state) === 10 ? 10 : 1,
		...typeof params.stream_msg_id === "string" && params.stream_msg_id ? { streamMsgId: params.stream_msg_id } : {},
		...sCtx ? {
			eventId: sCtx.eventId,
			msgId: sCtx.msgId
		} : {},
		...sCtx?.msgSeq != null ? { msgSeq: sCtx.msgSeq } : {}
	});
	if (sCtx?.msgSeq != null) sCtx.msgSeq = sCtx.msgSeq + 1 & 2147483647;
	if (!sRes.ok) responder.fail(echo, "流式发送失败（官方 API 返回失败，详见运行日志）");
	else responder.respond(echo, { message_id: sRes.data?.id || "" });
};
var deleteMsg = async (host, { params, echo, responder }) => {
	const dMsgId = String(params.message_id || "");
	if (!dMsgId) {
		responder.fail(echo, "delete_message 缺少 message_id 参数");
		return;
	}
	const ctxInfo = host.messageIdToContext.get(dMsgId);
	if (!ctxInfo) {
		responder.fail(echo, "找不到消息对应的会话上下文（仅支持撤回本翻译器发送的消息）");
		return;
	}
	if (await recallOfficialMessage(host.projectPath, ctxInfo.chatType, ctxInfo.chatId, dMsgId)) {
		host.messageIdToContext.delete(dMsgId);
		responder.respond(echo, {});
	} else responder.fail(echo, "撤回消息失败（API 返回失败或会话已断开）");
};
var messageActions = {
	send_private_message: sendPrivateMsg,
	send_input_notify: sendInputNotify,
	send_message: sendMsg,
	send_group_message: sendGroupMsg,
	send_keyboard_message: sendKeyboardMsg,
	send_media: sendMedia,
	send_stream_message: sendStreamMsg,
	delete_message: deleteMsg
};

export { sendPrivateMsg, sendInputNotify, sendMsg, sendGroupMsg, sendKeyboardMsg, sendMedia, sendStreamMsg, deleteMsg, messageActions };
