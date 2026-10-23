// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

var BREAK = "__break_loop__";
var RETURN = "__return__";
var LAST_ERROR = "__last_error__";
var CHAIN_ABORTED = "__chain_aborted__";
/** 置"跳出循环"信号 */
function setBreak(vars) {
	vars[BREAK] = true;
}
/** 是否要求跳出循环（**只读**） */
function hasBreak(vars) {
	return Boolean(vars[BREAK]);
}
/** 读并清"跳出循环"（循环体每轮用；返回本轮是否要求跳出） */
function takeBreak(vars) {
	if (!vars[BREAK]) return false;
	delete vars[BREAK];
	return true;
}
/** 清"跳出循环" */
function clearBreak(vars) {
	delete vars[BREAK];
}
/** 置子流程返回值 */
function setReturn(vars, value) {
	vars[RETURN] = value;
}
/** 读子流程返回值（**只读**；没有则 null） */
function readReturn(vars) {
	return vars[RETURN] ?? null;
}
/** 记录最近一次失败原因 */
function setLastError(vars, message) {
	vars[LAST_ERROR] = message;
}
/** 读最近一次失败原因（**只读**） */
function readLastError(vars) {
	return vars[LAST_ERROR];
}
/** 清最近一次失败原因 */
function clearLastError(vars) {
	delete vars[LAST_ERROR];
}
/** 停链：记下原因并置硬失败信号 */
function abortChain(vars, message) {
	vars[CHAIN_ABORTED] = message;
}
/** 链是否已被中止（**只读**） */
function isChainAborted(vars) {
	return Boolean(vars[CHAIN_ABORTED]);
}
/** 清硬失败信号 */
function clearAbort(vars) {
	delete vars[CHAIN_ABORTED];
}
/** 优先断句的字符：句末标点 + 换行 + 逗号顿号（后半段窗口里命中就提前断） */
var BREAK_CHARS = /* @__PURE__ */ new Set([
	"\n",
	"。",
	"！",
	"？",
	"；",
	"…",
	".",
	"!",
	"?",
	";",
	"，",
	",",
	"、",
	"：",
	":"
]);
/**
* 把完整文本切成 `append` 模式的增量分片序列。
*
* 返回的最后一个分片的 `inputState` 一定是 `10`；前面都是 `1`。
* 文本为空时返回 `[]`。
*/
function buildStreamChunkPlan(text, opts = {}) {
	const chars = Array.from(String(text ?? ""));
	if (chars.length === 0) return [];
	const raw = Number(opts.chunkSize);
	const size = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
	const pieces = [];
	let cursor = 0;
	while (cursor < chars.length) {
		let end = Math.min(cursor + size, chars.length);
		if (end < chars.length) {
			const earliest = cursor + Math.floor(size / 2);
			for (let i = end; i > earliest; i--) if (BREAK_CHARS.has(chars[i - 1])) {
				end = i;
				break;
			}
		}
		pieces.push(chars.slice(cursor, end).join(""));
		cursor = end;
	}
	if (pieces.length > 200) {
		const merged = pieces.slice(0, 199);
		merged.push(pieces.slice(199).join(""));
		pieces.length = 0;
		pieces.push(...merged);
	}
	const last = pieces.length - 1;
	return pieces.map((contentRaw, index) => ({
		index,
		inputState: index === last ? 10 : 1,
		contentRaw
	}));
}

export { BREAK, RETURN, LAST_ERROR, CHAIN_ABORTED, setBreak, hasBreak, takeBreak, clearBreak, setReturn, readReturn, setLastError, readLastError, clearLastError, abortChain, isChainAborted, clearAbort, BREAK_CHARS, buildStreamChunkPlan };
