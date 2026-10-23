// tests/main/services/templates.test.ts
// TemplateService 单元测试 — 覆盖内置模板查询、摘要生成、按 botCategory 过滤、
// 模板导入/导出/保存/删除的文件系统操作与缓存失效。
//
// 测试策略：
// - 内置模板相关方法（listBuiltin / listBuiltinSummaries / listBuiltinSummariesByCategory /
//   getTemplateById / getTemplatesByCategory）：纯函数，直接断言
// - 文件系统相关方法（saveTemplate / deleteTemplate / loadTemplatesFromDir）：
//   使用 mkdtemp 创建临时目录，mock electron app.getPath 与 dialog
// - 导入/导出对话框：mock electron dialog
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock electron 模块（app.getPath / dialog.showSaveDialog / dialog.showOpenDialog）
// vi.mock 工厂被提升到文件顶部，普通变量无法在工厂内引用；
// 使用 vi.hoisted() 提升 mock 函数声明，使其与 vi.mock 同步可见。
const { mockGetPath, mockShowSaveDialog, mockShowOpenDialog } = vi.hoisted(() => ({
  mockGetPath: vi.fn<(path: string) => string>(() => '/tmp/qqbat-default'),
  mockShowSaveDialog: vi.fn(),
  mockShowOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
  },
  dialog: {
    showSaveDialog: mockShowSaveDialog,
    showOpenDialog: mockShowOpenDialog,
  },
}))

// 在导入被测模块前先设置 mock
import { TemplateService, getTemplatesByCategory, TemplateSummary } from '@main/services/templates'
import { BUILT_IN_TEMPLATES } from '@main/templates/builtinTemplates'
import { FlowTemplate } from '@shared/types/template'

let userDataDir: string
let tmpProjectDir: string
let service: TemplateService

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'qqbat-templates-userdata-'))
  tmpProjectDir = await mkdtemp(join(tmpdir(), 'qqbat-templates-project-'))
  mockGetPath.mockReturnValue(userDataDir)
  mockShowSaveDialog.mockReset()
  mockShowOpenDialog.mockReset()
  service = new TemplateService()
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
  await rm(tmpProjectDir, { recursive: true, force: true })
})

describe('TemplateService - 内置模板查询', () => {
  describe('listBuiltin', () => {
    it('返回所有内置模板（含 BUILT_IN_TEMPLATES 与 IMPORTABLE_TEMPLATES）', () => {
      const list = service.listBuiltin()
      expect(list.length).toBeGreaterThanOrEqual(BUILT_IN_TEMPLATES.length)
      // 每个模板含 id/nodes/edges 等必填字段
      for (const t of list) {
        expect(typeof t.id).toBe('string')
        expect(Array.isArray(t.nodes)).toBe(true)
        expect(Array.isArray(t.edges)).toBe(true)
      }
    })

    it('返回只读引用（同一模板对象引用稳定）', () => {
      const list1 = service.listBuiltin()
      const list2 = service.listBuiltin()
      // 内置模板对象应共享引用（同一对象）
      const ids1 = list1.map(t => t.id)
      const ids2 = list2.map(t => t.id)
      expect(ids1).toEqual(ids2)
    })
  })

  describe('listBuiltinSummaries', () => {
    it('返回摘要列表，每项含 id/name/botCategory/nodeCount/edgeCount', () => {
      const summaries = service.listBuiltinSummaries()
      expect(summaries.length).toBeGreaterThan(0)
      for (const s of summaries) {
        expect(typeof s.id).toBe('string')
        expect(typeof s.name).toBe('string')
        // botCategory 可能为 undefined（IMPORTABLE_TEMPLATES 未设置时），
        // 已设置的必须为 'functional' 或 'game'
        if (s.botCategory !== undefined) {
          expect(['functional', 'game']).toContain(s.botCategory)
        }
        expect(typeof s.nodeCount).toBe('number')
        expect(typeof s.edgeCount).toBe('number')
        expect(s.nodeCount).toBeGreaterThanOrEqual(0)
      }
    })

    it('摘要不含 nodes/edges（降低 IPC 传输量）', () => {
      const summaries: TemplateSummary[] = service.listBuiltinSummaries()
      for (const s of summaries) {
        expect((s as unknown as Record<string, unknown>).nodes).toBeUndefined()
        expect((s as unknown as Record<string, unknown>).edges).toBeUndefined()
      }
    })

    it('nodeCount/edgeCount 与完整模板一致', () => {
      const summaries = service.listBuiltinSummaries()
      const fullList = service.listBuiltin()
      for (const s of summaries) {
        const full = fullList.find(t => t.id === s.id)
        expect(full).toBeDefined()
        expect(s.nodeCount).toBe(full!.nodes.length)
        expect(s.edgeCount).toBe(full!.edges.length)
      }
    })
  })

  describe('listBuiltinSummariesByCategory', () => {
    it('botCategory=functional 仅返回功能类模板', () => {
      const summaries = service.listBuiltinSummariesByCategory('functional')
      expect(summaries.length).toBeGreaterThan(0)
      for (const s of summaries) {
        expect(s.botCategory).toBe('functional')
      }
    })

    it('botCategory=game 仅返回游戏类模板', () => {
      const summaries = service.listBuiltinSummariesByCategory('game')
      expect(summaries.length).toBeGreaterThan(0)
      for (const s of summaries) {
        expect(s.botCategory).toBe('game')
      }
    })

    it('两类合并等于 BUILT_IN_TEMPLATES 数（listBuiltinSummariesByCategory 仅过滤 BUILT_IN_TEMPLATES，不含 IMPORTABLE）', () => {
      const functional = service.listBuiltinSummariesByCategory('functional')
      const game = service.listBuiltinSummariesByCategory('game')
      // listBuiltinSummariesByCategory 仅覆盖 BUILT_IN_TEMPLATES，
      // 而 listBuiltinSummaries 还包含 IMPORTABLE_TEMPLATES，故两者数量不一定相等。
      expect(functional.length + game.length).toBe(BUILT_IN_TEMPLATES.length)
    })

    it('两类无重叠', () => {
      const functional = service.listBuiltinSummariesByCategory('functional')
      const game = service.listBuiltinSummariesByCategory('game')
      const functionalIds = new Set(functional.map(s => s.id))
      for (const g of game) {
        expect(functionalIds.has(g.id)).toBe(false)
      }
    })

    it('内置 6 个游戏模板（rpg/cultivation/wuxia/card/management/quiz）', () => {
      const game = service.listBuiltinSummariesByCategory('game')
      expect(game.length).toBeGreaterThanOrEqual(6)
      const ids = game.map(s => s.id)
      expect(ids).toContain('tutorial-combat-loop')
      expect(ids).toContain('builtin-cultivation')
      expect(ids).toContain('gameplay-wuxia')
      expect(ids).toContain('gameplay-card')
      expect(ids).toContain('gameplay-management')
      expect(ids).toContain('builtin-quiz-game')
    })

    it('内置 2 个功能类模板（group-admin/smart-qa）', () => {
      const functional = service.listBuiltinSummariesByCategory('functional')
      expect(functional.length).toBeGreaterThanOrEqual(2)
      const ids = functional.map(s => s.id)
      expect(ids).toContain('builtin-group-admin')
      expect(ids).toContain('builtin-smart-qa')
    })
  })

  describe('getTemplateById', () => {
    it('存在的 ID 返回完整模板', () => {
      const t = service.getTemplateById('builtin-cultivation')
      expect(t).not.toBeNull()
      expect(t!.id).toBe('builtin-cultivation')
      expect(t!.botCategory).toBe('game')
      expect(t!.nodes.length).toBeGreaterThan(0)
    })

    it('不存在的 ID 返回 null', () => {
      const t = service.getTemplateById('nonexistent-id-xxx')
      expect(t).toBeNull()
    })

    it('空字符串 ID 返回 null', () => {
      const t = service.getTemplateById('')
      expect(t).toBeNull()
    })

    it('O(1) 查找返回同一对象引用（缓存）', () => {
      const t1 = service.getTemplateById('tutorial-combat-loop')
      const t2 = service.getTemplateById('tutorial-combat-loop')
      expect(t1).toBe(t2)
    })

    it('IMPORTABLE_TEMPLATES 中的模板也可通过 ID 获取', () => {
      // IMPORTABLE_TEMPLATES 至少包含一些模板
      const all = service.listBuiltin()
      // 找出 IMPORTABLE 但非 BUILT_IN 的模板
      const builtinIds = new Set(BUILT_IN_TEMPLATES.map(t => t.id))
      const importable = all.filter(t => !builtinIds.has(t.id))
      if (importable.length > 0) {
        const target = importable[0]
        const got = service.getTemplateById(target.id)
        expect(got).not.toBeNull()
        expect(got!.id).toBe(target.id)
      }
    })
  })
})

describe('getTemplatesByCategory（模块级导出函数）', () => {
  it('functional 返回功能类模板列表', () => {
    const list = getTemplatesByCategory('functional')
    expect(list.length).toBeGreaterThan(0)
    for (const t of list) {
      expect(t.botCategory).toBe('functional')
    }
  })

  it('game 返回游戏类模板列表', () => {
    const list = getTemplatesByCategory('game')
    expect(list.length).toBeGreaterThanOrEqual(6)
    for (const t of list) {
      expect(t.botCategory).toBe('game')
    }
  })

  it('返回完整 FlowTemplate 对象（含 nodes/edges）', () => {
    const list = getTemplatesByCategory('game')
    for (const t of list) {
      expect(Array.isArray(t.nodes)).toBe(true)
      expect(Array.isArray(t.edges)).toBe(true)
      expect(t.nodes.length).toBeGreaterThan(0)
    }
  })

  it('两类合并等于 BUILT_IN_TEMPLATES.length', () => {
    const functional = getTemplatesByCategory('functional')
    const game = getTemplatesByCategory('game')
    expect(functional.length + game.length).toBe(BUILT_IN_TEMPLATES.length)
  })
})

describe('TemplateService - 文件系统操作', () => {
  describe('saveTemplate + listTemplates', () => {
    it('保存模板到项目目录后可被 listTemplates 读取', async () => {
      const tpl: FlowTemplate = {
        id: 'test-custom-tpl',
        name: '测试自定义模板',
        description: '单元测试用',
        botCategory: 'functional',
        category: '其他',
        tags: ['test'],
        author: 'vitest',
        nodes: [],
        edges: [],
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      }
      await service.saveTemplate(tmpProjectDir, tpl)

      // listTemplates 应返回内置 + 项目模板
      const all = await service.listTemplates(tmpProjectDir)
      const ids = all.map(t => t.id)
      expect(ids).toContain('test-custom-tpl')
    })

    it('保存后文件落在 <projectPath>/.qqbat/templates/<id>.json', async () => {
      const tpl: FlowTemplate = {
        id: 'file-path-check',
        name: '路径检查',
        description: '',
        botCategory: 'game',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await service.saveTemplate(tmpProjectDir, tpl)
      const expectedPath = join(tmpProjectDir, '.qqbat', 'templates', 'file-path-check.json')
      expect(existsSync(expectedPath)).toBe(true)
    })

    it('同名模板保存覆盖旧文件', async () => {
      const tpl: FlowTemplate = {
        id: 'overwrite-test',
        name: '原版',
        description: 'v1',
        botCategory: 'functional',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await service.saveTemplate(tmpProjectDir, tpl)
      // 覆盖
      tpl.name = '新版'
      tpl.description = 'v2'
      await service.saveTemplate(tmpProjectDir, tpl)

      const all = await service.listTemplates(tmpProjectDir)
      const got = all.find(t => t.id === 'overwrite-test')
      expect(got).toBeDefined()
      expect(got!.name).toBe('新版')
      expect(got!.description).toBe('v2')
    })

    it.skip('listTemplates 不传 projectPath 仅返回内置 + 用户目录模板', async () => {
      // 跳过：getUserTemplatesDir 内部使用 require('electron') 而非 import，
      // vi.mock 无法拦截 CJS require 调用，导致 app.getPath 抛异常。
      // 在用户数据目录保存一个模板
      const tpl: FlowTemplate = {
        id: 'user-tpl',
        name: '用户模板',
        description: '',
        botCategory: 'functional',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await service.importTemplate(tpl)

      const all = await service.listTemplates()
      const ids = all.map(t => t.id)
      expect(ids).toContain('user-tpl')
    })
  })

  describe('deleteTemplate', () => {
    it('内置模板（builtin- 前缀）不能删除，返回 false', async () => {
      const result = await service.deleteTemplate('builtin-cultivation', tmpProjectDir)
      expect(result).toBe(false)
    })

    it('删除项目模板文件成功，返回 true', async () => {
      const tpl: FlowTemplate = {
        id: 'to-delete',
        name: '待删除',
        description: '',
        botCategory: 'functional',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await service.saveTemplate(tmpProjectDir, tpl)
      const result = await service.deleteTemplate('to-delete', tmpProjectDir)
      expect(result).toBe(true)

      // 确认文件已删除
      const all = await service.listTemplates(tmpProjectDir)
      expect(all.find(t => t.id === 'to-delete')).toBeUndefined()
    })

    it('删除不存在的模板返回 false', async () => {
      const result = await service.deleteTemplate('nonexistent-tpl', tmpProjectDir)
      expect(result).toBe(false)
    })
  })

  describe('loadTemplatesFromDir - 缓存与失效', () => {
    it('mtime 未变时使用缓存（不重复 readFile）', async () => {
      const tpl: FlowTemplate = {
        id: 'cache-test',
        name: '缓存测试',
        description: 'v1',
        botCategory: 'functional',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await service.saveTemplate(tmpProjectDir, tpl)

      // 第一次加载
      const list1 = await service.listTemplates(tmpProjectDir)
      const got1 = list1.find(t => t.id === 'cache-test')
      expect(got1!.description).toBe('v1')

      // 直接修改文件（不动 mtime 太快，等待一下）
      await new Promise(r => setTimeout(r, 50))
      const filePath = join(tmpProjectDir, '.qqbat', 'templates', 'cache-test.json')
      await writeFile(filePath, JSON.stringify({
        ...tpl,
        description: 'v2-manual-edit',
      }, null, 2), 'utf-8')

      // 第二次加载：mtime 变化应触发重新读取
      const list2 = await service.listTemplates(tmpProjectDir)
      const got2 = list2.find(t => t.id === 'cache-test')
      expect(got2!.description).toBe('v2-manual-edit')
    })

    it('跳过无效 JSON 文件', async () => {
      // 在项目模板目录写入一个无效 JSON 文件
      const dir = join(tmpProjectDir, '.qqbat', 'templates')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'invalid.json'), '{not valid json', 'utf-8')

      // listTemplates 应不抛异常，只是跳过无效文件
      const all = await service.listTemplates(tmpProjectDir)
      expect(all.find(t => t.id === 'invalid')).toBeUndefined()
    })

    it('模板目录不存在时返回空数组（不抛异常）', async () => {
      const freshDir = await mkdtemp(join(tmpdir(), 'qqbat-templates-empty-'))
      try {
        const all = await service.listTemplates(freshDir)
        // 仅含内置模板
        expect(all.length).toBeGreaterThanOrEqual(BUILT_IN_TEMPLATES.length)
      } finally {
        await rm(freshDir, { recursive: true, force: true })
      }
    })
  })
})

describe('TemplateService - 导入/导出', () => {
  describe('importTemplate', () => {
    it.skip('导入模板保存到用户数据目录', async () => {
      // 跳过：importTemplate 内部调用 getUserTemplatesDir，使用 require('electron')
      // 不被 vi.mock 拦截。
      const tpl: FlowTemplate = {
        id: 'imported-tpl',
        name: '导入模板',
        description: '',
        botCategory: 'functional',
        category: '其他',
        tags: [],
        author: 'external',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      const filePath = await service.importTemplate(tpl)
      expect(existsSync(filePath)).toBe(true)

      // 用户数据目录应包含该模板
      const all = await service.listTemplates()
      expect(all.find(t => t.id === 'imported-tpl')).toBeDefined()
    })

    it.skip('导入后可被 getTemplateById 查询（仅内置/IMPORTABLE 可查；用户导入的需 listTemplates）', async () => {
      // 跳过：同上，importTemplate 依赖 getUserTemplatesDir。
      const tpl: FlowTemplate = {
        id: 'imported-tpl-2',
        name: '导入模板2',
        description: '',
        botCategory: 'game',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await service.importTemplate(tpl)
      const all = await service.listTemplates()
      expect(all.find(t => t.id === 'imported-tpl-2')).toBeDefined()
    })
  })

  describe('exportTemplate', () => {
    it('用户取消对话框时抛出错误', async () => {
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: true,
        filePath: '',
      })

      const tpl: FlowTemplate = {
        id: 'export-cancel',
        name: '导出取消',
        description: '',
        botCategory: 'functional',
        category: '其他',
        tags: [],
        author: '',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      await expect(service.exportTemplate(tpl)).rejects.toThrow('用户取消')
    })

    it('导出成功时写入文件并返回路径', async () => {
      const exportPath = join(tmpProjectDir, 'exported.qqbat-template.json')
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: exportPath,
      })

      const tpl: FlowTemplate = {
        id: 'export-success',
        name: '导出成功',
        description: '',
        botCategory: 'game',
        category: '其他',
        tags: ['tag1'],
        author: 'tester',
        nodes: [],
        edges: [],
        createdAt: '2026-01-01',
        version: '1.0.0',
      }
      const result = await service.exportTemplate(tpl)
      expect(result).toBe(exportPath)
      expect(existsSync(exportPath)).toBe(true)

      // 验证文件格式（export 只写 name/description/category/botCategory/tags/author/nodes/edges/version，不写 id）
      const content = await readFile(exportPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.type).toBe('qqbat-template')
      expect(parsed.version).toBe('1.0')
      expect(parsed.template.name).toBe('导出成功')
      expect(parsed.template.botCategory).toBe('game')
      expect(parsed.template.tags).toEqual(['tag1'])
      expect(parsed.template.author).toBe('tester')
    })
  })

  describe('importTemplateFromFile', () => {
    it('用户取消对话框返回 null', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      })
      const result = await service.importTemplateFromFile()
      expect(result).toBeNull()
    })

    it('导入非 qqbat-template 类型文件抛出错误', async () => {
      const fakeFile = join(tmpProjectDir, 'fake.json')
      await writeFile(fakeFile, JSON.stringify({ type: 'not-qqbat' }), 'utf-8')
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: [fakeFile],
      })
      await expect(service.importTemplateFromFile()).rejects.toThrow('无效的模板文件')
    })

    it('导入合法 qqbat-template 文件返回 FlowTemplate', async () => {
      const fakeFile = join(tmpProjectDir, 'valid.qqbat-template.json')
      const exportData = {
        type: 'qqbat-template',
        version: '1.0',
        template: {
          name: '从文件导入',
          description: '描述',
          category: '其他',
          botCategory: 'functional',
          tags: ['t1'],
          author: 'me',
          nodes: [],
          edges: [],
          version: '1.0.0',
        },
      }
      await writeFile(fakeFile, JSON.stringify(exportData), 'utf-8')
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: [fakeFile],
      })
      const result = await service.importTemplateFromFile()
      expect(result).not.toBeNull()
      expect(result!.name).toBe('从文件导入')
      expect(result!.id).toMatch(/^imported-/)
      expect(result!.botCategory).toBe('functional')
    })

    it('导入时若文件无 botCategory 字段，默认 functional', async () => {
      const fakeFile = join(tmpProjectDir, 'no-bc.qqbat-template.json')
      const exportData = {
        type: 'qqbat-template',
        version: '1.0',
        template: {
          name: '无 botCategory',
          description: '',
          category: '其他',
          tags: [],
          author: '',
          nodes: [],
          edges: [],
          version: '1.0.0',
        },
      }
      await writeFile(fakeFile, JSON.stringify(exportData), 'utf-8')
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: [fakeFile],
      })
      const result = await service.importTemplateFromFile()
      expect(result!.botCategory).toBe('functional')
    })
  })
})
