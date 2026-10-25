// src/renderer/src/components/ai/RunningLine.tsx
//
// **运行中的那一行**（对齐 DSH 的 `RunningStatus`）：一个脉冲点 + 一句微光文案，
// 12px / 22px 行高，只占一行。为什么不做成气泡或三跳点：它描述的是"整轮还在写"，
// 不是"某一条消息在输入中" —— 气泡会给它一个并不存在的发送者。
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { formatDuration } from './TurnProcess'

export function RunningLine({
  elapsed = 0,
  label,
}: {
  /** 已耗时（秒）；0 = 刚起步，不显示时长 */
  elapsed?: number
  /** 当前这一步在干什么（工具名/阶段）；由调用方给，可能为空 */
  label?: string
}): React.ReactNode {
  useLocaleSubscription()
  const text =
    elapsed > 0
      ? t('ai.running.for', { duration: formatDuration(elapsed * 1000) })
      : t('ai.running.idle')
  return (
    <div className="mb-3 flex items-center gap-1.5 px-1 text-[12px] leading-[22px]" role="status">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-400"
      />
      <span className="animate-pulse bg-gradient-to-r from-sky-300 via-zinc-400 to-sky-400 bg-clip-text text-transparent">
        {text}
      </span>
      {label && <span className="min-w-0 truncate text-zinc-600">{label}</span>}
    </div>
  )
}
