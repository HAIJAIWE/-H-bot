// src/renderer/src/components/launch/DataTemplateEditor.tsx
//
// 数据模板编辑器（**主组件**）。
//
// 2026-10：文件里本来就已经分离好了三张表 / 四个纯函数 / 三个子组件，只是都挤在同一个文件里（1175 行）。
// 把它们搬到各自文件（表 → templateFieldOptions、纯函数 → templateFieldModel、子组件 → Template*.tsx），
// 主组件从 691 行开始读。**对外仍是 DataTemplateEditor + DataTemplateEditorProps 两个导出** —— 调用方零改动。

import React from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import type { DataTemplate, TemplateField, TemplateGroup } from '../../types/ipc';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalFooter } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { inputForm, inputMd } from '../ui/inputStyles';
import { GroupSection } from './GroupSection';
import { DefaultValueEditor } from './TemplateDefaultValueEditor';
import { IconPicker } from './TemplateIconPicker';
import { OptionsEditor } from './TemplateOptionsEditor';
import { TemplateToolbar } from './TemplateToolbar';
import { deepClone, generateGroupId } from './templateFieldModel';
import {
  ALL_FIELD_TYPES,
  CATEGORY_OPTIONS,
  FIELD_TYPE_COLORS,
  FIELD_TYPE_LABELS,
} from './templateFieldOptions';
import { flushFlow } from '@renderer/lib/canvas/flushFlow';
import type { FieldCategory } from '@shared/types/launch';
import { Pencil, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export interface DataTemplateEditorProps {
  projectPath: string;
}

export const DataTemplateEditor = React.memo(function DataTemplateEditor({
  projectPath,
}: DataTemplateEditorProps) {
  useLocaleSubscription();
  const [template, setTemplate] = useState<DataTemplate | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const originalTemplateRef = useRef<DataTemplate | null>(null);
  const toast = useToast();

  // 弹窗状态
  const [groupDialog, setGroupDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: string;
    label: string;
    icon: string;
  }>({ open: false, mode: 'create', label: '', icon: '👤' });

  const [fieldDialog, setFieldDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    groupId: string;
    field: TemplateField;
  } | null>(null);

  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<TemplateGroup | null>(null);

  // ─── 显示 toast ───
  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      if (type === 'success') toast.success(message);
      else toast.error(message);
    },
    [toast],
  );

  // ─── 加载模板 ───
  const loadTemplate = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      // 架构：**读盘前先冲刷**（模板按 flow.json 派生；见 lib/canvas/flushFlow.ts）
      await flushFlow(projectPath);
      const res = await window.qqbat.launchData.getDataTemplate(projectPath);
      if (res.ok && res.data) {
        setTemplate(res.data);
        originalTemplateRef.current = deepClone(res.data);
        if (res.data.groups.length > 0 && !selectedGroupId) {
          setSelectedGroupId(res.data.groups[0].id);
        }
      } else {
        showToast(res.error || t('data.common.loadTemplateFailed'), 'error');
      }
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [projectPath, selectedGroupId, showToast]);

  useEffect(() => {
    if (!projectPath) return;
    loadTemplate();
    // loadTemplate 依赖 selectedGroupId，补全后首次设置 selectedGroupId 会触发重复加载模板
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // ─── 选中分组 ───
  const selectedGroup = useMemo(() => {
    if (!template || !selectedGroupId) return null;
    return template.groups.find((g) => g.id === selectedGroupId) ?? null;
  }, [template, selectedGroupId]);

  // ─── 保存模板 ───
  const handleSave = async () => {
    if (!template || !projectPath) return;
    setSaving(true);
    try {
      const res = await window.qqbat.launchData.saveDataTemplate(projectPath, template);
      if (res.ok) {
        originalTemplateRef.current = deepClone(template);
        showToast(t('data.common.templateSaved'));
      } else {
        showToast(res.error || t('launch.common.saveFailed'), 'error');
      }
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── 恢复默认 ───
  //
  // **默认内容来自项目自身**（不是一份硬编码示例）：主进程 `deriveTemplateFromProject`
  // 从 `flow.json` 的 `variable_persist` 声明 + `persistent.db` 的实际字段推导。
  // 这样"恢复默认"得到的是"你的项目实际有什么"，而不是"某个示例项目大概有什么"。
  const handleReset = async () => {
    if (!projectPath) {
      showToast(t('data.common.noProject'), 'error');
      return;
    }
    try {
      const res = await window.qqbat.launchData.deriveDataTemplate(projectPath);
      if (!res.ok || !res.data) {
        showToast(res.error ?? t('data.common.restoredDefaultFailed'), 'error');
        return;
      }
      const def = res.data;
      setTemplate(def);
      setSelectedGroupId(def.groups[0]?.id ?? null);
      // 重置后它就是新的"原样"——否则界面会一直显示"有未保存修改"
      originalTemplateRef.current = deepClone(def);
      showToast(
        def.groups.length > 0
          ? t('data.common.restoredDefaultFromProject')
          : t('data.common.restoredDefaultEmpty'),
      );
    } catch (e) {
      showToast(
        t('data.common.restoredDefaultFailed') +
          '：' +
          (e instanceof Error ? e.message : String(e)),
        'error',
      );
    }
  };

  // ─── 添加分组（打开弹窗）───
  const openCreateGroup = () => {
    setGroupDialog({ open: true, mode: 'create', label: '', icon: '👤' });
  };

  // ─── 编辑分组（打开弹窗）───
  const openEditGroup = (group: TemplateGroup) => {
    setGroupDialog({
      open: true,
      mode: 'edit',
      id: group.id,
      label: group.label,
      icon: group.icon,
    });
  };

  // ─── 保存分组（新增/编辑）───
  const handleSaveGroup = () => {
    if (!template) return;
    const label = groupDialog.label.trim();
    if (!label) {
      showToast(t('data.common.groupNameRequired'), 'error');
      return;
    }
    if (groupDialog.mode === 'create') {
      const newGroup: TemplateGroup = {
        id: generateGroupId(label, template.groups),
        label,
        icon: groupDialog.icon,
        fields: [],
      };
      setTemplate({ ...template, groups: [...template.groups, newGroup] });
      setSelectedGroupId(newGroup.id);
      showToast(t('data.common.groupAdded'));
    } else if (groupDialog.mode === 'edit' && groupDialog.id) {
      setTemplate({
        ...template,
        groups: template.groups.map((g) =>
          g.id === groupDialog.id ? { ...g, label, icon: groupDialog.icon } : g,
        ),
      });
      showToast(t('data.common.groupUpdated'));
    }
    setGroupDialog({ open: false, mode: 'create', label: '', icon: '👤' });
  };

  // ─── 删除分组 ───
  const handleDeleteGroup = (group: TemplateGroup) => {
    if (!template) return;
    setTemplate({ ...template, groups: template.groups.filter((g) => g.id !== group.id) });
    if (selectedGroupId === group.id) {
      const remaining = template.groups.filter((g) => g.id !== group.id);
      setSelectedGroupId(remaining[0]?.id ?? null);
    }
    setConfirmDeleteGroup(null);
    showToast(t('data.common.groupDeleted'));
  };

  // ─── 添加字段（打开弹窗）───
  const openCreateField = (groupId: string) => {
    setFieldDialog({
      open: true,
      mode: 'create',
      groupId,
      field: { key: '', label: '', type: 'number', default: 0, description: '' },
    });
  };

  // ─── 编辑字段（打开弹窗）───
  const openEditField = (groupId: string, field: TemplateField) => {
    setFieldDialog({
      open: true,
      mode: 'edit',
      groupId,
      field: deepClone(field),
    });
  };

  // ─── 保存字段（新增/编辑）───
  const handleSaveField = () => {
    if (!template || !fieldDialog) return;
    const f = fieldDialog.field;
    const key = f.key.trim();
    const label = f.label.trim();
    if (!key) {
      showToast(t('data.common.fieldKeyRequired'), 'error');
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      showToast(t('data.common.keyInvalid'), 'error');
      return;
    }
    if (!label) {
      showToast(t('data.common.fieldLabelRequired'), 'error');
      return;
    }
    if (f.type === 'enum' && (!f.options || f.options.length === 0)) {
      showToast(t('data.common.enumNeedsOption'), 'error');
      return;
    }

    const group = template.groups.find((g) => g.id === fieldDialog.groupId);
    if (!group) return;

    // 检查 key 唯一性
    if (fieldDialog.mode === 'create') {
      if (group.fields.some((existing) => existing.key === key)) {
        showToast(t('data.common.keyExists', { key }), 'error');
        return;
      }
    } else {
      // 编辑模式：检查除自身外的 key 重复
      if (
        group.fields.some(
          (existing) => existing.key === key && existing.key !== fieldDialog.field.key,
        )
      ) {
        showToast(t('data.common.keyExists', { key }), 'error');
        return;
      }
    }

    // enum 类型若没有 default，使用第一个 option
    const finalField: TemplateField = { ...f, key, label };
    if (f.type === 'enum' && f.options && f.options.length > 0) {
      if (finalField.default === undefined || finalField.default === '') {
        finalField.default = f.options[0].value;
      }
    }
    // 非 enum 类型清除 options
    if (f.type !== 'enum') {
      delete finalField.options;
    }

    setTemplate({
      ...template,
      groups: template.groups.map((g) => {
        if (g.id !== fieldDialog.groupId) return g;
        if (fieldDialog.mode === 'create') {
          return { ...g, fields: [...g.fields, finalField] };
        } else {
          return {
            ...g,
            fields: g.fields.map((existing) =>
              existing.key === fieldDialog.field.key ? finalField : existing,
            ),
          };
        }
      }),
    });

    showToast(
      fieldDialog.mode === 'create' ? t('data.common.fieldAdded') : t('data.common.fieldUpdated'),
    );
    setFieldDialog(null);
  };

  // ─── 删除字段 ───
  const handleDeleteField = (groupId: string, field: TemplateField) => {
    if (!template) return;
    if (field.auto) {
      showToast(t('data.common.autoNotDeletable'), 'error');
      return;
    }
    setTemplate({
      ...template,
      groups: template.groups.map((g) =>
        g.id === groupId ? { ...g, fields: g.fields.filter((f) => f.key !== field.key) } : g,
      ),
    });
    showToast(t('data.common.fieldDeleted'));
  };

  // ─── 更新 fieldDialog 中的 field 属性 ───
  const updateDialogField = (patch: Partial<TemplateField>) => {
    setFieldDialog((prev) => (prev ? { ...prev, field: { ...prev.field, ...patch } } : null));
  };

  // ─── 渲染 ───

  if (!projectPath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title={t('launch.common.selectProject')}
          description={t('data.common.selectProjectHintTemplate')}
        />
      </div>
    );
  }

  if (loading && !template) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-zinc-500 text-sm">
        <Spinner size="sm" />
        <span>{t('launch.common.loading')}</span>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-red-400">{t('data.common.templateLoadFailed')}</p>
        <Button variant="secondary" size="sm" onClick={loadTemplate}>
          {t('launch.common.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* 顶部工具栏 */}
      <TemplateToolbar
        groupCount={template.groups.length}
        fieldCount={template.groups.reduce((s, g) => s + g.fields.length, 0)}
        saving={saving}
        onReset={handleReset}
        onSave={handleSave}
      />

      {/* 主体：左右分栏 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：分组列表 */}
        <div className="w-[30%] min-w-[200px] border-r border-zinc-800 flex flex-col">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              {t('data.common.groupList')}
            </span>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-3 h-3" />}
              onClick={openCreateGroup}
            >
              {t('launch.common.addGroup')}
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {template.groups.length === 0 && (
              <EmptyState
                title={t('launch.common.noGroups')}
                description={t('data.common.createFirstGroupHint')}
                action={
                  <Button variant="primary" size="sm" onClick={openCreateGroup}>
                    {t('launch.common.addGroup')}
                  </Button>
                }
              />
            )}
            {template.groups.map((group) => (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                aria-label={t('data.common.selectGroupAria', { name: group.label })}
                className={`px-3 py-2 text-xs cursor-pointer border-l-2 group ${
                  selectedGroupId === group.id
                    ? 'bg-zinc-800 text-zinc-200 border-l-blue-500'
                    : 'text-zinc-400 hover:bg-zinc-800/50 border-l-transparent'
                }`}
                onClick={() => setSelectedGroupId(group.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedGroupId(group.id);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm">{group.icon}</span>
                    <span className="font-medium truncate">{group.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-zinc-500">
                      {t('data.common.fieldCount', { count: String(group.fields.length) })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100"
                      leftIcon={<Pencil className="w-3 h-3" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditGroup(group);
                      }}
                      title={t('data.common.editGroup')}
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100"
                      leftIcon={<X className="w-3 h-3" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteGroup(group);
                      }}
                      title={t('launch.common.deleteGroup')}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：字段编辑 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedGroup && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-zinc-500 text-sm mb-2">{t('data.common.selectGroup')}</div>
                <div className="text-zinc-500 text-xs">{t('data.common.selectGroupHint')}</div>
              </div>
            </div>
          )}
          {selectedGroup && (
            <GroupSection
              group={selectedGroup}
              onAddField={openCreateField}
              onEditField={openEditField}
              onDeleteField={handleDeleteField}
            />
          )}
        </div>
      </div>

      {/* Toast 由全局 ToastProvider 提供 */}

      {/* 分组新增/编辑弹窗 */}
      <Modal
        open={groupDialog.open}
        onClose={() => setGroupDialog((prev) => ({ ...prev, open: false }))}
        title={
          groupDialog.mode === 'create' ? t('launch.common.addGroup') : t('data.common.editGroup')
        }
        width="320px"
        footer={
          <ModalFooter
            onCancel={() => setGroupDialog((prev) => ({ ...prev, open: false }))}
            onConfirm={handleSaveGroup}
            confirmText={t('launch.common.confirmSave')}
          />
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">{t('data.common.icon')}</label>
            <IconPicker
              value={groupDialog.icon}
              onChange={(icon) => setGroupDialog((prev) => ({ ...prev, icon }))}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">{t('data.common.groupName')}</label>
            <input
              className={`w-full ${inputForm}`}
              value={groupDialog.label}
              aria-label={t('data.common.groupName')}
              onChange={(e) => setGroupDialog((prev) => ({ ...prev, label: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveGroup()}
              placeholder={t('data.common.groupPlaceholder')}
              autoFocus
            />
          </div>
        </div>
      </Modal>

      {/* 字段新增/编辑弹窗 */}
      <Modal
        open={fieldDialog !== null}
        onClose={() => setFieldDialog(null)}
        title={
          (fieldDialog?.mode === 'create'
            ? t('launch.common.addField')
            : t('data.common.editField')) +
          (fieldDialog?.field.auto ? t('data.common.autoFieldSuffix') : '')
        }
        width="480px"
        footer={
          <ModalFooter
            onCancel={() => setFieldDialog(null)}
            onConfirm={handleSaveField}
            confirmText={t('launch.common.confirmSave')}
          />
        }
      >
        {fieldDialog && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">
                  {t('data.common.fieldKey')}
                </label>
                <input
                  className={`w-full ${inputMd} font-mono`}
                  value={fieldDialog.field.key}
                  aria-label={t('data.common.fieldKeyAria')}
                  onChange={(e) => updateDialogField({ key: e.target.value })}
                  placeholder={t('data.common.fieldKeyPlaceholder')}
                  disabled={fieldDialog.field.auto}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">
                  {t('data.common.zhLabel')}
                </label>
                <input
                  className={`w-full ${inputMd}`}
                  value={fieldDialog.field.label}
                  aria-label={t('data.common.fieldZhLabel')}
                  onChange={(e) => updateDialogField({ label: e.target.value })}
                  placeholder={t('data.common.fieldLabelPlaceholder')}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                {t('data.common.fieldType')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_FIELD_TYPES.map((ft) => (
                  <Button
                    key={ft}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={`border transition-colors ${
                      fieldDialog.field.type === ft
                        ? FIELD_TYPE_COLORS[ft] + ' ring-1 ring-blue-500'
                        : 'border-zinc-700'
                    }`}
                    onClick={() => {
                      // 切换类型时重置默认值和 options
                      const patch: Partial<TemplateField> = { type: ft };
                      if (ft === 'number') patch.default = 0;
                      else if (ft === 'boolean') patch.default = false;
                      else if (ft === 'text') patch.default = '';
                      else if (ft === 'date') patch.default = '';
                      else if (ft === 'datetime') patch.default = '';
                      else if (ft === 'json') patch.default = {};
                      else if (ft === 'enum') {
                        patch.default = '';
                        // 原实现先填默认 options 再判断覆盖，导致用户已配置的 enum 选项被错误重置
                        // 正确顺序：仅当用户未配置 options 时才填默认值
                        if (!fieldDialog.field.options || fieldDialog.field.options.length === 0) {
                          patch.options = [
                            { value: 'option1', label: t('data.common.optionDefault') },
                          ];
                        }
                        // 已有 options 时保留用户配置（不写入 patch.options）
                      }
                      updateDialogField(patch);
                    }}
                    disabled={fieldDialog.field.auto}
                  >
                    {FIELD_TYPE_LABELS[ft]}
                  </Button>
                ))}
              </div>
            </div>

            {/* 默认值 */}
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                {t('data.common.defaultValue')}
              </label>
              <DefaultValueEditor
                type={fieldDialog.field.type}
                value={fieldDialog.field.default}
                onChange={(v) => updateDialogField({ default: v })}
                options={fieldDialog.field.options}
              />
            </div>

            {/* enum 选项配置 */}
            {fieldDialog.field.type === 'enum' && (
              <div>
                <label className="text-xs text-zinc-500 block mb-1">
                  {t('data.common.enumOptions')}
                </label>
                <OptionsEditor
                  options={fieldDialog.field.options ?? []}
                  onChange={(opts) => updateDialogField({ options: opts })}
                />
              </div>
            )}

            {/* 描述 */}
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                {t('data.common.fieldDescOptional')}
              </label>
              <input
                className={`w-full ${inputMd}`}
                value={fieldDialog.field.description ?? ''}
                aria-label={t('data.design.fieldDescShort')}
                onChange={(e) => updateDialogField({ description: e.target.value })}
                placeholder={t('data.common.fieldDescPlaceholder')}
              />
            </div>

            {/* 角色卡分类（可选） */}
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                {t('data.common.categoryLabel')}
                <span className="ml-1 text-zinc-600">{t('data.common.categoryHint')}</span>
              </label>
              <Dropdown
                value={fieldDialog.field.category ?? ''}
                onChange={(v) => updateDialogField({ category: (v as FieldCategory) || undefined })}
                options={CATEGORY_OPTIONS}
                placeholder={t('data.common.uncategorized')}
              />
            </div>

            {/* auto 标记（仅编辑模式且当前为 auto 时显示提示） */}
            {fieldDialog.field.auto && (
              <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/40 rounded px-2 py-1.5">
                {t('data.common.autoFieldHint')}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 删除分组确认弹窗 */}
      <Modal
        open={confirmDeleteGroup !== null}
        onClose={() => setConfirmDeleteGroup(null)}
        title={t('data.common.confirmDeleteGroup')}
        width="320px"
        footer={
          <ModalFooter
            onCancel={() => setConfirmDeleteGroup(null)}
            onConfirm={() => confirmDeleteGroup && handleDeleteGroup(confirmDeleteGroup)}
            confirmText={t('launch.common.confirmDelete')}
            confirmVariant="danger"
          />
        }
      >
        {confirmDeleteGroup && (
          <>
            <div className="text-xs text-zinc-400 mb-1">
              {t('data.template.deleteGroupPrefix')}{' '}
              <span className="text-zinc-200">
                {confirmDeleteGroup.icon} {confirmDeleteGroup.label}
              </span>
            </div>
            <div className="text-xs text-zinc-500">
              {t('data.common.deleteGroupBody', {
                count: String(confirmDeleteGroup.fields.length),
              })}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
});
