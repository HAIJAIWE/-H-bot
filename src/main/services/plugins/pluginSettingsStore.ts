// src/main/services/plugins/pluginSettingsStore.ts
//
// **插件设置的存放与热读**（2026-10-25）。
//
// 两件事：
//   1. 落盘：`<userData>/plugins/plugin-settings.json` —— 一个文件放所有插件的设置，
//      形状 `{ version: 1, plugins: { [pluginId]: values } }`。插件设置跟应用走，不跟项目走
//      （与 pluginDataDir 的既有语义一致：宿主插件是应用级能力）。
//   2. 内存热缓存：沙箱桥**每次调用**都问一遍当前值，所以"保存后立刻生效"不需要重载插件。
//      落盘失败时内存里也已经是新值 —— 和 setAiPluginEnabledByName 的取舍一致：
//      宁可"下次启动回到旧值"，也不要"界面显示保存了、插件读到的还是旧的"。
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PluginSettingValues } from '@shared/plugins/settings'

export const PLUGIN_SETTINGS_FILE = 'plugin-settings.json'

export interface PluginSettingsFile {
  version: 1
  plugins: Record<string, PluginSettingValues>
}

export function settingsFilePath(dir: string): string {
  return join(dir, PLUGIN_SETTINGS_FILE)
}

function emptyFile(): PluginSettingsFile {
  return { version: 1, plugins: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeValues(raw: unknown): PluginSettingValues {
  if (!isRecord(raw)) return {}
  const out: PluginSettingValues = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/**
 * 读整个设置文件。
 *
 * 读不到/坏了 = 空文件，**不抛**：插件设置的坏数据不该让插件装载失败或应用起不来。
 * 真正需要严格时（保存）会整份重写，坏数据在那时被自然清掉。
 */
export async function readSettingsFile(dir: string): Promise<PluginSettingsFile> {
  if (!dir) return emptyFile()
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(settingsFilePath(dir), 'utf-8'))
  } catch {
    return emptyFile()
  }
  if (!isRecord(parsed) || !isRecord(parsed.plugins)) return emptyFile()
  const plugins: Record<string, PluginSettingValues> = {}
  for (const [pluginId, values] of Object.entries(parsed.plugins)) {
    plugins[pluginId] = sanitizeValues(values)
  }
  return { version: 1, plugins }
}

/** 读一个插件的已存设置（没有 = 空对象） */
export async function readPluginSettings(
  dir: string,
  pluginId: string,
): Promise<PluginSettingValues> {
  const file = await readSettingsFile(dir)
  return file.plugins[pluginId] ?? {}
}

/** 覆盖写一个插件的设置（保留其它插件的） */
export async function writePluginSettings(
  dir: string,
  pluginId: string,
  values: PluginSettingValues,
): Promise<void> {
  if (!dir) return
  const file = await readSettingsFile(dir)
  const next: PluginSettingsFile = {
    version: 1,
    plugins: { ...file.plugins, [pluginId]: { ...values } },
  }
  await mkdir(dir, { recursive: true })
  await writeFile(settingsFilePath(dir), JSON.stringify(next, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// 内存热缓存（沙箱桥读这里）
// ---------------------------------------------------------------------------
const LIVE = new Map<string, PluginSettingValues>()

/** 装载时把"出厂值 + 已存值"放进来；保存时替换 */
export function setLivePluginSettings(pluginId: string, values: PluginSettingValues): void {
  LIVE.set(pluginId, { ...values })
}

export function getLivePluginSettings(pluginId: string): PluginSettingValues | undefined {
  const hit = LIVE.get(pluginId)
  return hit ? { ...hit } : undefined
}

/** 卸载插件时清掉，别让内存里堆着已经不存在的插件 */
export function forgetPluginSettings(pluginId: string): void {
  LIVE.delete(pluginId)
}
