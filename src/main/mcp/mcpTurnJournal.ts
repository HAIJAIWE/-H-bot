// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { getToolCategory } from "../services/ai/tools/defs";
import { classifyTool } from "../services/ai/toolGuard";

/**
* 诊断开关（与 `QQBAT_PLAN_PHASE` / `QQBAT_AUTO_TX` 同一类）。
*
* 默认**关**：不设这个变量时，MCP 的调用路径与改造前**逐字节一致**（不开轮次、不写历史）。
* 打开：`QQBAT_MCP_TURN_JOURNAL=1`。
*/
var MCP_TURN_JOURNAL_ENV = "QQBAT_MCP_TURN_JOURNAL";
function isMcpTurnJournalEnabled(env = process.env) {
	return env[MCP_TURN_JOURNAL_ENV] === "1";
}
/**
* 这次调用要不要开轮次。
*
* 两类都要开：
*   1. **mutation**（改图 / 写文件）—— 拿 `getToolCategory`；
*   2. **声明是 query、但有副作用且不可撤回**的（`run_bot` / `stop_bot` / `run_test` /
*      `invoke_capability`…）—— 它们以前**不进轮次**，于是「MCP 起机器人 + 跑测试 → 数据被写」
*      这一段既没有记录也没有 `data/` 快照（P0-13 ④）。
*
* ⚠️ 判据**仍然只有一处**：第 2 类的"有副作用"不另写白名单，而是问工具闸
* （`classifyTool` 判 `ask` 的 = 会真执行、撤不回来的）—— 与助手路径、与 UI 提示同一份表。
* 本仓库为"同一件事两份真源"付过太多次代价（批处理三件套的 `QUERY_SIDE_EFFECTS` 注释就写着
* 「另写一张表 = 两份真源，迟早与分类漂移」）。
*
* 边界（写明的，不是漏掉的）：批处理三件套（begin/commit/rollback_batch）在工具闸里是
* `QUERY_SIDE_EFFECTS`（明确**不问**用户 —— 真机教训：判成 ask 之后用例超时 30s），所以它们
* 也不进轮次；它们本身是一次事务的**边界标记**，单独立一轮会把一次事务拆成三条记录。
*
* 另一个边界：`getToolCategory` 对**未知名字**按最保守处理（返回 `mutation`）——
* 于是拼错的工具名也会开一次轮次。无害：它在 server 侧先被拒（未知工具），收尾时按
* "无改动"处理，轮次不会被落盘（`endTurn` 对"没文件、没改动"的轮次直接丢弃）。
*/
function shouldJournalTurn(toolName) {
	const category = getToolCategory(toolName);
	if (category === "mutation") return true;
	/** 有副作用的 query：工具闸会停下来问用户的那些（判据来自 toolGuard，不新造） */
	return classifyTool(toolName, category, { mode: "acceptEdits" }) === "ask";
}
/**
* 轮次标签（写进 `.qqbat/history/turns/<id>.json` 的 `userMessage`）。
*
* 用户在「轮次列表 / 撤回这一轮」里看到的就是这一句 —— 必须一眼看出**是谁改的**：
* AI 会话那一条写的是用户原话，这一条写 `MCP：工具名`。
*/
function turnLabelFor(toolName) {
	return `MCP：${toolName}`;
}

export { MCP_TURN_JOURNAL_ENV, isMcpTurnJournalEnabled, shouldJournalTurn, turnLabelFor };
