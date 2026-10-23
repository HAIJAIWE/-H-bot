// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { HANDLERS, registerPositional } from "./registry";
import { messageReceived, onButtonClick, onNotice, onRequest } from "../../services/builtinNodes/triggerNodes";
import { messageEdit, messageRecall } from "../../services/builtinNodes/messageDomain";
import { variableMerge, variablePersist, variableSet } from "../../services/builtinNodes/dataNodes";
import { agentChat, embedding, intentClassify, llmChat } from "../../services/builtinNodes/agentNodes";
import { apiCall, checkPermission, httpRequest } from "../../services/builtinNodes/netNodes";
import { getContext, getIds, getMessageContext, getProfile } from "../../services/builtinNodes/contextNodes";
import { waitInput } from "../../services/builtinNodes/controlNodes";
import { appendVariable, deleteVariable, existsVariable, incrVariable, loadVariable, saveVariable, updateIfVariable } from "../../services/builtinNodes/playerDataNodes";
import { makeTimeHandler, mapKwargsToParams } from "./support";
import { databaseWrite } from "../../services/builtinNodes/databaseWrite";
import { fileOperate } from "../../services/builtinNodes/fileOperate";
import { groupOp } from "../../services/builtinNodes/groupOp";
import { messageOp } from "../../services/builtinNodes/messageOp";
import { messageCompose } from "../../services/builtinNodes/messageCompose";
import { configQuery } from "../../services/builtinNodes/configQuery";
import { botInfo } from "../../services/builtinNodes/botInfo";
import { joinApproval } from "../../services/builtinNodes/joinApproval";
import { menuConfig, panelConfig } from "../../services/builtinNodes/menuPanel";
import { channelOp } from "../../services/builtinNodes/channelOp";
import { answerInteraction } from "../../services/builtinNodes/answerInteraction";
import { battlePanel } from "../../services/builtinNodes/battlePanel";
import { query } from "../../services/builtinNodes/query";

/** 位置参数节点 + 上下文节点 + 玩家数据节点（原注册顺序的前半段） */
function registerPositionalNodes() {
	registerPositional("message_received", messageReceived);
	registerPositional("message_recall", messageRecall);
	registerPositional("message_edit", messageEdit);
	registerPositional("variable_set", variableSet);
	registerPositional("variable_merge", variableMerge);
	registerPositional("on_request", onRequest);
	registerPositional("on_notice", onNotice);
	registerPositional("on_button_click", onButtonClick);
	registerPositional("agent_chat", agentChat);
	registerPositional("llm_chat", llmChat);
	registerPositional("api_call", apiCall);
	registerPositional("http_request", httpRequest);
	registerPositional("check_permission", checkPermission);
	registerPositional("embedding", embedding);
	HANDLERS["get_context"] = (bot, event, kwargs) => getContext(bot, event, kwargs);
	for (const [kind, fn] of [
		["get_ids", getIds],
		["get_message", getMessageContext],
		["get_profile", getProfile]
	]) HANDLERS[kind] = (bot, event, kwargs) => fn(bot, event, kwargs);
	registerPositional("intent_classify", intentClassify);
	registerPositional("wait_input", waitInput);
	registerPositional("variable_persist", variablePersist);
	for (const [kind, fn] of [
		["load_variable", loadVariable],
		["save_variable", saveVariable],
		["incr_variable", incrVariable],
		["update_if_variable", updateIfVariable],
		["append_variable", appendVariable],
		["delete_variable", deleteVariable],
		["exists_variable", existsVariable]
	]) HANDLERS[kind] = (bot, event, kwargs) => fn(bot, event, kwargs);
}
/** 时间节点：3 个新节点共用 makeTimeHandler（按 kind 固定模式） */
function registerTimeNodes() {
	for (const kind of [
		"time_read",
		"time_check",
		"time_calc"
	]) HANDLERS[kind] = makeTimeHandler(kind);
}
/** 数据库 / 文件 / 群操作 / 查询：直接透传 options 对象 */
function registerServiceNodes() {
	HANDLERS["database_write"] = (_bot, _event, kwargs, hctx) => databaseWrite({
		...kwargs,
		project_root: hctx?.projectPath
	});
	HANDLERS["file_operate"] = (_bot, _event, kwargs, hctx) => fileOperate({
		...kwargs,
		project_root: hctx?.projectPath
	});
	for (const [kind, allowed] of [["file_read", [
		"read",
		"exists",
		"list_dir"
	]], ["file_write", [
		"write",
		"copy",
		"move",
		"delete",
		"mkdir"
	]]]) HANDLERS[kind] = (_bot, _event, kwargs, hctx) => {
		const mode = String(kwargs.mode ?? allowed[0]);
		if (!allowed.includes(mode)) return {
			result: null,
			success: false,
			error: `节点「${kind}」不支持模式「${mode}」（可选：${allowed.join(" / ")}）`
		};
		return fileOperate({
			...kwargs,
			mode,
			project_root: hctx?.projectPath
		});
	};
	HANDLERS["group_op"] = (bot, event, kwargs) => groupOp(bot, event, kwargs);
	HANDLERS["message_op"] = (_bot, _event, kwargs) => messageOp(kwargs);
	HANDLERS["message_compose"] = (_bot, _event, kwargs) => messageCompose(kwargs);
	HANDLERS["config_query"] = (_bot, _event, kwargs, hctx) => configQuery(kwargs, hctx?.projectPath);
}
/** QQ 官方能力 + 互动响应 + 战斗面板 + 配置查询 */
function registerOfficialNodes() {
	HANDLERS["bot_info"] = (bot, event, kwargs) => botInfo(bot, event, kwargs);
	HANDLERS["join_approval"] = (bot, event, kwargs) => joinApproval(bot, event, kwargs);
	HANDLERS["menu_config"] = (bot, event, kwargs) => menuConfig(bot, event, kwargs);
	HANDLERS["panel_config"] = (bot, event, kwargs) => panelConfig(bot, event, kwargs);
	HANDLERS["channel_op"] = (bot, event, kwargs) => channelOp(bot, event, kwargs);
	HANDLERS["answer_interaction"] = (bot, event, kwargs) => answerInteraction(bot, event, kwargs);
	HANDLERS["battle_panel"] = (bot, event, kwargs) => battlePanel(bot, event, kwargs);
	HANDLERS["query"] = (_bot, _event, kwargs) => {
		const params = mapKwargsToParams(kwargs);
		return query({
			mode: params.mode ?? "list",
			key_pattern: params.keyPattern ?? "*",
			scope: params.scope ?? "global",
			sort_by: params.sortBy ?? "",
			order: params.order ?? "asc",
			limit: params.limit ?? 1e3,
			filter_expr: params.filterExpr ?? "",
			aggregate_func: params.aggregateFunc ?? "count",
			bot: _bot,
			event: _event
		});
	};
}

export { registerPositionalNodes, registerTimeNodes, registerServiceNodes, registerOfficialNodes };
