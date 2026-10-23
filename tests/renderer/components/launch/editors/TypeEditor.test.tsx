// tests/renderer/components/launch/editors/TypeEditor.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  TypeEditor,
  IntEditor,
  StringEditor,
  BoolEditor,
  JsonEditor,
  ListEditor,
  SetEditor,
} from '@renderer/components/launch/editors/TypeEditor'
import { BaseType, TypeRegistry } from '@shared/types/typeSystem'
import type { FieldConfig } from '@shared/types/typeSystem'

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

// ── 辅助：构造 FieldConfig ──
function makeField(overrides: Partial<FieldConfig> = {}): FieldConfig {
  return {
    type: BaseType.String,
    ...overrides,
  }
}

describe('TypeEditor - 基础类型渲染', () => {
  it('Int 类型渲染 number input', () => {
    render(<TypeEditor value={0} onChange={vi.fn()} field={makeField({ type: BaseType.Int })} />)
    expect(document.querySelector('input[type="number"]')).not.toBeNull()
  })

  it('String 类型渲染 text input', () => {
    render(<TypeEditor value="abc" onChange={vi.fn()} field={makeField({ type: BaseType.String })} />)
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('abc')
  })

  it('Text 类型渲染 textarea', () => {
    render(<TypeEditor value="long text" onChange={vi.fn()} field={makeField({ type: BaseType.Text })} />)
    const ta = document.querySelector('textarea')
    expect(ta).not.toBeNull()
    expect((ta as HTMLTextAreaElement).value).toBe('long text')
  })

  it('Bool 类型渲染 Switch', () => {
    render(<TypeEditor value={true} onChange={vi.fn()} field={makeField({ type: BaseType.Bool })} />)
    const sw = screen.getByRole('switch')
    expect(sw).toBeInTheDocument()
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  it('DateTime 类型渲染 datetime-local input', () => {
    render(<TypeEditor value="2024-01-01T10:00" onChange={vi.fn()} field={makeField({ type: BaseType.DateTime })} />)
    expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull()
  })

  it('Color 类型渲染 color input', () => {
    render(<TypeEditor value="#ff0000" onChange={vi.fn()} field={makeField({ type: BaseType.Color })} />)
    const input = document.querySelector('input[type="color"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('#ff0000')
  })

  it('Url 类型渲染 url input + "打开"链接', () => {
    render(<TypeEditor value="https://example.com" onChange={vi.fn()} field={makeField({ type: BaseType.Url })} />)
    expect(document.querySelector('input[type="url"]')).not.toBeNull()
    expect(screen.getByText('打开')).toBeInTheDocument()
  })

  it('Url 类型 value 为空时不显示"打开"链接', () => {
    render(<TypeEditor value="" onChange={vi.fn()} field={makeField({ type: BaseType.Url })} />)
    expect(screen.queryByText('打开')).not.toBeInTheDocument()
  })

  it('Image 类型渲染 text input', () => {
    render(<TypeEditor value="http://img.png" onChange={vi.fn()} field={makeField({ type: BaseType.Image })} />)
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('http://img.png')
  })

  it('Enum 类型渲染 Dropdown（含选项）', () => {
    render(
      <TypeEditor
        value=""
        onChange={vi.fn()}
        field={makeField({ type: BaseType.Enum, enumValues: ['普通', '稀有'] })}
      />
    )
    // Dropdown 按钮显示 placeholder
    expect(screen.getByText('请选择')).toBeInTheDocument()
    // 点击展开
    fireEvent.click(screen.getByText('请选择'))
    expect(screen.getByText('普通')).toBeInTheDocument()
    expect(screen.getByText('稀有')).toBeInTheDocument()
  })
})

describe('TypeEditor - 值编辑与 onChange', () => {
  it('Int 类型 onChange 调用 parseInt', () => {
    const onChange = vi.fn()
    render(<TypeEditor value={0} onChange={onChange} field={makeField({ type: BaseType.Int })} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '42' } })
    expect(onChange).toHaveBeenCalledWith(42)
  })

  it('Int 类型输入非数字时 onChange 返回 0', () => {
    const onChange = vi.fn()
    render(<TypeEditor value={0} onChange={onChange} field={makeField({ type: BaseType.Int })} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    // 输入空字符串：parseInt('') === NaN，触发 || 0
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('String 类型 onChange 透传输入值', () => {
    const onChange = vi.fn()
    render(<TypeEditor value="" onChange={onChange} field={makeField({ type: BaseType.String })} />)
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('Bool 类型 onChange 透传 checked', () => {
    const onChange = vi.fn()
    render(<TypeEditor value={false} onChange={onChange} field={makeField({ type: BaseType.Bool })} />)
    const sw = screen.getByRole('switch')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('Float 类型 onChange 应用 precision 四舍五入', () => {
    const onChange = vi.fn()
    render(
      <TypeEditor
        value={0}
        onChange={onChange}
        field={makeField({ type: BaseType.Float, step: 0.1, precision: 2 })}
      />
    )
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '3.14159' } })
    // toFixed(2) = "3.14" → parseFloat = 3.14
    expect(onChange).toHaveBeenCalledWith(3.14)
  })

  it('DateTime 类型 value 为空时 input 值为空', () => {
    render(<TypeEditor value="" onChange={vi.fn()} field={makeField({ type: BaseType.DateTime })} />)
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('Color 类型 onChange 透传颜色值', () => {
    const onChange = vi.fn()
    render(<TypeEditor value="#000000" onChange={onChange} field={makeField({ type: BaseType.Color })} />)
    const input = document.querySelector('input[type="color"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '#ffffff' } })
    expect(onChange).toHaveBeenCalledWith('#ffffff')
  })

  it('未知 type 渲染 CompositeEditor 占位（显示类型名）', () => {
    // 非 BaseType 的类型名会进入 CompositeEditor 分支
    // TypeRegistry 未注册时返回占位 div 显示 typeName
    render(<TypeEditor value="x" onChange={vi.fn()} field={{ type: 'unknown_type' as any }} />)
    expect(screen.getByText('unknown_type')).toBeInTheDocument()
  })
})

describe('TypeEditor - 空值处理', () => {
  it('StringEditor 接收 null 时显示空字符串', () => {
    render(<StringEditor value={null as any} onChange={vi.fn()} field={makeField()} />)
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('IntEditor 接收非数字时 value 回退为 0', () => {
    render(<IntEditor value={'abc' as any} onChange={vi.fn()} field={makeField({ type: BaseType.Int })} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    expect(input.value).toBe('0')
  })

  it('BoolEditor 接收 falsy 值时 Switch 未选中', () => {
    render(<BoolEditor value={0 as any} onChange={vi.fn()} field={makeField({ type: BaseType.Bool })} />)
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('JsonEditor 接收 undefined 时显示 "{}"', () => {
    render(<JsonEditor value={undefined} onChange={vi.fn()} field={makeField({ type: BaseType.Json })} />)
    const ta = document.querySelector('textarea') as HTMLTextAreaElement
    // JSON.stringify(undefined ?? {}) = JSON.stringify({}) = '{}'
    expect(ta.value).toBe('{}')
  })

  it('ListEditor 接收 undefined 时显示"+ 添加"按钮', () => {
    render(<ListEditor value={undefined} onChange={vi.fn()} field={makeField({ type: BaseType.List, itemType: { type: BaseType.String } })} />)
    expect(screen.getByText('+ 添加')).toBeInTheDocument()
  })

  it('SetEditor 接收 undefined 时不渲染任何标签', () => {
    render(<SetEditor value={undefined} onChange={vi.fn()} field={makeField({ type: BaseType.Set })} />)
    // SetEditor 仅渲染输入框（用于添加新 tag），无已有 tag
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
  })
})

describe('TypeEditor - 复合类型', () => {
  beforeEach(() => {
    TypeRegistry.registerDefaults()
  })

  it('复合类型在 TypeRegistry 未注册时显示占位 div', () => {
    // 使用未注册的类型名
    render(<TypeEditor value={{}} onChange={vi.fn()} field={{ type: 'not_registered_type' as any }} />)
    // CompositeEditor 在 def 为 null 时返回 <div>{typeName}</div>
    expect(screen.getByText('not_registered_type')).toBeInTheDocument()
  })

  it('复合类型注册后渲染其字段标签', () => {
    // 'equipment' 是 registerDefaults 中注册的复合类型
    render(
      <TypeEditor
        value={{}}
        onChange={vi.fn()}
        field={{ type: 'equipment' as any }}
      />
    )
    // equipment 复合类型有"装备"标签 + 各字段标签（名称/图标/等级...）
    expect(screen.getByText('装备')).toBeInTheDocument()
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('等级')).toBeInTheDocument()
  })
})
