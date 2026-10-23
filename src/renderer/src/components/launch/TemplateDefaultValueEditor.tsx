// src/renderer/src/components/launch/TemplateDefaultValueEditor.tsx
//
// 默认值编辑器（子组件）：按字段类型选控件，值在**输入框字符串**与**存储值**之间转换。

import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import type { TemplateField } from '../../types/ipc';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { inputBase } from '../ui/inputStyles';
import { defaultToInput, inputToDefault } from './templateFieldModel';

// ─── 默认值编辑器 ──────────────────────────────────────────────────────────────

export function DefaultValueEditor({
  type,
  value,
  onChange,
  options,
}: {
  type: TemplateField['type'];
  value: unknown;
  onChange: (v: unknown) => void;
  options?: { value: string; label: string }[];
}) {
  useLocaleSubscription();
  const inputStr = defaultToInput(value, type);
  if (type === 'boolean') {
    const boolVal = value === true || value === 'true';
    return (
      <div className="flex gap-2">
        <Button
          type="button"
          variant={boolVal ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onChange(true)}
        >
          {t('data.yes')}
        </Button>
        <Button
          type="button"
          variant={!boolVal ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onChange(false)}
        >
          {t('data.no')}
        </Button>
      </div>
    );
  }
  if (type === 'enum') {
    return (
      <Dropdown
        value={inputStr}
        onChange={onChange}
        options={(options ?? []).map((opt) => ({ value: opt.value, label: opt.label }))}
        placeholder={t('launch.common.pleaseSelect')}
      />
    );
  }
  if (type === 'json') {
    return (
      <textarea
        className={`w-full ${inputBase} font-mono`}
        rows={4}
        value={inputStr}
        aria-label={t('data.common.defaultJson')}
        onChange={(e) => onChange(inputToDefault(e.target.value, type))}
        placeholder="{}"
      />
    );
  }
  if (type === 'number') {
    return (
      <input
        type="number"
        className={`w-full ${inputBase}`}
        value={inputStr}
        aria-label={t('data.common.defaultNumber')}
        onChange={(e) => onChange(inputToDefault(e.target.value, type))}
      />
    );
  }
  if (type === 'date') {
    return (
      <input
        type="date"
        className={`w-full ${inputBase}`}
        value={inputStr}
        aria-label={t('data.common.defaultDate')}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (type === 'datetime') {
    return (
      <input
        type="text"
        className={`w-full ${inputBase}`}
        value={inputStr}
        aria-label={t('data.common.defaultDatetime')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('data.common.datetimePlaceholder')}
      />
    );
  }
  // text
  return (
    <input
      type="text"
      className={`w-full ${inputBase}`}
      value={inputStr}
      aria-label={t('data.common.defaultText')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
