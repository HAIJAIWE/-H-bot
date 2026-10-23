// src/renderer/src/stores/metricsStore.ts
import { create } from 'zustand'

export interface MetricSnapshot {
  timestamp: string
  msgCount: number
  avgLatency: number
  p95Latency: number
  errorRate: number
  nodeExecutions: number
  errorTypes: Record<string, number>
}

interface MetricsState {
  dataPoints: MetricSnapshot[]
  current: MetricSnapshot | null
  updateSnapshot: (sample: MetricSnapshot) => void
  setHistory: (samples: MetricSnapshot[]) => void
  init: () => () => void
}

const MAX_POINTS = 60

export const useMetricsStore = create<MetricsState>((set, get) => ({
  dataPoints: [],
  current: null,

  updateSnapshot: (sample) => {
    set((s) => {
      const dataPoints = [...s.dataPoints, sample]
      const trimmed = dataPoints.length > MAX_POINTS ? dataPoints.slice(-MAX_POINTS) : dataPoints
      return { dataPoints: trimmed, current: sample }
    })
  },

  setHistory: (samples) =>
    set({ dataPoints: samples, current: samples.length > 0 ? samples[samples.length - 1] : null }),

  init: () => {
    if (!window.qqbat?.metrics) return () => {}
    // 加载历史数据
    window.qqbat.metrics.getHistory().then((result) => {
      if (result.ok && result.data) {
        get().setHistory(result.data)
      }
    })

    // 订阅实时推送
    const unsub = window.qqbat.metrics.onSnapshot((sample) => {
      get().updateSnapshot(sample)
    })

    return () => {
      unsub()
    }
  }
}))
