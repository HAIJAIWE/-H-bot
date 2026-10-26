// tests/renderer/components/ai/AgentTranscript.feedback.test.tsx
//
// 第 58 批：消息流里的反馈接线。
// 这一层负责三件渲染层的事，都在这测：
//   1. 只给**已落盘的 assistant 消息**显示 👍/👎；
//   2. 点未选中的档 → 开弹层；点已选中的同档 → 撤回；
//   3. 结果用行内 role=status 说一声（成功 / 撤回 / 失败原因映射）。
// store 的乐观更新/回滚有自己的测试，这里只替换动作、断言调用参数。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { FeedbackRating, MessageFeedbackItem } from '@shared/ai/messageFeedback'
import { t } from '@renderer/i18n'
import { AgentTranscript, type AgentTranscriptProps } from '@renderer/components/ai/AgentTranscript'
import { useAiStore, type ChatMessageWithTrace } from '@renderer/stores/aiStore'
import { groupIntoTurns } from '@renderer/lib/ai/turnGrouping'

afterEach(() => {
  cleanup()
})

const msg = (
  role: ChatMessageWithTrace['role'],
  content: string,
  messageId?: string,
): ChatMessageWithTrace => ({
  role,
  content,
  ...(messageId ? { messageId } : {}),
})

const item = (rating: FeedbackRating): MessageFeedbackItem => ({
  rating,
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
})

/** store 动作的真实签名：替换后仍要按原样被调用，顺便让 mock 的返回值得类型检查 */
type AiStoreState = ReturnType<typeof useAiStore.getState>
let putSpy: Mock<AiStoreState['putMessageFeedback']>
let retractSpy: Mock<AiStoreState['retractMessageFeedback']>

beforeEach(() => {
  putSpy = vi.fn<AiStoreState['putMessageFeedback']>().mockResolvedValue({ ok: true })
  retractSpy = vi.fn<AiStoreState['retractMessageFeedback']>().mockResolvedValue({ ok: true })
  useAiStore.setState({
    threadFeedback: {},
    putMessageFeedback: putSpy,
    retractMessageFeedback: retractSpy,
  })
})

function renderTranscript(
  messages: ChatMessageWithTrace[],
  override: Partial<AgentTranscriptProps> = {},
) {
  return render(
    <AgentTranscript
      messages={messages}
      turns={groupIntoTurns(messages)}
      editingIndex={null}
      setEditingIndex={() => {}}
      editDraft=""
      setEditDraft={() => {}}
      streaming={false}
      copiedIndex={null}
      copyText={() => {}}
      regenerate={() => {}}
      projectPath="proj-1"
      canRollback={false}
      rollbackLastTurn={() => {}}
      {...override}
    />,
  )
}

describe('AgentTranscript 反馈按钮的显示条件', () => {
  it('已落盘的 assistant 消息显示两档反馈按钮', () => {
    renderTranscript([msg('assistant', '答案', 'm1')])
    expect(screen.getByLabelText(t('ai.feedback.goodAria'))).toBeInTheDocument()
    expect(screen.getByLabelText(t('ai.feedback.badAria'))).toBeInTheDocument()
  })

  it('未落盘（没有 messageId）的 assistant 消息不显示反馈按钮', () => {
    renderTranscript([msg('assistant', '答案')])
    expect(screen.queryByLabelText(t('ai.feedback.goodAria'))).not.toBeInTheDocument()
  })

  it('用户消息即使有 messageId 也不显示反馈按钮（反馈只评回答）', () => {
    renderTranscript([msg('user', '问题', 'u1')])
    expect(screen.queryByLabelText(t('ai.feedback.goodAria'))).not.toBeInTheDocument()
  })

  it('已有反馈时按 store 里的当前档位渲染选中态', () => {
    useAiStore.setState({ threadFeedback: { m1: item('positive') } })
    renderTranscript([msg('assistant', '答案', 'm1')])
    expect(screen.getByLabelText(t('ai.feedback.goodAria'))).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(t('ai.feedback.badAria'))).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('AgentTranscript 反馈交互', () => {
  it('点已选中的同档 = 撤回，并提示已撤回', async () => {
    useAiStore.setState({ threadFeedback: { m1: item('positive') } })
    renderTranscript([msg('assistant', '答案', 'm1')])
    fireEvent.click(screen.getByLabelText(t('ai.feedback.goodAria')))
    await waitFor(() => expect(retractSpy).toHaveBeenCalledWith('proj-1', 'm1'))
    expect(await screen.findByText(t('ai.feedback.retracted'))).toBeInTheDocument()
  })

  it('撤回失败时把主进程的错误映射成行内提示', async () => {
    retractSpy.mockResolvedValue({ ok: false, error: 'conflict' })
    useAiStore.setState({ threadFeedback: { m1: item('negative') } })
    renderTranscript([msg('assistant', '答案', 'm1')])
    fireEvent.click(screen.getByLabelText(t('ai.feedback.badAria')))
    expect(await screen.findByText(t('ai.feedback.conflict'))).toBeInTheDocument()
  })

  it('点未选中的档打开弹层，选分类写说明后按正确参数提交并提示已保存', async () => {
    renderTranscript([msg('assistant', '答案', 'm1')])
    fireEvent.click(screen.getByLabelText(t('ai.feedback.badAria')))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('ai.feedback.category.taskResult') }))
    fireEvent.change(screen.getByLabelText(t('ai.feedback.detail')), {
      target: { value: '答非所问' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('ai.feedback.submit') }))
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('proj-1', 'm1', 'negative', {
        category: 'task-result',
        note: '答非所问',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(t('ai.feedback.saved'))).toBeInTheDocument()
  })

  it('提交失败保留弹层并显示具体原因（说明太长）', async () => {
    putSpy.mockResolvedValue({ ok: false, error: 'note-too-long' })
    renderTranscript([msg('assistant', '答案', 'm1')])
    fireEvent.click(screen.getByLabelText(t('ai.feedback.badAria')))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: t('ai.feedback.submit') }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('ai.feedback.noteTooLong'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('没有项目路径时不能反馈，行内提示加载失败且不打开弹层', async () => {
    renderTranscript([msg('assistant', '答案', 'm1')], { projectPath: undefined })
    fireEvent.click(screen.getByLabelText(t('ai.feedback.badAria')))
    expect(await screen.findByText(t('ai.feedback.loadFailed'))).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
