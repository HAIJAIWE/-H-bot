// tests/renderer/components/ai/compactionNotice.test.tsx
//
// **压缩提示的渲染契约**（2026-10-25）：它必须是一条"分隔线式说明"，不是警示横幅。
// 走系统消息默认渲染会被画成琥珀色横幅 —— 那是"需要你处理"的语义，这里只是"发生过什么"。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageBubble } from '@renderer/components/ai/MessageBubble'
import type { ChatMessageWithTrace } from '@renderer/stores/aiStore'

afterEach(cleanup)

const note = {
  id: 'n1',
  role: 'system',
  notice: 'compaction',
  content: '上下文已压缩：省略 7 条早先回合，约 91k → 12k tokens',
} as unknown as ChatMessageWithTrace

describe('★ 压缩提示（notice=compaction）', () => {
  it('文案在 DOM 里', () => {
    render(<MessageBubble msg={note} />)
    expect(screen.getByText(/省略 7 条早先回合/)).toBeTruthy()
  })

  it('不是警示横幅：不套 amber 配色，改由上方细线分隔', () => {
    const { container } = render(<MessageBubble msg={note} />)
    expect(container.innerHTML).not.toContain('amber')
    const box = container.firstElementChild as HTMLElement
    expect(box.className).toContain('border-t')
    // 窄栏里"左右两条线 + flex-1"会被文字挤成 0，所以不用那种写法
    expect(container.querySelectorAll('.h-px').length).toBe(0)
  })

  it('★ 允许换行：文字不能 shrink-0（缩不掉就只能横向溢出，真机上成了一条水平滚动条）', () => {
    render(<MessageBubble msg={note} />)
    const text = screen.getByText(/省略 7 条早先回合/)
    // break-words：只在词边界折行，不会把 "91k" 劈成 "9 / 1k"（break-all 会）
    expect(text.className).toContain('break-words')
    expect(text.className).not.toContain('break-all')
    expect(text.className).not.toContain('shrink-0')
  })

  it('普通 system 回执仍然隐藏（这条规则没被压缩提示挤掉）', () => {
    const receipt = {
      id: 'r1',
      role: 'system',
      content: '[系统回执] 已写 3 个文件',
    } as unknown as ChatMessageWithTrace
    const { container } = render(<MessageBubble msg={receipt} />)
    expect(container.innerHTML).toBe('')
  })
})
