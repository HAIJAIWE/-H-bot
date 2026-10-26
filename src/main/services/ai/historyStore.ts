// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/historyStore.ts），只保证语法/行为，类型待补。
import * as require_logger from '../infra/logger';

import { logger } from '../infra/logger';
import { CONVERSATION_TOKEN_BUDGET, estimateTokens } from './tokenBudget';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fs_promises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
/**
* 记忆的 token 预算 —— **不再是写死的 6,000**（2026-10-15 审计）。
*
* ## 为什么必须改掉那个常数
*
* 审计量到一条真机请求的构成：系统提示（说明书）≈ **9,645 tokens**，
* 而这里的历史预算写死 **6,000** —— 也就是「**说明书比对话还重**」。
* 可模型真正需要记住的是**这次对话做过什么**，它恰恰是被压住的那一半。
* 真机证据（2026-10-15 日志）：一条用户消息 7 轮 LLM 调用、累计 101.6k tokens、平均 11.5s。
*
* 为什么单位是 token 而不是条数：条数是个与模型无关的魔数 —— 12 条短消息可能只有 200 token，
* 12 条长消息可以上万。上下文有硬上限，按 token 才是有意义的判据（这一点没变）。
*
* ## 怎么算（保守优先）
*
* ```
* 历史预算 = clamp( (总预算 − 系统提示 − 工具结果预留) × 25%, 下界, 上界 )
* ```
*
* - **总预算** = `CONVERSATION_TOKEN_BUDGET`（80k）—— 发送前的总量闸门用的就是它，
*   这里必须与它同源，否则两处口径会各说各话。
* - **系统提示** = `context.buildSystemMessage` 每次组装完**报回来**的实测估算
*   （见 `recordSystemPromptTokens`）—— 不是猜的常数。
*   为什么用**上一次**的实测值而不是本轮的：本轮系统提示末尾要拼「更早的 N 条已省略」那句交代，
*   而那句交代取决于本次裁掉了多少 —— 直接互指会成环。上一轮的实测值既打破这个环，
*   又与本轮几乎相同（同一项目、同一套段落、同一笔段落预算）。
* - **工具结果预留** = `TOOL_RESULT_RESERVE_TOKENS`。历史是**一次性**拼进请求的固定前缀，
*   而工具结果在最多 18 轮里持续累加。不留余地的话，多出来的历史是**从工具的工作空间里抢**走
*   的，表现就是更早撞上 80k 闸门、这一轮戛然而止。
* - **只取余量的 25%**：大头留给工具输出与模型输出。「够用」比「尽量多」重要。
*
* ## 安全网一条都没松
*
* 裁剪仍走 `selectWithinBudget`（按预算保留**尾部**、至少留最近一条），
* 被丢掉的部分仍由 `describeDropped` 生成交代（不静默）。
* 这里改的只是「预算从哪来」，不是「怎么裁」。
*/
var TOOL_RESULT_RESERVE_TOKENS = 24e3;
/** 余量里分给历史的比例（保守：只取四分之一） */
var HISTORY_SHARE_OF_REMAINDER = .25;
/** 历史预算的**下界**：只要还有余量就不低于它 —— 防"系统提示一大，历史被挤成 0" */
var MIN_HISTORY_TOKEN_BUDGET = 4e3;
/** 历史预算的**上界**：余量再大也不超过它 —— 防"历史反过来把工具空间吃光" */
var MAX_HISTORY_TOKEN_BUDGET = 24e3;
/**
* 最近一次组装出来的系统提示的估算 token 数。
*
* 为什么是模块级状态：调用顺序是「**先**按预算裁历史 → **再**拼系统提示」
* （`index.ts` 的 loadAuthorMemory 在 buildSystemMessage 之前），所以本轮能拿到的
* 只有上一轮报上来的实测值。这与 `toolResultBudget.ts` 的 `activeBudget` 是同一类
* 「当前生效的策略」状态，不是隐藏的缓存。
*/
var recordedSystemPromptTokens = null;
/** 系统提示的组装者（context.ts）每次组装完调用，把**真实大小**报回来 */
/** 上一次打过的历史预算（只在变化时打日志，免得每轮刷屏） */
var lastLoggedHistoryBudget = -1;
function recordSystemPromptTokens(tokens) {
	if (Number.isFinite(tokens) && tokens >= 0) recordedSystemPromptTokens = tokens;
	/**
	* ★ **把推导结果打进日志**（2026-10-15 晚，改完之后补的）。
	*
	* 背景：历史预算改成按系统提示实测推导之后，日志里**没有任何一行**能说明它变成了多少 ——
	* 用户没法确认它生效了，复核时也只能靠测试（测试在，但真机看不见）。
	* 只在**预算发生变化**时打：同一项目连续几轮几乎一样，不会刷屏。
	*/
	const budget = deriveHistoryTokenBudget();
	if (budget !== lastLoggedHistoryBudget) {
		lastLoggedHistoryBudget = budget;
		logger.info(`[historyBudget] 系统提示 ${tokens} tokens → 历史预算 ${budget}（不再写死 6,000；系统提示 + 历史 + 24k 工具预留 不得超过 80,000）`);
	}
}
/**
* 推导本轮的历史预算。三个参数都可显式传入（测试与未来策略），缺省 = 跟着实测走。
*
* 两条不变量（有测试钉着，改动前先读）：
*   ① `返回值 ≤ max(0, 总预算 − 系统提示 − 工具预留)` —— 所以余量非负时，
*      「系统提示 + 历史 + 工具预留」**不会超过会话上限**；
*   ② 只要余量 > 0，返回值就 > 0 —— 系统提示再大也不会把历史挤成 0
*      （这正是审计要修的那个倒挂）。
*/
function deriveHistoryTokenBudget(systemPromptTokens = recordedSystemPromptTokens ?? 1e4, totalBudgetTokens = CONVERSATION_TOKEN_BUDGET, toolResultReserveTokens = TOOL_RESULT_RESERVE_TOKENS) {
	const system = Math.max(0, systemPromptTokens);
	const reserve = Math.max(0, toolResultReserveTokens);
	/** 系统提示与工具预留之外还剩多少；负 = 已经超了，历史只能是 0（交给发送前的总量闸门收尾） */
	const room = totalBudgetTokens - system - reserve;
	if (room <= 0) return 0;
	const share = Math.floor(room * HISTORY_SHARE_OF_REMAINDER);
	return Math.max(Math.min(MIN_HISTORY_TOKEN_BUDGET, room), Math.min(share, Math.min(MAX_HISTORY_TOKEN_BUDGET, room)));
}
/** 头记录的 kind（防止把别的 JSONL 的头误认成我们的） */
var HISTORY_HEADER_KIND = "ai-history";
/** 生成记忆文件的头记录行 */
function historyHeaderLine(version = 1) {
	return JSON.stringify({
		__v: version,
		kind: HISTORY_HEADER_KIND
	});
}
/**
* 从原始文本里读出版本号。
*
* @returns 版本号；**没有头（老文件）返回 0**；头存在但没法解析也返回 0（按最老的假设处理）
*/
function readHistoryFormatVersion(raw) {
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed.kind !== HISTORY_HEADER_KIND) return 0;
			return typeof parsed.__v === "number" && Number.isInteger(parsed.__v) ? parsed.__v : 0;
		} catch {
			return 0;
		}
	}
	return 0;
}
/** 给界面回看：读回最近若干条（顺序保持时间序） */
async function readHistoryForUi(projectPath, file) {
	return (await loadHistory(projectPath, file, { includeUi: true })).slice(-200);
}
/** 单条记录的长度上限（历史只用于衔接，不需要原文全量） */
var MAX_ENTRY_CHARS = 4e3;
/** 界面回看用的过程痕迹：条数与每条结果都要有上界（记忆文件不是日志仓库） */
var MAX_UI_TRACE_ENTRIES = 12;
var MAX_UI_TRACE_RESULT_CHARS = 6e2;
var MAX_UI_REASONING_CHARS = 2e3;
/** 文件体积上限：超过就重写成"最近若干条"（追加式日志需要一个上界） */
var MAX_FILE_BYTES = 1e6;
/** 收敛的目标体积（留出余量，避免下一次追加就立刻再触发一次收敛） */
var COMPACT_TARGET_BYTES = 5e5;
/** 无论如何至少保留这么多条（收敛不能把记忆清成空的） */
var MIN_KEEP_ENTRIES = 20;
function historyFilePath(projectPath) {
	return (0, path.join)(projectPath, ".qqbat", "ai-history.jsonl");
}
/**
* 读回某个项目的全部记忆。
*
* 逐行容错：任何一行解析失败**只跳过那一行**。整个文件作废会让用户
* 因为一次异常退出丢掉全部记忆，而追加式日志的全部意义就是"坏也只坏最后一条"。
*/
/**
* @param opts.includeUi 连**界面回看用的过程痕迹**（思考 / 工具行 / 耗时）一起交回来。
*   默认 false：模型历史只要 role/content（痕迹进上下文等于把日志当记忆）。
*/
async function loadHistory(projectPath, file = historyFilePath(projectPath), opts = {}) {
	if (!(0, fs.existsSync)(file)) return [];
	let raw;
	try {
		raw = await (0, fs_promises.readFile)(file, "utf-8");
	} catch {
		return [];
	}
	const out = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			const isAttempt = parsed.role === "attempt";
			if ((parsed.role === "user" || parsed.role === "assistant" || isAttempt) && typeof parsed.content === "string") {
				const entry = {
					ts: typeof parsed.ts === "string" ? parsed.ts : (/* @__PURE__ */ new Date(0)).toISOString(),
					role: parsed.role,
					content: parsed.content
				};
				// 稳定 id（第 58 批）：消息反馈要挂在这条记录上。老文件没有 id，
				// 读侧**不编造**（编出来重启一次就变），由渲染层退回位置派生 id 且反馈按钮禁用。
				if (typeof parsed.id === "string" && parsed.id) entry.id = parsed.id;
				// attempt 的诊断字段原样带回：读侧以前只认 user/assistant，把写侧（aiAgentCore）
				// 落盘的失败原因整行丢掉了 —— 于是"重启后查不到上次为什么没做完"。
				if (isAttempt) {
					if (typeof parsed.reason === "string") entry.reason = parsed.reason;
					if (typeof parsed.ok === "boolean") entry.ok = parsed.ok;
				}
				if (opts.includeUi) {
					if (typeof parsed.reasoning === "string" && parsed.reasoning)
						entry.reasoning = parsed.reasoning;
					if (Array.isArray(parsed.trace))
						entry.trace = parsed.trace
							.filter((t) => t && typeof t.name === "string")
							.map((t) => ({
								name: t.name,
								args: t.args && typeof t.args === "object" ? t.args : {},
								status: t.status === "error" ? "error" : "done",
								...(typeof t.result === "string" ? { result: t.result } : {}),
							}));
					if (typeof parsed.turnMs === "number" && parsed.turnMs > 0)
						entry.turnMs = parsed.turnMs;
				}
				out.push(entry);
			}
		} catch {}
	}
	return out;
}
/**
* 补一个结尾换行（**撕裂尾帧**）。
*
* 追加式日志有一个必须处理的边界：上一次写入如果被崩溃/断电打断，最后一行可能是**半截**、
* 而且**没有结尾换行**。这时直接 `appendFile` 会把新记录**粘在那半截后面**，
* 于是**两条一起解析失败** —— 一次崩溃赔掉两条记忆，而且看起来像是"新写的那条没保存"。
*
* 测试实测踩到过（`坏行只坏那一行` 那条用例）。DSH 的 JSONL 存储同样要处理这个
* （"torn final frame detected + truncated before the first new append"）。
*/
async function ensureTrailingNewline(file) {
	try {
		const { size } = await (0, fs_promises.stat)(file);
		if (size === 0) return;
		const fh = await (0, fs_promises.open)(file, "r");
		try {
			const buf = Buffer.alloc(1);
			await fh.read(buf, 0, 1, size - 1);
			if (buf[0] !== 10) await (0, fs_promises.appendFile)(file, "\n", "utf-8");
		} finally {
			await fh.close();
		}
	} catch {}
}
/** 追加若干条记录（追加式：不重写已有内容）。
*
* 返回**每条落盘记录最终用的 id**（第 58 批）：调用方（aiAgentCore 收尾）要把 assistant 记录的
* id 随 `ai:response` 发给渲染层，界面才知道"这条回答的反馈该挂给谁"。
* 没带 id 的条目在这里补一个 uuid —— id 由**写侧**生成而不是读侧推导，是因为位置派生 id
* 在压缩/重读后会变，反馈就指向了另一条消息。
*/
async function appendHistoryEntries(projectPath, entries, file = historyFilePath(projectPath)) {
	if (entries.length === 0) return [];
	await (0, fs_promises.mkdir)((0, path.dirname)(file), { recursive: true });
	const ids = [];
	const lines = entries.filter((e) => e.content.trim().length > 0).map((e) => {
		const id = typeof e.id === "string" && e.id ? e.id : randomUUID();
		ids.push(id);
		const line = {
			id,
			ts: e.ts,
			role: e.role,
			content: e.content.length > MAX_ENTRY_CHARS ? `${e.content.slice(0, MAX_ENTRY_CHARS)}…` : e.content
		};
		// 失败尝试（role=attempt）的 reason/ok 必须落盘：它们就是"上次为什么没做完"的答案。
		if (typeof e.reason === "string") line.reason = e.reason;
		if (typeof e.ok === "boolean") line.ok = e.ok;
		// 界面回看用的**过程痕迹**（思考 / 工具行 / 耗时）：只落给界面，模型历史读侧不收 ——
		// 否则模型会在下一轮看到上一轮的工具回执，等于把"记忆"变成"日志"。
		if (typeof e.reasoning === "string" && e.reasoning.trim())
			line.reasoning = e.reasoning.slice(0, MAX_UI_REASONING_CHARS);
		if (Array.isArray(e.trace) && e.trace.length > 0)
			line.trace = e.trace.slice(0, MAX_UI_TRACE_ENTRIES).map((t) => ({
				name: String(t.name),
				args: t.args && typeof t.args === "object" ? t.args : {},
				status: t.status === "error" ? "error" : "done",
				...(typeof t.result === "string" ? { result: t.result.slice(0, MAX_UI_TRACE_RESULT_CHARS) } : {})
			}));
		if (typeof e.turnMs === "number" && e.turnMs > 0) line.turnMs = e.turnMs;
		return JSON.stringify(line);
	});
	if (lines.length === 0) return [];
	let needsHeader = false;
	try {
		needsHeader = (await (0, fs_promises.stat)(file)).size === 0;
	} catch {
		needsHeader = true;
	}
	await ensureTrailingNewline(file);
	const payload = needsHeader ? `${historyHeaderLine()}\n${lines.join("\n")}\n` : `${lines.join("\n")}\n`;
	await (0, fs_promises.appendFile)(file, payload, "utf-8");
	await compactFileIfNeeded(projectPath, file);
	return ids;
}
/**
* 文件太大时重写成"最近若干条"。
*
* ⚠️ **按字节收敛，不是按条数**。第一版写的是"保留最近 200 条"，结果被自己的闸门抓住：
* 一份 3000 字的中文记录约 9KB，200 条就是 1.8MB —— **照样超上限**。
* 条数在中英混排下根本不是个有意义的量（和"固定 12 条记忆"是同一个毛病），
* 上限既然是字节，收敛也必须按字节算。
*/
async function compactFileIfNeeded(projectPath, file) {
	try {
		const { size } = await (0, fs_promises.stat)(file);
		if (size <= MAX_FILE_BYTES) return;
		const version = readHistoryFormatVersion(await (0, fs_promises.readFile)(file, "utf-8"));
		if (version > 1) {
			logger.warn(`[ai] 记忆文件格式版本 ${version} 高于当前代码支持的 1，跳过压缩重写（避免用旧代码覆盖新格式）。文件：` + file);
			return;
		}
		const all = await loadHistory(projectPath, file);
		const kept = [];
		let used = 0;
		for (let i = all.length - 1; i >= 0; i -= 1) {
			const lineBytes = Buffer.byteLength(JSON.stringify(all[i]), "utf-8") + 1;
			if (kept.length >= MIN_KEEP_ENTRIES && used + lineBytes > COMPACT_TARGET_BYTES) break;
			kept.push(all[i]);
			used += lineBytes;
		}
		kept.reverse();
		await (0, fs_promises.writeFile)(file, `${historyHeaderLine()}\n${kept.map((e) => JSON.stringify(e)).join("\n")}${kept.length > 0 ? "\n" : ""}`, "utf-8");
	} catch {}
}
/** 清空某个项目的记忆（文件也删掉，否则"清空"只是清了个假象） */
async function clearHistoryFile(projectPath, file = historyFilePath(projectPath)) {
	try {
		if ((0, fs.existsSync)(file)) await (0, fs_promises.rm)(file, { force: true });
	} catch {}
}
/**
* **截断到第 keepCount 条之前**（给「编辑后从此处重开对话」用，2026-10-15）。
*
* 与 append 严格同格式重写整个文件（头行 + 每行一条 JSON）：
* 追加式日志里要「删掉后半截」只能靠重写，格式写歪了下次 loadHistory 就整段读不出来。
*
* @returns 被丢掉多少条（调用方拿它给用户/模型一个交代，不静默）
*/
async function truncateHistoryAt(projectPath, keepCount, file = historyFilePath(projectPath)) {
	const all = await loadHistory(projectPath, file);
	const kept = all.slice(0, Math.max(0, keepCount));
	await (0, fs_promises.mkdir)((0, path.dirname)(file), { recursive: true });
	const lines = kept.filter((e) => e.content.trim().length > 0).map((e) => JSON.stringify({
		// 重写整份文件时必须带 id（第 58 批）：截断是"删后半截"，留下的那几条 id 不能变，
		// 否则已挂上的消息反馈会在截断后集体指向不存在的消息。
		...(e.id ? { id: e.id } : {}),
		ts: e.ts,
		role: e.role,
		content: e.content.length > MAX_ENTRY_CHARS ? e.content.slice(0, MAX_ENTRY_CHARS) + "…" : e.content
	}));
	const body = lines.length > 0 ? lines.join("\n") + "\n" : "";
	await (0, fs_promises.writeFile)(file, historyHeaderLine() + "\n" + body, "utf-8");
	return all.length - kept.length;
}
/**
* 按 token 预算保留**近期尾部**。
*
* 从最新往回累加，超预算就停 —— 这正是 DSH `selectCompactableRange` 里
* `retainTokens` 那段的思路（只是它还要保证不劈开 tool-call/result 配对，我们没有那个结构）。
*
* 被丢掉的部分**不静默消失**：调用方会拿 droppedCount / droppedWithOps 生成一行说明，
* 让模型知道自己不是第一次对话。这正是本仓库反复强调的"不许静默"。
*/
function selectWithinBudget(entries, budgetTokens, estimate) {
	const kept = [];
	let used = 0;
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const e = entries[i];
		const cost = estimate(e.content);
		if (kept.length > 0 && used + cost > budgetTokens) break;
		kept.push(e);
		used += cost;
	}
	kept.reverse();
	const dropped = entries.slice(0, entries.length - kept.length);
	return {
		kept,
		droppedCount: dropped.length,
		droppedWithOps: dropped.filter((e) => e.content.includes("[本轮提出的操作]")).length
	};
}
/**
* 把记忆条目按 token 预算裁成 messages。
*
* ## 为什么收在这里（2026-10-06）
*
* 这段逻辑原来只存在于**机器人侧**（`bot/llm.ts`）。作者助手侧压根没有 —— 于是它每轮
* 都是全新对话，而文档、渲染层注释、`historyStore` 三处都声称记忆是落盘的。
* "按 token 留尾部"只该有一份实现（本仓库为"同一件事两份实现、改漏一处"栽过好几次），
* 所以搬到这个两边都 import 的模块里，机器人侧改成薄包装。
*
* @returns `messages` 直接拼进对话；`retention` 供调用方用 `describeDropped` 交代省略情况
*/
function historyToMessages(entries, budgetTokens = deriveHistoryTokenBudget(), estimate = estimateTokens) {
	// attempt 是诊断留痕，不是对话：既不进 messages，也不占记忆预算（对齐 DSH 的 assistant/attempt 分离）。
	const conversational = entries.filter((e) => e.role !== "attempt");
	const retention = selectWithinBudget(conversational, budgetTokens, estimate);
	return {
		messages: retention.kept.map((e) => ({
			role: e.role,
			content: e.content
		})),
		retention
	};
}
/** 被省略部分的说明 —— 拼在历史最前面，让模型知道"这不是第一次对话" */
function describeDropped(retention) {
	if (retention.droppedCount === 0) return "";
	const opsNote = retention.droppedWithOps > 0 ? `其中 ${retention.droppedWithOps} 条记录了我当时提出的操作（可能已被你确认落盘）。` : "";
	return `（更早的 ${retention.droppedCount} 条对话因超出记忆预算已省略。${opsNote}如果不确定之前动过什么，用 read_flow 看当前流程，不要凭记忆断言。）`;
}

/**
 * 一条历史记忆（JSONL 的一行）。
 *
 * role 取 user/assistant；attempt 是**失败尝试留痕**（进日志、不进模型历史，见 historyToMessages）。
 * attempt 行额外带 reason（error/cancelled）与 ok（恒 false），由 aiAgentCore 失败收尾写入 ——
 * 读侧必须原样带回，否则"重启后查不到上次为什么没做完"。ts 落盘必写，读回缺失按纪元补。
 */
export interface HistoryEntry {
  /** 稳定 id（第 58 批）：消息反馈挂在它上面。老文件可能没有 —— 读侧不编造。 */
  id?: string;
  ts: string;
  role: 'user' | 'assistant' | 'attempt';
  content: string;
  /** 仅 attempt：失败原因 */
  reason?: string;
  /** 仅 attempt：是否成功（失败收尾恒 false） */
  ok?: boolean;
}

export { recordSystemPromptTokens, deriveHistoryTokenBudget, historyHeaderLine, readHistoryFormatVersion, readHistoryForUi, historyFilePath, loadHistory, ensureTrailingNewline, appendHistoryEntries, compactFileIfNeeded, clearHistoryFile, truncateHistoryAt, selectWithinBudget, historyToMessages, describeDropped, TOOL_RESULT_RESERVE_TOKENS, HISTORY_SHARE_OF_REMAINDER, MIN_HISTORY_TOKEN_BUDGET, MAX_HISTORY_TOKEN_BUDGET, recordedSystemPromptTokens, lastLoggedHistoryBudget, HISTORY_HEADER_KIND, MAX_ENTRY_CHARS, MAX_FILE_BYTES, COMPACT_TARGET_BYTES, MIN_KEEP_ENTRIES };
