// src/main/services/plugins/aiPluginLoader.ts
//
// **AI 插件装载**（2026-10-19）：把 `plugins/<name>/` 下的 AI 插件包接到主进程插件宿主上。
//
// 形状：清单 `{ ai: true, name, version, entry }` + 入口导出 `activate(api)`。
// 执行在硬化沙箱里；宿主这一侧是一个 MainPlugin —— 贡献走 sandboxPluginBridge，
// 停用/卸载时 activate 返回的 cleanup 会把桥和上下文一起收掉（host.ts 已支持）。
import { readFile } from 'fs/promises';
import { basename, join } from 'path';
import type { Context } from 'node:vm';
import { createHardenedContext, deliverToSandbox } from '../../runtime/sandbox';
import {
  listMainPlugins,
  registerMainPlugin,
  setMainPluginEnabled,
  unregisterMainPlugin,
  type MainPluginPermission,
} from './host';
import { createSandboxPluginBridge } from './sandboxPluginBridge';
import { activateSandboxPlugin } from './sandboxPluginActivator';
import { readPluginPatch, writePluginPatch } from './patchFile';
import {
  forgetPluginSettings,
  getLivePluginSettings,
  readPluginSettings,
  setLivePluginSettings,
} from './pluginSettingsStore';
import { writeOverride, type PluginLayerEntry } from './layers';
import { DEFAULT_HOST_PLUGINS, isKnownHostPlugin } from './defaults';
import { mergeSettingValues, normalizeSettingSpecs } from '@shared/plugins/settings';
import { userDataPath } from '../infra/paths';
import { app } from 'electron';

export interface AiPluginManifestFile {
  name: string;
  version: string;
  entry: string;
  ai: true;
  description?: string;
  /**
   * 能力声明（`tool` / `prompt`）。缺省 = 两类都声明：老的 AI 插件包都是这个形状，
   * 不声明不等于"什么都不能干"，否则升级宿主后老包会突然全报权限错。
   */
  permissions?: unknown;
  /** 用户可填参数的声明（形状见 `@shared/plugins/settings`） */
  settings?: unknown;
}

/** AI 插件能声明的能力（与 host.ts 的 MainPluginPermission 同集合） */
const AI_PLUGIN_PERMISSIONS: readonly MainPluginPermission[] = ['tool', 'prompt'];

/** 过滤成宿主认识的权限；没声明 = 全给（兼容老包），声明了就按声明的来 */
function permissionsOf(raw: unknown): MainPluginPermission[] {
  if (!Array.isArray(raw)) return [...AI_PLUGIN_PERMISSIONS];
  const declared = new Set(raw.filter((x): x is string => typeof x === 'string'));
  return AI_PLUGIN_PERMISSIONS.filter((p) => declared.has(p));
}

export type LoadAiPluginResult =
  | { ok: true; pluginId: string }
  | { ok: false; error: string };

/** AI 插件的宿主 id（`ai.<slug>`）：装载、启停、卸载共用这一处派生 */
export function aiPluginIdOf(name: string): string {
  return 'ai.' + String(name).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

export async function loadAiPluginPackage(
  pluginDir: string,
  manifest: AiPluginManifestFile,
): Promise<LoadAiPluginResult> {
  const entryPath = join(pluginDir, manifest.entry);
  let source: string;
  try {
    source = await readFile(entryPath, 'utf-8');
  } catch {
    return { ok: false, error: '入口文件读不到: ' + entryPath };
  }
  const pluginId = aiPluginIdOf(manifest.name || basename(pluginDir));
  const aName = manifest.name || basename(pluginDir);
  const permissions = permissionsOf(manifest.permissions);
  const settingSpecs = normalizeSettingSpecs(manifest.settings);
  const dataDir = pluginDataDir();
  /**
   * 设置：出厂值 + 磁盘上已存值，合成一份放进内存热缓存。
   * 装载期一次性读盘（激活是同步的，不能在 activate 里 await）；之后保存走 IPC 直接改缓存。
   */
  let stored: unknown = {};
  if (dataDir && settingSpecs.length > 0) {
    try {
      stored = await readPluginSettings(dataDir, pluginId);
    } catch {
      stored = {};
    }
  }
  const settingValues = mergeSettingValues(settingSpecs, stored);
  try {
    registerMainPlugin({
      manifest: {
        id: pluginId,
        name: aName,
        version: manifest.version || '0.0.0',
        ...(manifest.description ? { description: manifest.description } : {}),
        permissions,
        ...(settingSpecs.length > 0 ? { settings: settingSpecs } : {}),
      },
      activate(api) {
        let ctx: Context | undefined;
        if (settingSpecs.length > 0) setLivePluginSettings(pluginId, settingValues);
        const bridge = createSandboxPluginBridge({
          pluginId,
          permissions,
          host: api,
          sendToSandbox: (message) => {
            if (ctx) deliverToSandbox(ctx, JSON.stringify(message));
          },
          settings: () => getLivePluginSettings(pluginId),
        });
        ctx = createHardenedContext((json) => bridge.handleBridgeMessage(json));
        activateSandboxPlugin(ctx, source, { filename: entryPath });
        return () => {
          bridge.dispose();
        };
      },
    });
    // 应用级覆盖：上次停用过的插件，装载后立即处于停用（工具不进循环）
    if (dataDir) {
      try {
        const overrides = await readPluginPatch(dataDir);
        if (overrides.find((o) => o.id === pluginId)?.disabled === true) {
          setMainPluginEnabled(pluginId, false);
        }
      } catch {
        // 读不到覆盖 = 按默认（启用）
      }
    }
    return { ok: true, pluginId };
  } catch (e) {
    forgetPluginSettings(pluginId);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * **应用级**插件数据目录（userData/plugins）。
 *
 * 宿主插件是宿主能力，配置跟应用走；项目目录里的 `plugins/` 放的是节点包资产，两者不能混。
 * 拿不到目录（非 Electron 主进程且没给 QQBAT_USER_DATA_DIR）时返回空串 —— 调用方按"只改内存"处理。
 */
export function pluginDataDir(): string {
  // hostPlugins 的布局分段就是 ['plugins']（paths.ts:78）；不要传裸 'plugins'，那不是 UserDataEntry
  return userDataPath('hostPlugins', app) ?? '';
}

/**
 * 按**插件名**启停 AI 插件（与节点插件共用 `plugin:setEnabled` 入口）。
 *
 * @returns 找到了并已处理 → true；不是 AI 插件 → false（调用方回落节点插件）
 *
 * 顺序有意为之：**先改运行时状态，再落盘**。落盘失败时插件已经按用户意图停用了，
 * 下次启动只是回到默认 —— 比"界面显示停用但工具还在循环里"安全。
 * 运行时插件不在 DEFAULT_HOST_PLUGINS 里，writeOverride 会跳过它，所以覆盖层单独写。
 */
export async function setAiPluginEnabledByName(name: string, enabled: boolean): Promise<boolean> {
  const pluginId = aiPluginIdOf(name);
  const found = listMainPlugins().some((p) => p.id === pluginId || p.name === name);
  if (!found) return false;

  setMainPluginEnabled(pluginId, enabled);
  const dataDir = pluginDataDir();
  if (!dataDir) return true;
  try {
    const overrides = await readPluginPatch(dataDir);
    const next: PluginLayerEntry[] = isKnownHostPlugin(pluginId)
      ? writeOverride(DEFAULT_HOST_PLUGINS, overrides, pluginId, enabled)
      : enabled
        ? overrides.filter((o) => o.id !== pluginId)
        : [...overrides.filter((o) => o.id !== pluginId), { id: pluginId, disabled: true }];
    await writePluginPatch(dataDir, next);
  } catch {
    // 写不了覆盖层不该让"停用一个插件"失败：内存里已经停了
  }
  return true;
}

/**
 * 按插件名卸载 AI 插件（撤销工具/提示贡献 + 收掉沙箱桥与上下文）。
 * @returns 找到并卸载了 → true；没有这个运行时插件 → false（调用方回落节点插件）
 */
export function unloadAiPluginByName(name: string): boolean {
  const pluginId = aiPluginIdOf(name);
  const hit = listMainPlugins().find((p) => p.id === pluginId || p.name === name);
  if (!hit) return false;
  unregisterMainPlugin(hit.id);
  return true;
}
