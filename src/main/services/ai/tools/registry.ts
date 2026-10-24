// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { recordFileBefore } from "../../flow/turnJournal";
import { recentRuntimeLogs, runPreview, runtimeLogSeq, runtimeLogsSince } from "../../../runtime/previewRunner";
import { loadProjectPlugins } from "../../plugins/pluginLoader";
import { codePointLength, getToolResultBudget, safeStringify } from "../toolResultBudget";
import { buildControlAdjacency, buildFlowIndex, labelOf, orderChain, parseFlow } from "../flowIndex";
import { isDeprecatedKind } from "../../../../shared/nodes/deprecation";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import * as path from "path";
import { CAPABILITY_DISCOVERY_HANDLERS, capabilityDiscoveryDefinitions } from "./capabilityDiscovery";
import { CAPABILITY_INVOKE_HANDLERS, capabilityInvokeDefinitions } from "./capabilityInvoke";
import { probeCapabilities } from "../../bot/capabilityProbe";
import { SUBFLOW_TEMPLATE_DATA } from "../../../../shared/nodes/subflowTemplateData";
import { BATCH_DEFS, LOG_DEFS, PASSTHROUGH_DEFS, RUNTIME_TEST_DEFS } from "./definitions/runtime";
import { CAPABILITY_DEFS, CODEGEN_DEFS, NODE_EXAMPLE_DEFS, TEMPLATE_DEFS } from "./definitions/codegen";
import { FLOW_TOOL_DEFS, GRAPH_EDIT_DEFS, NODE_CATALOG_DEFS } from "./definitions/flow";
import { FILE_DEFS, READ_FILE_DEFS } from "./definitions/files";
import { init_logger, logger } from "../../infra/logger";
import { injectTestMessage } from "../../runner/eventBus";
import { normalizeFlow, validateFlow } from "../../../../shared/nodes/flowNormalize";
import { getNodeRegistry } from "../../../nodes/registry";
import { registerAllBuiltinNodes } from "../../../nodes/builtin/index";
import { joinSafe } from "../../infra/pathGuard";

/**
* **写文件的指令**：与 clientInstruction 同形状，但**在下发之前先把 before 记进轮次日志** ——
* 真正落盘由渲染层做（主进程只下指令），所以「能撤回」必须在这里兜住（见 turnJournal.ts）。
*/
var fileWriteInstruction = (text) => async (ctx) => {
	/**
	* ⚠️ **两个写文件工具的字段名不一样**：write_code 是 filePath、write_file 是 path。
	* 原来只认 filePath，于是 write_file 这一路**根本记不进 before** ——
	* 轮次照样落盘（hadChanges=true），但里面一个文件都没有：用户点「撤回这一轮」，
	* 新建/改掉的文件**原样留着**，看上去撤回了、其实什么都没撤（比不撤更坏）。
	* 取法与 mcp/server.ts 的 writeTargetOf、渲染层落盘顺序一致：filename || filePath || path。
	*/
	const raw = ctx.args.filename ?? ctx.args.filePath ?? ctx.args.path;
	const filePath = typeof raw === "string" ? raw : "";
	if (filePath) await recordFileBefore(ctx.projectPath, filePath);
	return {
		result: text,
		needsClientExecution: true,
		clientInstruction: {
			name: ctx.name,
			args: ctx.args
		}
	};
};
var clientInstruction = (text) => (ctx) => ({
	result: text,
	needsClientExecution: true,
	clientInstruction: {
		name: ctx.name,
		args: ctx.args
	}
});
var runTest = async ({ args, projectPath }) => {
	const message = String(args.message ?? "").trim();
	if (!message) throw new Error("run_test 需要 message：要注入的测试消息，例如「/签到」。");
	const waitMs = Math.min(Math.max(Number(args.waitMs) || 3e3, 500), 1e4);
	const chatType = args.chatType === "private" ? "c2c" : "group";
	const chatId = typeof args.chatId === "number" ? args.chatId : void 0;
	const seqBefore = runtimeLogSeq(projectPath);
	if (!injectTestMessage(projectPath, message, chatType, chatId)) return { result: "没跑起来：机器人不在运行中，或者翻译器还没有客户端连上。\n先 run_bot（确认状态是「运行中」）再 run_test；刚启动的话等几秒让连接建立。" };
	await new Promise((resolve) => setTimeout(resolve, waitMs));
	const fresh = runtimeLogsSince(projectPath, seqBefore);
	const head = "已注入测试消息「" + message + "」（" + (chatType === "c2c" ? "私聊" : "群聊") + "），等 " + waitMs + "ms 后收集到 " + fresh.length + " 条运行日志：";
	if (fresh.length === 0) return { result: head + "\n（一条都没有）可能原因：消息没匹配上任何触发器的命令词、流程在第一个节点就结束了，或者日志还没落下来（把 waitMs 调大再试一次）。" };
	const body = fresh.map((e) => "[" + e.level + "]" + (e.traceId ? "(" + e.traceId + ")" : "") + " " + e.message).join("\n");
	return { result: head + "\n" + body };
};
var generateCode = async ({ projectPath, ...ctx }) => {
	/**
	* 图的来源：**有 `ctx.flow` 就用它**（助手路径传的是渲染层那张图 / 预览图）；
	* 没有就按「读图三件套」的**同一个真相**从磁盘取（`loadToolGraph`）——
	* MCP 路径没有渲染层，以前这里直接抛「generate_code 需要 flow 上下文」，
	* 于是外部 IDE 一调就必然失败（P0-13 ②）。
	*
	* ⚠️ 不另写一份读盘逻辑：`loadToolGraph` 已经是「此刻该读哪张图」的唯一判据
	* （预览图优先、其次磁盘），read_flow / validate_flow / preview_flow 都靠它。
	*/
	let flow = ctx?.flow;
	if (!flow) {
		const loaded = await loadToolGraph(projectPath, ctx);
		if ("error" in loaded) throw new Error(`generate_code 拿不到流程图：${loaded.error}`);
		flow = loaded.graph;
	}
	const { CodegenService } = await import("../../flow/codegen.js");
	await new CodegenService().generate(projectPath, flow);
	setTimeout(() => {
		ctx.onCodegenComplete?.();
	}, 1e3);
	return { result: { success: true } };
};
var createAiNode = async ({ args, projectPath }) => {
	const { createAiNode } = await import('../../plugins/aiNodeScaffold.js');
	const parsePorts = (raw) => {
		if (typeof raw !== "string" || !raw.trim()) return void 0;
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : void 0;
		} catch {
			return;
		}
	};
	const result = await createAiNode({
		projectPath,
		funcName: String(args.funcName ?? ""),
		label: String(args.label ?? ""),
		summary: String(args.summary ?? ""),
		handler: String(args.handler ?? ""),
		inputs: parsePorts(args.inputs),
		outputs: parsePorts(args.outputs),
		icon: typeof args.icon === "string" ? args.icon : void 0,
		packageName: typeof args.packageName === "string" ? args.packageName : void 0
	});
	/**
	* ⚠️ **落盘之后必须立刻装载进运行时**（2026-10-01 补）。
	*
	* 插件包写到磁盘 ≠ 能用：可执行 handler 要靠 `loadProjectPlugins` 注册进
	* `dynamicHandlers`，否则流程里的 `plugin_*` 节点在运行时找不到 handler
	* （编辑器里却能拖进去 —— 这种"一半好"最难查）。
	*
	* `reload: true`：同名重建时先卸载旧的。否则 `registerPlugin` 会因"已注册"跳过，
	* 模型改了 handler 却看不到任何变化，只会以为是自己写错了。
	*/
	if (!result.ok) return { result };
	const load = await loadProjectPlugins(projectPath, { reload: true });
	if (load.failed.length > 0) logger.warn(`[ai] 节点包已落盘但装载失败（${load.failed.join("、")}）—— 该节点在运行时不可用，通常意味着 manifest.json/index.js 不合法`);
	return { result };
};
var readFlow = async ({ args, projectPath, ...ctx }) => {
	const loaded = await loadToolGraph(projectPath, ctx);
	if ("error" in loaded) return { result: loaded.error };
	const flow = loaded.graph;
	const nodes = flow.nodes ?? [];
	const edges = flow.edges ?? [];
	const byId = new Map(nodes.filter((n) => n?.id).map((n) => [n.id, n]));
	/** 与这批节点相关的连线（模型改图时要知道它们接在哪） */
	const edgesOf = (ids) => {
		const set = new Set(ids);
		return edges.filter((e) => set.has(e.source) || set.has(e.target));
	};
	const rawIds = args.nodeIds;
	if (Array.isArray(rawIds) && rawIds.length > 0) {
		const wanted = rawIds.map((x) => String(x));
		const missing = wanted.filter((id) => !byId.has(id));
		const present = wanted.filter((id) => byId.has(id));
		const budget = getToolResultBudget();
		const picked = [];
		const omitted = [];
		for (const id of present) {
			const node = byId.get(id);
			const trial = [...picked, node];
			const payload = {
				nodes: trial,
				edges: edgesOf(trial.map((n) => n.id))
			};
			if (!(budget === null || picked.length === 0 || codePointLength(safeStringify(payload)) <= budget.thresholdChars)) {
				omitted.push(id);
				continue;
			}
			picked.push(node);
		}
		return { result: {
			nodes: picked,
			edges: edgesOf(picked.map((n) => n.id)),
			...missing.length > 0 ? { missing } : {},
			...omitted.length > 0 ? { omitted } : {}
		} };
	}
	const wantNode = args.nodeId;
	if (typeof wantNode === "string" && wantNode) {
		const node = byId.get(wantNode);
		if (!node) return { result: `节点 ${wantNode} 不存在。可用 read_flow（不带参数）先看结构索引里的 id 列表。` };
		return { result: {
			node,
			edges: edgesOf([wantNode])
		} };
	}
	const wantGroup = args.group;
	if (typeof wantGroup === "string" && wantGroup) {
		const groups = flow.nodeGroups ?? [];
		const g = groups.find((x) => x.title === wantGroup || x.id === wantGroup);
		if (!g) return { result: `分组 ${wantGroup} 不存在。现有分组：${groups.map((x) => x.title ?? x.id ?? "").filter(Boolean).join("、") || "（无）"}` };
		const chainIds = orderChain(flow, (g.nodeIds ?? []).filter((id) => byId.has(id)), buildControlAdjacency(flow));
		return { result: {
			group: g.title ?? g.id ?? wantGroup,
			nodeCount: chainIds.length,
			chain: chainIds.map((id) => labelOf(flow, id)),
			nodes: chainIds.map((id) => {
				const n = byId.get(id);
				const cfg = n.data?.config ?? {};
				return {
					id,
					kind: String(n.data?.nodeKind ?? n.type ?? ""),
					label: String(n.data?.label ?? ""),
					configKeys: Object.keys(cfg)
				};
			})
		} };
	}
	const idx = buildFlowIndex(flow);
	return { result: {
		nodeCount: idx.nodeCount,
		edgeCount: idx.edgeCount,
		groupCount: idx.groupCount,
		commandCount: idx.commandCount,
		index: idx.index
	} };
};
var validateFlow = async ({ projectPath, ...ctx }) => {
	const loaded = await loadToolGraph(projectPath, ctx);
	if ("error" in loaded) return { result: loaded.error };
	const flow = loaded.graph;
	const { graph: normalized } = normalizeFlow(flow);
	const all = validateFlow(normalized);
	const errors = all.filter((i) => i.severity === "error");
	return { result: {
		nodeCount: (flow.nodes ?? []).length,
		edgeCount: (flow.edges ?? []).length,
		errorCount: errors.length,
		warningCount: all.length - errors.length,
		issues: all.slice(0, VALIDATE_ISSUES_LIMIT),
		truncated: Math.max(0, all.length - VALIDATE_ISSUES_LIMIT)
	} };
};
var previewFlow = async ({ args, projectPath, ...ctx }) => {
	const a = args;
	const loaded = await loadToolGraph(projectPath, ctx);
	if ("error" in loaded) return { result: loaded.error };
	const preview = await runPreview({
		projectPath,
		...loaded.fromPending ? { graph: loaded.graph } : {},
		event: {
			triggerType: a.triggerType ?? "command",
			command: a.command,
			prefix: a.prefix,
			text: a.text,
			buttonData: a.buttonData,
			userId: a.userId,
			groupId: a.groupId
		}
	});
	const failedNodes = preview.nodes.filter((n) => n.status === "error").map((n) => ({
		nodeId: n.nodeId,
		error: (n.message ?? "").trim() || preview.errors.join(" | ").trim() || "运行器没有给出失败原因（预览节点事件里没有 message）"
	}));
	const executed = new Set(preview.nodes.filter((n) => n.status === "enter" || n.status === "exit").map((n) => n.nodeId));
	return { result: {
		matched: preview.matched,
		ok: preview.ok,
		executedNodeCount: executed.size,
		failedNodes,
		actions: preview.actions.map((x) => ({
			api: x.api,
			summary: summarizeActionParams(x.params)
		})),
		timedOut: preview.timedOut,
		errors: preview.errors.slice(0, 10),
		...ctx?.pendingNote ? { pendingNote: ctx.pendingNote } : {}
	} };
};
/**
* 节点目录：模型判断"有哪些节点/字段/可选值"的唯一可信来源。
*
* 它刻意做成"传 kind 才便宜"（全量实测 8.3 万字符 ≈ 2 万 token）：
* 不传参数=全量、传 kind=单个节点完整定义。别把这条分岔删掉。
*/
var listNodes = ({ args }) => {
	const registry = getNodeRegistry();
	registerAllBuiltinNodes(registry);
	const allNodes = registry.listAll().filter((n) => !isDeprecatedKind(n.kind));
	/** 一个节点 → 给模型看的形状（与全量路径**共用**，免得两条路给出不同字段） */
	const shape = (n) => ({
		kind: n.kind,
		label: n.label,
		summary: n.summary,
		sideEffects: n.sideEffects,
		exposedAsTool: n.exposedAsTool,
		inputs: n.inputs,
		outputs: n.outputs
	});
	const wanted = typeof args.kind === "string" ? args.kind.trim() : "";
	if (wanted) {
		const hit = allNodes.find((n) => n.kind === wanted);
		if (!hit) {
			const sample = allNodes.slice(0, 8).map((n) => n.kind);
			return { result: `没有节点类型「${wanted}」。可用类型共 ${allNodes.length} 个，例如：${sample.join("、")}…\n（不传 kind 可以看全部，但载荷很大；建议先用 summary 确认再精确查。）` };
		}
		return { result: [shape(hit)] };
	}
	return { result: allNodes.map(shape) };
};
var readProjectFile = async ({ projectPath, args }) => {
	let filePath;
	try {
		filePath = joinSafe(projectPath, String(args.path));
	} catch (e) {
		return { result: `路径越界: ${e instanceof Error ? e.message : String(e)}` };
	}
	if (!(0, fs.existsSync)(filePath)) return { result: `文件不存在: ${args.path}` };
	return { result: await (0, fs_promises.readFile)(filePath, "utf-8") };
};
/**
* 把一次假 bot 调用的参数压成**可读正文摘要**。
*
* 为什么不直接 `JSON.stringify`：模型要核对的是"用户会看到什么"，
* 而 params 里混着 target_type / msg_id 这类噪音。这里把所有字符串值收上来拼一行，
* 正文（含 Markdown 面板、按钮文字）自然就在里面。
*/
function summarizeActionParams(params) {
	const texts = [];
	const walk = (v) => {
		if (typeof v === "string") {
			if (v.trim()) texts.push(v);
		} else if (Array.isArray(v)) for (const x of v) walk(x);
		else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
	};
	walk(params);
	const joined = texts.join(" ");
	return joined.length > 2e3 ? `${joined.slice(0, 2e3)}…（已截断）` : joined;
}
/**
* 取"此刻应当被读取的那张图"：**预览图优先，其次磁盘**。
*
* 三个自检/读取工具（read_flow / validate_flow / preview_flow）共用这一处，
* 免得将来只有其中一两个认得预览图 —— 那正是"模型看到的世界自相矛盾"的来源。
*/
async function loadToolGraph(projectPath, ctx) {
	if (ctx?.pendingGraph && typeof ctx.pendingGraph === "object") return {
		graph: ctx.pendingGraph,
		fromPending: true
	};
	const flowPath = (0, path.join)(projectPath, ".qqbat", "flow.json");
	if (!(0, fs.existsSync)(flowPath)) return { error: "流程为空（项目里还没有 .qqbat/flow.json）" };
	const parsed = parseFlow(await (0, fs_promises.readFile)(flowPath, "utf-8"));
	if (!parsed) return { error: "流程文件不是合法 JSON，无法读取" };
	return {
		graph: parsed,
		fromPending: false
	};
}
/** `validate_flow` 一次最多回多少条问题（真实项目一次能上百条，全灌给模型等于又开一个洞） */
var VALIDATE_ISSUES_LIMIT = 30;
/** run_test（注入一条真实消息、把这段日志交回来）的声明 */
/** generate_code / create_ai_node 的声明 */
/** 运行控制（透传型）：命令下达 ≠ 生效，描述里已经写明要用 read_logs 确认 */
/** 文件写入（透传型）：真正落盘由渲染层经文件 IPC 完成，主进程只下达指令 */
/** 运行日志（**真实实现**已搬进来：读主进程环形缓冲，不是占位符） */
/** 自定义节点**示例库**：写代码节点前先查这里 —— 里面是从真实项目里跑通过的写法 */
/** 预置片段库（项目作者手写的"常见玩法"）：搭流程前先查这里，别从零推 */
/** 能力自检（**只适用于官方协议端**）：把"这台机器人现在实际能用什么"给模型 */
/**
 * 已注册处理器收到的上下文。
 *
 * 形状取证：registry.ts 内各 handler 解构 { args, projectPath, name, ...ctx }，
 * 其中 ...ctx 透传 pendingGraph/pendingNote 给自检工具（loadToolGraph:325）。
 * 另外 executeTool 的调用方还带 flow / onCodegenComplete（tools.ts:357）。
 */
export interface RegisteredHandlerContext {
	/** 模型给的参数（未校验，handler 自己按类型读） */
	args: Record<string, unknown>;
	/** 工具名（fileWriteInstruction 用它回传 clientInstruction） */
	name: string;
	projectPath: string;
	/** 待确认操作的预览图：自检类工具用它代替磁盘 flow.json */
	pendingGraph?: unknown;
	/** 预览图的一句说明，拼进工具结果 */
	pendingNote?: string;
	/** 当前画布流程图（generate_code 等需要） */
	flow?: unknown;
	/** codegen 完成后的热更新回调 */
	onCodegenComplete?: () => void;
}

/** 处理器结果：result 回给模型；needsClientExecution 表示要渲染层落盘 */
export interface RegisteredHandlerResult {
	result: unknown;
	needsClientExecution?: boolean;
	clientInstruction?: Record<string, unknown>;
}

export type RegisteredHandler = (
	ctx: RegisteredHandlerContext,
) => RegisteredHandlerResult | Promise<RegisteredHandlerResult>;

var REGISTERED_HANDLERS = {
	...CAPABILITY_DISCOVERY_HANDLERS,
	...CAPABILITY_INVOKE_HANDLERS,
	/**
	* 能力自检：**绝不抛错**（fail-open）—— 自检只适用于官方协议端、需要凭据、还要联网，
	* 任何一条不满足都只该得到一句**可读的解释**，而不是让整轮对话中断。
	* （诊断类工具的失败是"信息"，不是"故障"。）
	*/
	check_capabilities: async ({ projectPath }) => {
		try {
			const report = await probeCapabilities(projectPath);
			const usable = report.items.filter((i) => i.verdict === "ok");
			const blocked = report.items.filter((i) => i.verdict !== "ok");
			return { result: {
				说明: "以下为**实测**结果（全程只读 GET）。标记为不可用的能力，在本机器人上会失败。",
				自检时间: report.probedAt,
				机器人: report.bot ? `${report.bot.username || "(无昵称)"}（${report.bot.id}）` : "未知",
				实测目标: report.activeTarget ?? "(无：项目里还没有群/单聊记录)",
				可用: usable.map((i) => i.zhLabel),
				不可用: blocked.map((i) => ({
					能力: i.zhLabel,
					结论: i.verdict,
					说明: i.note ?? ""
				})),
				统计: report.counts
			} };
		} catch (e) {
			return { result: `能力自检没能执行：${e instanceof Error ? e.message : String(e)}\n两种常见原因：① 这个项目用的是 **NapCat 等 第三方桥接实现**（本自检只适用于官方协议端）；② 还没在项目里配置 AppID / AppSecret。
这种情况请改看系统提示里「可用协议端 API」那一节的标注（带 \\* 的名字在官方适配器下不可用），**不要据此认定某个能力可用或不可用**。` };
		}
	},
	/**
	* 默认给紧凑列表（id/分类/名称/说明/节点序列）—— 21 条全文（含 config 与 usageHint）好几 KB，
	* 和 list_nodes 一样：想看细节就传 id 精确查。
	*/
	list_node_examples: async ({ args }) => {
		const { NODE_EXAMPLES, matchExamples, renderExample, renderExampleList } = await import('../nodeExamples.js');
		const id = typeof args.id === "string" ? args.id.trim() : "";
		if (id) {
			const one = renderExample(id);
			if (!one) return { result: {
				error: "没有这个示例：" + id,
				available: NODE_EXAMPLES.map((e) => e.id)
			} };
			return { result: {
				id,
				content: one
			} };
		}
		const need = typeof args.need === "string" ? args.need.trim() : "";
		if (need) {
			const hits = matchExamples(need);
			if (hits.length === 0) return { result: {
				matched: [],
				hint: "没有关键词匹配的示例，下面是全部",
				list: renderExampleList()
			} };
			return { result: {
				matched: hits.map((h) => h.id),
				contents: hits.map((h) => renderExample(h.id)).filter(Boolean)
			} };
		}
		return { result: { list: renderExampleList() } };
	},
	list_templates: ({ args }) => {
		const compact = (t) => ({
			id: t.id,
			category: t.category,
			name: t.text.zh.name,
			description: t.text.zh.description,
			nodes: t.nodes.map((n) => n.kind)
		});
		const wanted = typeof args.id === "string" ? args.id.trim() : "";
		if (wanted) {
			const hit = SUBFLOW_TEMPLATE_DATA.find((t) => t.id === wanted);
			if (!hit) {
				const sample = SUBFLOW_TEMPLATE_DATA.slice(0, 6).map((t) => t.id);
				return { result: `没有片段「${wanted}」。可用 id 共 ${SUBFLOW_TEMPLATE_DATA.length} 个，例如：${sample.join("、")}…（不传 id 可以看全部）` };
			}
			return { result: {
				id: hit.id,
				category: hit.category,
				name: hit.text.zh.name,
				description: hit.text.zh.description,
				usageHint: hit.text.zh.usageHint,
				nodes: hit.nodes,
				edges: hit.edges
			} };
		}
		return { result: SUBFLOW_TEMPLATE_DATA.map(compact) };
	},
	/**
	* 排查"机器人为什么没反应"的唯一真实入口：读主进程的环形缓冲（runtimeLogStore）。
	* （历史上这里只回一句占位符、让渲染层弹面板 —— 模型根本看不到日志。）
	*/
	read_logs: ({ projectPath, args }) => {
		const recent = recentRuntimeLogs(projectPath, Number(args.lines) || 50);
		if (recent.length === 0) return { result: "这个项目还没有运行日志。常见原因：机器人没启动过（先 run_bot），或者启动了但还没收到任何消息。" };
		return { result: recent.map((entry) => "[" + entry.level + "]" + (entry.traceId ? "(" + entry.traceId + ")" : "") + " " + entry.message).join("\n") };
	},
	/** read_code / read_file 共用这一个实现（描述里那句"同一实现"就是它） */
	run_test: runTest,
	generate_code: generateCode,
	create_ai_node: createAiNode,
	read_flow: readFlow,
	validate_flow: validateFlow,
	preview_flow: previewFlow,
	list_nodes: listNodes,
	read_code: readProjectFile,
	read_file: readProjectFile,
	add_node: clientInstruction("操作已提交"),
	update_node: clientInstruction("操作已提交"),
	delete_node: clientInstruction("操作已提交"),
	connect_nodes: clientInstruction("操作已提交"),
	write_code: fileWriteInstruction("写入就绪"),
	write_file: fileWriteInstruction("写入就绪"),
	run_bot: clientInstruction("操作已提交"),
	stop_bot: clientInstruction("操作已提交"),
	begin_batch: clientInstruction("batch 开始"),
	commit_batch: clientInstruction("batch 已提交"),
	rollback_batch: clientInstruction("batch 已回滚")
};
/** list_nodes（节点目录）的声明 */
/** defs.ts 用它把这些工具的声明合并进 ALL_TOOL_DEFINITIONS */
function registeredBatchDefinitions() {
	return BATCH_DEFS;
}
/** 透传型（运行控制）工具的声明 */
/** 图编辑四件套的声明 */
/** read_code / read_file 的声明 */
/** run_test 的声明 */
function registeredRunTestDefinitions() {
	return RUNTIME_TEST_DEFS;
}
/** 代码生成两个（generate_code / create_ai_node）的声明 */
function registeredCodegenDefinitions() {
	return CODEGEN_DEFS;
}
/** 读图三件套（read_flow / validate_flow / preview_flow）的声明 */
function registeredFlowToolDefinitions() {
	return FLOW_TOOL_DEFS;
}
/** 节点目录工具的声明 */
function registeredNodeCatalogDefinitions() {
	return NODE_CATALOG_DEFS;
}
/** read_code / read_file 的声明 */
function registeredReadFileDefinitions() {
	return READ_FILE_DEFS;
}
/** 图编辑四件套的声明 */
function registeredGraphEditDefinitions() {
	return GRAPH_EDIT_DEFS;
}
/** 透传型（运行控制）工具的声明 */
function registeredPassthroughDefinitions() {
	return PASSTHROUGH_DEFS;
}
/** 文件写入（透传型）工具的声明 */
function registeredFileDefinitions() {
	return FILE_DEFS;
}
/** 运行日志工具的声明 */
function registeredLogDefinitions() {
	return LOG_DEFS;
}
/** 预置片段库工具的声明 */
function registeredTemplateDefinitions() {
	return TEMPLATE_DEFS;
}
/** 自定义节点示例库工具的声明 */
function registeredNodeExampleDefinitions() {
	return NODE_EXAMPLE_DEFS;
}
/** 能力自检工具的声明 */
function registeredCapabilityDefinitions() {
	return CAPABILITY_DEFS;
}
/** 能力发现工具（search_capabilities / describe_capability）的声明 */
function registeredCapabilityDiscoveryDefinitions() {
	return capabilityDiscoveryDefinitions();
}
/** 能力执行工具（invoke_capability）的声明 */
function registeredCapabilityInvokeDefinitions() {
	return capabilityInvokeDefinitions();
}
/** execute.ts 在 switch **之前**查它（已迁移工具的实现入口） */
function getRegisteredHandler(name) {
	return REGISTERED_HANDLERS[name];
}
Object.keys(REGISTERED_HANDLERS);

/**
 * 工具执行上下文（**类型**在打包产物里会被擦掉，按消费方重建）。
 *
 * 消费方：`src/main/services/ai/tools/execute.ts`（读 `ctx?.signal?.aborted`）、
 * `src/main/services/agent-core/legacyTools.ts:106 ctxOf`（只给 signal）、
 * `src/main/services/ai/pendingContext.ts:30`（给 pendingGraph/pendingNote）。
 */
export interface ToolExecutionContext {
	/** 取消信号：已取消的调用在执行前直接抛 ToolAbortedError（execute.ts:91） */
	signal?: AbortSignal;
	/** 待确认操作的预览图：自检类工具用它代替磁盘上的 flow.json（只读视图，不代表已落盘） */
	pendingGraph?: unknown;
	/** 预览图对应的一句说明，拼进工具结果，提醒模型"这是用户确认后才会变成的样子" */
	pendingNote?: string;
}

export { fileWriteInstruction, clientInstruction, runTest, generateCode, createAiNode, readFlow, validateFlow, previewFlow, listNodes, readProjectFile, summarizeActionParams, loadToolGraph, VALIDATE_ISSUES_LIMIT, REGISTERED_HANDLERS, registeredBatchDefinitions, registeredRunTestDefinitions, registeredCodegenDefinitions, registeredFlowToolDefinitions, registeredNodeCatalogDefinitions, registeredReadFileDefinitions, registeredGraphEditDefinitions, registeredPassthroughDefinitions, registeredFileDefinitions, registeredLogDefinitions, registeredTemplateDefinitions, registeredNodeExampleDefinitions, registeredCapabilityDefinitions, registeredCapabilityDiscoveryDefinitions, registeredCapabilityInvokeDefinitions, getRegisteredHandler };
