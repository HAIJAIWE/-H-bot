// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

var CAPABILITY_CHECKS = [
	{
		id: "bot_info",
		group: "bot",
		needsTarget: false,
		path: "/users/@me",
		gate: "none",
		zhLabel: "机器人自身信息"
	},
	{
		id: "bot_guilds",
		group: "bot",
		needsTarget: false,
		path: "/users/@me/guilds",
		gate: "none",
		zhLabel: "机器人所在频道列表"
	},
	{
		id: "gateway",
		group: "bot",
		needsTarget: false,
		path: "/gateway/bot",
		gate: "none",
		zhLabel: "网关地址与连接配额"
	},
	{
		id: "menu",
		group: "bot",
		needsTarget: false,
		path: "/v2/menu",
		gate: "none",
		zhLabel: "自定义菜单（单聊）"
	},
	{
		id: "panels_c2c",
		group: "bot",
		needsTarget: false,
		path: "/v2/panels?scope=c2c",
		gate: "none",
		zhLabel: "指令面板（单聊）"
	},
	{
		id: "panels_group",
		group: "bot",
		needsTarget: false,
		path: "/v2/panels?scope=group",
		gate: "none",
		zhLabel: "指令面板（群聊）"
	},
	{
		id: "join_strategy",
		group: "bot",
		needsTarget: false,
		path: "/v2/groups/join_approval_strategy",
		gate: "none",
		zhLabel: "入群自动审批策略"
	},
	{
		id: "group_info",
		group: "group",
		needsTarget: true,
		path: "/v2/groups/{target}/info",
		gate: "whitelist",
		zhLabel: "群基本信息"
	},
	{
		id: "group_bot_state",
		group: "group",
		needsTarget: true,
		path: "/v2/groups/{target}/bot_state",
		gate: "whitelist",
		zhLabel: "机器人群内状态"
	},
	{
		id: "group_mute_state",
		group: "group",
		needsTarget: true,
		path: "/v2/groups/{target}/restrict_chat_setting",
		gate: "admin",
		zhLabel: "群禁言状态（需管理员）"
	},
	{
		id: "group_join_requests",
		group: "group",
		needsTarget: true,
		path: "/v2/groups/{target}/join_request_list",
		gate: "admin",
		zhLabel: "入群申请列表（需管理员）"
	},
	{
		id: "group_members",
		group: "group",
		needsTarget: true,
		path: "/v2/groups/{target}/members",
		gate: "invite",
		zhLabel: "群成员列表"
	},
	{
		id: "group_blacklist",
		group: "group",
		needsTarget: true,
		path: "/v2/groups/{target}/member_blacklist",
		gate: "invite",
		zhLabel: "群黑名单"
	}
];

export { CAPABILITY_CHECKS };
