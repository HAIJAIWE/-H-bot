// tests/renderer/components/ai/MessageActions.feedback.test.tsx
//
// 第 58 批：操作行里的 👍 / 👎。
// 只测这一行自己的契约 —— 选中态、两档回调、显示条件、按钮顺序；
// 「点了之后开弹层 / 撤回 / 落盘」属于 AgentTranscript，在另一个测试文件里。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { MessageFeedbackItem } from '@shared/ai/messageFeedback'
import { t } from '@renderer/i18n'
import { MessageActions } from '@renderer/components/ai/MessageActions'

afterEach(() => {
  cleanup()
})

const feedback = (rating: 'positive' | 'negative'): MessageFeedbackItem => ({
  rating,
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
})

function renderActions(extra: Partial<Parameters<typeof MessageActions>[0]> = {}) {
  const onFeedback = vi.fn()
  const utils = render(
    <MessageActions
      role="assistant"
      index={1}
      copied={false}
      canEdit={false}
      showRegenerate
      showRollback={false}
      alwaysVisible
      onEdit={() => {}}
      onCopy={() => {}}
      onRegenerate={() => {}}
      onRollback={() => {}}
      feedbackEnabled
      onFeedback={onFeedback}
      {...extra}
    />,
  )
  return { ...utils, onFeedback }
}

describe('MessageActions 反馈按钮', () => {
  it('feedbackEnabled 关闭时不渲染反馈按钮（未落盘 / 用户消息都走这条路）', () => {
    renderActions({ feedbackEnabled: false })
    expect(screen.queryByLabelText(t('ai.feedback.goodAria'))).not.toBeInTheDocument()
    expect(screen.queryByLabelText(t('ai.feedback.badAria'))).not.toBeInTheDocument()
  })

  it('没有 onFeedback 回调时不渲染（避免出现点了没反应的按钮）', () => {
    renderActions({ onFeedback: undefined })
    expect(screen.queryByLabelText(t('ai.feedback.goodAria'))).not.toBeInTheDocument()
  })

  it('未反馈时两档都是 aria-pressed=false，点击把档位交给上层', () => {
    const { onFeedback } = renderActions()
    const up = screen.getByLabelText(t('ai.feedback.goodAria'))
    const down = screen.getByLabelText(t('ai.feedback.badAria'))
    expect(up).toHaveAttribute('aria-pressed', 'false')
    expect(down).toHaveAttribute('aria-pressed', 'false')
    expect(up).not.toHaveAttribute('data-active')
    fireEvent.click(up)
    expect(onFeedback).toHaveBeenCalledWith('positive')
    fireEvent.click(down)
    expect(onFeedback).toHaveBeenCalledWith('negative')
  })

  it('已选 positive：👍 实心高亮（aria-pressed + data-active），👎 仍未选中', () => {
    renderActions({ feedback: feedback('positive') })
    const up = screen.getByLabelText(t('ai.feedback.goodAria'))
    const down = screen.getByLabelText(t('ai.feedback.badAria'))
    expect(up).toHaveAttribute('aria-pressed', 'true')
    expect(up).toHaveAttribute('data-active', 'true')
    expect(down).toHaveAttribute('aria-pressed', 'false')
    expect(down).not.toHaveAttribute('data-active')
  })

  it('已选 negative：只有 👎 高亮', () => {
    renderActions({ feedback: feedback('negative') })
    expect(screen.getByLabelText(t('ai.feedback.badAria'))).toHaveAttribute('data-active', 'true')
    expect(screen.getByLabelText(t('ai.feedback.goodAria'))).not.toHaveAttribute('data-active')
  })

  it('反馈按钮夹在复制与重新生成之间（顺序 = 复制 / 👍 / 👎 / 重新生成）', () => {
    renderActions()
    const labels = screen.getAllByRole('button').map(el => el.getAttribute('aria-label'))
    expect(labels).toEqual([
      t('ai.chat.copy'),
      t('ai.feedback.goodAria'),
      t('ai.feedback.badAria'),
      t('ai.chat.regenerate'),
    ])
  })
})
