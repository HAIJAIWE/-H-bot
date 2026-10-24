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
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
        <span className="text-xs text-zinc-300 font-medium whitespace-nowrap">
          {t('launch.toolbar.title')}
        </span>
        <span className="hidden @2xl:inline text-xs text-zinc-500 whitespace-nowrap">
          {t('launch.toolbar.subtitle', {
            groups: String(groupCount),
            fields: String(fieldCount),
          })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          className="whitespace-nowrap"
          onClick={onReset}
          title={t('launch.toolbar.resetTitle')}
        >
          {t('launch.toolbar.reset')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="whitespace-nowrap"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? t('launch.common.saving') : t('launch.toolbar.save')}
        </Button>
      </div>
    </div>
  );
});
