// src/renderer/src/components/ai/MessageActions.tsx
//
// **消息操作行**（从 ChatPanel 拆出，2026-10-19）：编辑（仅自己的消息）/ 复制 / 重新生成 / 撤回这一轮。
// 位置**跟消息同侧**：自己的靠右、AI 的靠左（原先一律左对齐，用户说"放错了"）。
//
// 编辑语义刻意是"放回输入框"而不是"改了就重跑"：对话记忆是追加式磁盘文件，
// 中间那条一改，界面与模型记得的东西就对不上 —— 比不给编辑更糟。
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import type { FeedbackRating, MessageFeedbackItem } from '@shared/ai/messageFeedback'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

export function MessageActions({
  role,
  index,
  copied,
  canEdit,
  showRegenerate,
  showRollback,
  alwaysVisible = false,
  feedback,
  feedbackEnabled = false,
  onFeedback,
  onEdit,
  onCopy,
  onRegenerate,
  onRollback,
}: {
  role: 'user' | 'assistant' | 'system' | string
  index: number
  copied: boolean
  canEdit: boolean
  showRegenerate: boolean
  showRollback: boolean
  /** 最新一条常驻显示；更早的消息悬停/聚焦才出现（对齐 DSH 的消息操作行） */
  alwaysVisible?: boolean
  /** 这条消息当前的反馈（没有 = 还没反馈过；再点同一档由上层解释为撤回） */
  feedback?: MessageFeedbackItem
  /** 是否显示 👍 / 👎（只有已落盘的 assistant 消息才给） */
  feedbackEnabled?: boolean
  onFeedback?: (rating: FeedbackRating) => void
  onEdit: () => void
  onCopy: () => void
  onRegenerate: () => void
  onRollback: () => void
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  return (
    <div
      className={`flex items-center gap-1.5 -mt-1 mb-3 text-[11px] text-zinc-500 ${
        role === 'user' ? 'justify-end pr-8' : 'pl-8'
      } ${
        alwaysVisible
          ? ''
          : 'opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'
      }`}
    >
      {/**
       * 图标按钮（对齐 DSH 的消息操作行）：28px 命中区、静息只有图标，
       * 文案在 title / aria-label 里 —— 一行四个动作不再抢正文注意力。
       */}
      {canEdit && (
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800/60 hover:text-zinc-300"
          title={t('ai.chat.editTitle')}
          aria-label={t('ai.chat.edit')}
          onClick={onEdit}
        >
          ✎
        </button>
      )}
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800/60 hover:text-zinc-300"
        title={copied ? t('ai.chat.copied') : t('ai.chat.copyTitle')}
        aria-label={copied ? t('ai.chat.copied') : t('ai.chat.copy')}
        onClick={onCopy}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {/**
       * 反馈（第 58 批）：两档按钮夹在复制与重新生成之间 —— 它评的是"这条回答"，
       * 跟复制同属"对这条消息本身的操作"，而重新生成会换掉这条消息。
       * 选中态**实心**（fill=currentColor + 底色），否则悬停前只有灰图标。
       */}
      {feedbackEnabled && onFeedback && (
        <>
          <button
            type="button"
            className={`inline-flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800/60 ${
              feedback?.rating === 'positive'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'hover:text-emerald-300'
            }`}
            data-active={feedback?.rating === 'positive' ? 'true' : undefined}
            aria-pressed={feedback?.rating === 'positive'}
            title={t('ai.feedback.goodAria')}
            aria-label={t('ai.feedback.goodAria')}
            onClick={() => onFeedback('positive')}
          >
            <ThumbsUp size={13} fill={feedback?.rating === 'positive' ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className={`inline-flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800/60 ${
              feedback?.rating === 'negative'
                ? 'bg-rose-500/15 text-rose-300'
                : 'hover:text-rose-300'
            }`}
            data-active={feedback?.rating === 'negative' ? 'true' : undefined}
            aria-pressed={feedback?.rating === 'negative'}
            title={t('ai.feedback.badAria')}
            aria-label={t('ai.feedback.badAria')}
            onClick={() => onFeedback('negative')}
          >
            <ThumbsDown
              size={13}
              fill={feedback?.rating === 'negative' ? 'currentColor' : 'none'}
            />
          </button>
        </>
      )}
      {showRegenerate && (
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800/60 hover:text-sky-300"
          title={t('ai.chat.regenerateTitle')}
          aria-label={t('ai.chat.regenerate')}
          onClick={onRegenerate}
        >
          ↻
        </button>
      )}
      {showRollback && (
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800/60 hover:text-amber-300"
          title={t('ai.chat.rollbackTitle')}
          aria-label={t('ai.chat.rollbackTitle')}
          onClick={onRollback}
        >
          ↺
        </button>
      )}
    </div>
  )
}
