// 开关组件：深色主题，开=blue-600，关=zinc-700，圆点=白色

interface SwitchProps {
  /** 是否开启 */
  checked: boolean;
  /** 切换回调 */
  onChange: (checked: boolean) => void;
  /** 标签文字 */
  label?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 尺寸：默认 / sm（行内紧凑模式） */
  size?: 'default' | 'sm';
}

/** 开关：点击切换，支持标签与禁用态 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'default',
}: SwitchProps) {
  const trigger = () => {
    if (!disabled) onChange(!checked);
  };

  const isSm = size === 'sm';
  const trackClass = isSm ? 'h-4 w-7' : 'h-5 w-9';
  const thumbClass = isSm ? 'h-3 w-3' : 'h-4 w-4';
  const thumbTranslate = isSm
    ? checked
      ? 'translate-x-3'
      : 'translate-x-0.5'
    : checked
      ? 'translate-x-4'
      : 'translate-x-0.5';
  const labelClass = isSm ? 'text-xs text-zinc-400' : 'text-sm text-zinc-300';

  return (
    <label
      className={`inline-flex items-center gap-2 ${labelClass} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`.trim()}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={trigger}
        className={`relative inline-flex ${trackClass} shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${checked ? 'bg-blue-600' : 'bg-zinc-700'}`.trim()}
      >
        <span
          className={`inline-block ${thumbClass} transform rounded-full bg-white transition-transform ${thumbTranslate}`.trim()}
        />
      </button>
      {label && <span className="select-none">{label}</span>}
    </label>
  );
}
