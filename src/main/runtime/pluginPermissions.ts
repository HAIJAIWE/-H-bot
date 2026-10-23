// @ts-nocheck
// 由 10/18 打包产物还原（chunk: dynamicHandlers-BJxkF_cY.js）；见 _recovery/README-recovery.md

/** 发消息的权限名 */
var MESSAGE_SEND_PERMISSION = "message.send";
/**
* 这次调用**需要**哪条权限。
*
* 发消息统一归到 `message.send`：协议端 API 里 `send_` 开头的都是发送类；
* 内置节点里只有 `message_send` 是发送能力（其余按 `builtin.<kind>` 逐个授权）。
*/
function permissionFor(req) {
	if (req.req === "callApi") return req.name.startsWith("send_") ? MESSAGE_SEND_PERMISSION : `api.${req.name}`;
	return req.name === "message_send" ? MESSAGE_SEND_PERMISSION : `builtin.${req.name}`;
}
/** 给错误文案用的能力描述 */
function describeCapability(req) {
	return req.req === "callApi" ? `协议端 API「${req.name}」` : `内置节点「${req.name}」`;
}
/** 这个权限名是否是当前实现认识的（未知权限不会授予任何能力，加载时提示作者） */
function isKnownPermission(permission) {
	if (typeof permission !== "string" || !permission.trim()) return false;
	if (permission === "message.send") return true;
	const dot = permission.indexOf(".");
	if (dot <= 0 || dot === permission.length - 1) return false;
	const head = permission.slice(0, dot);
	return head === "api" || head === "builtin";
}
/**
* 检查一次能力调用是否被允许。
*
* @param permissions 插件声明的权限；**undefined = 不做限制**（历史节点 handler 走这条）
* @returns null = 允许；否则返回**可读的拒绝原因**（会作为异常抛回插件）
*/
function denyReason(pluginName, permissions, req) {
	if (!permissions) return null;
	const needed = permissionFor(req);
	if (permissions.includes(needed)) return null;
	return `${pluginName ? `插件「${pluginName}」` : "插件"}未声明权限「${needed}」，已拒绝调用${describeCapability(req)}。请在 manifest.json 的 permissions 里加入 "${needed}"。`;
}

export { MESSAGE_SEND_PERMISSION, permissionFor, describeCapability, isKnownPermission, denyReason };
