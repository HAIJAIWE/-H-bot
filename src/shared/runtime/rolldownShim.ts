// rolldown 运行时辅助函数的最小实现（只覆盖本仓库打包产物里实际用到的形态）。
export function __exportAll(all: Record<string, () => unknown>): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (const key of Object.keys(all)) {
    Object.defineProperty(target, key, { get: all[key], enumerable: true, configurable: true });
  }
  return target;
}
export function __esmMin(fn: () => void): () => void {
  let ran = false;
  return () => { if (!ran) { ran = true; fn(); } };
}
export function __toCommonJS(mod: unknown): unknown { return mod; }
export function __toESM(mod: unknown): unknown { return mod; }
export function __commonJSMin<T>(fn: () => T): () => T {
  let cached: T;
  return () => { if (!cached) cached = fn(); return cached; };
}
