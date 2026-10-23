// tests/main/services/botProcess.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'

/**
 * 共享状态：spawn 的 mock 实现。
 * 用 vi.hoisted 提升，确保 vi.mock 工厂能引用（vi.mock 是提升执行的）。
 */
const { spawnImpl } = vi.hoisted(() => ({
  spawnImpl: vi.fn()
}))

// mock child_process —— 避免真实 spawn 子进程
// 同步工厂：vitest 4.x 对 CJS 模块要求提供 default 导出，否则报 "No default export"
// 仅覆盖 spawn（botProcess.ts 运行时只用到 spawn），其余导出不需要
vi.mock('child_process', () => {
  const mock = { spawn: spawnImpl }
  return { ...mock, default: mock }
})

// mock statePersistence —— 避免读写真实文件
// BotStateStore 已单例化（getInstance），mock 时直接返回固定实例。
vi.mock('@main/services/statePersistence', () => ({
  BotStateStore: {
    getInstance: vi.fn(() => ({
      // getAllKeys 返回结构 { session, memory, state }，botProcess 仅取 .state
      getAllKeys: vi.fn(() => ({ session: [], memory: [], state: [] })),
      getState: vi.fn(() => null),
      setState: vi.fn()
    }))
  }
}))

// mock debugger —— 避免依赖调试器真实状态
vi.mock('@main/services/debugger', () => ({
  debuggerService: {
    onNodeExit: vi.fn(),
    onNodeHit: vi.fn()
  }
}))

import {
  startBot,
  stopBot,
  getBotStatus,
  listRunningBots,
  onBotLog
} from '@main/services/botProcess'

/**
 * 创建模拟 ChildProcess：
 * - 继承 EventEmitter，支持 emit('exit' / 'error')
 * - kill(0) 返回 true（进程存活），便于测试心跳
 * - stdout / stderr 为独立 EventEmitter，支持 emit('data')
 *
 * 用 any 类型避免与真实 ChildProcess 复杂类型的兼容性问题。
 */
function createFakeProc(pid: number): any {
  const proc: any = new EventEmitter()
  proc.pid = pid
  // vitest 4.x：mock 实现用 function 声明，避免 spyOn 警告
  proc.kill = vi.fn(function () {
    return true
  })
  proc.stdin = { write: vi.fn(function () {}) }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  return proc
}

let pidSeq = 10000

beforeEach(() => {
  vi.clearAllMocks()
  // 重置 spawn mock，并设置默认实现（返回新的 fake proc）
  spawnImpl.mockReset()
  spawnImpl.mockImplementation(() => createFakeProc(++pidSeq))
})

afterEach(() => {
  // 先在当前定时器模式下清理 session（确保 clearInterval 能正确清理 mock interval），
  // 再恢复真实定时器，避免模块级 Map 状态泄漏到下一个测试
  for (const bot of listRunningBots()) {
    try {
      stopBot(bot.projectPath)
    } catch {
      /* ignore */
    }
  }
  vi.useRealTimers()
})

describe('botProcess 资源清理', () => {
  describe('proc.error 事件', () => {
    it('触发 error 后调用 cleanupSessionResources 清理监听器并从 Map 删除', () => {
      const projectPath = '/test/proj-error-cleanup'
      const proc = createFakeProc(20001)
      spawnImpl.mockReturnValue(proc)

      startBot(projectPath)

      const procRemoveSpy = vi.spyOn(proc, 'removeAllListeners')
      const stdoutRemoveSpy = vi.spyOn(proc.stdout, 'removeAllListeners')
      const stderrRemoveSpy = vi.spyOn(proc.stderr, 'removeAllListeners')

      // 触发 error 事件（如 spawn ENOENT）
      proc.emit('error', new Error('spawn ENOENT'))

      // cleanupSessionResources 的副作用：proc 及其 stdout/stderr 的监听器被移除
      expect(procRemoveSpy).toHaveBeenCalled()
      expect(stdoutRemoveSpy).toHaveBeenCalled()
      expect(stderrRemoveSpy).toHaveBeenCalled()

      // session 已从 sessions Map 中删除
      expect(getBotStatus(projectPath)).toBeNull()
    })

    it('error 事件后状态变为 crashed 并推送错误日志', () => {
      const projectPath = '/test/proj-error-log'
      const proc = createFakeProc(20002)
      spawnImpl.mockReturnValue(proc)

      const logs: string[] = []
      const off = onBotLog((_p, entry) => logs.push(entry.message))
      try {
        startBot(projectPath)
        proc.emit('error', new Error('boom'))

        expect(logs.some((m) => m.includes('启动失败: boom'))).toBe(true)
      } finally {
        off()
      }
    })
  })

  describe('自动重启分支', () => {
    it('崩溃后自动重启前清理旧 session 资源（监听器 + heartbeatTimer）', async () => {
      vi.useFakeTimers()
      const projectPath = '/test/proj-restart'

      // 第一次 spawn 返回 oldProc，第二次（重启）返回默认 fake proc
      const oldProc = createFakeProc(30001)
      spawnImpl.mockImplementationOnce(() => oldProc)

      startBot(projectPath)

      const oldProcRemoveSpy = vi.spyOn(oldProc, 'removeAllListeners')
      const oldKillSpy = vi.spyOn(oldProc, 'kill')

      // 触发 exit（非 0 退出码 → 崩溃 → 3 秒后自动重启）
      oldProc.emit('exit', 1, null)

      // 推进 3 秒，触发重启 setTimeout
      await vi.advanceTimersByTimeAsync(3000)

      // 旧 session 的资源应被清理（cleanupSessionResources 的副作用）
      expect(oldProcRemoveSpy).toHaveBeenCalled()

      // 进一步验证 heartbeatTimer 已被 clearInterval：
      // 推进 30 秒（HEARTBEAT_INTERVAL_MS），若 heartbeatTimer 未清则会调用 oldProc.kill(0)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(oldKillSpy).not.toHaveBeenCalled()

      // 新 session 应已创建并处于 running 状态
      const status = getBotStatus(projectPath)
      expect(status).not.toBeNull()
      expect(status?.status).toBe('running')
    })

    it('重启失败时同样清理旧 session 资源', async () => {
      vi.useFakeTimers()
      const projectPath = '/test/proj-restart-fail'

      const oldProc = createFakeProc(30002)
      spawnImpl.mockImplementationOnce(() => oldProc)
      // 第二次 spawn（重启时）抛错，模拟重启失败
      spawnImpl.mockImplementationOnce(() => {
        throw new Error('spawn failed on restart')
      })

      startBot(projectPath)

      const oldProcRemoveSpy = vi.spyOn(oldProc, 'removeAllListeners')

      oldProc.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(3000)

      // 重启失败的 catch 分支也应清理旧 session 资源
      expect(oldProcRemoveSpy).toHaveBeenCalled()
      // 旧 session 已删除，新 session 未创建
      expect(getBotStatus(projectPath)).toBeNull()
    })
  })

  describe('stopBot', () => {
    it('停止时清理所有监听器（proc/stdout/stderr）并从 Map 删除', () => {
      const projectPath = '/test/proj-stop'
      const proc = createFakeProc(40001)
      spawnImpl.mockReturnValue(proc)

      startBot(projectPath)

      const procRemoveSpy = vi.spyOn(proc, 'removeAllListeners')
      const stdoutRemoveSpy = vi.spyOn(proc.stdout, 'removeAllListeners')
      const stderrRemoveSpy = vi.spyOn(proc.stderr, 'removeAllListeners')

      stopBot(projectPath)

      expect(procRemoveSpy).toHaveBeenCalled()
      expect(stdoutRemoveSpy).toHaveBeenCalled()
      expect(stderrRemoveSpy).toHaveBeenCalled()
      expect(getBotStatus(projectPath)).toBeNull()
    })
  })
})
