// src/renderer/src/lib/canvas/elkLoader.ts
//
// ELK 加载器：动态 import elkjs（~2.5MB 独立 chunk，首次布局时才拉取），
// 不进首屏 bundle。autoLayout 通过 loadElk() 拿到构造器：
//   const ELK = await loadElk()
//   const elk = new ELK()
//   const result = await elk.layout(graph)

/** ELK 实例最小接口：autoLayout 只用到 layout */
export interface ElkLike {
  layout(
    graph: unknown,
    options?: unknown,
  ): Promise<{ children?: Array<{ id: string; x?: number; y?: number }> }>;
}

// ---------------------------------------------------------------------------
// 为什么这里**没有** Web Worker（2026-09-21 移除，别再加回来）
// ---------------------------------------------------------------------------
//
// 原来有一条 Worker 通道：主线程 `new Worker(elkWorker.ts)`，worker 里
// `new ELK()`（elk.bundled.js），用自定义的 {id, graph} 协议通信。
// 它在真机上从来没跑通过，真机点「布局」必报：
//
//     [BlockEditor] 自动布局失败: Error: _Worker is not a constructor
//         at _worker.onmessage (elkLoader.ts:52)
//
// 根因在 `elkjs/lib/elk.bundled.js`（browserify 打包，末尾内联了
// `elk-worker.min.js` 这个「假 worker」实现）。它用一句环境判断决定自己是
// 「引擎」还是「库」：
//
//     if (typeof document === 'undefined' && typeof self !== 'undefined') {
//       var i = new h(self)
//       self.onmessage = i.saveDispatch          // ← 接管 onmessage，把自己当引擎
//     } else if (typeof module !== 'undefined' && module.exports) {
//       module.exports = { default: j, Worker: j }   // ← 只有这条分支导出 Worker
//     }
//
// **在任何 Web Worker 里 `document` 都是 undefined**，所以第一条分支必然命中：
//   1. `module.exports.Worker` 永远是 undefined →
//      `new _Worker(url)` 抛 "_Worker is not a constructor"；
//   2. 它还会**覆盖 `self.onmessage`**，把我们的 {id, graph} 协议一并踩掉。
//
// 也就是说这条通道是**出生即死**（不是某次改动弄坏的），
// 靠改 `elkWorker.ts` 修不好 —— 得按 elkjs 的官方分工重写：
// 主线程用 `elk-api.js` + `workerUrl`，worker 里**只**放 `elk-worker.min.js`
// （后者会自己接管 onmessage 讲 ELK 自己的消息协议）。
//
// 之所以没有那样重写：`elk-api.js` 收不到 worker 回复时 promise **不会 reject**，
// 一旦 worker 加载失败就会变成**永久挂起**（比报错更难排查）；
// 而下面这条主线程路径是实测可用的 —— 真实项目（214 节点 / 381 控制流边）
// 布局耗时 **856ms**（`scripts/e2e/bench-elk-layout.mjs` 可复现），
// 对一个用户主动点击的动作可以接受。
//
// 如果将来图大到 856ms 不可接受，再按上面的官方分工重写，
// **并且一定要给 worker 通道加超时兜底**，否则失败即挂起。

/** 动态加载 ELK 构造器。 */
export default async function loadElk(): Promise<
  new (options?: Record<string, unknown>) => ElkLike
> {
  const mod = await import('elkjs/lib/elk.bundled.js');
  return mod.default as unknown as new (options?: Record<string, unknown>) => ElkLike;
}
