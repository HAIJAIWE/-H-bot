import { useState, useMemo } from 'react';
import type { ConfigFieldDefinition } from '../../types/ipc';
import { Dropdown } from '../ui/Dropdown';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { useStableKeys } from '../../hooks/useStableKeys';
import { Lightbulb, AlertTriangle } from 'lucide-react';
import { inputForm, inputFormSm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { RefFieldPicker } from './RefFieldPicker';

interface CreateTableWizardProps {
  open: boolean;
  projectPath: string;
  onClose: () => void;
  onCreated: (tableName: string, displayName: string) => void;
  /** 预览拼音表名（由后端 toPinyinTableName 实现，这里用简单本地实现预览） */
}

/** 字段类型元数据（含说明与示例，用于建表向导提示） */
const FIELD_TYPES: {
  value: ConfigFieldDefinition['type'];
  label: string;
  color: string;
  description: string;
  example: string;
}[] = [
  {
    value: 'integer',
    get label() {
      return t('data.fieldtype.integer');
    },
    color: 'text-blue-300',
    get description() {
      return t('data.wizard.typeIntegerDesc');
    },
    example: '100、0、-5',
  },
  {
    value: 'real',
    get label() {
      return t('data.fieldtype.real');
    },
    color: 'text-sky-300',
    get description() {
      return t('data.wizard.typeRealDesc');
    },
    example: '1.5、0.75、3.14',
  },
  {
    value: 'text',
    get label() {
      return t('data.fieldtype.text');
    },
    color: 'text-zinc-200',
    get description() {
      return t('data.wizard.typeTextDesc');
    },
    get example() {
      return t('data.wizard.typeTextExample');
    },
  },
  {
    value: 'boolean',
    get label() {
      return t('data.fieldtype.boolean');
    },
    color: 'text-purple-300',
    get description() {
      return t('data.wizard.typeBoolDesc');
    },
    example: 'true / false',
  },
  {
    value: 'json',
    label: 'JSON',
    color: 'text-emerald-300',
    get description() {
      return t('data.wizard.typeJsonDesc');
    },
    example: '{"atk":10,"crit":0.2}',
  },
  {
    value: 'enum',
    get label() {
      return t('data.fieldtype.enum');
    },
    color: 'text-rose-300',
    get description() {
      return t('data.wizard.typeEnumDesc');
    },
    example: 'common / rare / epic',
  },
  {
    value: 'ref',
    get label() {
      return t('data.fieldtype.ref');
    },
    color: 'text-amber-300',
    get description() {
      return t('data.wizard.typeRefDesc');
    },
    get example() {
      return t('data.wizard.typeRefExample');
    },
  },
];

/**
 * 类型说明查询。
 *
 * 早先这里是 `Object.fromEntries(FIELD_TYPES.map(...))` —— 模块加载时就把
 * description/example **快照**下来了，而这两个值现在是跟随语言的 getter，
 * 快照等于把界面语言永久冻在 import 那一刻（真机表现：切到 English 后
 * 类型下拉是英文，但下面的类型说明还是中文）。改成函数，取值时机跟渲染一致。
 */
function typeMeta(type: ConfigFieldDefinition['type']): { description: string; example: string } {
  return FIELD_TYPES.find((f) => f.value === type) ?? FIELD_TYPES[0];
}

/**
 * 表名预览：全英文/数字时给出真实文件名，含中文时返回空串。
 *
 * 与 `previewPinyin` 的区别：这里要的是**可用的标识符**（用于"引用字段"里把
 * 正在创建的表也列进下拉，好让用户建自引用），拿不到就不列，而不是回退成
 * "由后端生成"这种说明文字。
 */
function asciiTableName(s: string): string {
  const trimmed = s.trim().toLowerCase();
  if (!trimmed) return '';
  return /^[a-z0-9_]+$/.test(trimmed) ? trimmed : '';
}

/** 简单的中文→拼音预览（实际表名以后端 pinyin-pro 生成结果为准） */
function previewPinyin(s: string): string {
  // 简单预览：把非字母数字字符替换为下划线
  // 真实转换在后端做，这里只是给用户一个大致预览
  const trimmed = s.trim().toLowerCase();
  if (!trimmed) return '';
  // 全英文/数字直接返回
  if (/^[a-z0-9_]+$/.test(trimmed)) return trimmed;
  // 有中文：标注"由后端生成"
  return t('data.wizard.systemGenerated');
}

const DEFAULT_FIELDS: ConfigFieldDefinition[] = [
  {
    name: 'name',
    get label() {
      return t('data.field.name');
    },
    type: 'text',
    notNull: true,
  },
  {
    name: 'description',
    get label() {
      return t('data.field.description');
    },
    type: 'text',
  },
];

export function CreateTableWizard({
  open,
  projectPath,
  onClose,
  onCreated,
}: CreateTableWizardProps) {
  useLocaleSubscription();
  const [displayName, setDisplayName] = useState('');
  const [fields, setFields] = useState<ConfigFieldDefinition[]>(
    DEFAULT_FIELDS.map((f) => ({ ...f })),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 字段列表稳定 key（避免删除/编辑时输入框错位）
  const [fieldKeys, removeFieldKey] = useStableKeys(fields.length);

  const tableNamePreview = useMemo(() => previewPinyin(displayName), [displayName]);

  if (!open) return null;

  const handleAddField = () => {
    setFields((prev) => [
      ...prev,
      { name: `field_${prev.length + 1}`, label: t('data.wizard.newField'), type: 'text' },
    ]);
  };

  const handleRemoveField = (idx: number) => {
    removeFieldKey(idx);
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleFieldChange = (idx: number, patch: Partial<ConfigFieldDefinition>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const handleReset = () => {
    setDisplayName('');
    setFields(DEFAULT_FIELDS.map((f) => ({ ...f })));
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!displayName.trim()) {
      setError(t('data.wizard.tableNameRequired'));
      return;
    }
    if (fields.length === 0) {
      setError(t('data.wizard.minOneField'));
      return;
    }
    // 校验字段名
    const seenNames = new Set<string>();
    for (const f of fields) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) {
        setError(t('data.wizard.invalidFieldNameWithName', { name: f.name }));
        return;
      }
      if (f.name.toLowerCase() === 'id') {
        setError(t('data.wizard.idReserved'));
        return;
      }
      if (seenNames.has(f.name.toLowerCase())) {
        setError(t('data.wizard.duplicateFieldName', { name: f.name }));
        return;
      }
      seenNames.add(f.name.toLowerCase());
      if (!f.label.trim()) {
        setError(t('data.wizard.missingLabelFor', { name: f.name }));
        return;
      }
      if (f.type === 'enum' && (!f.enumValues || f.enumValues.length === 0)) {
        setError(t('data.wizard.enumNeedsOptionFor', { name: f.name }));
        return;
      }
    }
    setCreating(true);
    try {
      const res = await window.qqbat.launchConfig.createTable(
        projectPath,
        displayName.trim(),
        fields,
      );
      if (!res.ok) {
        setError(res.error || t('launch.common.createFailed'));
        return;
      }
      onCreated(res.data?.tableName ?? '', displayName.trim());
      handleReset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('data.wizard.title')}
      width="820px"
      footer={
        <div className="w-full flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {t('data.wizard.summary', { count: String(fields.length) })}{' '}
            <code className="text-zinc-400">{tableNamePreview || 'table'}.db</code>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              className="hover:text-zinc-200"
              onClick={handleReset}
              disabled={creating}
            >
              {t('data.wizard.reset')}
            </Button>
            <Button variant="secondary" size="md" onClick={onClose} disabled={creating}>
              {t('launch.common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              disabled={creating || !displayName.trim()}
            >
              {creating ? t('launch.common.creating') : t('data.wizard.create')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="text-xs text-zinc-500 mb-4">{t('data.wizard.subtitle')}</div>

      <div className="space-y-4">
        {/* 表名输入 */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-sm text-zinc-400 block mb-1">
                {t('data.wizard.tableLabel')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={displayName}
                aria-label={t('data.wizard.tableLabel')}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('data.wizard.tablePlaceholder')}
                className={`w-full ${inputForm}`}
              />
            </div>
            <div className="flex-1">
              <label className="text-sm text-zinc-400 block mb-1">
                {t('data.wizard.englishTableName')}
              </label>
              <div className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-400 font-mono">
                {tableNamePreview || t('data.wizard.tableNameAuto')}
              </div>
            </div>
          </div>
          <div className="text-xs text-zinc-500 bg-zinc-800/30 border border-zinc-700/30 rounded px-3 py-2 flex items-start gap-2">
            <Lightbulb aria-hidden="true" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              {t('data.wizard.autoAddPrefix')}{' '}
              <code className="text-zinc-300">id INTEGER PRIMARY KEY AUTOINCREMENT</code>{' '}
              {t('data.wizard.autoAddSuffix')}
            </span>
          </div>
        </div>

        {/* 字段列表 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-zinc-400">
              {t('data.wizard.fieldsLabel')} <span className="text-red-400">*</span>
            </label>
            <Button variant="primary" size="md" onClick={handleAddField}>
              {t('data.wizard.addFieldPlus')}
            </Button>
          </div>
          <div className="space-y-2">
            {fields.map((f, idx) => (
              <FieldRow
                key={fieldKeys[idx]}
                field={f}
                projectPath={projectPath}
                selfTableName={asciiTableName(displayName)}
                onChange={(patch) => handleFieldChange(idx, patch)}
                onRemove={() => handleRemoveField(idx)}
              />
            ))}
            {fields.length === 0 && (
              <div className="text-center text-zinc-500 text-sm py-4 border border-dashed border-zinc-700 rounded">
                {t('data.wizard.noFieldsHint')}
              </div>
            )}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded px-3 py-2 flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 单字段编辑行 */
function FieldRow({
  field,
  projectPath,
  selfTableName,
  onChange,
  onRemove,
}: {
  field: ConfigFieldDefinition;
  projectPath: string;
  /** 正在创建的表名（能取到 ASCII 名时）—— 让用户可以直接引用自己正在建的表 */
  selfTableName: string;
  onChange: (patch: Partial<ConfigFieldDefinition>) => void;
  onRemove: () => void;
}) {
  useLocaleSubscription();
  const isEnum = field.type === 'enum';
  const isRef = field.type === 'ref';
  const isNumeric = field.type === 'integer' || field.type === 'real';

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/50 rounded p-3 space-y-2.5">
      {/* 第一行：字段名 + 标签 + 类型 + 删除 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={field.name}
          aria-label={t('data.field.aria.name', { name: field.label || field.name })}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('data.field.nameEnglish')}
          className={`w-36 ${inputForm} font-mono`}
        />
        <input
          type="text"
          value={field.label}
          aria-label={t('data.field.aria.zhLabel', { name: field.name })}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={t('data.common.zhLabel')}
          className={`flex-1 ${inputForm}`}
        />
        <Dropdown
          value={field.type}
          ariaLabel={t('data.field.aria.type', { name: field.name })}
          onChange={(v) => onChange({ type: v as ConfigFieldDefinition['type'] })}
          options={FIELD_TYPES.map((ft) => ({ value: ft.value, label: ft.label }))}
          className="w-24"
        />
        <Switch
          checked={!!field.notNull}
          onChange={(v) => onChange({ notNull: v })}
          label={t('data.field.notNull')}
          size="sm"
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-500 hover:text-red-400 !px-1 !py-0 text-lg"
          onClick={onRemove}
          title={t('launch.common.deleteField')}
        >
          ×
        </Button>
      </div>

      {/* 类型说明（小字提示，展示当前类型的说明与示例） */}
      {typeMeta(field.type) && (
        <div className="text-xs text-zinc-500 pl-1 flex items-center gap-2 flex-wrap">
          <span className="text-zinc-400">{typeMeta(field.type).description}</span>
          <span className="text-zinc-600">{t('data.wizard.example')}</span>
          <code className="text-zinc-500 bg-zinc-900/60 px-1.5 py-0.5 rounded">
            {typeMeta(field.type).example}
          </code>
        </div>
      )}

      {/* 第二行：默认值 + 数值范围 + enum 选项 */}
      <div className="flex items-center gap-2 pl-1">
        <label className="text-xs text-zinc-500 w-14 shrink-0">
          {t('data.common.defaultValue')}
        </label>
        {field.type === 'boolean' ? (
          <Dropdown
            value={field.defaultValue === undefined ? '' : String(field.defaultValue)}
            ariaLabel={t('data.field.aria.default', { name: field.name })}
            onChange={(v) => onChange({ defaultValue: v === '' ? undefined : v === 'true' })}
            options={[
              { value: '', label: t('data.field.none') },
              { value: 'true', label: t('data.fieldtype.boolTrue') },
              { value: 'false', label: t('data.fieldtype.boolFalse') },
            ]}
            className="w-36"
          />
        ) : isNumeric ? (
          <input
            type="number"
            value={
              field.defaultValue === undefined || field.defaultValue === ''
                ? ''
                : String(field.defaultValue)
            }
            aria-label={t('data.field.aria.default', { name: field.name })}
            onChange={(e) =>
              onChange({ defaultValue: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            placeholder={t('data.fieldtype.numeric')}
            className={`w-36 ${inputFormSm}`}
          />
        ) : (
          <input
            type="text"
            value={field.defaultValue === undefined ? '' : String(field.defaultValue)}
            aria-label={t('data.field.aria.default', { name: field.name })}
            onChange={(e) =>
              onChange({ defaultValue: e.target.value === '' ? undefined : e.target.value })
            }
            placeholder={t('data.common.defaultValue')}
            className={`w-48 ${inputFormSm}`}
          />
        )}
        {isNumeric && (
          <>
            <label className="text-xs text-zinc-500 ml-2">{t('data.field.range')}</label>
            <input
              type="number"
              value={field.min === undefined ? '' : String(field.min)}
              aria-label={t('data.field.aria.min', { name: field.name })}
              onChange={(e) =>
                onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              placeholder={t('data.field.min')}
              className={`w-20 ${inputFormSm}`}
            />
            <span className="text-zinc-500 text-xs">~</span>
            <input
              type="number"
              value={field.max === undefined ? '' : String(field.max)}
              aria-label={t('data.field.aria.max', { name: field.name })}
              onChange={(e) =>
                onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              placeholder={t('data.field.max')}
              className={`w-20 ${inputFormSm}`}
            />
          </>
        )}
      </div>

      {/* 第三行：enum 选项（仅 enum 类型） */}
      {isEnum && (
        <div className="flex items-start gap-2 pl-1">
          <label className="text-xs text-zinc-500 w-14 shrink-0 mt-1">
            {t('data.field.options')}
          </label>
          <div className="flex-1">
            <input
              type="text"
              value={(field.enumValues || []).join(',')}
              aria-label={t('data.field.aria.enum', { name: field.name })}
              onChange={(e) =>
                onChange({
                  enumValues: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder={t('data.wizard.enumCommaHint')}
              className={`w-full ${inputFormSm}`}
            />
            <div className="text-xs text-zinc-500 mt-1">
              {t('data.wizard.optionCount', {
                count: String((field.enumValues || []).length),
              })}
              {(field.enumValues || []).join(' / ') || t('data.field.empty')}
            </div>
          </div>
        </div>
      )}

      {/* 第三行之一：引用配置（仅 ref 类型）—— 选"引用哪张表 + 用哪个字段" */}
      {isRef && (
        <RefFieldPicker
          projectPath={projectPath}
          value={{ refTable: field.refTable, refField: field.refField }}
          onChange={(patch) => onChange(patch)}
          extraTableOption={selfTableName || undefined}
        />
      )}

      {/* 第四行：描述 */}
      <div className="flex items-center gap-2 pl-1">
        <label className="text-xs text-zinc-500 w-14 shrink-0">{t('data.field.description')}</label>
        <input
          type="text"
          value={field.description || ''}
          aria-label={t('data.field.aria.desc', { name: field.name })}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('data.wizard.descOptional')}
          className={`flex-1 ${inputFormSm}`}
        />
      </div>
    </div>
  );
}
