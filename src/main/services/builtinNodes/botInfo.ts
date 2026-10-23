// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

var MODE_ACTION$1 = {
	self: "get_login_info",
	url_link: "generate_url_link"
};
async function botInfo(bot, _event = null, options = {}) {
	const mode = String(options.mode ?? "self");
	const action = MODE_ACTION$1[mode];
	if (!action) return {
		success: false,
		data: null,
		error: `未知的模式: ${mode}（可选 ${Object.keys(MODE_ACTION$1).join(" / ")}）`
	};
	const params = {};
	if (mode === "url_link") {
		const cb = String(options.callback_data ?? "").trim();
		if (cb.length > 32) return {
			success: false,
			data: null,
			error: `自定义参数最长 32 个字符，当前 ${cb.length} 个`
		};
		params.callback_data = cb;
	}
	try {
		return {
			success: true,
			data: await bot.callApi(action, params) ?? {},
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			data: null,
			error: `机器人信息操作失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}

export { MODE_ACTION$1, botInfo };
