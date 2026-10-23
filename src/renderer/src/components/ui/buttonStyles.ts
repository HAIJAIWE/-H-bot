/** 按钮变体 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

/** 按钮基础样式 */
const BASE = 'rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

/** 按钮尺寸样式 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
}

/** 按钮变体样式 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white',
  secondary: 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
  danger: 'bg-red-700 hover:bg-red-600 text-white',
  ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-400',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
}

/** 获取按钮样式类名 */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = ''): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`.trim()
}
