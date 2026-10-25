// src/main/vendor/dsh/tool-pipeline/pipeline.ts
//
// 上游 `packages/core/tools/src/pipeline.ts` 里**与宿主无关**的那部分：fail-closed 并行判定、
// 取消文案、错误归一、waterfall 组合。搬运取舍与逐条改动见 docs/ai/agent-core-wiring.md §45。
//
// @license MIT
// @copyright Copyright (c) 2026 DeepSeek
// @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
// @upstream packages/core/tools/src/pipeline.ts
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/core/tools/src/pipeline.ts
//
// 本仓库改动（2026-10-26）：① 只取纯函数与类型，`ToolExecutionPipeline` 的 Cordis 装订与
// prepare/dispatch/complete 状态机留在适配层；② 不搬 deepFreeze/快照、validateJsonSchemaValue/
// render/ContentBlock（工具结果已是字符串）；③ 文案拆常量 + cancellationText，failureMessageFromContent
// 收窄成 failureMessageFromText；④ fuseToolSignals 收 AbortController 作 wrapper 并返回 dispose；
// ⑤ composeWaterfall 的返回值收 value。
/** 一个调用怎么和同批的其它调用共存：可并行 / 独占屏障 */
export type ToolExecutionMode = 'parallel' | 'exclusive'

/**
 * 并行判定：**只有显式声明且当场返回字面 true 才并行**。
 * 未声明、返回 truthy 非 true、抛错 —— 一律独占（猜错并行的代价是数据竞争，不是慢一点）。
 */
export function failClosedMode<Args>(
  isConcurrencySafe: ((args: Args) => boolean) | undefined,
  args: Args,
): ToolExecutionMode {
  if (typeof isConcurrencySafe !== 'function') return 'exclusive'
  try {
    return isConcurrencySafe(args) === true ? 'parallel' : 'exclusive'
  } catch {
    return 'exclusive'
  }
}

/** 取消：body 已经开跑的说法（上游 `toolAbortedResult` 的 text） */
export const TOOL_ABORTED_TEXT = 'Error: tool call aborted'
/** 取消：还没派发的说法（上游 `toolAbortedBeforeDispatchResult` 的 text） */
export const TOOL_ABORTED_BEFORE_DISPATCH_TEXT = 'Error: tool call aborted before dispatch'

/** 取消文案：tool body 有没有真的开始跑，决定模型看到哪一句 */
export function cancellationText(bodyInvoked: boolean): string {
  return bodyInvoked ? TOOL_ABORTED_TEXT : TOOL_ABORTED_BEFORE_DISPATCH_TEXT
}

/**
 * 任意抛出来的东西 → 一句人话（上游 `toolErrorMessage` 逐字）：
 * Error 取 message；带字符串 message 的对象取它；否则 String()；String() 自己再抛就兜底。
 */
export function toolErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    return String(error)
  } catch {
    return '<unprintable thrown value>'
  }
}

/** post-execute 的 block 反馈是空串时，模型也要看到一句非空原因（上游默认文案） */
export function failureMessageFromText(text: string): string {
  return text.length === 0 ? 'tool result blocked by post-execute policy' : text
}

/** 把 caller 的 abort 接到本次 dispatch 自建的取消域上；返回幂等的摘钩函数 */
export function fuseToolSignals(
  caller: AbortSignal | undefined,
  wrapper: AbortController,
): () => void {
  if (!caller || caller === wrapper.signal || wrapper.signal.aborted) return () => {}
  if (caller.aborted) {
    wrapper.abort(caller.reason)
    return () => {}
  }
  const forward = (): void => wrapper.abort(caller.reason)
  caller.addEventListener('abort', forward, { once: true })
  return () => caller.removeEventListener('abort', forward)
}

/** 信号没给也算没取消（上游 `isAborted`） */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** 一个钩子：拿到值，决定调不调 next（不调 = 短路） */
export type Waterfall<T, R> = (value: T, next: () => Promise<R>) => Promise<R>

/**
 * 从右往左折叠成一条链：hooks[0] 最外层，`terminal` 是默认出口。
 * 返回的函数收 value —— 每个钩子拿到同一个值；短路只在 next() 没被调时发生。
 */
export function composeWaterfall<T, R>(
  hooks: readonly Waterfall<T, R>[],
  terminal: () => Promise<R>,
): (value: T) => Promise<R> {
  return async value => {
    let next: () => Promise<R> = terminal
    for (let i = hooks.length - 1; i >= 0; i -= 1) {
      const hook = hooks[i]
      const downstream = next
      next = () => hook(value, downstream)
    }
    return next()
  }
}
