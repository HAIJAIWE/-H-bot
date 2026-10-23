// src/renderer/src/components/launch/TemplateIconPicker.tsx
//
// 图标选择器（子组件）：可选图标来自 `templateFieldOptions`。

import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { Button } from '../ui/Button';
import { ICON_OPTIONS } from './templateFieldOptions';
import { useId, useState } from 'react';

// ─── 图标选择器 ────────────────────────────────────────────────────────────────

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  useLocaleSubscription();
  const [open, setOpen] = useState(false);
  // useId 生成稳定 id，供 aria-controls 关联按钮与弹出网格
  const panelId = useId();
  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        className="w-9 h-9 border border-zinc-700 text-lg"
        onClick={() => setOpen((v) => !v)}
        title={t('data.common.selectIcon')}
        aria-label={t('data.common.selectIcon')}
        aria-expanded={open}
        aria-haspopup="grid"
        aria-controls={panelId}
      >
        {value || '?'}
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            role="presentation"
            aria-hidden="true"
          />
          <div
            id={panelId}
            role="grid"
            aria-label={t('data.common.optionalIcon')}
            className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg p-2 grid grid-cols-5 gap-1 w-56 shadow-xl"
          >
            {ICON_OPTIONS.map((icon) => (
              <Button
                key={icon}
                type="button"
                variant="secondary"
                className={`w-8 h-8 text-lg ${value === icon ? 'bg-blue-600/40 ring-1 ring-blue-500' : ''}`}
                onClick={() => {
                  onChange(icon);
                  setOpen(false);
                }}
                aria-label={t('data.common.selectIconAria', { icon })}
                aria-pressed={value === icon}
              >
                {icon}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
