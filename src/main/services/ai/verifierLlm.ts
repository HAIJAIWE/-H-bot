// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { ALL_TOOL_DEFINITIONS } from "./tools/defs";
import * as node_path from "node:path";
import * as node_fs from "node:fs";
import { parseFlow } from "./flowIndex";
import * as node_fs_promises from "node:fs/promises";
import { buildProjectBrief, renderBrief } from "./brief";
import { runOneRound } from "./chatRun";
import { init_logger, logger } from "../infra/logger";

/** 复核能用的**只读**工具（这里出现任何 mutation 都是 bug） */
var VERIFIER_TOOL_NAMES = [
	"validate_flow",
	"read_flow",
	"list_nodes",
	"list_templates",
	"read_logs",
	"run_test"
];
/**
* 什么时候值得为"复核"多花一次调用。
*
* 默认关（小改动静态验证足够）；**破坏性**或**大**计划才开：
*   · 含 delete_node / write_code（改错了代价高）
*   · 操作数 ≥ 5（一条链的大改）
*/
function shouldReviewWithModel(operations) {
	if (operations.length >= 5) return true;
	return operations.some((op) => op.kind === "delete_node" || op.kind === "write_code");
}
function verifierTools() {
	const allowed = new Set(VERIFIER_TOOL_NAMES);
	return ALL_TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
}
/** 复核用的系统提示（严格 JSON 输出；**不许解释、不许围栏**） */
function buildVerifierSystemPrompt(briefText) {
	return [
		"你是一个**验证者**：只读，不修改任何东西。用户即将确认一份\"改动计划\"，请独立判断它是否合理。",
		"",
		"**只输出一个 JSON 对象**（不要解释、不要 markdown 围栏、不要多余文字）：",
		"{\"ok\": true|false, \"issues\": [{\"severity\":\"error\"|\"warn\",\"what\":\"一句话问题\",\"howToFix\":\"一句话改法\"}], \"evidence\":\"你据以判断的证据（看了什么、结果如何）\"}",
		"",
		"判据：",
		"· 发现**明确**的问题才 ok=false（会让流程跑不通/回两遍/数据错）—— 不确定就 ok=true；",
		"· 不许为了显得认真而编问题；warn 可以列（不影响 ok）；",
		"· 你可以用只读工具核实（validate_flow / read_flow / read_logs / run_test），但**不要要求用户做什么**。",
		briefText ? "\n项目事实：\n" + briefText : ""
	].join("\n");
}
/** 从模型输出里抠出 JSON（容忍围栏与前后废话；抠不出返回 null） */
function parseVerdictJson(text) {
	const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const raw = JSON.parse(cleaned.slice(start, end + 1));
		const issues = Array.isArray(raw.issues) ? raw.issues.map((i) => {
			const issue = i ?? {};
			return {
				severity: issue.severity === "error" ? "error" : "warn",
				what: String(issue.what ?? "").trim(),
				howToFix: String(issue.howToFix ?? "").trim()
			};
		}).filter((i) => i.what.length > 0) : [];
		return {
			ok: issues.some((i) => i.severity === "error") ? false : raw.ok === false ? false : true,
			issues,
			evidence: String(raw.evidence ?? "").trim() || "（模型未给证据）",
			by: "llm"
		};
	} catch {
		return null;
	}
}
/**
* 跑一次独立复核。
*
* @returns 验证结论；**跑不起来一律 null**（调用方保留静态结论）
*/
async function verifyPlanWithModel(input) {
	const { projectPath, operations, config, win, signal } = input;
	const maxRounds = input.maxRounds ?? 2;
	if (operations.length === 0) return null;
	let briefText = "";
	try {
		const flowPath = (0, node_path.join)(projectPath, ".qqbat", "flow.json");
		if ((0, node_fs.existsSync)(flowPath)) {
			const parsed = parseFlow(await (0, node_fs_promises.readFile)(flowPath, "utf-8"));
			if (parsed) briefText = renderBrief(buildProjectBrief(parsed));
		}
	} catch (e) {
		logger.warn("[ai] 复核读取项目简报失败（继续，不影响结论）：", e);
	}
	const state = {
		projectPath,
		win,
		signal,
		messages: [{
			role: "system",
			content: buildVerifierSystemPrompt(briefText)
		}, {
			role: "user",
			content: "待确认的计划（applyProposal 会按顺序执行这些操作）：\n" + JSON.stringify(operations, null, 2)
		}],
		pendingOperations: [],
		fullResponse: "",
		hadToolCalls: false,
		isBatchMode: () => false,
		onBatchToolFailure: () => {},
		allowedTools: new Set(VERIFIER_TOOL_NAMES),
		role: "builder"
	};
	try {
		const tools = verifierTools();
		for (let round = 0; round < maxRounds; round += 1) {
			await runOneRound(state, config, tools);
			if (!state.hadToolCalls) break;
		}
		const verdict = parseVerdictJson(state.fullResponse);
		if (!verdict) {
			logger.warn("[ai] 复核没给出可解析的 JSON —— 保留静态结论（fail-open）");
			return null;
		}
		logger.info(`[ai] 复核结论：${verdict.ok ? "ok" : "发现问题"}（${verdict.issues.length} 条，by=llm）`);
		return verdict;
	} catch (e) {
		logger.warn("[ai] 复核失败（保留静态结论）：", e);
		return null;
	}
}
function traceFilePath(projectPath) {
	return (0, node_path.join)(projectPath, ".qqbat", "ai-trace.jsonl");
}
/**
* 记一条 trace（**失败静默**：写不进去只当没发生）。
*
* 裁剪是"先写后查"：避免每次都 stat（对话里 trace 调用很频繁）。
*/
async function appendTrace(projectPath, entry) {
	const file = traceFilePath(projectPath);
	try {
		await (0, node_fs_promises.appendFile)(file, JSON.stringify(entry) + "\n", "utf-8");
		if ((await (0, node_fs_promises.stat)(file)).size > 1e6) {
			const lines = (await (0, node_fs_promises.readFile)(file, "utf-8")).split("\n").filter(Boolean);
			/**
			* 按**字节**从尾部留，而不是"留最后 N 行" —— 单行也可能很大（病态行/超长结果），
			* 只按行数裁会让文件仍然超限（自测踩过：一行 1MB + 一行正常，裁完还是 1MB）。
			*/
			const kept = [];
			let bytes = 0;
			for (let i = lines.length - 1; i >= 0 && kept.length < 500; i -= 1) {
				const line = lines[i];
				const size = Buffer.byteLength(line, "utf-8") + 1;
				if (size > 1e6) continue;
				if (bytes + size > 1e6 && kept.length > 0) break;
				kept.unshift(line);
				bytes += size;
			}
			await (0, node_fs_promises.writeFile)(file, kept.join("\n") + "\n", "utf-8");
		}
	} catch {}
}
/** 读回最近 N 条（面板/测试用；坏行直接跳过） */
async function readTrace(projectPath, limit = 200) {
	try {
		const raw = await (0, node_fs_promises.readFile)(traceFilePath(projectPath), "utf-8");
		const entries = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				entries.push(JSON.parse(line));
			} catch {}
		}
		return entries.slice(-limit);
	} catch {
		return [];
	}
}

export { VERIFIER_TOOL_NAMES, shouldReviewWithModel, verifierTools, buildVerifierSystemPrompt, parseVerdictJson, verifyPlanWithModel, traceFilePath, appendTrace, readTrace };
