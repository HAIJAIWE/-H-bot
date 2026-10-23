// src/main/services/metrics.ts
// 运行指标聚合服务。
//
// 真源：10/18 打包产物 out/main/index.js:7970-8068（region `src/main/services/ops/metrics.ts`）。
// 行为要点（保持与产物一致）：
// - 原始计数器在每次 aggregate 后清零，所以 sample 是"这 5 秒窗口"的量，不是累计量；
// - msgCount 存的是**每秒消息数**（msgPerSec），不是窗口内的条数；
// - errorRate 是百分比整数（0-100），分母为窗口内消息数（为 0 时取 1，避免除零）；
// - 历史最多 60 个样本，正好对应渲染层 charts 的 60 个点；
// - start() 先清计数再起表，stop() 清表也清计数——停表这段时间的数据不进入下一个窗口。

export interface MetricSample {
  timestamp: string
  /** 每秒消息数（窗口内均值），保留 1 位小数 */
  msgCount: number
  avgLatency: number
  p95Latency: number
  /** 百分比整数，0-100 */
  errorRate: number
  nodeExecutions: number
  errorTypes: Record<string, number>
}

const INTERVAL_MS = 5_000
const MAX_SAMPLES = 60

class MetricsServiceImpl {
  private rawMsgCount = 0
  private rawLatencies: number[] = []
  private rawErrorCount = 0
  private rawErrorTypes: Record<string, number> = {}
  private rawNodeExecCount = 0

  private samples: MetricSample[] = []
  private timer: NodeJS.Timeout | null = null
  private callbacks = new Set<(sample: MetricSample) => void>()

  /** 记录一条消息的处理耗时（会顺带把消息数 +1） */
  recordMessage(durationMs: number): void {
    this.rawMsgCount++
    this.rawLatencies.push(durationMs)
  }

  /** 记录一次错误（带错误类型） */
  recordError(errorType = 'unknown'): void {
    this.rawErrorCount++
    this.rawErrorTypes[errorType] = (this.rawErrorTypes[errorType] || 0) + 1
  }

  /**
   * 解析一行 stdout，提取 METRIC 数据。
   * 支持两种格式：
   *   [METRIC:msg:dur:123ms]      —— 单条消息耗时（打点最精确的形式）
   *   [METRIC:msg_count=12,latency=34] —— 批量计数
   */
  recordMetricLine(line: string): void {
    const msgDurMatch = line.match(/\[METRIC:msg:dur:(\d+)ms?\]/)
    if (msgDurMatch) {
      this.recordMessage(parseInt(msgDurMatch[1], 10))
      return
    }
    const match = line.match(/\[METRIC:([^\]]+)\]/)
    if (!match) return
    for (const part of match[1].split(',')) {
      const [key, val] = part.split('=')
      if (key === 'msg_count') this.rawMsgCount += parseInt(val, 10) || 0
      else if (key === 'latency') this.rawLatencies.push(parseInt(val, 10) || 0)
    }
  }

  /** 记录一次节点执行（NODE:enter） */
  recordNodeExecution(): void {
    this.rawNodeExecCount++
  }

  /** 立即获取当前聚合快照（不重置计数器） */
  getSnapshot(): MetricSample {
    const latencyCount = this.rawLatencies.length
    const totalLatency = this.rawLatencies.reduce((a, b) => a + b, 0)
    const totalMsg = this.rawMsgCount || 1
    const msgPerSec = Math.round((totalMsg / (INTERVAL_MS / 1000)) * 10) / 10
    return {
      timestamp: new Date().toISOString(),
      msgCount: msgPerSec,
      avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      p95Latency: this.calcP95(this.rawLatencies),
      errorRate: Math.round((this.rawErrorCount / totalMsg) * 100),
      nodeExecutions: this.rawNodeExecCount,
      errorTypes: { ...this.rawErrorTypes }
    }
  }

  start(): void {
    if (this.timer) return
    this.resetCounters()
    this.timer = setInterval(() => this.aggregate(), INTERVAL_MS)
    // 定时器不应阻止进程退出（与 Electron 主进程其他后台服务一致）
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.resetCounters()
  }

  getHistory(): MetricSample[] {
    return [...this.samples]
  }

  onData(cb: (sample: MetricSample) => void): () => void {
    this.callbacks.add(cb)
    return () => {
      this.callbacks.delete(cb)
    }
  }

  private aggregate(): void {
    const sample = this.getSnapshot()
    this.samples.push(sample)
    if (this.samples.length > MAX_SAMPLES) this.samples = this.samples.slice(-MAX_SAMPLES)
    this.resetCounters()
    for (const cb of this.callbacks) cb(sample)
  }

  private calcP95(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.ceil(sorted.length * 0.95) - 1
    return sorted[Math.max(0, idx)]
  }

  private resetCounters(): void {
    this.rawMsgCount = 0
    this.rawLatencies = []
    this.rawErrorCount = 0
    this.rawErrorTypes = {}
    this.rawNodeExecCount = 0
  }
}

export const metricsService = new MetricsServiceImpl()
