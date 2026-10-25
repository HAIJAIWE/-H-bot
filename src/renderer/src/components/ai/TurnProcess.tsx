// src/renderer/src/components/ai/TurnProcess.tsx
//
// **一轮的过程行**（对齐 DSH 的 `TurnProcessNodeView`）：整轮收成一行结算 ——
// 「工作了 12 秒」+ 右侧「5 次工具」，点开才是思考与每一条工具调用。
// 位置在**助手正文之上**（DSH 也一样）：先看它干了多久、几步，再读结论。
import { useState } from 'react'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

export type TurnOutcome = 'done' | 'stopped' | 'failed'

/** 耗时文案：不足 1 分钟说秒，超过说「m 分 ss 秒」（DSH 的 formatRunDuration 口径） */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  if (total < 60) return t('ai.process.seconds', { n: String(total) })
  return t('ai.process.minutes', {
    m: String(Math.floor(total / 60)),
    s: String(total % 60).padStart(2, '0'),
  })
}

export function TurnProcess({
  outcome = 'done',
  elapsedMs,
  tools = 0,
  running = false,
  defaultOpen = false,
  children,
}: {
  /** 这一轮怎么结束的（决定结算文案；DSH：停止/失败不显示时长） */
  outcome?: TurnOutcome
  elapsedMs?: number
  /** 这一轮调了几次工具（只用于右侧计数） */
  tools?: number
  /** 还在跑：文案换成「执行中」并默认展开 */
  running?: boolean
  defaultOpen?: boolean
  /** 展开后的内容：思考行 + 每一条工具行 */
  children?: React.ReactNode
}): React.ReactNode {
  useLocaleSubscription()
  const [open, setOpen] = useState(defaultOpen || running)
  if (!children) return null

  const label = running
    ? t('ai.process.running')
    : outcome === 'failed'
      ? t('ai.process.failed')
      : outcome === 'stopped'
        ? t('ai.process.stopped')
        : elapsedMs
          ? t('ai.process.took', { duration: formatDuration(elapsedMs) })
          : t('ai.process.worked')

  return (
    <div data-turn-process data-state={running ? 'running' : outcome} className="mb-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] leading-[22px] transition-colors hover:text-zinc-300 ${
          running ? 'text-zinc-400' : 'text-zinc-500'
        }`}
      >
        <span aria-hidden="true" className="shrink-0 text-[10px] text-zinc-600">
          {open ? '▾' : '▸'}
        </span>
        <span className={`truncate ${running ? 'animate-pulse' : ''}`}>{label}</span>
        {tools > 0 && (
          <span className="ml-auto shrink-0 text-zinc-600">
            {t('ai.process.tools', { n: String(tools) })}
          </span>
        )}
      </button>
      {open && <div className="mt-0.5 mb-1 border-l border-zinc-800/70 pl-2">{children}</div>}
    </div>
  )
}
