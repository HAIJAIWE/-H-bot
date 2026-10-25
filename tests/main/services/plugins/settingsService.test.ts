// tests/main/services/plugins/settingsService.test.ts
//
// 插件设置的主进程服务：声明从清单来、值热缓存优先、保存先校验再落盘再进缓存。
// 这一层是 IPC handler 与"纯函数/存储"之间的胶水，单独测它才能覆盖"顺序"。
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginSettingSpec } from '@shared/plugins/settings'

const mocks = vi.hoisted(() => ({ root: '' }))

// pluginDataDir() 走 userDataPath('hostPlugins', app) —— 给它一个临时 userData
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? mocks.root : ''),
  },
  ipcMain: { handle: vi.fn() },
}))

import {
  readPluginSettingsView,
  savePluginSettingsValues,
} from '@main/services/plugins/settingsService'
import { registerMainPlugin, unregisterMainPlugin } from '@main/services/plugins/host'
import { getLivePluginSettings } from '@main/services/plugins/pluginSettingsStore'

const PID = 'test.settings-plugin'
const EMPTY_PID = 'test.settings-empty'
const SPECS: PluginSettingSpec[] = [
  { key: 'greeting', label: 'Greeting', type: 'string', default: 'hi' },
  { key: 'count', label: 'Count', type: 'number' },
]

beforeAll(async () => {
  mocks.root = await mkdtemp(join(tmpdir(), 'qqbat-plugin-settings-svc-'))
  // 同一份宿主插件注册表在一个文件里共用：只在开头装一次，避免重复注册
  installPlugin(PID, SPECS)
})

afterAll(async () => {
  for (const id of [PID, EMPTY_PID]) {
    try {
      unregisterMainPlugin(id)
    } catch {
      /* 没装过就算了 */
    }
  }
  if (mocks.root) await rm(mocks.root, { recursive: true, force: true })
})

function installPlugin(id: string, settings?: PluginSettingSpec[]): void {
  registerMainPlugin({
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      permissions: [],
      ...(settings ? { settings } : {}),
    },
    activate() {
      /* 设置读写不需要贡献能力，激活体留空 */
    },
  })
}

describe('★ 插件设置服务', () => {
  it('★ 从没保存过时读到出厂值（没写 default 的键不出现）', async () => {
    const view = await readPluginSettingsView(PID)
    expect(view.id).toBe(PID)
    expect(view.settings).toEqual(SPECS)
    expect(view.values).toEqual({ greeting: 'hi' })
  })

  it('★ 保存：校验 → 落盘 → 进热缓存；再读回来是存的值', async () => {
    const saved = await savePluginSettingsValues(PID, { greeting: 'yo', count: 3 })
    expect(saved).toEqual({ id: PID, values: { greeting: 'yo', count: 3 } })

    const file = JSON.parse(
      await readFile(join(mocks.root, 'plugins', 'plugin-settings.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(file.version).toBe(1)
    expect(file.plugins).toEqual({ [PID]: { greeting: 'yo', count: 3 } })

    expect(getLivePluginSettings(PID)).toEqual({ greeting: 'yo', count: 3 })
    await expect(readPluginSettingsView(PID)).resolves.toMatchObject({
      id: PID,
      values: { greeting: 'yo', count: 3 },
    })
  })

  it('★ 类型不对：整体失败、热缓存与磁盘都保持上一份（不能静默存一半）', async () => {
    await savePluginSettingsValues(PID, { greeting: 'yo', count: 3 })
    await expect(savePluginSettingsValues(PID, { greeting: 'yo', count: 'abc' })).rejects.toThrow(
      /must be a number/,
    )
    expect(getLivePluginSettings(PID)).toEqual({ greeting: 'yo', count: 3 })
    const file = JSON.parse(
      await readFile(join(mocks.root, 'plugins', 'plugin-settings.json'), 'utf-8'),
    ) as { plugins: Record<string, unknown> }
    expect(file.plugins[PID]).toEqual({ greeting: 'yo', count: 3 })
  })

  it('插件没装载 → 读和写都报「未装载」', async () => {
    await expect(readPluginSettingsView('test.nope')).rejects.toThrow(/未装载/)
    await expect(savePluginSettingsValues('test.nope', {})).rejects.toThrow(/未装载/)
  })

  it('插件没声明 settings → 允许读（空表单），但保存直接拒绝', async () => {
    installPlugin(EMPTY_PID)
    await expect(readPluginSettingsView(EMPTY_PID)).resolves.toMatchObject({
      settings: [],
      values: {},
    })
    await expect(savePluginSettingsValues(EMPTY_PID, { x: 1 })).rejects.toThrow(/没有可配置项/)
  })
})
