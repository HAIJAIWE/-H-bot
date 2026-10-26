// src/renderer/src/components/ai/TurnOutlineDrawer.tsx
//
// 「回合目录」抽屉（第 56 批 Phase C，对照 DSH `session-turn-outline`）。
//
// ## 为什么要有它
//
// 一条长对话里，用户想回到**第 3 轮那个需求**时只能在消息流里翻 —— 滚动条不标注，
// 搜索又搜不回结构。这里把「每条用户消息 = 一轮」做成目录：点一轮就滚到那条消息。
//
// ## 口径
//
// 目录**不自己算**：`buildTurnOutline(messages)` 是共享纯函数（主进程/测试也用同一份），
// 截断（prompt 50 / response 120）全在那边；这里只负责画和一跳。
// 锚点 id 由 `AgentTranscript` 给每条消息容器挂 `ai-msg-<下标>` —— 与消息数组**同索引口径**，
// 所以 `userIndex` 可以直接拼 id，不需要别的映射。
import { useEffect, useMemo } from 'react'
import { ListOrdered, X } from 'lucide-react'
import type { ChatMessageWithTrace } from '../../stores/aiStore'
import { buildTurnOutline } from '@shared/ai/turnOutline'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

export interface TurnOutlineDrawerProps {
  open: boolean
  /** 与 ChatPanel 的 `messages` **同一个数组**（锚点按同一套下标算） */
  messages: readonly ChatMessageWithTrace[]
  /** 当前视口里那轮的用户消息下标；null = 还没开始/空对话 */
  activeUserIndex: number | null
  /** 点一轮：滚到 `ai-msg-<userIndex>`（滚动与高亮由 ChatPanel 做） */
  onJump: (userIndex: number) => void
  onClose: () => void
}

export function TurnOutlineDrawer({
  open,
  messages,
  activeUserIndex,
  onJump,
  onClose,
}: TurnOutlineDrawerProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const outline = useMemo(() => buildTurnOutline(messages), [messages])

  // Esc 关闭：**捕获阶段**拦下来，别让 Esc 继续冒泡到 ChatPanel
  // （那里 Esc 是"停流/清输入"，抽屉开着时用户想关的显然是抽屉）
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      data-testid="turn-outline-overlay"
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      {/* 面板自己吃掉点击：点内容和点遮罩不是一回事 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('ai.turnOutline.title')}
        className="my-6 mr-10 flex max-h-[calc(100vh-3rem)] w-80 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <ListOrdered size={14} className="shrink-0 text-zinc-500" />
          <span className="flex-1 truncate text-xs font-medium text-zinc-200">
            {t('ai.turnOutline.title')}
          </span>
          <button
            type="button"
            onClick={onClose}
            title={t('ai.turnOutline.close')}
            aria-label={t('ai.turnOutline.close')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
          {outline.length === 0 ? (
            // 空态：还没发过言（或只有系统/助手消息）时也要说清楚，不能只留一块空白
            <div className="px-2 py-6 text-center text-xs text-zinc-500">
              {t('ai.turnOutline.empty')}
            </div>
          ) : (
            outline.map(entry => {
              const active = entry.userIndex === activeUserIndex
              return (
                <button
                  key={entry.turn}
                  type="button"
                  onClick={() => {
                    onJump(entry.userIndex)
                    // 跳完就收起：抽屉盖着消息区，不收起就看不到落点
                    onClose()
                  }}
                  aria-label={t('ai.turnOutline.jump', { n: entry.turn })}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors ${
                    active
                      ? 'bg-blue-500/10 text-blue-200 ring-1 ring-inset ring-blue-500/40'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] tabular-nums text-zinc-500">
                      {t('ai.turnOutline.turn', { n: entry.turn })}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 break-words text-zinc-300">
                    {entry.prompt}
                  </div>
                  {entry.response && (
                    <div className="mt-0.5 line-clamp-2 break-words text-zinc-500">
                      {entry.response}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-600">
          {t('ai.turnOutline.hint')}
        </div>
      </div>
    </div>
  )
}
