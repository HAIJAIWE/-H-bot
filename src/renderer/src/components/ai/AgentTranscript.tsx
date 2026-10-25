// src/renderer/src/components/ai/AgentTranscript.tsx
//
// **消息流本体**（从 ChatPanel 拆出 2026-10-19；2026-10-25 按 DSH 重排为"按轮"）：
// 每一轮一个容器（用户气泡 + 过程行 + 助手正文 + 操作行），不再把整轮折成一行 ——
// DSH 的历史是**一直展开**的，折叠只发生在"过程"这一层（见 TurnProcess）。
import { useLocaleSubscription } from '../../stores/i18nStore'
import type { ChatMessageWithTrace } from '../../stores/aiStore'
import type { groupIntoTurns } from '../../lib/ai/turnGrouping'
import { MessageBubble } from './MessageBubble'
import { InlineEditBox } from './InlineEditBox'
import { MessageActions } from './MessageActions'

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
  } = props

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
              return (
                <div key={`msg-${i}`} className="group">
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
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
