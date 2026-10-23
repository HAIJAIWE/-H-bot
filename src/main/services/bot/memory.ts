// @ts-nocheck
// 由 10/18 打包产物还原（chunk: memory-BeH0r6cR.js）；见 _recovery/README-recovery.md
import * as crypto from "crypto";
import * as path from "path";
import { appendHistoryEntries, clearHistoryFile, loadHistory } from "../ai/historyStore";

/** 会话键里允许出现的字符；其余一律走哈希（见 sanitizeKey） */
var SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;
/**
* 拼出会话键。
*
* 注意这里**不是**直接把输入拼进路径就完事：不认识的字符会被换成短哈希，
* 所以 `../../etc/passwd` 这种输入只会得到一个无害的文件名。
*/
function conversationKey(id) {
	const g = id.groupId ? `g-${id.groupId}` : "";
	const u = id.userId ? `u-${id.userId}` : "";
	return (id.scope === "group" ? [g || "g-unknown", "shared"] : id.scope === "user" ? [u || "u-unknown"] : [g || "g-unknown", u || "u-unknown"]).map(sanitizeKey).join("__");
}
/** 单个片段的白名单过滤 + 兜底哈希 */
function sanitizeKey(part) {
	const trimmed = part.trim();
	if (trimmed.length > 0 && trimmed.length <= 64 && SAFE_KEY_RE.test(trimmed)) return trimmed;
	return `h${(0, crypto.createHash)("sha1").update(part).digest("hex").slice(0, 16)}`;
}
/** 会话记忆文件路径 */
function conversationFile(projectPath, key) {
	return (0, path.join)(projectPath, "data", "bot-memory", `${key}.jsonl`);
}
/** 读回一段会话的记忆（坏行自动跳过） */
async function loadConversation(projectPath, id) {
	return loadHistory(projectPath, conversationFile(projectPath, conversationKey(id)));
}
/** 追加一轮对话 */
async function appendConversation(projectPath, id, entries) {
	await appendHistoryEntries(projectPath, entries, conversationFile(projectPath, conversationKey(id)));
}
/** 忘掉一段会话（比如用户发「/重置」） */
async function forgetConversation(projectPath, id) {
	await clearHistoryFile(projectPath, conversationFile(projectPath, conversationKey(id)));
}

export { SAFE_KEY_RE, conversationKey, sanitizeKey, conversationFile, loadConversation, appendConversation, forgetConversation };
