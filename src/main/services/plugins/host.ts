// src/main/services/plugins/host.ts
//
// **主进程插件宿主**（2026-10-18；2026-10-20 换成 Cordis 式内核）：
// 插件能贡献**能力**（工具 / 提示段落），并通过**服务**互相依赖。
//
// 现在走 kernel.ts（服务容器 + inject 激活 + effect 回收）。宿主自己的职责只剩三件：
//   · 清单校验（id/name/version、requires 兼容性、权限声明）；
//   · 把"贡献"翻译成具体注册表（工具 → core.ts，提示段落 → prompt.ts，均可撤销）；
//   · 来源层/可停用保护（builtin 默认层 vs runtime）。
//
// 安全边界：插件代码仍在主进程内运行（树内插件）。外部插件走 sandboxPluginBridge
// 的桥（不在本文件），跨进程能力要等 IPC 权限模型。
import type { Tool } from '../agent-core/core';
import { registerTool, unregisterTool } from '../agent-core/core';
import type { PromptSection } from '../agent-core/prompt';
import { registerPromptSection, unregisterPromptSection } from '../agent-core/prompt';
import { satisfiesPluginRange } from '@shared/plugins/version';
import type { PluginIdentity } from '@shared/plugins/manifest';
import { DEFAULT_HOST_PLUGINS, isKnownHostPlugin } from './defaults';
import { kernel, type PluginKernelContext } from './kernel';

export type MainPluginPermission = 'tool' | 'prompt';

/** 插件来源层：内置（随包提供，见 defaults.ts）/ 运行时（装载时登记，例如 AI 插件） */
export type MainPluginSource = 'builtin' | 'runtime';

export interface MainPluginManifest extends PluginIdentity<MainPluginPermission> {
  /** 全局唯一；重复注册直接拒（否则两个插件会悄悄覆盖同一个工具名） */
  id: string;
  /** 能力声明：没声明的能力调用会直接抛错 */
  permissions?: MainPluginPermission[];
  /**
   * **依赖的服务名**（kernel 的核心语义）：全部可用才激活。
   * 例如工具插件 inject: ['tools'] —— 'tools' 服务由 builtin.tool-registry 提供。
   */
  inject?: string[];
  /** 兼容性：要求宿主版本满足的范围（不满足则注册但不激活，也不许强行启用） */
  requires?: string;
}

/** 主进程插件宿主版本（插件用 requires 判断兼容性） */
export const MAIN_PLUGIN_HOST_VERSION = '0.1.0';

export interface MainPluginApi {
  contributeTool(tool: Tool): void;
  contributePrompt(section: PromptSection): void;
}

export interface MainPlugin {
  manifest: MainPluginManifest;
  /**
   * 激活；可返回 cleanup（宿主在停用/卸载时调用，例如释放沙箱上下文与桥）。
   * 第二个参数是内核上下文（服务/effect）—— 只贡献工具/提示的插件可以忽略它。
   */
  activate: (api: MainPluginApi, ctx: PluginKernelContext) => void | (() => void);
}

/** 工具名 → 贡献它的插件 id（会话预设按插件集限定工具时用；与启停状态无关） */
const PLUGIN_TOOLS = new Map<string, Set<string>>();

interface PluginMeta {
  plugin: MainPlugin;
  source: MainPluginSource;
  compatible: boolean;
}

const META = new Map<string, PluginMeta>();

/**
 * 当前有哪些工具是**运行时插件**贡献的。
 *
 * 随包内置插件不算：会话预设的插件集只限定运行时插件，
 * 不该把 read_file 这类内置工具一起筛掉（scoping.ts 的语义是"内置工具不受影响"）。
 */
export function pluginOwnedTools(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [pluginId, names] of PLUGIN_TOOLS) {
    if (isKnownHostPlugin(pluginId)) continue;
    for (const name of names) out.set(name, pluginId);
  }
  return out;
}

/** 一次 activate：把权限检查 + 贡献 → 注册表 + effect 回收 包在一起 */
function buildApi(plugin: MainPlugin, ctx: PluginKernelContext): MainPluginApi {
  const allowed = new Set(plugin.manifest.permissions ?? []);
  const requirePermission = (perm: MainPluginPermission): void => {
    if (!allowed.has(perm)) {
      throw new Error(
        'plugin ' + plugin.manifest.id + ' did not declare the "' + perm + '" permission',
      );
    }
  };
  return {
    contributeTool: (tool) => {
      requirePermission('tool');
      /**
       * 重复注册**只允许"接管已存在的同名工具"**：内置工具在 core.ts 里已为早启动/测试
       * 预注册过；接管后撤销权归插件（停用 = 真的从注册表移除）。
       * 其它重复（两个插件抢同一个名字）仍然报错。
       */
      try {
        registerTool(tool);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('工具重复注册: ' + tool.name)) throw error;
      }
      const owned = PLUGIN_TOOLS.get(plugin.manifest.id) ?? new Set<string>();
      owned.add(tool.name);
      PLUGIN_TOOLS.set(plugin.manifest.id, owned);
      ctx.effect(() => {
        unregisterTool(tool.name);
        const current = PLUGIN_TOOLS.get(plugin.manifest.id);
        current?.delete(tool.name);
        if (current && current.size === 0) PLUGIN_TOOLS.delete(plugin.manifest.id);
      });
    },
    contributePrompt: (section) => {
      requirePermission('prompt');
      /**
       * 段落 id 自动带插件前缀（点号换短横）：跨插件不会撞 id，
       * 也满足 registerPromptSection 的 id 字符集（只允许小写/下划线/短横）。
       */
      const id = (plugin.manifest.id + '-' + section.id)
        .replace(/[^a-z0-9_-]/gi, '-')
        .toLowerCase();
      registerPromptSection({ ...section, id });
      ctx.effect(() => unregisterPromptSection(id));
    },
  };
}

/** 注册插件（树内插件启动时调；运行时插件装载时调） */
export function registerMainPlugin(plugin: MainPlugin): void {
  if (!plugin.manifest?.id) throw new Error('plugin manifest requires an id');
  if (!plugin.manifest.name) throw new Error('plugin manifest requires a name');
  if (!plugin.manifest.version) throw new Error('plugin manifest requires a version');
  if (META.has(plugin.manifest.id)) {
    throw new Error('plugin already registered: ' + plugin.manifest.id);
  }
  // 兼容性先判：不满足 requires 的插件注册但不激活（用户也不该能强行启用）
  const compatible = satisfiesPluginRange(MAIN_PLUGIN_HOST_VERSION, plugin.manifest.requires);
  const source: MainPluginSource = isKnownHostPlugin(plugin.manifest.id) ? 'builtin' : 'runtime';
  META.set(plugin.manifest.id, { plugin, source, compatible });
  try {
    kernel.register(
      {
        id: plugin.manifest.id,
        inject: plugin.manifest.inject ?? [],
        activate: (ctx) => plugin.activate(buildApi(plugin, ctx), ctx),
      },
      { enabled: compatible },
    );
  } catch (error) {
    // 激活失败不留半截：内核回滚了 effect/服务，这里再把登记也撤掉（原语义）
    kernel.unregister(plugin.manifest.id);
    META.delete(plugin.manifest.id);
    throw error;
  }
}

/** 启用/停用：停用 = 内核卸载（effect 逆序回收，依赖它的插件先卸载） */
export function setMainPluginEnabled(id: string, enabled: boolean): void {
  if (!META.has(id)) throw new Error('plugin not found: ' + id);
  /**
   * 随包核心插件（shipped）结构上不可停用：对齐 DSH 的 not-removable。
   * 保护放在**服务层**而不是界面：任何调用方（IPC/工具/脚本）都绕不过去。
   */
  if (DEFAULT_HOST_PLUGINS.some((p) => p.id === id && p.readOnlyReason === 'not-removable')) {
    throw new Error('插件不可停用（not-removable）: ' + id);
  }
  const info = META.get(id);
  if (info && !info.compatible && enabled) {
    throw new Error('plugin ' + id + ' is not compatible with this host');
  }
  kernel.setEnabled(id, enabled);
}

/** 彻底移除（测试/卸载用）：先撤销贡献，再从清单里删掉 */
export function unregisterMainPlugin(id: string): void {
  kernel.unregister(id);
  META.delete(id);
}

/** 已安装的主进程插件清单（含启停状态、来源层、依赖就绪情况） */
export function listMainPlugins(): Array<
  MainPluginManifest & {
    enabled: boolean;
    compatible: boolean;
    source: MainPluginSource;
    active: boolean;
    inject: string[];
    missing: string[];
  }
> {
  const state = new Map(kernel.list().map((info) => [info.id, info]));
  return [...META.entries()].map(([id, meta]) => {
    const info = state.get(id);
    return {
      ...meta.plugin.manifest,
      enabled: info?.enabled ?? meta.compatible,
      compatible: meta.compatible,
      source: meta.source,
      active: info?.active ?? false,
      inject: info?.inject ?? [],
      missing: info?.missing ?? [],
    };
  });
}
