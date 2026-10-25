// src/shared/ai/presetUndo.ts
//
// **预设导入的撤销点**（2026-10-26，第 54 批）。
//
// 导入别人的预设会整表重写 `.qqbat/agent-presets.json`，而这份文件没有历史版本
//（writePresets 一直是整体覆盖）。所以"撤销一次导入"需要的全部数据都在这里：
//   · 导入**前**文件的原始字节（base64）与 sha256 —— 撤销要做精确字节恢复，
//     不是重新 JSON.parse 再格式化出"差不多"的文件（BOM/排版/非法字节都会变）；
//   · 导入**完成时**文件的 sha256 —— 撤销前先核对当前文件；导入之后又被改过
//     （用户手改、编辑器保存）就拒绝撤销，免得多年前的旧备份盖掉后来的改动；
//   · 只留**一级**：下一次成功导入覆盖它，语义始终是"撤销上一次导入"。
//
// 这里只放形状与常量（主进程和渲染层共用）；读写与校验规则在
// `src/main/services/ai/presetUndo.ts`。
//
// 撤销点不是分享文件的一部分：导出时不会带出去，导入别人的文件也永远碰不到它。
export const PRESET_UNDO_FILE = '.qqbat/agent-presets.undo.json'
export const PRESET_UNDO_VERSION = 1

/** 盘上的撤销点；只由主进程读写，不进分享文件 */
export interface PresetUndoRecord {
  version: 1
  /** ISO 时间；只用于界面显示与结果回执，不参与任何权限判断 */
  createdAt: string
  action: 'import'
  /** 用户选的分享文件名，仅展示 */
  sourceName?: string
  previousExisted: boolean
  previousSha256: string | null
  previousBase64: string | null
  /** 导入完成时 presets 文件的 sha256；撤销前用它核对"没有被改过" */
  afterSha256: string
  added: number
  replaced: number
  total: number
}

/** 给界面的状态；problem 表示有记录但读不出来（或已因后续改动失效） */
export interface PresetUndoState {
  available: boolean
  createdAt?: string
  sourceName?: string
  added?: number
  replaced?: number
  total?: number
  previousExisted?: boolean
  problem?: string
}

/** 撤销成功的结果；removed=true 表示导入前文件本来不存在、撤销把文件删掉了 */
export interface PresetUndoResult {
  restored: true
  removed: boolean
  createdAt: string
  added: number
  replaced: number
  total: number
}
