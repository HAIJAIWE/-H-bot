// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/** 官方定义的 code 取值（越界会让接口报参数错，所以本地先夹住） */
var VALID_CODES = [
	0,
	1,
	2,
	3,
	4,
	5
];
async function answerInteraction(bot, _event = null, options = {}) {
	const interactionId = String(options.interaction_id ?? "").trim();
	if (!interactionId) return {
		success: false,
		error: "交互 ID 为空 —— 请把「按钮点击」触发器的交互 ID 端口接过来"
	};
	const raw = options.code === void 0 || options.code === "" ? 0 : Number(options.code);
	if (!Number.isFinite(raw) || !VALID_CODES.includes(Math.trunc(raw))) return {
		success: false,
		error: `结果码只能是 ${VALID_CODES.join(" / ")}，当前是「${String(options.code)}」`
	};
	try {
		await bot.callApi("interaction", {
			interaction_id: interactionId,
			code: Math.trunc(raw)
		});
		return {
			success: true,
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			error: `响应按钮点击失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}

export { VALID_CODES, answerInteraction };
