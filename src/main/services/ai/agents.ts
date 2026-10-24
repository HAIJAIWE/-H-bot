// @ts-nocheck
import { ALL_TOOL_DEFINITIONS } from './tools/defs';
import { AGENT_ROLE_HINT } from '@shared/ai/roleHints';
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/agents.ts），只保证语法/行为，类型待补。


/** 两个角色**都能用**的（只读 + 运行 + 自检 + 事务） */
var SHARED_TOOLS = [
	"list_nodes",
	"list_templates",
	"list_node_examples",
	"validate_flow",
	"preview_flow",
	"read_flow",
	"read_logs",
	"read_code",
	"read_file",
	"run_test",
	"run_bot",
	"stop_bot",
	"check_capabilities",
	"begin_batch",
	"commit_batch",
	"rollback_batch",
	"search_capabilities",
	"describe_capability",
	"invoke_capability",
	"propose_capability"
];
/** Builder（低代码页）：**改流程**的工具 —— 不碰源码文件 */
var BUILDER_TOOLS = [
	"add_node",
	"update_node",
	"delete_node",
	"connect_nodes",
	"apply_template",
	"new_command",
	"new_lookup",
	"generate_code",
	"create_ai_node"
];
/** Coder（代码页）：**改代码**的工具 —— 不动流程节点 */
var CODER_TOOLS = [
	"write_code",
	"write_file",
	"create_ai_node",
	"generate_code"
];
/** 双向（duo）：两边的工具都给 —— 造节点 + 接进流程一次做完 */
var DUO_TOOLS = [.../* @__PURE__ */ new Set([...BUILDER_TOOLS, ...CODER_TOOLS])];
/**
* **创作模式（creator）**：给**这个应用自己**加功能（P1-8）。
*
* 只有一个"写"工具族：`write_code` / `write_file` —— 也就是**改文件**。
* **刻意不给**图编辑工具（add_node / connect_nodes / apply_template / new_command /
* new_lookup / update_node / delete_node）—— 它不是来搭流程的，那是用户的机器人项目里的事；
* 也不给 `generate_code` / `create_ai_node`（那两个作用在**用户项目**上，与"改应用"无关）。
* 能力层那几个（search / describe / invoke / propose_capability）本来就在 SHARED_TOOLS 里。
*/
var CREATOR_TOOLS = ["write_code", "write_file"];
var AGENT_TOOLS = {
	builder: [...SHARED_TOOLS, ...BUILDER_TOOLS],
	coder: [...SHARED_TOOLS, ...CODER_TOOLS],
	duo: [...SHARED_TOOLS, ...DUO_TOOLS],
	creator: [...SHARED_TOOLS, ...CREATOR_TOOLS]
};
/** 角色强调句（进系统提示：明确告诉模型"这一页该干什么、别串味"） */
/* 角色强调句已移到 shared（两条链路都要用；见 src/shared/ai/roleHints.ts），这里只转出去 */

/**
* **开荒模式**（还没有项目）能用的工具。
*
* 用户第一次打开客户端时最想说的就是「帮我做个 XX 机器人」—— 而那时**一个项目都没有**。
* 这个模式下不能有 read_flow / add_node 之类（它们都要有已打开的项目）；
* 只留三件事：**查这台应用能做什么 → 看某一条的细节 → 提议（建项目）**。
*/
var ONBOARDING_TOOLS = [
	"search_capabilities",
	"describe_capability",
	"propose_capability"
];
function toolsForOnboarding(all = ALL_TOOL_DEFINITIONS) {
	const allowed = new Set(ONBOARDING_TOOLS);
	return all.filter((t) => allowed.has(t.name));
}
/** 开荒模式的强调句（进系统提示）：把「先问清、再提议」讲明白 */
var ONBOARDING_HINT = "当前状态：**用户还没有打开任何项目**（可能是第一次用）。你的任务：先问清他想做个什么样的机器人（做什么功能、给谁用），**不要一次问太多**；信息够了就用 propose_capability 提议 project.create，并说清确认后会发生什么。⚠️ 这个状态下**没有**流程/代码可读可改（read_flow / add_node 之类不可用）——项目建好之后再谈画布上的事。不确定这台应用能做什么时，用 search_capabilities 查。";
/**
* 页面/模式 → 角色。未知/未传一律当 **低代码**（助手的主要战场，也是用户最常待的页）。
*
* ⚠️ 创作模式**只能显式选**（与 duo 同）：它是唯一一个"改应用自己"的角色，
* 默认绝不能落进去。
*/
function roleForMode(mode) {
	if (mode === "code") return "coder";
	if (mode === "duo") return "duo";
	if (mode === "creator") return "creator";
	return "builder";
}
/** 给某个角色的工具表（顺序沿用 ALL_TOOL_DEFINITIONS，保证描述/分类与全局一致） */
function toolsForRole(role, all = ALL_TOOL_DEFINITIONS) {
	const allowed = new Set(AGENT_TOOLS[role]);
	return all.filter((t) => allowed.has(t.name));
}


export { toolsForOnboarding, roleForMode, toolsForRole, SHARED_TOOLS, BUILDER_TOOLS, CODER_TOOLS, DUO_TOOLS, CREATOR_TOOLS, AGENT_TOOLS, AGENT_ROLE_HINT, ONBOARDING_TOOLS, ONBOARDING_HINT };
/** 角色真源在 shared（渲染层也要用）—— 这里只转出去，不另立一份 */
export type { AgentRole } from '@shared/ai/roleDomains';
