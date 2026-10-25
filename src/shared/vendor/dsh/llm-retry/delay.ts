/**
 * 重试等待：退避时长怎么算、以及一次可取消的 sleep。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 * @upstream packages/llm/llm-retry/src/index.ts
 * @upstream https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：
 *   · 只取 `localDelay` 与 `cancellableDelay` 两个纯工具（上游它们私藏在插件 apply 里）；
 *   · 新增 `plannedRetryDelay` —— 把上游 `recover` 里"厂商给了 Retry-After 该怎么办"那段
 *     判断原样提出成纯函数：返回 `undefined` = 有界策略下这次不该重试；
 *   · 其余公式（指数封顶、对称抖动、抖动后再封顶）与上游逐字一致。
 */

import { MAX_TIMER_DELAY_MS, type ResolvedRetryPolicy } from './retry-policy'

/** 随机源（测试可注入确定性序列） */
export type RandomSource = () => number

/**
 * 第 `retry` 次重试（从 1 起）前的本地退避毫秒数。
 * 指数按 `min(retry - 1, 1024)` 封顶再乘初始值，抖动是 `1±jitterRatio` 的对称倍数，
 * 乘完之后再封顶一次 —— 抖动不许把等待顶过 `maxDelayMs`。
 */
export function localDelay(
  policy: ResolvedRetryPolicy,
  retry: number,
  random: RandomSource,
): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(policy.initialDelayMs * 2 ** exponent, policy.maxDelayMs)
  const jitter = 1 - policy.jitterRatio + 2 * policy.jitterRatio * random()
  return Math.min(exponential * jitter, policy.maxDelayMs)
}

/**
 * 这一次重试该等多久？`undefined` = 不要重试。
 *
 * 厂商通过 `Retry-After` 给出的等待**优先于本地退避**，但若它超过了策略允许的上限：
 * 有界策略直接放弃（等不起就别等），无界策略退回本地退避。
 */
export function plannedRetryDelay(
  policy: ResolvedRetryPolicy,
  retry: number,
  providerRetryAfterMs: number | undefined,
  random: RandomSource,
): number | undefined {
  if (
    providerRetryAfterMs !== undefined &&
    Number.isFinite(providerRetryAfterMs) &&
    providerRetryAfterMs > 0
  ) {
    if (providerRetryAfterMs > policy.maxDelayMs) {
      if (policy.mode === 'normal') return undefined
      return localDelay(policy, retry, random)
    }
    return providerRetryAfterMs
  }
  return localDelay(policy, retry, random)
}

/**
 * 可被取消的 sleep：等满返回 `true`，中途被取消返回 `false`（不抛）。
 * 调用方自己决定取消要变成异常还是正常返回。
 */
export function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  const bounded = Math.max(0, Math.min(delayMs, MAX_TIMER_DELAY_MS))
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, bounded)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
