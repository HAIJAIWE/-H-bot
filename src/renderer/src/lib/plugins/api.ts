// src/renderer/src/lib/plugins/api.ts
//
// **插件 API v0.2：树内插件 + 可启停**（2026-10-18）。
//
// 目标：给"别人用 AI 写插件"一个**确定的形状** —— 一个插件 = 一份清单 + 一组贡献。
// 现在只支持树内插件（随应用构建、由 plugins/index.ts 注册），**不支持运行时加载第三方代码**：
// 插件会以完整渲染层权限运行（能读 store、能发 IPC），在没有沙箱/权限模型之前，
// 动态加载 AI 生成的代码 = 直接把用户机器交出去。加载器是下一步，不是这一版。
//
// v0.2 补的是**可撤销**（对齐 Cordis 的"注册即副作用、卸载即回收"）：
// 每次 activate 的贡献都会被记账；停用插件 = 逐条 dispose，启用 = 重新 activate。
// 这条纪律比"画一个启用开关"重要 —— 没有它，停用只是界面上骗自己。
//
// v0.3（第 72 批）：**窗口也可以是插件贡献**。对齐 DSH 的 `dsh.client` 清单 ——
// 它的每个界面（对话、审批条、插件市场、设置页…）都是一个带 `dsh.client` 的 npm 包；
// 我们把同一件事缩到"渲染层插件能贡献第一类 UI"：插槽片段（slot）与整个智能体窗口（window）。
// 窗口插件同样吃第 70 批的 `AgentSurfaceContext`，不 import 内部 store。
import { registerAgentSurface } from '../ai/agentSurface';
import type { AgentSurfaceContext } from '../ai/agentSurfaceContext';
import { registerAiSlot, type AiSlotName } from '../ai/uiSlots';

import type { PluginIdentity } from '@shared/plugins/manifest';

export interface PluginManifest extends PluginIdentity<PluginPermission> {
  /** 全局唯一：重复注册直接拒（否则两个插件会悄悄覆盖同一段 UI） */
  id: string;
  /**
   * **能力声明**：插件只能用它声明过的能力。
   * 先靠声明把贡献范围钉住（没声明的能力调用直接拒），真隔离等运行时加载器。
   */
  permissions?: PluginPermission[];
  /**
   * **兼容性声明**（2026-10-18）：要求宿主版本满足的范围，如 `>=0.1.0` / `^0.1.0` / `0.1.0`。
   *
   * 不满足时插件**注册但不激活**（贡献一条都不进），面板里标"不兼容"且不允许启用 ——
   * 与"停用"是两件事：停用是用户选择，不兼容是宿主拒绝（用户不该能强行打开）。
   */
  requires?: string;
}

/** 宿主（插件 API）版本：插件用它判断兼容性 */
export const AI_PLUGIN_HOST_VERSION = '0.1.0';

/** 渲染层插件能声明的能力；主进程工具与提示段落不在这里（跨进程要走 IPC 权限模型） */
export type PluginPermission = 'slot' | 'window';

// 版本范围判定与主进程共用一份（见 src/shared/plugins/version.ts）
import { satisfiesPluginRange } from '@shared/plugins/version';
export { parsePluginVersion, satisfiesPluginRange } from '@shared/plugins/version';

export interface PluginSlotContribution {
  /** 插件内唯一即可；注册时自动加上插件前缀，避免跨插件撞 id */
  id: string;
  slot: AiSlotName;
  order?: number;
  render: () => React.ReactNode;
}

/**
 * 智能体窗口贡献（第 72 批）：整个右侧面板由这个插件接管。
 * 只吃 `AgentSurfaceContext`（第 70 批）：窗口插件不该 import 内部 store，否则内部结构换不动。
 */
export interface PluginAgentWindowContribution {
  /** 插件内唯一即可；注册时自动加上插件前缀 */
  id: string;
  /** 越小越优先；内置对话窗口是 1000，外部窗口想当默认就用更小的值 */
  order?: number;
  /** 给人看的名字：函数而非字符串 —— 每次现算 i18n，切语言不用重新注册 */
  label?: () => string;
  render: (context: AgentSurfaceContext) => React.ReactNode;
}

export interface PluginApi {
  /** 往面板插槽里贡献一段 UI */
  contributeSlot(entry: PluginSlotContribution): void;
  /** 贡献一整个智能体窗口（右侧面板） */
  contributeAgentWindow(entry: PluginAgentWindowContribution): void;
}

export interface Plugin {
  manifest: PluginManifest;
  activate: (api: PluginApi) => void;
}

interface InstalledPlugin {
  plugin: Plugin;
  /** 这个插件注册过的 dispose（停用时逐条撤销） */
  disposers: Array<() => void>;
  enabled: boolean;
  /** 宿主版本是否满足 manifest.requires（不兼容的插件不会被激活） */
  compatible: boolean;
}

const PLUGINS = new Map<string, InstalledPlugin>();

/**
 * **启停状态落盘**（2026-10-18）：不落盘的话"停用"只活到下次启动，
 * 用户会以为开关没用 —— 与"看起来成功了"同一类问题。
 *
 * 存在渲染层 localStorage：插件启停是**界面偏好**，不是项目数据（不该写进项目目录，
 * 也不该跨项目不同）；坏 JSON 当空集合（不能因为一条坏配置让所有插件消失）。
 */
const ENABLED_STORAGE_KEY = 'qqbat.plugins.disabled';

export function parseDisabledPlugins(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function readDisabledPlugins(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    return parseDisabledPlugins(localStorage.getItem(ENABLED_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function persistDisabledPlugins(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const disabled = [...PLUGINS.values()]
      .filter((p) => !p.enabled)
      .map((p) => p.plugin.manifest.id);
    localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(disabled));
  } catch {
    // 写不进去只影响"下次启动还记不记得"，不该让启停本身失败
  }
}

/** 声明一个插件（只是形状校验；激活由 registerPlugin 负责） */
export function definePlugin(plugin: Plugin): Plugin {
  if (!plugin.manifest?.id) throw new Error('plugin manifest requires an id');
  if (!plugin.manifest.name) throw new Error('plugin manifest requires a name');
  if (!plugin.manifest.version) throw new Error('plugin manifest requires a version');
  return plugin;
}

/** 跑一次 activate（把每次贡献的 dispose 收集起来） */
function activate(plugin: Plugin): Array<() => void> {
  const allowed = new Set(plugin.manifest.permissions ?? []);
  const disposers: Array<() => void> = [];
  try {
    plugin.activate({
      contributeSlot: (entry) => {
        if (!allowed.has('slot')) {
          throw new Error(
            'plugin ' + plugin.manifest.id + ' did not declare the "slot" permission',
          );
        }
        disposers.push(
          registerAiSlot({
            id: plugin.manifest.id + '.' + entry.id,
            slot: entry.slot,
            ...(entry.order !== undefined ? { order: entry.order } : {}),
            render: entry.render,
          }),
        );
      },
      contributeAgentWindow: (entry) => {
        if (!allowed.has('window')) {
          throw new Error(
            'plugin ' + plugin.manifest.id + ' did not declare the "window" permission',
          );
        }
        disposers.push(
          registerAgentSurface({
            // 窗口 id 直接用贡献方给的 id（不拼插件前缀）：它写进 `uiStore.agentSurfaceId`
            // 持久化，拼前缀会让用户选过的窗口在升级后失效。重名由注册表自己抛错。
            id: entry.id,
            ...(entry.order !== undefined ? { order: entry.order } : {}),
            ...(entry.label !== undefined ? { label: entry.label } : {}),
            render: entry.render,
          }),
        );
      },
    });
    return disposers;
  } catch (e) {
    // 激活失败：把已经注册的撤掉，别留半截（否则会多出一段没有主人的 UI）
    for (const dispose of disposers) dispose();
    throw e;
  }
}

/** 注册并**立即激活**（树内插件在模块加载时调它） */
export function registerPlugin(plugin: Plugin): void {
  if (PLUGINS.has(plugin.manifest.id)) {
    throw new Error('plugin already registered: ' + plugin.manifest.id);
  }
  /**
   * 兼容性先判：不满足 requires 的插件**注册但不激活**（用户也不该能启用 —— 见 setPluginEnabled）。
   * 再判用户上次的启停选择。
   */
  const compatible = satisfiesPluginRange(AI_PLUGIN_HOST_VERSION, plugin.manifest.requires);
  const enabled = compatible && !readDisabledPlugins().has(plugin.manifest.id);
  PLUGINS.set(plugin.manifest.id, {
    plugin,
    disposers: enabled ? activate(plugin) : [],
    enabled,
    compatible,
  });
}

/**
 * 启用/停用插件。停用 = 逐条撤销它的贡献（插槽立刻消失）；启用 = 重新 activate。
 * 找不到插件时抛错（调用方是界面，静默失败只会让人以为点了没反应）。
 */
export function setPluginEnabled(id: string, enabled: boolean): void {
  const entry = PLUGINS.get(id);
  if (!entry) throw new Error('plugin not found: ' + id);
  if (!entry.compatible && enabled) {
    throw new Error('plugin ' + id + ' is not compatible with this host');
  }
  if (entry.enabled === enabled) return;
  if (enabled) {
    entry.disposers = activate(entry.plugin);
  } else {
    for (const dispose of entry.disposers) dispose();
    entry.disposers = [];
  }
  entry.enabled = enabled;
  persistDisabledPlugins();
}

/** 已安装插件清单（含启停与兼容性） */
export function listPlugins(): Array<PluginManifest & { enabled: boolean; compatible: boolean }> {
  return [...PLUGINS.values()].map((p) => ({
    ...p.plugin.manifest,
    enabled: p.enabled,
    compatible: p.compatible,
  }));
}
