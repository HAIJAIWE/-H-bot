// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/toolGuard.ts），只保证语法/行为，类型待补。

/** 工具闸模式：与 `QQBAT_TOOL_GUARD` 的三个取值同一套（真源 `src/main/mcp/mcpToolGuard.ts:31 resolveGuardMode`） */
export type GuardMode = "readonly" | "acceptEdits" | "auto";
/** 一次调用的处置结论：自动执行 / 问用户 / 拒绝 */
export type ToolVerdict = "auto" | "ask" | "deny";


/** 纯查询：不碰磁盘、不碰网络、不改状态 */
var PURE_READS = /* @__PURE__ */ new Set([
	"list_nodes",
	"list_node_examples",
	"list_templates",
	"check_capabilities",
	"read_flow",
	"validate_flow",
	"preview_flow",
	"read_code",
	"read_file",
	"read_logs",
	"search_capabilities",
	"describe_capability"
]);
/**
* **会真执行、结果不可撤回**的工具。
*
* · `run_bot` / `stop_bot`：真的起停机器人进程；
* · `run_test`：工具自述「会真的执行流程、**可能写项目数据**」—— 这是最典型的不可撤回；
* · `invoke_capability`：能力执行口，可能删表/发消息（分类=query 只是"结果直接回传"，不代表无害）；
* · `propose_capability`：有副作用能力的提案入口。
*/
/**
* **声明是 query、但有副作用**的工具：批处理事务三件套。
*
* 它们由界面在用户确认时统一调用（提示词里明写「不要自己管事务」），
* 本身既不改图也不落盘 —— 所以**不该问**。真机教训：把 begin_batch 判成 ask 之后，
* 用例直接超时 30s（闸门在等一个永远不会来的批准）。
*/
var QUERY_SIDE_EFFECTS = /* @__PURE__ */ new Set([
	"begin_batch",
	"commit_batch",
	"rollback_batch"
]);
var IRREVERSIBLE = /* @__PURE__ */ new Set([
	"run_bot",
	"stop_bot",
	"run_test",
	"invoke_capability",
	"propose_capability"
]);
/**
* **可撤回**的写操作：直接落盘，但 turnJournal 记了 before，能整体回滚。
* （图改动类 mutation 不在这个集合里 —— 它们走提案，提案本身就是闸门。）
*/
var REVERSIBLE_WRITES = /* @__PURE__ */ new Set([
	"write_code",
	"write_file",
	"create_ai_node"
]);
/** 改图类 mutation：进"待确认计划"，用户确认才落地 —— 所以运行时这一步不需要再问 */
var PROPOSAL_MUTATIONS = /* @__PURE__ */ new Set([
	"add_node",
	"connect_nodes",
	"update_node",
	"delete_node",
	"apply_template",
	"new_command",
	"new_lookup",
	"generate_code",
	"begin_batch",
	"commit_batch",
	"rollback_batch"
]);
/**
* 判一次工具调用该不该自动跑。
*
* **fail-safe**：名字不在任何表里（新工具 / 拼错）→ `ask`。
* 理由与本仓库既有的「未登记分类按 mutation 处理」同源：不认识的**先拦一下**，
* 而不是默认放行（默认放行等于闸门形同虚设）。
*/
function classifyTool(name, category, opts) {
	if (opts.approved?.has(name)) return "auto";
	if (PURE_READS.has(name)) return "auto";
	/**
	* **MCP 上下文（P1-3）**：改图类在助手路径上"不需要再问"，是因为助手会把它转成
	* 提案卡片摆到 AI 面板、用户点「应用」才落地 —— **提案本身就是闸门**。
	* 而 MCP 客户端（外部 IDE）没有那张卡片，直接派发等于绕过用户，所以这里必须问。
	* 10/18 的产物里这条判据还没落（本文件按产品行为还原），但 mcpToolGuard 已经在传
	* context、server 也按 ask 写好了弹窗与拒绝文案，缺的就是这一行判断。
	*/
	if (opts.context === "mcp" && PROPOSAL_MUTATIONS.has(name) && opts.mode !== "auto") return "ask";
	if (IRREVERSIBLE.has(name)) return opts.mode === "auto" ? "auto" : "ask";
	if (QUERY_SIDE_EFFECTS.has(name)) return opts.mode === "auto" ? "auto" : "auto";
	if (category === "query") return opts.mode === "auto" ? "auto" : "ask";
	if (opts.mode === "readonly") return "ask";
	if (REVERSIBLE_WRITES.has(name)) return "auto";
	if (PROPOSAL_MUTATIONS.has(name)) return "auto";
	return "ask";
}
/** 判定结果给用户看的一句话（UI 与日志共用，避免两处措辞漂移） */
var VERDICT_HINT = {
	auto: "自动执行",
	ask: "需你确认（这一步会真的执行，撤不回来）",
	deny: "已禁止"
};


export { classifyTool, PURE_READS, QUERY_SIDE_EFFECTS, IRREVERSIBLE, REVERSIBLE_WRITES, PROPOSAL_MUTATIONS, VERDICT_HINT };
