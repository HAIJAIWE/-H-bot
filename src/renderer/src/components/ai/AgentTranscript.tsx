// src/renderer/src/components/ai/AgentTranscript.tsx
//
// **消息流本体**（从 ChatPanel 拆出，2026-10-19）：按轮迭代 → 折叠行 / 气泡 / 编辑框 / 操作行。
// 拆的时候把"展开规则"一起搬走：最后一轮永远展开；编辑中的那条强制展开（否则编辑框看不见）。
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import type { ChatMessageWithTrace, ToolCallRecord } from '../../stores/aiStore';
import { groupIntoTurns, turnPreview } from '../../lib/ai/turnGrouping';
import { TurnFoldHeader } from './TurnFoldHeader';
import { MessageBubble } from './MessageBubble';
import { InlineEditBox } from './InlineEditBox';
import { MessageActions } from './MessageActions';

export interface AgentTranscriptProps {
  messages: ChatMessageWithTrace[];
  turns: ReturnType<typeof groupIntoTurns>;
  turnAt: number[];
  turnOpen: Record<string, boolean>;
  setTurnOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingIndex: number | null;
  setEditingIndex: (index: number | null) => void;
  editDraft: string;
  setEditDraft: (value: string) => void;
  streaming: boolean;
  toolCalls: ToolCallRecord[];
  copiedIndex: number | null;
  copyText: (text: string, index: number) => void | Promise<void>;
  regenerate: (index: number) => void | Promise<void>;
  projectPath: string | undefined;
  canRollback: boolean;
  rollbackLastTurn: (projectPath: string) => void | Promise<void>;
}

export function AgentTranscript(props: AgentTranscriptProps): React.ReactNode {
  useLocaleSubscription();
  const {
    messages,
    turns,
    turnAt,
    turnOpen,
    setTurnOpen,
    editingIndex,
    setEditingIndex,
    editDraft,
    setEditDraft,
    streaming,
    toolCalls,
    copiedIndex,
    copyText,
    regenerate,
    projectPath,
    canRollback,
    rollbackLastTurn,
  } = props;

  return (
    <>
      {messages.map((msg, i) => {
        // 工具调用卡片只挂载到最新一条消息上，避免每条消息都重复渲染同一组 toolCalls
        const isLast = i === messages.length - 1;
        const turn = turns[turnAt[i]];
        const isLastTurn = turnAt[i] === turns.length - 1;
        /**
         * 展开规则：**最后一轮永远展开**（那是用户正在看的）；老的默认收成一行。
         * 正在就地编辑的那条如果藏在折叠里，强制展开 —— 否则编辑框看不见。
         */
        const expanded =
          isLastTurn ||
          (turnOpen[turn.key] ?? false) ||
          (editingIndex !== null && editingIndex >= turn.start && editingIndex < turn.end);
        // group：操作行在更早的消息上悬停/聚焦才出现（最新一条常驻）
        return (
          <div key={`msg-${i}`} className="group">
            {/* 折叠行的位置：落在这一轮的**第一条消息**前面（不是每条都挂） */}
            {turn.start === i && !isLastTurn && (
              <TurnFoldHeader
                expanded={expanded}
                preview={turnPreview(messages[turn.userIndex ?? turn.start]?.content ?? '')}
                replies={turn.replies}
                tools={turn.tools}
                onToggle={() => setTurnOpen((prev) => ({ ...prev, [turn.key]: !expanded }))}
              />
            )}
            {expanded && (
              <>
                <MessageBubble msg={msg} toolCalls={isLast ? toolCalls : undefined} />
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
                    showRegenerate={isLast && msg.role === 'assistant'}
                    showRollback={isLast && msg.role === 'assistant' && canRollback}
                    alwaysVisible={isLast}
                    onEdit={() => {
                      setEditingIndex(i);
                      setEditDraft(msg.content);
                    }}
                    onCopy={() => void copyText(msg.content, i)}
                    onRegenerate={() => void regenerate(i)}
                    onRollback={() => {
                      if (projectPath) void rollbackLastTurn(projectPath);
                    }}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
