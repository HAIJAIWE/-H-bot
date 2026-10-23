// tests/renderer/components/ui/Toast.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { ToastProvider, useToast, toast } from '@renderer/components/ui/Toast'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

/** 测试用消费者：通过 useToast 触发通知 */
function ToastConsumer() {
  const api = useToast()
  return (
    <div>
      <button onClick={() => api.success('成功消息')}>success-btn</button>
      <button onClick={() => api.error('错误消息')}>error-btn</button>
      <button onClick={() => api.warning('警告消息')}>warning-btn</button>
      <button onClick={() => api.info('信息消息')}>info-btn</button>
      <button onClick={() => api.success('自定义时长', 1000)}>duration-btn</button>
      <button onClick={() => api.success('不消失', 0)}>no-duration-btn</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('Toast - 基础渲染', () => {
  it('ToastProvider 渲染 children', () => {
    render(
      <ToastProvider>
        <div data-testid="child">子内容</div>
      </ToastProvider>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('无 toast 时不渲染任何 alert', () => {
    render(
      <ToastProvider>
        <div>内容</div>
      </ToastProvider>
    )
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})

describe('Toast - 消息显示', () => {
  it('success 类型显示消息文本', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('success-btn'))
    expect(screen.getByText('成功消息')).toBeInTheDocument()
  })

  it('error 类型显示消息文本', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('error-btn'))
    expect(screen.getByText('错误消息')).toBeInTheDocument()
  })

  it('warning 类型显示消息文本', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('warning-btn'))
    expect(screen.getByText('警告消息')).toBeInTheDocument()
  })

  it('info 类型显示消息文本', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('info-btn'))
    expect(screen.getByText('信息消息')).toBeInTheDocument()
  })

  it('不同类型显示对应图标', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('success-btn'))
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('多条 toast 同时显示', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('success-btn'))
    fireEvent.click(screen.getByText('error-btn'))
    fireEvent.click(screen.getByText('info-btn'))
    expect(screen.getByText('成功消息')).toBeInTheDocument()
    expect(screen.getByText('错误消息')).toBeInTheDocument()
    expect(screen.getByText('信息消息')).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })
})

describe('Toast - 自动消失', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('默认 3 秒后自动消失', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    act(() => {
      fireEvent.click(screen.getByText('success-btn'))
    })
    expect(screen.getByText('成功消息')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('成功消息')).not.toBeInTheDocument()
  })

  it('自定义 duration 后消失', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    act(() => {
      fireEvent.click(screen.getByText('duration-btn'))
    })
    expect(screen.getByText('自定义时长')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(screen.getByText('自定义时长')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('自定义时长')).not.toBeInTheDocument()
  })

  it('duration=0 时不会自动消失', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    act(() => {
      fireEvent.click(screen.getByText('no-duration-btn'))
    })
    expect(screen.getByText('不消失')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(screen.getByText('不消失')).toBeInTheDocument()
  })
})

describe('Toast - 关闭交互', () => {
  it('点击关闭按钮移除 toast', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('success-btn'))
    expect(screen.getByText('成功消息')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(screen.queryByText('成功消息')).not.toBeInTheDocument()
  })
})

describe('Toast - useToast 边界', () => {
  it('useToast 在 ToastProvider 外使用抛出错误', () => {
    // 捕获控制台错误，避免污染测试输出
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Outside() {
      useToast()
      return null
    }
    expect(() => render(<Outside />)).toThrow('useToast 必须在 <ToastProvider> 内部使用')
    spy.mockRestore()
  })

  it('模块级 toast API 在 Provider 挂载后可用', () => {
    render(
      <ToastProvider>
        <div>内容</div>
      </ToastProvider>
    )
    // 模块级 toast 调用会触发 setToasts，需用 act 包裹以同步刷新 DOM
    act(() => {
      toast.success('模块级消息')
    })
    expect(screen.getByText('模块级消息')).toBeInTheDocument()
  })

  it('模块级 toast API 在未挂载 Provider 时静默丢弃', () => {
    // 未渲染 Provider，调用 toast 不应抛错
    expect(() => toast.success('不应显示')).not.toThrow()
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument()
  })
})
