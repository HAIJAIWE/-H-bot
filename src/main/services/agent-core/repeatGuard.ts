// src/main/services/agent-core/repeatGuard.ts
//
// **连续重复调用提醒**（2026-10-25，搬自 DSH 的 `guard/repeat-tool-reminder`）。
//
// 为什么需要它：真机上模型在「工具结果不配对」时同一调用连发 12 轮；配对修好之后
// 这类循环仍可能因为别的原因出现（读到的内容没变、命令反复失败）。上游的做法是
// 不拦截、不否决，只在**事后**往下一轮请求里塞一条提醒：先温和，再点名。
//
// 这里只搬算法（vendor/dsh/repeat-tool-reminder/detector.ts），接线是我们自己的：
// 链由一次 `runAgentLoop` 持有，命中阈值就把提醒当成一条 user 回合推进对话。
import {
  DEFAULT_ARGUMENTS_PREVIEW_CHARS,
  DEFAULT_REPEAT_THRESHOLDS,
  GENTLE_REMINDER,
  canonicalizeArguments,
  detailedReminder,
  previewArguments,
  validateThresholds,
  wildcardToRegExp,
} from '../../vendor/dsh/repeat-tool-reminder/detector'

export interface RepeatGuardOptions {
  /** 连续重复到这些次数就提醒（默认 [3, 5, 8]） */
  thresholds?: readonly number[]
  /** 只盯这些工具（`*` 通配；空 = 全盯） */
  include?: string[]
  /** 这些工具当成透明（既不计数也不清零） */
  exclude?: string[]
  /** 提醒里引用参数的字符上限（默认 500；检测永远比完整字符串） */
  argumentsPreviewChars?: number
}

interface Chain {
  key: string
  count: number
}

/**
 * 一条重复链：`observe` 每次工具落地调用一次，命中阈值返回要注入的提醒文本。
 * 与上游一致：**只对连续相同的调用计数**，任何一次不同的调用都把链清零。
 */
export class RepeatGuard {
  private readonly thresholds: number[]
  private readonly thresholdSet: Set<number>
  private readonly include: RegExp[]
  private readonly exclude: RegExp[]
  private readonly previewChars: number
  private chain: Chain | undefined

  constructor(options: RepeatGuardOptions = {}) {
    this.thresholds = validateThresholds(options.thresholds ?? DEFAULT_REPEAT_THRESHOLDS)
    this.thresholdSet = new Set(this.thresholds)
    this.include = (options.include ?? []).map(wildcardToRegExp)
    this.exclude = (options.exclude ?? []).map(wildcardToRegExp)
    const previewChars = options.argumentsPreviewChars ?? DEFAULT_ARGUMENTS_PREVIEW_CHARS
    if (!Number.isInteger(previewChars) || previewChars < 1) {
      throw new Error(
        `repeat-tool-reminder: invalid argumentsPreviewChars ${previewChars} — must be an integer >= 1`,
      )
    }
    this.previewChars = previewChars
  }

  /** 这个工具参与计数吗（不参与 = 透明：不清零也不计数） */
  private tracked(toolName: string): boolean {
    if (this.include.length > 0 && !this.include.some(pattern => pattern.test(toolName))) {
      return false
    }
    return !this.exclude.some(pattern => pattern.test(toolName))
  }

  /**
   * 记一次调用。命中阈值返回提醒文本，否则 undefined。
   * 失败/被拒的调用也计数 —— 模型反复锤同一个被拒的调用，正是最该点破的循环。
   */
  observe(toolName: string, args: unknown): string | undefined {
    if (!this.tracked(toolName)) return undefined
    const canonical = canonicalizeArguments(args)
    const key = JSON.stringify([toolName, canonical])
    const count = this.chain !== undefined && this.chain.key === key ? this.chain.count + 1 : 1
    this.chain = { key, count }
    if (!this.thresholdSet.has(count)) return undefined
    return count === this.thresholds[0]
      ? GENTLE_REMINDER
      : detailedReminder(toolName, count, previewArguments(canonical, this.previewChars))
  }

  /** 用户插话后重来：跨过插话的重复不算循环 */
  reset(): void {
    this.chain = undefined
  }

  /** 当前连续次数（诊断/测试用） */
  get consecutive(): number {
    return this.chain?.count ?? 0
  }
}
