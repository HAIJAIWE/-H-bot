// src/renderer/src/components/ai/TurnChangesCard.tsx
//
// **本轮改动卡**（从 ChatPanel 拆出，2026-10-18）：改了哪些文件、+/- 多少行、跑了几个工具、多久。
// 数据来自轮次投影（见 flow/turnProjection.ts），这里只渲染。
import { useState } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface TurnChangesView {
  userMessage: string;
  changes: Array<{ path: string; kind: string; added: number; removed: number; exact: boolean }>;
  stats?: { fileCount: number; toolCount: number; failedTools: number; ms: number };
}

export function TurnChangesCard({
  turnChanges,
}: {
  turnChanges: TurnChangesView | null;
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  const [open, setOpen] = useState(true);
  if (!turnChanges || turnChanges.changes.length === 0) return null;

  return (
    <div className="mx-3 mt-2 rounded border border-zinc-700/60 bg-zinc-900/50">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-zinc-300 hover:text-zinc-100"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span className="font-medium">
          {t('ai.turnChanges.title', { n: String(turnChanges.changes.length) })}
        </span>
        {turnChanges.stats && turnChanges.stats.toolCount > 0 && (
          <span className="shrink-0 text-zinc-500">
            {t('ai.turnChanges.tools', {
              n: String(turnChanges.stats.toolCount),
              failed:
                turnChanges.stats.failedTools > 0
                  ? t('ai.turnChanges.failedPart', {
                      n: String(turnChanges.stats.failedTools),
                    })
                  : '',
              s: (turnChanges.stats.ms / 1000).toFixed(1),
            })}
          </span>
        )}
        <span className="ml-auto text-emerald-400">
          +{turnChanges.changes.reduce((s, c) => s + c.added, 0)}
        </span>
        <span className="text-rose-400">
          -{turnChanges.changes.reduce((s, c) => s + c.removed, 0)}
        </span>
      </button>
      {open && (
        <ul className="border-t border-zinc-700/40">
          {turnChanges.changes.map((c) => (
            <li
              key={c.kind + ':' + c.path}
              className="flex items-center gap-2 px-2 py-1 text-[11px] text-zinc-400"
            >
              <span className="truncate" title={c.path}>
                {c.path}
              </span>
              <span className="ml-auto shrink-0">
                {c.exact ? (
                  <>
                    <span className="text-emerald-400">+{c.added}</span>{' '}
                    <span className="text-rose-400">-{c.removed}</span>
                  </>
                ) : (
                  <span className="text-zinc-500">{t('ai.turnChanges.notCounted')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
