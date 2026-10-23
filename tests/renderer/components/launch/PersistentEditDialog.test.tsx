// tests/renderer/components/launch/PersistentEditDialog.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PersistentEditDialog } from '@renderer/components/launch/PersistentEditDialog'
import type { FieldType } from '@renderer/components/launch/dataBrowserConstants'

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

// ── 辅助：构造 persistentEdit 状态 ──
function makeState(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    key: 'user_1001:nickname',
    label: '昵称',
    type: 'text' as FieldType,
    value: '张三',
    rowid: 1,
    filePath: '/tmp/test.json',
    tableName: '_persistent',
    ...overrides,
  }
}

function makeProps(stateOverrides: Record<string, unknown> = {}, propsOverrides: Record<string, unknown> = {}) {
  return {
    persistentEdit: makeState(stateOverrides),
    persistentEditValue: '',
    persistentEditSaving: false,
    dynamicFieldEnums: {},
    onClose: vi.fn(),
    onValueChange: vi.fn(),
    onSave: vi.fn(),
    ...propsOverrides,
  }
}

describe('PersistentEditDialog - 渲染', () => {
  it('open=false 时不渲染', () => {
    render(<PersistentEditDialog {...makeProps({ open: false })} />)
    expect(screen.queryByText(/编辑 ·/)).not.toBeInTheDocument()
  })

  it('open=true 显示"编辑 · {label}"标题', () => {
    render(<PersistentEditDialog {...makeProps({ label: '昵称' })} />)
    expect(screen.getByText('编辑 · 昵称')).toBeInTheDocument()
  })

  it('显示 key 文本', () => {
    render(<PersistentEditDialog {...makeProps({ key: 'user_1001:level' })} />)
    expect(screen.getByText('user_1001:level')).toBeInTheDocument()
  })

  it('type=number 渲染 number input', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'number' })} />)
    const input = document.querySelector('input[type="number"]')
    expect(input).not.toBeNull()
  })

  it('type=text 渲染 text input', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'text' })} />)
    const input = document.querySelector('input[type="text"]')
    expect(input).not.toBeNull()
  })

  it('type=boolean 渲染"是""否"两个按钮', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'boolean' })} />)
    expect(screen.getByText('是')).toBeInTheDocument()
    expect(screen.getByText('否')).toBeInTheDocument()
  })

  it('type=date 渲染 date input', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'date' })} />)
    const input = document.querySelector('input[type="date"]')
    expect(input).not.toBeNull()
  })

  it('type=datetime 渲染 datetime-local input', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'datetime' })} />)
    const input = document.querySelector('input[type="datetime-local"]')
    expect(input).not.toBeNull()
  })

  it('type=json 渲染 textarea', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'json' })} />)
    expect(document.querySelector('textarea')).not.toBeNull()
  })

  it('type=enum 渲染 Dropdown（显示占位文本）', () => {
    render(<PersistentEditDialog {...makeProps({ type: 'enum' })} />)
    // Dropdown 默认 placeholder="请选择"
    expect(screen.getByText('请选择')).toBeInTheDocument()
  })

  it('显示"取消"和"确认保存"按钮', () => {
    render(<PersistentEditDialog {...makeProps()} />)
    expect(screen.getByText('取消')).toBeInTheDocument()
    expect(screen.getByText('确认保存')).toBeInTheDocument()
  })
})

describe('PersistentEditDialog - 交互', () => {
  it('number 类型输入触发 onValueChange', () => {
    const onValueChange = vi.fn()
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'number' }, { onValueChange })}
      />
    )
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '99' } })
    expect(onValueChange).toHaveBeenCalledWith('99')
  })

  it('text 类型输入触发 onValueChange', () => {
    const onValueChange = vi.fn()
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'text' }, { onValueChange })}
      />
    )
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '李四' } })
    expect(onValueChange).toHaveBeenCalledWith('李四')
  })

  it('boolean 类型点击"是"触发 onValueChange("true")', () => {
    const onValueChange = vi.fn()
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'boolean' }, { onValueChange })}
      />
    )
    fireEvent.click(screen.getByText('是'))
    expect(onValueChange).toHaveBeenCalledWith('true')
  })

  it('boolean 类型点击"否"触发 onValueChange("false")', () => {
    const onValueChange = vi.fn()
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'boolean' }, { onValueChange })}
      />
    )
    fireEvent.click(screen.getByText('否'))
    expect(onValueChange).toHaveBeenCalledWith('false')
  })

  it('number 类型按 Enter 触发 onSave', () => {
    const onSave = vi.fn()
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'number' }, { onSave })}
      />
    )
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('text 类型按 Enter 触发 onSave', () => {
    const onSave = vi.fn()
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'text' }, { onSave })}
      />
    )
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('点击"确认保存"调用 onSave', () => {
    const onSave = vi.fn()
    render(<PersistentEditDialog {...makeProps({}, { onSave })} />)
    fireEvent.click(screen.getByText('确认保存'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('点击"取消"调用 onClose', () => {
    const onClose = vi.fn()
    render(<PersistentEditDialog {...makeProps({}, { onClose })} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击遮罩（外层 fixed 容器）触发 onClose', () => {
    const onClose = vi.fn()
    render(<PersistentEditDialog {...makeProps({}, { onClose })} />)
    // 外层遮罩：fixed inset-0 z-50
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击弹窗内容不触发 onClose（stopPropagation）', () => {
    const onClose = vi.fn()
    render(<PersistentEditDialog {...makeProps({}, { onClose })} />)
    // 内层弹窗容器：bg-zinc-900 border ...
    const dialog = document.querySelector('.bg-zinc-900.border') as HTMLElement
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('PersistentEditDialog - 保存状态', () => {
  it('persistentEditSaving=true 时按钮显示"保存中..."且禁用', () => {
    render(<PersistentEditDialog {...makeProps({}, { persistentEditSaving: true })} />)
    const btn = screen.getByText('保存中...')
    expect(btn).toBeDisabled()
  })

  it('persistentEditSaving=false 时按钮显示"确认保存"且可点击', () => {
    render(<PersistentEditDialog {...makeProps({}, { persistentEditSaving: false })} />)
    const btn = screen.getByText('确认保存')
    expect(btn).not.toBeDisabled()
  })

  it('enum 类型显示 dynamicFieldEnums 提供的选项', () => {
    render(
      <PersistentEditDialog
        {...makeProps({ type: 'enum', key: 'user_1001:permission' })}
        {...{
          dynamicFieldEnums: {
            permission: [
              { value: 'admin', label: '管理员' },
              { value: 'member', label: '普通成员' },
            ],
          },
        }}
      />
    )
    // 点击 Dropdown 按钮展开
    fireEvent.click(screen.getByText('请选择'))
    expect(screen.getByText('管理员')).toBeInTheDocument()
    expect(screen.getByText('普通成员')).toBeInTheDocument()
  })
})
