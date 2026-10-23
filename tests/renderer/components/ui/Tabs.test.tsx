// tests/renderer/components/ui/Tabs.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Tabs } from '@renderer/components/ui/Tabs'
import type { TabItem } from '@renderer/components/ui/Tabs'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

const tabs: TabItem[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Tabs - 基础渲染', () => {
  it('渲染所有 tab 标签', () => {
    render(<Tabs tabs={tabs} active="all" onChange={() => {}} />)
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('空 tabs 列表不渲染任何按钮', () => {
    const { container } = render(<Tabs tabs={[]} active="" onChange={() => {}} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('单个 tab 正常渲染', () => {
    render(<Tabs tabs={[{ key: 'only', label: '唯一' }]} active="only" onChange={() => {}} />)
    expect(screen.getByText('唯一')).toBeInTheDocument()
  })

  it('所有 tab 按钮类型为 button（避免表单提交）', () => {
    const { container } = render(<Tabs tabs={tabs} active="all" onChange={() => {}} />)
    // 注：tab 元素使用 role="tab" 覆盖了 button 的隐式 role，按 DOM 元素查询
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('type', 'button')
    })
  })
})

describe('Tabs - 激活态', () => {
  it('active 对应的 tab 标记为激活态', () => {
    render(<Tabs tabs={tabs} active="active" onChange={() => {}} />)
    const activeBtn = screen.getByText('进行中').closest('button') as HTMLElement
    expect(activeBtn.className).toContain('border-blue-500')
  })

  it('非激活态 tab 不带激活高亮类', () => {
    render(<Tabs tabs={tabs} active="active" onChange={() => {}} />)
    const inactiveBtn = screen.getByText('全部').closest('button') as HTMLElement
    expect(inactiveBtn.className).not.toContain('border-blue-500')
  })

  it('active 不匹配任何 tab key 时所有 tab 均非激活', () => {
    const { container } = render(<Tabs tabs={tabs} active="not-exist" onChange={() => {}} />)
    // 注：tab 元素使用 role="tab" 覆盖了 button 的隐式 role，按 DOM 元素查询
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn) => {
      expect(btn.className).not.toContain('border-blue-500')
    })
  })
})

describe('Tabs - 切换交互', () => {
  it('点击 tab 触发 onChange 并带正确 key', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} active="all" onChange={onChange} />)
    fireEvent.click(screen.getByText('已完成'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('done')
  })

  it('点击当前激活 tab 也触发 onChange', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} active="all" onChange={onChange} />)
    fireEvent.click(screen.getByText('全部'))
    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('不同 tab 点击传入不同 key', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} active="all" onChange={onChange} />)
    fireEvent.click(screen.getByText('进行中'))
    expect(onChange).toHaveBeenLastCalledWith('active')
    fireEvent.click(screen.getByText('已完成'))
    expect(onChange).toHaveBeenLastCalledWith('done')
  })
})

describe('Tabs - icon 与样式', () => {
  it('tab 包含 icon 时渲染 icon 节点', () => {
    render(
      <Tabs
        tabs={[{ key: 'a', label: '带图标', icon: <span data-testid="icon">⭐</span> }]}
        active="a"
        onChange={() => {}}
      />
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('附加 className 被合并到容器', () => {
    const { container } = render(
      <Tabs tabs={tabs} active="all" onChange={() => {}} className="custom-class" />
    )
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
