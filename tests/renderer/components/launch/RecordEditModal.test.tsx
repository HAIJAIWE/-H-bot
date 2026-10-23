// tests/renderer/components/launch/RecordEditModal.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { RecordEditModal } from '@renderer/components/launch/RecordEditModal'
import type { FieldSchema } from '@shared/types/launch'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// ── Mock TypeEditor（简化为可控的 text input，并通过 data-testid 标记） ──
// TypeEditor 是按 BaseType 分发的复杂组件，单测里以简单 input 替代以减少依赖
vi.mock('@renderer/components/launch/editors/TypeEditor', () => ({
  TypeEditor: ({ value, onChange, field }: { value: unknown; onChange: (v: unknown) => void; field: { type: string } }) => {
    const str = value === null || value === undefined ? '' : String(value)
    return (
      <input
        type="text"
        data-testid={`type-editor-${field.type}`}
        value={str}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  },
}))

// ── 辅助：构造 FieldSchema ──
function makeField(overrides: Partial<FieldSchema> = {}): FieldSchema {
  return {
    name: 'nickname',
    type: 'text',
    label: '昵称',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RecordEditModal - 渲染', () => {
  it('open=false 时不渲染', () => {
    render(
      <RecordEditModal
        open={false}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    expect(screen.queryByText('编辑')).not.toBeInTheDocument()
  })

  it('open=true 时显示 title', () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="新增记录"
        fields={[makeField()]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="create"
      />
    )
    expect(screen.getByText('新增记录')).toBeInTheDocument()
  })

  it('显示字段的 label', () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField({ name: 'nickname', label: '玩家昵称' })]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    expect(screen.getByText('玩家昵称')).toBeInTheDocument()
  })

  it('字段无 label 时使用 COLUMN_LABELS 中文映射', () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField({ name: 'level', label: undefined })]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    // COLUMN_LABELS.level = '等级'
    expect(screen.getByText('等级')).toBeInTheDocument()
  })

  it('字段有 description 时显示 [?] 标记', () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField({ description: '玩家昵称说明' })]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    expect(screen.getByText('[?]')).toBeInTheDocument()
  })

  it('字段无 description 时不显示 [?] 标记', () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    expect(screen.queryByText('[?]')).not.toBeInTheDocument()
  })

  it('初始值填充到编辑器', () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{ nickname: '张三' }}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    const editor = screen.getByTestId('type-editor-text') as HTMLInputElement
    expect(editor.value).toBe('张三')
  })
})

describe('RecordEditModal - 保存与取消', () => {
  it('点击"保存"调用 onSave 并传入当前值', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{ nickname: '张三' }}
        onSave={onSave}
        mode="edit"
      />
    )
    // 修改值
    const editor = screen.getByTestId('type-editor-text')
    fireEvent.change(editor, { target: { value: '李四' } })
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ nickname: '李四' }))
    })
  })

  it('保存成功后调用 onClose', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <RecordEditModal
        open={true}
        onClose={onClose}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={onSave}
        mode="edit"
      />
    )
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('保存失败显示错误信息', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('数据库写入失败'))
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={onSave}
        mode="edit"
      />
    )
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(screen.getByText('数据库写入失败')).toBeInTheDocument()
    })
  })

  it('保存中按钮文本变为"保存中..."', async () => {
    let resolveFn: () => void = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveFn = resolve }))
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={onSave}
        mode="edit"
      />
    )
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(screen.getByText('保存中...')).toBeInTheDocument()
    })
    resolveFn()
  })

  it('点击"取消"调用 onClose', () => {
    const onClose = vi.fn()
    render(
      <RecordEditModal
        open={true}
        onClose={onClose}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={vi.fn()}
        mode="edit"
      />
    )
    fireEvent.click(screen.getByText('取消'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('RecordEditModal - 表单校验', () => {
  it('数字类型字段输入非数字时显示错误', async () => {
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField({ name: 'level', type: 'integer', label: '等级' })]}
        initialValues={{ level: '' }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        mode="edit"
      />
    )
    // 输入非数字
    const editor = screen.getByTestId('type-editor-integer')
    fireEvent.change(editor, { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(screen.getByText('等级必须是有效数字')).toBeInTheDocument()
    })
  })

  it('数字类型字段输入合法数字时不报错', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField({ name: 'level', type: 'integer', label: '等级' })]}
        initialValues={{ level: '' }}
        onSave={onSave}
        mode="edit"
      />
    )
    const editor = screen.getByTestId('type-editor-integer')
    fireEvent.change(editor, { target: { value: '99' } })
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('空值不触发数字校验（允许留空）', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField({ name: 'level', type: 'integer', label: '等级' })]}
        initialValues={{ level: '' }}
        onSave={onSave}
        mode="edit"
      />
    )
    fireEvent.click(screen.getByText('确认保存'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled()
    })
  })
})

describe('RecordEditModal - 快捷键', () => {
  it('Ctrl+Enter 触发保存', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={onSave}
        mode="edit"
      />
    )
    // 在 .space-y-3 容器上触发 keydown
    const container = document.querySelector('.space-y-3') as HTMLElement
    fireEvent.keyDown(container, { key: 'Enter', ctrlKey: true })
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('Cmd+Enter 触发保存', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={onSave}
        mode="edit"
      />
    )
    const container = document.querySelector('.space-y-3') as HTMLElement
    fireEvent.keyDown(container, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('单按 Enter 不触发保存', () => {
    const onSave = vi.fn()
    render(
      <RecordEditModal
        open={true}
        onClose={vi.fn()}
        title="编辑"
        fields={[makeField()]}
        initialValues={{}}
        onSave={onSave}
        mode="edit"
      />
    )
    const container = document.querySelector('.space-y-3') as HTMLElement
    fireEvent.keyDown(container, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })
})
