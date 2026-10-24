// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/**
* 提取上下文信息（mode 切换）。
*
* 历史：原实现是 `getContext(bot, event, key)` 且**直接返回 `{ value: null }`** ——
* 一个什么都不做的空壳。而模板里用了它 83 次（取时长参数、取 @ 对象、取群号…），
* 于是模板项目跑起来"全部成功但什么都不发生"。这里按目录声明的 mode 真正实现。
*
* 需要调用 QQ 接口的模式（group_members / user_name / group_name）在接口不可用或
* 当前接入不支持时返回**明确错误**，而不是静默返回 null。
*/
async function getContext(bot, event, options = {}) {
	const opts = typeof options === "string" ? { mode: options } : options ?? {};
	const mode = String(opts.mode || "user_id");
	const ev = event;
	const num = (v) => v === void 0 || v === null ? "" : v;
	const index = Number(opts.index ?? 0) || 0;
	const ok = (result, extra = {}) => ({
		success: true,
		error: "",
		result,
		...extra
	});
	const fail = (error) => ({
		success: false,
		error,
		result: null
	});
	switch (mode) {
		case "user_id": return ok(num(ev.user_id));
		case "group_id": return ok(num(ev.group_id));
		case "self_id": return ok(num(ev.self_id));
		case "operator_id": return ok(num(ev.operator_id ?? ev.user_id));
		case "message_id": return ok(num(ev.message_id));
		case "sub_type": return ok(String(ev.sub_type ?? ""));
		case "raw_message": return ok(String(ev.raw_message ?? messageTextOf(event)));
		case "message_text": return ok(messageTextOf(event));
		case "command_args": {
			const args = commandArgsOf(event);
			return ok((index < 0 ? args[args.length + index] : args[index]) ?? "", { args_list: args });
		}
		case "message_part": {
			const wanted = String(opts.part_mode || "at");
			const synthesized = [];
			const refIdx = ev._ref_idx;
			if (refIdx !== void 0 && refIdx !== null && String(refIdx) !== "") synthesized.push({
				type: "reply",
				data: { id: String(refIdx) }
			});
			if (ev.ark_data && typeof ev.ark_data === "object") synthesized.push({
				type: "json",
				data: ev.ark_data
			});
			const parts = [...segmentsOf(event).filter((s) => s?.type === wanted), ...synthesized.filter((s) => s.type === wanted)];
			const partList = parts.map((s) => s.data ?? {});
			const picked = index < 0 ? parts[parts.length + index] : parts[index];
			return ok(wanted === "at" && picked ? String(picked.data?.qq ?? "") : picked?.data ?? null, {
				part_list: partList,
				part_count: parts.length
			});
		}
		case "message_ref": {
			const refIdx = ev._ref_idx;
			if (refIdx !== void 0 && refIdx !== null && String(refIdx) !== "") return ok(String(refIdx));
			return ok(ev.message_id === void 0 || ev.message_id === null ? "" : String(ev.message_id));
		}
		case "group_members": {
			const gid = String(opts.group_id || ev.group_id || "");
			if (!gid) return fail("group_members 需要群号（当前事件不在群里）");
			try {
				const params = { group_id: Number(gid) };
				if (opts.cursor) params.cursor = String(opts.cursor);
				const raw = await bot.callApi("get_group_member_list", params);
				const list = Array.isArray(raw) ? raw : Array.isArray(raw?.members) ? raw.members : [];
				const next = Array.isArray(raw) ? void 0 : raw?.next_cursor;
				return ok(list, {
					members: list,
					next_cursor: next === void 0 ? "" : String(next)
				});
			} catch (e) {
				return fail(`获取群成员失败（当前接入可能不支持该接口）: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		case "user_name": {
			const uid = String(opts.user_id || ev.user_id || "");
			const gid = String(opts.group_id || ev.group_id || "");
			if (!uid) return fail("user_name 需要 QQ 号（当前事件没有触发者）");
			try {
				const info = await bot.callApi("get_group_member_info", {
					group_id: gid ? Number(gid) : void 0,
					user_id: Number(uid)
				});
				const card = String(info?.card ?? "");
				const nickname = String(info?.nickname ?? "");
				const name = card || nickname;
				if (!name) return fail("获取昵称失败：接口未返回昵称");
				return ok(name, {
					card,
					nickname
				});
			} catch (e) {
				return fail(`获取昵称失败（当前接入可能不支持该接口）: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		case "group_name": {
			const gid = String(opts.group_id || ev.group_id || "");
			if (!gid) return fail("group_name 需要群号（当前事件不在群里）");
			try {
				const name = (await bot.callApi("get_group_info", { group_id: Number(gid) }))?.group_name || "";
				if (!name) return fail("获取群名称失败：接口未返回群名");
				return ok(name);
			} catch (e) {
				return fail(`获取群名称失败（当前接入可能不支持该接口）: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		case "member_info": {
			const uid = String(opts.user_id || ev.user_id || "");
			const gid = String(opts.group_id || ev.group_id || "");
			if (!uid) return fail("member_info 需要 QQ 号（当前事件没有触发者）");
			try {
				const info = await bot.callApi("get_group_member_info", {
					group_id: gid ? Number(gid) : void 0,
					user_id: Number(uid)
				});
				const role = String(info?.role ?? "");
				const isAdmin = role === "admin" || role === "owner";
				return ok({
					...info ?? {},
					is_admin: isAdmin
				}, {
					role,
					is_admin: isAdmin
				});
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (/11253|无接口访问权限/.test(msg)) return fail(`获取群成员信息失败：该接口需内邀接入中（应用无接口访问权限）: ${msg}`);
				return fail(`获取群成员信息失败: ${msg}`);
			}
		}
		case "bot_state": {
			const gid = String(opts.group_id || ev.group_id || "");
			if (!gid) return fail("bot_state 需要群号（当前事件不在群里）");
			try {
				const info = await bot.callApi("get_group_bot_state", { group_id: Number(gid) });
				const isAdmin = info?.is_admin === true;
				return ok(isAdmin, {
					is_admin: isAdmin,
					role: String(info?.role ?? ""),
					recv_msg_setting: String(info?.recv_msg_setting ?? "")
				});
			} catch (e) {
				return fail(`获取机器人群内状态失败，需机器人是群管理员: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		case "join_requests": {
			const gid = String(opts.group_id || ev.group_id || "");
			if (!gid) return fail("join_requests 需要群号（当前事件不在群里）");
			try {
				const params = { group_id: Number(gid) };
				if (opts.cursor) params.cursor = String(opts.cursor);
				const info = await bot.callApi("get_group_join_requests", params);
				const requests = Array.isArray(info?.requests) ? info.requests : Array.isArray(info?.list) ? info.list : [];
				const next = info?.next_cursor;
				return ok(requests, {
					members: requests,
					next_cursor: next === void 0 ? "" : String(next)
				});
			} catch (e) {
				return fail(`获取入群申请失败，需机器人是群管理员: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		case "blacklist_list": {
			const gid = String(opts.group_id || ev.group_id || "");
			if (!gid) return fail("blacklist_list 需要群号（当前事件不在群里）");
			try {
				const params = { group_id: Number(gid) };
				if (opts.cursor) params.cursor = String(opts.cursor);
				const info = await bot.callApi("list_group_blacklist", params);
				const users = Array.isArray(info?.users) ? info.users : Array.isArray(info?.members) ? info.members : [];
				const next = info?.next_cursor;
				return ok(users, {
					members: users,
					next_cursor: next === void 0 ? "" : String(next)
				});
			} catch (e) {
				return fail(`获取群黑名单失败（该能力目前为内邀接入中）: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		case "group_mute_state": {
			const gid = String(opts.group_id || ev.group_id || "");
			if (!gid) return fail("group_mute_state 需要群号（当前事件不在群里）");
			try {
				const info = await bot.callApi("get_group_mute_state", { group_id: Number(gid) });
				return ok(info?.mute_all === true, {
					mute_mode: String(info?.mute_mode ?? "none"),
					mute_rules: info?.global_rule ?? {
						mode: "none",
						schedule_rules: [],
						recurring_rules: []
					},
					muted_members: Array.isArray(info?.members) ? info.members : []
				});
			} catch (e) {
				return fail(`获取群禁言状态失败，需机器人是群管理员: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		default: return fail(`未知 mode: ${mode}`);
	}
}
/** 把消息段数组里的文本拼起来（message_text 模式用） */
function messageTextOf(event) {
	const msg = event.message;
	if (typeof msg === "string") return msg;
	if (Array.isArray(msg)) return msg.map((seg) => {
		const s = seg;
		if (s?.type === "text") return String(s.data?.text ?? "");
		if (s?.type === "at") return `@${String(s.data?.qq ?? "")}`;
		return "";
	}).join("");
	if (typeof event.get_message === "function") try {
		return String(event.get_message());
	} catch {
		return "";
	}
	return "";
}
/** 取消息段数组（兼容运行时事件的 array 格式与单个段对象） */
function segmentsOf(event) {
	const msg = event.message;
	if (Array.isArray(msg)) return msg;
	if (msg && typeof msg === "object") return [msg];
	return [];
}
/** 指令参数解析：`/禁言 @某人 600` → ['@某人', '600']（去掉指令名与前缀） */
function commandArgsOf(event) {
	const raw = String(event.raw_message ?? messageTextOf(event) ?? "").trim();
	if (!raw) return [];
	return raw.split(/\s+/).filter(Boolean).slice(1);
}
/** 每个拆分节点的模式白名单（顺序即面板顺序，第一项是默认值） */
var SPLIT_CONTEXT_MODES = {
	get_ids: [
		"user_id",
		"group_id",
		"self_id",
		"operator_id"
	],
	get_message: [
		"message_text",
		"raw_message",
		"message_id",
		"message_ref",
		"message_part",
		"sub_type",
		"command_args"
	],
	get_profile: [
		"user_name",
		"member_info",
		"group_name",
		"group_members",
		"group_mute_state",
		"join_requests",
		"blacklist_list",
		"bot_state"
	]
};
/** 拆分节点共用的执行体：校验模式 ∈ 白名单，然后交给 getContext */
async function runSplitContext(kind, bot, event, options = {}) {
	const opts = typeof options === "string" ? { mode: options } : { ...options ?? {} };
	const allowed = SPLIT_CONTEXT_MODES[kind];
	const mode = String(opts.mode ?? allowed[0]);
	if (!allowed.includes(mode)) return {
		success: false,
		result: null,
		error: `节点「${kind}」不支持模式「${mode}」（可选：${allowed.join(" / ")}）`
	};
	return getContext(bot, event, {
		...opts,
		mode
	});
}
/** 取身份 ID（事件自带，零开销） */
function getIds(bot, event, options = {}) {
	return runSplitContext("get_ids", bot, event, options);
}
/** 取消息内容（文本 / 原文 / ID / 引用 / 片段 / 子类型 / 指令参数） */
function getMessageContext(bot, event, options = {}) {
	return runSplitContext("get_message", bot, event, options);
}
/** 查资料（需调接口）：成员 / 群 / 群列表 / 机器人自身状态 */
function getProfile(bot, event, options = {}) {
	return runSplitContext("get_profile", bot, event, options);
}

export { getContext, messageTextOf, segmentsOf, commandArgsOf, SPLIT_CONTEXT_MODES, runSplitContext, getIds, getMessageContext, getProfile };
