// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
// 校验实现只有一个真源：official/validation.ts 里的纯函数（限 32 字符）。
// 原来这里指到 builtinNodes/persistentStore，是产物还原时按 chunk 归属猜错的路径。
import { validateCallbackData } from "../../official";

var getLoginInfo = async (host, { echo, responder }) => {
	responder.respond(echo, {
		user_id: host.selfIdNum,
		nickname: "QQBot"
	});
};
var interaction = async (host, { params, echo, responder }) => {
	const interactionId = String(params.interaction_id ?? "").trim();
	if (!interactionId) {
		responder.fail(echo, "interaction_id 为空");
		return;
	}
	const codeNum = Number(params.code ?? 0);
	const code = [
		0,
		1,
		2,
		3,
		4,
		5
	].includes(codeNum) ? codeNum : 0;
	const r = await host.callOfficialApi("PUT", `/interactions/${interactionId}`, { code });
	if (r.ok) responder.respond(echo, {});
	else responder.fail(echo, r.error);
};
var generateUrlLink = async (host, { params, echo, responder }) => {
	const cb = validateCallbackData(params.callback_data);
	if (!cb.ok) {
		responder.fail(echo, cb.error);
		return;
	}
	const callbackData = cb.value;
	const r = await host.callOfficialApi("POST", "/v2/generate_url_link", { callback_data: callbackData });
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var miscActions = {
	get_login_info: getLoginInfo,
	interaction,
	generate_url_link: generateUrlLink
};

export { getLoginInfo, interaction, generateUrlLink, miscActions };
