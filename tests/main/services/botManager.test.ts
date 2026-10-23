// tests/main/services/botManager.test.ts
//
// 2026-10-24 恢复注：原文件测的是 NapCat 时代那份 BotManager（botProcess 子进程 +
// botProcess.onStatusChange 回调 + startBotProcess/stopBotProcess）。10/18 的实现已改成
// 主进程内的 TS 运行时：BotManager 不再订阅 botProcess，而是 new FlowRuntime() 并接
// runtime.onStatusChange / onLog，状态经 runner/runtimeEvents.emitStatusChange 广播。
// 那些 mock 路径与断言全部失效，因此按当前实现重写（不再用已删除的 botProcess）。
//
// 覆盖：注册/注销/列表、启动链路（快照→插件→翻译器→官方适配器→运行时）、
// 已运行拦截、失败落到 error、停止/重启、uptime、状态广播、扫描项目目录。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// ── 捕获 FlowRuntime 实例与它注册的回调 ─────────────────────
const H = vi.hoisted(() => {
  const rt = {
    statusCb: null as null | ((info: { status: string; error?: string }) => void),
    logCb: null as null | ((line: string) => void),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    instances: [] as Array<{ projectPath: string; port: number }>
  }
  class FlowRuntime {
    onStatusChange = (cb: (info: { status: string; error?: string }) => void) => {
      rt.statusCb = cb
    }
    onLog = (cb: (line: string) => void) => {
      rt.logCb = cb
    }
    start = rt.start
    stop = rt.stop
    constructor(public projectPath: string, public port: number) {
      rt.instances.push({ projectPath, port })
    }
  }
  return { rt, FlowRuntime }
})

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/qqbat-test-userdata' }
}))

vi.mock('@main/services/runner/eventBus', () => ({
  getTranslatorStatus: vi.fn(() => ({ running: true, clients: 0, port: 8080 })),
  resolveUsableTranslatorPort: vi.fn(async () => 8080),
  startTranslator: vi.fn(async () => 8080)
}))

vi.mock('@main/services/official/ws', () => ({
  startOfficial: vi.fn(async () => {}),
  stopOfficial: vi.fn(async () => {})
}))

vi.mock('@main/services/runner/runtimeEvents', () => ({ emitStatusChange: vi.fn() }))
vi.mock('@main/services/flow/turnJournal', () => ({ snapshotBeforeRun: vi.fn(async () => true) }))
vi.mock('@main/services/plugins/pluginLoader', () => ({ loadProjectPlugins: vi.fn(async () => {}) }))
vi.mock('@main/services/infra/fileOps', () => ({ atomicWrite: vi.fn(async () => {}) }))
vi.mock('@main/services/runner/runtimeLogParser', () => ({ parseRuntimeLogLine: vi.fn() }))
vi.mock('@main/runtime/waitRegistry', () => ({ clearWaits: vi.fn(() => 2) }))
vi.mock('@main/runtime/FlowRuntime', () => ({ FlowRuntime: H.FlowRuntime }))
vi.mock('@main/services/lark/adapter', () => ({ LarkTranslator: class {} }))
vi.mock('@main/services/dingtalk/adapter', () => ({ DingTalkTranslator: class {} }))

import { BotManager } from '@main/services/botManager'
import { getTranslatorStatus, resolveUsableTranslatorPort, startTranslator } from '@main/services/runner/eventBus'
import { startOfficial, stopOfficial } from '@main/services/official/ws'
import { emitStatusChange } from '@main/services/runner/runtimeEvents'
import { snapshotBeforeRun } from '@main/services/flow/turnJournal'
import { loadProjectPlugins } from '@main/services/plugins/pluginLoader'
import { clearWaits } from '@main/runtime/waitRegistry'

let tmpDir: string
let projectPath: string
let manager: InstanceType<typeof BotManager>

async function writeProjectJson(name = '测试机器人', extra: Record<string, unknown> = {}) {
  const dir = join(tmpDir, name)
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  await writeFile(
    join(dir, '.qqbat', 'project.json'),
    JSON.stringify({
      name,
      qq: '10001',
      adapter: 'official',
      translatorPort: 8080,
      portBlock: 1,
      ...extra
    }),
    'utf-8'
  )
  return dir
}

beforeEach(async () => {
  vi.clearAllMocks()
  H.rt.statusCb = null
  H.rt.logCb = null
  H.rt.instances.length = 0
  vi.mocked(startOfficial).mockResolvedValue(undefined)
  vi.mocked(stopOfficial).mockResolvedValue(undefined)
  vi.mocked(resolveUsableTranslatorPort).mockResolvedValue(8080)
  vi.mocked(getTranslatorStatus).mockReturnValue({ running: true, clients: 0, port: 8080 })
  vi.mocked(startTranslator).mockResolvedValue(8080)
  vi.mocked(loadProjectPlugins).mockResolvedValue({ loaded: [], failed: [] })
  vi.mocked(snapshotBeforeRun).mockResolvedValue(true)
  vi.mocked(emitStatusChange).mockReturnValue(undefined as never)
  vi.mocked(clearWaits).mockReturnValue(2)

  tmpDir = await mkdtemp(join(tmpdir(), 'qqbat-bm-'))
  projectPath = await writeProjectJson()
  manager = new BotManager(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('BotManager', () => {
  describe('注册/注销', () => {
    it('注册时从 project.json 读元信息，并广播一次 statusChanged', async () => {
      const events: Array<{ projectPath: string; status: string }> = []
      manager.on('statusChanged', (s: { projectPath: string; status: string }) => events.push(s))
      await manager.registerBot(projectPath)
      const status = manager.getBotStatus(projectPath)!
      expect(status).toMatchObject({
        projectPath,
        name: '测试机器人',
        qq: '10001',
        adapter: 'official',
        status: 'stopped'
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ projectPath, status: 'stopped' })
    })

    it('重复注册是 no-op（列表里仍然只有一条）', async () => {
      await manager.registerBot(projectPath)
      await manager.registerBot(projectPath)
      expect(manager.listBots()).toHaveLength(1)
    })

    it('未注册项目的状态查询返回 null', () => {
      expect(manager.getBotStatus(projectPath)).toBeNull()
    })

    it('注销后查不到；注销未知项目不抛错', async () => {
      await manager.registerBot(projectPath)
      manager.unregisterBot(projectPath)
      expect(manager.getBotStatus(projectPath)).toBeNull()
      expect(() => manager.unregisterBot(join(tmpDir, 'nope'))).not.toThrow()
    })

    it('注销运行中的 bot 会先停掉运行时', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      H.rt.statusCb!({ status: 'running' })
      manager.unregisterBot(projectPath)
      expect(H.rt.stop).toHaveBeenCalledTimes(1)
    })
  })

  describe('startBot', () => {
    it('未注册时拒绝', async () => {
      await expect(manager.startBot(projectPath)).rejects.toThrow('未注册')
    })

    it('启动链路：快照→插件→翻译器→官方适配器→TS 运行时', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)

      expect(snapshotBeforeRun).toHaveBeenCalledWith(projectPath, '运行机器人')
      expect(loadProjectPlugins).toHaveBeenCalledWith(projectPath, { reload: true })
      // 翻译器已 running → 不重复启动
      expect(startTranslator).not.toHaveBeenCalled()
      expect(startOfficial).toHaveBeenCalledWith(projectPath)
      expect(H.rt.instances).toEqual([{ projectPath, port: 8080 }])
      expect(H.rt.start).toHaveBeenCalledTimes(1)
    })

    it('运行时回调 running 后状态变 running，并把状态广播到事件总线', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      // 启动完成时仍是 starting（等运行时真正连上）
      expect(manager.getBotStatus(projectPath)!.status).toBe('starting')

      H.rt.statusCb!({ status: 'running' })
      const status = manager.getBotStatus(projectPath)!
      expect(status.status).toBe('running')
      expect(status.startedAt).toBeTruthy()
      expect(emitStatusChange).toHaveBeenCalledWith(
        projectPath,
        expect.objectContaining({ status: 'running' })
      )
    })

    it('运行时 error 后状态变 error 并带上错误信息；广播映射成 crashed', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      H.rt.statusCb!({ status: 'error', error: '翻译器断了' })
      const status = manager.getBotStatus(projectPath)!
      expect(status.status).toBe('error')
      expect(status.error).toBe('翻译器断了')
      const last = vi.mocked(emitStatusChange).mock.calls.at(-1)!
      expect(last[1]).toMatchObject({ status: 'crashed' })
    })

    it('已运行时再启动抛错', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      H.rt.statusCb!({ status: 'running' })
      await expect(manager.startBot(projectPath)).rejects.toThrow('已在运行中')
    })

    it('插件加载失败 → 状态 error 并抛出', async () => {
      vi.mocked(loadProjectPlugins).mockRejectedValueOnce(new Error('插件坏了'))
      await manager.registerBot(projectPath)
      await expect(manager.startBot(projectPath)).rejects.toThrow('插件坏了')
      const status = manager.getBotStatus(projectPath)!
      expect(status.status).toBe('error')
      expect(status.error).toBe('插件坏了')
      expect(startOfficial).not.toHaveBeenCalled()
    })
  })

  describe('stopBot / restartBot', () => {
    it('停止成功调用 runtime.stop、stopOfficial 并清空挂起等待', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      H.rt.statusCb!({ status: 'running' })

      await manager.stopBot(projectPath)
      expect(H.rt.stop).toHaveBeenCalledTimes(1)
      expect(stopOfficial).toHaveBeenCalledWith(projectPath)
      expect(clearWaits).toHaveBeenCalledWith(projectPath)
      // 运行时回报 stopped 后状态收敛
      H.rt.statusCb!({ status: 'stopped' })
      const status = manager.getBotStatus(projectPath)!
      expect(status.status).toBe('stopped')
      expect(status.startedAt).toBeUndefined()
    })

    it('已停止时 stopBot 是 no-op（不重复调 stopOfficial）', async () => {
      await manager.registerBot(projectPath)
      await manager.stopBot(projectPath)
      expect(stopOfficial).not.toHaveBeenCalled()
    })

    it('未注册时 stopBot 抛错', async () => {
      await expect(manager.stopBot(projectPath)).rejects.toThrow('未注册')
    })

    it('restartBot 先停后启', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      H.rt.statusCb!({ status: 'running' })
      vi.clearAllMocks()

      await manager.restartBot(projectPath)
      expect(stopOfficial).toHaveBeenCalledWith(projectPath)
      expect(startOfficial).toHaveBeenCalledWith(projectPath)
      const stopOrder = vi.mocked(stopOfficial).mock.invocationCallOrder[0]
      const startOrder = vi.mocked(startOfficial).mock.invocationCallOrder[0]
      expect(stopOrder).toBeLessThan(startOrder)
    })

    it('stopAllBots 只停运行中的项目', async () => {
      const other = await writeProjectJson('另一个机器人')
      await manager.registerBot(projectPath)
      await manager.registerBot(other)
      await manager.startBot(projectPath)
      H.rt.statusCb!({ status: 'running' })
      await manager.stopAllBots()
      expect(stopOfficial).toHaveBeenCalledTimes(1)
      expect(stopOfficial).toHaveBeenCalledWith(projectPath)
    })
  })

  describe('状态与扫描', () => {
    it('uptime 在 running 时是已运行秒数', async () => {
      await manager.registerBot(projectPath)
      await manager.startBot(projectPath)
      const startedAt = new Date(Date.now() - 100_000).toISOString()
      H.rt.statusCb!({ status: 'running' })
      // 直接改实例状态里的 startedAt 以验证 toStatus 的换算（-100s）
      const instance = (manager as unknown as { bots: Map<string, { startedAt: string }> }).bots.get(projectPath)!
      instance.startedAt = startedAt
      const status = manager.getBotStatus(projectPath)!
      expect(status.uptime).toBeGreaterThanOrEqual(100)
      expect(status.uptime).toBeLessThan(110)
    })

    it('scanProjectBots 只收有 .qqbat/flow.json 的目录', async () => {
      await manager.registerBot(projectPath)
      await writeFile(join(projectPath, '.qqbat', 'flow.json'), '{}', 'utf-8')
      const emptyBare = join(tmpDir, '不是项目')
      await mkdir(emptyBare, { recursive: true })
      const found = await manager.scanProjectBots()
      expect(found).toEqual([projectPath])
    })
  })
})