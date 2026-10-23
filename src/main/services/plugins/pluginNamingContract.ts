// @ts-nocheck
// 由 10/18 打包产物还原（chunk: pluginNamingContract-0WbhHhim.js）；见 _recovery/README-recovery.md

/**
* 包名 / 目录名规则：小写字母开头，含小写字母/数字/连字符/下划线。
*
* 两种分隔符都收：框架自己两种都产出，磁盘上也两种都已存在（见文件头）。
*/
var PLUGIN_DIR_NAME_RE = /^[a-z][a-z0-9_-]*$/;
/** 包名/目录名/节点裸名的长度上限（两条 isValid 共用；超出会被拒） */
export const PLUGIN_NAME_MAX_LENGTH = 60;
/**
* 节点裸名规则：小写字母开头，含小写字母/数字/下划线。
*
* **不收连字符**：codegen 会生成 `handler_<裸名>` 函数，`-` 不是合法标识符。
*/
var PLUGIN_NODE_KIND_RE = /^[a-z][a-z0-9_]*$/;
/** 包名/目录名是否合法（新建插件时用；加载时不看名字） */
function isValidPluginDirName(name) {
	return typeof name === "string" && name.length > 0 && name.length <= 60 && PLUGIN_DIR_NAME_RE.test(name);
}
/** 节点裸名是否合法（写 `index.js` 的 `kind` 前校验） */
function isValidPluginNodeKind(name) {
	return typeof name === "string" && name.length > 0 && name.length <= 60 && PLUGIN_NODE_KIND_RE.test(name);
}
/**
* 从**包名/目录名**推出默认的**节点裸名**。
*
* 「新建自定义节点」按钮让用户只填一个名字（如 `my-node`），节点裸名由它派生：
* 连字符 → 下划线（`my-node` → `my_node`）—— 因为裸名必须是合法 JS 标识符
* （见文件头）。已经只有下划线的名字原样返回。
*/
function nodeKindFromPluginDirName(dirName) {
	return dirName.replace(/-/g, "_");
}
//#endregion

export { PLUGIN_DIR_NAME_RE, PLUGIN_NODE_KIND_RE, isValidPluginDirName, isValidPluginNodeKind, nodeKindFromPluginDirName };
