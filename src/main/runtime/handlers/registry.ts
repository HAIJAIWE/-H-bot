// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/**
* 给位置参数风格 handler 的 `bot` 补上 `projectPath`。
*
* ## 为什么（A7：`agent_chat` 整个节点从来没运行过一次）
*
* 运行时**知道**当前项目（`HandlerContext.projectPath`，由 `FlowInterpreter` 填），
* kwargs 型 handler 一直能拿到；但位置参数型 handler 的统一签名是 `(bot, event, ...args)`，
* **拿不到 hctx** —— 而 `FlowRuntime.get bot` 只给 `{ callApi, self_id }`
* （`FlowRuntime.ts:430-435`）。于是 `agentChat` 一进门就读到空串：
* `bot.projectPath ?? ''` → 恒为空 → 永远返回「缺少项目路径…这是**接线问题**」。
* 用户照着那句提示去改接线也改不好（运行时当时确实没有这条路），
* 而这个节点的实现（策略/限流/会话记忆/两轮工具调用/高风险确认）**全都是完整的**。
*
* 补在这一处而不是各节点里：`projectPath` 是**同一份上下文**，不是新造的能力；
* 位置参数与 kwargs 两种注册方式本该看到同一个 bot。
*/
function withProjectPath(bot, hctx) {
	const projectPath = hctx?.projectPath;
	return projectPath ? {
		...bot,
		projectPath
	} : bot;
}
/**
* 声明式 handler 的**取值键表**（数组顺序 = 对应 `builtins` 函数的形参顺序，跳过 bot/event）。
*
* ## 这里存的是「kwargs 的键」，不是「形参名」—— 这是 2026-10-02 的统一
*
* kwargs 的键就是**端口 id**（触发器这类无端口节点则是 `defaultConfig` 的键）。
* 早先这张表存的是"形参名"，运行时再用 `mapKwargsToParams` 把它翻译回键 ——
* **同一个东西被表达了两遍**，而两遍之间的偏差正是事故来源：
*   · 写过 `auto_save` / `max_length`（那其实是**键**），而表里当时该写 `autoSave` / `maxLength`，
*     于是这两个端口的值永远是 undefined（静默失效）；
*   · `check_permission` 写过 `permission` —— 它既不是键、也不是该节点的任何端口，
*     于是 `checkPermission(role = 'admin')` 的形参默认值生效：面板上选「超级管理员」
*     实际只要求 ≥ 管理员（**群管理员越权通过**）、选「成员」实际要求 ≥ 管理员
*     （普通成员被静默拒绝）。
*
* 现在只表达一遍：**表里写键，运行时直接 `kwargs[键]`**。
* "名字对不对"由闸门直接对着目录（数据端口 id ∪ `defaultConfig` 键）校验 ——
* 不再经过 `portToParam` 的 camelCase 翻译，也就没有"该写名字还是该写键"这个歧义了。
*
* `null` = **有意的位置占位**（对应形参以下划线开头、故意不用），只为对齐后面的实参位置。
*/
var PARAM_KEYS = {
	message_received: [
		"match",
		"message_type",
		"command",
		"prefix",
		"keywords",
		"pattern",
		"flags"
	],
	message_recall: ["message_id"],
	message_edit: ["message_id", "new_text"],
	variable_set: ["value", "var_name"],
	variable_merge: [
		"mode",
		"v1",
		"v2",
		"v3",
		"v4",
		"v5",
		"v6",
		"key_names"
	],
	on_request: ["action"],
	on_notice: ["notice_type"],
	on_button_click: ["action"],
	agent_chat: [
		"prompt",
		"system_prompt",
		null,
		"temperature",
		null,
		"tools",
		"mode",
		"history",
		"max_rounds",
		"confirm_high_risk"
	],
	llm_chat: [
		"prompt",
		null,
		null,
		null,
		null
	],
	api_call: ["action", "params"],
	http_request: [
		"url",
		"method",
		"headers",
		"body",
		"timeout",
		"params",
		"response_format",
		"max_response_size"
	],
	check_permission: ["role"],
	embedding: ["text"],
	intent_classify: [
		"user_message",
		"intents",
		"system_prompt",
		"temperature"
	],
	wait_input: ["timeout", "prompt"],
	variable_persist: [
		"mode",
		"key",
		"value",
		"scope",
		"ttl",
		"default",
		"amount",
		"auto_save",
		"max_length",
		"data",
		"compare_op",
		"threshold",
		"delta",
		"keys",
		"item"
	]
};
/** handler 映射表（node kind → 统一签名函数） */
var HANDLERS = {};
/**
* 位置参数注册（按 `PARAM_KEYS[kind]` 的键序取值）。
*
* **直接按键取值**：不再经过 `mapKwargsToParams` 的"名字 → 键"反查。
* `null` 占位传 undefined，与 builtins 的形参位置逐位对齐。
* `withProjectPath`：声明式 handler 也要拿到当前项目（`agentChat` 依赖它定位
* 模型配置/工具白名单/会话记忆 —— 缺了它整个节点不可用）。
*/
function registerPositional(kind, fn) {
	const keys = PARAM_KEYS[kind] ?? [];
	HANDLERS[kind] = (bot, event, kwargs, hctx) => fn(withProjectPath(bot, hctx), event, ...keys.map((k) => k === null ? void 0 : kwargs[k]));
}
/** kwargs 注册（原样收到整份 kwargs） */
function registerKwargs(kind, fn) {
	HANDLERS[kind] = fn;
}

export { withProjectPath, PARAM_KEYS, HANDLERS, registerPositional, registerKwargs };
