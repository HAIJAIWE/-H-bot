import { create } from 'zustand'
import type { LogEntry, LogLevel } from '@shared/types/log'

const MAX_LOG = 5000

interface LogState {
  entries: LogEntry[]
  filter: LogLevel | 'all'
  traceFilter?: string
  addLog: (level: LogLevel, message: string, nodeId?: string, traceId?: string, projectPath?: string) => void
  setFilter: (f: LogLevel | 'all') => void
  setTraceFilter: (traceId?: string) => void
  clear: () => void
}

let _counter = 0

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  filter: 'all',

  addLog: (level, message, nodeId, traceId, projectPath) =>
    set((s) => {
      const newEntry: LogEntry = {
        level,
        message,
        nodeId,
        traceId,
        projectPath,
        id: `log-${++_counter}`,
        timestamp: new Date().toISOString()
      }
      const entries = [...s.entries, newEntry]
      const trimmed = entries.length > MAX_LOG ? entries.slice(-MAX_LOG) : entries
      return { entries: trimmed }
    }),

  setFilter: (f) => set({ filter: f }),
  setTraceFilter: (traceId) => set({ traceFilter: traceId }),
  clear: () => set({ entries: [] })
}))
