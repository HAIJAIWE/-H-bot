// src/renderer/src/components/ai/AiContextFlyout.tsx
//
// 「上下文洞察」浮层：把「占了多少」拆成「谁占的」。
// 数据来自主进程同一份估算（measureConversation），与状态栏那个百分比同源 —— 不另算。
// 从 AiSidebar 搬出来是为了守住 fileGrowth 的 800 行上限（第 57 批）。
import type { AiRunStats } from '@shared/types/ai'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

export function AiContextFlyout({ stats }: { stats?: AiRunStats }): React.ReactNode {
  // 语言切换要重画（t() 不是 hook，不订阅就停在旧语言）
  useLocaleSubscription()

  return (
    <div className="absolute right-10 top-0 bottom-0 w-64 z-20 min-h-0 flex flex-col bg-zinc-950 border-l border-zinc-800 shadow-2xl">
      <div className="px-2.5 py-2 text-xs text-zinc-500 border-b border-zinc-800 shrink-0">
        {t('ai.sidebar.context')}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3">
        {!stats || stats.contextTokens <= 0 ? (
          <p className="text-[11px] text-zinc-600">{t('ai.context.empty')}</p>
        ) : (
          <>
            <div>
              <div className="text-xs text-zinc-300">
                {t('ai.context.total', {
                  tokens: stats.contextTokens.toLocaleString(),
                  budget: stats.contextBudget.toLocaleString(),
                  percent: String(
                    Math.min(100, Math.round((stats.contextTokens / stats.contextBudget) * 100)),
                  ),
                })}
              </div>
              {stats.contextChars ? (
                <div className="text-[11px] text-zinc-600 mt-0.5">
                  {t('ai.context.chars', { chars: stats.contextChars.toLocaleString() })}
                </div>
              ) : null}
            </div>
            {(stats.contextHeaviest?.length ?? 0) > 0 && (
              <div>
                <div className="text-[11px] text-zinc-500 mb-1.5">{t('ai.context.heaviest')}</div>
                <div className="space-y-1">
                  {stats.contextHeaviest?.map((h, i) => {
                    const max = stats.contextHeaviest?.[0]?.tokens || 1
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-[11px] text-zinc-500">{h.role}</span>
                        <span
                          className="h-1.5 rounded bg-blue-500/50"
                          style={{
                            width: `${Math.max(4, Math.round((h.tokens / max) * 100))}%`,
                          }}
                        />
                        <span className="text-[11px] text-zinc-500 tabular-nums">
                          {h.tokens.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-zinc-600">{t('ai.context.hint')}</p>
          </>
        )}
      </div>
    </div>
  )
}
