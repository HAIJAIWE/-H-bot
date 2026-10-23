// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import * as node_async_hooks from "node:async_hooks";
import { getProjectRoot } from "./projectPath";

var storage = new node_async_hooks.AsyncLocalStorage();
/**
* 在指定项目根下执行一段逻辑（含它内部所有 await 后的代码）。
*
* 运行时（`FlowInterpreter`）在**每条消息开始处理时**调用一次，
* 于是这条链上所有持久化读写都落在该项目的库里。
*/
function runWithProjectRoot(projectRoot, fn) {
	if (!projectRoot) return fn();
	return storage.run(projectRoot, fn);
}
/** 当前异步链所属的项目根（没有上下文时回退 `getProjectRoot()`） */
function currentProjectRoot() {
	const fromContext = storage.getStore();
	if (fromContext) return fromContext;
	return getProjectRoot();
}

export { storage, runWithProjectRoot, currentProjectRoot };
