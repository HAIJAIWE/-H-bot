// src/renderer/src/components/ai/MessageBubble.tsx
//
// **消息气泡与流式气泡**（从 ChatPanel 拆出，2026-10-18）。
// 自包含：只吃 msg / toolCalls / 流式文本；系统回执的隐藏规则也在这里（真机踩过：把错误横幅一起藏了）。
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import type { ChatMessageWithTrace, ToolCallRecord } from '../../stores/aiStore'
import { AI_TURN_NOTE_PREFIX } from '@shared/types/ai'
import { MiniMarkdown } from '../ui/MiniMarkdown'
import { ZoomableImage } from '../ui/ZoomableImage'
import { ToolCallCard, ToolTrace } from './ToolRows'

export function MessageBubble({
  msg,
  toolCalls,
}: {
  msg: ChatMessageWithTrace
  toolCalls?: ToolCallRecord[]
}): React.ReactNode {
  useLocaleSubscription()
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'

  /**
   * system 消息里**只有「给模型看的回执」该藏**（`[系统回执] …` 是主进程写进记忆的）。
   * ⚠️ 不能写成 `if (isSystem) return null` —— 错误/警告横幅也是 system，
   * 一起藏掉的结果是"模型调用失败时界面一片空白"（2026-10-08 真机 403 事件）。
   */
  if (isSystem && msg.content.startsWith(AI_TURN_NOTE_PREFIX)) return null

  /**
   * **压缩提示**不是警告（2026-10-25）：走系统消息那条路会被画成琥珀色横幅，
   * 看着像出了错。它其实是一条"分隔线式的说明"—— 用两侧细线收在中间，
   * 与"这里以前还有内容"的语义一致。
   */
  if (msg.notice === 'compaction') {
    return (
      // 上方一条细线当分隔：不靠"左右两条线 + flex-1"—— 窄栏（右栏 200px 上下）里
      // 文字本身就把宽度吃满，两侧线会缩成 0，看着只是段孤立灰字。
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

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''} ${isUser ? 'mb-4' : 'mb-5'}`}>
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
          isUser ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300'
        }`}
      >
        {isUser ? 'U' : 'AI'}
      </div>
      {/*
       * 对齐 DSH 的对话排版：**助手是整栏正文，不是气泡**（14/24 行高、无底色），
       * 只有用户消息用右侧圆角气泡 —— 一眼分得清"谁在说"，又不让每段回复都套个大盒子。
       */}
      <div
        className={`min-w-0 flex flex-col ${isUser ? 'max-w-[85%] items-end' : 'flex-1 items-start'}`}
      >
        <div
          className={`break-words ${
            isUser
              ? 'rounded-2xl bg-blue-700 px-3.5 py-2 text-sm leading-6 text-white rounded-tr-sm whitespace-pre-wrap'
              : 'w-full text-sm leading-6 text-zinc-200'
          }`}
        >
          {msg.images && msg.images.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {msg.images.map((src, i) => (
                <ZoomableImage
                  key={i}
                  src={src}
                  className="max-h-28 max-w-full rounded border border-zinc-500/40"
                />
              ))}
            </div>
          )}
          {!isUser && msg.reasoning && (
            <details className="mb-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-xs">
              <summary className="cursor-pointer select-none text-zinc-500">
                {t('ai.chat.reasoning')}
              </summary>
              <div className="mt-1 whitespace-pre-wrap leading-5 text-zinc-400">
                {msg.reasoning}
              </div>
            </details>
          )}
          {isUser ? (
            msg.content || (msg.toolCalls && msg.toolCalls.length > 0 ? '' : t('ai.tool.empty'))
          ) : msg.content ? (
            <MiniMarkdown content={msg.content} />
          ) : msg.toolCalls && msg.toolCalls.length > 0 ? (
            ''
          ) : (
            t('ai.tool.empty')
          )}
        </div>

        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-1 space-y-1 w-full">
            {toolCalls.map(tc => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        )}

        {msg.trace && msg.trace.length > 0 && <ToolTrace trace={msg.trace} />}
      </div>
    </div>
  )
}

/** 流式输出：与助手消息同一套排版（整栏正文 + 光标），不套气泡 */
export function StreamingBubble({
  text,
  reasoning,
}: {
  text: string
  /** 思考过程（还没出正文时也要看得见"它在想"） */
  reasoning?: string
}): React.ReactNode {
  return (
    <div className="flex gap-2 mb-5">
      <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-300 flex-shrink-0">
        AI
      </div>
      <div className="min-w-0 flex-1 text-sm leading-6 text-zinc-200 break-words">
        {reasoning && (
          <details className="mb-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-xs">
            <summary className="cursor-pointer select-none text-zinc-500">
              {t('ai.chat.reasoning')}
            </summary>
            <div className="mt-1 whitespace-pre-wrap leading-5 text-zinc-400">{reasoning}</div>
          </details>
        )}
        <MiniMarkdown content={text} />
        <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
      </div>
    </div>
  )
}
