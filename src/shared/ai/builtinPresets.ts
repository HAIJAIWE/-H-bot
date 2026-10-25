// src/shared/ai/builtinPresets.ts
//
// **内置预设**（2026-10-26，第 51 批）。
//
// 对齐 DSH 的 builtin preset：它们不是用户文件里的一行，而是随程序发布的默认声明。
// 区别在于 DSH 允许用户用同名 override **整体替换**内置项；我们不允许 ——
// 内置是权限兜底，同名静默换掉语义比"少一个可编辑项"更危险。
// 想改内置的工具集，请在编辑器里另存一个不同名字的预设。
//
// 名字刻意避开常见自定义名（"只读""只读巡检"等）：内置项永远在菜单里，
// 与用户预设重名时用户那一条会被标记为不可用（见 services/ai/presets.ts）。
import type { AgentPreset } from './presetRoster'

/** 内置项在注册表里的标记（菜单/编辑器据此显示"内置"且不提供删除） */
export interface BuiltinPreset extends AgentPreset {
  builtin: true
}

/**
 * 两条内置预设，对应 DSH 的 standard / minimal：
 *  · 标准：不裁工具、不换角色，动作前逐次问 —— 相当于"什么都没限制"的命名版本，
 *    适合当项目默认值；
 *  · 最小只读：只留读文件/看目录/搜文本/看节点/查能力/校验流程，写与命令物理上不在表里。
 */
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    name: '标准',
    description: '内置：全部工具，角色跟页面；每个动作前先问你',
    order: 1,
    builtin: true,
  },
  {
    name: '最小只读',
    description: '内置：只读工具，不改文件、不跑命令',
    order: 3,
    permissionMode: 'ask',
    allowedTools: [
      'read_file',
      'list_dir',
      'search_text',
      'list_nodes',
      'check_capabilities',
      'validate_flow',
    ],
    builtin: true,
  },
]

/** 保留名集合（解析用户文件、写入、编辑器预检共用这一份） */
export const BUILTIN_PRESET_NAMES: ReadonlySet<string> = new Set(BUILTIN_PRESETS.map(p => p.name))
