// src/renderer/src/components/launch/RefFieldPicker.tsx
//
// 「引用字段」的配置控件：选**引用哪张配置表** + **用该表的哪个字段**作为选项值。
//
// 为什么要抽成组件：建表向导（CreateTableWizard）与改表弹窗（TableDesignModal）都要用它，
// 各自内联一份必然漂移（本项目已经吃过"同一份清单两处维护"的亏，见 docs/nodes/nodes-audit-handoff.md 闸 1）。
// 取数据的逻辑统一在 `useRefOptions.ts`，与录入端的 `RefEditor` 共用同一份实现。
import { useLocaleSubscription } from '../../stores/i18nStore';
import { t } from '../../i18n';
import { Dropdown } from '../ui/Dropdown';
import { fieldLabel, useConfigTables, useTableFields } from './useRefOptions';

/** 引用配置（两个字段要么都有，要么都没有） */
export interface RefConfig {
  refTable?: string;
  refField?: string;
}

interface RefFieldPickerProps {
  projectPath: string;
  value: RefConfig;
  onChange: (patch: RefConfig) => void;
  /** 建表向导里被创建的表还不存在；改表弹窗传本表名，好让用户建自引用 */
  extraTableOption?: string;
}

export function RefFieldPicker({
  projectPath,
  value,
  onChange,
  extraTableOption,
}: RefFieldPickerProps) {
  useLocaleSubscription();
  const {
    tables,
    loading: loadingTables,
    error: tablesError,
  } = useConfigTables(projectPath, extraTableOption);
  const { fields, error: fieldsError } = useTableFields(projectPath, value.refTable);

  const tableOptions = tables.map((t) => ({ value: t.name, label: t.label }));
  const fieldOptions = fields.map((f) => ({ value: f.name, label: fieldLabel(f) }));
  const error = tablesError ?? fieldsError;

  return (
    <div className="flex flex-wrap items-center gap-2 pl-1">
      <label className="text-xs text-zinc-500 w-14 shrink-0">{t('data.ref.label')}</label>
      <div className="w-40">
        <Dropdown
          value={value.refTable ?? ''}
          ariaLabel={t('data.ref.tableAria')}
          onChange={(v) => onChange({ refTable: v || undefined, refField: undefined })}
          options={tableOptions}
          placeholder={loadingTables ? t('data.ref.loading') : t('data.ref.pickTable')}
        />
      </div>
      <span className="text-zinc-500 text-xs">{t('data.ref.of')}</span>
      <div className="w-52">
        <Dropdown
          value={value.refField ?? ''}
          ariaLabel={t('data.ref.fieldAria')}
          onChange={(v) => onChange({ refField: v || undefined })}
          options={fieldOptions}
          placeholder={value.refTable ? t('data.ref.pickField') : t('data.ref.pickFieldFirst')}
        />
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {!error && value.refTable && fields.length === 0 && (
        <span className="text-xs text-amber-400">{t('data.ref.noFields')}</span>
      )}
    </div>
  );
}
