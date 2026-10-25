// tests/main/services/plugins/pluginSettingsStore.test.ts
//
// 插件设置存储：userData 下的一份 json + 一份**内存热缓存**。
// 热缓存存在的唯一原因：沙箱桥每次工具调用都要读设置，不能每次读盘。
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PLUGIN_SETTINGS_FILE,
  forgetPluginSettings,
  getLivePluginSettings,
  readPluginSettings,
  setLivePluginSettings,
  settingsFilePath,
  writePluginSettings,
} from '@main/services/plugins/pluginSettingsStore'

// 每个用例结束时把本文件碰过的插件从热缓存里摘掉（缓存是模块级单例）
afterEach(() => {
  forgetPluginSettings('ai.x')
  forgetPluginSettings('ai.a')
  forgetPluginSettings('ai.b')
})

describe('★ 插件设置落盘', () => {
  it('★ 写入后能读回来；文件形状是 {version:1, plugins:{id:values}}', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbat-plugin-settings-'))
    await writePluginSettings(dir, 'ai.market-clock', { timezone: 'UTC', loud: true })
    await expect(readPluginSettings(dir, 'ai.market-clock')).resolves.toEqual({
      timezone: 'UTC',
      loud: true,
    })
    const raw = JSON.parse(await readFile(settingsFilePath(dir), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(raw.version).toBe(1)
    expect(raw.plugins).toEqual({ 'ai.market-clock': { timezone: 'UTC', loud: true } })
    expect(settingsFilePath(dir).endsWith(PLUGIN_SETTINGS_FILE)).toBe(true)
  })

  it('★ 写一个插件不覆盖别的插件（多插件共用一份文件）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbat-plugin-settings-'))
    await writePluginSettings(dir, 'ai.a', { x: 1 })
    await writePluginSettings(dir, 'ai.b', { y: 2 })
    await expect(readPluginSettings(dir, 'ai.a')).resolves.toEqual({ x: 1 })
    await expect(readPluginSettings(dir, 'ai.b')).resolves.toEqual({ y: 2 })
  })

  it('文件坏了 = 空配置，不抛（坏 json 不该让插件装不上）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbat-plugin-settings-'))
    await writeFile(settingsFilePath(dir), '{ not json', 'utf-8')
    await expect(readPluginSettings(dir, 'ai.x')).resolves.toEqual({})
  })

  it('没存过的插件 → 空对象', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbat-plugin-settings-'))
    await expect(readPluginSettings(dir, 'ai.none')).resolves.toEqual({})
  })
})

describe('★ 内存热缓存（保存即生效的载体）', () => {
  it('★ set → get；插件没设置时读 undefined（宿主每次工具调用都现取这一份）', () => {
    expect(getLivePluginSettings('ai.x')).toBeUndefined()
    setLivePluginSettings('ai.x', { k: 'v' })
    expect(getLivePluginSettings('ai.x')).toEqual({ k: 'v' })
  })

  it('forget 后回到未装载状态（卸载插件要清掉，否则重装读到旧值）', () => {
    setLivePluginSettings('ai.x', { k: 'v' })
    forgetPluginSettings('ai.x')
    expect(getLivePluginSettings('ai.x')).toBeUndefined()
  })

  it('get 返回副本：调用方改了不影响缓存', () => {
    setLivePluginSettings('ai.x', { k: 'v' })
    const snapshot = getLivePluginSettings('ai.x')
    if (snapshot) snapshot.k = 'changed'
    expect(getLivePluginSettings('ai.x')).toEqual({ k: 'v' })
  })
})
