// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/** 表达式长度上限（防 DoS） */
var MAX_EXPR_LEN = 1e4;
/**
* Python 三元 `A if COND else B` → JS `(COND ? A : B)`。
*
* ## 为什么不能直接用正则（2026-09-21 真机事故）
*
* 原来的实现是一行正则：
*
* ```js
* s.replace(/^(.+?)\s+if\s+(.+?)\s+else\s+(.+)$/, '($2 ? $1 : $3)')
* ```
*
* `.` 在**单行**输入里能匹配任意字符，而用户在「表达式求值」里写的公式经常是一行压完的
* IIFE（`(function(){ ... if (x) return ...; ... })()`）。于是：
*
* ```
* 原文: (function(){ var name = str(v1); ... if (price < 0 || g < price) return to_json({}); ... })()
* 译文: ((price < 0 || g < price) return to_json({}); ...)
*                              ↑ return 出现在表达式位置 → SyntaxError: Unexpected token 'return'
* ```
*
* `(function(){` 被当成了"真值分支"。求值失败后 `data` 端口拿到 `null`，被
* `JSON.parse((data as string) || '{}')` 兜成 `{}` —— **一句错都不报**，表现为
* "提示购买成功、金币却没扣"（背包照旧，因为那次 batch_save 写的是空字典）。
*
* 现在改了三条：
* 1. 关键词计数（`if` / `else` 必须各一个，且在**屏蔽掉字符串字面量**的副本上数）—— 语句块里
*    通常有多个 `if`，直接跳过翻译。
* 2. `if` 左侧紧邻 `;` `{` `}` 时判为语句关键字，也跳过翻译。
* 3. 翻译完必须能通过 `new Function` 解析；不合法就**保留原文**，让 `safeEvalDetailed`
*    如实抛出语法错误（有错要报，绝不能静默换成另一种语义）。
*/
function translatePyTernary(expr) {
	const masked = maskStringLiterals(expr);
	const ifMatches = masked.match(/\bif\b/g);
	const elseMatches = masked.match(/\belse\b/g);
	if (!ifMatches || ifMatches.length !== 1) return expr;
	if (!elseMatches || elseMatches.length !== 1) return expr;
	const ifIdx = masked.search(/\bif\b/);
	const elseIdx = masked.search(/\belse\b/);
	if (ifIdx < 0 || elseIdx < 0 || elseIdx < ifIdx) return expr;
	const beforeIf = expr.slice(0, ifIdx).replace(/\s+$/, "");
	const cond = expr.slice(ifIdx + 2, elseIdx).trim();
	const afterElse = expr.slice(elseIdx + 4).replace(/^\s+/, "");
	const afterElseMasked = masked.slice(elseIdx + 4).replace(/^\s+/, "");
	if (!beforeIf || !cond || !afterElse) return expr;
	const prevChar = beforeIf[beforeIf.length - 1];
	if (!/[)\]"'`\w$]/.test(prevChar)) return expr;
	if (/[;{}]\s*$/.test(beforeIf)) return expr;
	if (/^if\b/.test(afterElseMasked)) return expr;
	if (afterElseMasked.startsWith("{")) {
		const inner = bracedInner(afterElseMasked);
		if (inner !== null && /\breturn\b|;|\bif\b/.test(inner)) return expr;
	}
	const trueFrom = innermostUnclosedParen(beforeIf);
	const tailPrefix = trueFrom > 0 ? beforeIf.slice(0, trueFrom) : "";
	const trueBranch = beforeIf.slice(trueFrom);
	const cut = falseBranchEnd(afterElseMasked);
	const translated = `${tailPrefix}(${cond} ? ${trueBranch} : ${cut <= 0 ? afterElse : afterElse.slice(0, cut)})${cut <= 0 ? "" : afterElse.slice(cut)}`;
	if (!isParsableExpr(translated)) return expr;
	return translated;
}
/**
* 取从下标 0 的 `{` 到**配对** `}` 之间的内容；不配对返回 null。
*
* 只用来判断"花括号里是不是语句"，不做求值 —— 所以不处理字符串/注释里的括号
* （调用方传的是已屏蔽字符串字面量的副本）。
*/
function bracedInner(masked) {
	let depth = 0;
	for (let i = 0; i < masked.length; i++) {
		const ch = masked[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return masked.slice(1, i);
		}
	}
	return null;
}
/**
* 最内层**未闭合**的 `(` 的下一位（真值分支的起点）；没有未闭合 `(` 时返回 0。
*
* 例：`str(get(get(v1,"battle",{})` 的栈里剩 `str(` 与 `get(`，
* 最内层是第二个 `get(`（下标 7）→ 返回 8，于是 `str(get(` 原样留在译文外面。
*/
function innermostUnclosedParen(text) {
	const stack = [];
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "(") stack.push(i);
		else if (c === ")" && stack.length > 0) stack.pop();
	}
	const last = stack[stack.length - 1];
	return last === void 0 ? 0 : last + 1;
}
/**
* 假值分支的终点下标（`else` 之后的**同层** `,` / `)` / `]`）。
*
* `text` 必须是已屏蔽字符串字面量的副本（长度与原文一致，所以下标可以直接切原文）。
* 返回 0 表示"整段都是假分支"（没有同层分隔符）。
*/
function falseBranchEnd(text) {
	let paren = 0;
	let bracket = 0;
	let brace = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "(") paren++;
		else if (c === ")") {
			if (paren === 0 && bracket === 0 && brace === 0) return i;
			paren--;
		} else if (c === "[") bracket++;
		else if (c === "]") {
			if (bracket === 0 && paren === 0 && brace === 0) return i;
			bracket--;
		} else if (c === "{") brace++;
		else if (c === "}") brace--;
		else if (c === "," && paren === 0 && bracket === 0 && brace === 0) return i;
	}
	return 0;
}
/**
* 把字符串/模板字面量内部替换成空格（保留首尾引号）。
*
* 结构扫描（关键词计数、括号平衡）必须在屏蔽后的副本上做，否则：
* - 字符串里写着 `"if"` / `"else"` → 关键词计数变成 2，真三元被误判成语句块；
* - 字符串里带括号 → 括号平衡算错。
*
* **长度严格不变**，所以屏蔽串的下标可以直接拿去切原文。
*/
function maskStringLiterals(text) {
	let out = "";
	let quote = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === "\\") {
				out += "  ";
				i++;
				continue;
			}
			if (c === quote) {
				quote = null;
				out += c;
			} else out += " ";
			continue;
		}
		if (c === "\"" || c === "'" || c === "`") {
			quote = c;
			out += c;
			continue;
		}
		out += c;
	}
	return out;
}
/** 用 `new Function` 试解析一个表达式（不执行），只判断语法是否合法 */
function isParsableExpr(expr) {
	try {
		new Function(`"use strict"; return (${expr});`);
		return true;
	} catch {
		return false;
	}
}
/** 将表达式里的 Python 风格写法翻译为 JS 表达式（函数名沿用历史命名，供测试引用） */
function translatePyToJs(expr) {
	let s = expr;
	s = s.replace(/\bTrue\b/g, "true");
	s = s.replace(/\bFalse\b/g, "false");
	s = s.replace(/\bNone\b/g, "null");
	s = s.replace(/\band\b/g, "&&");
	s = s.replace(/\bor\b/g, "||");
	s = s.replace(/\bnot\b/g, "!");
	s = s.replace(/\bf(["'])((?:\\.|(?!\1).)*)\1/g, (_m, q, body) => {
		return "`" + String(body).replace(/\{([^}]+)\}/g, "${$1}") + "`";
	});
	s = translatePyTernary(s);
	s = s.replace(/(\w+|'[^']*'|"[^"]*")\s+in\s+(\w+|'[^']*'|"[^"]*")/g, "__in($1, $2)");
	return s;
}

export { MAX_EXPR_LEN, translatePyTernary, bracedInner, innermostUnclosedParen, falseBranchEnd, maskStringLiterals, isParsableExpr, translatePyToJs };
