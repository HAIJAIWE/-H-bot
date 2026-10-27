// tests/renderer/lib/plugins/agentWindowContribution.test.ts
//
// 第 72 批：**窗口是插件贡献**的语义测试。
// 清单 + 权限 + 可撤销 —— 三件事都要在 API 层测到，不能只靠「界面上看起来在」。
import { describe, expect, it } from 'vitest'
import {
  definePlugin,
  registerPlugin,
  setPluginEnabled,
} from '../../../../src/renderer/src/lib/plugins/api'
import {
  getAgentSurface,
  listAgentSurfaces,
} from '../../../../src/renderer/src/lib/ai/agentSurface'

function windowPlugin(id: string, permissions: Array<'slot' | 'window'>, windowId: string) {
  return definePlugin({
    manifest: { id, name: id, version: '0.1.0', permissions },
    activate(api) {
      api.contributeAgentWindow({
        id: windowId,
        order: 500,
        label: () => '测试窗口',
        render: () => null,
      })
    },
  })
}

describe('★ 窗口=插件贡献（第 72 批）', () => {
  it('声明了 window 权限的插件能把窗口放进注册表，order 生效', () => {
    registerPlugin(windowPlugin('test.window.ok', ['window'], 'test-window-ok'))
    const entry = listAgentSurfaces().find(e => e.id === 'test-window-ok')
    expect(entry).toBeDefined()
    expect(entry?.order).toBe(500)
    expect(getAgentSurface('test-window-ok')?.id).toBe('test-window-ok')
  })

  it('没声明 window 权限 → 激活失败且不留半截', () => {
    expect(() =>
      registerPlugin(windowPlugin('test.window.denied', [], 'test-window-denied')),
    ).toThrow(/did not declare the "window" permission/)
  })

  it('停用插件 → 窗口从注册表消失；启用 → 回来', () => {
    registerPlugin(windowPlugin('test.window.toggle', ['window'], 'test-window-toggle'))
    expect(listAgentSurfaces().some(e => e.id === 'test-window-toggle')).toBe(true)

    setPluginEnabled('test.window.toggle', false)
    expect(listAgentSurfaces().some(e => e.id === 'test-window-toggle')).toBe(false)

    setPluginEnabled('test.window.toggle', true)
    expect(listAgentSurfaces().some(e => e.id === 'test-window-toggle')).toBe(true)
  })

  it('两个插件贡献同一个窗口 id → 后注册的直接抛错（不能悄悄覆盖）', () => {
    registerPlugin(windowPlugin('test.window.dup-a', ['window'], 'test-window-dup'))
    expect(() =>
      registerPlugin(windowPlugin('test.window.dup-b', ['window'], 'test-window-dup')),
    ).toThrow(/agent surface already registered/)
  })
})
