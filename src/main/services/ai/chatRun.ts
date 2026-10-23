// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/chatRun.ts），只保证语法/行为，类型待补。
import * as require_logger from '../infra/logger';
import type { BrowserWindow } from 'electron';
import type { ChatMessage } from '@shared/types/ai';
import type { ProposalOperation, ProposalValidation } from '@shared/types/proposal';
import type { AgentRole } from '@shared/ai/roleDomains';
import type { AutoTxHooks } from './autoTx';

import { logger } from '../infra/logger';
import { getToolCategory, ALL_TOOL_DEFINITIONS } from './tools/defs';
import { executeTool, ToolAbortedError } from './tools/execute';
import { normalizeToolCalls, buildToolResultMessages, buildToolResultMessagesWithSpill, buildToolFailureMessagesWithSpill } from './toolMessages';
import { appendTrace } from './trace';
// P1-7：trace 行要挂到当前轮（否则界面「上一轮改了什么」查不到工具调用历史）。
// 取 currentTurnId 而不是自己造 id —— 轮次只有一个来源，见 flow/turnJournal。
import { currentTurnId } from '../flow/turnJournal';
import { buildPendingContext } from './pendingContext';
import { classifyTool, VERDICT_HINT } from './toolGuard';
import { requestApproval } from './toolApproval';
import { queryCacheKey, isSubsumedByFullScope } from './queryDedupe';
import { toolCallToOperations } from './proposal';
import { callLlmWithFallback } from './llmFallback';
import { validateProposalOperations } from './proposalValidation';
import { buildVerdict, isSelfConsistencyEnabled, findIncompleteRebuild, mergeVerdicts } from './verifier';
import { shouldReviewWithModel, verifyPlanWithModel } from './verifierLlm';
import { createProposal } from '@shared/types/proposal';
/** 一轮对话最多跑几轮模型调用（真机论证见 docs/ai/agent-architecture-review-2026-10-18.md） */
export const MAX_ROUNDS = 18;
/** 最后几轮进入"收尾"模式（不再查资料，只提交已确定改动） */
export const WRAP_UP_ROUNDS_BEFORE_END = 4;
/** 一次对话里最多为"只宣布不动手"踢几脚 */
export const MAX_ANNOUNCE_KICKS = 2;
/** 只读计划阶段最多几轮 */
export const PLAN_PHASE_MAX_ROUNDS = 3;

/** 状态条（轮数/步数来自真实流程，token 只来自厂商回传） */
export interface ChatRunStats {
  rounds: number;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  usageReported: boolean;
  llmMs: number;
  contextTokens: number;
  contextBudget: number;
  planRounds: number;
  contextHeaviest?: Array<{ label: string; tokens: number }>;
  contextChars?: number;
}

/**
 * 一轮对话的可变状态（index / lanes / scout 三处共用）。
 *
 * 字段是**真实被读写的那一份**：少写一个字段不会报错（chatRun 带 @ts-nocheck），
 * 但运行时会静默丢状态 —— 所以这里宁可多列，不省略。
 */
export interface ChatRunState {
  projectPath: string;
  win: BrowserWindow;
  signal?: AbortSignal;
  messages: ChatMessage[];
  pendingOperations: ProposalOperation[];
  fullResponse: string;
  hadToolCalls: boolean;
  toolCallCounts: Map<string, number>;
  approvedTools?: Set<string>;
  allowedTools?: Set<string>;
  queryCache?: Map<string, unknown>;
  role?: AgentRole;
  llm?: unknown;
  autoTx?: AutoTxHooks;
  planPhase?: boolean;
  stats?: ChatRunStats;
  isBatchMode(): boolean;
  onBatchToolFailure(): void;
}



/**
* 工具闸模式（默认 acceptEdits = 用户 2026-10-15 选定）：
* 只读自动 / 可撤回的写自动 / **不可撤回的（run_bot、run_test、invoke_capability…）先问**。
*
* 可用 `QQBAT_TOOL_GUARD=readonly|acceptEdits|auto` 覆盖 —— 真机对照用（与 QQBAT_KB 同类诊断开关）。
*/
var TOOL_GUARD_MODE = process.env.QQBAT_TOOL_GUARD ?? "acceptEdits";
/**
* 收尾催促语（作为一条 user 消息插进对话）。
*
* 为什么要它：模型会**很听话地继续查资料**，直到轮数用光 —— 它不知道"预算"这件事。
* 与其把上限一味调大（慢且贵），不如在最后几轮**明确告诉它预算快没了、别再查、直接提计划**。
*/
/**
* "只宣布不动手"的辩解：真机（04:31）里模型连着说"现在开始提交改动。第一轮：新增/删除/改配置。"
* 却**一个工具都没调用** —— 而纯文本回复会让循环结束，用户什么也拿不到。
* 判据刻意保守（结尾冒号 / 明显的"即将动手"句式），不确定就不踢。
*/
function looksLikeAnnouncement(text) {
	const t = text.trim();
	if (!t) return false;
	if (/[：:]$/.test(t)) return true;
	return /(现在开始|接下来|即将|马上|第一轮|第 1 轮|计划如下|我先|我来|开始提交|开始动手)/.test(t);
}
/** 一次对话里最多踢几脚（防止把轮数烧在"它反复宣布"上） */
/**
* **只有这些"纯读"工具**才允许按"同参数只执行一次"跳过（2026-10-06 自测踩出来的）。
*
* ⚠️ 不能拿 `category === 'query'` 当判据：`begin_batch` / `commit_batch` / `rollback_batch` /
* `run_bot` / `stop_bot` 也归在 query（它们不改流程文件），但都有**真实副作用** ——
* 把"第二次 begin_batch"跳掉是**骗它**（它会以为已经在批里），把 rollback 跳掉会把事务状态搞乱。
* 自测实况：模型在 9~13 轮里 begin → rollback → begin 反复横跳，去重把其中几次吞了。
*/
var DEDUPABLE_QUERY_TOOLS = /* @__PURE__ */ new Set([
	"list_nodes",
	"list_templates",
	"read_flow",
	"read_code",
	"read_file",
	"read_logs",
	"validate_flow",
	"preview_flow",
	"check_capabilities"
]);
/** 踢它一脚：别说计划，直接调工具 */
var ANNOUNCE_KICK_NUDGE = "（系统）你上一条**只是说了要做什么，却没有调用任何工具** —— 那样用户界面上什么都不会发生。现在**直接调用工具**把改动提交出来（不要再重复一遍计划，也不要再解释）。如果你确实还需要用户补充信息，才用一句话提**一个**问题。";
var WRAP_UP_NUDGE = "（系统催促）轮数快用完了。**不要再调用查询类工具**（read_flow / list_nodes / list_templates / read_file 等）—— 现在就把你已经确定的改动用工具提交出来（apply_template / new_command / new_lookup / add_node / connect_nodes / update_node / delete_node），否则这一段结束后用户什么也拿不到。";
/**
* 一轮里的工具分发。
*
* query 类立即执行并把结果回传；mutation 类**只累积进提案**（不落盘，等用户确认）。
* 结果统一走 `toolMessages` 那个唯一出口（序列化 + 预算 + 溢出 + 边界标注）。
*/
/**
* **这一批工具能不能并行执行**（纯函数：不碰 state、不看时间，可穷举测试）。
*
* 判据（少一条都会破坏语义）：
*   · 已取消 → 不能（"点了停止不该再跑任何工具"是硬不变式）；
*   · 少于 2 个 → 没必要；
*   · 有 mutation → 不能（自检工具的"预览图"上下文有顺序依赖）；
*   · 参数有重复 → 不能（去重必须按顺序判定）；
*   · 有未知工具 / 越界工具 → 不能（那些要走各自的拒绝路径）。
*/
function shouldParallelizeTools(calls, opts = {}) {
	if (opts.aborted) return false;
	if (calls.length <= 1) return false;
	if (!calls.every((c) => getToolCategory(c.name) === "query")) return false;
	const keys = calls.map((c) => `${c.name}:${JSON.stringify(c.args ?? {})}`);
	if (new Set(keys).size !== calls.length) return false;
	const { knownTools, allowedTools } = opts;
	if (knownTools && !calls.every((c) => knownTools.has(c.name))) return false;
	if (allowedTools && !calls.every((c) => allowedTools.has(c.name))) return false;
	return true;
}
/**
* **并行预取的前置条件**（P0-2，2026-10-18）：批次里不能有待审批的调用。
*
* 为什么必须有这一条：预取发生在**审批之前**（见 dispatchToolCalls 的 `prefetched`），
* 而 `run_test` 这类工具虽然声明成 `query`（结果直接回传）、handler 却**真执行流程、可能写项目数据**。
* 只按 category 判并行的话，`[read_logs, run_test]` 会让 run_test 在用户还没点"允许"之前就跑掉 ——
* 闸门在循环体里，预取已经绕过它了。所以：**整批只要有一个要走 ask/deny，就整批退回串行**，
* 让每个调用按顺序走各自的闸门（代价只是几个只读查询不并行，换来的是闸门不可绕过）。
*
* @returns 被挡住的工具名（空数组 = 整批可以并行）。返回名字而不是布尔，是为了日志能说清"被谁挡住"。
*/
function guardBlockedCalls(calls, opts = {}) {
	return calls.filter((c) => classifyTool(c.name, getToolCategory(c.name), opts) !== "auto").map((c) => c.name);
}
/**
* **重复查询就摘工具**（2026-10-10，真机：read_logs 连读 6 次 / list_nodes 4 次）。
*
* 与收尾收窄同一个思路：**不靠求它别查，直接让它查不了**（见 runOneRound 的 tools 参数注释）。
* 只摘 `category === 'query'` 的：mutation 工具多调几次常常是**正当的**
* （建两个节点 = 两次 create_ai_node），摘掉会把正经活儿也挡住。
*/
function narrowRepeatedTools(tools, counts, limit = 3) {
	if (!counts || counts.size === 0) return tools;
	const kept = tools.filter((t) => {
		if (t.category !== "query") return true;
		return (counts.get(t.name) ?? 0) < limit;
	});
	if (kept.length > 0) return kept;
	return [...tools].sort((a, b) => (counts.get(a.name) ?? 0) - (counts.get(b.name) ?? 0)).slice(0, 1);
}
/**
* ── 【计划阶段】（P1-7，2026-10-15）──────────────────────────────────────
*
* ## 为什么（真机证据，不是理论）
* · 一条用户消息 **7 轮模型调用、8 次工具调用，其中 read_flow 调了 5 次** —— 大部分轮次
*   花在"边读边改"上；更严重的一次：助手 delete_node 删掉节点、准备重建时模型额度 403，
*   用户的流程**永久少了节点**。根因不是"模型不听话"，而是**读资料与动手之间没有分界**。
* · 外部参考：Cline / OpenCode 的 **Plan 模式**（计划阶段只读、不碰文件）。
*
* ## 做法：**照本仓库已有的同族机制扩展，不另起一套**
* · 与 `narrowRepeatedTools`、收尾收窄**同一个思路**：不靠求它别动手，**直接把动手的工具从表里拿掉**
*   （那句话的原话是"不靠求它别查，直接让它查不了"—— 这里同理）；
* · 与 `AGENT_TOOLS` **同一套骨架**：计划阶段的工具表 = "角色表 ∩ 只读白名单"；
* · 计划阶段若仍调用 mutation 工具，走 `dispatchToolCalls` 里**既有的**那条
*   「工具未开放」拒绝分支（`allowedTools`），只换文案 —— **没有第二套拒绝逻辑**。
*
* ⚠️ **不能拿 `category === 'query'` 当"只读"的判据** —— 与 `DEDUPABLE_QUERY_TOOLS` 同一条血泪教训：
* `run_bot` / `stop_bot` / `begin_batch` / `commit_batch` / `rollback_batch` **也**归在 query，
* 但它们都有真实副作用（开机、停机、开事务…）；`invoke_capability` 更可能调到**有副作用的能力**
* （见 capabilityInvoke.ts 的 fail-closed 白名单）。放它们进去 = "只读计划"这回事自欺欺人。
* 所以这里是一张**显式白名单**，与 DEDUPABLE_QUERY_TOOLS 一样是"人工确认过的清单"。
*/
var PLAN_PHASE_READONLY_TOOLS = /* @__PURE__ */ new Set([
	"list_nodes",
	"list_templates",
	"list_node_examples",
	"read_flow",
	"validate_flow",
	"preview_flow",
	"read_code",
	"read_file",
	"read_logs",
	"check_capabilities",
	"search_capabilities",
	"describe_capability"
]);
/**
* 计划阶段的**角色提示**（第一轮作为一条 user 消息插进对话；与 WRAP_UP_NUDGE 同一类）。
*
* 只说三件事：这一轮**只做计划**、要说清**改什么/按什么顺序/有什么风险**、说清之后会放开动手工具。
* 不写"请遵守规则"这种话 —— 轮数是最稀缺的资源，提示词每一轮都要花钱。
*/
var PLAN_PHASE_HINT = "（系统）现在是**计划阶段**：这一轮**只做计划** —— 说清你要改什么（哪几个节点 / 哪几个文件）、按什么顺序改、有什么风险或依赖；需要看清楚的东西，先用只读工具查。**这一轮不要动手**（改盘的工具本轮不开放）。计划说清之后系统会放开动手工具，你照着自己的计划做。";
/**
* 计划定稿、**放开动手**时插的那句（与 ANNOUNCE_KICK_NUDGE 同一类，但方向相反：
* 那一句是"别说计划、直接动手"，这一句是"计划已经收到了，现在照它动手"）。
*
* ⚠️ 必须留一条"如果本来就不用改，直接回答"的出口：用户只是问个问题时，模型不该被逼着去改东西。
*/
var PLAN_PHASE_OPEN_NUDGE = "（系统）计划阶段结束：**动手工具已经放开**。现在照你上面说的计划**直接调用工具把改动提交出来**（不必再重复一遍计划，也不必从头再查一遍）。如果这一轮本来就只是回答问题、不需要改任何东西，就用一句话作答即可。";
/**
* 计划阶段的**诊断开关**（与 `QQBAT_KB=0`、`QQBAT_TOOL_GUARD` 同一类）。
*
* 默认**关**：不设这个变量时，工具表、轮数、消息序列与改造前**逐字节一致**。
* 打开：`QQBAT_PLAN_PHASE=1`。
*
* ## 为什么默认关（这是有意的，不是没接完）
* 这条改造**会改变每一轮的模型调用序列**（多 1..3 轮只读计划）。而 500+ 条既有闸门里
* 的脚本化模型（tests/evals/agentEvals、react-loop、chat-steps…）全都是"第一轮直接调 mutation"
* 的写法 —— 默认开会把它们一起打红，而那些文件不在本任务的写范围内。
* 翻默认值之前，请先在 `tests/setup.ts` 里照 `QQBAT_TOOL_GUARD` 的先例钉一行
* `process.env.QQBAT_PLAN_PHASE = '0'`，再逐条改那几个 eval 脚本。
*/
function isPlanPhaseEnabled(env = process.env) {
	return env.QQBAT_PLAN_PHASE === "1";
}
/**
* 计划阶段的工具表：**角色表 ∩ 只读白名单**（顺序沿用入参，保证描述/分类与全局一致）。
*
* 纯函数（不读 env、不碰 state）—— 与 `narrowRepeatedTools` 一样，可以被穷举断言。
*/
function planPhaseTools(tools) {
	return tools.filter((t) => PLAN_PHASE_READONLY_TOOLS.has(t.name));
}
/**
* 计划阶段对这张工具表**有没有意义**：
*   · 得**有可延期的事**（这张表里有 mutation 工具）—— 全只读的角色没什么好"先计划再动手"；
*   · 得**有能用的只读工具** —— 计划阶段把表收成空表，模型就没法作答了（`narrowRepeatedTools` 也踩过这个坑）。
*/
function planPhaseApplies(tools) {
	return tools.some((t) => t.category === "mutation") && planPhaseTools(tools).length > 0;
}
/**
* **下一轮还要不要继续只读地计划**（纯函数：不碰 state、不看时间，可穷举测试）。
*
* 三条出口（任一成立就放开动手）—— 都是"结构性"的，不看模型的脸色；另有"开关关着"这一条总闸：
*   · `!enabled`        → 开关关着，压根没有计划阶段（默认）；
*   · 预算用尽          → 防"读上瘾"把轮数烧光（真机就是这么烧的）；
*   · `!hadToolCalls`   → 纯文本，**这就是计划本身**（调用方负责把它接成"动手"，不能接成"结束"）；
*   · `saidSomething`   → 边读边把打算说清了，下一轮就该动手。
*/
function shouldStayInPlanPhase(input) {
	if (!input.enabled) return false;
	if (input.planRounds >= (input.maxPlanRounds ?? 3)) return false;
	if (!input.hadToolCalls) return false;
	if (input.saidSomething) return false;
	return true;
}
async function dispatchToolCalls(state, rawCalls) {
	const { projectPath, win, signal, pendingOperations } = state;
	/**
	* ⚠️ 用 `toolMessages.normalizeToolCalls` 这个**共享实现**。
	*
	* 此前这里自己抄了一份 `calls.map(...)` —— 而那个函数的注释里明写着
	* "作者助手与机器人侧的循环都要做这件事……抄第二份迟早会出现分裂"。
	* 事实也确实分裂了：本地这份少了共享实现里那句 `!args || typeof args !== 'object' → {}`
	* 的兜底，而且解析失败时的日志行为也不同。
	*/
	const calls = normalizeToolCalls(rawCalls);
	for (const call of calls) {
		const counts = state.toolCallCounts ??= /* @__PURE__ */ new Map();
		counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
	}
	/**
	* 通知渲染层：**正在调用哪个工具**。
	*
	* ⚠️ 不要再往 `ai:chunk` 里塞 `[工具调用] name(args)`（2026-10-06 删掉）。
	* 那是"结构化事件"之前的临时做法，后果是把**原始 JSON 混进聊天气泡**：
	* 用户看到的是满屏 `read_flow({"nodeId":"n7"})`，既看不懂、又把模型的正文冲散
	* （真机原话："工具是啥东西？啥时候搞的"）。工具调用现在完全由下面的
	* `ai:toolCall` 事件驱动**卡片**渲染，正文只留模型说的话。
	* （记忆文件里本来就没有这些行 —— 受罪的只有界面。）
	*/
	for (const call of calls) win.webContents.send("ai:agentState", {
		projectPath,
		state: "executing",
		message: call.name
	});
	/**
	* 结构化 trace 小助手：一次工具调用一行（成功/跳过/被拒/失败都记）。
	* `note` 是给人看的短说明 —— 复盘时"为什么跳过"比"跳过了"重要得多。
	*/
	const traceTool = (name, startedAt, ok, note, sizes) => {
		const turnId = currentTurnId(projectPath);
		appendTrace(projectPath, {
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			...turnId ? { turnId } : {},
			kind: "tool",
			name,
			ms: Date.now() - startedAt,
			ok,
			...sizes?.inChars !== void 0 ? { inChars: sizes.inChars } : {},
			...sizes?.outChars !== void 0 ? { outChars: sizes.outChars } : {},
			...state.role ? { agent: state.role } : {},
			...note ? { note } : {}
		});
	};
	/**
	* ── 只读工具的**并行预取**（2026-10-07，P3）──────────────────────────
	*
	* 背景：一轮里模型常一次要三四个查询（list_templates + read_flow + list_nodes…），
	* 串行等待就是 3–4 倍延迟（真机"不流畅"的一部分）。
	*
	* 只在这一种情况下并行：**整批都是 query 工具、≥2 个、参数两两不同、且都通过前置检查**。
	* 这样才不会有顺序依赖（mutation 会改变"预览图"上下文）也不会破坏去重语义
	* —— 任何一条不满足，就照旧走下面的顺序路径（行为一字不变）。
	*/
	const executeCtx = {
		...await buildPendingContext(projectPath, pendingOperations),
		signal
	};
	/**
	* 并行的两个条件缺一不可：①语义上允许（纯只读、参数互异…，见 shouldParallelizeTools）；
	* ②**闸门不会拦其中任何一个**（P0-2 —— 预取在审批之前，有 ask/deny 就得退回串行）。
	*/
	const guardBlocked = guardBlockedCalls(calls, {
		mode: TOOL_GUARD_MODE,
		...state.approvedTools ? { approved: state.approvedTools } : {}
	});
	if (guardBlocked.length > 0) logger.info(`[ai] 批次里有待审批的调用（${guardBlocked.join(", ")}），本批退回串行执行`);
	const canParallel = guardBlocked.length === 0 && shouldParallelizeTools(calls, {
		aborted: signal.aborted,
		...state.allowedTools ? { allowedTools: state.allowedTools } : {},
		knownTools: new Set(ALL_TOOL_DEFINITIONS.map((t) => t.name))
	});
	const prefetched = canParallel ? calls.map((call) => executeTool(call, projectPath, executeCtx)) : calls.map(() => null);
	if (canParallel) logger.info(`[ai] 只读工具并行执行：${calls.length} 个（${calls.map((c) => c.name).join(", ")}）`);
	const toolResults = [];
	for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
		const call = calls[callIndex];
		if (signal.aborted) break;
		const callT0 = Date.now();
		/**
		* ── 工具调用卡片的事件（结构化，**不靠解析文本**）─────────────────
		*
		* 渲染层一直有一套 `toolCalls` 状态与 `ToolCallCard` 组件，但
		* `addToolCall` / `updateToolCall` **零调用点** —— 卡片从来没渲染过（零引用扫描发现）。
		* 现在主进程在**开始/结束**时各发一条，卡片就有数据了。
		*/
		const callId = call.id || `${call.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		win.webContents.send("ai:toolCall", {
			projectPath,
			id: callId,
			name: call.name,
			args: call.args,
			status: "running",
			timestamp: Date.now()
		});
		/**
		* ⚠️ **先校验工具名，再决定"执行还是累积"**（2026-10-01 补）。
		*
		* 少了这一步，一个拼错的工具名会掉进下面的 mutation 分支，
		* 拿到一句「操作已加入待确认计划」—— **谎报**，而且模型会据此以为活儿成了。
		*/
		if (!ALL_TOOL_DEFINITIONS.some((t) => t.name === call.name)) {
			toolResults.push(...(await buildToolFailureMessagesWithSpill(call, /* @__PURE__ */ new Error(`未知工具: ${call.name}`), projectPath)).messages);
			continue;
		}
		/**
		* **能力边界**：不在本阶段/本角色能力内的工具 → 拒绝执行，并**说清为什么**。
		*
		* 顺序讲究：先判"是不是真工具"（上面），再判"这一轮开不开放"（这里）。
		*
		* 两种"不开放"共用**同一条拒绝路径**（只有文案不同，判据都在 `state.allowedTools`）：
		*   · M5 角色边界 —— 这属于另一页的活，请用户切页面；
		*   · P1-7 计划阶段 —— 这一轮只做计划，先把"要改什么"说清（见 PLAN_PHASE_* 说明）。
		* 混用文案会误导：计划阶段说成"另一页的活"，模型真会让用户去切页面（真机里干过）。
		*/
		if (state.allowedTools && !state.allowedTools.has(call.name)) {
			const otherPage = state.role === "coder" ? "低代码页" : "代码页";
			const reason = state.planPhase ? `工具 ${call.name} 在**计划阶段**不开放：这一轮只读、只做计划。先用只读工具把情况看清楚，把"要改什么、按什么顺序改"在正文里说清；计划说清之后动手工具会自动放开，**不要绕过**。` : `工具 ${call.name} 不在当前页面的能力内（这属于「${otherPage}」的活）。不要绕过：请明确告诉用户切换到对应页面，或改用你手上已有的工具。`;
			toolResults.push(...(await buildToolFailureMessagesWithSpill(call, new Error(reason), projectPath)).messages);
			logger.info(`[ai] 拒绝越界工具调用：${call.name}（角色 ${state.role ?? "builder"}${state.planPhase ? "，计划阶段" : ""}）`);
			traceTool(call.name, callT0, false, state.planPhase ? "计划阶段未开放" : "越界（不在当前角色能力内）");
			continue;
		}
		/**
		* **工具闸**（2026-10-15）：模式基线 × 规则层，判据只有一处（`toolGuard.ts`）。
		*
		* ⚠️ **诚实说明当前状态**：`ask` 只发一条警告后**照常执行** —— 因为「确认按钮」是 M1d 的活；
		* 在它上线前直接把不可撤回的工具拦掉，会让 AI 连 `run_bot` 都做不了（功能回退）。
		* 也就是说：**目前还没有真正的审批**，只有分类与提示。见 docs/evolution/02-改造路线图.md。
		*/
		const guardVerdict = classifyTool(call.name, getToolCategory(call.name), {
			mode: TOOL_GUARD_MODE,
			approved: state.approvedTools
		});
		if (guardVerdict === "deny") {
			toolResults.push(...(await buildToolFailureMessagesWithSpill(call, /* @__PURE__ */ new Error(`工具 ${call.name} 已被策略禁止：${VERDICT_HINT.deny}。`), projectPath)).messages);
			logger.info(`[ai] 工具闸禁止调用：${call.name}`);
			continue;
		}
		if (guardVerdict === "ask") {
			/**
			* **真停下来等用户**（M1d，2026-10-15）。
			*
			* 在这之前 `ask` 只能发条警告然后照常跑 —— 那等于没有闸门。现在：
			* 发 `ai:approvalRequest` → await → 渲染层回 allow / deny / always。
			* 超时与取消都由 `requestApproval` 兜成 deny（见那个文件的纪律 1/2）。
			*/
			const decision = await requestApproval({
				projectPath,
				callId: call.id,
				toolName: call.name,
				args: call.args ?? {},
				hint: VERDICT_HINT.ask
			}, {
				emit: (channel, payload) => win.webContents.send(channel, payload),
				signal: state.signal
			});
			if (decision === "deny") {
				toolResults.push(...(await buildToolFailureMessagesWithSpill(call, /* @__PURE__ */ new Error(`用户拒绝执行 ${call.name}。不要重试同一个调用，请改用别的办法或直接告诉用户。`), projectPath)).messages);
				traceTool(call.name, callT0, false, "用户拒绝（工具闸）");
				continue;
			}
			if (decision === "always") {
				const next = new Set(state.approvedTools ?? []);
				next.add(call.name);
				state.approvedTools = next;
				logger.info(`[approval] 本轮内不再询问：${call.name}`);
			}
		}
		const category = getToolCategory(call.name);
		/**
		* 同一工具 + 同一参数，在一段运行里**只真执行一次**（2026-10-06）。
		*
		* 真机证据：截图里 `read_flow(nodeId=n1)` 出现过两次、`list_nodes` 八次；日志里 18 轮
		* 全在"查资料" —— 模型会把同一件事查好几遍，白烧轮数与上下文（而轮数是它最稀缺的资源）。
		* 重复时**不重发结果本身**（那份已经在上下文里），只回一句"你刚查过，别重复"。
		*/
		if (category === "query" && DEDUPABLE_QUERY_TOOLS.has(call.name)) {
			const key = queryCacheKey(call.name, call.args ?? {});
			const cache = state.queryCache ??= /* @__PURE__ */ new Map();
			/**
			* ② **范围包含也算重复**（2026-10-15，见 queryDedupe.ts 的说明）：
			*   先 `read_flow()` 拿过全貌，再 `read_flow({ nodeId })` 查的其实是同一件事的子集。
			*   真机日志里 5 次 read_flow 有 3 次属于这种 —— 白烧了 3 轮。
			*/
			const subsumed = isSubsumedByFullScope(call.name, call.args ?? {}, cache);
			if (cache.has(key) || subsumed) {
				toolResults.push(...buildToolResultMessages(call, {
					status: "skipped",
					message: subsumed ? `（跳过重复调用）你本次已经用 ${call.name}() **不带参数查过全量**了 —— 你现在要的这段**就在前文那份结果里**，不要按参数再查一遍；若前文已被裁剪，去读它给出的 spill 文件路径。把轮数用在落地改动上。` : `（跳过重复调用）本次运行里你已经用同样的参数调用过 ${call.name} —— 结果见前文，**不要重复查同一件事**，把轮数用在落地改动上。`
				}).messages);
				win.webContents.send("ai:toolCall", {
					projectPath,
					id: callId,
					status: "done",
					result: "（跳过重复调用）",
					timestamp: Date.now()
				});
				logger.info(`[ai] 跳过重复的工具调用：${call.name}（同参数）`);
				traceTool(call.name, callT0, true, "跳过重复（同参数已执行过）");
				continue;
			}
			cache.set(key, true);
		}
		if (state.stats) state.stats.steps += 1;
		try {
			if (category === "query") {
				const prefetchedRun = prefetched[callIndex];
				const result = prefetchedRun ? await prefetchedRun : await executeTool(call, projectPath, {
					...await buildPendingContext(projectPath, pendingOperations),
					signal
				});
				if (result.needsClientExecution && result.clientInstruction) {
					state.autoTx?.noticeTransactionTool?.(call.name);
					win.webContents.send("ai:clientInstruction", {
						projectPath,
						instruction: result.clientInstruction
					});
				}
				const resultPayload = result.result ?? result;
				toolResults.push(...(await buildToolResultMessagesWithSpill(call, resultPayload, projectPath)).messages);
				win.webContents.send("ai:toolCall", {
					projectPath,
					id: callId,
					status: "done",
					result: String(JSON.stringify(resultPayload) ?? "").slice(0, 500),
					timestamp: Date.now()
				});
				traceTool(call.name, callT0, true, void 0, {
					inChars: JSON.stringify(call.args ?? {}).length,
					outChars: String(JSON.stringify(resultPayload) ?? "").length
				});
			} else {
				const ops = toolCallToOperations(call.name, call.args, projectPath, state.role);
				/**
				* **运行级自动事务**（P0-4）：这次运行**第一次真要改东西**之前，由循环自己开事务 ——
				* 不再靠模型记得调 begin_batch（"靠自觉"在本仓库被反复证明会失败）。
				* `state.autoTx` 只在开关打开时才存在（index.ts 注入），关掉时这一行不做任何事。
				*/
				state.autoTx?.open(call.name);
				pendingOperations.push(...ops);
				traceTool(call.name, callT0, true, "queued（进待确认计划）");
				toolResults.push(...buildToolResultMessages(call, {
					status: "queued",
					message: "操作已加入待确认计划"
				}).messages);
				win.webContents.send("ai:toolCall", {
					projectPath,
					id: callId,
					status: "done",
					result: "操作已加入待确认计划",
					timestamp: Date.now()
				});
			}
		} catch (e) {
			/**
			* **取消不是失败** —— 不要把它当成一条工具错误回给模型。
			* 回给模型的话，它会开始"修复"一个根本没发生的问题。
			*/
			if (e instanceof ToolAbortedError) {
				/**
				* 取消不是失败，但卡片**不能永远停在 ⟳** —— 渲染层完全由事件驱动，没有超时兜底。
				* 所以给一个专门的终态 `aborted`，而不是复用 `error`：复用会让用户点一次停止
				* 就看到一片红色的 ✗，像工具坏了（2026-10-06 审查发现）。
				*/
				win.webContents.send("ai:toolCall", {
					projectPath,
					id: callId,
					status: "aborted",
					result: "已取消（用户中断）",
					timestamp: Date.now()
				});
				break;
			}
			win.webContents.send("ai:toolCall", {
				projectPath,
				id: callId,
				status: "error",
				result: e instanceof Error ? e.message : String(e),
				timestamp: Date.now()
			});
			if (state.isBatchMode()) {
				state.onBatchToolFailure();
				throw e;
			}
			traceTool(call.name, callT0, false, e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
			toolResults.push(...(await buildToolFailureMessagesWithSpill(call, e, projectPath)).messages);
		}
	}
	state.messages.push(...toolResults);
}
/**
* 跑一轮 LLM：流式输出直接推给界面，工具调用交给 `dispatchToolCalls`。
*
* @returns 无返回值；结果都写进 `state`（`hadToolCalls` / `messages` / `fullResponse`）
*/
async function runOneRound(state, config, tools = ALL_TOOL_DEFINITIONS) {
	state.hadToolCalls = false;
	const t0 = Date.now();
	if (state.stats) state.stats.rounds += 1;
	const promptChars = state.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
	let traceOk = true;
	let traceNote;
	/**
	* trace 里记的是**真正作答的那个模型**（P3 回退链）。
	* 不这么做的话，回退之后面板/复盘里仍写着主模型的名字 —— 排查时会被自己骗。
	*/
	let usedModel = config.model;
	try {
		usedModel = (await callLlmWithFallback(config, state.messages, tools, {
			onChunk: (chunk) => {
				state.fullResponse += chunk.content;
				state.win.webContents.send("ai:chunk", {
					projectPath: state.projectPath,
					text: chunk.content
				});
			},
			onToolCalls: async (calls) => {
				if (state.signal.aborted) return;
				state.hadToolCalls = true;
				await dispatchToolCalls(state, calls);
			},
			onComplete: (text) => {
				state.fullResponse = text;
			},
			onUsage: (usage) => {
				if (!state.stats) return;
				state.stats.usageReported = true;
				state.stats.promptTokens += usage.promptTokens;
				state.stats.completionTokens += usage.completionTokens;
				state.stats.cachedTokens += usage.cachedTokens ?? 0;
			}
		}, state.signal, { onFallback: (event) => {
			traceNote = `fallback: ${event.from} → ${event.to}`;
			if (state.stats) state.stats.fallbackNote = `${event.from} → ${event.to}`;
		} })).model;
	} catch (e) {
		traceOk = false;
		traceNote = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
		throw e;
	} finally {
		if (state.stats) state.stats.llmMs += Date.now() - t0;
		const turnId = currentTurnId(state.projectPath);
		appendTrace(state.projectPath, {
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			...turnId ? { turnId } : {},
			kind: "llm",
			name: usedModel,
			ms: Date.now() - t0,
			ok: traceOk,
			inChars: promptChars,
			outChars: state.fullResponse.length,
			...state.role ? { agent: state.role } : {},
			...traceNote ? { note: traceNote } : {}
		});
	}
}
/**
* 组装并发送提案。
*
* 正常收尾与"超时提前结束"共用同一段逻辑 —— 两处各写一遍的话，
* 结构校验（`validateProposalOperations`）很容易只加在其中一处。
*
* @param validation 已经算好的结构校验。**正常收尾那条路会先算一次**（P0-5 的「提案自不自洽」
*   要用它），算完传进来就不会算第二遍；不传则这里现算（超时/上下文超限那两条路照旧）。
*/
async function emitProposal(state, summary, validation?: ProposalValidation) {
	const resolvedValidation = validation ?? await validateProposalOperations(state.projectPath, state.pendingOperations);
	const staticVerdict = buildVerdict(state.pendingOperations, resolvedValidation);
	let verdict = staticVerdict;
	if (state.llm && shouldReviewWithModel(state.pendingOperations)) {
		const reviewed = await verifyPlanWithModel({
			projectPath: state.projectPath,
			operations: state.pendingOperations,
			config: state.llm,
			win: state.win,
			signal: state.signal
		});
		if (reviewed) verdict = (isSelfConsistencyEnabled() ? findIncompleteRebuild(state.pendingOperations, resolvedValidation?.introduced ?? []) : null) ? mergeVerdicts(staticVerdict, reviewed) : reviewed;
	}
	const proposal = createProposal(summary, state.pendingOperations, resolvedValidation, verdict);
	state.win.webContents.send("ai:proposal", {
		projectPath: state.projectPath,
		proposal
	});
	logger.info(`[ai] 已发出提案：${summary}（${state.pendingOperations.length} 个操作；验证 ${verdict.ok ? "ok" : "发现问题"}：${verdict.issues.length} 条）`);
}


export { looksLikeAnnouncement, shouldParallelizeTools, guardBlockedCalls, narrowRepeatedTools, isPlanPhaseEnabled, planPhaseTools, planPhaseApplies, shouldStayInPlanPhase, dispatchToolCalls, runOneRound, emitProposal, TOOL_GUARD_MODE, DEDUPABLE_QUERY_TOOLS, ANNOUNCE_KICK_NUDGE, WRAP_UP_NUDGE, PLAN_PHASE_READONLY_TOOLS, PLAN_PHASE_HINT, PLAN_PHASE_OPEN_NUDGE };
