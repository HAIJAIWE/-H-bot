// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { MAX_EXPR_LEN, translatePyToJs } from "../../shared/nodes/pyToJs";

/**
* 检查一条表达式能否被翻译成**合法 JS 表达式**。
*
* 返回 `{ ok: true }` 表示"翻译后的 JS 能通过 V8 编译"——**不代表**它运行时不报错
* （未定义变量、类型不对都不在此列）。
*/
function checkExpressionSyntax(expression) {
	if (typeof expression !== "string" || !expression.trim()) return { ok: true };
	const trimmed = expression.trim();
	if (trimmed.length > 1e4) return {
		ok: false,
		error: `表达式过长（上限 ${MAX_EXPR_LEN} 字符）`
	};
	let jsExpr;
	try {
		jsExpr = translatePyToJs(trimmed);
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
	try {
		new Function(`"use strict"; return (${jsExpr});`);
		return { ok: true };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: jsExpr === trimmed ? message : `翻译后: ${jsExpr}\n${message}`
		};
	}
}

export { checkExpressionSyntax };
