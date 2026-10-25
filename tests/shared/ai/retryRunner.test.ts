// tests/shared/ai/retryRunner.test.ts
//
// 重试策略与退避：上游公式搬到我们这边之后，这几条必须钉住
//   1. 判据是**故障码 + 白名单**，不是正则猜消息；
//   2. 退避有上限、抖动对称（`1±jitterRatio`），不是无限翻倍；
//   3. 厂商 `Retry-After` 优先，但它超过上限时有界策略直接放弃；
//   4. 已吐过内容 / 已取消 / 不可重试的错 —— 一次都不许多试。
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAX_ATTEMPTS,
  llmFailureCodeOf,
  retryDelayMs,
  withLlmRetry,
} from '@shared/ai/retryRunner'
import { ProviderHttpError } from '@shared/types/ai-provider'
import { localDelay, plannedRetryDelay } from '@shared/vendor/dsh/llm-retry/delay'
import { resolveRetryPolicy } from '@shared/vendor/dsh/llm-retry/retry-policy'

const fast = {
  mode: 'normal' as const,
  maxRetries: 2,
  backoff: { initialDelayMs: 1, maxDelayMs: 5, jitterRatio: 0 },
}

describe('resolveRetryPolicy：默认值与校验', () => {
  it('不传配置 = 上游默认（5 次重试 / 500ms 起 / 封顶 10s / 抖动 0.1）', () => {
    const p = resolveRetryPolicy(undefined, 'p')
    expect(p).toMatchObject({
      mode: 'normal',
      maxRetries: 5,
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      jitterRatio: 0.1,
    })
    expect(p.mode === 'normal' && [...p.retryableCodes]).toEqual([
      'EMPTY_RESPONSE',
      'RATE_LIMIT',
      'SERVER',
      'TIMEOUT',
      'TRANSPORT',
    ])
  })

  it('坏配置逐条拒绝，文案与上游一致', () => {
    expect(() => resolveRetryPolicy({ mode: 'normal', oops: 1 } as never, 'p')).toThrow(
      'p: unknown key "oops"',
    )
    expect(() =>
      resolveRetryPolicy(
        { mode: 'normal', backoff: { initialDelayMs: 900, maxDelayMs: 100 } },
        'p',
      ),
    ).toThrow('p.backoff.initialDelayMs must be less than or equal to maxDelayMs')
    expect(() => resolveRetryPolicy({ mode: 'normal', backoff: { jitterRatio: 2 } }, 'p')).toThrow(
      'p.backoff.jitterRatio must be between 0 and 1',
    )
    expect(() => resolveRetryPolicy({ mode: 'normal', retryableCodes: [] }, 'p')).toThrow(
      'p.retryableCodes must not be empty',
    )
    expect(() =>
      resolveRetryPolicy({ mode: 'normal', retryableCodes: ['SERVER', 'SERVER'] }, 'p'),
    ).toThrow('p.retryableCodes must not contain duplicates')
    expect(() => resolveRetryPolicy({ mode: 'normal', maxRetries: -1 }, 'p')).toThrow(
      'p.maxRetries must be a non-negative safe integer',
    )
  })
})

describe('退避公式', () => {
  it('指数翻倍 + 对称抖动 + 双重封顶', () => {
    const p = resolveRetryPolicy({ mode: 'normal', backoff: { maxDelayMs: 2000 } }, 'p')
    expect(localDelay(p, 1, () => 0)).toBe(450)
    expect(localDelay(p, 1, () => 1)).toBe(550)
    expect(localDelay(p, 2, () => 0.5)).toBe(1000)
    expect(localDelay(p, 30, () => 1)).toBe(2000)
  })

  it('厂商 Retry-After 优先；超过上限时有界策略放弃、无界策略退回本地退避', () => {
    const normal = resolveRetryPolicy({ mode: 'normal', backoff: { maxDelayMs: 10_000 } }, 'p')
    expect(plannedRetryDelay(normal, 1, 3000, () => 0.5)).toBe(3000)
    expect(plannedRetryDelay(normal, 1, 20_000, () => 0.5)).toBeUndefined()
    // 本地退避：第 1 次重试 = 初始值（抖动中性），第 2 次翻倍
    expect(plannedRetryDelay(normal, 1, undefined, () => 0.5)).toBe(500)
    expect(plannedRetryDelay(normal, 2, undefined, () => 0.5)).toBe(1000)

    const always = resolveRetryPolicy(
      { mode: 'always', backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 } },
      'p',
    )
    expect(plannedRetryDelay(always, 2, 20_000, () => 0.5)).toBe(1000)
  })
})

describe('故障码分类', () => {
  it('状态码优先，没状态码才认字', () => {
    expect(llmFailureCodeOf({ status: 429 })).toBe('RATE_LIMIT')
    expect(llmFailureCodeOf({ status: 503 })).toBe('SERVER')
    expect(llmFailureCodeOf({ status: 400 })).toBe('UNKNOWN')
    expect(llmFailureCodeOf(new Error('fetch failed'))).toBe('TRANSPORT')
    expect(llmFailureCodeOf(new Error('读取响应超时'))).toBe('TIMEOUT')
    expect(llmFailureCodeOf(new Error('随便什么'))).toBe('UNKNOWN')
  })
})

describe('withLlmRetry', () => {
  it('429 之后重试，回调里带上故障码与本次等待', async () => {
    let calls = 0
    const seen: Array<{ code: string; delayMs: number; attempt: number }> = []
    const value = await withLlmRetry(
      async () => {
        calls += 1
        if (calls === 1) throw { status: 429 }
        return 'ok'
      },
      {
        policy: fast,
        random: () => 0.5,
        onRetry: info =>
          seen.push({ code: info.code, delayMs: info.delayMs, attempt: info.attempt }),
      },
    )
    expect(value).toBe('ok')
    expect(calls).toBe(2)
    expect(seen).toEqual([{ code: 'RATE_LIMIT', delayMs: 1, attempt: 1 }])
  })

  it('厂商 Retry-After 被当成等待时间（ProviderHttpError 的第三个字段）', async () => {
    let calls = 0
    const delays: number[] = []
    await withLlmRetry(
      async () => {
        calls += 1
        if (calls === 1) throw new ProviderHttpError(429, '慢点', 3)
        return 'ok'
      },
      { policy: fast, onRetry: info => delays.push(info.delayMs) },
    )
    expect(delays).toEqual([3])
  })

  it('默认尝试次数 = 3，用完就抛原来的错', async () => {
    let calls = 0
    const boom = { status: 500, message: '挂了' }
    await expect(
      withLlmRetry(
        async () => {
          calls += 1
          throw boom
        },
        { random: () => 0 },
      ),
    ).rejects.toBe(boom)
    expect(calls).toBe(DEFAULT_MAX_ATTEMPTS)
  })

  it('不可重试的错、已吐过内容、已取消 —— 都不重试', async () => {
    let calls = 0
    const badRequest = { status: 400 }
    await expect(
      withLlmRetry(
        async () => {
          calls += 1
          throw badRequest
        },
        { policy: fast },
      ),
    ).rejects.toBe(badRequest)
    expect(calls).toBe(1)

    calls = 0
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      withLlmRetry(
        async () => {
          calls += 1
          throw { status: 503 }
        },
        { policy: fast, signal: ctrl.signal },
      ),
    ).rejects.toEqual({ status: 503 })
    expect(calls).toBe(1)

    calls = 0
    let emitted = true
    await expect(
      withLlmRetry(
        async () => {
          calls += 1
          throw { status: 503 }
        },
        { policy: fast, hasOutput: () => emitted },
      ),
    ).rejects.toEqual({ status: 503 })
    expect(calls).toBe(1)
    emitted = false
  })

  it('等退避时被取消 → 抛"已取消"，不再发下一次请求', async () => {
    const ctrl = new AbortController()
    let calls = 0
    const run = withLlmRetry(
      async () => {
        calls += 1
        throw { status: 503 }
      },
      {
        policy: { mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 200 } },
        signal: ctrl.signal,
        onRetry: () => ctrl.abort(),
      },
    )
    await expect(run).rejects.toThrow('已取消')
    expect(calls).toBe(1)
  })
})

describe('兼容入口', () => {
  it('retryDelayMs：500 起翻倍（带 ±10% 抖动）', () => {
    const first = retryDelayMs(1)
    expect(first).toBeGreaterThanOrEqual(450)
    expect(first).toBeLessThanOrEqual(550)
    expect(retryDelayMs(3)).toBeGreaterThanOrEqual(1800)
    expect(retryDelayMs(3)).toBeLessThanOrEqual(2200)
  })
})
