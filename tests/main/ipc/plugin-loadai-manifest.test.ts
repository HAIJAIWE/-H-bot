// tests/main/ipc/plugin-loadai-manifest.test.ts
//
// plugin:loadAi 只做「读清单 → 挡掉非 AI 包 → 交给装载器」。
// 这里钉住一件事：清单里的 permissions / settings **必须透传**给装载器 ——
// 市场装载走 market.ts 另一条路，手工装载少传这两项，界面上的权限徽标与设置按钮就永远不出现。
//
// 清单用**真实临时目录**读（不 mock fs）：这条链只依赖 readFile，真文件比 mock 更接近运行形态，
// 也免得去猜 vitest 对内建模块的 mock 解析范围。
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const mocks = vi.hoisted(() => ({
  handleMock: vi.fn(),
  loadAiPluginPackage: vi.fn(),
  aiPluginIdOf: vi.fn((name: string) => 'ai.' + name.toLowerCase()),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handleMock },
  BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}))

vi.mock('@main/services/plugins/aiPluginLoader', () => ({
  aiPluginIdOf: mocks.aiPluginIdOf,
  loadAiPluginPackage: mocks.loadAiPluginPackage,
  pluginDataDir: vi.fn(() => ''),
  setAiPluginEnabledByName: vi.fn(() => true),
  unloadAiPluginByName: vi.fn(() => true),
}))

import { registerPluginIpc } from '@main/ipc/plugins'

let root = ''

/** 写一个插件目录，返回路径 */
async function pluginDir(name: string, manifest: Record<string, unknown>): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
  return dir
}

function handlerOf(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.handleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error('handler 未注册: ' + channel)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'qqbat-loadai-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.handleMock.mockReset()
  mocks.loadAiPluginPackage.mockReset()
  registerPluginIpc()
})

describe('plugin:loadAi 的清单透传', () => {
  it('★ permissions / settings 原样交给装载器（否则手工装的插件没有权限徽标与设置按钮）', async () => {
    const settings = [{ key: 'greeting', label: 'Greeting', type: 'string', default: 'hi' }]
    const dir = await pluginDir('with-settings', {
      name: 'ManifestPlugin',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
      description: '带设置的手工插件',
      permissions: ['tool'],
      settings,
    })
    mocks.loadAiPluginPackage.mockResolvedValue({ ok: true, pluginId: 'ai.manifestplugin' })

    const res = (await handlerOf('plugin:loadAi')({}, { pluginPath: dir })) as {
      ok: boolean
      error?: string
    }
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(mocks.loadAiPluginPackage).toHaveBeenCalledWith(dir, {
      name: 'ManifestPlugin',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
      description: '带设置的手工插件',
      permissions: ['tool'],
      settings,
    })
  })

  it('清单没写这两项时不硬塞（老插件包行为不变）', async () => {
    const dir = await pluginDir('plain', {
      name: 'Plain',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
    })
    mocks.loadAiPluginPackage.mockResolvedValue({ ok: true, pluginId: 'ai.plain' })
    const res = (await handlerOf('plugin:loadAi')({}, { pluginPath: dir })) as {
      ok: boolean
      error?: string
    }
    expect(res.error).toBeUndefined()
    expect(mocks.loadAiPluginPackage).toHaveBeenCalledWith(dir, {
      name: 'Plain',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
    })
  })
})
