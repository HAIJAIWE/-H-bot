import { memo } from 'react';
import type { TemplateField } from '../../types/ipc';
import { Button } from '../ui/Button';
import { Lock } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 字段类型中文名 */
const FIELD_TYPE_LABELS: Record<TemplateField['type'], string> = {
  get number() {
    return t('data.fieldtype.number');
  },
  get boolean() {
    return t('data.fieldtype.boolPair');
  },
  get text() {
    return t('data.fieldtype.text');
  },
  get date() {
    return t('data.fieldtype.date');
  },
  get datetime() {
    return t('data.fieldtype.datetime');
  },
  get json() {
    return t('data.fieldtype.json');
  },
  get enum() {
    return t('data.fieldtype.enumPick');
  },
};

/** 字段类型对应的标签颜色 */
const FIELD_TYPE_COLORS: Record<TemplateField['type'], string> = {
  number: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  boolean: 'bg-purple-900/40 text-purple-300 border-purple-800/50',
  text: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50',
  date: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
  datetime: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
  json: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50',
  enum: 'bg-rose-900/40 text-rose-300 border-rose-800/50',
};

/** 把默认值格式化为可显示字符串 */
function formatDefault(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? t('data.yes') : t('data.no');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (value === '') return t('data.field.empty');
  return String(value);
}

interface FieldEditorRowProps {
  field: TemplateField;
  onEdit: (field: TemplateField) => void;
  onDelete: (field: TemplateField) => void;
}

/** 单行字段编辑器组件：展示字段信息并提供编辑/删除操作 */
export const FieldEditorRow = memo(function FieldEditorRow({
  field,
  onEdit,
  onDelete,
}: FieldEditorRowProps) {
  useLocaleSubscription();
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-zinc-200 font-medium">{field.label}</span>
            {field.auto && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/50 inline-flex items-center gap-1"
                title={t('data.field.autoDeleteTitle')}
              >
                <Lock className="w-3 h-3" />
                {t('data.field.auto')}
              </span>
            )}
            <span
              className={`text-xs px-1.5 py-0.5 rounded border ${FIELD_TYPE_COLORS[field.type]}`}
            >
              {FIELD_TYPE_LABELS[field.type]}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs">
            <span className="text-zinc-500">
              key: <code className="text-zinc-300 font-mono">{field.key}</code>
            </span>
            <span className="text-zinc-500">
              {t('data.field.defaultColon')}{' '}
              <span className="text-zinc-300">{formatDefault(field.default)}</span>
            </span>
          </div>
          {field.description && (
            <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{field.description}</div>
          )}
          {field.type === 'enum' && field.options && field.options.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              <span className="text-xs text-zinc-500">{t('data.field.optionsColon')}</span>
              {field.options.map((opt) => (
                <span
                  key={opt.value}
                  className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400"
                >
                  {opt.label || opt.value}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="secondary" size="sm" onClick={() => onEdit(field)}>
            {t('launch.common.edit')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDelete(field)}
            disabled={field.auto}
            title={field.auto ? t('data.common.autoNotDeletable') : t('launch.common.deleteField')}
          >
            {t('launch.common.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
});
