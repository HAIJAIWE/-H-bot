import { memo } from 'react';
import type { TemplateGroup, TemplateField } from '../../types/ipc';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Plus } from 'lucide-react';
import { FieldEditorRow } from './FieldEditorRow';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface GroupSectionProps {
  group: TemplateGroup;
  onAddField: (groupId: string) => void;
  onEditField: (groupId: string, field: TemplateField) => void;
  onDeleteField: (groupId: string, field: TemplateField) => void;
}

/** 分组区域组件：可折叠标题、字段列表、添加字段按钮 */
export const GroupSection = memo(function GroupSection({
  group,
  onAddField,
  onEditField,
  onDeleteField,
}: GroupSectionProps) {
  useLocaleSubscription();
  return (
    <>
      {/* 分组标题 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <span className="text-base">{group.icon}</span>
          <span className="text-sm text-zinc-200 font-medium">{group.label}</span>
          <span className="text-xs text-zinc-500">id: {group.id}</span>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus className="w-3 h-3" />}
          onClick={() => onAddField(group.id)}
        >
          {t('launch.common.addField')}
        </Button>
      </div>

      {/* 字段列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {group.fields.length === 0 && (
          <EmptyState
            title={t('launch.common.noFields')}
            description={t('data.common.addFieldHint')}
            action={
              <Button variant="primary" size="sm" onClick={() => onAddField(group.id)}>
                {t('launch.common.addField')}
              </Button>
            }
          />
        )}
        {group.fields.map((field) => (
          <FieldEditorRow
            key={field.key}
            field={field}
            onEdit={(f) => onEditField(group.id, f)}
            onDelete={(f) => onDeleteField(group.id, f)}
          />
        ))}
      </div>
    </>
  );
});
