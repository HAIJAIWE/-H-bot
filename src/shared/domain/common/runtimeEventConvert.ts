// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

/** 把内部消息段转成协议风格的段（`{ type, data }`） */
function segmentsToRuntime(event) {
	const segs = event.parsed?.rawSegments ?? [];
	if (segs.length === 0) return event.rawMessage ? [{
		type: "text",
		data: { text: event.rawMessage }
	}] : [];
	return segs.map((s) => {
		const seg = s;
		if (seg.type === "text") return {
			type: "text",
			data: { text: seg.data.text }
		};
		if (seg.type === "at") {
			const d = seg.data;
			return {
				type: "at",
				data: {
					qq: d.userId,
					name: d.name
				}
			};
		}
		if (seg.type === "image") {
			const d = seg.data;
			return {
				type: "image",
				data: {
					url: d.url,
					file: d.file
				}
			};
		}
		if (seg.type === "face") return {
			type: "face",
			data: { id: seg.data.id }
		};
		if (seg.type === "reply") return {
			type: "reply",
			data: { id: seg.data.messageId }
		};
		return {
			type: seg.type,
			data: {}
		};
	});
}
/** 该事件是不是群消息 */
function isGroupMessage(event) {
	return event.subType === "group" || Boolean(event.groupId);
}
/**
* `StandardEvent` → 运行时事件。
*
* 对 `meta` 事件返回 `null`（运行时的 meta 只用来取 `self_id`，
* 由适配器自己发 heartbeat/lifecycle，不走这里）。
*/
function toRuntimeEvent(event) {
	const kind = String(event.type ?? "");
	if (kind === "meta") return null;
	if (kind === "message") {
		const msg = event;
		const group = isGroupMessage(msg);
		const segments = segmentsToRuntime(msg);
		const rawMessage = msg.rawMessage || segments.map((s) => s.data?.text ?? "").join("");
		return {
			post_type: "message",
			message_type: group ? "group" : "private",
			sub_type: group ? msg.subType === "guild" ? "normal" : "normal" : "friend",
			self_id: msg.platform === "sandbox" ? "sandbox" : void 0,
			user_id: msg.userId,
			group_id: msg.groupId,
			message_id: msg.messageId,
			message: segments,
			raw_message: rawMessage,
			font: 0,
			time: Math.floor((msg.timestamp ?? Date.now()) / 1e3),
			is_tome: msg.isToMe,
			thread_id: msg.threadId,
			sender: {
				user_id: msg.userId,
				nickname: msg.displayName ?? "",
				role: msg.role,
				union_id: msg.unionId,
				sender_type: msg.senderType
			},
			get_message: () => rawMessage
		};
	}
	if (kind === "notice") {
		const n = event;
		return {
			post_type: "notice",
			notice_type: n.noticeType,
			user_id: n.userId,
			group_id: n.groupId,
			operator_id: n.operatorId,
			target_id: n.targetId,
			time: Math.floor((n.timestamp ?? Date.now()) / 1e3)
		};
	}
	if (kind === "custom") {
		const c = event;
		return {
			post_type: "custom",
			event_name: c.eventName,
			payload: c.payload,
			user_id: c.userId,
			group_id: c.groupId,
			time: Math.floor((c.timestamp ?? Date.now()) / 1e3)
		};
	}
	if (kind !== "request") return null;
	const r = event;
	return {
		post_type: "request",
		request_type: r.requestType,
		user_id: r.userId,
		group_id: r.groupId,
		comment: r.comment,
		flag: r.flag,
		time: Math.floor((r.timestamp ?? Date.now()) / 1e3)
	};
}

export { segmentsToRuntime, isGroupMessage, toRuntimeEvent };
