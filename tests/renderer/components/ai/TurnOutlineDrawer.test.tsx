// tests/renderer/components/ai/TurnOutlineDrawer.test.tsx
//
// 第 56 批「回合目录」抽屉：一条长对话按「第 N 轮」列出来，点一轮滚回那条消息。
// 钉住四件事：
//   · 空对话要说"还没有回合"（不能只留一块空白）；
//   · 每条用户消息 = 一轮，需求与回答都列出来（回答取本轮最后一条）；
//   · 长文本按 shared 纯函数的口径截断（50 / 120），这里只验证渲染结果；
//   · 点击回传的是**消息数组下标**（userIndex），不是轮次号 —— 锚点口径就靠它。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ChatMessageWithTrace } from '@renderer/stores/aiStore'
import { TurnOutlineDrawer } from '@renderer/components/ai/TurnOutlineDrawer'
import { t } from '@renderer/i18n'

afterEach(cleanup)

/** 抽屉只读 role/content；其余字段（trace/images…）与目录无关，构造最小消息即可 */
const msg = (role: string, content: string): ChatMessageWithTrace =>
  ({ role, content }) as ChatMessageWithTrace

const twoTurns = [
  msg('user', '第一轮需求：给流程加一个节点'),
  msg('assistant', '第一轮回答：节点加好了'),
  msg('user', '第二轮需求：把那个节点改名'),
  msg('assistant', '第二轮回答：名字改好了'),
]

const renderDrawer = (
  messages: ChatMessageWithTrace[],
  extra: Partial<Parameters<typeof TurnOutlineDrawer>[0]> = {},
) =>
  render(
    <TurnOutlineDrawer
      open
      messages={messages}
      activeUserIndex={null}
      onJump={vi.fn()}
      onClose={vi.fn()}
      {...extra}
    />,
  )

describe('回合目录抽屉', () => {
  it('空对话：显示空态，不编造任何一轮', () => {
    renderDrawer([])
    expect(screen.getByTestId('turn-outline-overlay')).toBeInTheDocument()
    expect(screen.getByText(t('ai.turnOutline.empty'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('ai.turnOutline.jump', { n: 1 }) })).toBeNull()
  })

  it('两轮：每轮的需求与回答都列出来', () => {
    renderDrawer(twoTurns)
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 1 }) }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 2 }) }),
    ).toBeInTheDocument()
    for (const text of twoTurns.map(m => m.content)) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('长文本按 50 / 120 字截断并带省略号（口径在 shared，不在这里重算）', () => {
    renderDrawer([msg('user', '需'.repeat(60)), msg('assistant', '答'.repeat(200))])
    expect(screen.getByText('需'.repeat(50) + '…')).toBeInTheDocument()
    expect(screen.getByText('答'.repeat(120) + '…')).toBeInTheDocument()
  })

  it('点第 2 轮回传 userIndex=2（消息数组下标，不是轮次号）并关闭', () => {
    const onJump = vi.fn()
    const onClose = vi.fn()
    renderDrawer(twoTurns, { onJump, onClose })
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 2 }) }))
    expect(onJump).toHaveBeenCalledWith(2)
    // 抽屉盖着消息区，跳完必须收起，否则看不到落点
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('当前视口那轮标 aria-current，其余不标', () => {
    renderDrawer(twoTurns, { activeUserIndex: 2 })
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 2 }) }),
    ).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('button', { name: t('ai.turnOutline.jump', { n: 1 }) }),
    ).not.toHaveAttribute('aria-current')
  })

  it('Esc 关闭（捕获阶段拦下，别让它冒泡去停流）', () => {
    const onClose = vi.fn()
    renderDrawer(twoTurns, { onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('open=false 时什么都不渲染', () => {
    renderDrawer(twoTurns, { open: false })
    expect(screen.queryByTestId('turn-outline-overlay')).toBeNull()
  })
})
