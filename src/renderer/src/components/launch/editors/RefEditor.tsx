// src/renderer/src/components/launch/editors/RefEditor.tsx
//
// 「引用字段」的录入控件：值从**目标配置表**里选，而不是手打。
//
// 这解决的是最毒的一类静默故障：`drops.monster_name` 手打成"史莱木"不会报错，
// 只是那条掉落**永远不触发**。做成下拉后，名字只能从表里来，错不了。
//
// 与 `TypeEditor` 的关系：不并进 TypeEditor 的 switch —— 那个组件的 `EditorProps`
// 只有 `value/onChange/field`，拿不到项目路径，也就无法去目标表拉选项；
// 改它的公共接口会波及全部 17 个编辑器。所以由弹窗层（RecordEditModal）拦截分发。
import { useLocaleSubscription } from '../../../stores/i18nStore';
import { t } from '../../../i18n';
import { Dropdown } from '../../ui/Dropdown';
import { useRefValueOptions } from '../useRefOptions';

export interface RefEditorProps {
  projectPath: string;
  value: unknown;
  refTable?: string;
  refField?: string;
  onChange: (val: unknown) => void;
}

export function RefEditor({ projectPath, value, refTable, refField, onChange }: RefEditorProps) {
  useLocaleSubscription();
  const current = value === null || value === undefined ? '' : String(value);
  const { options, loading, error } = useRefValueOptions(projectPath, refTable, refField, current);
  const currentMissing = !!current && options.length > 0 && !options.includes(current);

  return (
    <div>
      <Dropdown
        value={current}
        ariaLabel={t('data.ref.valueAria')}
        onChange={(v) => onChange(v === '' ? null : v)}
        options={options.map((v) => ({ value: v, label: v }))}
        placeholder={loading ? t('data.ref.loading') : t('data.ref.pickValue')}
      />
      {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
      {/* 悬空引用：目标表里已经没有这个值了。不拦保存（用户可能就是要先清干净），
          但必须说出来 —— 否则又是一次"看起来配好了、实际永远不生效"。 */}
      {!error && currentMissing && (
        <div className="text-xs text-amber-400 mt-1">{t('data.ref.stale', { value: current })}</div>
      )}
    </div>
  );
}
