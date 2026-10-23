// src/renderer/src/components/ai/ExternalPluginsSection.tsx
//
// **外部插件区**（从 ChatPanel 拆出，2026-10-18）：v0 只做"看清单 + 确认 + 记录 + 卸载"。
// 不执行任何外部代码 —— 执行器要等沙箱那一版（见 docs/ai/plugin-system.md §9）。
//
// 拆出来的理由：ChatPanel 已经 1962 行，这块是**自包含的**（自己的状态、自己的数据），
// 是最容易先搬走的一块；搬走时行为一行没变。
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { useLocaleSubscription } from '../../stores/i18nStore';
import {
  installExternalPlugin,
  listExternalPlugins,
  parseExternalManifest,
  uninstallExternalPlugin,
} from '../../lib/plugins/external';

export function ExternalPluginsSection(): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  const [tick, setTick] = useState(0);
  const [manifestText, setManifestText] = useState('');
  const externalPlugins = useMemo(() => listExternalPlugins(), [tick]);

  return (
    <div className="mt-3 border-t border-zinc-800 pt-2">
      <p className="mb-1 text-[11px] text-zinc-400">
        {t('ai.chat.pluginsExternal', { n: String(externalPlugins.length) })}
      </p>
      {externalPlugins.map((r) => (
        <div
          key={r.manifest.id}
          className="mb-1 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-2 py-1"
        >
          <span className="truncate text-zinc-300">{r.manifest.name}</span>
          <span className="shrink-0 text-zinc-500">v{r.manifest.version}</span>
          <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
            {t('ai.chat.pluginsNotExecutable')}
          </span>
          <button
            type="button"
            className="shrink-0 text-[10px] text-rose-400 hover:text-rose-300"
            onClick={() => {
              uninstallExternalPlugin(r.manifest.id);
              setTick((v) => v + 1);
            }}
          >
            {t('ai.chat.pluginsRemove')}
          </button>
        </div>
      ))}
      <textarea
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none"
        rows={3}
        value={manifestText}
        onChange={(e) => setManifestText(e.target.value)}
        placeholder={t('ai.chat.pluginsPasteManifest')}
      />
      <div className="mt-1 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const parsed = parseExternalManifest(manifestText);
            if (!parsed.ok) {
              toast.error(t('ai.chat.pluginsBadManifest', { error: parsed.error }));
              return;
            }
            installExternalPlugin(parsed.manifest, parsed.slots);
            setManifestText('');
            setTick((v) => v + 1);
          }}
        >
          {t('ai.chat.pluginsInstall')}
        </Button>
        <span className="text-[10px] text-zinc-500">{t('ai.chat.pluginsNotExecutable')}</span>
      </div>
    </div>
  );
}
