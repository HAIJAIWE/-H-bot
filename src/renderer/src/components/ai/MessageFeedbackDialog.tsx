// src/renderer/src/components/ai/MessageFeedbackDialog.tsx
//
// **反馈弹层**（第 58 批，对照 DSH `dsh-message-feedback`）：
// 点了 👍 / 👎 之后选分类（7 档，再点一次取消选择）＋写补充说明（500 字上限），
// 提交走 store 的 putMessageFeedback。
//
// 提交失败**不关弹层**：主进程拒收的原因（说明太长 / 那条消息已不在）要让人看见，
// 改完能直接在原地重试；只有成功才关。
//
// 骨架照 TurnOutlineDrawer：遮罩点击关闭、role=dialog、Esc 关闭（useDialogFocus 已含焦点陷阱）。
import { useId, useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import {
  FEEDBACK_CATEGORIES,
  MAX_FEEDBACK_NOTE_CHARS,
  normalizeFeedbackNote,
  type FeedbackCategory,
  type FeedbackRating,
  type MessageFeedbackItem,
} from '@shared/ai/messageFeedback'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { useDialogFocus } from '../../hooks/useDialogFocus'

/**
 * 分类 id → i18n 键的静态映射。
 * 键名必须是完整字面量（orphanKeys 闸门靠它认「这七个键确实被引用」），
 * 别在运行时用模板串拼出来。
 */
const CATEGORY_LABEL_KEYS: Record<FeedbackCategory, string> = {
  'task-result': 'ai.feedback.category.taskResult',
  'instruction-following': 'ai.feedback.category.instructionFollowing',
  'product-interaction': 'ai.feedback.category.productInteraction',
  'service-stability': 'ai.feedback.category.serviceStability',
  'resource-cost': 'ai.feedback.category.resourceCost',
  'security-privacy-permission': 'ai.feedback.category.securityPrivacy',
  other: 'ai.feedback.category.other',
}

/**
 * 主进程错误文本 → 给人看的一句话。
 *
 * IPC 只透传 Error.message（错误码不落渲染进程），所以这里按文本特征归类：
 * 说明太长、别处改过（拿到的旧表）都能给出更具体的提示，其余原样带上 message。
 */
export function feedbackFailureText(error: string): string {
  if (error === 'ipc-missing') return t('ai.feedback.loadFailed')
  if (/note-too-long|太长/.test(error)) return t('ai.feedback.noteTooLong')
  if (/conflict|已在别处改动/.test(error)) return t('ai.feedback.conflict')
  return t('ai.feedback.failed', { message: error })
}

export interface MessageFeedbackDialogProps {
  /** 这次点的是哪一档（弹层标题/提交都按它走） */
  rating: FeedbackRating
  /** 已有反馈：换档或改说明时把上次的分类/说明预填回来 */
  initial?: MessageFeedbackItem
  /** 提交；返回失败时弹层保持打开并显示错误，用户可改完重试 */
  onSubmit: (payload: {
    category?: FeedbackCategory
    note?: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  onClose: () => void
}

export function MessageFeedbackDialog({
  rating,
  initial,
  onSubmit,
  onClose,
}: MessageFeedbackDialogProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const { ref, titleId } = useDialogFocus<HTMLFormElement>(true, onClose)
  const noteId = useId()
  const [category, setCategory] = useState<FeedbackCategory | null>(initial?.category ?? null)
  const [note, setNote] = useState(initial?.note ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const cleanNote = normalizeFeedbackNote(note)
    setSubmitting(true)
    setError(null)
    const res = await onSubmit({
      ...(category ? { category } : {}),
      ...(cleanNote ? { note: cleanNote } : {}),
    })
    setSubmitting(false)
    if (res.ok) {
      onClose()
      return
    }
    setError(feedbackFailureText(res.error))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onSubmit={e => void handleSubmit(e)}
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-200 shadow-xl outline-none"
      >
        <h2
          id={titleId}
          className="mb-3 flex items-center gap-1.5 text-sm font-medium text-zinc-100"
        >
          {rating === 'positive' ? (
            <ThumbsUp size={14} className="text-emerald-400" />
          ) : (
            <ThumbsDown size={14} className="text-rose-400" />
          )}
          {t('ai.feedback.dialogTitle')}
        </h2>

        <div className="mb-1 text-[11px] text-zinc-500">{t('ai.feedback.categories')}</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FEEDBACK_CATEGORIES.map(id => {
            const active = category === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(active ? null : id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? 'border-sky-400/60 bg-sky-400/15 text-sky-200'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {t(CATEGORY_LABEL_KEYS[id])}
              </button>
            )
          })}
        </div>

        <label htmlFor={noteId} className="mb-1 block text-[11px] text-zinc-500">
          {t('ai.feedback.detail')}
        </label>
        <textarea
          id={noteId}
          value={note}
          maxLength={MAX_FEEDBACK_NOTE_CHARS}
          rows={3}
          placeholder={t('ai.feedback.detailPlaceholder')}
          onChange={e => setNote(e.target.value)}
          className="w-full resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-sky-400/60"
        />
        <div className="mb-3 text-right text-[10px] text-zinc-600">
          {note.length} / {MAX_FEEDBACK_NOTE_CHARS}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
          >
            {t('ai.feedback.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-sky-600 px-3 py-1 text-[11px] text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {t('ai.feedback.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
