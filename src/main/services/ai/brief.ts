// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

var COMMAND_KINDS = /* @__PURE__ */ new Set(["message_received"]);
/** 会写/读"数据键"的节点 —— 它们的 config 里那个键名就是项目词汇 */
var DATA_KEY_FIELDS = [
	"key",
	"variable",
	"dataKey",
	"name"
];
function asRecord(value) {
	return value && typeof value === "object" ? value : {};
}
/** 从一张流程里算出简报（纯函数，可穷举测试） */
function buildProjectBrief(graph) {
	const nodes = graph?.nodes ?? [];
	const existingCommands = /* @__PURE__ */ new Set();
	const dataKeys = /* @__PURE__ */ new Set();
	for (const node of nodes) {
		const data = asRecord(node.data);
		const kind = String(data.nodeKind ?? "");
		const config = asRecord(data.config);
		if (COMMAND_KINDS.has(kind) && config.match === "command") {
			const command = String(config.command ?? "").trim();
			if (command) existingCommands.add(command);
		}
		if (kind === "save_variable" || kind === "load_variable" || kind === "incr_variable") {
			const key = String(config.key ?? "").trim();
			if (key) dataKeys.add(key);
		}
		if (kind.startsWith("plugin_") || kind === "config_query") for (const field of DATA_KEY_FIELDS) {
			const value = String(config[field] ?? "").trim();
			if (value) dataKeys.add(value);
		}
	}
	const systems = (graph?.systems ?? []).map((s) => String(s.title ?? s.id ?? "").trim()).filter(Boolean);
	const pitfalls = [];
	if (existingCommands.size > 0) pitfalls.push(`已经有这些命令词：${[...existingCommands].map((c) => "/" + c).join("、")} —— 不要再建同命令词的触发器（一条消息会被回两遍）`);
	if (dataKeys.size > 0) pitfalls.push(`已经在用的数据键名：${[...dataKeys].join("、")} —— 优先复用，别自造近义词`);
	if (nodes.length >= 100) pitfalls.push(`这是个 ${nodes.length} 节点的大项目：先看简报再动手，别一次性重排整图`);
	return {
		existingCommands: [...existingCommands],
		dataKeys: [...dataKeys],
		systems,
		nodeCount: nodes.length,
		pitfalls
	};
}
/** 简报 → 系统提示里的一段（空简报返回空串：小项目不该多一段噪音） */
function renderBrief(brief) {
	if (brief.existingCommands.length === 0 && brief.dataKeys.length === 0 && brief.systems.length === 0) return "";
	const lines = [];
	if (brief.existingCommands.length > 0) lines.push(`· 已有命令词（**不要重复**）：${brief.existingCommands.map((c) => "/" + c).join("、")}`);
	if (brief.dataKeys.length > 0) lines.push(`· 已在用的数据键名（**优先复用**）：${brief.dataKeys.join("、")}`);
	if (brief.systems.length > 0) {
		const shown = brief.systems.slice(0, 12).join("、");
		lines.push(`· 系统/分组：${shown}${brief.systems.length > 12 ? ` 等 ${brief.systems.length} 个` : ""}`);
	}
	lines.push(`· 规模：${brief.nodeCount} 个节点`);
	return lines.join("\n");
}

export { COMMAND_KINDS, DATA_KEY_FIELDS, asRecord, buildProjectBrief, renderBrief };
