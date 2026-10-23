// @ts-nocheck
// 由 10/18 打包产物还原（chunk: pluginKindContract-wHH7ArbE.js）；见 _recovery/README-recovery.md

/** 节点在 `index.js` 里的裸名 + 包名 → 运行时/画布上的完整 kind */
function pluginNodeKind(pluginName, nodeKind) {
	return `plugin_${pluginName}_${nodeKind}`;
}
/**
* 插件节点的**默认分组**（作者没写 `node.group` 时用它）。
*
* ## 为什么必须只有一处（P0-12，2026-10-18）
*
* 同一个包会被**两条路径**各读一遍、再在节点库里合并显示：
*   · 画布扫描 `customNodeScanner.pluginNodeToSpecV2`（NodeSpecV2）
*   · 运行时注册表 `pluginLoader.pluginNodeToSpec`（NodeSpec）
* 这两处以前各写一个默认值（「自定义」vs「插件」）—— 没写 group 的包，
* 同一个节点换个读法就**落到不同分组**。
*
* ## 为什么取「自定义」而不是「插件」
*
* 分组键是**稳定契约**（`GROUP_ORDER` 排序、`NodePalette` 图标判断都用它）：
*   · `GROUP_ORDER`（renderer/lib/node/nodeCatalog.ts）只有「自定义」「AI 生成」，
*     没有「插件」—— 「插件」会落到"未知分组"，按字母序排在末尾且没有图标；
*   · `NodePalette` 用 `spec.group === '自定义'` 给 Package 图标。
* 所以「自定义」才是既有 UI 认的插件分组；显式写了 group 的包不受影响。
*/
var PLUGIN_NODE_DEFAULT_GROUP = "自定义";
/**
* 纯代码插件里 **handler（触发器处理函数）** 在 dynamicHandlers 里的注册键。
*
* ## 为什么单独一个函数、而不是复用 pluginNodeKind
*
* 两类能力**不该共用命名空间**：节点叫 `x` 与触发器处理函数叫 `x` 是可能同时存在的，
* 复用会让后注册的那个静默覆盖前一个（现象是「节点一跑就是另一段代码」）。
* 这里加一段 `handler_`，两类 kind 就落在不同的键上。
*
* ⚠️ 前缀仍然是 `plugin_<包名>_`（见 pluginKindPrefix）—— 卸载/重载时按前缀批量清
* 动态 handler（unregisterDynamicHandlersByPrefix）会连同它们一起清掉，不会漏。
*/
function pluginHandlerKind(pluginName, handlerName) {
	return `plugin_${pluginName}_handler_${handlerName}`;
}
/**
* 某个插件的**完整 kind 前缀**（`plugin_<包名>_`）。
*
* 注册、卸载、反查三处必须用同一个前缀 —— 所以它是一个函数，不是三次字面量拼接。
*/
function pluginKindPrefix(pluginName) {
	return `plugin_${pluginName}_`;
}

export { pluginNodeKind, PLUGIN_NODE_DEFAULT_GROUP, pluginHandlerKind, pluginKindPrefix };
