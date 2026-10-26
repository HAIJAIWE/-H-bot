// src/renderer/src/components/ai/AiRailButton.tsx
//
// 图标轨上的一个按钮：hover 用 title 交代含义，不占宽度。
// 拆成独立文件是为了守住 fileGrowth 的 800 行上限（第 57 批接上正文搜索 + 导出/删除后
// AiSidebar 越线，这里先搬出最大的两个纯展示块）。
import type { LucideIcon } from 'lucide-react'

export function RailButton({
  icon: Icon,
  label,
  /** 禁用时**说明为什么**（否则用户只看到图标变淡，点了没反应只能靠猜） */
  disabledHint,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  disabledHint?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      title={disabled && disabledHint ? disabledHint : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${
        active
          ? 'bg-blue-500/15 text-blue-400'
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <Icon size={17} />
    </button>
  )
}
