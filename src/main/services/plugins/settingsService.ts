// src/main/services/plugins/settingsService.ts
//
// **插件设置的主进程服务**（2026-10-25，插件表单化）。
//
// IPC 层只管"形状对不对"（zod：id 是字符串、值是标量），这里管业务：
//   - 声明从哪来：插件清单的 settings（listMainPlugins 里那一份）
//   - 值从哪来：内存热缓存优先（那是正在生效的值），缓存空才回落磁盘
//   - 保存往哪写：先校验再落盘，最后更新热缓存（顺序见 savePluginSettingsValues 注释）
//
// 抽成服务而不是写在 handler 里，是为了能单独测这三件事；
// handler 只做 schema → 调这里 → tryIpcAsync。
import {
  coerceSettingValues,
  mergeSettingValues,
  type PluginSettingSpec,
  type PluginSettingValues,
} from '@shared/plugins/settings'
import { listMainPlugins } from './host'
import { pluginDataDir } from './aiPluginLoader'
import {
  getLivePluginSettings,
  readPluginSettings,
  setLivePluginSettings,
  writePluginSettings,
} from './pluginSettingsStore'

export interface PluginSettingsView {
  id: string
  settings: PluginSettingSpec[]
  values: PluginSettingValues
}

function findPlugin(id: string) {
  const plugin = listMainPlugins().find(p => p.id === id)
  if (!plugin) throw new Error(`插件未装载: ${id}`)
  return plugin
}

/**
 * 读一个宿主插件的设置声明与当前值（表单打开时用）。
 *
 * 热缓存为空的两种情况都要回落磁盘：插件从没被保存过（缓存里本来就没有），
 * 以及运行时插件当前没激活（缓存被 forget 了）—— 后者至少能让表单显示上次存过的值。
 */
export async function readPluginSettingsView(id: string): Promise<PluginSettingsView> {
  const plugin = findPlugin(id)
  const specs = plugin.settings ?? []
  let stored: unknown = getLivePluginSettings(plugin.id) ?? {}
  if (specs.length > 0 && Object.keys(stored as Record<string, unknown>).length === 0) {
    const dataDir = pluginDataDir()
    if (dataDir) stored = await readPluginSettings(dataDir, plugin.id)
  }
  return { id: plugin.id, settings: specs, values: mergeSettingValues(specs, stored) }
}

/**
 * 保存宿主插件设置：校验 → 落盘 → 更新热缓存。
 *
 * 顺序有意：落盘失败就让整个调用失败（不能让用户以为存住了）。
 * 缓存最后更新，所以"保存失败"时插件读到的还是旧值 —— 与界面显示一致。
 */
export async function savePluginSettingsValues(
  id: string,
  raw: Record<string, unknown>,
): Promise<{ id: string; values: PluginSettingValues }> {
  const plugin = findPlugin(id)
  const specs = plugin.settings ?? []
  if (specs.length === 0) throw new Error(`插件没有可配置项: ${plugin.id}`)
  const coerced = coerceSettingValues(specs, raw)
  if (!coerced.ok) throw new Error('设置校验失败: ' + coerced.error)
  const dataDir = pluginDataDir()
  if (dataDir) await writePluginSettings(dataDir, plugin.id, coerced.values)
  setLivePluginSettings(plugin.id, coerced.values)
  return { id: plugin.id, values: coerced.values }
}
