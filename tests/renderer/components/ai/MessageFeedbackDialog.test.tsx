// tests/renderer/components/ai/MessageFeedbackDialog.test.tsx
//
// 第 58 批：反馈弹层。
// 覆盖「选分类 / 写说明 / 提交 / 失败不关 / 错误文案映射 / 关闭方式」——
// 提交失败时不关弹层是这块最关键的行为：主进程拒收的原因必须留在眼前，改完能重试。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { FeedbackCategory } from '@shared/ai/messageFeedback'
import { t } from '@renderer/i18n'
import { MessageFeedbackDialog } from '@renderer/components/ai/MessageFeedbackDialog'

afterEach(() => {
  cleanup()
})

type SubmitResult = { ok: true } | { ok: false; error: string }

function renderDialog(
  extra: {
    initial?: { rating: 'positive' | 'negative'; category?: FeedbackCategory; note?: string }
    onSubmit?: (payload: { category?: FeedbackCategory; note?: string }) => Promise<SubmitResult>
  } = {},
) {
  const onSubmit = vi.fn(extra.onSubmit ?? (() => Promise.resolve<SubmitResult>({ ok: true })))
  const onClose = vi.fn()
  render(
    <MessageFeedbackDialog
      rating="positive"
      initial={
        extra.initial
          ? {
              ...extra.initial,
              createdAt: '2026-10-27T00:00:00.000Z',
              updatedAt: '2026-10-27T00:00:00.000Z',
            }
          : undefined
      }
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  )
  return { onSubmit, onClose }
}

const submitButton = () => screen.getByRole('button', { name: t('ai.feedback.submit') })
const noteBox = () => screen.getByLabelText(t('ai.feedback.detail')) as HTMLTextAreaElement

describe('MessageFeedbackDialog 渲染与选择', () => {
  it('渲染对话框标题、七个分类、说明输入框与两个动作', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: t('ai.feedback.dialogTitle') })).toBeInTheDocument()
    expect(screen.getByText(t('ai.feedback.categories'))).toBeInTheDocument()
    // 七个分类一个不少（少一个用户就少一条可选的反馈理由）
    for (const label of [
      t('ai.feedback.category.taskResult'),
      t('ai.feedback.category.instructionFollowing'),
      t('ai.feedback.category.productInteraction'),
      t('ai.feedback.category.serviceStability'),
      t('ai.feedback.category.resourceCost'),
      t('ai.feedback.category.securityPrivacy'),
      t('ai.feedback.category.other'),
    ]) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    }
    expect(screen.getByLabelText(t('ai.feedback.detail'))).toHaveAttribute(
      'placeholder',
      t('ai.feedback.detailPlaceholder'),
    )
    expect(submitButton()).toBeEnabled()
    expect(screen.getByRole('button', { name: t('ai.feedback.cancel') })).toBeInTheDocument()
  })

  it('分类是单选，再点一次取消选择', () => {
    renderDialog()
    const chip = screen.getByRole('button', { name: t('ai.feedback.category.taskResult') })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('说明框有 500 字上限，并实时显示字数', () => {
    renderDialog()
    expect(noteBox()).toHaveAttribute('maxlength', '500')
    fireEvent.change(noteBox(), { target: { value: '慢' } })
    expect(screen.getByText('1 / 500')).toBeInTheDocument()
    expect(noteBox().value).toBe('慢')
  })

  it('有已有分类时预填为选中态，说明也回填', () => {
    renderDialog({
      initial: { rating: 'positive', category: 'service-stability', note: '经常超时' },
    })
    expect(
      screen.getByRole('button', { name: t('ai.feedback.category.serviceStability') }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(noteBox().value).toBe('经常超时')
  })
})

describe('MessageFeedbackDialog 提交', () => {
  it('提交时带上选中的分类与归一后的说明，成功后关闭', async () => {
    const { onSubmit, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: t('ai.feedback.category.resourceCost') }))
    fireEvent.change(noteBox(), { target: { value: '  太费 token  ' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({ category: 'resource-cost', note: '太费 token' })
  })

  it('什么都没选也可以直接提交（分类与说明都可选）', async () => {
    const { onSubmit, onClose } = renderDialog()
    fireEvent.click(submitButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({})
  })

  it('提交中禁用提交按钮，避免连点写两次', async () => {
    let release: (v: SubmitResult) => void = () => {}
    renderDialog({
      onSubmit: () =>
        new Promise<SubmitResult>(resolve => {
          release = resolve
        }),
    })
    fireEvent.click(submitButton())
    await waitFor(() => expect(submitButton()).toBeDisabled())
    release({ ok: true })
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('失败时不关闭弹层，用 role=alert 显示原因；改完可以再次提交', async () => {
    const results: SubmitResult[] = [{ ok: false, error: 'boom' }, { ok: true }]
    const { onSubmit, onClose } = renderDialog({
      onSubmit: () => Promise.resolve(results.shift()!),
    })
    fireEvent.click(submitButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('ai.feedback.failed', { message: 'boom' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(submitButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('主进程说"说明太长"时映射成 noteTooLong 文案', async () => {
    renderDialog({
      onSubmit: () => Promise.resolve({ ok: false, error: '补充说明太长（不超过 500 字）' }),
    })
    fireEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(t('ai.feedback.noteTooLong'))
  })

  it('反馈已在别处改动时映射成 conflict 文案', async () => {
    renderDialog({ onSubmit: () => Promise.resolve({ ok: false, error: 'conflict' }) })
    fireEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(t('ai.feedback.conflict'))
  })

  it('缺少 IPC 桥时映射成 loadFailed 文案', async () => {
    renderDialog({ onSubmit: () => Promise.resolve({ ok: false, error: 'ipc-missing' }) })
    fireEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(t('ai.feedback.loadFailed'))
  })
})

describe('MessageFeedbackDialog 关闭', () => {
  it('Esc 关闭', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点遮罩关闭，点弹层内部不关闭', () => {
    const { onClose } = renderDialog()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('取消按钮关闭', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: t('ai.feedback.cancel') }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
