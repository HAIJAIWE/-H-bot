// src/renderer/src/components/ai/TurnFoldHeader.tsx
//
// **折叠行**（从 ChatPanel 拆出，2026-10-18）：落在每一轮的**第一条消息**前面（不是每条都挂）。
// 显示这一轮的用户问题摘要 + "N 条回复 · M 次工具"，点击展开/收起。
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function TurnFoldHeader({
  expanded,
  preview,
  replies,
  tools,
  onToggle,
}: {
  expanded: boolean;
  /** 这一轮用户那句话的摘要（空则显示占位） */
  preview: string;
  replies: number;
  tools: number;
  onToggle: () => void;
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  return (
    <button
      type="button"
      className="mb-2 flex w-full items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-left text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={t('ai.turns.toggle')}
    >
      <span>{expanded ? '▾' : '▸'}</span>
      <span className="truncate">{preview || t('ai.turns.empty')}</span>
      <span className="ml-auto shrink-0">
        {t('ai.turns.meta', { replies: String(replies), tools: String(tools) })}
      </span>
    </button>
  );
}
