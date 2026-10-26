// tests/renderer/components/ai/TurnOutlineLauncher.test.tsx
//
// 第 56 批：抽屉是"画"，Launcher 是"接线"——入口按钮、视口在第几轮、
// 跳转后的高亮（1.5 秒褪去）都在这里。这一层不测就只剩"抽屉能单独渲染"，
// 而实际坏掉的往往是接线（web 编译能过、按钮不存在）。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useRef } from 'react'
import type { ChatMessageWithTrace } from '@renderer/stores/aiStore'
import { TurnOutlineLauncher } from '@renderer/components/ai/TurnOutlineLauncher'
import { t } from '@renderer/i18n'

const msg = (role: string, content: string): ChatMessageWithTrace =>
  ({ role, content }) as ChatMessageWithTrace

const twoTurns = [
  msg('user', '第一轮需求'),
  msg('assistant', '第一轮回答'),
  msg('user', '第二轮需求'),
  msg('assistant', '第二轮回答'),
]

/**
 * 最小真实环境：一个滚动容器 + 两条消息锚点。
 *
 * 锚点 id 与 `AgentTranscript` 挂的一致（`ai-msg-<消息下标>`）——
 * Launcher 求"当前第几轮"和跳转都依赖它，测试里不能省。
 */
function Harness({
  messages,
  onHighlight,
  withAnchors = true,
}: {
  messages: ChatMessageWithTrace[]
  onHighlight: (index: number | null) => void
  withAnchors?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref}>
      {withAnchors && [0, 2].map(i => <div key={i} id={`ai-msg-${i}`} />)}
      <TurnOutlineLauncher messages={messages} scrollRef={ref} onHighlight={onHighlight} />
    </div>
  )
}

let scrollSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // setup.ts 已经补了一个空实现；这里换成 spy，好断言"滚的是哪条锚点"
  scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  scrollSpy.mockRestore()
})

describe('回合目录接线', () => {
  it('入口按钮打开抽屉，抽屉里按轮列出', () => {
    render(<Harness messages={twoTurns} onHighlight={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    expect(screen.getByRole('dialog', { name: t('ai.turnOutline.title') })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 1 }) }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 2 }) }),
    ).toBeInTheDocument()
  })

  it('空对话也开得出来，里面是空态（按钮不能因为"没东西"就消失）', () => {
    render(<Harness messages={[]} onHighlight={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    expect(screen.getByText(t('ai.turnOutline.empty'))).toBeInTheDocument()
  })

  it('打开时按视口算当前轮（jsdom 里所有消息都在同一位置 → 落到最后一轮）', () => {
    render(<Harness messages={twoTurns} onHighlight={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    // getBoundingClientRect 全是 0：每条都"已越过顶部"，于是最后一轮成为当前轮
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 2 }) }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('点一轮：滚到它的锚点、回传高亮下标、收起抽屉；1.5 秒后撤掉高亮', () => {
    vi.useFakeTimers()
    const onHighlight = vi.fn()
    render(<Harness messages={twoTurns} onHighlight={onHighlight} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 2 }) }))

    // 滚的是第二条用户消息的锚点（消息下标 2，不是轮次 2 —— 这里恰好都是 2，
    // 但第一轮那条断言的是下标 0，见下一条用例）
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('ai-msg-2'))
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
    expect(onHighlight).toHaveBeenCalledWith(2)
    // 抽屉收起：盖在消息流上看不到落点
    expect(screen.queryByTestId('turn-outline-overlay')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(onHighlight).toHaveBeenLastCalledWith(null)
  })

  it('第 1 轮回传的是锚点 0（下标口径与轮次号解耦）', () => {
    const onHighlight = vi.fn()
    render(<Harness messages={twoTurns} onHighlight={onHighlight} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 1 }) }))
    expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('ai-msg-0'))
    expect(onHighlight).toHaveBeenCalledWith(0)
  })

  it('锚点不存在也不炸（历史被裁剪/视图切到轨迹时仍可点）', () => {
    render(<Harness messages={twoTurns} onHighlight={vi.fn()} withAnchors={false} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 1 }) })),
    ).not.toThrow()
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('Esc 只关抽屉，不继续冒泡（ChatPanel 的 Esc 是停流/清输入）', () => {
    render(<Harness messages={twoTurns} onHighlight={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('turn-outline-overlay')).toBeNull()
  })
})
