// src/main/services/ai/timeContext.ts
//
// **时间上下文**（2026-10-26，第 55 批）。
//
// 语义对齐上游 DSH `packages/context/time-context/src/**`（377 行）：让模型知道
// "现在几点、距上一条消息过了多久"。上游是 Cordis 插件 + pre-step 钩子，按
// `refreshIntervalMs`（默认 10 分钟）节流后注入一条 **user message**。
//
// 本仓的适配（差异写进 docs/ai/dsh-small-packages-batch55-design.md §7）：
//   · **一轮一次采样**，拼进 system 提示尾部，不新增 message —— 不污染 messages 长度，
//     压缩/前缀缓存的判定是照着这个长度算的；
//   · 时间一律用进程时区（IANA 名），elapsed 用"约 N 分钟/小时/天"的人话；
//   · 历史条目的 `ts` 由调用方（ipc/aiAgentCore）取最后一条，这里只做格式化。
//
// 纯函数、无 IO：时间与上一条时间都从参数进来，测试不用改系统时钟。

/** 星期几（0 = 周日），按中文习惯给"周一…周六/周日" */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export interface TimeContextInput {
  /** 采样时刻；默认 now。测试注入固定时间用 */
  now?: Date
  /** IANA 时区；默认进程时区，非法值退回 UTC */
  timeZone?: string
  /** 上一条（模型可见的）消息时间，ISO 字符串；没有/非法都行（见返回文案） */
  previousMessageAt?: string | null
}

interface ClockParts {
  clock: string
  weekday: string
  timeZone: string
  /** 该时区的本地时间（用于算"日历上第几天"，避免跨时区算错天） */
  localDateKey: string
}

/** 取该时刻在指定时区的"钟面 + 星期"；时区非法退回 UTC（不抛） */
function clockParts(now: Date, timeZone: string | undefined): ClockParts {
  const zone = normalizeTimeZone(timeZone)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(p => p.type === type)?.value ?? ''
  const clock = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
  const localDateKey = `${get('year')}-${get('month')}-${get('day')}`
  // 星期单独取一次（en-US 的 short 是 Mon/Tue/…，与语言无关地稳定）
  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' })
    .format(now)
    .slice(0, 3)
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayShort)
  return {
    clock,
    weekday: WEEKDAYS[index >= 0 ? index : 0],
    timeZone: zone,
    localDateKey,
  }
}

/** 非法/空时区退回 UTC（Intl 对未知时区抛 RangeError） */
function normalizeTimeZone(timeZone: string | undefined): string {
  const raw = (timeZone ?? '').trim()
  if (!raw) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw })
    return raw
  } catch {
    return 'UTC'
  }
}

/** 毫秒 → "约 N 分钟前"这类人话（负数/不足一分钟都按"不到 1 分钟"） */
function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (totalSeconds < 60) return '不到 1 分钟前'
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `约 ${totalMinutes} 分钟前`
  const totalHours = Math.floor(totalMinutes / 60)
  const restMinutes = totalMinutes % 60
  if (totalHours < 24) {
    return `约 ${totalHours} 小时${restMinutes > 0 ? ` ${restMinutes} 分钟` : ''}前`
  }
  const totalDays = Math.floor(totalHours / 24)
  const restHours = totalHours % 24
  if (totalDays > 30) return `约 ${totalDays} 天前`
  return `约 ${totalDays} 天${restHours > 0 ? ` ${restHours} 小时` : ''}前`
}

/**
 * 生成两行时间上下文（**逐字**，见设计文档 §3.2）：
 *
 * ```
 * 时间：2026-10-26 07:52:31（Asia/Shanghai，周一）
 * 距上一条消息：约 8 分钟前
 * ```
 *
 * 没有上一条 → `距上一条消息：这是本次对话的第一条消息`
 * 上一条时间非法 → `距上一条消息：上一条消息没有时间记录`
 */
export function buildTimeContext(input: TimeContextInput = {}): string {
  const now = input.now ?? new Date()
  const parts = clockParts(now, input.timeZone)
  const lines = [`时间：${parts.clock}（${parts.timeZone}，${parts.weekday}）`]

  const rawPrevious = String(input.previousMessageAt ?? '').trim()
  if (!rawPrevious) {
    lines.push('距上一条消息：这是本次对话的第一条消息')
    return lines.join('\n')
  }
  const previous = new Date(rawPrevious)
  const previousMs = previous.getTime()
  if (Number.isNaN(previousMs)) {
    lines.push('距上一条消息：上一条消息没有时间记录')
    return lines.join('\n')
  }
  // 用"日历差"而不是裸 ms：跨时区/夏令时下 ms 差仍是正确的经过时间，但这里只做展示；
  // 负值（上一条在未来，多半是时钟被调过）按 0 处理 → "不到 1 分钟前"
  const elapsedMs = Math.max(0, now.getTime() - previousMs)
  lines.push(`距上一条消息：${formatElapsed(elapsedMs)}`)
  return lines.join('\n')
}
