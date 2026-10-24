// tests/main/ipc/deployment-ipc.test.ts
// 覆盖部署相关 IPC：dockerExport / sshDeploy
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===========================================================================
// vi.hoisted —— 保证 mock 引用在 vi.mock 工厂中可用
// ===========================================================================
const mocks = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn()
  const browserWindowFromWebContents = vi.fn()
  const dialogShowOpenDialog = vi.fn()
  const shellOpenPath = vi.fn()

  // ---- sshDeploy service ----
  const sshDeployService = {
    deployProjectViaSsh: vi.fn(),
    tryLoadSsh2: vi.fn()
  }

  // ---- dockerExport service ----
  const dockerExportService = {
    exportProjectToDocker: vi.fn()
  }

  return {
    ipcMainHandleMock,
    browserWindowFromWebContents,
    dialogShowOpenDialog,
    shellOpenPath,
    sshDeployService,
    dockerExportService
  }
})

// ===========================================================================
// vi.mock —— 模块级 mock，对所有 import 生效
// ===========================================================================
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandleMock },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: mocks.browserWindowFromWebContents
  },
  dialog: { showOpenDialog: mocks.dialogShowOpenDialog },
  shell: { openPath: mocks.shellOpenPath }
}))

vi.mock('@main/services/sshDeploy', () => mocks.sshDeployService)
vi.mock('@main/services/dockerExport', () => mocks.dockerExportService)

// ===========================================================================
// 导入被测 IPC 注册函数
// ===========================================================================
import { registerSshDeployIpc } from '@main/ipc/sshDeploy'
import { registerDockerExportIpc } from '@main/ipc/dockerExport'

// ===========================================================================
// 辅助
// ===========================================================================
interface IpcResult {
  ok: boolean
  data?: unknown
  error?: string
  [key: string]: unknown
}

/** 从 ipcMain.handle 的调用记录里提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler ${channel} 未注册`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

/** mock event，含 sender 供 BrowserWindow.fromWebContents 使用 */
const mockEvent = { sender: {} }
/** mock 窗口 */
const mockWin = {
  isDestroyed: vi.fn(() => false),
  webContents: { send: vi.fn() }
}

/** 所有 vi.fn mock 列表，用于 beforeEach 统一 reset */
const allMockFns: Array<{ mockReset: () => void }> = [
  mocks.ipcMainHandleMock,
  mocks.browserWindowFromWebContents,
  mocks.dialogShowOpenDialog,
  mocks.shellOpenPath,
  ...Object.values(mocks.sshDeployService),
  ...Object.values(mocks.dockerExportService)
]

beforeEach(() => {
  // 重置所有 mock
  for (const fn of allMockFns) fn.mockReset()

  // 默认实现
  mocks.browserWindowFromWebContents.mockReturnValue(mockWin)

  // 注册 IPC handler
  registerSshDeployIpc()
  registerDockerExportIpc()
})

// ===========================================================================
// dockerExport IPC
// ===========================================================================
describe('dockerExport IPC', () => {
  describe('docker:export', () => {
    const validArgs = {
      projectPath: '/proj',
      adapter: 'official' as const,
      outputDir: '/output'
    }

    it('正常路径返回 ok:true', async () => {
      const result = {
        success: true,
        outputDir: '/output',
        dockerfilePath: '/output/Dockerfile',
        buildCommand: 'docker build',
        runCommand: 'docker run',
        files: ['Dockerfile'],
        error: ''
      }
      mocks.dockerExportService.exportProjectToDocker.mockResolvedValue(result)
      const res = (await getHandler('docker:export')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(result)
    })

    it('导出失败（success=false）返回 ok:false', async () => {
      mocks.dockerExportService.exportProjectToDocker.mockResolvedValue({
        success: false, outputDir: '/output', dockerfilePath: '', buildCommand: '', runCommand: '', files: [], error: 'bot.py 缺失'
      })
      const res = (await getHandler('docker:export')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('bot.py 缺失')
    })

    it('缺少 projectPath 返回 ok:false', async () => {
      const res = (await getHandler('docker:export')(mockEvent, { adapter: 'official', outputDir: '/output' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.dockerExportService.exportProjectToDocker.mockRejectedValue(new Error('export-fail'))
      const res = (await getHandler('docker:export')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('export-fail')
    })
  })

  describe('docker:openFolder', () => {
    it('正常路径（字符串参数）返回 ok:true', async () => {
      mocks.shellOpenPath.mockResolvedValue('')
      const res = (await getHandler('docker:openFolder')(mockEvent, '/output')) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.shellOpenPath).toHaveBeenCalledWith('/output')
    })

    it('正常路径（对象参数）返回 ok:true', async () => {
      mocks.shellOpenPath.mockResolvedValue('')
      const res = (await getHandler('docker:openFolder')(mockEvent, { path: '/output' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(mocks.shellOpenPath).toHaveBeenCalledWith('/output')
    })

    it('空 path 返回 ok:false', async () => {
      const res = (await getHandler('docker:openFolder')(mockEvent, '')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('参数 path 为空')
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.shellOpenPath.mockRejectedValue(new Error('open-fail'))
      const res = (await getHandler('docker:openFolder')(mockEvent, '/output')) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('open-fail')
    })
  })
})

// ===========================================================================
// sshDeploy IPC
// ===========================================================================
describe('sshDeploy IPC', () => {
  describe('ssh:deploy', () => {
    const validArgs = {
      projectPath: '/proj',
      host: 'example.com',
      port: 22,
      username: 'root',
      password: 'pass123',
      remotePath: '/opt/bot',
      adapter: 'official' as const,
      mode: 'docker' as const
    }

    it('正常路径返回 ok:true', async () => {
      const result = { success: true, message: '部署成功', logs: ['log1', 'log2'], error: '' }
      mocks.sshDeployService.deployProjectViaSsh.mockResolvedValue(result)
      const res = (await getHandler('ssh:deploy')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(result)
    })

    it('部署失败（success=false）返回 ok:false 含 logs 在 error 中', async () => {
      const result = { success: false, message: '部署失败', logs: ['err log'], error: '连接超时' }
      mocks.sshDeployService.deployProjectViaSsh.mockResolvedValue(result)
      const res = (await getHandler('ssh:deploy')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      // P0-C3 修复：logs 合并到 error 消息中，不再携带 data 字段
      expect(res.error).toContain('连接超时')
      expect(res.error).toContain('err log')
      expect(res.data).toBeUndefined()
    })

    it('缺少 host 返回 ok:false', async () => {
      const res = (await getHandler('ssh:deploy')(mockEvent, { ...validArgs, host: '' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('缺少 password 和 privateKey 返回 ok:false', async () => {
      const { password: _pw, ...argsWithoutPw } = validArgs
      const { privateKey: _pk, ...rest } = argsWithoutPw as Record<string, unknown> & { privateKey?: string }
      const res = (await getHandler('ssh:deploy')(mockEvent, rest)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/password.*privateKey/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.sshDeployService.deployProjectViaSsh.mockRejectedValue(new Error('deploy-fail'))
      const res = (await getHandler('ssh:deploy')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('deploy-fail')
    })
  })

  describe('ssh:testConnection', () => {
    const validArgs = {
      host: 'example.com',
      port: 22,
      username: 'root',
      password: 'pass123'
    }

    it('ssh2 未安装返回 ok:false', async () => {
      mocks.sshDeployService.tryLoadSsh2.mockReturnValue(null)
      const res = (await getHandler('ssh:testConnection')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/未安装 ssh2/)
    })

    it('缺少 host 返回 ok:false', async () => {
      const res = (await getHandler('ssh:testConnection')(mockEvent, { ...validArgs, host: '' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/参数校验失败/)
    })

    it('连接成功返回 ok:true 和 latency', async () => {
      // 构造 mock ssh2 Client
      const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
      const clientInstance = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb
          return clientInstance
        }),
        connect: vi.fn(() => {
          // 模拟 ready 事件
          setTimeout(() => handlers.ready?.(), 0)
        }),
        end: vi.fn()
      }
      // 注意：必须用普通函数（不能用箭头函数），因为 sshDeploy.ts 中用 `new ssh2.Client()` 调用
      const mockSsh2 = { Client: vi.fn(function (this: unknown) { return clientInstance }) }
      mocks.sshDeployService.tryLoadSsh2.mockReturnValue(mockSsh2)

      const res = (await getHandler('ssh:testConnection')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { connected: boolean }).connected).toBe(true)
      expect((res.data as { latency: number }).latency).toBeGreaterThanOrEqual(0)
      expect(clientInstance.connect).toHaveBeenCalled()
      expect(clientInstance.end).toHaveBeenCalled()
    })

    it('连接失败返回 ok:false', async () => {
      const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
      const clientInstance = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb
          return clientInstance
        }),
        connect: vi.fn(() => {
          // 模拟 error 事件
          setTimeout(() => handlers.error?.(new Error('connection refused')), 0)
        }),
        end: vi.fn()
      }
      // 注意：必须用普通函数（不能用箭头函数），因为 sshDeploy.ts 中用 `new ssh2.Client()` 调用
      const mockSsh2 = { Client: vi.fn(function (this: unknown) { return clientInstance }) }
      mocks.sshDeployService.tryLoadSsh2.mockReturnValue(mockSsh2)

      const res = (await getHandler('ssh:testConnection')(mockEvent, validArgs)) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('connection refused')
    })
  })
})
