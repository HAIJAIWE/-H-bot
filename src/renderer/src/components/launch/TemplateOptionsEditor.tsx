// src/renderer/src/components/launch/TemplateOptionsEditor.tsx
//
// 选项编辑器（子组件）：`enum` 类型字段的可选值列表。

import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { Button } from '../ui/Button';
import { inputBase } from '../ui/inputStyles';
import { Plus, X } from 'lucide-react';
import { useRef } from 'react';

// ─── 选项编辑器（enum 的 options） ────────────────────────────────────────────

export function OptionsEditor({
  options,
  onChange,
}: {
  options: { value: string; label: string }[];
  onChange: (opts: { value: string; label: string }[]) => void;
}) {
  // 稳定唯一 key：用计数器为每个选项分配 id，避免用数组索引导致删除中间项时输入框错位
  useLocaleSubscription();
  const idsRef = useRef<string[]>([]);
  const counterRef = useRef(0);
  // 同步 ids 长度与 options（首次挂载或外部重置时）
  if (idsRef.current.length !== options.length) {
    if (idsRef.current.length < options.length) {
      while (idsRef.current.length < options.length) {
        counterRef.current += 1;
        idsRef.current.push(`opt_${counterRef.current}`);
      }
    } else {
      idsRef.current = idsRef.current.slice(0, options.length);
    }
  }

  const update = (i: number, field: 'value' | 'label', val: string) => {
    const next = options.map((o, idx) => (idx === i ? { ...o, [field]: val } : o));
    onChange(next);
  };
  const add = () => {
    counterRef.current += 1;
    idsRef.current.push(`opt_${counterRef.current}`);
    onChange([...options, { value: '', label: '' }]);
  };
  const remove = (i: number) => {
    idsRef.current.splice(i, 1);
    onChange(options.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-1.5">
      {options.map((opt, i) => (
        <div key={idsRef.current[i]} className="flex items-center gap-1.5">
          <input
            className={`flex-1 ${inputBase}`}
            placeholder={t('data.field.value')}
            aria-label={t('data.common.enumOptionValueAria', { n: String(i + 1) })}
            value={opt.value}
            onChange={(e) => update(i, 'value', e.target.value)}
          />
          <input
            className={`flex-1 ${inputBase}`}
            placeholder={t('data.common.optionLabel')}
            aria-label={t('data.common.enumOptionLabelAria', { n: String(i + 1) })}
            value={opt.label}
            onChange={(e) => update(i, 'label', e.target.value)}
          />
          <Button
            type="button"
            variant="danger"
            size="sm"
            leftIcon={<X className="w-3 h-3" />}
            onClick={() => remove(i)}
            aria-label={t('data.common.deleteEnumOptionAria', { n: String(i + 1) })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leftIcon={<Plus className="w-3 h-3" />}
        onClick={add}
      >
        {t('launch.common.addOption')}
      </Button>
    </div>
  );
}
