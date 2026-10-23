import { memo } from 'react';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface TemplateToolbarProps {
  groupCount: number;
  fieldCount: number;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
}

/** 顶部工具栏组件：模板信息统计、恢复默认、保存模板 */
export const TemplateToolbar = memo(function TemplateToolbar({
  groupCount,
  fieldCount,
  saving,
  onReset,
  onSave,
}: TemplateToolbarProps) {
  useLocaleSubscription();
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-300 font-medium">{t('launch.toolbar.title')}</span>
        <span className="text-xs text-zinc-500">
          {t('launch.toolbar.subtitle', {
            groups: String(groupCount),
            fields: String(fieldCount),
          })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onReset}
          title={t('launch.toolbar.resetTitle')}
        >
          {t('launch.toolbar.reset')}
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
          {saving ? t('launch.common.saving') : t('launch.toolbar.save')}
        </Button>
      </div>
    </div>
  );
});
