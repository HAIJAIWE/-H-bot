// src/main/nodes/compat.ts
import type { NodeSpec } from '@shared/types/flow'
import type { NodeSpecV2, PortSpec } from '@shared/types/nodeV2'

/**
 * 把旧 NodeSpec 转为 NodeSpecV2。
 * 旧字段保留，AI 字段填充默认值：
 * - summary = description
 * - sideEffects = []
 * - tags = []
 * - handler = { source: 'builtin', module: kind }
 * - exposedAsTool = false
 * - type 'plugin' 转为 'custom'
 */
export function toNodeSpecV2(old: NodeSpec): NodeSpecV2 {
  return {
    kind: old.kind,
    type: old.type === 'plugin' ? 'custom' : old.type,
    label: old.label,
    group: old.group,
    icon: old.icon,
    description: old.description,
    summary: old.description,  // 兼容默认用 description
    sideEffects: [],
    tags: [],
    handler: { source: 'builtin', module: old.kind },
    exposedAsTool: false,
    defaultConfig: old.defaultConfig,
    inputs: old.inputs.map(toPortSpec),
    outputs: old.outputs.map(toPortSpec)
  }
}

function toPortSpec(port: NodeSpec['inputs'][number]): PortSpec {
  return {
    id: port.id,
    name: port.name,
    kind: port.kind,
    dataType: port.dataType,
    description: '',
    required: false
  }
}
