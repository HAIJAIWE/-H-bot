/**
 * 项目根上下文（AsyncLocalStorage）。
 *
 * ## 为什么需要它
 *
 * 玩家存档/变量库是「每项目一个库」（`{项目}/data/players/persistent.db`）。
 * 运行时是**一条消息一条异步链**，库路径不能在进程级全局状态里存 ——
 * 同时跑两个 bot 时会互相串。这里用 AsyncLocalStorage 把项目根绑到异步链上：
 * `FlowInterpreter.dispatchEvent` 在链路入口调一次，之后所有 `await` 后的代码都能取到。
 *
 * 没有上下文时（脚本、测试、单节点调试）回退 `projectPath.getProjectRoot()`。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { getProjectRoot as getProjectRootUntyped } from './projectPath';

/** `projectPath.ts` 是 10/18 产物还原的 @ts-nocheck 文件，这里补上显式签名 */
const getProjectRoot = getProjectRootUntyped as (injectedRoot?: string) => string;

const storage = new AsyncLocalStorage<string>();

/** 在指定项目根下执行一段逻辑（含它内部所有 await 后的代码） */
export function runWithProjectRoot<T>(projectRoot: string | null | undefined, fn: () => T): T {
  if (!projectRoot) return fn();
  return storage.run(projectRoot, fn);
}

/** 当前异步链所属的项目根（没有上下文时回退 `getProjectRoot()`） */
export function currentProjectRoot(): string {
  return storage.getStore() ?? getProjectRoot();
}

export { storage };
