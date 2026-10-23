// tests/renderer/components/launch/UidEditDialog.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { UidEditDialog } from '@renderer/components/launch/UidEditDialog'

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

// ── 辅助：构造 props ──
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    uidEditTarget: { uid: '1001', openid: 'openid-abcdef123456' },
    uidEditValue: '',
    uidEditError: '',
    uidEditSaving: false,
    onClose: vi.fn(),
    onValueChange: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  }
}

describe('UidEditDialog - 渲染', () => {
  it('open=false 时不渲染', () => {
    render(<UidEditDialog {...makeProps({ open: false })} />)
    expect(screen.queryByText('编辑 UID')).not.toBeInTheDocument()
  })

  it('open=true 时显示标题"编辑 UID"', () => {
    render(<UidEditDialog {...makeProps()} />)
    expect(screen.getByText('编辑 UID')).toBeInTheDocument()
  })

  it('显示当前 UID', () => {
    render(<UidEditDialog {...makeProps()} />)
    expect(screen.getByText('1001')).toBeInTheDocument()
  })

  it('uidEditTarget 为 null 时不崩溃且 UID 文本为空', () => {
    render(<UidEditDialog {...makeProps({ uidEditTarget: null })} />)
    // 标题仍渲染
    expect(screen.getByText('编辑 UID')).toBeInTheDocument()
    // "当前 UID:" 标签存在
    expect(screen.getByText(/当前 UID/)).toBeInTheDocument()
  })

  it('有 openid 时显示 openid 前缀（截断）', () => {
    render(<UidEditDialog {...makeProps()} />)
    // openid 截断后只显示前 12 字符 + "..."
    // 'openid-abcdef123456'.substring(0, 12) === 'openid-abcde'
    expect(screen.getByText('openid-abcde...')).toBeInTheDocument()
  })

  it('无 openid 时显示警告文案', () => {
    render(
      <UidEditDialog
        {...makeProps({ uidEditTarget: { uid: '1001', openid: null } })}
      />
    )
    expect(screen.getByText('该玩家暂无可用的 openid 映射')).toBeInTheDocument()
  })

  it('输入框显示 uidEditValue', () => {
    render(<UidEditDialog {...makeProps({ uidEditValue: '9999' })} />)
    const input = screen.getByPlaceholderText('输入新的 UID...') as HTMLInputElement
    expect(input.value).toBe('9999')
  })

  it('"新 UID" 标签存在', () => {
    render(<UidEditDialog {...makeProps()} />)
    expect(screen.getByText('新 UID')).toBeInTheDocument()
  })
})

describe('UidEditDialog - 交互', () => {
  it('输入触发 onValueChange', () => {
    const onValueChange = vi.fn()
    render(<UidEditDialog {...makeProps({ onValueChange })} />)
    const input = screen.getByPlaceholderText('输入新的 UID...')
    fireEvent.change(input, { target: { value: '8888' } })
    expect(onValueChange).toHaveBeenCalledWith('8888')
  })

  it('点击"确认保存"调用 onSave', () => {
    const onSave = vi.fn()
    render(<UidEditDialog {...makeProps({ onSave })} />)
    fireEvent.click(screen.getByText('确认保存'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('点击"取消"调用 onClose', () => {
    const onClose = vi.fn()
    render(<UidEditDialog {...makeProps({ onClose })} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按 Enter 触发 onSave', () => {
    const onSave = vi.fn()
    render(<UidEditDialog {...makeProps({ onSave })} />)
    const input = screen.getByPlaceholderText('输入新的 UID...')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('点击右上角 × 调用 onClose', () => {
    const onClose = vi.fn()
    render(<UidEditDialog {...makeProps({ onClose })} />)
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('UidEditDialog - 状态', () => {
  it('uidEditError 不为空时显示错误信息', () => {
    render(<UidEditDialog {...makeProps({ uidEditError: 'UID 已存在' })} />)
    expect(screen.getByText('UID 已存在')).toBeInTheDocument()
  })

  it('uidEditSaving=true 时按钮显示"保存中..."且禁用', () => {
    render(<UidEditDialog {...makeProps({ uidEditSaving: true })} />)
    const saveBtn = screen.getByText('保存中...')
    expect(saveBtn).toBeDisabled()
  })

  it('uidEditSaving=false 时按钮显示"确认保存"且可点击', () => {
    render(<UidEditDialog {...makeProps({ uidEditSaving: false })} />)
    const saveBtn = screen.getByText('确认保存')
    expect(saveBtn).not.toBeDisabled()
  })
})
