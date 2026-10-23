// tests/main/services/messageQueue.test.ts
// MessageQueue 单元测试 — 覆盖并发控制、超时处理、限流。
// 重点回归测试：Round 18 修复的 activeCount 双重递减 bug
// （超时定时器和 try-catch 都递减 activeCount，导致负数）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageQueue } from '@main/services/messageQueue'

/**
 * 辅助：创建已附加 catch 的 promise，防止 Unhandled Rejection。
 * fake timers 下 reject 可能先于 catch 附加，导致 Vitest 报错。
 */
function safeEnqueue(queue: MessageQueue<string>, msg: string): {
  promise: Promise<void>
  getResult: () => Promise<{ ok: boolean; error?: unknown }>
} {
  let resolveFn!: (v: { ok: boolean; error?: unknown }) => void
  const result = new Promise<{ ok: boolean; error?: unknown }>((r) => { resolveFn = r })
  const promise = queue.enqueue(msg).then(
    () => resolveFn({ ok: true }),
    (e) => resolveFn({ ok: false, error: e })
  )
  return { promise, getResult: () => result }
}

describe('MessageQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('基本入队和处理', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 1, timeoutMs: 5000, maxPerSecond: 100 })
    const processed: string[] = []
    queue.setProcessor(async (msg) => { processed.push(msg) })
    queue.start()

    const e1 = safeEnqueue(queue, 'hello')
    const e2 = safeEnqueue(queue, 'world')
    await vi.runAllTimersAsync()
    await e1.getResult()
    await e2.getResult()

    expect(processed).toEqual(['hello', 'world'])
    expect(queue.pendingLength).toBe(0)
    expect(queue.active).toBe(0)
  })

  it('并发控制：不超过 maxConcurrent', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 2, timeoutMs: 5000, maxPerSecond: 100 })
    let active = 0
    let maxActive = 0
    queue.setProcessor(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 50))
      active--
    })
    queue.start()

    const entries = []
    for (let i = 0; i < 5; i++) entries.push(safeEnqueue(queue, String(i)))

    await vi.runAllTimersAsync()
    await Promise.all(entries.map((e) => e.getResult()))

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(queue.active).toBe(0)
  })

  it('超时处理：消息处理超时后 reject', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 1, timeoutMs: 100, maxPerSecond: 100 })
    queue.setProcessor(async () => {
      await new Promise((r) => setTimeout(r, 500))
    })
    queue.start()

    const entry = safeEnqueue(queue, 'slow-msg')
    await vi.advanceTimersByTimeAsync(150)
    const result = await entry.getResult()

    expect(result.ok).toBe(false)
    expect((result.error as Error).message).toContain('超时')
  })

  // ============================================================
  // 回归测试：activeCount 双重递减 bug（Round 18 修复）
  //
  // Bug：超时定时器和 try-catch 都执行 activeCount--。
  // 若 processor 超过 timeoutMs，超时先触发递减，
  // processor 完成后 try-catch 又递减，activeCount 变负数。
  //
  // 修复：settled 标志位确保 activeCount 只递减一次。
  // ============================================================
  it('回归测试：超时后 activeCount 不变成负数', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 1, timeoutMs: 100, maxPerSecond: 100 })

    let processorResolve: (() => void) | null = null
    queue.setProcessor(async () => {
      // 处理时间远超 timeoutMs，确保超时先触发
      await new Promise<void>((resolve) => { processorResolve = () => resolve() })
    })
    queue.start()

    const entry = safeEnqueue(queue, 'msg-1')
    // 此时 activeCount = 1

    // 推进到超时触发
    await vi.advanceTimersByTimeAsync(150)
    // 超时已触发，activeCount 应从 1 减到 0

    expect(queue.active).toBe(0) // 不应该是 -1

    // 现在 processor 完成（在超时之后完成）
    // 修复前：try-catch 再次 activeCount--，变成 -1
    // 修复后：settled 阻止双重递减，activeCount 保持 0
    // CFA 将 processorResolve 窄化为 null（赋值在闭包内），用断言恢复联合类型
    ;(processorResolve as (() => void) | null)?.()
    await vi.runAllTimersAsync()
    await entry.getResult()

    // 关键断言：activeCount 不应该是负数
    expect(queue.active).toBe(0)
    expect(queue.active).toBeGreaterThanOrEqual(0)
  })

  it('回归测试：超时后继续入队仍能正常处理', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 1, timeoutMs: 100, maxPerSecond: 100 })

    let processorResolve: (() => void) | null = null
    const processed: string[] = []
    queue.setProcessor(async (msg) => {
      if (msg === 'blocking') {
        await new Promise<void>((resolve) => { processorResolve = () => resolve() })
      }
      processed.push(msg)
    })
    queue.start()

    // 第一个消息会超时
    const slowEntry = safeEnqueue(queue, 'blocking')
    await vi.advanceTimersByTimeAsync(150)
    await slowEntry.getResult() // 超时 reject

    // 修复前：activeCount 可能变负，后续并发控制计算错误
    // 修复后：activeCount = 0，后续消息正常处理

    // 第二个消息应该能正常处理
    const fastEntry = safeEnqueue(queue, 'fast')
    await vi.runAllTimersAsync()
    const fastResult = await fastEntry.getResult()

    expect(fastResult.ok).toBe(true)
    expect(processed).toContain('fast')
    expect(queue.active).toBe(0)
    expect(queue.active).toBeGreaterThanOrEqual(0)
  })

  it('正常完成后 activeCount 正确递减', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 3, timeoutMs: 5000, maxPerSecond: 100 })
    queue.setProcessor(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    queue.start()

    const entries = []
    for (let i = 0; i < 3; i++) entries.push(safeEnqueue(queue, `msg-${i}`))

    await vi.runAllTimersAsync()
    await Promise.all(entries.map((e) => e.getResult()))

    expect(queue.active).toBe(0)
  })

  it('处理器抛异常后 activeCount 正确递减', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 1, timeoutMs: 5000, maxPerSecond: 100 })
    queue.setProcessor(async () => {
      throw new Error('processor error')
    })
    queue.start()

    const entry = safeEnqueue(queue, 'will-fail')
    await vi.runAllTimersAsync()
    const result = await entry.getResult()

    expect(result.ok).toBe(false)
    expect((result.error as Error).message).toBe('processor error')
    expect(queue.active).toBe(0)
  })

  it('stop 后不再处理新消息', async () => {
    const queue = new MessageQueue<string>({ maxConcurrent: 1, timeoutMs: 5000, maxPerSecond: 100 })
    const processed: string[] = []
    queue.setProcessor(async (msg) => { processed.push(msg) })
    queue.start()

    queue.stop()
    safeEnqueue(queue, 'after-stop')

    await vi.runAllTimersAsync()

    expect(processed).toEqual([])
  })
})
