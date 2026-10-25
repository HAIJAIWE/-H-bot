/**
 * 供应商请求重试策略：配置 → 校验 → 解析（纯函数，不依赖任何框架）。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 * @upstream packages/llm/llm/src/retry-policy.ts
 * @upstream https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：
 *   · 去掉 schemastery 的 z schema —— 我们不在 Cordis 里声明配置，配置由调用方直接给；
 *   · `MAX_TIMER_DELAY_MS` 上游来自 `@deepseek-ai/dsh-timeout`，这里内联同值常量；
 *   · 键白名单、默认值、冻结与全部错误文案与上游逐条一致。
 */

/** 定时器能接受的最大延时（上游 `@deepseek-ai/dsh-timeout` 的同名常量） */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

const DEFAULT_MAX_RETRIES = 5
const DEFAULT_INITIAL_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 10_000
const DEFAULT_JITTER_RATIO = 0.1
/** 上游用 `EMPTY_RESPONSE_CODE` 常量，这里直接写字面量（我们还没有"空响应"分类） */
const DEFAULT_RETRYABLE_CODES = Object.freeze([
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/** 有界指数退避 + 对称抖动。 */
export interface BackoffConfig {
  /** 第一次退避的基准毫秒数（默认 500） */
  initialDelayMs?: number
  /** 单次退避的上限毫秒数（默认 10000） */
  maxDelayMs?: number
  /** 抖动比例：结果落在 1±ratio 之间（默认 0.1） */
  jitterRatio?: number
}

/** 只重试白名单里的瞬时故障码。 */
export interface NormalRetryPolicyConfig {
  mode: 'normal'
  /** 首次请求之后最多再重试几次（默认 5） */
  maxRetries?: number
  /** 值得重试的故障码 */
  retryableCodes?: string[]
  backoff?: BackoffConfig
}

/** 任何失败都重试，直到成功、取消或释放。 */
export interface AlwaysRetryPolicyConfig {
  mode: 'always'
  backoff?: BackoffConfig
}

/** 供应商自带的重试策略配置。 */
export type RetryPolicyConfig = NormalRetryPolicyConfig | AlwaysRetryPolicyConfig

/** 解析后的退避参数（两种模式共用）。 */
export interface ResolvedRetryBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

/** 解析后的有界瞬时重试策略。 */
export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'normal'
  readonly maxRetries: number
  readonly retryableCodes: readonly string[]
}

/** 解析后的无界重试策略。 */
export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'always'
}

/** 注册时冻结下来的不可变策略。 */
export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy

const NORMAL_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode',
  'maxRetries',
  'retryableCodes',
  'backoff',
])
const ALWAYS_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode',
  'maxRetries',
  'retryableCodes',
  'backoff',
])
const BACKOFF_KEYS: ReadonlySet<string> = new Set(['initialDelayMs', 'maxDelayMs', 'jitterRatio'])

function validateKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`)
  }
}

function resolveBackoff(config: BackoffConfig | undefined, path: string): ResolvedRetryBackoff {
  if (config !== undefined) validateKeys(config, BACKOFF_KEYS, path)
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO

  if (
    !Number.isFinite(initialDelayMs) ||
    initialDelayMs <= 0 ||
    initialDelayMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      `${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`)
  }

  return Object.freeze({ initialDelayMs, maxDelayMs, jitterRatio })
}

/**
 * 校验、补默认值、并与调用方对象脱钩。
 * @param config - 调用方的策略配置；不传 = 有界默认策略
 * @param path - 出错时用来指认"是哪份配置"的诊断路径
 */
export function resolveRetryPolicy(
  config: RetryPolicyConfig | undefined,
  path: string,
): ResolvedRetryPolicy {
  if (config === undefined) {
    return Object.freeze({
      mode: 'normal',
      maxRetries: DEFAULT_MAX_RETRIES,
      retryableCodes: DEFAULT_RETRYABLE_CODES,
      ...resolveBackoff(undefined, `${path}.backoff`),
    })
  }

  switch (config.mode) {
    case 'normal': {
      validateKeys(config, NORMAL_POLICY_KEYS, path)
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES]
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        throw new Error(`${path}.maxRetries must be a non-negative safe integer`)
      }
      if (retryableCodes.length === 0) {
        throw new Error(`${path}.retryableCodes must not be empty`)
      }
      if (retryableCodes.some(code => typeof code !== 'string' || code.length === 0)) {
        throw new Error(`${path}.retryableCodes must contain only non-empty strings`)
      }
      if (new Set(retryableCodes).size !== retryableCodes.length) {
        throw new Error(`${path}.retryableCodes must not contain duplicates`)
      }
      return Object.freeze({
        mode: 'normal',
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        ...resolveBackoff(config.backoff, `${path}.backoff`),
      })
    }
    case 'always':
      validateKeys(config, ALWAYS_POLICY_KEYS, path)
      return Object.freeze({
        mode: 'always',
        ...resolveBackoff(config.backoff, `${path}.backoff`),
      })
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`)
  }
}
