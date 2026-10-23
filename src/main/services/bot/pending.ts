// @ts-nocheck
// 由 10/18 打包产物还原（chunk: pending-71iBB6-8.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs_promises from "fs/promises";
import * as fs from "fs";
import { conversationKey } from "./memory";

/** 待确认多久作废（毫秒） */
var PENDING_TTL_MS = 3e5;
function pendingFile(projectPath, id) {
	return (0, path.join)(projectPath, "data", "bot-memory", `${conversationKey(id)}.pending.json`);
}
/** 记下一个待确认动作（覆盖旧的 —— 一段会话同时只该有一个待确认） */
async function setPendingAction(projectPath, id, action) {
	const file = pendingFile(projectPath, id);
	await (0, fs_promises.mkdir)((0, path.dirname)(file), { recursive: true });
	await (0, fs_promises.writeFile)(file, JSON.stringify(action), "utf-8");
}
/** 读出待确认动作；过期或损坏一律返回 null（**不猜**） */
async function getPendingAction(projectPath, id, now = Date.now()) {
	const file = pendingFile(projectPath, id);
	if (!(0, fs.existsSync)(file)) return null;
	try {
		const parsed = JSON.parse(await (0, fs_promises.readFile)(file, "utf-8"));
		if (!parsed?.toolName || typeof parsed.askedAt !== "string") return null;
		const age = now - new Date(parsed.askedAt).getTime();
		if (!Number.isFinite(age) || age > 3e5) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** 清掉待确认（执行完、被拒、或过期） */
async function clearPendingAction(projectPath, id) {
	try {
		const file = pendingFile(projectPath, id);
		if ((0, fs.existsSync)(file)) await (0, fs_promises.rm)(file, { force: true });
	} catch {}
}
/** 用户这句话是"同意"吗 —— 只认明确的说法 */
var AFFIRMATIVE = [
	"确认",
	"确定",
	"同意",
	"可以",
	"是的",
	"是的，执行",
	"好",
	"好的",
	"执行",
	"yes",
	"ok",
	"y"
];
/** 用户这句话是"拒绝"吗 */
var NEGATIVE = [
	"取消",
	"不要",
	"不用",
	"否",
	"不",
	"算了",
	"别",
	"no",
	"n"
];
/**
* 判断用户对"要执行吗"的回答。
*
* ⚠️ **判据是 fail-closed 的**：既不是明确同意、也不是明确拒绝时返回 `'unclear'`，
* 调用方必须按"没有同意"处理。安全边界上含糊=不同意，这是刻意的。
*
* 匹配用的是**去空白后的整体比较**，不是"包含"：
* "我不要你管"里含"不要"，但它不是在对确认框说话 —— 用包含匹配会把这类误判成拒绝，
* 更糟的是"好烦啊"含"好"会被误判成同意。整体比较能挡掉绝大部分这类噪声。
*/
function classifyConfirmation(text) {
	const normalized = text.trim().toLowerCase().replace(/[。！!？?，,、\s]/g, "");
	if (!normalized) return "unclear";
	if (AFFIRMATIVE.some((w) => w.toLowerCase() === normalized)) return "yes";
	if (NEGATIVE.some((w) => w.toLowerCase() === normalized)) return "no";
	return "unclear";
}

export { PENDING_TTL_MS, pendingFile, setPendingAction, getPendingAction, clearPendingAction, AFFIRMATIVE, NEGATIVE, classifyConfirmation };
