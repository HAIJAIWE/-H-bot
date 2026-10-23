// src/main/services/plugins/defaults.ts
//
// **内置宿主插件的默认层**（2026-10-19；2026-10-20 随内核拆分更新）：
// 层模型（layers.ts）先有"默认"，覆盖才有意义 ——
// 默认集合里的插件才有 patchId（可寻址、可启停）；受保护的（随包核心）没有 patchId，
// 只读且有结构原因（'not-removable'）—— 不是界面把开关置灰。
//
//   · builtin.tool-registry  —— tools 服务提供者（其它工具插件依赖它，不可停用）
//   · builtin.core-tools     —— 文件域核心工具（不可停用）
//   · builtin.tools.runtime  —— 命令执行（可停用：少给模型一个高危工具）
//   · builtin.tools.flow     —— 流程校验（可停用）
//   · 渲染层内置插件 builtin.enter-hint 只贡献 composer.hint 插槽、不注册宿主，不在此列；
//   · 运行时 AI 插件（source: 'runtime'）不是默认：装载时登记、卸载即消失。
import type { PluginLayerEntry } from './layers';

/**
 * 随应用构建、默认启用的**宿主**插件（主进程能力：工具 / 提示段落）。
 * 只登记 host.ts 里真的会注册的 id；渲染层插件不要放进来。
 */
export const DEFAULT_HOST_PLUGINS: readonly PluginLayerEntry[] = [
  /**
   * 核心工具随包提供（shipped），**结构上不可停用**：对齐 DSH 的 removable=false +
   * ManagementFailure('not-removable')。要"少给模型工具"的正确入口是会话预设（工具白名单），
   * 不是拆掉核心能力。
   */
  { id: 'builtin.core-tools', readOnlyReason: 'not-removable' },
  /** tools 服务提供者：拆掉它所有工具插件都会因依赖不满足而停用，故不可停用 */
  { id: 'builtin.tool-registry', readOnlyReason: 'not-removable' },
  /** 命令执行：可停用（减少高危工具面） */
  { id: 'builtin.tools.runtime' },
  /** 流程校验：可停用 */
  { id: 'builtin.tools.flow' },
];

/**
 * id 是否属于**内置宿主插件**（默认清单成员；是否可启停由 readOnlyReason 决定）。
 * 反过来说：不在清单里的宿主插件是运行时插件（AI 插件），由装载流程登记。
 */
export function isKnownHostPlugin(id: string): boolean {
  return DEFAULT_HOST_PLUGINS.some((p) => p.id === id);
}
