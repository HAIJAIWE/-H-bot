// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { isGroupMutedNow } from "../../official/groupMute";

var getGroupInfo = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	if (!gid) {
		responder.fail(echo, "group_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/info`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var getGroupMemberInfo = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	const uid = host.resolveOpenid(params.user_id);
	if (!gid || !uid) {
		responder.fail(echo, "group_id 与 user_id 都不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/members/${uid}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var getGroupMemberList = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	if (!gid) {
		responder.fail(echo, "group_id 不能为空");
		return;
	}
	const limit = Math.min(Number(params.limit) || 30, 30);
	const qs = new URLSearchParams({ limit: String(limit) });
	if (params.cursor) qs.set("cursor", String(params.cursor));
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/members?${qs.toString()}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var setGroupBan = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	const uid = host.resolveOpenid(params.user_id);
	if (!gid || !uid) {
		responder.fail(echo, "group_id 与 user_id 都不能为空");
		return;
	}
	const seconds = Math.max(0, Math.min(Number(params.duration) || 0, 2592e3));
	const r = await host.callOfficialApi("POST", `/v2/groups/${gid}/restrict_chat_setting`, {
		members: [{
			op: seconds > 0 ? "add" : "del",
			user_openid: [uid]
		}],
		...seconds > 0 ? { duration: seconds } : {}
	});
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var setGroupKick = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	const uid = host.resolveOpenid(params.user_id);
	if (!gid || !uid) {
		responder.fail(echo, "group_id 与 user_id 都不能为空");
		return;
	}
	const r = await host.callOfficialApi("POST", `/v2/groups/${gid}/batch_remove_members`, {
		members: [uid],
		...params.reject_add_request ? { reject_add_request: true } : {}
	});
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var setGroupAddRequest = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	const uid = host.resolveOpenid(params.user_id);
	if (!gid || !uid) {
		responder.fail(echo, "group_id 与 user_id 都不能为空");
		return;
	}
	const approve = params.approve !== false;
	const r = await host.callOfficialApi("POST", `/v2/groups/${gid}/approval_join_request/${uid}`, {
		approve,
		...params.reason ? { reason: params.reason } : {}
	});
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var getGroupMuteState = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	if (!gid) {
		responder.fail(echo, "group_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/restrict_chat_setting`);
	if (!r.ok) {
		responder.fail(echo, r.error);
		return;
	}
	const state = r.data ?? {};
	const globalRule = state.global_rule ?? {};
	const mutedMembers = Array.isArray(state.members) ? state.members : [];
	responder.respond(echo, {
		group_id: params.group_id,
		mute_all: isGroupMutedNow(globalRule),
		mute_mode: String(globalRule.mode ?? "none"),
		global_rule: globalRule,
		members: mutedMembers.map((m) => {
			const rec = m ?? {};
			const openid = String(rec.member_openid ?? rec.user_openid ?? "");
			return {
				...rec,
				user_id: openid ? host.getOrCreateUid(openid) : rec.user_id
			};
		})
	});
};
var getGroupBotState = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	if (!gid) {
		responder.fail(echo, "group_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/bot_state`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var getGroupJoinRequests = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	if (!gid) {
		responder.fail(echo, "group_id 不能为空");
		return;
	}
	const qs = new URLSearchParams();
	if (params.cursor) qs.set("cursor", String(params.cursor));
	if (params.limit) qs.set("limit", String(Math.min(Number(params.limit) || 50, 50)));
	const suffix = qs.toString() ? `?${qs.toString()}` : "";
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/join_request_list${suffix}`);
	if (!r.ok) {
		responder.fail(echo, r.error);
		return;
	}
	const body = r.data ?? {};
	const rawList = Array.isArray(body.list) ? body.list : Array.isArray(body.requests) ? body.requests : [];
	responder.respond(echo, {
		requests: rawList.map((it) => {
			const rec = it ?? {};
			const openid = String(rec.member_openid ?? rec.user_openid ?? "");
			return {
				...rec,
				user_id: openid ? host.getOrCreateUid(openid) : rec.user_id
			};
		}),
		...body.next_cursor === void 0 ? {} : { next_cursor: body.next_cursor }
	});
};
var listGroupBlacklist = async (host, { params, echo, responder }) => {
	const gid = host.resolveOpenid(params.group_id);
	if (!gid) {
		responder.fail(echo, "group_id 不能为空");
		return;
	}
	const qs = new URLSearchParams();
	if (params.cursor) qs.set("cursor", String(params.cursor));
	if (params.limit) qs.set("limit", String(Math.min(Number(params.limit) || 100, 100)));
	const suffix = qs.toString() ? `?${qs.toString()}` : "";
	const r = await host.callOfficialApi("GET", `/v2/groups/${gid}/member_blacklist${suffix}`);
	if (!r.ok) {
		responder.fail(echo, r.error);
		return;
	}
	const body = r.data ?? {};
	const users = Array.isArray(body.users) ? body.users : Array.isArray(body.blacklist) ? body.blacklist : [];
	responder.respond(echo, {
		members: users.map((it) => {
			const rec = it ?? {};
			const openid = String(rec.member_openid ?? rec.user_openid ?? "");
			return {
				...rec,
				user_id: openid ? host.getOrCreateUid(openid) : rec.user_id
			};
		}),
		...body.next_cursor === void 0 ? {} : { next_cursor: body.next_cursor }
	});
};
var setEssenceMsg = async (host, { echo, responder }) => {
	responder.fail(echo, "「群精华消息」不可用：官方精华消息仅频道支持，QQ 群没有该能力（频道请用「频道操作」）");
};
var groupActions = {
	get_group_info: getGroupInfo,
	get_group_member_info: getGroupMemberInfo,
	get_group_member_list: getGroupMemberList,
	set_group_ban: setGroupBan,
	set_group_kick: setGroupKick,
	set_group_add_request: setGroupAddRequest,
	get_group_mute_state: getGroupMuteState,
	get_group_bot_state: getGroupBotState,
	get_group_join_requests: getGroupJoinRequests,
	list_group_blacklist: listGroupBlacklist,
	set_essence_msg: setEssenceMsg
};

export { getGroupInfo, getGroupMemberInfo, getGroupMemberList, setGroupBan, setGroupKick, setGroupAddRequest, getGroupMuteState, getGroupBotState, getGroupJoinRequests, listGroupBlacklist, setEssenceMsg, groupActions };
