// tests/renderer/components/ui/Modal.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Modal, ModalFooter } from '@renderer/components/ui/Modal'

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

describe('Modal - 渲染', () => {
  it('open=false 时不渲染任何内容', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}} title="标题">
        内容
      </Modal>
    )
    expect(container.firstChild).toBeNull()
  })

  it('open=true 时渲染对话框', () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题">
        内容
      </Modal>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('显示标题文本', () => {
    render(
      <Modal open={true} onClose={() => {}} title="我的标题">
        内容
      </Modal>
    )
    expect(screen.getByText('我的标题')).toBeInTheDocument()
  })

  it('渲染 children 内容', () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题">
        <div data-testid="child">子内容</div>
      </Modal>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('提供 footer 时渲染底部区域', () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题" footer={<button>确认</button>}>
        内容
      </Modal>
    )
    expect(screen.getByText('确认')).toBeInTheDocument()
  })

  it('未提供 footer 时不渲染底部区域', () => {
    const { container } = render(
      <Modal open={true} onClose={() => {}} title="标题">
        内容
      </Modal>
    )
    // footer 区域有 border-t 类，未提供 footer 时不应出现
    expect(container.querySelector('.border-t')).toBeNull()
  })

  it('应用默认宽度 520px', () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题">
        内容
      </Modal>
    )
    expect(screen.getByRole('dialog').style.width).toBe('520px')
  })

  it('支持自定义宽度', () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题" width="800px">
        内容
      </Modal>
    )
    expect(screen.getByRole('dialog').style.width).toBe('800px')
  })

  it('dialog 有 aria-modal="true" 属性', () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题">
        内容
      </Modal>
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})

describe('Modal - 关闭交互', () => {
  it('点击遮罩触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="标题">
        内容
      </Modal>
    )
    // 遮罩是 dialog 的父元素
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击 Modal 内部不触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="标题">
        <div data-testid="inner">内容</div>
      </Modal>
    )
    fireEvent.click(screen.getByTestId('inner'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点击右上角 × 按钮触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="标题">
        内容
      </Modal>
    )
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按下 ESC 键触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="标题">
        内容
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按下其他键不触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="标题">
        内容
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('open=false 时不监听 ESC', () => {
    const onClose = vi.fn()
    render(
      <Modal open={false} onClose={onClose} title="标题">
        内容
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ModalFooter', () => {
  it('渲染默认取消和确认按钮', () => {
    render(<ModalFooter onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText('取消')).toBeInTheDocument()
    expect(screen.getByText('保存')).toBeInTheDocument()
  })

  it('点击取消按钮触发 onCancel', () => {
    const onCancel = vi.fn()
    render(<ModalFooter onCancel={onCancel} onConfirm={() => {}} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点击确认按钮触发 onConfirm', () => {
    const onConfirm = vi.fn()
    render(<ModalFooter onCancel={() => {}} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByText('保存'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirmDisabled 时确认按钮被禁用', () => {
    render(<ModalFooter onCancel={() => {}} onConfirm={() => {}} confirmDisabled />)
    expect(screen.getByText('保存')).toBeDisabled()
  })

  it('支持自定义按钮文本', () => {
    render(
      <ModalFooter
        onCancel={() => {}}
        onConfirm={() => {}}
        cancelText="返回"
        confirmText="删除"
      />
    )
    expect(screen.getByText('返回')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
  })
})
