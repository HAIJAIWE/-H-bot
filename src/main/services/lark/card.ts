// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

/**
* 把 QQ 官方键盘转成飞书互动卡片。
*
* 返回 `null` 表示**没有可用按钮** —— 调用方据此降级成编号文本，
* **不要静默丢弃**（否则用户看到"什么都没发生"）。
*/
function keyboardToCard(params, sendCtx) {
	const kb = params.keyboard;
	const rows = Array.isArray(kb?.content?.rows) ? kb.content.rows : kb?.rows;
	if (!Array.isArray(rows)) return null;
	const elements = [];
	const md = typeof params.markdown === "string" ? params.markdown : "";
	if (md) elements.push({
		tag: "markdown",
		content: md
	});
	let buttonCount = 0;
	for (const row of rows) {
		if (row === null || typeof row !== "object") continue;
		const buttons = row.buttons;
		if (!Array.isArray(buttons)) continue;
		const actions = [];
		for (const b of buttons) {
			if (b === null || typeof b !== "object") continue;
			const btn = b;
			const label = btn.render_data?.label ?? btn.render_data?.visited_label;
			if (typeof label !== "string" || !label) continue;
			const cmd = typeof btn.action?.data === "string" ? btn.action.data : "";
			const item = {
				tag: "button",
				text: {
					tag: "plain_text",
					content: label
				},
				type: "default"
			};
			if (cmd) item.value = {
				cmd,
				...sendCtx?.chatId ? {
					chat_id: sendCtx.chatId,
					chat_type: sendCtx.chatType
				} : {}
			};
			if (typeof btn.action?.url === "string" && btn.action.url) item.url = btn.action.url;
			actions.push(item);
			buttonCount++;
		}
		if (actions.length > 0) elements.push({
			tag: "action",
			layout: "flow",
			actions
		});
	}
	if (buttonCount === 0) return null;
	return {
		config: { wide_screen_mode: true },
		elements
	};
}
/**
* 从卡片回调事件里取出**用户意图的那条命令**。
*
* ## ⚠️ 官方结构是**嵌套**的（我第一版按扁平写，一个都认不出来）
*
* 官方 `card.callback-communication` 原文：
*
* ```jsonc
* {
*   "header": { "event_type": "card.action.trigger", ... },
*   "event": {
*     "operator": { "open_id": "ou_…", "union_id": "on_…" },   // ← 操作者在 operator 里
*     "token": "c-…",
*     "action": {
*       "value": { "cmd": "/状态" },    // ← **命令在 action.value 里**（object 或 string）
*       "tag": "button",
*       "name": "Button_lvkepfu3"
*     }
*   }
* }
* ```
*
* 而某些 SDK/文档摘要把它**摊平**成 `event.action_value`（字符串）与
* `event.operator_id`。两种都兼容，但**嵌套是官方原始形态**。
*
* 取不到就返回 `null`（调用方据此忽略这次回调，**不要编造命令**）。
*/
function extractCardCommand(event) {
	return commandOf(extractCardValueRaw(event));
}
/**
* 取出回调里那个**原始的 `action.value`**（不是里面的命令字符串）。
*
* 需要它是因为 `value` 里除了 `cmd` 还带着发送时塞进去的会话上下文
* （`chat_id` / `chat_type`，见 `keyboardToCard`）。
*/
function extractCardValueRaw(event) {
	const action = event.action;
	if (action?.value !== void 0) return action.value;
	return event.action_value;
}
function extractCardCallbackContext(event) {
	const ctx = event.context;
	return {
		chatId: nonEmptyStr(ctx?.open_chat_id) ?? nonEmptyStr(event.chat_id) ?? nonEmptyStr(event.open_chat_id),
		messageId: nonEmptyStr(ctx?.open_message_id) ?? nonEmptyStr(event.message_id) ?? nonEmptyStr(event.open_message_id),
		updateToken: nonEmptyStr(event.token)
	};
}
/**
* 从按钮 `value` 里读回**发送时塞进去的会话上下文**。
*
* 只有本项目的卡片带着它（见 `keyboardToCard`）。读到了就等于
* **精确知道**这张卡片当初发在群里还是单聊里，不用猜、不用调 API。
* 读不到返回 `undefined`（例如老卡片、或别的工具发的卡片）。
*/
function cardSendContextFromValue(value) {
	if (!value || typeof value !== "object") return void 0;
	const v = value;
	const chatId = nonEmptyStr(v.chat_id);
	if (!chatId) return void 0;
	return {
		chatId,
		chatType: v.chat_type === "private" ? "private" : "group"
	};
}
function nonEmptyStr(v) {
	return typeof v === "string" && v ? v : void 0;
}
/** 从任意形态的 value 里取出命令字符串（object / JSON 字符串 / 纯字符串） */
function commandOf(raw) {
	if (raw === void 0 || raw === null) return null;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) return null;
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) try {
			const parsed = JSON.parse(trimmed);
			const cmd = parsed.cmd ?? parsed.command ?? parsed.value ?? parsed.data;
			return typeof cmd === "string" && cmd ? cmd : null;
		} catch {
			return trimmed;
		}
		return trimmed;
	}
	if (typeof raw === "object") {
		const o = raw;
		const cmd = o.cmd ?? o.command ?? o.value ?? o.data;
		return typeof cmd === "string" && cmd ? cmd : null;
	}
	return null;
}
/**
* 从卡片回调事件里取出**操作者 open_id**。
*
* 官方结构是 `event.operator.open_id`；某些摘要把它摊平成 `event.operator_id`。
* 两种都认。取不到返回 `null`（不知道是谁点的，**不能瞎猜**）。
*/
function extractCardOperator(event) {
	const op = event.operator;
	if (typeof op?.open_id === "string" && op.open_id) return op.open_id;
	if (typeof op?.user_id === "string" && op.user_id) return op.user_id;
	if (typeof event.operator_id === "string" && event.operator_id) return event.operator_id;
	return null;
}

export { keyboardToCard, extractCardCommand, extractCardValueRaw, extractCardCallbackContext, cardSendContextFromValue, nonEmptyStr, commandOf, extractCardOperator };
