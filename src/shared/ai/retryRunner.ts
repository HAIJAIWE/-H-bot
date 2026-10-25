// src/shared/ai/retryRunner.ts
//
// LLM 调用的重试执行器：把上游的策略/退避（`vendor/dsh/llm-retry/`）接到我们的错误形状上。
//
// 判"值不值得重试"要看得见 HTTP 状态码，所以先按厂商错误分类成故障码
// （RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT ...），再由策略里的 `retryableCodes` 说了算
// —— 判据是配置，不是正则猜消息。分类只做 `status` 与明确网络词两件事（见 §43）。
//
// 这里不 import `ProviderHttpError`（那会形成 ai-provider ↔ retryRunner 的循环依赖），
// 只读错误对象上的 `status` / `retryAfterMs` 两个字段。

import {
  MAX_TIMER_DELAY_MS,
  resolveRetryPolicy,
  type RetryPolicyConfig,
  type ResolvedRetryPolicy,
} from '../vendor/dsh/llm-retry/retry-policy'
import { cancellableDelay, localDelay, plannedRetryDelay } from '../vendor/dsh/llm-retry/delay'

/** 我们认得的故障码。前五个与上游默认白名单同名，`UNKNOWN` 永远不在默认白名单里 */
export type LlmFailureCode =
  'EMPTY_RESPONSE' | 'RATE_LIMIT' | 'SERVER' | 'TIMEOUT' | 'TRANSPORT' | 'UNKNOWN'

/** 上游默认白名单（与 vendor 里那份一致，这里导出方便调用方判断） */
export const RETRYABLE_FAILURE_CODES: readonly LlmFailureCode[] = Object.freeze([
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/**
 * 我们的聊天默认尝试次数（含首次）。
 *
 * 上游默认是 5 次**重试**（共 6 次请求），那是给长跑 agent 用的；我们一次聊天超时 180s，
 * 6 次会把"卡住"放大成十几分钟，所以维持原来的 3 次尝试。要改就传 `policy`。
 */
export const DEFAULT_MAX_ATTEMPTS = 3

/** 无 signal 时的替身（永不取消） */
const NEVER_ABORTED = new AbortController().signal

/**
 * 网络层这些没有状态码，只能认字。**只认这一组明确的词**，不做宽泛匹配。
 *
 * ⚠️ 不要在这里加 `\b` —— JS 的 `\b` 是 ASCII 词边界，中文两侧都算"非词字符"，
 * 于是 `\b读取响应超时` 永远匹配不上（测试当场抓到的经典陷阱）。
 */
const NETWORK_WORDS =
  /(fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error)/i
const TIMEOUT_WORDS = /(读取响应超时|timed out|timeout)/i

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/** 厂商要求等多久（`Retry-After`，毫秒）。没有就是 `undefined` */
function retryAfterOf(error: unknown): number | undefined {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 把一个错误归到故障码上：状态码优先，没有状态码才认字。 */
export function llmFailureCodeOf(error: unknown): LlmFailureCode {
  const status = statusOf(error)
  if (status === 429) return 'RATE_LIMIT'
  if (status !== undefined && status >= 500) return 'SERVER'
  if (status !== undefined) return 'UNKNOWN'
  const message = error instanceof Error ? error.message : String(error)
  if (NETWORK_WORDS.test(message)) return 'TRANSPORT'
  if (TIMEOUT_WORDS.test(message)) return 'TIMEOUT'
  return 'UNKNOWN'
}

export interface LlmRetryInfo {
  /** 第几次尝试失败（从 1 起） */
  attempt: number
  /** 这次要等多久再试 */
  delayMs: number
  /** 失败的原始错误 */
  error: unknown
  /** 归类出来的故障码 */
  code: LlmFailureCode
}

export interface LlmRetryOptions {
  /** 取消信号：等退避时被取消会抛"已取消"，不再发起下一次请求 */
  signal?: AbortSignal
  /** 已经吐过内容了吗 —— 吐过就不许重试（流式重放会把内容写两遍） */
  hasOutput?: () => boolean
  /** 每次重试前回调（记日志/上报用） */
  onRetry?: (info: LlmRetryInfo) => void
  /** 总尝试次数（含首次）；与 `policy` 二选一，后者优先 */
  maxAttempts?: number
  /** 完整策略（模式/白名单/退避）；给了就忽略 `maxAttempts` */
  policy?: RetryPolicyConfig
  /** 抖动随机源（测试注入确定性序列） */
  random?: () => number
}

function policyForOptions(opts: LlmRetryOptions): ResolvedRetryPolicy {
  if (opts.policy) return resolveRetryPolicy(opts.policy, 'withLlmRetry')
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
  return resolveRetryPolicy({ mode: 'normal', maxRetries: maxAttempts - 1 }, 'withLlmRetry')
}

/**
 * 把一次 LLM 调用包成"失败可重试"。
 *
 * @param run 真正发起调用的函数（**每次重试都会重新调用它**）
 */
export async function withLlmRetry<T>(
  run: () => Promise<T>,
  opts: LlmRetryOptions = {},
): Promise<T> {
  const policy = policyForOptions(opts)
  const random = opts.random ?? Math.random
  const signal = opts.signal ?? NEVER_ABORTED

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const code = llmFailureCodeOf(error)
      const allowed = policy.mode === 'always' || policy.retryableCodes.includes(code)
      const attemptsLeft = policy.mode === 'always' ? true : attempt <= policy.maxRetries
      if (!allowed || !attemptsLeft || signal.aborted || opts.hasOutput?.()) throw error

      const delayMs = plannedRetryDelay(policy, attempt, retryAfterOf(error), random)
      if (delayMs === undefined) throw error
      opts.onRetry?.({ attempt, delayMs, error, code })
      if (!(await cancellableDelay(delayMs, signal))) throw new Error('已取消')
    }
  }
}

/** 第 n 次失败后的等待毫秒数（n 从 1 起）：500 起翻倍、±10% 抖动、封顶 10 秒 */
export function retryDelayMs(attempt: number, baseDelayMs = 500): number {
  const policy = resolveRetryPolicy(
    {
      mode: 'normal',
      maxRetries: 0,
      retryableCodes: [...RETRYABLE_FAILURE_CODES],
      backoff: { initialDelayMs: Math.max(1, baseDelayMs) },
    },
    'retryDelayMs',
  )
  return localDelay(policy, Math.max(1, attempt), Math.random)
}
