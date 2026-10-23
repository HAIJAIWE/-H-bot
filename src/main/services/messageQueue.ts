// src/main/services/messageQueue.ts
// 消息处理队列 — 异步 FIFO 队列，支持并发控制、超时和限流

interface QueueItem<T = unknown> {
  msg: T
  resolve: (value: void) => void
  reject: (reason: unknown) => void
  enqueuedAt: number
}

interface QueueOptions {
  /** 最大并发处理数（默认 5） */
  maxConcurrent?: number
  /** 单条消息处理超时（毫秒，默认 30000） */
  timeoutMs?: number
  /** 每秒最大处理数（默认 20） */
  maxPerSecond?: number
}

type Processor<T = unknown> = (msg: T) => Promise<void>

export class MessageQueue<T = unknown> {
  private readonly queue: QueueItem<T>[] = []
  private activeCount = 0
  private readonly maxConcurrent: number
  private readonly timeoutMs: number
  private readonly maxPerSecond: number
  private processor: Processor<T> | null = null
  private processing = false
  private readonly tokensPerSecond: number
  private tokenBucket: number
  private lastTokenRefill: number
  private drainTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: QueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 5
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxPerSecond = options.maxPerSecond ?? 20
    this.tokensPerSecond = this.maxPerSecond
    this.tokenBucket = this.maxPerSecond
    this.lastTokenRefill = Date.now()
  }

  /** 设置消息处理函数 */
  setProcessor(processor: Processor<T>): void {
    this.processor = processor
  }

  /** 入队，返回 Promise（在消息处理完成后 resolve/reject） */
  enqueue(msg: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ msg, resolve, reject, enqueuedAt: Date.now() })
      this.scheduleDrain()
    })
  }

  /** 待处理消息数 */
  get pendingLength(): number {
    return this.queue.length
  }

  /** 当前活跃处理数 */
  get active(): number {
    return this.activeCount
  }

  /** 开始处理队列 */
  start(): void {
    this.processing = true
    this.scheduleDrain()
  }

  /** 停止处理，清空队列 */
  stop(): void {
    this.processing = false
    if (this.drainTimer) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }
  }

  /** 队列是否正在运行 */
  get isRunning(): boolean {
    return this.processing
  }

  private scheduleDrain(): void {
    if (this.drainTimer) return
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      this.drain()
    }, 0)
  }

  private drain(): void {
    if (!this.processing) return
    if (this.activeCount >= this.maxConcurrent) return

    // 令牌桶限流
    const now = Date.now()
    const elapsedSec = (now - this.lastTokenRefill) / 1000
    this.tokenBucket = Math.min(
      this.tokensPerSecond,
      this.tokenBucket + elapsedSec * this.tokensPerSecond
    )
    this.lastTokenRefill = now

    while (
      this.queue.length > 0 &&
      this.activeCount < this.maxConcurrent &&
      this.tokenBucket >= 1
    ) {
      const item = this.queue.shift()!
      this.activeCount++
      this.tokenBucket -= 1

      this.processItem(item)
    }

    // 如果还有待处理项，延迟后再试
    if (this.queue.length > 0) {
      this.drainTimer = setTimeout(() => this.drain(), 50)
    }
  }

  private async processItem(item: QueueItem<T>): Promise<void> {
    if (!this.processor) {
      this.activeCount--
      item.reject(new Error('MessageQueue: 未设置处理器'))
      return
    }

    // settled 标志确保 activeCount 只递减一次：
    // 超时定时器和 try-catch 都可能触发递减，若超时先触发后 processor 才完成，
    // 会导致 activeCount 被减两次变成负数，使并发控制失效。
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      this.activeCount--
      item.reject(
        new Error(
          `MessageQueue: 消息处理超时 (${this.timeoutMs}ms)，消息排队 ${Date.now() - item.enqueuedAt}ms`
        )
      )
    }, this.timeoutMs)

    try {
      await this.processor(item.msg)
      if (settled) return  // 已超时，activeCount 已在定时器中递减
      clearTimeout(timer)
      settled = true
      this.activeCount--
      item.resolve()
    } catch (err) {
      if (settled) return  // 已超时，activeCount 已在定时器中递减
      clearTimeout(timer)
      settled = true
      this.activeCount--
      item.reject(err)
    }

    // 处理完一个后继续 drain
    this.drain()
  }
}
