// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/** 官方事件名 → 下拉取值。这 9 个都由 `1<<25`（GROUP_AND_C2C_EVENT）送达，不需要额外资质。 */
var NOTICE_OF = {
	GROUP_ADD_ROBOT: "group_add_robot",
	GROUP_DEL_ROBOT: "group_del_robot",
	GROUP_MSG_RECEIVE: "group_msg_receive",
	GROUP_MSG_REJECT: "group_msg_reject",
	C2C_MSG_RECEIVE: "c2c_msg_receive",
	C2C_MSG_REJECT: "c2c_msg_reject",
	FRIEND_ADD: "friend_add",
	FRIEND_DEL: "friend_del",
	SUBSCRIBE_MESSAGE_STATUS: "subscribe_message_status",
	GUILD_CREATE: "guild_create",
	GUILD_UPDATE: "guild_update",
	GUILD_DELETE: "guild_delete",
	CHANNEL_CREATE: "channel_create",
	CHANNEL_UPDATE: "channel_update",
	CHANNEL_DELETE: "channel_delete",
	GROUP_MEMBER_ADD: "group_member_add",
	GROUP_MEMBER_REMOVE: "group_member_remove",
	GROUP_JOIN_REQUEST: "group_join_request"
};
Object.keys(NOTICE_OF);
/**
* 把官方通知事件解析成 `NoticeEvent`；**不是通知事件就返回 null**。
*
* 字段取自官方各事件的负载（`group_openid` / `op_member_openid` / `openid`），
* 并对缺字段做兜底（官方不同事件给的字段名不完全一致）。
*/
function noticeEventOf(type, data) {
	const noticeType = NOTICE_OF[type];
	if (!noticeType) return null;
	const author = data.author ?? {};
	const pick = (...vals) => {
		for (const v of vals) {
			const s = String(v ?? "").trim();
			if (s) return s;
		}
		return "";
	};
	return {
		noticeType,
		userOpenid: pick(data.openid, data.user_openid, author.user_openid, author.member_openid),
		groupOpenid: pick(data.group_openid, data.guild_id),
		operatorOpenid: pick(data.op_member_openid, data.operator_openid, author.member_openid, data.op_user_id),
		channelId: pick(data.channel_id)
	};
}

export { NOTICE_OF, noticeEventOf };
