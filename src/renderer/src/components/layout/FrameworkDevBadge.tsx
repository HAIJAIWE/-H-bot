import { AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/**
 * 「框架开发模式开着」的**醒目标识**（规则⑥）。
 *
 * 为什么必须显眼、不能只留在设置里：开着这个模式时，AI / 代码编辑器改的是
 * **框架自己**的源码（不是某个机器人项目），而且改主进程要重启才生效 ——
 * 用户必须**一直看得见**这件事，否则很容易在"我在改我的机器人"的错觉里改坏框架。
 *
 * `enabled === false` 时渲染 `null`：关着的时候界面上**一个像素都不多**
 * （与改造前逐字节一致）。
 */
export function FrameworkDevBadge({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  useLocaleSubscription();
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      role="status"
      title={t('frameworkDev.badgeTitle')}
      aria-label={t('frameworkDev.badgeTitle')}
      className="inline-flex items-center gap-1 rounded border border-amber-500 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
    >
      <AlertTriangle aria-hidden="true" className="w-3 h-3" />
      {t('frameworkDev.badge')}
    </button>
  );
}
