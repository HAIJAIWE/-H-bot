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
} from './host';
import { createSandboxPluginBridge } from './sandboxPluginBridge';
import { activateSandboxPlugin } from './sandboxPluginActivator';
import { readPluginPatch, writePluginPatch } from './patchFile';
import { writeOverride, type PluginLayerEntry } from './layers';
import { DEFAULT_HOST_PLUGINS, isKnownHostPlugin } from './defaults';
import { userDataPath } from '../infra/paths';
import { app } from 'electron';

export interface AiPluginManifestFile {
  name: string;
  version: string;
  entry: string;
  ai: true;
  description?: string;
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
  try {
    registerMainPlugin({
      manifest: {
        id: pluginId,
        name: manifest.name || basename(pluginDir),
        version: manifest.version || '0.0.0',
        ...(manifest.description ? { description: manifest.description } : {}),
        // AI 插件默认声明它能贡献的两类能力（更细的声明留给清单扩展）
        permissions: ['tool', 'prompt'],
      },
      activate(api) {
        let ctx: Context | undefined;
        const bridge = createSandboxPluginBridge({
          pluginId,
          permissions: ['tool', 'prompt'],
          host: api,
          sendToSandbox: (message) => {
            if (ctx) deliverToSandbox(ctx, JSON.stringify(message));
          },
        });
        ctx = createHardenedContext((json) => bridge.handleBridgeMessage(json));
        activateSandboxPlugin(ctx, source, { filename: entryPath });
        return () => {
          bridge.dispose();
        };
      },
    });
    // 应用级覆盖：上次停用过的插件，装载后立即处于停用（工具不进循环）
    const dataDir = pluginDataDir();
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
