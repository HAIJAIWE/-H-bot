// src/main/templates/index.ts
// 可导入玩法模板库：战斗系统 + 玩法系统模板
// BotType 对应的模板已统一到 BUILT_IN_TEMPLATES（src/main/services/templates.ts）
// 本目录仅保留可导入的独立玩法模块（战斗/交易/锻造/宠物/任务等）

import type { FlowTemplate } from '@shared/types/template'
import { COMBAT_TEMPLATES } from './combatTemplates'
import { GAMEPLAY_SYSTEMS_TEMPLATES } from './gameplaySystemsTemplates'
import { BUTTON_PANEL_TEMPLATES } from './buttonPanelTemplates'
import { RPG_BUTTON_PANEL_EXTENSION } from './rpgButtonPanelExtension'

/**
 * 可导入的玩法模板库（不按 botType 分类，用户可手动导入画布）
 *
 * 包含：4种战斗模式模板（回合制/概率暴击/技能克制/冷却制）
 *       4种玩法系统模板（交易/锻造/宠物/任务）
 *       1种按钮面板菜单系统模板（主菜单→子面板的完整按钮点击事件流程）
 *       1种 RPG 按钮面板扩展模板（为 RPG 游戏添加按钮面板 UI）
 * 这些模板演示如何用 expression_eval + random + switch_case
 * 节点搭出复杂游戏逻辑，无需写 Python 代码。
 */
export const IMPORTABLE_TEMPLATES: FlowTemplate[] = [
  ...COMBAT_TEMPLATES,
  ...GAMEPLAY_SYSTEMS_TEMPLATES,
  ...BUTTON_PANEL_TEMPLATES,
  RPG_BUTTON_PANEL_EXTENSION,
]

/**
 * 按 ID 获取可导入模板
 */
export function getImportableTemplate(templateId: string): FlowTemplate | null {
  return IMPORTABLE_TEMPLATES.find(t => t.id === templateId) ?? null
}

export { BUILT_IN_TEMPLATES } from './builtinTemplates'
