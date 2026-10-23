// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { emitSystemLog } from "../../runner/runtimeEvents";
import { sendOfficialMessage } from "../../official/messages";

var sendChannelMsg = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	if (!cid) {
		responder.fail(echo, "send_channel_msg 缺少 channel_id");
		return;
	}
	const cContent = typeof params.content === "string" ? params.content : "";
	const cRawMd = params.markdown;
	const cMarkdown = typeof cRawMd === "string" ? cRawMd.trim() ? { content: cRawMd } : null : cRawMd && typeof cRawMd === "object" ? cRawMd : null;
	const cArk = params.ark && typeof params.ark === "object" ? params.ark : null;
	const cEmbed = params.embed && typeof params.embed === "object" ? params.embed : null;
	const cImage = typeof params.image === "string" ? params.image.trim() : "";
	if (!cContent.trim() && !cMarkdown && !cArk && !(cEmbed && String(cEmbed.title ?? "").trim()) && !cImage) {
		responder.fail(echo, "send_channel_msg 至少要有一个内容字段（content / markdown / ark / embed / image）—— 官方原话是\"至少需要有一个字段，否则无法下发消息\"");
		return;
	}
	const cCtx = host.ctxFor(params, cid);
	const cOpts = {
		...host.messageExtras(params),
		markdown: cMarkdown,
		ark: cArk,
		embed: cEmbed
	};
	if (cImage) cOpts.mediaUrl = cImage;
	if (cCtx?.eventId) cOpts.eventId = cCtx.eventId;
	if (cCtx?.msgId) cOpts.msgId = cCtx.msgId;
	emitSystemLog(host.projectPath, "发送频道消息: channel=" + cid + ", 形态=" + (cMarkdown ? "markdown" : cArk ? "ark" : cEmbed ? "embed" : cImage ? "image" : "text"));
	const cRes = await sendOfficialMessage(host.projectPath, "channel", cid, cContent, cOpts);
	if (!cRes.ok) {
		responder.fail(echo, "发送频道消息失败：" + (cRes.error || "官方 API 返回失败（详见日志）"));
		return;
	}
	responder.respond(echo, { message_id: cRes.data?.id || "" });
};
var channelList = async (host, { params, echo, responder }) => {
	const gid = String(params.guild_id ?? "").trim();
	if (!gid) {
		responder.fail(echo, "guild_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/guilds/${gid}/channels`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var channelGet = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	if (!cid) {
		responder.fail(echo, "channel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/channels/${cid}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var channelCreate = async (host, { params, echo, responder }) => {
	const gid = String(params.guild_id ?? "").trim();
	if (!gid) {
		responder.fail(echo, "guild_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("POST", `/guilds/${gid}/channels`, params.body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var channelUpdate = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	if (!cid) {
		responder.fail(echo, "channel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("PATCH", `/channels/${cid}`, params.body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var channelDelete = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	if (!cid) {
		responder.fail(echo, "channel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("DELETE", `/channels/${cid}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var announceCreate = async (host, { params, echo, responder }) => {
	const gid = String(params.guild_id ?? "").trim();
	if (!gid) {
		responder.fail(echo, "guild_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("POST", `/guilds/${gid}/announces`, params.body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var announceDelete = async (host, { params, echo, responder }) => {
	const gid = String(params.guild_id ?? "").trim();
	const mid = String(params.message_id ?? "").trim();
	if (!gid || !mid) {
		responder.fail(echo, "guild_id 与 message_id 都不能为空（删全部公告用 all）");
		return;
	}
	const r = await host.callOfficialApi("DELETE", `/guilds/${gid}/announces/${encodeURIComponent(mid)}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var pinAdd = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	const mid = String(params.message_id ?? "").trim();
	if (!cid || !mid) {
		responder.fail(echo, "channel_id 与 message_id 都不能为空");
		return;
	}
	const r = await host.callOfficialApi("PUT", `/channels/${cid}/pins/${mid}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var pinList = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	if (!cid) {
		responder.fail(echo, "channel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/channels/${cid}/pins`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var pinRemove = async (host, { params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	const mid = String(params.message_id ?? "").trim();
	if (!cid || !mid) {
		responder.fail(echo, "channel_id 与 message_id 都不能为空（删全部用 all）");
		return;
	}
	const r = await host.callOfficialApi("DELETE", `/channels/${cid}/pins/${encodeURIComponent(mid)}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var reactionEmoji = async (host, { action, params, echo, responder }) => {
	const cid = String(params.channel_id ?? "").trim();
	const mid = String(params.message_id ?? "").trim();
	const emojiType = String(params.emoji_type ?? "system") === "unicode" ? "emoji" : "system";
	const emojiId = String(params.emoji_id ?? "").trim();
	if (!cid || !mid || !emojiId) {
		responder.fail(echo, "channel_id、message_id、emoji_id 都不能为空");
		return;
	}
	const path = `/channels/${cid}/messages/${mid}/reactions/${emojiType}/${encodeURIComponent(emojiId)}`;
	const method = action === "reaction_add" ? "PUT" : action === "reaction_remove" ? "DELETE" : "GET";
	const r = await host.callOfficialApi(method, path);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var channelActions = {
	send_channel_msg: sendChannelMsg,
	channel_list: channelList,
	channel_get: channelGet,
	channel_create: channelCreate,
	channel_update: channelUpdate,
	channel_delete: channelDelete,
	announce_create: announceCreate,
	announce_delete: announceDelete,
	pin_add: pinAdd,
	pin_list: pinList,
	pin_remove: pinRemove,
	reaction_add: reactionEmoji,
	reaction_remove: reactionEmoji,
	reaction_users: reactionEmoji
};

export { sendChannelMsg, channelList, channelGet, channelCreate, channelUpdate, channelDelete, announceCreate, announceDelete, pinAdd, pinList, pinRemove, reactionEmoji, channelActions };
