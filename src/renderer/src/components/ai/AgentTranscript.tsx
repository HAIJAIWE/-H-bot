// src/renderer/src/components/ai/AgentTranscript.tsx
//
// **消息流本体**（从 ChatPanel 拆出 2026-10-19；2026-10-25 按 DSH 重排为"按轮"）：
// 每一轮一个容器（用户气泡 + 过程行 + 助手正文 + 操作行），不再把整轮折成一行 ——
// DSH 的历史是**一直展开**的，折叠只发生在"过程"这一层（见 TurnProcess）。
import { useState } from 'react'
import type {
  FeedbackCategory,
  FeedbackRating,
  MessageFeedbackItem,
} from '@shared/ai/messageFeedback'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { useAiStore, type ChatMessageWithTrace } from '../../stores/aiStore'
import type { groupIntoTurns } from '../../lib/ai/turnGrouping'
import { MessageBubble } from './MessageBubble'
import { InlineEditBox } from './InlineEditBox'
import { MessageActions } from './MessageActions'
import { MessageFeedbackDialog, feedbackFailureText } from './MessageFeedbackDialog'

export interface AgentTranscriptProps {
  messages: ChatMessageWithTrace[]
  turns: ReturnType<typeof groupIntoTurns>
  editingIndex: number | null
  setEditingIndex: (index: number | null) => void
  editDraft: string
  setEditDraft: (value: string) => void
  streaming: boolean
  copiedIndex: number | null
  copyText: (text: string, index: number) => void | Promise<void>
  regenerate: (index: number) => void | Promise<void>
  projectPath: string | undefined
  canRollback: boolean
  rollbackLastTurn: (projectPath: string) => void | Promise<void>
  /**
   * 刚跳过去的那条消息下标（第 56 批「回合目录」跳转后用一次高亮把落点显出来）。
   * null/undefined = 没有要高亮的；高亮只是视觉效果，不参与任何逻辑。
   */
  highlightIndex?: number | null
}

export function AgentTranscript(props: AgentTranscriptProps): React.ReactNode {
  useLocaleSubscription()
  const {
    messages,
    turns,
    editingIndex,
    setEditingIndex,
    editDraft,
    setEditDraft,
    streaming,
    copiedIndex,
    copyText,
    regenerate,
    projectPath,
    canRollback,
    rollbackLastTurn,
    highlightIndex,
  } = props

  // 反馈表按消息 id 存（第 58 批）：进/切线程时由 ChatPanel 的 loadHistoryFromDisk 整表拉回
  const threadFeedback = useAiStore(state => state.threadFeedback)
  const [feedbackDialog, setFeedbackDialog] = useState<{
    index: number
    messageId: string
    rating: FeedbackRating
    /** 已有反馈：预填上次的分类/说明，换档时不丢内容 */
    initial?: MessageFeedbackItem
  } | null>(null)
  // 行内结果提示（感谢 / 已撤回 / 失败原因），只显示在被点的那条消息下面
  const [feedbackStatus, setFeedbackStatus] = useState<{
    index: number
    text: string
    error: boolean
  } | null>(null)

  /**
   * 点 👍 / 👎：已选中同一档 = 撤回；没选过或换档 = 开弹层选分类写说明。
   *
   * 判定「已选中」按 store 里的**磁盘真相**（threadFeedback）而不是本地状态：
   * 乐观更新失败时 store 会回滚，界面跟着回滚，不会出现"看着选中其实没存"。
   */
  const handleFeedback = (msg: ChatMessageWithTrace, i: number, rating: FeedbackRating) => {
    if (!msg.messageId) {
      setFeedbackStatus({ index: i, text: t('ai.feedback.targetMissing'), error: true })
      return
    }
    if (!projectPath) {
      setFeedbackStatus({ index: i, text: t('ai.feedback.loadFailed'), error: true })
      return
    }
    const existing = threadFeedback[msg.messageId]
    if (existing?.rating === rating) {
      void useAiStore
        .getState()
        .retractMessageFeedback(projectPath, msg.messageId)
        .then(res => {
          setFeedbackStatus(
            res.ok
              ? { index: i, text: t('ai.feedback.retracted'), error: false }
              : { index: i, text: feedbackFailureText(res.error), error: true },
          )
        })
      return
    }
    setFeedbackDialog({
      index: i,
      messageId: msg.messageId,
      rating,
      ...(existing ? { initial: existing } : {}),
    })
  }

  /** 弹层提交：成功才由弹层自己关闭；失败把错误留在弹层里（行内也留一条提示） */
  const submitFeedback = async (payload: {
    category?: FeedbackCategory
    note?: string
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const target = feedbackDialog
    if (!target || !projectPath) return { ok: false, error: 'ipc-missing' }
    const res = await useAiStore
      .getState()
      .putMessageFeedback(projectPath, target.messageId, target.rating, payload)
    setFeedbackStatus(
      res.ok
        ? { index: target.index, text: t('ai.feedback.saved'), error: false }
        : { index: target.index, text: feedbackFailureText(res.error), error: true },
    )
    return res
  }

  return (
    <>
      {turns.map((turn, turnIndex) => {
        const isLastTurn = turnIndex === turns.length - 1
        const rows = messages.slice(turn.start, turn.end)
        return (
          <div key={turn.key} className="mb-5">
            {rows.map((msg, offset) => {
              const i = turn.start + offset
              const isLast = i === messages.length - 1
              const highlighted = highlightIndex === i
              return (
                <div
                  key={`msg-${i}`}
                  // 消息锚点（第 56 批「回合目录」跳转用）：id 口径 = 消息数组下标，
                  // 与 buildTurnOutline 的 userIndex 严格同源，中间不另做映射。
                  id={`ai-msg-${i}`}
                  className={`group scroll-mt-3 rounded-lg transition-colors duration-500 ${
                    highlighted ? 'bg-sky-400/5 ring-2 ring-inset ring-sky-400/60' : ''
                  }`}
                >
                  <MessageBubble msg={msg} />
                  {editingIndex === i && (
                    <InlineEditBox
                      role={msg.role}
                      content={msg.content}
                      projectPath={projectPath}
                      draft={editDraft}
                      onDraftChange={setEditDraft}
                      onClose={() => setEditingIndex(null)}
                    />
                  )}
                  {!streaming && editingIndex !== i && (
                    <MessageActions
                      role={msg.role}
                      index={i}
                      copied={copiedIndex === i}
                      canEdit={msg.role === 'user'}
                      showRegenerate={isLast && isLastTurn && msg.role === 'assistant'}
                      showRollback={isLast && isLastTurn && msg.role === 'assistant' && canRollback}
                      alwaysVisible={isLast && isLastTurn}
                      feedback={msg.messageId ? threadFeedback[msg.messageId] : undefined}
                      feedbackEnabled={msg.role === 'assistant' && !!msg.messageId}
                      onFeedback={rating => handleFeedback(msg, i, rating)}
                      onEdit={() => {
                        setEditingIndex(i)
                        setEditDraft(msg.content)
                      }}
                      onCopy={() => void copyText(msg.content, i)}
                      onRegenerate={() => void regenerate(i)}
                      onRollback={() => {
                        if (projectPath) void rollbackLastTurn(projectPath)
                      }}
                    />
                  )}
                  {feedbackStatus && feedbackStatus.index === i && (
                    <div
                      role="status"
                      className={`-mt-2 mb-3 pl-8 text-[11px] ${
                        feedbackStatus.error ? 'text-rose-400' : 'text-zinc-500'
                      }`}
                    >
                      {feedbackStatus.text}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {feedbackDialog && (
        <MessageFeedbackDialog
          rating={feedbackDialog.rating}
          initial={feedbackDialog.initial}
          onSubmit={submitFeedback}
          onClose={() => setFeedbackDialog(null)}
        />
      )}
    </>
  )
}
