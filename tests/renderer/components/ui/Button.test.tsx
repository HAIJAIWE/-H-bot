// tests/renderer/components/ui/Button.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Button } from '@renderer/components/ui/Button'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Button - 基础渲染', () => {
  it('默认渲染子节点文字', () => {
    render(<Button>点击我</Button>)
    expect(screen.getByRole('button', { name: '点击我' })).toBeInTheDocument()
  })

  it('默认不禁用', () => {
    render(<Button>按钮</Button>)
    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('默认 variant 为 secondary 时正常渲染', () => {
    render(<Button>默认</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})

describe('Button - 变体与尺寸', () => {
  it('支持 primary 变体', () => {
    render(<Button variant="primary">主按钮</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('支持 danger 变体', () => {
    render(<Button variant="danger">危险</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('支持 success 变体', () => {
    render(<Button variant="success">成功</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('支持 sm 尺寸', () => {
    render(<Button size="sm">小</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('支持 lg 尺寸', () => {
    render(<Button size="lg">大</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('不同 variant 生成不同样式', () => {
    const { rerender } = render(<Button variant="primary">按钮</Button>)
    const primaryClass = screen.getByRole('button').className
    rerender(<Button variant="danger">按钮</Button>)
    const dangerClass = screen.getByRole('button').className
    expect(primaryClass).not.toBe(dangerClass)
  })
})

describe('Button - 交互', () => {
  it('点击触发 onClick 回调', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>点击</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled 状态按钮被禁用且不触发回调', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>禁用</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Button - 加载态', () => {
  it('loading 状态显示加载圆圈', () => {
    render(<Button loading>加载中</Button>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('loading 状态按钮被禁用且不触发回调', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} loading>加载中</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading 时隐藏左右图标', () => {
    render(
      <Button loading leftIcon={<span data-testid="left">L</span>} rightIcon={<span data-testid="right">R</span>}>
        加载中
      </Button>
    )
    expect(screen.queryByTestId('left')).not.toBeInTheDocument()
    expect(screen.queryByTestId('right')).not.toBeInTheDocument()
  })
})

describe('Button - 图标', () => {
  it('渲染左侧图标', () => {
    render(<Button leftIcon={<span data-testid="left">L</span>}>按钮</Button>)
    expect(screen.getByTestId('left')).toBeInTheDocument()
  })

  it('渲染右侧图标', () => {
    render(<Button rightIcon={<span data-testid="right">R</span>}>按钮</Button>)
    expect(screen.getByTestId('right')).toBeInTheDocument()
  })
})

describe('Button - 属性透传', () => {
  it('透传 type 属性', () => {
    render(<Button type="submit">提交</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })

  it('透传 id 属性', () => {
    render(<Button id="my-btn">按钮</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('id', 'my-btn')
  })
})
