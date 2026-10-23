// src/main/services/plugins/layers.ts
//
// **插件装配的层模型**（2026-10-19，Phase A）：借鉴 DSH 的语义，不复制其实现。
//
// 为什么需要"层"：只有"默认"存在，覆盖才有意义 —— 才能做**最小化**（与默认相同就不写）、
// 才能说"这条覆盖是多余的"。之前用扁平 disabled 列表，等于把历史操作日志当配置。
//
// 语义（对应 DSH plugin-manager）：
//   · 可寻址才可写：不在默认集合里的插件没有 patchId，只能只读（并给出原因）；
//   · 覆盖 = 与默认的差集：writeOverride 返回的永远是"最小"的覆盖表；
//   · 只读有**结构原因**，不是界面按钮置灰。
export interface PluginLayerEntry {
  id: string;
  disabled?: boolean;
  /**
   * 结构上的只读原因（不是界面置灰）：随包核心 = not-removable；
   * 其余两种由 addressabilityOf 在查不到/受管时产生。
   */
  readOnlyReason?: 'not-removable' | 'management-required' | 'unaddressable';
}

export type Addressability =
  | { patchId: string }
  | { readOnlyReason: 'not-removable' | 'management-required' | 'unaddressable' };

/** 组合默认层与用户覆盖层 → id → 是否启用（覆盖优先） */
export function composeLayer(
  defaults: readonly PluginLayerEntry[],
  overrides: readonly PluginLayerEntry[],
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const d of defaults) out.set(d.id, d.disabled !== true);
  for (const o of overrides) {
    // 只认默认集合里存在的 id：覆盖不能凭空造出一个插件
    if (out.has(o.id)) out.set(o.id, o.disabled !== true);
  }
  return out;
}

/** 地址能力：在默认集合里且未被保护 → 可写；否则只读并给出结构原因 */
export function addressabilityOf(
  id: string,
  defaults: readonly PluginLayerEntry[],
): Addressability {
  const entry = defaults.find((d) => d.id === id);
  if (!entry) return { readOnlyReason: 'unaddressable' };
  if (entry.readOnlyReason) return { readOnlyReason: entry.readOnlyReason };
  return { patchId: id };
}

/**
 * 写一条覆盖，返回**最小化**后的覆盖表：
 * 目标状态与默认相同 → 删掉该条（不留"设为默认值"的噪音）；不同 → 替换/追加。
 */
export function writeOverride(
  defaults: readonly PluginLayerEntry[],
  overrides: readonly PluginLayerEntry[],
  id: string,
  enabled: boolean,
): PluginLayerEntry[] {
  const base = defaults.find((d) => d.id === id);
  // 不可寻址 / 受保护（如随包核心插件）：不改写 —— 覆盖层不该出现一条永远无效的条目
  if (!base || base.readOnlyReason) return [...overrides];
  const baseEnabled = base.disabled !== true;
  const rest = overrides.filter((o) => o.id !== id);
  if (enabled === baseEnabled) return rest;
  return [...rest, { id, disabled: !enabled }];
}
