// tests/main/services/buttonPanelService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getButtonPanelLibrary,
  listButtonPanels,
  getButtonPanel,
  createButtonPanel,
  updateButtonPanel,
  deleteButtonPanel,
  duplicateButtonPanel,
  listBuiltinPanelTemplates,
  importBuiltinPanels,
} from '@main/services/buttonPanelService'
import { createEmptyKeyboard } from '@shared/types/keyboard'

let projectPath: string

describe('buttonPanelService', () => {
  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'qqbat-bp-'))
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('空项目返回空面板库', () => {
    const lib = getButtonPanelLibrary(projectPath)
    expect(lib.version).toBe(1)
    expect(lib.panels).toEqual([])
    expect(listButtonPanels(projectPath)).toEqual([])
  })

  it('创建面板后返回完整面板对象', () => {
    const panel = createButtonPanel(projectPath, '主菜单', '游戏主菜单')
    expect(panel.id).toMatch(/^panel_/)
    expect(panel.name).toBe('主菜单')
    expect(panel.description).toBe('游戏主菜单')
    expect(panel.keyboard).toBeDefined()
    expect(panel.keyboard.rows.length).toBeGreaterThan(0)
    expect(panel.createdAt).toBe(panel.updatedAt)

    // 文件已写入
    expect(existsSync(join(projectPath, '.qqbat', 'button_panels.json'))).toBe(true)

    // 列表正确
    const list = listButtonPanels(projectPath)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(panel.id)
  })

  it('getButtonPanel 返回面板或 null', () => {
    const panel = createButtonPanel(projectPath, 'P1')
    expect(getButtonPanel(projectPath, panel.id)?.name).toBe('P1')
    expect(getButtonPanel(projectPath, 'nonexistent')).toBeNull()
  })

  it('updateButtonPanel 更新字段并刷新 updatedAt', async () => {
    const panel = createButtonPanel(projectPath, 'P1')
    // 确保时间戳差异
    await new Promise((r) => setTimeout(r, 10))
    const updated = updateButtonPanel(projectPath, panel.id, {
      name: 'P2',
      description: 'desc',
    })
    expect(updated.name).toBe('P2')
    expect(updated.description).toBe('desc')
    expect(updated.updatedAt > panel.updatedAt).toBe(true)
    // keyboard 未变
    expect(updated.keyboard).toEqual(panel.keyboard)
  })

  it('updateButtonPanel 不存在时抛错', () => {
    expect(() => updateButtonPanel(projectPath, 'no-such', { name: 'x' })).toThrow()
  })

  it('updateButtonPanel 空名称抛错', () => {
    const panel = createButtonPanel(projectPath, 'P1')
    expect(() => updateButtonPanel(projectPath, panel.id, { name: '   ' })).toThrow()
  })

  it('deleteButtonPanel 删除面板', () => {
    const p1 = createButtonPanel(projectPath, 'P1')
    const p2 = createButtonPanel(projectPath, 'P2')
    expect(deleteButtonPanel(projectPath, p1.id)).toBe(true)
    expect(listButtonPanels(projectPath)).toHaveLength(1)
    expect(listButtonPanels(projectPath)[0].id).toBe(p2.id)
    // 再次删除返回 false
    expect(deleteButtonPanel(projectPath, p1.id)).toBe(false)
  })

  it('duplicateButtonPanel 深拷贝 keyboard', () => {
    const kb = createEmptyKeyboard()
    kb.rows[0].buttons[0].render_data.label = '按钮A'
    const src = createButtonPanel(projectPath, 'P1', '', kb)
    const copy = duplicateButtonPanel(projectPath, src.id, 'P1 副本')
    expect(copy.id).not.toBe(src.id)
    expect(copy.name).toBe('P1 副本')
    expect(copy.keyboard.rows[0].buttons[0].render_data.label).toBe('按钮A')
    // 修改副本不影响原件
    copy.keyboard.rows[0].buttons[0].render_data.label = '按钮B'
    expect(src.keyboard.rows[0].buttons[0].render_data.label).toBe('按钮A')
  })

  it('listButtonPanels 按更新时间倒序', async () => {
    const p1 = createButtonPanel(projectPath, 'P1')
    await new Promise((r) => setTimeout(r, 10))
    const p2 = createButtonPanel(projectPath, 'P2')
    await new Promise((r) => setTimeout(r, 10))
    updateButtonPanel(projectPath, p1.id, { name: 'P1-updated' })
    const list = listButtonPanels(projectPath)
    expect(list[0].id).toBe(p1.id)
    expect(list[1].id).toBe(p2.id)
  })

  it('createButtonPanel 空名称抛错', () => {
    expect(() => createButtonPanel(projectPath, '   ')).toThrow()
  })

  it('文件损坏时回退到空库', () => {
    const panel = createButtonPanel(projectPath, 'P1')
    expect(panel).toBeDefined()
    // 模拟文件损坏
    const { writeFileSync } = require('fs')
    writeFileSync(join(projectPath, '.qqbat', 'button_panels.json'), '{invalid json', 'utf-8')
    const lib = getButtonPanelLibrary(projectPath)
    expect(lib.panels).toEqual([])
  })
})

describe('listBuiltinPanelTemplates', () => {
  it('返回 8 个预置模板', () => {
    const templates = listBuiltinPanelTemplates()
    expect(templates.length).toBe(8)
    const ids = templates.map((t) => t.templateId)
    expect(ids).toContain('main_menu')
    expect(ids).toContain('inventory')
    expect(ids).toContain('skills')
    expect(ids).toContain('shop')
    expect(ids).toContain('quest')
    expect(ids).toContain('signin')
    expect(ids).toContain('character')
    expect(ids).toContain('gacha')
  })

  it('每个模板包含按钮数统计', () => {
    const templates = listBuiltinPanelTemplates()
    for (const t of templates) {
      expect(t.buttonCount).toBeGreaterThan(0)
    }
  })
})

describe('importBuiltinPanels', () => {
  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'qqbat-bp-'))
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('导入全部预置模板', () => {
    const created = importBuiltinPanels(projectPath)
    expect(created.length).toBe(8)
    const list = listButtonPanels(projectPath)
    expect(list.length).toBe(8)
  })

  it('按 templateIds 导入指定模板', () => {
    const created = importBuiltinPanels(projectPath, ['main_menu', 'inventory'])
    expect(created.length).toBe(2)
    expect(created[0].name).toBe('主菜单面板')
    expect(created[1].name).toBe('背包面板')
  })

  it('重复导入同名面板跳过', () => {
    const first = importBuiltinPanels(projectPath, ['main_menu'])
    expect(first.length).toBe(1)
    // 再次导入全部，main_menu 应被跳过
    const second = importBuiltinPanels(projectPath)
    expect(second.length).toBe(7) // 8 - 1 (main_menu 已存在)
    const list = listButtonPanels(projectPath)
    expect(list.length).toBe(8)
  })

  it('导入的面板 keyboard 结构完整', () => {
    const created = importBuiltinPanels(projectPath, ['main_menu'])
    const panel = created[0]
    expect(panel.keyboard.rows.length).toBeGreaterThan(0)
    for (const row of panel.keyboard.rows) {
      expect(row.buttons.length).toBeGreaterThan(0)
      for (const btn of row.buttons) {
        expect(btn.id).toBeTruthy()
        expect(btn.render_data.label).toBeTruthy()
        expect(btn.action.data).toBeTruthy()
      }
    }
  })

  it('无效 templateId 被忽略', () => {
    const created = importBuiltinPanels(projectPath, ['main_menu', 'nonexistent'])
    expect(created.length).toBe(1)
  })
})
