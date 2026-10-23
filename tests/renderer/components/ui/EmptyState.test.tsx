// tests/renderer/components/ui/EmptyState.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EmptyState } from '@renderer/components/ui/EmptyState'

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

describe('EmptyState - 基础渲染', () => {
  it('渲染标题文本', () => {
    render(<EmptyState title="暂无数据" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('必填 title prop 缺省时仍可渲染（空字符串）', () => {
    const { container } = render(<EmptyState title="" />)
    expect(container.firstChild).toBeInTheDocument()
  })
})

describe('EmptyState - 描述', () => {
  it('提供 description 时渲染描述文本', () => {
    render(<EmptyState title="暂无数据" description="请先创建项目" />)
    expect(screen.getByText('请先创建项目')).toBeInTheDocument()
  })

  it('未提供 description 时不渲染描述', () => {
    const { container } = render(<EmptyState title="暂无数据" />)
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})

describe('EmptyState - 图标', () => {
  it('提供 icon 时渲染图标', () => {
    render(
      <EmptyState
        title="暂无数据"
        icon={<span data-testid="icon">📭</span>}
      />
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('未提供 icon 时不渲染图标容器', () => {
    const { container } = render(<EmptyState title="暂无数据" />)
    // 图标容器无 data-testid，确认不存在
    expect(container.querySelector('[data-testid="icon"]')).toBeNull()
  })
})

describe('EmptyState - 行动按钮', () => {
  it('提供 action 时渲染行动节点', () => {
    render(
      <EmptyState
        title="暂无数据"
        action={<button>新建项目</button>}
      />
    )
    expect(screen.getByText('新建项目')).toBeInTheDocument()
  })

  it('未提供 action 时不渲染行动区域', () => {
    const { container } = render(<EmptyState title="暂无数据" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('action 按钮可触发点击回调', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="暂无数据"
        action={<button onClick={onClick}>新建</button>}
      />
    )
    fireEvent.click(screen.getByText('新建'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('同时提供 icon、description、action 时全部渲染', () => {
    render(
      <EmptyState
        title="空空如也"
        description="请添加内容"
        icon={<span data-testid="icon">📁</span>}
        action={<button>添加</button>}
      />
    )
    expect(screen.getByText('空空如也')).toBeInTheDocument()
    expect(screen.getByText('请添加内容')).toBeInTheDocument()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('添加')).toBeInTheDocument()
  })
})
