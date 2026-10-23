// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md

/** 通用端口表达式 */
var COMMON_PORT_EXPRS = {
	event: () => "event",
	raw_message: () => "str(event.get_message())",
	args: () => "event.get_message().extract_plain_text().split()",
	time: () => "new Date()",
	user_id: () => "String(event.user_id ?? \"\")",
	group_id: () => "String(event.group_id ?? \"\")"
};
/** on_request 端口表达式 */
var REQUEST_PORT_EXPRS = {
	request_type: () => "String(event.request_type ?? \"\")",
	comment: () => "String(event.comment ?? \"\")",
	flag: () => "String(event.flag ?? \"\")"
};
/** on_notice 端口表达式 */
var NOTICE_PORT_EXPRS = {
	notice_type: () => "String(event.notice_type ?? \"\")",
	sub_type: () => "String(event.sub_type ?? \"\")"
};
/** 特定 trigger 端口表达式 */
var TRIGGER_SPECIFIC_EXPRS = {
	on_ready: { ready_at: () => "Number(new Date().getTime() / 1000)" },
	on_startup: { started_at: () => "Number(new Date().getTime() / 1000)" },
	button_clicked: {
		button_id: () => "String(event.button_id ?? \"\")",
		button_data: () => "String(event.button_data ?? \"\") || String(event.get_message?.()).strip()"
	}
};
/** schedule 端口表达式 */
var SCHEDULE_PORT_EXPRS = { time: () => "new Date()" };
/**
* 生成 trigger 输出表达式
*
* 优先级:
* 1. isSchedule: SCHEDULE_PORT_EXPRS
* 2. 触发器种类: TRIGGER_SPECIFIC_EXPRS[kind]
* 3. on_request: REQUEST_PORT_EXPRS
* 4. on_notice: NOTICE_PORT_EXPRS
* 5. 通用: COMMON_PORT_EXPRS
* 6. 默认: 'None'
*/
function triggerOutputExpr(trigger, portId, isSchedule) {
	if (isSchedule) {
		const gen = SCHEDULE_PORT_EXPRS[portId];
		return gen ? gen(trigger, portId) : "None";
	}
	const kind = trigger.data.nodeKind;
	const specific = TRIGGER_SPECIFIC_EXPRS[kind];
	if (specific) {
		const gen = specific[portId];
		if (gen) return gen(trigger, portId);
	}
	if (kind === "request_received") {
		const gen = REQUEST_PORT_EXPRS[portId];
		if (gen) return gen(trigger, portId);
	}
	if (kind === "notice_received") {
		const gen = NOTICE_PORT_EXPRS[portId];
		if (gen) return gen(trigger, portId);
	}
	const commonGen = COMMON_PORT_EXPRS[portId];
	if (commonGen) return commonGen(trigger, portId);
	return "None";
}

export { COMMON_PORT_EXPRS, REQUEST_PORT_EXPRS, NOTICE_PORT_EXPRS, TRIGGER_SPECIFIC_EXPRS, SCHEDULE_PORT_EXPRS, triggerOutputExpr };
