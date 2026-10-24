// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

/**
* **协议动作名 → 能力** 的映射。
*
* ## 为什么需要它
*
* 节点声明的是**能力**，而线上跑的是**动作名**（`send_group_message` 之类）。
* 两边要能对上，才能在"节点要求 X、绑定只有 Y"时**说清楚缺什么**。
*
* ⚠️ **这张表是过渡期的桥**：协议动作名的粒度比能力细
* （`send_message` / `send_private_message` / `send_group_message` 都归 `im.message.send`）。
* 将来如果绑定的能力声明直接落到动作上，这张表可以退化掉 —— 但现在不能删，
* 因为**存量绑定的接口就是动作名**（`BotInterface.callApi(api, params)`）。
*/
var ONEBOT_ACTION_CAPABILITY = {
	send_message: "im.message.send",
	send_private_message: "im.message.send",
	send_group_message: "im.message.send",
	send_keyboard_message: "im.message.send_keyboard",
	send_media: "im.message.send_media",
	send_stream_message: "im.message.send_stream",
	send_group_forward_message: "im.message.send_forward",
	delete_message: "im.message.recall",
	edit_message: "im.message.edit",
	get_group_info: "im.group.info",
	get_group_bot_state: "im.group.bot_state",
	get_group_mute_state: "im.group.mute_state",
	get_group_member_info: "im.group.member_info",
	get_group_member_list: "im.group.member_list",
	get_group_join_requests: "im.group.join_requests",
	list_group_blacklist: "im.group.blacklist",
	set_group_ban: "im.group.ban",
	set_group_whole_ban: "im.group.whole_ban",
	set_group_kick: "im.group.kick",
	set_group_card: "im.group.card",
	set_group_special_title: "im.group.special_title",
	set_group_leave: "im.group.leave",
	set_group_add_request: "im.group.add_request",
	_send_group_notice: "im.group.notice",
	set_essence_msg: "im.group.essence",
	set_friend_add_request: "im.friend.add_request",
	interaction: "im.interaction.respond",
	get_menu: "im.interaction.menu",
	set_menu: "im.interaction.menu",
	list_panels: "im.interaction.panel",
	get_panel: "im.interaction.panel",
	create_panel: "im.interaction.panel",
	update_panel: "im.interaction.panel",
	delete_panel: "im.interaction.panel",
	set_panel_target: "im.interaction.panel",
	list_join_approval_strategies: "im.interaction.join_approval",
	create_join_approval_strategy: "im.interaction.join_approval",
	update_join_approval_strategy: "im.interaction.join_approval",
	delete_join_approval_strategy: "im.interaction.join_approval",
	execute_join_approval_strategy: "im.interaction.join_approval",
	update_strategy_whitelist: "im.interaction.join_approval",
	get_login_info: "im.bot.info",
	generate_url_link: "im.bot.share_link",
	channel_list: "im.channel.manage",
	channel_get: "im.channel.manage",
	channel_create: "im.channel.manage",
	channel_update: "im.channel.manage",
	channel_delete: "im.channel.manage",
	announce_create: "im.channel.announce",
	announce_delete: "im.channel.announce",
	pin_add: "im.channel.pin",
	pin_list: "im.channel.pin",
	pin_remove: "im.channel.pin",
	reaction_add: "im.channel.reaction",
	reaction_remove: "im.channel.reaction",
	reaction_users: "im.channel.reaction"
};
/**
* 一组能力 → 覆盖它们的**动作名**。
*
* 绑定声明能力后，用这个算出"我实际接受哪些动作"（基类据此拒绝其余动作）。
* 未知能力（比如绑定自己扩展的域）返回空数组 —— 由调用方决定怎么办。
*/
function actionsForCapabilities(capabilities) {
	const want = new Set(capabilities);
	return Object.entries(ONEBOT_ACTION_CAPABILITY).filter(([, cap]) => want.has(cap)).map(([action]) => action);
}
/** 运行时校验用的 Zod 枚举（与 `PLATFORM_IDS` 同源，不会漂移） */
var PlatformIdSchema = z.enum([
	"qq-official",
	"qq-gateway",
	"dingtalk",
	"lark",
	"wecom",
	"wechat-mp",
	"kook",
	"telegram",
	"discord",
	"slack",
	"sandbox",
	"minecraft"
]);
/**
* 历史平台标识 → 现行标识的迁移映射。
*
* `wechat` 这个旧值必须迁移而不能直接删：删掉会让**存量配置在解析时报
* "invalid enum value"**，用户只看到一句英文校验错误，不知道该怎么办。
*/
var LEGACY_PLATFORM_MAP = {
	qq: "qq-official",
	wechat: "wechat-mp"
};
/** 把历史标识规范成现行标识（未知值原样返回，交给 Zod 去报错） */
function normalizePlatformId(raw) {
	if (typeof raw !== "string") return raw;
	return LEGACY_PLATFORM_MAP[raw] ?? raw;
}
/**
* 已废弃、**不可再实现**的平台（选了会明确报错，而不是运行到一半失败）。
*
* 这里只放"曾经存在但现在不该用"的标识。留着它们的目的不是支持，
* 而是**让存量的错误配置得到一个可读的报错**。
*/
var RETIRED_PLATFORMS = {
	gewechat: "Gewechat 已停止维护（其 README 明确\"历史服务/镜像/技术支持均不再提供\"，背景是微信官方对违规获取用户数据的打击公告）。请改接「企业微信」或「微信公众号」。",
	wechaty: "Wechaty 的个人号 puppet 依赖非官方协议，有封号与合规风险，且官方无 API。请改接「企业微信」或「微信公众号」。"
};

export { ONEBOT_ACTION_CAPABILITY, actionsForCapabilities, PlatformIdSchema, LEGACY_PLATFORM_MAP, normalizePlatformId, RETIRED_PLATFORMS };
