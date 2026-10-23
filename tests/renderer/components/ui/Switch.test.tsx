// tests/renderer/components/ui/Switch.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Switch } from '@renderer/components/ui/Switch'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Switch - 基础渲染', () => {
  it('渲染 switch 角色', () => {
    render(<Switch checked={false} onChange={vi.fn()} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('checked=false 时 aria-checked 为 false', () => {
    render(<Switch checked={false} onChange={vi.fn()} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('checked=true 时 aria-checked 为 true', () => {
    render(<Switch checked={true} onChange={vi.fn()} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('传入 label 时显示标签文字', () => {
    render(<Switch checked={false} onChange={vi.fn()} label="开启通知" />)
    expect(screen.getByText('开启通知')).toBeInTheDocument()
  })

  it('无 label 时只渲染开关', () => {
    render(<Switch checked={false} onChange={vi.fn()} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
    expect(document.querySelector('label')).toBeInTheDocument()
  })
})

describe('Switch - 交互', () => {
  it('checked=false 时点击触发 onChange(true)', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('checked=true 时点击触发 onChange(false)', () => {
    const onChange = vi.fn()
    render(<Switch checked={true} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('点击 label 文字也触发 onChange', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} label="开启通知" />)
    fireEvent.click(screen.getByText('开启通知'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Switch - 禁用状态', () => {
  it('disabled 时按钮被禁用', () => {
    render(<Switch checked={false} onChange={vi.fn()} disabled />)
    expect(screen.getByRole('switch')).toBeDisabled()
  })

  it('disabled 时点击不触发 onChange', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} disabled />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disabled 时点击 label 不触发 onChange', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} label="通知" disabled />)
    fireEvent.click(screen.getByText('通知'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
