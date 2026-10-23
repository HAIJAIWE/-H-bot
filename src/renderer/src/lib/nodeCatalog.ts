// 节点库门面（历史扁平路径）
//
// 真正的实现在 `./node/nodeCatalog`（10/18 布局）。这里曾经是**另一份完整副本**：
// 两份各自维护 customNodes / pluginNodes / aiNodes 三个数组和订阅者集合，
// 于是"插件节点装上了但画布看不到"这类问题会出现 —— 写的是 A 模块，读的是 B 模块。
//
// 现在只保留再导出：老 import 路径（`@renderer/lib/nodeCatalog`）继续可用，
// 但只有一份状态。新代码请直接 import `@renderer/lib/node/nodeCatalog`。
export * from './node/nodeCatalog'
