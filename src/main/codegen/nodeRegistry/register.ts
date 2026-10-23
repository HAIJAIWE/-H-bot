// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { emitAgentChat, emitApiCall, emitCheckPermission, emitDatabaseWrite, emitDelay, emitEmbedding, emitErrorOp, emitExpressionEval, emitFileOperate, emitFormatText, emitGetContext, emitGroupOp, emitHttpRequest, emitIntentClassify, emitJsonOp, emitListOp, emitLlmChat, emitLoopControl, emitMemoryOp, emitMessageEdit, emitMessageOp, emitMessageRecall, emitMessageSend, emitOnButtonClick, emitOnNotice, emitOnReady, emitOnRequest, emitOnStartup, emitParallelExec, emitPersistentStore, emitQuery, emitRandom, emitRegexExtract, emitRetryExec$1, emitSplitContext, emitSubflowCall$1, emitSubflowDefined, emitSwitchCase$1, emitSystemLog, emitTimeOp, emitTimer, emitTryCatch$1, emitVariableMerge, emitVariablePersist, emitVariableSet } from "./emitters";

/** 注册所有内置节点发射器 */
function registerBuiltinEmitters(registry) {
	registry.register({
		kind: "message_received",
		handlerModule: "message_received",
		importPath: "../services/builtinNodes/builtinNodes"
	});
	registry.register({
		kind: "scheduled",
		handlerModule: "scheduled",
		importPath: "../services/builtinNodes/builtinNodes"
	});
	registry.register({
		kind: "branch_switch",
		handlerModule: "switchCase",
		importPath: "../services/builtinNodes/builtinNodes"
	});
	registry.register({
		kind: "switch_case",
		handlerModule: "switchCase",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitSwitchCase$1
	});
	registry.register({
		kind: "wait_input",
		handlerModule: "waitInput",
		importPath: "../services/builtinNodes/builtinNodes"
	});
	registry.register({
		kind: "message_op",
		handlerModule: "messageOp",
		importPath: "../services/builtinNodes/messageOp",
		emit: emitMessageOp
	});
	registry.register({
		kind: "message_compose",
		handlerModule: "messageCompose",
		importPath: "../services/builtinNodes/messageCompose"
	});
	registry.register({
		kind: "config_query",
		handlerModule: "configQuery",
		importPath: "../services/builtinNodes/configQuery"
	});
	registry.register({
		kind: "menu_config",
		handlerModule: "menuConfig",
		importPath: "../services/builtinNodes/menuPanel"
	});
	registry.register({
		kind: "panel_config",
		handlerModule: "panelConfig",
		importPath: "../services/builtinNodes/menuPanel"
	});
	registry.register({
		kind: "battle_panel",
		handlerModule: "battlePanel",
		importPath: "../services/builtinNodes/battlePanel"
	});
	registry.register({
		kind: "bot_info",
		handlerModule: "botInfo",
		importPath: "../services/builtinNodes/botInfo"
	});
	registry.register({
		kind: "join_approval",
		handlerModule: "joinApproval",
		importPath: "../services/builtinNodes/joinApproval"
	});
	registry.register({
		kind: "channel_op",
		handlerModule: "channelOp",
		importPath: "../services/builtinNodes/channelOp"
	});
	registry.register({
		kind: "answer_interaction",
		handlerModule: "answerInteraction",
		importPath: "../services/builtinNodes/answerInteraction"
	});
	registry.register({
		kind: "variable_set",
		handlerModule: "variable_set",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitVariableSet
	});
	registry.register({
		kind: "variable_persist",
		handlerModule: "variable_persist",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitVariablePersist
	});
	for (const [kind, fnName] of [
		["load_variable", "loadVariable"],
		["save_variable", "saveVariable"],
		["incr_variable", "incrVariable"],
		["update_if_variable", "updateIfVariable"],
		["append_variable", "appendVariable"],
		["delete_variable", "deleteVariable"],
		["exists_variable", "existsVariable"]
	]) registry.register({
		kind,
		handlerModule: fnName,
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitVariablePersist
	});
	registry.register({
		kind: "message_send",
		handlerModule: "message_send",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitMessageSend
	});
	registry.register({
		kind: "format_text",
		handlerModule: "format_text",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitFormatText
	});
	registry.register({
		kind: "expression_eval",
		handlerModule: "expression_eval",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitExpressionEval
	});
	registry.register({
		kind: "message_recall",
		handlerModule: "message_recall",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitMessageRecall
	});
	registry.register({
		kind: "message_edit",
		handlerModule: "message_edit",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitMessageEdit
	});
	registry.register({
		kind: "group_op",
		handlerModule: "group_op",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitGroupOp
	});
	for (const kind of ["file_read", "file_write"]) registry.register({
		kind,
		handlerModule: kind,
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitFileOperate
	});
	registry.register({
		kind: "file_operate",
		handlerModule: "file_operate",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitFileOperate
	});
	registry.register({
		kind: "database_write",
		handlerModule: "database_write",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitDatabaseWrite
	});
	registry.register({
		kind: "http_request",
		handlerModule: "http_request",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitHttpRequest
	});
	registry.register({
		kind: "delay",
		handlerModule: "delay",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitDelay
	});
	registry.register({
		kind: "random",
		handlerModule: "random",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitRandom
	});
	for (const kind of [
		"time_read",
		"time_check",
		"time_calc"
	]) registry.register({
		kind,
		handlerModule: kind,
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitTimeOp
	});
	registry.register({
		kind: "time_op",
		handlerModule: "time_op",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitTimeOp
	});
	for (const [kind, fnName] of [
		["list_edit", "list_edit"],
		["list_query", "list_query"],
		["list_transform", "list_transform"],
		["list_combine", "list_combine"]
	]) registry.register({
		kind,
		handlerModule: fnName,
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitListOp
	});
	registry.register({
		kind: "list_op",
		handlerModule: "list_op",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitListOp
	});
	registry.register({
		kind: "loop_control",
		handlerModule: "loop_control",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitLoopControl
	});
	registry.register({
		kind: "try_catch",
		handlerModule: "try_catch",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitTryCatch$1
	});
	registry.register({
		kind: "retry_exec",
		handlerModule: "retry_exec",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitRetryExec$1
	});
	registry.register({
		kind: "timer",
		handlerModule: "timerOp",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitTimer
	});
	registry.register({
		kind: "subflow_call",
		handlerModule: "subflow_call",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitSubflowCall$1
	});
	registry.register({
		kind: "subflow_defined",
		handlerModule: "subflow_defined",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitSubflowDefined
	});
	registry.register({
		kind: "system_log",
		handlerModule: "system_log",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitSystemLog
	});
	registry.register({
		kind: "check_permission",
		handlerModule: "check_permission",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitCheckPermission
	});
	registry.register({
		kind: "agent_chat",
		handlerModule: "agent_chat",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitAgentChat
	});
	registry.register({
		kind: "intent_classify",
		handlerModule: "intent_classify",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitIntentClassify
	});
	registry.register({
		kind: "regex_extract",
		handlerModule: "regex_extract",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitRegexExtract
	});
	registry.register({
		kind: "json_op",
		handlerModule: "json_op",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitJsonOp
	});
	registry.register({
		kind: "llm_chat",
		handlerModule: "llm_chat",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitLlmChat
	});
	registry.register({
		kind: "embedding",
		handlerModule: "embedding",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitEmbedding
	});
	registry.register({
		kind: "persistent_store",
		handlerModule: "persistent_store",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitPersistentStore
	});
	registry.register({
		kind: "query",
		handlerModule: "query",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitQuery
	});
	registry.register({
		kind: "memory_op",
		handlerModule: "memory_op",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitMemoryOp
	});
	registry.register({
		kind: "parallel_exec",
		handlerModule: "parallel_exec",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitParallelExec
	});
	registry.register({
		kind: "get_context",
		handlerModule: "get_context",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitGetContext
	});
	for (const [kind, fnName] of [
		["get_ids", "getIds"],
		["get_message", "getMessageContext"],
		["get_profile", "getProfile"]
	]) registry.register({
		kind,
		handlerModule: fnName,
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitSplitContext(fnName)
	});
	registry.register({
		kind: "error_op",
		handlerModule: "error_op",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitErrorOp
	});
	registry.register({
		kind: "api_call",
		handlerModule: "api_call",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitApiCall
	});
	registry.register({
		kind: "variable_merge",
		handlerModule: "variable_merge",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitVariableMerge
	});
	registry.register({
		kind: "on_ready",
		handlerModule: "on_ready",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitOnReady
	});
	registry.register({
		kind: "on_startup",
		handlerModule: "on_startup",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitOnStartup
	});
	registry.register({
		kind: "on_request",
		handlerModule: "on_request",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitOnRequest
	});
	registry.register({
		kind: "on_notice",
		handlerModule: "on_notice",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitOnNotice
	});
	registry.register({
		kind: "on_button_click",
		handlerModule: "on_button_click",
		importPath: "../services/builtinNodes/builtinNodes",
		emit: emitOnButtonClick
	});
}

export { registerBuiltinEmitters };
