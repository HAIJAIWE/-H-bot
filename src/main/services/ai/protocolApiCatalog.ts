// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

var api = (name, reason) => reason ? {
	name,
	officialUnsupported: { reason }
} : { name };
var PROTOCOL_APIS = [
	{
		group: "发消息",
		apis: [
			api("send_message"),
			api("send_private_message"),
			api("send_group_message"),
			api("send_channel_message"),
			api("send_group_forward_message", "官方 API 没有「合并转发」能力（富媒体只有图片/语音/视频/文件）"),
			api("send_keyboard_message"),
			api("send_media"),
			api("send_stream_message"),
			api("send_input_notify")
		]
	},
	{
		group: "消息操作",
		apis: [
			api("delete_message"),
			api("edit_message", "官方 API 不支持编辑已发送的消息（每回合重发一条是官方建议的做法）"),
			api("set_essence_msg")
		]
	},
	{
		group: "群管理",
		apis: [
			api("set_group_ban"),
			api("set_group_kick"),
			api("set_group_leave", "官方 API 没有「主动退群」能力"),
			api("set_group_card", "官方 API 没有「设置群名片」能力"),
			api("set_group_special_title", "官方 API 没有「设置群头衔」能力"),
			api("set_group_add_request"),
			api("set_friend_add_request", "官方 API 没有「好友请求审批」能力（好友添加是通知事件，不是请求）"),
			api("_send_group_notice", "官方 API 没有「QQ 群公告」能力")
		]
	},
	{
		group: "查询",
		apis: [
			api("get_group_info"),
			api("get_group_member_info"),
			api("get_group_member_list"),
			api("get_group_bot_state"),
			api("get_group_mute_state"),
			api("list_group_blacklist"),
			api("get_group_join_requests"),
			api("interaction")
		]
	}
];
/** 平铺后的全部条目 */
function allProtocolApiEntries() {
	return PROTOCOL_APIS.flatMap((g) => [...g.apis]);
}
/**
* 拼成给模型看的一节。
*
* 刻意**只给名字 + 分组**，不给参数 —— 参数形状写进来会立刻过时，
* 而模型完全可以用 `read_code` 打开调用它的内置节点看真实写法。
* 给一条**能自己查的路径**，比给一份**会过时的表**强。
*/
function describeProtocolApis() {
	const lines = PROTOCOL_APIS.map((g) => `- ${g.group}：` + g.apis.map((e) => e.officialUnsupported ? `${e.name}*` : e.name).join(" / "));
	const unsupportedLines = allProtocolApiEntries().filter((e) => e.officialUnsupported).map((e) => `- ${e.name}：${e.officialUnsupported.reason}`);
	return [
		"沙箱节点里 `await ctx.bot.callApi(名字, { 参数 })` 可调协议端 API。",
		"**下面这些是本项目内部用过的（写节点时优先从这里挑）：**",
		...lines,
		"",
		"⚠️ **带 \\* 的名字只在 NapCat 这类 第三方桥接实现上有效** —— 官方（QQ 开放平台）适配器没有这些能力，",
		"用它写出来的节点在官方适配器下**运行时会失败**：",
		...unsupportedLines,
		"",
		"⚠️ 这张表**不是全部** —— 协议端支持的比这多。但**表外的名字要先确认存在再用**：",
		"猜错 API 名不会在保存时报错，只会在运行时静默失败（机器人不回话，用户很久才发现）。",
		"**参数形状不要猜**：用 read_code 打开调用它的内置节点（`src/main/services/builtinNodes/`）看真实写法。"
	].join("\n");
}

export { api, PROTOCOL_APIS, allProtocolApiEntries, describeProtocolApis };
