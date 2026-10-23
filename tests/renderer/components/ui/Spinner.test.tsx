// tests/renderer/components/ui/Spinner.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Spinner } from '@renderer/components/ui/Spinner'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Spinner - 基础渲染', () => {
  it('渲染 status 角色', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('aria-label 为"加载中"', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '加载中')
  })

  it('渲染为 span 元素', () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('span')).not.toBeNull()
  })

  it('包含旋转动画类', () => {
    render(<Spinner />)
    expect(screen.getByRole('status').className).toContain('animate-spin')
  })
})

describe('Spinner - 尺寸变体', () => {
  it('sm 尺寸正常渲染', () => {
    render(<Spinner size="sm" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('md 尺寸正常渲染', () => {
    render(<Spinner size="md" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('lg 尺寸正常渲染', () => {
    render(<Spinner size="lg" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('默认使用 md 尺寸', () => {
    render(<Spinner />)
    expect(screen.getByRole('status').className).toContain('w-4')
  })

  it('不同尺寸生成不同样式', () => {
    const { rerender } = render(<Spinner size="sm" />)
    const smClass = screen.getByRole('status').className
    rerender(<Spinner size="lg" />)
    const lgClass = screen.getByRole('status').className
    expect(smClass).not.toBe(lgClass)
  })
})

describe('Spinner - 自定义样式', () => {
  it('自定义 className 被合并', () => {
    render(<Spinner className="my-custom" />)
    expect(screen.getByRole('status').className).toContain('my-custom')
  })
})
