// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { CHANNEL_REST_MODES } from "../translator/actions/channelRest";

/** 与目录里 `CHANNEL_OP_MODE_OPTIONS` 的取值一一对应 */
var CHANNEL_MODES = [
	"channel_list",
	"channel_get",
	"channel_create",
	"channel_update",
	"channel_delete",
	"announce_create",
	"announce_delete",
	"pin_add",
	"pin_list",
	"pin_remove",
	"reaction_add",
	"reaction_remove",
	"reaction_users",
	// 频道「私域 REST 家族」（身份组/成员/禁言/子频道权限/私信/日程/论坛/消息）：与动作表同源，别在这里手抄
	...CHANNEL_REST_MODES
];
async function channelOp(bot, _event = null, options = {}) {
	const mode = String(options.mode ?? "channel_list");
	if (!CHANNEL_MODES.includes(mode)) return {
		success: false,
		data: null,
		error: `未知的频道操作模式: ${mode}（可选 ${CHANNEL_MODES.join(" / ")}）`
	};
	try {
		return {
			success: true,
			data: await bot.callApi(mode, options) ?? {},
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			data: null,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

export { CHANNEL_MODES, channelOp };
