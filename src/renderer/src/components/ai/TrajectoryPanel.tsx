// src/renderer/src/components/ai/TrajectoryPanel.tsx
//
// **轨迹视图**（从 ChatPanel 拆出，2026-10-18）：这一轮跑了哪些工具、多久、动过哪些文件。
// 数据全部来自轮次投影（listAiTurns），不新增采集 —— 这里只渲染。
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface TrajectoryView {
  userMessage: string;
  stats?: { fileCount: number; toolCount: number; failedTools: number; ms: number };
  tools?: Array<{ name: string; ok: boolean; ms: number }>;
  files?: Array<{ path: string; change: 'created' | 'modified' }>;
}

export function TrajectoryPanel({
  turnChanges,
}: {
  turnChanges: TrajectoryView | null;
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();

  if (!turnChanges) {
    return (
      <div className="mx-3 mb-2 rounded border border-zinc-700/60 bg-zinc-900/50 p-2 text-[11px] text-zinc-400">
        <div className="py-2 text-zinc-500">{t('ai.chat.trajectoryEmpty')}</div>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 rounded border border-zinc-700/60 bg-zinc-900/50 p-2 text-[11px] text-zinc-400">
      <div className="mb-1 truncate text-zinc-300" title={turnChanges.userMessage}>
        {turnChanges.userMessage}
      </div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-zinc-500">
        <span>
          {t('ai.chat.trajectoryTools', {
            n: String(turnChanges.tools?.length ?? 0),
            s: ((turnChanges.stats?.ms ?? 0) / 1000).toFixed(1),
          })}
        </span>
        <span>{t('ai.chat.trajectoryFiles', { n: String(turnChanges.files?.length ?? 0) })}</span>
      </div>
      {(turnChanges.tools ?? []).length > 0 && (
        <ol className="mb-2 space-y-0.5">
          {(turnChanges.tools ?? []).map((tool, i) => (
            <li key={tool.name + ':' + String(i)} className="flex items-center gap-2">
              <span className={tool.ok ? 'text-emerald-400' : 'text-rose-400'}>
                {tool.ok ? '✓' : '✗'}
              </span>
              <span className="truncate font-mono text-zinc-300">{tool.name}</span>
              <span className="ml-auto shrink-0 text-zinc-600">{tool.ms}ms</span>
            </li>
          ))}
        </ol>
      )}
      {(turnChanges.files ?? []).length > 0 && (
        <ul className="space-y-0.5">
          {(turnChanges.files ?? []).map((f) => (
            <li key={f.path} className="truncate font-mono text-zinc-400">
              {f.change === 'created' ? '+' : '~'} {f.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
