import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
// 加载圆圈组件：用 animate-spin + border 实现，zinc 配色

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** 尺寸对应的宽高与边框粗细 */
const SIZE_CLASS: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'w-3 h-3 border-2',
  md: 'w-4 h-4 border-2',
  lg: 'w-6 h-6 border-[3px]',
};

/** 加载圆圈：旋转的环形动画 */
export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  useLocaleSubscription();
  return (
    <span
      className={`inline-block rounded-full border-zinc-600 border-t-zinc-200 animate-spin ${SIZE_CLASS[size]} ${className}`.trim()}
      role="status"
      aria-label={t('ui.loading')}
    />
  );
}
