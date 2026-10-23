// src/main/services/configTemplateService.ts
// 分层配置模板服务：按 botType + templateId 选择配置层并初始化项目配置表
// 三层架构：通用层(所有bot) → 玩法层(botCategory=game) → 模板层(特定templateId)

import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { createConfigTableWithSeed } from './configService'
import { invalidateDb } from './dataService'
import type { ConfigTableTemplate, ConfigFieldDefinition } from '@shared/types/configTemplate'
import type { FieldDefinition } from './configService'

/** 配置模板根目录（相对项目 src/main） */
const CONFIG_TEMPLATES_DIR = join(__dirname, '..', 'templates', 'configTemplates')

/**
 * templateId → 模板层子目录名映射
 * 注意：templateId 与目录名不一致（builtin-cultivation → cultivation）
 */
const TEMPLATE_ID_TO_LAYER: Record<string, string> = {
  'builtin-cultivation': 'cultivation',
  'gameplay-wuxia': 'wuxia',
  'gameplay-card': 'card',
  'gameplay-management': 'management',
}

/** 将 ConfigFieldDefinition 转为 configService.FieldDefinition（结构兼容，类型断言即可） */
function toFieldDefinition(f: ConfigFieldDefinition): FieldDefinition {
  return f as FieldDefinition
}

/** 加载某个层目录下的所有配置模板 JSON */
async function loadLayerTemplates(layerName: string): Promise<ConfigTableTemplate[]> {
  const dir = join(CONFIG_TEMPLATES_DIR, layerName)
  if (!existsSync(dir)) return []

  const files = await readdir(dir)
  const templates: ConfigTableTemplate[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const filePath = join(dir, file)
      const content = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content) as ConfigTableTemplate
      if (parsed.tableName && parsed.displayName && Array.isArray(parsed.fields)) {
        templates.push(parsed)
      }
    } catch {
      // 跳过无效 JSON
    }
  }
  return templates
}

/**
 * 为新项目初始化配置表
 * 按 botType + templateId 选择层并建表+种子数据
 *
 * 层级选择规则：
 *   - 通用层（common）：所有 bot 都初始化
 *   - 玩法层（game）：仅 botType='game' 时初始化
 *   - 模板层：按 templateId 映射到 cultivation/wuxia/card/management 子目录
 *
 * @param projectPath 项目根路径
 * @param botType 项目类型
 * @param templateId 玩法模板 ID（可选）
 * @returns 初始化结果摘要
 */
export async function initProjectConfigTables(
  projectPath: string,
  botType: 'functional' | 'game',
  templateId?: string
): Promise<{
  createdTables: string[]
  failedTables: { tableName: string; error: string }[]
  totalInsertedRows: number
}> {
  const createdTables: string[] = []
  const failedTables: { tableName: string; error: string }[] = []
  let totalInsertedRows = 0

  // 收集需要应用的配置模板（按层顺序：common → game → templateSpecific）
  const templatesToApply: ConfigTableTemplate[] = []
  const seenTableNames = new Set<string>()

  // 1. 通用层（所有 bot）
  const commonTemplates = await loadLayerTemplates('common')
  for (const t of commonTemplates) {
    if (!seenTableNames.has(t.tableName)) {
      templatesToApply.push(t)
      seenTableNames.add(t.tableName)
    }
  }

  // 2. 玩法层（仅 game 类）
  if (botType === 'game') {
    const gameTemplates = await loadLayerTemplates('game')
    for (const t of gameTemplates) {
      if (!seenTableNames.has(t.tableName)) {
        templatesToApply.push(t)
        seenTableNames.add(t.tableName)
      }
    }
  }

  // 3. 模板层（按 templateId 映射）
  if (templateId && TEMPLATE_ID_TO_LAYER[templateId]) {
    const layerName = TEMPLATE_ID_TO_LAYER[templateId]
    const layerTemplates = await loadLayerTemplates(layerName)
    for (const t of layerTemplates) {
      if (!seenTableNames.has(t.tableName)) {
        templatesToApply.push(t)
        seenTableNames.add(t.tableName)
      }
    }
  }

  // 逐个建表 + 插入种子数据
  for (const template of templatesToApply) {
    try {
      const result = createConfigTableWithSeed(
        projectPath,
        template.displayName,
        template.fields.map(toFieldDefinition),
        template.seedRows
      )
      // 关闭数据库连接，避免文件锁
      invalidateDb(result.filePath)
      createdTables.push(template.tableName)
      totalInsertedRows += result.insertedRows
    } catch (e) {
      failedTables.push({
        tableName: template.tableName,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  return { createdTables, failedTables, totalInsertedRows }
}

/**
 * 列出某个层目录下的配置模板摘要（用于 UI 展示）
 */
export async function listLayerTemplates(layerName: string): Promise<
  { tableName: string; displayName: string; fieldCount: number; seedRowCount: number }[]
> {
  const templates = await loadLayerTemplates(layerName)
  return templates.map(t => ({
    tableName: t.tableName,
    displayName: t.displayName,
    fieldCount: t.fields.length,
    seedRowCount: t.seedRows?.length ?? 0
  }))
}

/**
 * 预览某次项目创建会初始化哪些配置表（不实际建表）
 */
export async function previewConfigTables(
  botType: 'functional' | 'game',
  templateId?: string
): Promise<{ layer: string; tableName: string; displayName: string; seedRowCount: number }[]> {
  const result: { layer: string; tableName: string; displayName: string; seedRowCount: number }[] = []
  const seen = new Set<string>()

  // 通用层
  const common = await loadLayerTemplates('common')
  for (const t of common) {
    if (!seen.has(t.tableName)) {
      result.push({ layer: 'common', tableName: t.tableName, displayName: t.displayName, seedRowCount: t.seedRows?.length ?? 0 })
      seen.add(t.tableName)
    }
  }

  // 玩法层
  if (botType === 'game') {
    const game = await loadLayerTemplates('game')
    for (const t of game) {
      if (!seen.has(t.tableName)) {
        result.push({ layer: 'game', tableName: t.tableName, displayName: t.displayName, seedRowCount: t.seedRows?.length ?? 0 })
        seen.add(t.tableName)
      }
    }
  }

  // 模板层
  if (templateId && TEMPLATE_ID_TO_LAYER[templateId]) {
    const layerName = TEMPLATE_ID_TO_LAYER[templateId]
    const layerTemplates = await loadLayerTemplates(layerName)
    for (const t of layerTemplates) {
      if (!seen.has(t.tableName)) {
        result.push({ layer: layerName, tableName: t.tableName, displayName: t.displayName, seedRowCount: t.seedRows?.length ?? 0 })
        seen.add(t.tableName)
      }
    }
  }

  return result
}

/** 仅供测试：获取配置模板根目录 */
export function _getConfigTemplatesDir(): string {
  return CONFIG_TEMPLATES_DIR
}
