// src/shared/ai/presetShare.ts
//
// **会话预设的分享文件**（2026-10-26，第 53 批）。
//
// 预设是一份权限边界。导入别人的预设文件，等于把一部分"能做什么"交给文件里的声明 ——
// 所以这里只做**可解释的数据交换**，不做静默合并：
//   · 文件自带 type/version，避免把任意 JSON 当预设；
//   · 只允许 AgentPreset 的八个字段，未知字段直接拒绝（zod strip 会悄悄丢掉它们）；
//   · 内置预设名、重名、被截断/被忽略的字段都在解析阶段拒绝，不"尽量导入"。
//
// 内置预设不导出：它随程序发布，导出再导入只会得到"与内置同名"的错误。
import type { AgentPreset } from './presetRoster'

export const PRESET_SHARE_TYPE = 'qqbat-agent-presets'
export const PRESET_SHARE_VERSION = 1
/** 分享文件上限：预设是短文本，超过这个大小基本可以确定不是预设文件 */
export const PRESET_SHARE_MAX_BYTES = 256 * 1024
/** 一个文件最多多少条：菜单是给人看的，不是数据库迁移工具 */
export const PRESET_SHARE_MAX_PRESETS = 200

/** 盘上的分享文件形状（也是导出的形状） */
export interface PresetShareFile {
  type: typeof PRESET_SHARE_TYPE
  version: number
  /** ISO 时间；只用于界面显示，不参与任何权限判断 */
  exportedAt: string
  presets: AgentPreset[]
}

/** 选完文件后的预览（还没写盘） */
export interface PresetSharePreview {
  exportedAt?: string
  presets: AgentPreset[]
  /** 与当前项目已有自定义预设同名的条目（需要用户显式勾选覆盖） */
  conflicts: string[]
  /** 当前项目已有的自定义预设条数（不含内置） */
  existingCount: number
}

/** 主进程打开文件对话框后回给渲染层的东西：原文 + 预览 */
export interface PresetSharePick {
  filePath: string
  fileName: string
  text: string
  preview: PresetSharePreview
}

/** 导入结果（只报数量，不报名字 —— 预览里已经列过） */
export interface PresetImportResult {
  added: number
  replaced: number
  total: number
}
