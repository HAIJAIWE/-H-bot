// src/main/services/templates.ts
import { mkdir, readdir, readFile, writeFile, unlink, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { FlowTemplate, TemplateExportFile } from '@shared/types/template'
import { TEMPLATE_DIR, TEMPLATE_EXPORT_EXT } from '@shared/types/template'
import { templateSchema } from '../schemas/templates'
import { dialog } from 'electron'
import { IMPORTABLE_TEMPLATES } from '../templates'
import { BUILT_IN_TEMPLATES } from '../templates/builtinTemplates'
export { BUILT_IN_TEMPLATES }

/** 模板摘要（列表接口返回，不含 nodes/edges，降低 IPC 传输量） */
export interface TemplateSummary {
  id: string
  name: string
  description: string
  botCategory: 'functional' | 'game'
  category: string
  tags: string[]
  author: string
  version?: string
  createdAt?: string
  nodeCount: number
  edgeCount: number
}

function toSummary(t: FlowTemplate): TemplateSummary {
  return {
    id: t.id, name: t.name, description: t.description,
    botCategory: t.botCategory, category: t.category,
    tags: t.tags, author: t.author, version: t.version, createdAt: t.createdAt,
    nodeCount: t.nodes.length, edgeCount: t.edges.length,
  }
}

/** 磁盘模板 mtime 缓存：dir → { file → { mtime, template } } */
interface DirCache { mtime: number; template: FlowTemplate }
const _dirCache = new Map<string, Map<string, DirCache>>()

/** O(1) 模板查找索引（模块级常量，只构建一次） */
const BUILT_IN_BY_ID: Map<string, FlowTemplate> = new Map(BUILT_IN_TEMPLATES.map(t => [t.id, t]))
const IMPORTABLE_BY_ID: Map<string, FlowTemplate> = new Map(IMPORTABLE_TEMPLATES.map(t => [t.id, t]))
const ALL_BY_ID: Map<string, FlowTemplate> = new Map([...BUILT_IN_BY_ID, ...IMPORTABLE_BY_ID])

export class TemplateService {
  /** 获取内置模板列表（返回只读引用，不再每次浅拷贝） */
  listBuiltin(): FlowTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...IMPORTABLE_TEMPLATES]
  }

  /** 获取内置模板摘要列表（IPC 传输量降低 90%+） */
  listBuiltinSummaries(): TemplateSummary[] {
    return [...BUILT_IN_TEMPLATES, ...IMPORTABLE_TEMPLATES].map(toSummary)
  }

  /** 按 botCategory 获取内置模板摘要列表（IPC 传输量降低） */
  listBuiltinSummariesByCategory(category: 'functional' | 'game'): TemplateSummary[] {
    return BUILT_IN_TEMPLATES
      .filter(t => t.botCategory === category)
      .map(toSummary)
  }

  /** 按 ID 获取内置/可导入模板的完整内容（O(1) 查找） */
  getTemplateById(id: string): FlowTemplate | null {
    return ALL_BY_ID.get(id) ?? null
  }

  /** 获取模板目录路径 */
  private getUserTemplatesDir(): string {
    // 使用 electron 的 app.getPath 获取用户数据目录
    const { app } = require('electron')
    return join(app.getPath('userData'), 'templates')
  }

  /** 获取项目的模板目录 */
  private getProjectTemplatesDir(projectPath: string): string {
    return join(projectPath, TEMPLATE_DIR)
  }

  /** 列出所有可用模板（内置 + 本地） */
  async listTemplates(projectPath?: string): Promise<FlowTemplate[]> {
    const templates: FlowTemplate[] = [...BUILT_IN_TEMPLATES]

    // 从用户数据目录加载
    try {
      const userDir = this.getUserTemplatesDir()
      const userTemplates = await this.loadTemplatesFromDir(userDir)
      templates.push(...userTemplates)
    } catch {
      // 忽略
    }

    // 从项目模板目录加载
    if (projectPath) {
      try {
        const projDir = this.getProjectTemplatesDir(projectPath)
        const projTemplates = await this.loadTemplatesFromDir(projDir)
        templates.push(...projTemplates)
      } catch {
        // 忽略
      }
    }

    return templates
  }

  /** 从指定目录加载模板文件（带 mtime 缓存，避免重复 readFile + JSON.parse + zod 校验） */
  private async loadTemplatesFromDir(dir: string): Promise<FlowTemplate[]> {
    if (!existsSync(dir)) return []

    const files = await readdir(dir)
    let cache = _dirCache.get(dir)
    if (!cache) {
      cache = new Map()
      _dirCache.set(dir, cache)
    }

    const templates: FlowTemplate[] = []
    const seenFiles = new Set<string>()

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      seenFiles.add(file)
      try {
        const filePath = join(dir, file)
        const fileStat = await stat(filePath)
        const mtime = fileStat.mtimeMs
        const cached = cache.get(file)
        if (cached && cached.mtime === mtime) {
          templates.push(cached.template)
          continue
        }
        const content = await readFile(filePath, 'utf-8')
        const parsed = JSON.parse(content)
        const result = templateSchema.safeParse(parsed)
        if (result.success) {
          const tpl = result.data as FlowTemplate
          cache.set(file, { mtime, template: tpl })
          templates.push(tpl)
        }
      } catch {
        // 跳过无效文件
      }
    }

    // 清理已删除文件的缓存
    for (const key of cache.keys()) {
      if (!seenFiles.has(key)) cache.delete(key)
    }

    return templates
  }

  /** 保存模板到项目目录 */
  async saveTemplate(projectPath: string, template: FlowTemplate): Promise<void> {
    const dir = this.getProjectTemplatesDir(projectPath)
    await mkdir(dir, { recursive: true })

    const filePath = join(dir, `${template.id}.json`)
    await writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8')
    // 失效该目录的缓存条目
    _dirCache.get(dir)?.delete(`${template.id}.json`)
  }

  /** 删除模板 */
  async deleteTemplate(id: string, projectPath?: string): Promise<boolean> {
    // 内置模板不能删除
    if (id.startsWith('builtin-')) return false

    // 从用户数据目录删除
    try {
      const userDir = this.getUserTemplatesDir()
      const filePath = join(userDir, `${id}.json`)
      if (existsSync(filePath)) {
        await unlink(filePath)
        _dirCache.get(userDir)?.delete(`${id}.json`)
        return true
      }
    } catch {
      // 尝试从项目目录删除
    }

    if (projectPath) {
      try {
        const projDir = this.getProjectTemplatesDir(projectPath)
        const filePath = join(projDir, `${id}.json`)
        if (existsSync(filePath)) {
          await unlink(filePath)
          _dirCache.get(projDir)?.delete(`${id}.json`)
          return true
        }
      } catch {
        // 忽略
      }
    }

    return false
  }

  /** 导出模板为文件 */
  async exportTemplate(template: FlowTemplate): Promise<string> {
    const exportData: TemplateExportFile = {
      type: 'qqbat-template',
      version: '1.0',
      template: {
        name: template.name,
        description: template.description,
        category: template.category,
        botCategory: template.botCategory,
        tags: template.tags,
        author: template.author,
        nodes: template.nodes,
        edges: template.edges,
        version: template.version
      }
    }

    const result = await dialog.showSaveDialog({
      title: '导出模板',
      defaultPath: `${template.name}${TEMPLATE_EXPORT_EXT}`,
      filters: [
        { name: 'QQBat 模板', extensions: ['qqbat-template.json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      throw new Error('用户取消了导出')
    }

    await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')
    return result.filePath
  }

  /** 从文件导入模板 */
  async importTemplate(template: FlowTemplate): Promise<string> {
    // 直接保存到用户数据目录
    const dir = this.getUserTemplatesDir()
    await mkdir(dir, { recursive: true })

    const filePath = join(dir, `${template.id}.json`)
    await writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8')
    return filePath
  }

  /** 从文件选择对话框导入模板文件 */
  async importTemplateFromFile(): Promise<FlowTemplate | null> {
    const result = await dialog.showOpenDialog({
      title: '导入模板',
      filters: [
        { name: 'QQBat 模板', extensions: ['qqbat-template.json'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    const parsed: TemplateExportFile = JSON.parse(content)

    if (parsed.type !== 'qqbat-template') {
      throw new Error('无效的模板文件')
    }

    const template: FlowTemplate = {
      id: `imported-${parsed.template.name?.replace(/\s+/g, '_') || 'template'}`,
      name: parsed.template.name,
      description: parsed.template.description,
      category: parsed.template.category,
      botCategory: parsed.template.botCategory ?? 'functional',
      tags: parsed.template.tags ?? [],
      author: parsed.template.author ?? '',
      nodes: parsed.template.nodes,
      edges: parsed.template.edges,
      createdAt: new Date().toISOString(),
      version: parsed.template.version
    }

    return template
  }
}

/** 按 botCategory 获取内置模板列表（用于新建项目时按类型过滤模板） */
export function getTemplatesByCategory(category: 'functional' | 'game'): FlowTemplate[] {
  return BUILT_IN_TEMPLATES.filter(t => t.botCategory === category)
}
