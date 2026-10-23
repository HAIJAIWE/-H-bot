// src/renderer/src/components/ai/InstalledPluginsList.tsx
//
// **已安装插件清单**（从 ChatPanel 拆出，2026-10-18）：清单 + 启停 + 能力声明 + 兼容性。
// 自包含（自己的 tick 状态、自己的数据源），ChatPanel 只留一个按钮和弹窗壳。
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { listPlugins, setPluginEnabled } from '../../lib/plugins/api';

export function InstalledPluginsList(): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  const [tick, setTick] = useState(0);
  const plugins = useMemo(() => listPlugins(), [tick]);

  return (
    <>
      {plugins.length === 0 && <p className="text-zinc-500">{t('ai.chat.pluginsEmpty')}</p>}
      {plugins.map((p) => (
        <div key={p.id} className="rounded border border-zinc-700/60 bg-zinc-900/40 p-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-200">{p.name}</span>
            <span className="text-zinc-500">v{p.version}</span>
            <span className="ml-auto font-mono text-[10px] text-zinc-600">{p.id}</span>
            {p.compatible ? (
              <button
                type="button"
                className={
                  p.enabled
                    ? 'shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200'
                    : 'shrink-0 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:text-white'
                }
                onClick={() => {
                  setPluginEnabled(p.id, !p.enabled);
                  setTick((v) => v + 1);
                }}
              >
                {p.enabled ? t('ai.chat.pluginsDisable') : t('ai.chat.pluginsEnable')}
              </button>
            ) : (
              <span className="shrink-0 text-[10px] text-amber-400">
                {t('ai.chat.pluginsIncompatible', { range: p.requires ?? '' })}
              </span>
            )}
          </div>
          {p.description && <p className="mt-0.5 text-zinc-400">{p.description}</p>}
          <p className="mt-1 text-[10px] text-zinc-500">
            {t('ai.chat.pluginsPerms', {
              list: (p.permissions ?? []).join(', ') || t('ai.chat.pluginsNoPerms'),
            })}
          </p>
        </div>
      ))}
    </>
  );
}
