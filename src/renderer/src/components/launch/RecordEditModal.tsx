import { useState, useEffect } from 'react';
import type { FieldSchema } from '@shared/types/launch';
import { type FieldConfig, BaseType } from '@shared/types/typeSystem';
import { TypeEditor } from './editors/TypeEditor';
import { RefEditor } from './editors/RefEditor';
import { Modal, ModalFooter } from '../ui/Modal';
import { columnLabel } from './dataBrowserConstants';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 数字类型集合：覆盖 BaseType 与 SQLite schema 类型名 */
const NUMBER_TYPES = new Set<string>([
  BaseType.Int,
  BaseType.BigInt,
  BaseType.Float,
  'integer',
  'real',
  'number',
]);

/**
 * 通用列名映射（schema 不存在时使用）—— 直接复用数据浏览面板那一份。
 * 原先这里有一份同名副本，两处各自维护必然出现「同一个字段两个叫法」，
 * 用户在看板里叫「用户ID」、在编辑弹窗里叫「UID」这种问题只有实测才发现。
 */
function getFieldLabel(field: FieldSchema): string {
  if (field.label) return field.label;
  return columnLabel(field.name);
}

function fieldSchemaToFieldConfig(field: FieldSchema): FieldConfig {
  // 如果字段有 enum 选项，强制使用 Enum 类型（SQLite schema 中 type 可能是 'text'）
  const hasOptions = field.options && field.options.length > 0;
  return {
    type: (hasOptions ? BaseType.Enum : field.type) as unknown as BaseType,
    label: getFieldLabel(field),
    enumValues: field.options,
    min: field.min,
    max: field.max,
  };
}

interface RecordEditModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: FieldSchema[];
  initialValues: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  mode: 'create' | 'edit';
  /**
   * 项目路径：**引用字段**要用它去目标配置表拉选项。
   * 不传 = 引用字段退化成普通文本框（老调用点仍可用，不强制）。
   */
  projectPath?: string;
}

export function RecordEditModal({
  open,
  onClose,
  title,
  fields,
  initialValues,
  onSave,
  projectPath,
}: RecordEditModalProps) {
  useLocaleSubscription();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues({ ...initialValues });
      setError(null);
    }
  }, [open, initialValues]);

  // 客户端校验：必填 + 数字类型
  const validate = (): string | null => {
    for (const field of fields) {
      const fieldConfig = fieldSchemaToFieldConfig(field);
      const label = getFieldLabel(field);
      const val = values[field.name];

      // 必填校验
      if (fieldConfig.required) {
        const isEmpty =
          val === null ||
          val === undefined ||
          val === '' ||
          (Array.isArray(val) && val.length === 0);
        if (isEmpty) return t('data.edit.isRequired', { label });
      }

      // 数字类型校验
      if (NUMBER_TYPES.has(String(fieldConfig.type))) {
        if (val !== null && val !== undefined && val !== '') {
          const num = Number(val);
          if (isNaN(num)) return t('data.edit.invalidNumber', { label });
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd + Enter 快捷保存（Escape 关闭由 Modal 统一处理）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="520px"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={handleSave}
          confirmText={saving ? t('launch.common.saving') : t('launch.common.confirmSave')}
          confirmDisabled={saving}
        />
      }
    >
      <div className="space-y-3" onKeyDown={handleKeyDown}>
        {fields.map((field) => {
          const fieldConfig = fieldSchemaToFieldConfig(field);
          // 引用字段走专用编辑器（值从目标表选）；拿不到项目路径时退回普通编辑器
          const isRef = !!field.refTable && !!projectPath;
          return (
            <div key={field.name}>
              <label className="block text-xs text-zinc-400 mb-1 group">
                <span>
                  {getFieldLabel(field)}
                  {fieldConfig.required && <span className="text-red-400 ml-0.5">*</span>}
                </span>
                {field.description && (
                  <span className="ml-1.5 text-zinc-600 cursor-help" title={field.description}>
                    [?]
                  </span>
                )}
                {isRef && (
                  <span
                    className="ml-1.5 text-amber-400/80"
                    title={t('data.ref.hint', { table: String(field.refTable) })}
                  >
                    ↗{field.refTable}
                  </span>
                )}
              </label>
              {isRef ? (
                <RefEditor
                  projectPath={projectPath!}
                  value={values[field.name]}
                  refTable={field.refTable}
                  refField={field.refField}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                />
              ) : (
                <TypeEditor
                  value={values[field.name] ?? null}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                  field={fieldConfig}
                />
              )}
            </div>
          );
        })}

        {error && (
          <div className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">{error}</div>
        )}
      </div>
    </Modal>
  );
}
