// tests/renderer/components/ui/Skeleton.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonGrid,
} from '@renderer/components/ui/Skeleton'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Skeleton - 基础块', () => {
  it('渲染骨架块并设置 aria-hidden', () => {
    const { container } = render(<Skeleton />)
    const el = container.firstChild as HTMLElement
    expect(el).toBeInTheDocument()
    expect(el).toHaveAttribute('aria-hidden', 'true')
  })

  it('接受自定义 className', () => {
    const { container } = render(<Skeleton className="h-4 w-28" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('h-4')
    expect(el.className).toContain('w-28')
  })

  it('默认包含脉冲动画类', () => {
    const { container } = render(<Skeleton />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('animate-pulse')
  })
})

describe('SkeletonText - 多行文本占位', () => {
  it('默认渲染 3 行骨架', () => {
    const { container } = render(<SkeletonText />)
    // SkeletonText 内部用多个 Skeleton，统计 .animate-pulse 元素
    const lines = container.querySelectorAll('.animate-pulse')
    expect(lines.length).toBe(3)
  })

  it('支持自定义行数', () => {
    const { container } = render(<SkeletonText lines={5} />)
    const lines = container.querySelectorAll('.animate-pulse')
    expect(lines.length).toBe(5)
  })

  it('lines=1 时仅渲染 1 行', () => {
    const { container } = render(<SkeletonText lines={1} />)
    const lines = container.querySelectorAll('.animate-pulse')
    expect(lines.length).toBe(1)
  })

  it('最后一行应用更窄的宽度类', () => {
    const { container } = render(<SkeletonText lines={3} />)
    const lines = container.querySelectorAll('.animate-pulse')
    // 最后一行应为 w-3/5，前两行为 w-full
    expect(lines[2].className).toContain('w-3/5')
    expect(lines[0].className).toContain('w-full')
  })

  it('设置 aria-hidden 标识', () => {
    const { container } = render(<SkeletonText />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('SkeletonCard - 卡片占位', () => {
  it('渲染卡片骨架', () => {
    const { container } = render(<SkeletonCard />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('设置 aria-hidden 标识', () => {
    const { container } = render(<SkeletonCard />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('卡片内包含多行文本骨架', () => {
    const { container } = render(<SkeletonCard />)
    const lines = container.querySelectorAll('.animate-pulse')
    // 卡片头部 2 个 + SkeletonText 2 行 = 4
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })
})

describe('SkeletonTableRow - 表格行占位', () => {
  it('默认渲染 4 列', () => {
    const { container } = render(<SkeletonTableRow />)
    const cells = container.querySelectorAll('.animate-pulse')
    expect(cells.length).toBe(4)
  })

  it('支持自定义列数', () => {
    const { container } = render(<SkeletonTableRow columns={6} />)
    const cells = container.querySelectorAll('.animate-pulse')
    expect(cells.length).toBe(6)
  })

  it('设置 aria-hidden 标识', () => {
    const { container } = render(<SkeletonTableRow />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('第一列应用固定宽度类 w-12', () => {
    const { container } = render(<SkeletonTableRow columns={3} />)
    const cells = container.querySelectorAll('.animate-pulse')
    expect(cells[0].className).toContain('w-12')
  })
})

describe('SkeletonGrid - 网格占位', () => {
  it('默认渲染 6 张卡片', () => {
    const { container } = render(<SkeletonGrid />)
    // 每张卡片是 SkeletonCard，含 .bg-zinc-900 类
    const cards = container.querySelectorAll('.bg-zinc-900')
    expect(cards.length).toBe(6)
  })

  it('支持自定义卡片数', () => {
    const { container } = render(<SkeletonGrid cards={3} />)
    const cards = container.querySelectorAll('.bg-zinc-900')
    expect(cards.length).toBe(3)
  })

  it('设置 aria-hidden 标识', () => {
    const { container } = render(<SkeletonGrid />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
})
