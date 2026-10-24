// 旧动作名 → 现行动作名的别名表
//
// 为什么需要：动作名（`send_group_msg` 这类）是从运行时发往网关的**私有协议**，
// 2026-10-24 起统一改成项目自己的命名（`send_group_message`）。但用户磁盘上存量
// `.qqbat/flow.json` 的 api_call 节点里写的是旧名，第三方插件也可能按旧名发帧 ——
// 所以归一化必须发生在网关的**唯一入口**（`handleAction`），而不是要求每个调用方自查。
//
// 归一化只做「旧名 → 新名」，新名与未知动作原样透传：未知动作仍要走
// ALL_ACTION_HANDLERS 查表失败、报明确错误，不能在这里被悄悄吞掉。

/**
 * 已退役的动作名 → 现行动作名。
 *
 * 只登记**曾经真在网关表里、且改名前能跑通**的动作 —— 这样别名才有兼容价值。
 * edit_msg / get_msg / send_group_forward_msg 改名前就没有 handler（调用会明确报
 * 「不支持的协议动作」），因此不登记：它们不可能是"升级后才坏掉"的存量流程。
 */
export const LEGACY_ACTION_ALIASES: Readonly<Record<string, string>> = {
	send_msg: "send_message",
	send_group_msg: "send_group_message",
	send_private_msg: "send_private_message",
	send_stream_msg: "send_stream_message",
	send_keyboard_msg: "send_keyboard_message",
	send_channel_msg: "send_channel_message",
	delete_msg: "delete_message"
};

/**
 * 把动作名归一化成现行命名。
 *
 * @param action 运行时/插件发来的动作名（旧名、新名或未知名）
 * @returns 现行动作名；未知动作原样返回（交给调用方查表报错）
 */
export function normalizeActionName(action?: unknown): string {
	const name = String(action ?? "");
	return LEGACY_ACTION_ALIASES[name] ?? name;
}