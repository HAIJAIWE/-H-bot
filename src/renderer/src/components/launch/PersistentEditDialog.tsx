import { Dropdown } from '../ui/Dropdown';
import { Modal, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { inputForm } from '../ui/inputStyles';
import type { FieldType } from './dataBrowserConstants';
import { getRawKey } from './dataBrowserConstants';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** _persistent 智能编辑弹窗状态类型 */
interface PersistentEditState {
  open: boolean;
  key: string;
  label: string;
  type: FieldType;
  value: unknown;
  rowid: number | null;
  filePath: string;
  tableName: string;
}

interface PersistentEditDialogProps {
  /** 弹窗状态（仅当 open 为 true 时渲染） */
  persistentEdit: PersistentEditState;
  /** 输入框值（已通过 valueToInput 转换） */
  persistentEditValue: string;
  /** 是否保存中 */
  persistentEditSaving: boolean;
  /** 动态 enum 选项映射 */
  dynamicFieldEnums: Record<string, { value: string; label: string }[]>;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 输入值变更 */
  onValueChange: (v: string) => void;
  /** 保存 */
  onSave: () => void;
}

/**
 * _persistent 智能编辑弹窗
 *
 * 原为 DataBrowserPanel 中内联的自定义弹窗，提取为独立组件。
 * 根据字段类型渲染不同的编辑器：number / boolean / text / date / datetime / json / enum。
 */
export function PersistentEditDialog({
  persistentEdit,
  persistentEditValue,
  persistentEditSaving,
  dynamicFieldEnums,
  onClose,
  onValueChange,
  onSave,
}: PersistentEditDialogProps) {
  useLocaleSubscription();
  if (!persistentEdit.open) return null;

  return (
    <Modal
      open={persistentEdit.open}
      onClose={onClose}
      title={t('data.persist.editTitle', { name: persistentEdit.label })}
      width="384px"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={onSave}
          confirmDisabled={persistentEditSaving}
          confirmText={
            persistentEditSaving ? t('launch.common.saving') : t('launch.common.confirmSave')
          }
        />
      }
    >
      <div className="text-xs text-zinc-500 mb-3 truncate" title={persistentEdit.key}>
        {persistentEdit.key}
      </div>

      <div className="mb-4">
        {persistentEdit.type === 'number' && (
          <input
            type="number"
            className={`w-full ${inputForm}`}
            value={persistentEditValue}
            aria-label={t('data.persist.editNumericAria', { name: persistentEdit.label })}
            onChange={function (e) {
              onValueChange(e.target.value);
            }}
            onKeyDown={function (e) {
              if (e.key === 'Enter') onSave();
            }}
            autoFocus
          />
        )}
        {persistentEdit.type === 'boolean' && (
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              className={
                'px-4 py-1.5 ' +
                (persistentEditValue === 'true'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700')
              }
              onClick={function () {
                onValueChange('true');
              }}
            >
              {t('data.yes')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className={
                'px-4 py-1.5 ' +
                (persistentEditValue === 'false'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700')
              }
              onClick={function () {
                onValueChange('false');
              }}
            >
              {t('data.no')}
            </Button>
          </div>
        )}
        {persistentEdit.type === 'text' && (
          <input
            type="text"
            className={`w-full ${inputForm}`}
            value={persistentEditValue}
            aria-label={t('data.persist.editTextAria', { name: persistentEdit.label })}
            onChange={function (e) {
              onValueChange(e.target.value);
            }}
            onKeyDown={function (e) {
              if (e.key === 'Enter') onSave();
            }}
            autoFocus
          />
        )}
        {persistentEdit.type === 'date' && (
          <input
            type="date"
            className={`w-full ${inputForm}`}
            value={persistentEditValue}
            aria-label={t('data.persist.editDateAria', { name: persistentEdit.label })}
            onChange={function (e) {
              onValueChange(e.target.value);
            }}
            autoFocus
          />
        )}
        {persistentEdit.type === 'datetime' && (
          <input
            type="datetime-local"
            className={`w-full ${inputForm}`}
            value={persistentEditValue}
            aria-label={t('data.persist.editDatetimeAria', { name: persistentEdit.label })}
            onChange={function (e) {
              onValueChange(e.target.value);
            }}
            autoFocus
          />
        )}
        {persistentEdit.type === 'json' && (
          <textarea
            className={`w-full ${inputForm} font-mono`}
            rows={6}
            value={persistentEditValue}
            aria-label={t('data.persist.editJsonAria', { name: persistentEdit.label })}
            onChange={function (e) {
              onValueChange(e.target.value);
            }}
            autoFocus
          />
        )}
        {persistentEdit.type === 'enum' && (
          <Dropdown
            value={persistentEditValue}
            ariaLabel={t('data.persist.editEnumAria', { name: persistentEdit.label })}
            onChange={function (v) {
              onValueChange(v);
            }}
            options={(dynamicFieldEnums[getRawKey(persistentEdit.key)] || []).map(function (opt) {
              return { value: opt.value, label: opt.label };
            })}
            placeholder={t('launch.common.pleaseSelect')}
          />
        )}
      </div>
    </Modal>
  );
}
