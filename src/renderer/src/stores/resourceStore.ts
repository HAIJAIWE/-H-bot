// src/renderer/src/stores/resourceStore.ts
import { create } from 'zustand'
import type { ResourceUsage, ResourceConfig, ResourceStatus, ResourceSamplePoint, ResourceAlert } from '../types/ipc'
import { toast } from '../components/ui/Toast'

interface ResourceState {
  current: ResourceUsage | null
  config: ResourceConfig | null
  history: ResourceSamplePoint[]
  /** 告警历史（最近 50 条），UI 可展示为告警面板 */
  alerts: ResourceAlert[]
  monitorActive: boolean
  updateUsage: (usage: ResourceUsage) => void
  setConfig: (config: ResourceConfig) => void
  addSample: (point: ResourceSamplePoint) => void
  addAlert: (alert: ResourceAlert) => void
  clearAlerts: () => void
  init: () => () => void
}

const MAX_HISTORY = 60
const MAX_ALERTS = 50
/** 告警 Toast 持续时长（毫秒） */
const TOAST_DURATION_MS = 8000

export const useResourceStore = create<ResourceState>((set, get) => ({
  current: null,
  config: null,
  history: [],
  alerts: [],
  monitorActive: false,

  updateUsage: (usage) => {
    set({ current: usage })
  },

  setConfig: (config) => {
    set({ config })
  },

  addSample: (point) => {
    const history = [...get().history, point]
    const trimmedHistory = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history
    set({ history: trimmedHistory })
  },

  addAlert: (alert) => {
    const alerts = [...get().alerts, alert]
    const trimmedAlerts = alerts.length > MAX_ALERTS ? alerts.slice(-MAX_ALERTS) : alerts
    set({ alerts: trimmedAlerts })
    // 同步弹出 Toast 通知（告警属于需要用户感知的事件，duration 延长到 8 秒）
    const alertType = alert.type === 'memory' ? '内存超限' : 'CPU 超限'
    toast.error(`[${alertType}] ${alert.message}`, TOAST_DURATION_MS)
  },

  clearAlerts: () => {
    set({ alerts: [] })
  },

  init: () => {
    if (!window.qqbat?.resourceMonitor) return () => {}
    // 加载配置
    window.qqbat.resourceMonitor.getConfig().then((res) => {
      if (res.ok && res.data) {
        get().setConfig(res.data)
      }
    }).catch(() => {})

    // 获取一次当前占用
    window.qqbat.resourceMonitor.getUsage().catch(() => {})

    // 监听 resourceMonitor:status（含 usage + config + lastAlert）
    const unsubStatus = window.qqbat.resourceMonitor.onStatus((status: ResourceStatus) => {
      get().updateUsage(status.usage)
      get().setConfig(status.config)
      set({ monitorActive: true })
      // status 中的 lastAlert 仅作展示用，不重复弹 Toast（避免与 onAlert 重复）
      if (status.lastAlert) {
        const alerts = get().alerts
        const last = alerts[alerts.length - 1]
        if (!last || last.timestamp !== status.lastAlert.timestamp) {
          get().addAlert(status.lastAlert)
        }
      }
    })

    // 监听 resourceMonitor:usage（仅实时占用）
    const unsubUsage = window.qqbat.resourceMonitor.onUsage((usage: ResourceUsage) => {
      get().updateUsage(usage)
      get().addSample({
        cpuPercent: usage.cpuPercent,
        memoryMB: usage.memoryMB,
        memoryPercent: usage.memoryPercent,
        timestamp: Date.now()
      })
    })

    // 监听 resourceMonitor:config（配置变更广播）
    const unsubConfig = window.qqbat.resourceMonitor.onConfig((config: ResourceConfig) => {
      get().setConfig(config)
    })

    // 监听 resourceMonitor:alert（kill 进程等严重告警，独立于 status.lastAlert 推送）
    const unsubAlert = window.qqbat.resourceMonitor.onAlert((alertData) => {
      // alertData 来自主进程 killProcessDueToLimit 广播，类型为 { type, message, timestamp }
      // 补全为 ResourceAlert 形态（value/limit 在 kill 场景无意义，填 0）
      get().addAlert({
        type: alertData.type as 'memory' | 'cpu',
        message: alertData.message,
        timestamp: alertData.timestamp,
        value: 0,
        limit: 0
      })
    })

    return () => {
      unsubStatus()
      unsubUsage()
      unsubConfig()
      unsubAlert()
    }
  }
}))
