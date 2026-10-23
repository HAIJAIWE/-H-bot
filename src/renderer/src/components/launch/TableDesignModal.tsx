import React, { useState, useEffect } from 'react';
import type { ConfigFieldDefinition, AlterTableResult } from '../../types/ipc';
import type { FieldSchema, TableSchema } from '@shared/types/launch';
import { Dropdown } from '../ui/Dropdown';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { Settings, AlertTriangle, Check, Key } from 'lucide-react';
import { inputXs, inputSm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { RefFieldPicker } from './RefFieldPicker';

interface TableDesignModalProps {
  open: boolean;
  projectPath: string;
  category: string;
  displayName: string;
  schema: TableSchema[];
  onClose: () => void;
  onChanged: () => void; // 表结构变更后回调（刷新分类列表+表数据）
}

/** 字段类型元数据（与 CreateTableWizard 保持视觉一致） */
const FIELD_TYPES: { value: ConfigFieldDefinition['type']; label: string; color: string }[] = [
  {
    value: 'integer',
    get label() {
      return t('data.fieldtype.integer');
    },
    color: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  {
    value: 'real',
    get label() {
      return t('data.fieldtype.real');
    },
    color: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  {
    value: 'text',
    get label() {
      return t('data.fieldtype.text');
    },
    color: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
  {
    value: 'boolean',
    get label() {
      return t('data.fieldtype.boolean');
    },
    color: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  {
    value: 'json',
    label: 'JSON',
    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  {
    value: 'enum',
    get label() {
      return t('data.fieldtype.enum');
    },
    color: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  {
    value: 'ref',
    get label() {
      return t('data.fieldtype.ref');
    },
    color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
];

const TYPE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  FIELD_TYPES.map((f) => [f.value, f.color]),
);

/** 把 FieldSchema（来自 PRAGMA/schema）映射到 ConfigFieldDefinition */
function schemaToField(s: FieldSchema): ConfigFieldDefinition {
  // 推断 type
  const t = String(s.type || '').toLowerCase();
  let type: ConfigFieldDefinition['type'] = 'text';
  if (t.includes('int')) type = 'integer';
  else if (t.includes('real') || t.includes('float') || t.includes('double')) type = 'real';
  else if (t.includes('bool')) type = 'boolean';
  else if (t.includes('json') || t.includes('blob')) type = 'json';
  else if (t.includes('enum')) type = 'enum';
  // 引用字段：SQL 侧存的是 TEXT（schema 里 type=string），**只能靠 refTable 反推**。
  // 漏了这一步，界面上引用的下拉会在重新打开弹窗后退化成文本框，用户以为配置丢了。
  if (s.refTable) type = 'ref';
  // PRAGMA 回退路径无法区分 enum 和 text，根据 options 兜底判断
  if (type === 'text' && s.options && s.options.length > 0) type = 'enum';
  return {
    name: s.name,
    label: s.label || s.name,
    type,
    description: s.description,
    enumValues: s.options,
    min: s.min,
    max: s.max,
    refTable: s.refTable,
    refField: s.refField,
  };
}

export const TableDesignModal = React.memo(function TableDesignModal({
  open,
  projectPath,
  category,
  displayName,
  schema,
  onClose,
  onChanged,
}: TableDesignModalProps) {
  // 表显示名编辑
  useLocaleSubscription();
  const [editDisplayName, setEditDisplayName] = useState(displayName);
  const [renaming, setRenaming] = useState(false);
  // 当前字段列表（编辑中的副本）
  const [fields, setFields] = useState<ConfigFieldDefinition[]>([]);
  // 待提交的变更
  const [addFieldList, setAddFieldList] = useState<ConfigFieldDefinition[]>([]);
  const [dropFieldList, setDropFieldList] = useState<string[]>([]);
  const [updateFieldList, setUpdateFieldList] = useState<ConfigFieldDefinition[]>([]);
  // 新增字段表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newField, setNewField] = useState<ConfigFieldDefinition>({
    name: '',
    label: '',
    type: 'text',
  });
  // 操作状态
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AlterTableResult | null>(null);
  // 删表确认
  const [confirmDropTable, setConfirmDropTable] = useState(false);
  // 删字段确认（替代 window.confirm，与删表确认弹窗风格一致）
  const [confirmDropFields, setConfirmDropFields] = useState(false);

  // 当 schema 或 open 变化时重置字段列表
  useEffect(() => {
    if (!open) return;
    const schemaFields = schema[0]?.fields ?? [];
    setFields(schemaFields.map(schemaToField));
    setAddFieldList([]);
    setDropFieldList([]);
    setUpdateFieldList([]);
    setError(null);
    setResult(null);
    setShowAddForm(false);
    setEditDisplayName(displayName);
    setConfirmDropTable(false);
    setConfirmDropFields(false);
  }, [open, schema, displayName]);

  const hasChanges =
    addFieldList.length > 0 ||
    dropFieldList.length > 0 ||
    updateFieldList.length > 0 ||
    editDisplayName !== displayName;

  if (!open) return null;

  /** 修改已有字段元数据（label/description/enumValues/min/max） */
  const handleFieldUpdate = (name: string, patch: Partial<ConfigFieldDefinition>) => {
    setFields((prev) => prev.map((f) => (f.name === name ? { ...f, ...patch } : f)));
    // 加入 updateFieldList（去重）
    setUpdateFieldList((prev) => {
      const existing = prev.find((f) => f.name === name);
      if (existing) {
        return prev.map((f) => (f.name === name ? { ...f, ...patch } : f));
      }
      // 从 fields 中取最新值再 patch
      const current = fields.find((f) => f.name === name);
      if (!current) return prev;
      return [...prev, { ...current, ...patch }];
    });
  };

  /** 标记字段为待删除 */
  const handleFieldDrop = (name: string) => {
    // 不能删除 id（主键）
    if (name === 'id') {
      setError(t('data.design.idNotDeletable'));
      return;
    }
    setDropFieldList((prev) => (prev.includes(name) ? prev : [...prev, name]));
    // 如果该字段在 addFieldList 里（刚加的还没保存），直接从 addFieldList 移除
    setAddFieldList((prev) => prev.filter((f) => f.name !== name));
    // 如果在 updateFieldList 里，也移除
    setUpdateFieldList((prev) => prev.filter((f) => f.name !== name));
  };

  /** 撤销删除字段 */
  const handleUndoDrop = (name: string) => {
    setDropFieldList((prev) => prev.filter((n) => n !== name));
  };

  /** 添加新字段 */
  const handleAddField = () => {
    setError(null);
    if (!newField.name.trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newField.name)) {
      setError(t('data.design.invalidFieldName'));
      return;
    }
    if (newField.name.toLowerCase() === 'id') {
      setError(t('data.design.idReserved'));
      return;
    }
    // 检查重名（与现有字段 + 待加字段）
    const allNames = new Set([
      ...fields.map((f) => f.name.toLowerCase()),
      ...addFieldList.map((f) => f.name.toLowerCase()),
    ]);
    if (allNames.has(newField.name.toLowerCase())) {
      setError(t('data.design.duplicateField', { name: newField.name }));
      return;
    }
    if (!newField.label.trim()) {
      setError(t('data.design.zhLabelRequired'));
      return;
    }
    if (newField.type === 'enum' && (!newField.enumValues || newField.enumValues.length === 0)) {
      setError(t('data.design.enumNeedsOption'));
      return;
    }
    setAddFieldList((prev) => [...prev, { ...newField }]);
    setNewField({ name: '', label: '', type: 'text' });
    setShowAddForm(false);
  };

  /** 撤销添加字段 */
  const handleUndoAdd = (name: string) => {
    setAddFieldList((prev) => prev.filter((f) => f.name !== name));
  };

  /** 重命名表 */
  const handleRename = async () => {
    if (editDisplayName.trim() === displayName) return;
    if (!editDisplayName.trim()) {
      setError(t('data.design.tableNameRequired'));
      return;
    }
    setRenaming(true);
    setError(null);
    try {
      const res = await window.qqbat.launchConfig.renameTable(
        projectPath,
        category,
        editDisplayName.trim(),
      );
      if (!res.ok) {
        setError(res.error || t('data.design.renameFailed'));
        return;
      }
      // 重命名后表名可能变了，需要父组件刷新
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenaming(false);
    }
  };

  /** 删除整张表 */
  const handleDropTable = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await window.qqbat.launchConfig.dropTable(projectPath, category);
      if (!res.ok) {
        setError(res.error || t('data.design.deleteTableFailed'));
        return;
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      setConfirmDropTable(false);
    }
  };

  /** 保存表结构变更（入口：检查是否需要删字段确认） */
  const handleSaveAlter = () => {
    setError(null);
    setResult(null);
    if (dropFieldList.length > 0) {
      // 有删字段操作：打开自定义确认弹窗（替代 window.confirm，与删表确认风格一致）
      setConfirmDropFields(true);
      return;
    }
    // 无删字段：直接执行
    void doSaveAlter();
  };

  /** 实际执行表结构变更（确认后调用） */
  const doSaveAlter = async () => {
    setConfirmDropFields(false);
    setSubmitting(true);
    try {
      const res = await window.qqbat.launchConfig.alterTable(projectPath, category, {
        addFields: addFieldList.length > 0 ? addFieldList : undefined,
        dropFields: dropFieldList.length > 0 ? dropFieldList : undefined,
        updateFields: updateFieldList.length > 0 ? updateFieldList : undefined,
      });
      if (!res.ok) {
        setError(res.error || t('launch.common.saveFailed'));
        return;
      }
      setResult(res.data ?? null);
      // 清空待提交列表
      setAddFieldList([]);
      setDropFieldList([]);
      setUpdateFieldList([]);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('data.design.title')}
      width="820px"
      footer={
        <div className="w-full flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {hasChanges ? (
              <span className="text-amber-300">
                {t('data.design.pendingSummary', {
                  add: String(addFieldList.length),
                  drop: String(dropFieldList.length),
                  update: String(updateFieldList.length),
                })}
              </span>
            ) : (
              <span>{t('data.design.noChanges')}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
              {t('launch.common.close')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveAlter}
              disabled={
                submitting ||
                !hasChanges ||
                (addFieldList.length === 0 &&
                  dropFieldList.length === 0 &&
                  updateFieldList.length === 0 &&
                  editDisplayName === displayName)
              }
            >
              {submitting ? t('launch.common.saving') : t('data.design.saveChanges')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 表名 + .db 标识 */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Settings aria-hidden="true" className="w-4 h-4 text-zinc-400" />
          <span className="font-mono">{category}.db</span>
        </div>

        {/* 表名编辑 + 危险操作 */}
        <div className="flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded p-3">
          <label className="text-xs text-zinc-400 shrink-0">{t('data.wizard.tableLabel')}</label>
          <input
            type="text"
            value={editDisplayName}
            aria-label={t('data.wizard.tableLabel')}
            onChange={(e) => setEditDisplayName(e.target.value)}
            className={`flex-1 ${inputSm} focus:outline-none focus:border-blue-500`}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleRename}
            disabled={renaming || editDisplayName.trim() === displayName}
          >
            {renaming ? t('launch.common.renaming') : t('data.design.rename')}
          </Button>
          <div className="w-px h-5 bg-zinc-700 mx-1" />
          <Button
            variant="danger"
            size="sm"
            className="px-2 py-1 rounded text-xs bg-red-900/50 hover:bg-red-800 text-red-300 border border-red-700/50"
            onClick={() => setConfirmDropTable(true)}
            disabled={submitting}
          >
            {t('data.design.deleteTable')}
          </Button>
        </div>

        {/* 删表确认 */}
        {confirmDropTable && (
          <div className="bg-red-900/30 border border-red-700/50 rounded p-3 space-y-2">
            <div className="text-xs text-red-200 font-semibold inline-flex items-center gap-1.5">
              <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
              {t('data.design.deleteTableWarning')}
            </div>
            <div className="text-xs text-red-300">
              {t('data.design.deleteTableBodyPrefix')}{' '}
              <code className="text-red-200">{category}.db</code>{' '}
              {t('data.design.deleteTableBodySuffix')}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="danger" size="sm" onClick={handleDropTable} disabled={submitting}>
                {submitting ? t('launch.common.deleting') : t('launch.common.confirmDelete')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDropTable(false)}>
                {t('launch.common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* 删字段确认弹窗（替代 window.confirm，与删表确认弹窗风格一致） */}
        {confirmDropFields && (
          <div className="bg-red-900/30 border border-red-700/50 rounded p-3 space-y-2">
            <div className="text-xs text-red-200 font-semibold inline-flex items-center gap-1.5">
              <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
              {t('data.design.deleteFieldsWarning')}
            </div>
            <div className="text-xs text-red-300">
              {t('data.design.deleteFieldsIntro', { count: String(dropFieldList.length) })}
              <code className="text-red-200">{dropFieldList.join(', ')}</code>
              <br />
              {t('data.design.rebuildHint')}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => void doSaveAlter()}
                disabled={submitting}
              >
                {submitting ? t('launch.common.saving') : t('data.design.confirmDeleteField')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDropFields(false)}
                disabled={submitting}
              >
                {t('launch.common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* 现有字段列表 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-400">
              {t('data.design.fieldList')}{' '}
              <span className="text-zinc-600">
                {t('data.design.fieldListSummary', {
                  total: String(fields.length),
                  drop: String(dropFieldList.length),
                })}
              </span>
            </div>
            <Button variant="primary" size="sm" onClick={() => setShowAddForm((s) => !s)}>
              {showAddForm ? t('data.design.cancelAdd') : t('data.design.addField')}
            </Button>
          </div>

          {/* 添加新字段表单 */}
          {showAddForm && (
            <div className="bg-blue-900/20 border border-blue-700/40 rounded p-2.5 space-y-2">
              <div className="text-xs text-blue-200">{t('data.design.addFieldPending')}</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newField.name}
                  aria-label={t('data.design.newFieldName')}
                  onChange={(e) => setNewField((p) => ({ ...p, name: e.target.value }))}
                  placeholder={t('data.field.nameEnglish')}
                  className={`w-32 ${inputSm} font-mono`}
                />
                <input
                  type="text"
                  value={newField.label}
                  aria-label={t('data.design.newFieldZhLabel')}
                  onChange={(e) => setNewField((p) => ({ ...p, label: e.target.value }))}
                  placeholder={t('data.common.zhLabel')}
                  className={`flex-1 ${inputSm}`}
                />
                <Dropdown
                  value={newField.type}
                  ariaLabel={t('data.design.newFieldType')}
                  onChange={(v) =>
                    setNewField((p) => ({ ...p, type: v as ConfigFieldDefinition['type'] }))
                  }
                  options={FIELD_TYPES.map((ft) => ({ value: ft.value, label: ft.label }))}
                  className="w-20"
                />
                <Switch
                  checked={!!newField.notNull}
                  onChange={(v) => setNewField((p) => ({ ...p, notNull: v }))}
                  label={t('data.field.notNull')}
                  size="sm"
                />
                <Button variant="success" size="sm" onClick={handleAddField}>
                  {t('launch.common.include')}
                </Button>
              </div>
              {newField.type === 'enum' && (
                <input
                  type="text"
                  value={(newField.enumValues || []).join(',')}
                  aria-label={t('data.design.newFieldEnum')}
                  onChange={(e) =>
                    setNewField((p) => ({
                      ...p,
                      enumValues: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder={t('data.design.enumPlaceholder')}
                  className={`w-full ${inputSm}`}
                />
              )}
              {/* 引用字段：选目标表 + 目标字段（改表时自己也能被引用，所以 extraTableOption 传本表） */}
              {newField.type === 'ref' && (
                <RefFieldPicker
                  projectPath={projectPath}
                  value={{ refTable: newField.refTable, refField: newField.refField }}
                  onChange={(patch) => setNewField((p) => ({ ...p, ...patch }))}
                  extraTableOption={category}
                />
              )}
              {/* 默认值 + 数值范围：与 CreateTableWizard FieldRow 保持一致 */}
              <div className="flex items-center gap-2 pl-1">
                <label className="text-xs text-zinc-500 w-12 shrink-0">
                  {t('data.common.defaultValue')}
                </label>
                {newField.type === 'boolean' ? (
                  <Dropdown
                    value={newField.defaultValue === undefined ? '' : String(newField.defaultValue)}
                    ariaLabel={t('data.design.newFieldDefault')}
                    onChange={(v) =>
                      setNewField((p) => ({
                        ...p,
                        defaultValue: v === '' ? undefined : v === 'true',
                      }))
                    }
                    options={[
                      { value: '', label: t('data.field.none') },
                      { value: 'true', label: t('data.fieldtype.boolTrue') },
                      { value: 'false', label: t('data.fieldtype.boolFalse') },
                    ]}
                    className="w-32"
                  />
                ) : newField.type === 'integer' || newField.type === 'real' ? (
                  <input
                    type="number"
                    value={
                      newField.defaultValue === undefined || newField.defaultValue === ''
                        ? ''
                        : String(newField.defaultValue)
                    }
                    aria-label={t('data.design.newFieldDefault')}
                    onChange={(e) =>
                      setNewField((p) => ({
                        ...p,
                        defaultValue: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    placeholder={t('data.fieldtype.numeric')}
                    className={`w-32 ${inputSm}`}
                  />
                ) : (
                  <input
                    type="text"
                    value={newField.defaultValue === undefined ? '' : String(newField.defaultValue)}
                    aria-label={t('data.design.newFieldDefault')}
                    onChange={(e) =>
                      setNewField((p) => ({
                        ...p,
                        defaultValue: e.target.value === '' ? undefined : e.target.value,
                      }))
                    }
                    placeholder={t('data.common.defaultValue')}
                    className={`w-48 ${inputSm}`}
                  />
                )}
                {(newField.type === 'integer' || newField.type === 'real') && (
                  <>
                    <label className="text-xs text-zinc-500 ml-2">{t('data.field.range')}</label>
                    <input
                      type="number"
                      value={newField.min === undefined ? '' : String(newField.min)}
                      aria-label={t('data.design.newFieldMin')}
                      onChange={(e) =>
                        setNewField((p) => ({
                          ...p,
                          min: e.target.value === '' ? undefined : Number(e.target.value),
                        }))
                      }
                      placeholder={t('data.field.min')}
                      className={`w-20 ${inputSm}`}
                    />
                    <span className="text-zinc-500 text-xs">~</span>
                    <input
                      type="number"
                      value={newField.max === undefined ? '' : String(newField.max)}
                      aria-label={t('data.design.newFieldMax')}
                      onChange={(e) =>
                        setNewField((p) => ({
                          ...p,
                          max: e.target.value === '' ? undefined : Number(e.target.value),
                        }))
                      }
                      placeholder={t('data.field.max')}
                      className={`w-20 ${inputSm}`}
                    />
                  </>
                )}
              </div>
              <input
                type="text"
                value={newField.description || ''}
                aria-label={t('data.design.newFieldDesc')}
                onChange={(e) => setNewField((p) => ({ ...p, description: e.target.value }))}
                placeholder={t('data.design.fieldDescOptional')}
                className={`w-full ${inputSm}`}
              />
            </div>
          )}

          {/* 字段行 */}
          {fields.map((f) => {
            const isDropped = dropFieldList.includes(f.name);
            const isId = f.name === 'id';
            return (
              <FieldDesignRow
                key={f.name}
                field={f}
                projectPath={projectPath}
                category={category}
                isId={isId}
                isDropped={isDropped}
                onUpdate={(patch) => handleFieldUpdate(f.name, patch)}
                onDrop={() => handleFieldDrop(f.name)}
                onUndoDrop={() => handleUndoDrop(f.name)}
              />
            );
          })}

          {/* 待添加字段 */}
          {addFieldList.length > 0 && (
            <div className="mt-3 pt-2 border-t border-zinc-800">
              <div className="text-xs text-green-300 mb-1.5">{t('data.design.pendingField')}</div>
              {addFieldList.map((f) => (
                <div
                  key={f.name}
                  className="bg-green-900/20 border border-green-700/40 rounded p-2 flex items-center gap-2 text-xs"
                >
                  <span className="text-zinc-300 font-mono">{f.name}</span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-zinc-300">{f.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-xs ${TYPE_COLOR_MAP[f.type]}`}
                  >
                    {f.type}
                  </span>
                  <Button
                    variant="danger"
                    className="ml-auto text-zinc-500 hover:text-red-400 text-base"
                    onClick={() => handleUndoAdd(f.name)}
                    title={t('data.design.undoAdd')}
                    leftIcon={<span>×</span>}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="text-xs text-red-300 bg-red-900/30 border border-red-700/50 rounded px-3 py-2 flex items-start gap-2">
            <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* 操作结果 */}
        {result && (result.addedFields.length > 0 || result.droppedFields.length > 0) && (
          <div className="text-xs text-green-300 bg-green-900/30 border border-green-700/50 rounded px-3 py-2 space-y-0.5">
            <div className="inline-flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              {t('data.design.updated')}
            </div>
            {result.addedFields.length > 0 && (
              <div>{t('data.design.addedFields', { list: result.addedFields.join(', ') })}</div>
            )}
            {result.droppedFields.length > 0 && (
              <div>{t('data.design.droppedFields', { list: result.droppedFields.join(', ') })}</div>
            )}
            {result.rebuilt && (
              <div>{t('data.design.rebuilt', { count: String(result.migratedRows) })}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
});

/** 已有字段设计行（可改 label/enumValues/min/max/description，可标记删除） */
function FieldDesignRow({
  field,
  projectPath,
  category,
  isId,
  isDropped,
  onUpdate,
  onDrop,
  onUndoDrop,
}: {
  field: ConfigFieldDefinition;
  projectPath: string;
  category: string;
  isId: boolean;
  isDropped: boolean;
  onUpdate: (patch: Partial<ConfigFieldDefinition>) => void;
  onDrop: () => void;
  onUndoDrop: () => void;
}) {
  useLocaleSubscription();
  const isEnum = field.type === 'enum';
  const isRef = field.type === 'ref';
  const isNumeric = field.type === 'integer' || field.type === 'real';
  const isReadonly = isId || isDropped; // 主键和待删字段不可编辑

  if (isDropped) {
    return (
      <div className="bg-red-900/20 border border-red-700/40 rounded p-2 flex items-center gap-2 text-xs opacity-70">
        <span className="text-zinc-500 line-through font-mono">{field.name}</span>
        <span className="text-zinc-600 line-through">{field.label}</span>
        <span className="text-xs text-red-300">{t('data.design.pendingDelete')}</span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onUndoDrop}>
          {t('launch.common.undo')}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`bg-zinc-800/40 border rounded p-2.5 space-y-2 ${isId ? 'border-amber-700/40 bg-amber-900/10' : 'border-zinc-700/50'}`}
    >
      {/* 第一行：字段名 + 标签 + 类型 + 删除 */}
      <div className="flex items-center gap-2">
        <div className="w-32 px-2 py-1 text-xs text-zinc-300 font-mono bg-zinc-900/50 rounded flex items-center gap-1">
          {isId && <Key className="w-3 h-3 text-amber-400" />}
          {field.name}
        </div>
        <input
          type="text"
          value={field.label}
          aria-label={t('data.field.aria.zhLabel', { name: field.name })}
          onChange={(e) => onUpdate({ label: e.target.value })}
          disabled={isReadonly}
          className={`flex-1 ${inputSm} disabled:opacity-50`}
        />
        <span
          className={`px-1.5 py-0.5 rounded border text-xs ${TYPE_COLOR_MAP[field.type] || 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
        >
          {field.type}
        </span>
        {!isId && (
          <Button
            variant="danger"
            className="text-zinc-500 hover:text-red-400 px-1"
            onClick={onDrop}
            title={t('launch.common.deleteField')}
            aria-label={t('data.field.aria.delete', { name: field.name })}
            leftIcon={<span>×</span>}
          />
        )}
      </div>

      {/* 第二行：enum 选项 / 数值范围 / 描述 */}
      {isEnum && (
        <div className="flex items-center gap-2 pl-1">
          <label className="text-xs text-zinc-500 w-12 shrink-0">{t('data.field.options')}</label>
          <input
            type="text"
            value={(field.enumValues || []).join(',')}
            aria-label={t('data.field.aria.enum', { name: field.name })}
            onChange={(e) =>
              onUpdate({
                enumValues: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            disabled={isReadonly}
            className={`flex-1 ${inputXs} disabled:opacity-50`}
          />
        </div>
      )}
      {/* 引用字段：显示/编辑"引用哪张表 + 哪个字段"（只读字段禁用） */}
      {isRef && (
        <div className={isReadonly ? 'pointer-events-none opacity-60' : ''}>
          <RefFieldPicker
            projectPath={projectPath}
            value={{ refTable: field.refTable, refField: field.refField }}
            onChange={(patch) => onUpdate(patch)}
            extraTableOption={category}
          />
        </div>
      )}
      {isNumeric && (
        <div className="flex items-center gap-2 pl-1">
          <label className="text-xs text-zinc-500 w-12 shrink-0">{t('data.field.range')}</label>
          <input
            type="number"
            value={field.min === undefined ? '' : String(field.min)}
            aria-label={t('data.field.aria.min', { name: field.name })}
            onChange={(e) =>
              onUpdate({ min: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            disabled={isReadonly}
            placeholder={t('data.field.min')}
            className={`w-20 ${inputXs} disabled:opacity-50`}
          />
          <span className="text-zinc-500 text-xs">~</span>
          <input
            type="number"
            value={field.max === undefined ? '' : String(field.max)}
            aria-label={t('data.field.aria.max', { name: field.name })}
            onChange={(e) =>
              onUpdate({ max: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            disabled={isReadonly}
            placeholder={t('data.field.max')}
            className={`w-20 ${inputXs} disabled:opacity-50`}
          />
        </div>
      )}
      <div className="flex items-center gap-2 pl-1">
        <label className="text-xs text-zinc-500 w-12 shrink-0">{t('data.field.description')}</label>
        <input
          type="text"
          value={field.description || ''}
          aria-label={t('data.field.aria.desc', { name: field.name })}
          onChange={(e) => onUpdate({ description: e.target.value })}
          disabled={isReadonly}
          placeholder={t('data.design.fieldDescShort')}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
        />
      </div>
    </div>
  );
}
