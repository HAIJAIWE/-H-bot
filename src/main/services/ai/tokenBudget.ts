// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/tokenBudget.ts），只保证语法/行为，类型待补。
import * as require_logger from '../infra/logger';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';


/**
* 粗估一段文本的 token 数。
*
* 经验判据（不做分词，只求量级正确）：
* - CJK（中日韩）字符 ≈ 1 token/字 —— 汉字基本都是独立 token 或两字一 token
* - 其余（ASCII/JSON/代码）≈ 4 字符/token
*
* 刻意**偏保守（偏高）**：估算偏低会让人误以为还有余量，那正是这个模块要防的事。
*/
/** 单张图片的粗略 token 数（见 measureConversation 里的说明） */
var IMAGE_TOKENS = 1e3;
function estimateTokens(text) {
	if (!text) return 0;
	let cjk = 0;
	let other = 0;
	for (let i = 0; i < text.length;) {
		const cp = text.codePointAt(i) ?? 0;
		if (isCjk(cp)) cjk += 1;
		else other += 1;
		i += cp > 65535 ? 2 : 1;
	}
	return cjk + Math.ceil(other / 4);
}
/** CJK 及全角标点的码点区间 */
function isCjk(cp) {
	return cp >= 12288 && cp <= 12351 || cp >= 12352 && cp <= 12543 || cp >= 13312 && cp <= 19903 || cp >= 19968 && cp <= 40959 || cp >= 63744 && cp <= 64255 || cp >= 65280 && cp <= 65519;
}
/**
* 估算一整段对话的 token 用量。
*
* 计入 `content`、`toolResult`（真正进模型的是它）与工具调用的 `args`
* ——只算 content 会漏掉工具结果，而工具结果恰恰是本项目最大的那块。
*/
function measureConversation(messages, topN = 5) {
	let total = 0;
	let chars = 0;
	const perMessage = [];
	for (const m of messages) {
		let size = 0;
		const body = m.toolResult ?? m.content ?? "";
		size += estimateTokens(body);
		chars += body.length;
		/**
		* 图片**按张估**，不按 base64 长度算。
		*
		* 两个坑都躲开：
		*   · 若拿 base64 长度当文字算 → 一张截图几十万「token」，日志直接爆表；
		*   · 若完全不算 → 贴着软线跑的人以为自己还有余量，其实每张图先扣掉约 1000。
		* 取 1000 是业界对 1024×1024 一档的量级（界面侧已把长边压到 1568 以内）。
		*/
		size += (m.images?.length ?? 0) * IMAGE_TOKENS;
		if (m.toolCalls) for (const call of m.toolCalls) {
			const argsText = (() => {
				try {
					return JSON.stringify(call.args ?? {});
				} catch {
					return "";
				}
			})();
			size += estimateTokens(argsText) + estimateTokens(call.name ?? "");
			chars += argsText.length;
		}
		total += size;
		perMessage.push({
			role: m.role,
			tokens: size
		});
	}
	const heaviest = [...perMessage].sort((a, b) => b.tokens - a.tokens).slice(0, topN);
	return {
		estimatedTokens: total,
		chars,
		heaviest
	};
}
/** 把一次请求的估算写成一行日志（真实 usage 到了之后再补一行对照） */
function describeMeasurement(m) {
	const top = m.heaviest.filter((h) => h.tokens > 0).map((h) => `${h.role}:${h.tokens}`).join(" ");
	return `估算 ~${m.estimatedTokens} tokens / ${m.chars} 字符${top ? `（最大几条 ${top}）` : ""}`;
}
/**
* 整段对话的 token 上限（估算值）—— 超了就在**下一轮开始前**优雅收尾。
*
* ## 为什么需要（2026-10-06 审查发现）
*
* 这个模块此前**一个生产调用点都没有**：单发闸门（`toolResultBudget`）管"一次工具结果多大"，
* 但 10 轮 × 每轮多个工具可以累到几十万码点 —— 那时唯一的反馈是 API 报 400，
* 用户看到一句看不懂的错，这轮已规划的操作也全丢。
*
* ## 取值
*
* 80k 远小于主流模型窗口（128k/200k），给系统提示与输出留足余量；
* 估算本身**刻意偏高**（见 `estimateTokens`），所以它是"该收尾了"的软线，不是精确边界。
*/
var CONVERSATION_TOKEN_BUDGET = 8e4;


export { estimateTokens, isCjk, measureConversation, describeMeasurement, compactMessages, IMAGE_TOKENS, CONVERSATION_TOKEN_BUDGET };

/** 压缩后单条尾部消息的上限（码点）。一条工具结果不能独占整份上下文。 */
var COMPACT_MAX_TAIL_CHARS = 4e3;
/** 保留的最少消息条数：system + 原始需求之外，最近的这几条是「当前现场」 */
var COMPACT_KEEP_TAIL = 2;
/** 低于这个量级不值得压（压缩本身也会丢信息，没收益就别动） */
var COMPACT_MIN_CHARS = 2e4;
/**
* 把一段超长文本落到 `.qqbat/ai-spill/`（同步版）。
*
* 为什么同步：`compactMessages` 是纯函数式的同步接口（调用方在组装上下文的同一帧里要用结果）。
* 与 `spillStore.saveSpillText` 的关系：那个是异步的、给工具结果预算用的；这里只多做一件
* 同步落盘的事，路径约定一致（都在 `.qqbat/ai-spill/`），用户能自己在项目里翻到。
*
* 没有 projectPath 时落到系统临时目录 —— 绝不往进程工作目录写（那会把仓库搞脏）。
*/
function spillSync(text, projectPath, label) {
	try {
		const dir = join(projectPath || tmpdir(), ".qqbat", "ai-spill");
		mkdirSync(dir, { recursive: true });
		const safe = String(label || "compact").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "compact";
		const file = join(dir, `${Date.now()}-${safe}.txt`);
		writeFileSync(file, text, "utf-8");
		return file;
	} catch {
		return null;
	}
}
/** 一条消息「值不值得留」的粗略摘要（只取开头，不试图理解语义） */
function snippetOf(m, n = 60) {
	const body = String(m.toolResult ?? m.content ?? "").replace(/\s+/g, " ").trim();
	return body.length > n ? `${body.slice(0, n)}…` : body;
}
/** 中间段压成「要点索引」：留下每条在做的事，丢掉正文 */
function buildCompactIndex(middle) {
	const roles = {};
	let chars = 0;
	for (const m of middle) {
		roles[m.role] = (roles[m.role] ?? 0) + 1;
		chars += String(m.content ?? "").length;
	}
	const roleText = Object.entries(roles).map(([r, n]) => `${r} ${n}`).join(" / ");
	const lines = middle.filter((m) => m.role === "user" || m.role === "assistant").slice(0, 8).map((m) => `- ${m.role}：${snippetOf(m)}`);
	return {
		role: "user",
		content: [
			"【早期对话已压缩】",
			`- 更早的 ${middle.length} 条消息（${roleText}），共 ${chars} 字符，正文已省略。`,
			"- 省略的原因：这些轮次里的操作结论已经落到流程/文件里，逐字重放既占预算又容易让模型误以为还没做。",
			...lines,
		].join("\n"),
		isCompactIndex: true
	};
}
/** 尾部单条截断：头段保留 + 溢出路径（fail-open：落不下就原样留着） */
function truncateTailMessage(m, maxChars, projectPath) {
	const text = String(m.content ?? "");
	if (text.length <= maxChars) return m;
	const full = String(m.toolResult ?? text);
	const path = spillSync(full, projectPath, m.role);
	if (!path) return m;
	const head = text.slice(0, maxChars);
	const note = `\n\n[... 尾部已截断：原 ${text.length} 字，完整内容已保存到 ${path}（可用 read_file 读取） ...]`;
	return { ...m, content: `${head}${note}` };
}
/**
* 上下文压缩（撞预算前先压，而不是直接收尾）。
*
* 三条纪律（见 tests/main/services/ai/contextCompaction.test.ts）：
*   ① system / 原始需求 / 最近现场必须留；② 中间压成索引；③ 没收益就不压。
* 刻意不用 LLM 摘要：摘要会失真，而失真的地方正是「模型以为自己做过什么」。
*/
function compactMessages(messages, options = {}) {
	const keepTail = Math.max(1, options.keepTail ?? COMPACT_KEEP_TAIL);
	const maxTailChars = Math.max(50, options.maxTailChars ?? COMPACT_MAX_TAIL_CHARS);
	const minChars = options.minChars ?? COMPACT_MIN_CHARS;
	const projectPath = options.projectPath;
	const before = messages.reduce((n, m) => n + String(m.content ?? "").length, 0);
	let headEnd = 0;
	while (headEnd < messages.length && messages[headEnd].role === "system") headEnd++;
	if (headEnd < messages.length) headEnd++;
	const tailStart = Math.max(headEnd, messages.length - keepTail);
	const head = messages.slice(0, headEnd);
	const middle = messages.slice(headEnd, tailStart);
	const tail = messages.slice(tailStart);
	// 尾部单条超长是「预算被一条工具结果吃掉」的主因，它自己就值得截断（不看总字数）
	const oversizedTail = tail.some((m) => String(m.content ?? "").length > maxTailChars);
	const trimmedTail = tail.map((m) => truncateTailMessage(m, maxTailChars, projectPath));
	if (middle.length === 0) {
		// 短对话：除了截断超长尾部之外没别的可做 —— 没收益就原样返回
		const onlyTrimmed = [...head, ...trimmedTail];
		const trimmedChars = onlyTrimmed.reduce((n, m) => n + String(m.content ?? "").length, 0);
		if (trimmedChars >= before) return { messages, compacted: false, savedChars: 0 };
		return { messages: onlyTrimmed, compacted: true, savedChars: before - trimmedChars };
	}
	// 中间段压缩本身也会丢信息：总量太小且没有超长尾部时不动
	if (before < minChars && !oversizedTail) return { messages, compacted: false, savedChars: 0 };
	const out = [...head, buildCompactIndex(middle), ...trimmedTail];
	const after = out.reduce((n, m) => n + String(m.content ?? "").length, 0);
	if (after >= before) return { messages, compacted: false, savedChars: 0 };
	return { messages: out, compacted: true, savedChars: before - after };
}
