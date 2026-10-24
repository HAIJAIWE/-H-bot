// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { indentStr, tsLiteral } from "../typescriptUtils";

/** ===== 核心节点自定义 emit 实现 ===== */
/**
* 把「原样片段」（表达式 / 模板 / SQL / 文本）安全地写成**注释**。
*
* ⚠️ 为什么不能直接当语句写：这些片段来自用户配置，是 Python 风格表达式、中文文案或 SQL，
* 直接拼进代码就是**语法错**。实测：一条 RPG 主线（含 17 个 `expression_eval`）让快照
* 报出 25 处语法错误，而 `generateCode` 的 `errors` 仍是空的（静默产坏码）。
* 快照的定位是「只读大纲」，把原文放进注释既保留信息，又不会污染 IDE 的 Problems 面板。
*
* 多行片段逐行加前缀，避免第二行裸奔成语句。
*/
function outlineComment(ind, label, raw) {
	const text = String(raw ?? "");
	const head = `${ind}// ${label}`;
	if (!text.trim()) return head;
	return `${head}\n${text.split(/\r?\n/).map((l) => `${ind}//   ${l}`).join("\n")}`;
}
/** 变量设置节点发射器 */
function emitVariableSet(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const varName = config.var_name || "temp_var";
	const value = config.value ?? config.expression ?? "";
	return `${outlineComment(ind, `设置变量: ${varName} =`, value)}\n${ind}setVariable(${tsLiteral(varName)}, ${tsLiteral(value)});`;
}
/** 变量持久化节点发射器 */
function emitVariablePersist(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "load");
	const key = String(config.key ?? "");
	const scope = String(config.scope ?? "user");
	return `${ind}// ${`持久化: mode=${mode} key=${key || "(批量)"} scope=${scope}`}\n${ind}saveVariable(${key ? tsLiteral(key) : "/* keys */ []"});`;
}
/** 消息发送节点发射器 */
function emitMessageSend(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = config.mode || "text";
	const target = config.target_type || "friend";
	const content = config.text ?? "";
	if (mode === "input_notify") {
		const raw = Number(config.input_second);
		const seconds = Number.isFinite(raw) && raw > 0 ? raw : 30;
		return `${ind}// 输入中状态（官方 msg_type=6，仅单聊）to ${target}，持续 ${seconds}s\n${ind}sendInputNotify(${tsLiteral(target)}, ${seconds});`;
	}
	if (mode === "ark") {
		const templateId = Number(config.ark_template_id) || 0;
		return `${ind}// 结构化卡片（仅频道，需向平台申请准入）to ${target}，模板 ${templateId}\n${ind}sendArk(${tsLiteral(target)}, ${templateId});`;
	}
	if (mode === "embed") {
		const title = config.embed_title ?? "";
		return `${ind}// Embed 卡片（仅频道）to ${target}\n${ind}sendEmbed(${tsLiteral(target)}, ${tsLiteral(title)});`;
	}
	const payload = mode === "media" ? config.media_url : mode === "segment" ? config.segments : mode === "forward" ? config.messages : mode === "markdown" || mode === "keyboard" ? config.markdown || content : content;
	return `${ind}// 发送消息 (${mode}) to ${target}\n${ind}sendMessage(${tsLiteral(target)}, ${tsLiteral(payload)})`;
}
/** 文本格式化节点发射器 */
function emitFormatText(node, ctx, indent) {
	const ind = indentStr(indent);
	const template = (node.data?.config || {}).template || "";
	return `${outlineComment(ind, "文本格式化:", template)}\n${ind}formatText(${tsLiteral(template)});`;
}
/** 表达式评估节点发射器 */
function emitExpressionEval(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "single");
	const expr = config.expression || "";
	if (mode === "formulas" && Array.isArray(config.formulas)) return `${outlineComment(ind, "多公式批量计算:", config.formulas.map((f) => `${f.name ?? "?"} = ${f.expression ?? ""}`).join("\n"))}\n${ind}evalFormulas();`;
	return `${outlineComment(ind, "表达式:", expr)}\n${ind}evalExpression(${tsLiteral(expr)});`;
}
/** 消息撤回节点发射器 */
function emitMessageRecall(node, ctx, indent) {
	const ind = indentStr(indent);
	const msgId = (node.data?.config || {}).message_id || "";
	return `${ind}// 撤回消息: ${msgId}\n${ind}recallMessage(${tsLiteral(msgId)});`;
}
/** 消息编辑节点发射器 */
function emitMessageEdit(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const msgId = config.message_id || "";
	const newContent = config.new_text ?? "";
	return `${ind}// 编辑消息: ${msgId}\n${ind}editMessage(${tsLiteral(msgId)}, ${tsLiteral(newContent)})`;
}
/** 群组操作节点发射器 */
function emitGroupOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "");
	const groupId = String(config.group_id ?? "");
	return `${ind}// 群组操作: mode=${mode}\n${ind}groupOp(${tsLiteral(mode)}, ${tsLiteral(groupId)});`;
}
/** 文件操作节点发射器 */
function emitFileOperate(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "");
	const filePath = String(config.file_path ?? "");
	return `${ind}// 文件操作: mode=${mode}\n${ind}fileOperate(${tsLiteral(mode)}, ${tsLiteral(filePath)});`;
}
/** 数据库写入节点发射器 */
function emitDatabaseWrite(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "");
	const table = String(config.table ?? "");
	const data = config.data ?? "";
	return `${ind}// 数据库操作: mode=${mode} table=${table}\n${ind}dbInsert(${tsLiteral(table)}, ${tsLiteral(data)});`;
}
/** HTTP 请求节点发射器 */
function emitHttpRequest(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const method = String(config.method ?? "GET");
	const url = String(config.url ?? "");
	return `${ind}// HTTP 请求: ${method} ${url}\n${ind}httpRequest(${tsLiteral(method)}, ${tsLiteral(url)});`;
}
/** 延时节点发射器 */
function emitDelay(node, ctx, indent) {
	const ind = indentStr(indent);
	const seconds = (node.data?.config || {}).seconds ?? 1;
	return `${ind}// 延时 ${seconds}s\n${ind}await sleep(${seconds} * 1000);`;
}
/** 随机节点发射器 */
function emitRandom(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const min = String(config.min_value ?? 0);
	const max = String(config.max_value ?? 100);
	return `${ind}// 生成随机数 [${min}, ${max}]\n${ind}Math.floor(Math.random() * (${max} - ${min} + 1)) + ${min};`;
}
/** 时间操作节点发射器 */
function emitTimeOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "now");
	return `${ind}// 时间操作: mode=${mode}\n${ind}timeOp(${tsLiteral(mode)});`;
}
/** 列表操作节点发射器 */
function emitListOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "append");
	return `${ind}// 列表操作: mode=${mode}\n${ind}listOp(${tsLiteral(mode)});`;
}
/** 开关案例节点发射器 */
function emitSwitchCase$1(node, ctx, indent) {
	const ind = indentStr(indent);
	const indBody = indentStr(indent + 1);
	const config = node.data?.config || {};
	const matchVar = config.match_var || "msg.text";
	const cases = config.cases || [];
	const defaultCase = config.default || "default";
	let code = `${ind}// 多重判断\n${ind}switch (${matchVar}) {\n`;
	for (const c of cases) {
		const match = c.match;
		const label = c.label;
		if (match === "*") code += `${indBody}default:\n`;
		else if (match.startsWith(">=") || match.startsWith("<=") || match.startsWith(">") || match.startsWith("<")) code += `${indBody}case (${matchVar} ${match}):\n`;
		else code += `${indBody}case ${JSON.stringify(match)}:\n`;
		code += `${indBody}  // ${label}\n`;
		code += `${indBody}  break;\n`;
	}
	code += `${indBody}default:\n`;
	code += `${indBody}  // ${defaultCase}\n`;
	code += `${ind}}\n`;
	return code;
}
/**
* 循环控制节点发射器。
*
* ⚠️ 旧实现把模式字面量写成 `' times'` / `' while'` / `' iterate'`（**带前导空格**），
* 而 catalog 里是 `times`/`while`/`iterate` —— 三个分支永远匹配不上，一律掉进 default，
* 渲染出 `times(10) { ... }` 这种**语法错**的假代码。这里按真实键与取值重写，
* 并把"循环体在画布连线上、快照里看不到"如实写出来（不再假装有 body）。
*/
function emitLoopControl(node, ctx, indent) {
	const ind = indentStr(indent);
	const indBody = indentStr(indent + 1);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "times");
	const hint = `${indBody}// 循环体见画布连线（快照不展开）`;
	switch (mode) {
		case "times": {
			const count = String(config.max_iterations ?? config.count ?? 10);
			return `${ind}// 循环 ${count} 次\n${ind}for (let i = 0; i < ${count}; i++) {\n${hint}\n${ind}}`;
		}
		case "while": return `${outlineComment(ind, "循环直到条件满足:", String(config.expression ?? config.condition ?? "true"))}\n${ind}while (/* 见上方条件 */ true) {\n${hint}\n${ind}}`;
		case "iterate": {
			const list = String(config.list ?? "[]");
			return `${ind}// 遍历列表: ${list}\n${ind}for (const item of ${list}) {\n${hint}\n${ind}}`;
		}
		default: return `${ind}// 循环控制: mode=${mode}\n${hint}`;
	}
}
/** Try/Catch 节点发射器 */
function emitTryCatch$1(node, ctx, indent) {
	const ind = indentStr(indent);
	const indBody = indentStr(indent + 1);
	const config = node.data?.config || {};
	return `${ind}try {\n${indBody}${config.try_body || ""}\n${ind}} catch (e) {\n${indBody}${config.catch_body || ""}\n${ind}}`;
}
/** 重试执行节点发射器 */
function emitRetryExec$1(node, ctx, indent) {
	const ind = indentStr(indent);
	const indBody = indentStr(indent + 1);
	const config = node.data?.config || {};
	const maxRetries = config.max_retries || "3";
	const delay = config.delay || "1000";
	return `${ind}// 重试执行 (最多 ${maxRetries} 次)\n${ind}for (let attempt = 0; attempt < ${maxRetries}; attempt++) {\n${indBody}${config.body || ""}\n${indBody}if (attempt < ${maxRetries} - 1) {\n${indBody}  await sleep(${delay});\n${indBody}}\n${ind}}`;
}
/** 系统日志节点发射器 */
function emitSystemLog(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const level = String(config.level ?? "info");
	const message = String(config.message ?? "");
	return `${ind}// 系统日志 [${level}]\n${ind}console.${[
		"info",
		"warn",
		"error",
		"debug"
	].includes(level) ? level : "log"}(${tsLiteral(message)});`;
}
/** 检查权限节点发射器 */
function emitCheckPermission(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const role = String(config.role ?? "admin");
	return `${ind}// 检查权限: ${role}\n${ind}checkPermission('${role}')`;
}
/** 机器人聊天节点发射器 */
function emitAgentChat(node, ctx, indent) {
	const ind = indentStr(indent);
	const prompt = (node.data?.config || {}).prompt || "\"\"";
	return `${ind}// 机器人聊天\n${ind}callLLMAgent(${JSON.stringify(prompt)})`;
}
/** 意图分类节点发射器 */
function emitIntentClassify(node, ctx, indent) {
	const ind = indentStr(indent);
	return `${ind}// 意图分类\n${ind}classifyIntent(${(node.data?.config || {}).text || "msg.text"})`;
}
/** 正则提取节点发射器 */
function emitRegexExtract(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const raw = String(config.text ?? "");
	let input;
	if (!raw) input = "msg.text";
	else if (/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(raw)) input = raw;
	else input = tsLiteral(raw);
	const pattern = config.pattern || "\"\"";
	const group = config.group || "0";
	return `${ind}// 正则提取\n${ind}regexMatch(${input}, ${JSON.stringify(pattern)}, ${group})`;
}
/** JSON 操作节点发射器 */
function emitJsonOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "get");
	const source = typeof config.source === "string" ? config.source : JSON.stringify(config.source ?? {});
	const key = String(config.key ?? "");
	return `${ind}// JSON 操作: ${mode}${key ? ` (key=${key})` : ""}\n${ind}${mode}JSON(${source})`;
}
/** LLM 聊天节点发射器 */
function emitLlmChat(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const prompt = config.prompt || "\"\"";
	const model = config.model || "gpt-3.5-turbo";
	return `${ind}// LLM 聊天 (${model})\n${ind}callLLM(${JSON.stringify(prompt)}, '${model}')`;
}
/** 嵌入节点发射器 */
function emitEmbedding(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const text = String(config.text ?? "");
	return `${ind}// 计算嵌入\n${ind}getEmbedding(${tsLiteral(text)});`;
}
/** 持久化存储节点发射器 */
function emitPersistentStore(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "save");
	const key = String(config.key ?? "");
	const value = config.value ?? "";
	return `${ind}// 持久化存储: mode=${mode} key=${key}\n${ind}saveVariable(${tsLiteral(key)}, ${tsLiteral(value)});`;
}
/** 查询节点发射器 */
function emitQuery(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "list");
	const detail = [
		config.key_pattern ? `key_pattern=${config.key_pattern}` : "",
		config.scope ? `scope=${config.scope}` : "",
		config.filter_expr ? `filter_expr=${config.filter_expr}` : "",
		config.sort_by ? `sort_by=${config.sort_by}` : ""
	].filter(Boolean).join(" ");
	return `${ind}// 查询: mode=${mode}${detail ? " " + detail : ""}`;
}
/** 表定义节点发射器 */
/** 内存添加节点发射器 */
/** 内存搜索节点发射器 */
/** 内存清除节点发射器 */
/** 内存列表节点发射器 */
/** 内存操作节点发射器 */
function emitMemoryOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const op = config.op || "get";
	return `${ind}// 内存操作: ${op}\n${ind}${op}Memory('${config.key || "temp"}')`;
}
/** 并行执行节点发射器 */
function emitParallelExec(node, ctx, indent) {
	const ind = indentStr(indent);
	const indBody = indentStr(indent + 1);
	return `${ind}// 并行执行\n${ind}Promise.all([${(node.data?.config || {}).branches || "[]"}].map(async (task) => {\n${indBody}${indBody}return task;\n${ind}})).then(() => {\n${ind}})`;
}
/** 系统就绪节点发射器 */
function emitOnReady(node, ctx, indent) {
	const ind = indentStr(indent);
	return `${ind}// 机器人就 ready\n${ind}onReady()`;
}
/** 启动节点发射器 */
function emitOnStartup(node, ctx, indent) {
	const ind = indentStr(indent);
	return `${ind}// 机器启动\n${ind}onStartup()`;
}
/** 请求节点发射器 */
function emitOnRequest(node, ctx, indent) {
	const ind = indentStr(indent);
	return `${ind}// HTTP 请求事件\n${ind}onRequest()`;
}
/** 通知节点发射器 */
function emitOnNotice(node, ctx, indent) {
	const ind = indentStr(indent);
	return `${ind}// 收到通知事件\n${ind}onNotice()`;
}
/** 按钮点击节点发射器 */
function emitOnButtonClick(node, ctx, indent) {
	const ind = indentStr(indent);
	return `${ind}// 按钮点击事件\n${ind}onButtonClick()`;
}
/**
* 定时器节点发射器：对应 `builtinNodes.timerOp(mode, timerId)`。
*
* ⚠️ 以前这里指向 `timer`（开关定时器，签名 `(mode, callback, ms)`），
* 生成出来的 `timer('<id>', '<mode>')` 参数全错 —— 与目录契约（秒表语义）不符。
*/
function emitTimer(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "start");
	const timerId = String(config.timer_id ?? "default");
	return `${ind}// 计时器 [${timerId}] 模式=${mode}\n${ind}timerOp('${mode}', '${timerId}')`;
}
/** 子流程调用节点发射器：对应 builtinNodes.subflowCall(subflowId, input) */
function emitSubflowCall$1(node, ctx, indent) {
	return `${indentStr(indent)}// 调用子流程: ${(node.data?.config || {}).subflow_id || ""}`;
}
/** 子流程定义节点发射器：对应 builtinNodes.subflowDefined()（占位实现） */
function emitSubflowDefined(node, ctx, indent) {
	return `${indentStr(indent)}// 子流程定义: ${(node.data?.config || {}).subflow_name || ""}`;
}
/** 上下文获取节点发射器：对应 builtinNodes.getContext(bot, event, key) */
function emitGetContext(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "");
	return `${ind}// 获取上下文: ${mode}\n${ind}await getContext(bot, event, ${JSON.stringify(mode)})`;
}
/**
* 拆分后的上下文节点发射器工厂（2026-10-03）。
*
* 对应 `builtinNodes.getIds / getMessageContext / getMember / getGroup / getGroupLists / getBotState`
* —— 它们的参数与 `getContext` 同形（一个 options 对象），所以共用一个发射器，
* 只是**函数名不同**（代码生成要 import 真实导出名，不是目录里的 kind）。
*/
function emitSplitContext(fnName) {
	return function emitSplitContextFor(node, ctx, indent) {
		const ind = indentStr(indent);
		const config = node.data?.config ?? {};
		const opts = { mode: String(config.mode ?? "") };
		for (const key of [
			"index",
			"group_id",
			"user_id",
			"cursor",
			"part_mode"
		]) if (config[key] !== void 0) opts[key] = config[key];
		return `${ind}// 取上下文（${fnName}）: ${String(config.mode ?? "")}\n${ind}await ${fnName}(bot, event, ${JSON.stringify(opts)})`;
	};
}
/** 错误处理节点发射器：对应 builtinNodes.errorOp(error, mode) */
function emitErrorOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = config.mode || "return";
	return `${ind}// 错误处理 (${mode})\n${ind}errorOp(${config.message || "\"\""}, '${mode}')`;
}
/** API 调用节点发射器：对应 builtinNodes.apiCall(bot, event, url, method, ...) */
function emitApiCall(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const action = config.action || "";
	const params = config.params || "{}";
	return `${ind}// API 调用: ${action}\n${ind}await apiCall(bot, event, ${JSON.stringify(action)}, 'POST', {}, ${params})`;
}
/** 变量合并节点发射器：对应 builtinNodes.variableMerge(bot, event, target, source, mode) */
function emitVariableMerge(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const mode = String(config.mode ?? "dict");
	const keyNames = String(config.key_names ?? "[]");
	return `${ind}// 合并变量 (${mode}) 键名=${keyNames}\n${ind}await mergeVariables('${mode}', [${[
		"v1",
		"v2",
		"v3",
		"v4",
		"v5",
		"v6"
	].filter((key) => config[key] !== void 0 && config[key] !== null && config[key] !== "").map((key) => {
		const v = config[key];
		return typeof v === "string" ? v : JSON.stringify(v);
	}).join(", ")}], ${keyNames})`;
}
/** 面板注册节点发射器（声明式节点，无运行时代码） */
/**
* 消息段构造节点发射器。
*
* 与运行时 `builtinNodes/messageOp` 一致：按 segment_type 生成一个消息段对象，
* 输出到 `segment` 变量供 `message_send(mode=segment)` 使用。
*/
function emitMessageOp(node, ctx, indent) {
	const ind = indentStr(indent);
	const config = node.data?.config || {};
	const segmentType = String(config.segment_type || "at");
	const entries = [
		"user_id",
		"url",
		"file",
		"face_id",
		"title",
		"content",
		"image_url",
		"music_type",
		"audio_url",
		"singer",
		"message_id",
		"forward_id"
	].filter((key) => config[key] !== void 0 && config[key] !== "" && config[key] !== 0).map((key) => `${key}: ${tsLiteral(String(config[key]))}`);
	return `${ind}// 构造消息段: ${segmentType}\n${ind}const segment = constructSegment({ ${[`segment_type: ${tsLiteral(segmentType)}`, ...entries].join(", ")} });`;
}

export { outlineComment, emitVariableSet, emitVariablePersist, emitMessageSend, emitFormatText, emitExpressionEval, emitMessageRecall, emitMessageEdit, emitGroupOp, emitFileOperate, emitDatabaseWrite, emitHttpRequest, emitDelay, emitRandom, emitTimeOp, emitListOp, emitSwitchCase$1, emitLoopControl, emitTryCatch$1, emitRetryExec$1, emitSystemLog, emitCheckPermission, emitAgentChat, emitIntentClassify, emitRegexExtract, emitJsonOp, emitLlmChat, emitEmbedding, emitPersistentStore, emitQuery, emitMemoryOp, emitParallelExec, emitOnReady, emitOnStartup, emitOnRequest, emitOnNotice, emitOnButtonClick, emitTimer, emitSubflowCall$1, emitSubflowDefined, emitGetContext, emitSplitContext, emitErrorOp, emitApiCall, emitVariableMerge, emitMessageOp };
