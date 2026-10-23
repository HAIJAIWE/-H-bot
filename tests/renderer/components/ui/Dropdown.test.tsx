// tests/renderer/components/ui/Dropdown.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Dropdown } from '@renderer/components/ui/Dropdown'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

const options = [
  { value: 'a', label: '选项 A' },
  { value: 'b', label: '选项 B' },
  { value: 'c', label: '选项 C' },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Dropdown - 基础渲染', () => {
  it('渲染选中值的 label', () => {
    render(<Dropdown value="b" onChange={() => {}} options={options} />)
    expect(screen.getByText('选项 B')).toBeInTheDocument()
  })

  it('无选中值时显示 placeholder', () => {
    render(
      <Dropdown value="" onChange={() => {}} options={options} placeholder="请选择" />
    )
    expect(screen.getByText('请选择')).toBeInTheDocument()
  })

  it('无选中值且无 placeholder 时显示空文本', () => {
    render(<Dropdown value="" onChange={() => {}} options={options} />)
    const btn = screen.getByRole('combobox')
    expect(btn).toBeInTheDocument()
  })

  it('渲染所有选项（展开后可见）', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} />)
    fireEvent.click(screen.getByRole('combobox'))
    // 选项 B、C 仅在展开后作为列表项出现
    expect(screen.getByText('选项 B')).toBeInTheDocument()
    expect(screen.getByText('选项 C')).toBeInTheDocument()
    // 选项 A 既在按钮显示区（span）又在选项列表（button）中，共 2 处
    expect(screen.getAllByText('选项 A')).toHaveLength(2)
  })

  it('按钮类型为 button', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('type', 'button')
  })
})

describe('Dropdown - 展开与收起', () => {
  it('点击按钮展开选项列表', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} />)
    // 初始状态下选项 B 不在按钮内（按钮内显示的是选项 A），需展开后才能看到选项 B 作为可点击选项
    // 注意：选项 A 的 label 与按钮显示文本相同，所以用选项 B 判断
    expect(screen.queryByText('选项 C')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('选项 C')).toBeInTheDocument()
  })

  it('展开后再次点击按钮收起选项列表', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} />)
    const btn = screen.getByRole('combobox')
    fireEvent.click(btn)
    expect(screen.getByText('选项 C')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByText('选项 C')).not.toBeInTheDocument()
  })

  it('点击外部区域收起选项列表', () => {
    render(
      <div>
        <div data-testid="outside">外部区域</div>
        <Dropdown value="a" onChange={() => {}} options={options} />
      </div>
    )
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('选项 C')).toBeInTheDocument()
    // 模拟点击外部
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByText('选项 C')).not.toBeInTheDocument()
  })
})

describe('Dropdown - 选项选择', () => {
  it('点击选项触发 onChange 并传入对应 value', () => {
    const onChange = vi.fn()
    render(<Dropdown value="a" onChange={onChange} options={options} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('选项 C'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('选择选项后自动收起列表', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('选项 B'))
    // 收起后选项 C 不再可见
    expect(screen.queryByText('选项 C')).not.toBeInTheDocument()
  })

  it('当前选中项在列表中带高亮类', () => {
    render(<Dropdown value="b" onChange={() => {}} options={options} />)
    fireEvent.click(screen.getByRole('combobox'))
    // 选项 B 在按钮显示区（span）和选项列表（button）中都有，取列表中的 button 元素
    const allBs = screen.getAllByText('选项 B')
    const selectedOpt = allBs.find((el) => el.tagName === 'BUTTON') as HTMLElement
    expect(selectedOpt.className).toContain('bg-zinc-700')
  })
})

describe('Dropdown - 禁用状态', () => {
  it('disabled 时按钮不可点击展开', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} disabled />)
    const btn = screen.getByRole('combobox')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(screen.queryByText('选项 C')).not.toBeInTheDocument()
  })

  it('disabled 时按钮有 disabled 属性', () => {
    render(<Dropdown value="a" onChange={() => {}} options={options} disabled />)
    expect(screen.getByRole('combobox')).toHaveAttribute('disabled')
  })
})
