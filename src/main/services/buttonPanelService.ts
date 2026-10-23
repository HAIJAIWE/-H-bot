// src/main/services/buttonPanelService.ts
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { ButtonPanel, ButtonPanelLibrary } from '@shared/types/buttonPanel'
import { createEmptyKeyboard } from '@shared/types/keyboard'
import { BUILTIN_PANEL_TEMPLATES, getPanelTemplate, instantiatePanelTemplate } from '@shared/panels/builtinPanelTemplates'

const PANELS_FILE = 'button_panels.json'
const LIB_VERSION = 1

/** 生成面板 ID */
function generatePanelId(): string {
  return `panel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 获取面板库文件路径 */
function getLibraryPath(projectPath: string): string {
  return join(projectPath, '.qqbat', PANELS_FILE)
}

/** 读取整个面板库，文件不存在或损坏时返回空库 */
export function getButtonPanelLibrary(projectPath: string): ButtonPanelLibrary {
  const filePath = getLibraryPath(projectPath)
  if (!existsSync(filePath)) {
    return { version: LIB_VERSION, panels: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.panels)) {
      return { version: LIB_VERSION, panels: [] }
    }
    return parsed as ButtonPanelLibrary
  } catch {
    return { version: LIB_VERSION, panels: [] }
  }
}

/** 保存整个面板库 */
function saveButtonPanelLibrary(projectPath: string, library: ButtonPanelLibrary): void {
  const dir = join(projectPath, '.qqbat')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = getLibraryPath(projectPath)
  writeFileSync(filePath, JSON.stringify(library, null, 2), 'utf-8')
}

/** 列出所有面板（按更新时间倒序） */
export function listButtonPanels(projectPath: string): ButtonPanel[] {
  const lib = getButtonPanelLibrary(projectPath)
  return [...lib.panels].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

/** 获取单个面板，不存在返回 null */
export function getButtonPanel(projectPath: string, panelId: string): ButtonPanel | null {
  const lib = getButtonPanelLibrary(projectPath)
  return lib.panels.find((p) => p.id === panelId) ?? null
}

/** 创建新面板，返回创建后的面板 */
export function createButtonPanel(
  projectPath: string,
  name: string,
  description: string = '',
  keyboard?: ButtonPanel['keyboard']
): ButtonPanel {
  if (!name || !name.trim()) {
    throw new Error('面板名称不能为空')
  }
  const lib = getButtonPanelLibrary(projectPath)
  const now = new Date().toISOString()
  const panel: ButtonPanel = {
    id: generatePanelId(),
    name: name.trim(),
    description: description.trim(),
    keyboard: keyboard ?? createEmptyKeyboard(),
    createdAt: now,
    updatedAt: now,
  }
  lib.panels.push(panel)
  saveButtonPanelLibrary(projectPath, lib)
  return panel
}

/** 更新面板（部分字段），返回更新后的面板，不存在抛错 */
export function updateButtonPanel(
  projectPath: string,
  panelId: string,
  patch: Partial<Pick<ButtonPanel, 'name' | 'description' | 'keyboard'>>
): ButtonPanel {
  const lib = getButtonPanelLibrary(projectPath)
  const idx = lib.panels.findIndex((p) => p.id === panelId)
  if (idx === -1) {
    throw new Error(`面板不存在：${panelId}`)
  }
  const current = lib.panels[idx]
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('面板名称不能为空')
    current.name = patch.name.trim()
  }
  if (patch.description !== undefined) {
    current.description = patch.description.trim()
  }
  if (patch.keyboard !== undefined) {
    current.keyboard = patch.keyboard
  }
  current.updatedAt = new Date().toISOString()
  lib.panels[idx] = current
  saveButtonPanelLibrary(projectPath, lib)
  return current
}

/** 删除面板，不存在返回 false，存在并删除返回 true */
export function deleteButtonPanel(projectPath: string, panelId: string): boolean {
  const lib = getButtonPanelLibrary(projectPath)
  const idx = lib.panels.findIndex((p) => p.id === panelId)
  if (idx === -1) return false
  lib.panels.splice(idx, 1)
  saveButtonPanelLibrary(projectPath, lib)
  return true
}

/** 复制面板（用于"另存为"），返回新面板 */
export function duplicateButtonPanel(projectPath: string, panelId: string, newName?: string): ButtonPanel {
  const src = getButtonPanel(projectPath, panelId)
  if (!src) {
    throw new Error(`面板不存在：${panelId}`)
  }
  return createButtonPanel(
    projectPath,
    newName ?? `${src.name} 副本`,
    src.description,
    JSON.parse(JSON.stringify(src.keyboard)) // 深拷贝 keyboard
  )
}

/** 列出所有可用的预置面板模板 */
export function listBuiltinPanelTemplates() {
  return BUILTIN_PANEL_TEMPLATES.map((t) => ({
    templateId: t.templateId,
    name: t.name,
    description: t.description,
    buttonCount: t.keyboard.rows.reduce((acc, r) => acc + (r?.buttons?.length ?? 0), 0),
  }))
}

/**
 * 导入预置面板模板到项目面板库。
 * - 若 templateIds 为空，则导入全部
 * - 已存在同名面板不会重复导入
 * 返回新创建的面板列表
 */
export function importBuiltinPanels(
  projectPath: string,
  templateIds?: string[]
): ButtonPanel[] {
  const lib = getButtonPanelLibrary(projectPath)
  const existingNames = new Set(lib.panels.map((p) => p.name))

  const templates = (templateIds && templateIds.length > 0)
    ? templateIds.map((id) => getPanelTemplate(id)).filter((t): t is NonNullable<typeof t> => !!t)
    : BUILTIN_PANEL_TEMPLATES

  const created: ButtonPanel[] = []
  for (const tpl of templates) {
    if (existingNames.has(tpl.name)) continue // 同名跳过
    const data = instantiatePanelTemplate(tpl)
    const panel: ButtonPanel = {
      id: generatePanelId(),
      ...data,
    }
    lib.panels.push(panel)
    created.push(panel)
  }

  if (created.length > 0) {
    saveButtonPanelLibrary(projectPath, lib)
  }
  return created
}
