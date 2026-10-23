// src/renderer/src/stores/terminalStore.ts
import { create } from 'zustand'

/** 终端缓冲区最大行数 */
const TERMINAL_BUFFER_LIMIT = 1000

interface TerminalState {
  /** 当前终端会话 ID（空 = 未创建） */
  sessionId: string | null
  /** 是否已连接（已创建会话） */
  connected: boolean
  /** 缓冲区：未知行 */
  buffer: string[]
  setSessionId: (id: string | null) => void
  setConnected: (v: boolean) => void
  addBuffer: (data: string) => void
  clearBuffer: () => void
  reset: () => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  sessionId: null,
  connected: false,
  buffer: [],
  setSessionId: (id) => set({ sessionId: id }),
  setConnected: (v) => set({ connected: v }),
  addBuffer: (data) =>
    set((s) => {
      const buffer = [...s.buffer, data]
      const trimmed = buffer.length > TERMINAL_BUFFER_LIMIT ? buffer.slice(-TERMINAL_BUFFER_LIMIT) : buffer
      return { buffer: trimmed }
    }),
  clearBuffer: () => set({ buffer: [] }),
  reset: () => set({ sessionId: null, connected: false, buffer: [] })
}))
