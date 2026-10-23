import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { KeyboardEditor } from '../../../../src/renderer/src/components/blocks/KeyboardEditor'
import { createEmptyKeyboard } from '../../../../src/shared/types/keyboard'
import type { InlineKeyboard } from '../../../../src/shared/types/keyboard'

afterEach(() => {
  cleanup()
})

describe('KeyboardEditor', () => {
  it('可视化模式默认渲染行和按钮', () => {
    const keyboard = createEmptyKeyboard()
    render(<KeyboardEditor value={keyboard} onChange={vi.fn()} />)
    expect(screen.getByText(/第 1 行/)).toBeInTheDocument()
    expect(screen.getByText('按钮 1')).toBeInTheDocument()
  })

  it('点击"+ 添加行"新增一行', () => {
    const keyboard = createEmptyKeyboard()
    const onChange = vi.fn()
    render(<KeyboardEditor value={keyboard} onChange={onChange} />)
    fireEvent.click(screen.getByText('+ 添加行'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      rows: expect.arrayContaining([expect.anything(), expect.anything()])
    }))
  })

  it('点击"删除行"移除对应行', () => {
    const keyboard = { rows: [{ buttons: [{ id: '1', render_data: { label: 'A' }, action: { type: 2, permission: { type: 2 }, data: '' } }] }, { buttons: [{ id: '2', render_data: { label: 'B' }, action: { type: 2, permission: { type: 2 }, data: '' } }] }] } as InlineKeyboard
    const onChange = vi.fn()
    render(<KeyboardEditor value={keyboard} onChange={onChange} />)
    const deleteButtons = screen.getAllByText('删除行')
    fireEvent.click(deleteButtons[0])
    expect(onChange).toHaveBeenCalledWith({ rows: [expect.objectContaining({ buttons: expect.arrayContaining([expect.objectContaining({ id: '2' })]) })] })
  })

  it('修改按钮文字触发 onChange', () => {
    const keyboard = createEmptyKeyboard()
    const onChange = vi.fn()
    render(<KeyboardEditor value={keyboard} onChange={onChange} />)
    const input = screen.getByDisplayValue('新按钮')
    fireEvent.change(input, { target: { value: '确认' } })
    expect(onChange).toHaveBeenCalled()
    const calledWith = onChange.mock.calls[0][0]
    expect(calledWith.rows[0].buttons[0].render_data.label).toBe('确认')
  })

  it('切换到 JSON 模式显示 JSON 文本', () => {
    const keyboard = { rows: [{ buttons: [{ id: '1', render_data: { label: '测试' }, action: { type: 2, permission: { type: 2 }, data: '/ok' } }] }] } as InlineKeyboard
    render(<KeyboardEditor value={keyboard} onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('JSON 编辑'))
    expect(screen.getByDisplayValue(/"label": "测试"/)).toBeInTheDocument()
  })

  it('JSON 模式编辑有效 JSON 触发 onChange', () => {
    const keyboard = createEmptyKeyboard()
    const onChange = vi.fn()
    render(<KeyboardEditor value={keyboard} onChange={onChange} />)
    fireEvent.click(screen.getByText('JSON 编辑'))
    const textarea = screen.getByRole('textbox')
    const newJson = JSON.stringify({ rows: [{ buttons: [{ id: 'x', render_data: { label: 'Y' }, action: { type: 0, permission: { type: 2 }, data: 'https://a.com' } }] }] })
    fireEvent.change(textarea, { target: { value: newJson } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rows: expect.any(Array) }))
  })

  it('行数达到 5 时不显示"+ 添加行"', () => {
    const keyboard = { rows: Array(5).fill(null).map(() => ({ buttons: [{ id: '1', render_data: { label: 'A' }, action: { type: 2, permission: { type: 2 }, data: '' } }] })) } as InlineKeyboard
    render(<KeyboardEditor value={keyboard} onChange={vi.fn()} />)
    expect(screen.queryByText('+ 添加行')).not.toBeInTheDocument()
  })
})
