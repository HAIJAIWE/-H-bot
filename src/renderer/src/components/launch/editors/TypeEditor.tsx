import { useState, useEffect } from 'react';
import { BaseType, CompositeTypeDef, FieldConfig, TypeRegistry } from '@shared/types/typeSystem';
import { Dropdown } from '../../ui/Dropdown';
import { Switch } from '../../ui/Switch';
import { useStableKeys } from '../../../hooks/useStableKeys';
import { Button } from '../../ui/Button';
import { inputBase, inputXs as inputSm } from '../../ui/inputStyles';
import { X } from 'lucide-react';
import { t } from '../../../i18n';
import { useLocaleSubscription } from '../../../stores/i18nStore';

export interface EditorProps {
  value: unknown;
  onChange: (val: unknown) => void;
  field: FieldConfig;
}

// ---- 基础编辑器 ----

export function IntEditor({ value, onChange, field }: EditorProps) {
  const numVal = typeof value === 'number' ? value : NaN;
  return (
    <input
      type="number"
      className={`w-full ${inputBase}`}
      value={isNaN(numVal) ? 0 : numVal}
      min={field.min}
      max={field.max}
      step={1}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
    />
  );
}

export function BigIntEditor({ value, onChange }: EditorProps) {
  const strVal = String(value ?? 0);
  return (
    <input
      type="number"
      className={`w-full ${inputBase}`}
      value={strVal}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
    />
  );
}

export function FloatEditor({ value, onChange, field }: EditorProps) {
  const step = field.step ?? 0.1;
  const numVal = typeof value === 'number' ? value : NaN;
  return (
    <input
      type="number"
      className={`w-full ${inputBase}`}
      value={isNaN(numVal) ? 0 : numVal}
      min={field.min}
      max={field.max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        onChange(isNaN(v) ? 0 : parseFloat(v.toFixed(field.precision ?? 2)));
      }}
    />
  );
}

export function StringEditor({ value, onChange, field }: EditorProps) {
  const strVal = value as string;
  return (
    <input
      type="text"
      className={`w-full ${inputBase}`}
      value={strVal ?? ''}
      maxLength={field.maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextEditor({ value, onChange, field }: EditorProps) {
  const strVal = value as string;
  return (
    <textarea
      className={`w-full ${inputBase} resize-y`}
      value={strVal ?? ''}
      rows={field.rows ?? 3}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function BoolEditor({ value, onChange }: EditorProps) {
  return <Switch checked={!!value} onChange={(checked) => onChange(checked)} />;
}

export function EnumEditor({ value, onChange, field }: EditorProps) {
  useLocaleSubscription();
  const opts = (field.enumValues ?? []).map((opt) => ({ value: opt, label: opt }));
  return (
    <Dropdown
      value={(value as string) ?? ''}
      onChange={onChange}
      options={opts}
      placeholder={t('launch.common.pleaseSelect')}
    />
  );
}

export function DateTimeEditor({ value, onChange }: EditorProps) {
  return (
    <input
      type="datetime-local"
      className={`w-full ${inputBase}`}
      value={value ? String(value).slice(0, 16) : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function DurationEditor({ value, onChange }: EditorProps) {
  useLocaleSubscription();
  const totalSec = (value as number) ?? 0;
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const [d, setD] = useState(days);
  const [h, setH] = useState(hours);
  const [m, setM] = useState(mins);
  const [s, setS] = useState(secs);

  // prop 变化时同步本地 state：原实现只在首次挂载时取 prop，
  // 外部（如切换行）修改 value 后本地 state 不更新，显示旧值
  useEffect(() => {
    setD(days);
    setH(hours);
    setM(mins);
    setS(secs);
  }, [totalSec]); // eslint-disable-line react-hooks/exhaustive-deps -- 派生值 days/hours/mins/secs 由 totalSec 决定

  const update = (dd: number, hh: number, mm: number, ss: number) => {
    onChange(dd * 86400 + hh * 3600 + mm * 60 + ss);
  };

  return (
    <div className="flex gap-1 items-center">
      <input
        type="number"
        className={`w-12 ${inputSm}`}
        value={d}
        min={0}
        onChange={(e) => {
          const v = parseInt(e.target.value) || 0;
          setD(v);
          update(v, h, m, s);
        }}
      />
      <span className="text-zinc-500 text-xs">{t('launch.unit.day')}</span>
      <input
        type="number"
        className={`w-10 ${inputSm}`}
        value={h}
        min={0}
        max={23}
        onChange={(e) => {
          const v = parseInt(e.target.value) || 0;
          setH(v);
          update(d, v, m, s);
        }}
      />
      <span className="text-zinc-500 text-xs">{t('launch.unit.hour')}</span>
      <input
        type="number"
        className={`w-10 ${inputSm}`}
        value={m}
        min={0}
        max={59}
        onChange={(e) => {
          const v = parseInt(e.target.value) || 0;
          setM(v);
          update(d, h, v, s);
        }}
      />
      <span className="text-zinc-500 text-xs">{t('launch.unit.minute')}</span>
      <input
        type="number"
        className={`w-10 ${inputSm}`}
        value={s}
        min={0}
        max={59}
        onChange={(e) => {
          const v = parseInt(e.target.value) || 0;
          setS(v);
          update(d, h, m, v);
        }}
      />
      <span className="text-zinc-500 text-xs">{t('launch.unit.second')}</span>
    </div>
  );
}

export function ListEditor({ value, onChange, field }: EditorProps) {
  useLocaleSubscription();
  const items = (value as unknown[]) ?? [];
  const [itemKeys, removeItemKey] = useStableKeys(items.length);
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={itemKeys[i]} className="flex gap-1 items-center">
          <div className="flex-1">
            <TypeEditor
              value={item}
              onChange={(val) => {
                const n = [...items];
                n[i] = val;
                onChange(n);
              }}
              field={field.itemType ?? { type: BaseType.String }}
            />
          </div>
          <Button
            variant="danger"
            size="sm"
            className="shrink-0"
            onClick={() => {
              removeItemKey(i);
              onChange(items.filter((_, j) => j !== i));
            }}
            leftIcon={<X className="w-3 h-3" />}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange([...items, field.itemType?.default ?? ''])}
      >
        {t('launch.common.addPlus2')}
      </Button>
    </div>
  );
}

export function DictEditor({ value, onChange }: EditorProps) {
  useLocaleSubscription();
  const entries = Object.entries((value as Record<string, unknown>) ?? {});
  const [entryKeys, removeEntryKey] = useStableKeys(entries.length);
  return (
    <div className="space-y-1">
      {entries.map(([k, v], i) => (
        <div key={entryKeys[i]} className="flex gap-1 items-center">
          <input
            type="text"
            className={`w-20 ${inputSm}`}
            value={k}
            onChange={(e) => {
              const n: Record<string, unknown> = {};
              entries.forEach(([ok, ov], j) => {
                n[j === i ? e.target.value : ok] = ov;
              });
              onChange(n);
            }}
          />
          <span className="text-zinc-600">:</span>
          <input
            type="text"
            className={`flex-1 ${inputSm}`}
            value={String(v ?? '')}
            onChange={(e) => {
              const n = { ...(value as Record<string, unknown>) };
              n[k] = e.target.value;
              onChange(n);
            }}
          />
          <Button
            variant="danger"
            size="sm"
            className="shrink-0"
            onClick={() => {
              removeEntryKey(i);
              const n = { ...(value as Record<string, unknown>) };
              delete n[k];
              onChange(n);
            }}
            leftIcon={<X className="w-3 h-3" />}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const n = { ...(value as Record<string, unknown>) };
          n[''] = '';
          onChange(n);
        }}
      >
        {t('data.json.addKv')}
      </Button>
    </div>
  );
}

export function SetEditor({ value, onChange }: EditorProps) {
  const items = (value as string[]) ?? [];
  const [newTag, setNewTag] = useState('');
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {items.map((tag, i) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 bg-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-300"
        >
          {tag}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            leftIcon={<X className="w-3 h-3" />}
          />
        </span>
      ))}
      <input
        type="text"
        className={`w-16 ${inputSm}`}
        value={newTag}
        placeholder="+"
        onChange={(e) => setNewTag(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && newTag.trim() && !items.includes(newTag.trim())) {
            onChange([...items, newTag.trim()]);
            setNewTag('');
          }
        }}
      />
    </div>
  );
}

export function JsonEditor({ value, onChange }: EditorProps) {
  const [text, setText] = useState(JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');
  // prop 变化时同步本地 text：原实现只取首次挂载的 value，
  // 切换行/外部重置时 textarea 仍显示旧 JSON
  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
    setError('');
  }, [value]);
  return (
    <div>
      <textarea
        className={`w-full ${inputBase} resize-y font-mono`}
        value={text}
        rows={4}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        onBlur={() => {
          try {
            onChange(JSON.parse(text));
            setError('');
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
    </div>
  );
}

export function ColorEditor({ value, onChange }: EditorProps) {
  return (
    <input
      type="color"
      className="w-10 h-8 bg-zinc-800 border border-zinc-700 rounded cursor-pointer"
      value={(value as string) ?? '#ffffff'}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ImageEditor({ value, onChange }: EditorProps) {
  useLocaleSubscription();
  const url = (value as string) ?? '';
  return (
    <div className="flex gap-2 items-center">
      {url && <img src={url} className="w-8 h-8 rounded object-cover bg-zinc-800" alt="" />}
      <input
        type="text"
        className={`flex-1 ${inputBase}`}
        value={url}
        placeholder={t('data.json.imageUrl')}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function UrlEditor({ value, onChange }: EditorProps) {
  useLocaleSubscription();
  return (
    <div className="flex gap-1 items-center">
      <input
        type="url"
        className={`flex-1 ${inputBase}`}
        value={(value as string) ?? ''}
        placeholder="https://..."
        onChange={(e) => onChange(e.target.value)}
      />
      {!!value && (
        <a
          href={value as string}
          target="_blank"
          className="text-blue-400 hover:text-blue-300 text-xs shrink-0"
          rel="noreferrer"
        >
          {t('launch.common.open')}
        </a>
      )}
    </div>
  );
}

// ---- 复合类型编辑器 ----

export function CompositeEditor({
  value,
  onChange,
  typeName,
}: {
  value: Record<string, unknown>;
  onChange: (val: Record<string, unknown>) => void;
  typeName: string;
}) {
  const [def, setDef] = useState<CompositeTypeDef | null>(null);
  useEffect(() => {
    const d = TypeRegistry.get(typeName);
    if (d) setDef(d);
  }, [typeName]);

  if (!def) return <div className="text-zinc-500 text-xs">{typeName}</div>;

  return (
    <div className="space-y-2 border border-zinc-700 rounded p-2 bg-zinc-800/50">
      <div className="text-xs text-zinc-500 font-medium">{def.label}</div>
      {Object.entries(def.fields).map(([fieldName, fieldConfig]) => {
        const fc = fieldConfig as FieldConfig;
        return (
          <div key={fieldName} className="flex items-center gap-2">
            <label className="text-xs text-zinc-400 w-16 shrink-0">{fc.label ?? fieldName}</label>
            <div className="flex-1">
              <TypeEditor
                value={(value ?? {})[fieldName]}
                onChange={(val) => onChange({ ...(value ?? {}), [fieldName]: val })}
                field={fc}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- 统一入口 ----

export function TypeEditor({ value, onChange, field }: EditorProps) {
  const typeName = field.type;

  // 如果是复合类型（不是 BaseType 枚举值），查找 TypeRegistry
  if (!Object.values(BaseType).includes(typeName as BaseType)) {
    return (
      <CompositeEditor
        value={value as Record<string, unknown>}
        onChange={onChange}
        typeName={typeName}
      />
    );
  }

  switch (typeName as BaseType) {
    case BaseType.Int:
      return <IntEditor value={value as number} onChange={onChange} field={field} />;
    case BaseType.BigInt:
      return <BigIntEditor value={value as number} onChange={onChange} field={field} />;
    case BaseType.Float:
      return <FloatEditor value={value as number} onChange={onChange} field={field} />;
    case BaseType.String:
      return <StringEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.Text:
      return <TextEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.Bool:
      return <BoolEditor value={value as boolean} onChange={onChange} field={field} />;
    case BaseType.Enum:
      return <EnumEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.DateTime:
      return <DateTimeEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.Duration:
      return <DurationEditor value={value as number} onChange={onChange} field={field} />;
    case BaseType.List:
      return <ListEditor value={value as unknown[]} onChange={onChange} field={field} />;
    case BaseType.Dict:
      return (
        <DictEditor value={value as Record<string, unknown>} onChange={onChange} field={field} />
      );
    case BaseType.Set:
      return <SetEditor value={value as string[]} onChange={onChange} field={field} />;
    case BaseType.Json:
      return <JsonEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.Color:
      return <ColorEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.Image:
      return <ImageEditor value={value as string} onChange={onChange} field={field} />;
    case BaseType.Url:
      return <UrlEditor value={value as string} onChange={onChange} field={field} />;
    default:
      return <StringEditor value={String(value ?? '')} onChange={onChange} field={field} />;
  }
}
