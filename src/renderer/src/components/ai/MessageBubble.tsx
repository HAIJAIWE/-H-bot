// src/renderer/src/components/ai/MessageBubble.tsx
//
// **一条消息**（2026-10-25 按 DSH 重排）：用户 = 右对齐气泡，助手 = 整栏正文，
// **两边都没有头像** —— DSH 用对齐与底色区分说话人，"AI / U" 圆点只是噪音，
// 窄右栏里它还各占 24px。助手头上先挂一条「过程行」（思考与工具收在里面），再是正文。
// 系统回执的隐藏规则与压缩提示的分隔线样式都留在这里（真机踩过：把错误横幅一起藏了）。
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import type { ChatMessageWithTrace, ToolCallRecord, ToolTraceEntry } from '../../stores/aiStore'
import { AI_TURN_NOTE_PREFIX } from '@shared/types/ai'
import { MiniMarkdown } from '../ui/MiniMarkdown'
import { ZoomableImage } from '../ui/ZoomableImage'
import { ToolCallCard } from './ToolRows'
import { ReasoningRow } from './ReasoningRow'
import { TurnProcess } from './TurnProcess'

/** 历史痕迹 → 工具行（痕迹里不会有 pending，那是运行中的临时态） */
function recordsOfTrace(trace: readonly ToolTraceEntry[]): ToolCallRecord[] {
  return trace.map(entry => ({
    id: entry.id,
    name: entry.name,
    args: entry.args,
    status: entry.status === 'pending' ? 'done' : entry.status,
    result: entry.result,
    timestamp: 0,
  }))
}

export function MessageBubble({ msg }: { msg: ChatMessageWithTrace }): React.ReactNode {
  useLocaleSubscription()
  const isSystem = msg.role === 'system'

  /**
   * system 消息里**只有「给模型看的回执」该藏**（`[系统回执] …` 是主进程写进记忆的）。
   * ⚠️ 不能写成 `if (isSystem) return null` —— 错误/警告横幅也是 system，
   * 一起藏掉的结果是"模型调用失败时界面一片空白"（2026-10-08 真机 403 事件）。
   */
  if (isSystem && msg.content.startsWith(AI_TURN_NOTE_PREFIX)) return null

  /**
   * **压缩提示**不是警告（2026-10-25）：走系统消息那条路会被画成琥珀色横幅，
   * 看着像出了错。它其实是一条"分隔线式的说明"—— 用上方细线收住，
   * 与"这里以前还有内容"的语义一致。
   */
  if (msg.notice === 'compaction') {
    return (
      <div className="mb-3 border-t border-zinc-800 pt-2 text-center text-[11px] break-words text-zinc-500 select-none">
        {msg.content}
      </div>
    )
  }
  if (isSystem) {
    return (
      <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 break-words whitespace-pre-wrap">
        {msg.content}
      </div>
    )
  }

  const images = msg.images && msg.images.length > 0 && (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {msg.images.map((src, i) => (
        <ZoomableImage
          key={i}
          src={src}
          className="max-h-28 max-w-full rounded border border-zinc-500/40"
        />
      ))}
    </div>
  )

  if (msg.role === 'user') {
    return (
      <div className="mb-2 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-700 px-3.5 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-white">
          {images}
          {msg.content || t('ai.tool.empty')}
        </div>
      </div>
    )
  }

  const records = recordsOfTrace(msg.trace ?? [])
  return (
    <div className="mb-1">
      {(msg.reasoning || records.length > 0) && (
        <TurnProcess tools={records.length} {...(msg.turnMs ? { elapsedMs: msg.turnMs } : {})}>
          {msg.reasoning && <ReasoningRow text={msg.reasoning} />}
          {records.map(tc => (
            <ToolCallCard key={tc.id} call={tc} />
          ))}
        </TurnProcess>
      )}
      <div className="w-full text-sm leading-6 break-words text-zinc-200">
        {msg.content ? (
          <MiniMarkdown content={msg.content} />
        ) : records.length > 0 ? null : (
          t('ai.tool.empty')
        )}
      </div>
    </div>
  )
}

/**
 * 流式正文：与助手消息同一套排版（整栏正文 + 光标）。
 *
 * 思考与工具**不在这里** —— 它们在 ChatPanel 的 `TurnProcess`（运行中那一轮）里，
 * 与历史轮的排版完全一致；否则同一条思考在"跑的时候"和"跑完以后"会长得不一样。
 */
export function StreamingBubble({ text }: { text: string }): React.ReactNode {
  useLocaleSubscription()
  return (
    <div className="mb-1 w-full text-sm leading-6 break-words text-zinc-200">
      <MiniMarkdown content={text} />
      <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-400 align-text-bottom" />
    </div>
  )
}
