// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import { checkExpressionSyntax } from "../runtime/expressionCheck";

/** 单条表达式长度上限（与运行时一致，这里只用来拒绝明显异常的入参） */
var MAX_LEN = 1e4;
function registerExpressionIpc() {
	/**
	* expression:checkSyntax — 传入表达式原文，返回 `{ ok: true }` 或 `{ ok: false, error }`。
	*
	* 「只报语法/翻译错误，绝不报未定义变量」是硬要求：面板按"合法名字清单"引导用户，
	* 把"未定义"混进来会变成大面积误报（教训见 docs/game/rpg-node-gap-audit.md §8.2）。
	*/
	electron.ipcMain.handle("expression:checkSyntax", (_event, text) => {
		if (typeof text !== "string" || text.length > MAX_LEN) return { ok: true };
		return checkExpressionSyntax(text);
	});
}

export { MAX_LEN, registerExpressionIpc };
