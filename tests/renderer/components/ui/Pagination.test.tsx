// tests/renderer/components/ui/Pagination.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Pagination } from '@renderer/components/ui/Pagination'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

/** 读取 Pagination 容器的完整文本（含嵌套 span） */
function getPaginationText(): string {
  // Pagination 根 div 包含所有内容；取第一个 div 的 textContent
  const root = document.body.querySelector('div.flex.items-center')
  return root?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Pagination - 基础渲染', () => {
  it('显示当前页和总页数', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />)
    expect(getPaginationText()).toContain('第')
    expect(getPaginationText()).toContain('2')
    expect(getPaginationText()).toContain('5')
    expect(getPaginationText()).toContain('页')
  })

  it('渲染上一页和下一页按钮', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />)
    expect(screen.getByText('上一页')).toBeInTheDocument()
    expect(screen.getByText('下一页')).toBeInTheDocument()
  })

  it('渲染跳页输入框', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />)
    // 跳页输入框 placeholder 是当前页码
    expect(screen.getByPlaceholderText('2')).toBeInTheDocument()
  })
})

describe('Pagination - 单页状态', () => {
  it('totalPages=1 时不渲染翻页按钮', () => {
    render(<Pagination page={1} totalPages={1} onPageChange={() => {}} />)
    expect(screen.queryByText('上一页')).not.toBeInTheDocument()
    expect(screen.queryByText('下一页')).not.toBeInTheDocument()
  })

  it('totalPages=0 时不渲染翻页按钮', () => {
    render(<Pagination page={0} totalPages={0} onPageChange={() => {}} />)
    expect(screen.queryByText('上一页')).not.toBeInTheDocument()
  })

  it('单页状态仍显示页码信息', () => {
    render(<Pagination page={1} totalPages={1} onPageChange={() => {}} />)
    expect(getPaginationText()).toContain('1')
  })
})

describe('Pagination - 禁用状态', () => {
  it('第一页时上一页按钮被禁用', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={() => {}} />)
    expect(screen.getByText('上一页')).toBeDisabled()
  })

  it('最后一页时下一页按钮被禁用', () => {
    render(<Pagination page={5} totalPages={5} onPageChange={() => {}} />)
    expect(screen.getByText('下一页')).toBeDisabled()
  })

  it('中间页时上一页和下一页均可用', () => {
    render(<Pagination page={3} totalPages={5} onPageChange={() => {}} />)
    expect(screen.getByText('上一页')).not.toBeDisabled()
    expect(screen.getByText('下一页')).not.toBeDisabled()
  })
})

describe('Pagination - 翻页交互', () => {
  it('点击上一页触发 onPageChange 并传入 page-1', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByText('上一页'))
    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('点击下一页触发 onPageChange 并传入 page+1', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByText('下一页'))
    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('第一页点击上一页不触发回调（按钮禁用）', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByText('上一页'))
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('最后一页点击下一页不触发回调（按钮禁用）', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={5} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByText('下一页'))
    expect(onPageChange).not.toHaveBeenCalled()
  })
})

describe('Pagination - 跳页', () => {
  it('输入有效页码并按 Enter 触发跳页', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />)
    const input = screen.getByPlaceholderText('1')
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('输入页码大于总页数时不触发跳页', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />)
    const input = screen.getByPlaceholderText('1')
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('输入页码小于 1 时不触发跳页', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />)
    const input = screen.getByPlaceholderText('2')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('输入非数字时不触发跳页', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />)
    const input = screen.getByPlaceholderText('1')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('失焦时触发跳页（onBlur）', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />)
    const input = screen.getByPlaceholderText('1')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('跳页后清空输入框', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={() => {}} />)
    const input = screen.getByPlaceholderText('1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('')
  })
})
