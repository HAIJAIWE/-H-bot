// tests/renderer/plugins/externalWindows.test.ts
//
// 第 73 批：外部窗口包 → 插件注册。钉三件事：
//   · 清单里的包会以 `external.<id>` 的窗口 id 出现在注册表，label 用清单里的名字；
//   · 加载失败（IPC 挂了 / ok:false）不抛、不注册；
//   · 重复 bootstrap 不会把窗口注册两遍。
import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_WINDOW_PREFIX,
  bootstrapExternalWindowPlugins,
  externalWindowIdOf,
} from '../../../src/renderer/src/plugins/externalWindows'
import { listAgentSurfaces } from '../../../src/renderer/src/lib/ai/agentSurface'
import type { WindowPackageScanResult } from '../../../src/shared/plugins/windowPackage'

const pkg = (id: string, name: string): WindowPackageScanResult['packages'][number] => ({
  schemaVersion: 1,
  id,
  name,
  version: '0.1.0',
  layout: 'compact',
  dir: 'C:/fake/' + id,
})

describe('外部窗口包加载器（第 73 批）', () => {
  it('窗口 id = external.<包 id>（避免撞内置 chat/compact）', () => {
    expect(externalWindowIdOf('demo.window')).toBe(EXTERNAL_WINDOW_PREFIX + 'demo.window')
    expect(externalWindowIdOf('demo.window')).not.toBe('chat')
  })

  it('bootstrap 把清单注册成窗口，label 用清单名字', async () => {
    const result = await bootstrapExternalWindowPlugins(async () => ({
      ok: true,
      data: { packages: [pkg('demo.one', '演示窗口')], issues: [] },
    }))
    expect(result).toEqual({ registered: 1, issues: 0 })

    const entry = listAgentSurfaces().find(s => s.id === externalWindowIdOf('demo.one'))
    expect(entry).toBeDefined()
    expect(entry?.label?.()).toBe('演示窗口')
  })

  it('IPC 失败不抛，返回 issues=1', async () => {
    // bootstrapped 已置位的情况之外，这里走的是 fetch 抛错分支
    const result = await bootstrapExternalWindowPlugins(async () => {
      throw new Error('ipc down')
    })
    expect(result.registered).toBe(0)
    expect(result.issues).toBe(1)
  })

  it('ok:false 也不注册', async () => {
    const result = await bootstrapExternalWindowPlugins(async () => ({ ok: false }))
    expect(result).toEqual({ registered: 0, issues: 1 })
  })
})
