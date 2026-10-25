// tests/renderer/components/ai/turnProcess.test.tsx
//
// **一轮的过程行**（2026-10-25 按 DSH 的 TurnProcessNodeView 复刻）：
// 收起来是一行「工作了 12 秒 · 3 次工具」，点开才是思考与工具行；运行中默认展开。
// 这三条是版面契约 —— 折叠层级变了（整轮 → 过程），别把历史轮又折回一行。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TurnProcess, formatDuration } from '@renderer/components/ai/TurnProcess'
import { RunningLine } from '@renderer/components/ai/RunningLine'

afterEach(cleanup)

describe('★ 一轮的过程行（TurnProcess）', () => {
  it('收起来只占一行：结算文案 + 工具次数；内容不渲染', () => {
    render(
      <TurnProcess tools={3} elapsedMs={12400}>
        <div>过程内容</div>
      </TurnProcess>,
    )
    expect(screen.getByText('工作了 12 秒')).toBeTruthy()
    expect(screen.getByText('3 次工具')).toBeTruthy()
    expect(screen.queryByText('过程内容')).toBeNull()
  })

  it('点开才是过程内容', () => {
    render(
      <TurnProcess tools={0} elapsedMs={1000}>
        <div>过程内容</div>
      </TurnProcess>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('过程内容')).toBeTruthy()
  })

  it('运行中默认展开、文案是「执行中」', () => {
    render(
      <TurnProcess running>
        <div>过程内容</div>
      </TurnProcess>,
    )
    expect(screen.getByText('执行中')).toBeTruthy()
    expect(screen.getByText('过程内容')).toBeTruthy()
  })

  it('停止/失败不显示时长（DSH 同口径）', () => {
    const { unmount } = render(
      <TurnProcess outcome="stopped" elapsedMs={9000}>
        <div>过程内容</div>
      </TurnProcess>,
    )
    expect(screen.getByText('已停止')).toBeTruthy()
    expect(screen.queryByText(/工作了/)).toBeNull()
    unmount()
    render(
      <TurnProcess outcome="failed" elapsedMs={9000}>
        <div>过程内容</div>
      </TurnProcess>,
    )
    expect(screen.getByText('这一轮失败了')).toBeTruthy()
  })

  it('没有过程内容就什么都不渲染（不留空行）', () => {
    const { container } = render(<TurnProcess tools={0} />)
    expect(container.innerHTML).toBe('')
  })

  it('耗时文案：不足一分钟说秒，超过说分秒', () => {
    expect(formatDuration(1200)).toBe('1 秒')
    expect(formatDuration(65_000)).toBe('1 分 05 秒')
  })
})

describe('★ 运行行（RunningLine）', () => {
  it('刚起步只说「正在处理」，有耗时带上时长', () => {
    const { unmount } = render(<RunningLine elapsed={0} />)
    expect(screen.getByText('正在处理')).toBeTruthy()
    unmount()
    render(<RunningLine elapsed={12} />)
    expect(screen.getByText('正在处理 12 秒')).toBeTruthy()
  })
})
