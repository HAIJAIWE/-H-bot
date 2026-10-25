// tests/main/ipc/register-all-ipc.test.ts
//
// 2026-10-24 恢复注：原用例测的是旧 register.ts —— 它自己 `new ProjectService/FlowService/
// TemplateService`，还 mock 了 `@main/services/{project,flow,flow/codegen,templates,
// dataNotifyService}`。10/18 版已换成「全局容器 + 一条捕获包装」：
//
//   export function registerAllIpc(baseDir: string): void {
//     captureIpcHandlers(() => registerAllIpcInner(baseDir));
//   }
//
// 服务实例来自 `getGlobalContainer(baseDir)`（SERVICE_KEYS.PROJECT_SERVICE / FLOW_SERVICE /
// CODEGEN_SERVICE），历史服务不再 setBaseDir，模板 IPC 也不存在了。本文件按现状重写，
// 只钉三件事：容器拿对 baseDir、39 个域各注册一次、核心服务实例按同一份容器传递。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * NodeNext 下 `import()` 按 ESM 解析：`@main/ipc/register` 这种无扩展名的别名
 * TS 静态解析不到（TS2307），但运行时由 Vite 别名接管 —— 用变量传 specifier，
 * 让类型层不参与解析，同时不破坏 vi.doMock 的时机。
 */
async function importRegisterModule(): Promise<{ registerAllIpc: (baseDir: string) => void }> {
  const specifier = '@main/ipc/register'
  return (await import(specifier)) as { registerAllIpc: (baseDir: string) => void }
}

const REGISTER_MODULES = [
  { mod: 'project', fn: 'registerProjectIpc' },
  { mod: 'flow', fn: 'registerFlowIpc' },
  { mod: 'expression', fn: 'registerExpressionIpc' },
  { mod: 'codegen', fn: 'registerCodegenIpc' },
  { mod: 'file', fn: 'registerFileIpc' },
  { mod: 'terminal', fn: 'registerTerminalIpc' },
  { mod: 'runtime', fn: 'registerRuntimeIpc' },
  { mod: 'ai', fn: 'registerAiIpc' },
  { mod: 'aiAgentCore', fn: 'registerAiAgentCoreIpc' },
  { mod: 'aiInstruction', fn: 'registerAiInstructionIpc' },
  { mod: 'aiAllowRules', fn: 'registerAiAllowRulesIpc' },
  { mod: 'aiPresets', fn: 'registerAiPresetsIpc' },
  { mod: 'history', fn: 'registerHistoryIpc' },
  { mod: 'git', fn: 'registerGitIpc' },
  { mod: 'diagnostics', fn: 'registerDiagnosticsIpc' },
  { mod: 'metrics', fn: 'registerMetricsIpc' },
  { mod: 'metricsExport', fn: 'registerMetricsExportIpc' },
  { mod: 'customNode', fn: 'registerCustomNodeIpc' },
  { mod: 'crashReporter', fn: 'registerCrashReporterIpc' },
  { mod: 'resourceMonitor', fn: 'registerResourceMonitorIpc' },
  { mod: 'stateStore', fn: 'registerStateStoreIpc' },
  { mod: 'adapter', fn: 'registerAdapterIpc' },
  { mod: 'aiProvider', fn: 'registerAIProviderIpc' },
  { mod: 'debugger', fn: 'registerDebuggerIpc' },
  { mod: 'plugins', fn: 'registerPluginIpc' },
  { mod: 'botManager', fn: 'registerBotManagerIpc' },
  { mod: 'launchData', fn: 'registerLaunchDataIpc' },
  { mod: 'launchConfig', fn: 'registerLaunchConfigIpc' },
  { mod: 'launchDashboard', fn: 'registerLaunchDashboardIpc' },
  { mod: 'launchAudit', fn: 'registerLaunchAuditIpc' },
  { mod: 'launchBackup', fn: 'registerLaunchBackupIpc' },
  { mod: 'launchTransfer', fn: 'registerLaunchTransferIpc' },
  { mod: 'launchPanel', fn: 'registerLaunchPanelIpc' },
  { mod: 'official', fn: 'registerOfficialIpc' },
  { mod: 'dockerExport', fn: 'registerDockerExportIpc' },
  { mod: 'sshDeploy', fn: 'registerSshDeployIpc' },
  { mod: 'dataNotify', fn: 'registerDataNotifyIpc' },
  { mod: 'buttonPanel', fn: 'registerButtonPanelIpc' },
  { mod: 'panelSync', fn: 'registerPanelSyncIpc' },
  { mod: 'capability', fn: 'registerCapabilityIpc' },
] as const

const SERVICE_KEYS = {
  PROJECT_SERVICE: 'ProjectService',
  FLOW_SERVICE: 'FlowService',
  CODEGEN_SERVICE: 'CodegenService'
} as const

const hoisted = vi.hoisted(() => ({
  stubs: {} as Record<string, ReturnType<typeof vi.fn>>,
  getGlobalContainer: vi.fn(),
  captureIpcHandlers: vi.fn()
}))

const projectService = { kind: 'project' }
const flowService = { kind: 'flow' }
const codegenService = { kind: 'codegen' }

beforeEach(() => {
  vi.resetModules()
  for (const key of Object.keys(hoisted.stubs)) delete hoisted.stubs[key]
  hoisted.getGlobalContainer.mockReset()
  hoisted.getGlobalContainer.mockReturnValue({
    get: (key: string) =>
      key === SERVICE_KEYS.PROJECT_SERVICE
        ? projectService
        : key === SERVICE_KEYS.FLOW_SERVICE
          ? flowService
          : key === SERVICE_KEYS.CODEGEN_SERVICE
            ? codegenService
            : undefined
  })
  hoisted.captureIpcHandlers.mockReset()
  // 真实实现会调用回调（捕获期间执行注册）；默认模拟成「调用一次」
  hoisted.captureIpcHandlers.mockImplementation((fn: () => void) => fn())

  for (const { mod, fn } of REGISTER_MODULES) {
    const stub = vi.fn()
    hoisted.stubs[fn] = stub
    vi.doMock(`@main/ipc/${mod}`, () => ({ [fn]: stub }))
  }
  vi.doMock('@main/services/runner/serviceContainer', () => ({
    getGlobalContainer: hoisted.getGlobalContainer,
    SERVICE_KEYS
  }))
  vi.doMock('@main/services/ai/ipcBridge', () => ({ captureIpcHandlers: hoisted.captureIpcHandlers }))
  // 被这些域间接拉到的 electron 单例（如 botManager = new BotManager()）需要 app.getPath
  vi.doMock('electron', () => ({
    app: { getPath: vi.fn(() => '/tmp/qqbat-test-userdata'), getAppPath: vi.fn(() => '/tmp/app') },
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
    BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn() },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    shell: { openPath: vi.fn(), openExternal: vi.fn() }
  }))
})

afterEach(() => {
  vi.resetModules()
  for (const { mod } of REGISTER_MODULES) vi.doUnmock(`@main/ipc/${mod}`)
  vi.doUnmock('@main/services/runner/serviceContainer')
  vi.doUnmock('@main/services/ai/ipcBridge')
  vi.doUnmock('electron')
})

describe('registerAllIpc', () => {
  it('用 baseDir 取全局容器，并把 38 个域各注册一次', async () => {
    const { registerAllIpc } = await importRegisterModule()
    registerAllIpc('/base')

    expect(hoisted.getGlobalContainer).toHaveBeenCalledWith('/base')
    expect(hoisted.captureIpcHandlers).toHaveBeenCalledTimes(1)
    for (const { fn } of REGISTER_MODULES) {
      expect(hoisted.stubs[fn], `${fn} 应被调用一次`).toHaveBeenCalledTimes(1)
    }
  })

  it('核心服务实例来自同一份容器（project/flow/codegen 各传一次）', async () => {
    const { registerAllIpc } = await importRegisterModule()
    registerAllIpc('/base')

    const { stubs } = hoisted
    expect(stubs.registerProjectIpc).toHaveBeenCalledWith(projectService)
    expect(stubs.registerFlowIpc).toHaveBeenCalledWith(flowService)
    expect(stubs.registerCodegenIpc).toHaveBeenCalledWith(codegenService)
    // 智能体面板要能一次列出所有项目，所以 ai 域也拿 projectService 而不是重新 new 一个
    expect(stubs.registerAiIpc).toHaveBeenCalledWith(projectService)
    // 文件域拿到的是 baseDir 本身（框架开发模式需要在 baseDir 之上再定基准）
    expect(stubs.registerFileIpc).toHaveBeenCalledWith('/base')
  })

  it('捕获包装是刻意的：不调用回调时一个域都不会注册', async () => {
    hoisted.captureIpcHandlers.mockImplementation(() => undefined)
    const { registerAllIpc } = await importRegisterModule()
    registerAllIpc('/base')

    expect(hoisted.getGlobalContainer).not.toHaveBeenCalled()
    for (const { fn } of REGISTER_MODULES) {
      expect(hoisted.stubs[fn], `${fn} 不该在捕获包装之外注册`).not.toHaveBeenCalled()
    }
  })
})
