// src/renderer/src/lib/elkLoader.ts
//
import { t } from '../i18n';
// ELK 加载器：优先 Web Worker 执行布局（不阻塞渲染主线程），
// 环境不支持 Worker 时（Node 测试 / 无 Worker 环境）回退主线程 import。
// autoLayout 通过 loadElk() 拿到构造器，接口保持一致：
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
// Worker 通道
// ---------------------------------------------------------------------------

let _worker: Worker | null | undefined;
let _seq = 0;
const _pending = new Map<
  number,
  {
    resolve: (v: { children?: Array<{ id: string; x?: number; y?: number }> }) => void;
    reject: (e: Error) => void;
  }
>();

/** 惰性创建 Worker；失败（如受限环境）返回 null，调用方走主线程回退 */
function getWorker(): Worker | null {
  if (_worker !== undefined) return _worker;
  if (typeof Worker === 'undefined') {
    _worker = null;
    return null;
  }
  try {
    _worker = new Worker(new URL('../workers/elkWorker.ts', import.meta.url), { type: 'module' });
    _worker.onmessage = (
      e: MessageEvent<{
        id: number;
        result?: { children?: Array<{ id: string; x?: number; y?: number }> };
        error?: string;
      }>,
    ) => {
      const p = _pending.get(e.data.id);
      if (!p) return;
      _pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result ?? { children: [] });
    };
    _worker.onerror = (e) => {
      _worker = null;
      for (const [, p] of _pending)
        p.reject(
          new Error(t('lib.elkWorkerError', { message: e.message ?? t('common.unknown') })),
        );
      _pending.clear();
    };
  } catch {
    _worker = null;
  }
  return _worker;
}

/** Worker 通道的构造器：layout() 走 postMessage 请求/响应 */
class ElkWorkerClient implements ElkLike {
  layout(graph: unknown): Promise<{ children?: Array<{ id: string; x?: number; y?: number }> }> {
    const worker = getWorker();
    if (!worker) {
      // Worker 不可用（如 dev 断链后），回退主线程
      return loadElkFallback().then((ELK) => new ELK().layout(graph));
    }
    return new Promise((resolve, reject) => {
      const id = ++_seq;
      _pending.set(id, { resolve, reject });
      worker.postMessage({ id, graph });
    });
  }
}

async function loadElkFallback(): Promise<new (options?: Record<string, unknown>) => ElkLike> {
  const mod = await import('elkjs/lib/elk.bundled.js');
  return mod.default as unknown as new (options?: Record<string, unknown>) => ElkLike;
}

/** 动态加载 ELK 构造器（elkjs ~2.5MB 独立 chunk，首次布局时才拉取）。
 *  优先 Worker 通道；Node 测试环境 / Worker 不可用时回退主线程版本。 */
export default async function loadElk(): Promise<
  new (options?: Record<string, unknown>) => ElkLike
> {
  // Worker 可用则直接返回 Worker 客户端（worker 脚本由 Vite 单独打包）
  if (getWorker() !== null) {
    return ElkWorkerClient as unknown as new (options?: Record<string, unknown>) => ElkLike;
  }
  return loadElkFallback();
}
