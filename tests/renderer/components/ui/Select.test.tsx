// tests/renderer/components/ui/Select.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Select } from '@renderer/components/ui/Select'

const options = [
  { value: 'a', label: '选项A' },
  { value: 'b', label: '选项B' },
  { value: 'c', label: '选项C' },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Select - 基础渲染', () => {
  it('无选中值时显示 placeholder', () => {
    render(<Select value="" onChange={vi.fn()} options={options} placeholder="请选择" />)
    expect(screen.getByText('请选择')).toBeInTheDocument()
  })

  it('显示选中值的 label', () => {
    render(<Select value="b" onChange={vi.fn()} options={options} />)
    expect(screen.getByText('选项B')).toBeInTheDocument()
  })

  it('渲染触发按钮', () => {
    render(<Select value="" onChange={vi.fn()} options={options} placeholder="请选择" />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('未匹配任何选项时显示 placeholder', () => {
    render(<Select value="x" onChange={vi.fn()} options={options} placeholder="请选择" />)
    expect(screen.getByText('请选择')).toBeInTheDocument()
  })
})

describe('Select - 下拉交互', () => {
  it('点击按钮打开下拉列表', () => {
    render(<Select value="" onChange={vi.fn()} options={options} placeholder="请选择" />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('选项A')).toBeInTheDocument()
    expect(screen.getByText('选项B')).toBeInTheDocument()
    expect(screen.getByText('选项C')).toBeInTheDocument()
  })

  it('点击选项触发 onChange', () => {
    const onChange = vi.fn()
    render(<Select value="" onChange={onChange} options={options} placeholder="请选择" />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('选项A'))
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('选择后下拉列表关闭', () => {
    render(<Select value="" onChange={vi.fn()} options={options} placeholder="请选择" />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('选项A')).toBeInTheDocument()
    fireEvent.click(screen.getByText('选项B'))
    expect(screen.queryByText('选项A')).not.toBeInTheDocument()
    expect(screen.queryByText('选项C')).not.toBeInTheDocument()
  })

  it('点击外部关闭下拉列表', () => {
    render(
      <div>
        <Select value="" onChange={vi.fn()} options={options} placeholder="请选择" />
        <div data-testid="outside">外部</div>
      </div>
    )
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('选项A')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByText('选项A')).not.toBeInTheDocument()
  })
})

describe('Select - 禁用状态', () => {
  it('disabled 时按钮被禁用', () => {
    render(<Select value="" onChange={vi.fn()} options={options} placeholder="请选择" disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('disabled 时点击不打开下拉', () => {
    render(<Select value="" onChange={vi.fn()} options={options} placeholder="请选择" disabled />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByText('选项A')).not.toBeInTheDocument()
  })
})
