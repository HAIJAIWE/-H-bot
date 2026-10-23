// tests/setup.ts
//
// vitest 的全局前置（vitest.config.ts 的 setupFiles）。
// 10/18 产物只带 out/，原 setup 源码没有被任何一次会话全量读过（tape 里 0 次 write/read 命中），
// 这里按「测试文件实际依赖的全局行为」重写 —— 凡是测试自己 mock 的都不在这里重复。
//
// 约定的三件事：
//   1. jest-dom 断言（toBeInTheDocument 等）—— 部分测试文件会自己 import，为了两种写法都能跑，这里统一装一次；
//   2. 每个用例后清理 DOM（@testing-library/react 的 cleanup）—— 否则同一文件里多个 render 会互相看得到；
//   3. jsdom 缺的浏览器 API 兜底（ResizeObserver / IntersectionObserver / matchMedia / scrollIntoView / requestAnimationFrame）。
//      这些只补「不存在」的情况，测试自己的 mock 优先。
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

type Ctor = new (...args: unknown[]) => unknown

function ensureGlobal(name: string, value: unknown): void {
  const g = globalThis as Record<string, unknown>
  if (g[name] === undefined) g[name] = value
}

// ResizeObserver：@xyflow/react 的画布、若干弹窗都会在 mount 时创建。
ensureGlobal('ResizeObserver', class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} satisfies Ctor)

// IntersectionObserver：懒加载/可见性判断用。
ensureGlobal('IntersectionObserver', class IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: number[] = []
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] { return [] }
} satisfies Ctor)

// matchMedia：主题切换与 prefers-reduced-motion 判断读它（jsdom 不实现）。
ensureGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}))

// scrollIntoView / scrollTo：消息列表与日志面板在 effect 里滚到底。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}
if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
  (window as unknown as Record<string, unknown>).scrollTo = () => {}
}

// requestAnimationFrame：jsdom 有，但 headless 下有时被测试改成 sync，这里只在缺失时补。
ensureGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number)

export {}
