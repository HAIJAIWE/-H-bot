// src/main/services/history.ts
import { mkdir, readdir, readFile, unlink, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'
import { assertWithinProject } from './pathGuard'

export interface HistoryEntry {
  version: string
  timestamp: string
  fileName: string
  filePath: string
  size: number
}

const MAX_VERSIONS = 50

function historyDir(projectPath: string): string {
  return join(projectPath, '.qqbat', 'history')
}

function sanitizeTimestamp(ts: string): string {
  return ts.replace(/[:.]/g, '-')
}

export class HistoryService {
  private baseDir: string = ''

  setBaseDir(dir: string): void {
    this.baseDir = dir
  }

  /** 备份当前 flow.json 到 .qqbat/history/ */
  async backup(projectPath: string, schemaVersion: string = '1.0'): Promise<HistoryEntry> {
    const dir = historyDir(projectPath)
    await mkdir(dir, { recursive: true })

    const ts = new Date().toISOString()
    const fileName = `flow-${sanitizeTimestamp(ts)}.json`
    const filePath = join(dir, fileName)

    const source = join(projectPath, '.qqbat', 'flow.json')

    if (!existsSync(source)) {
      throw new Error('flow.json 不存在，无法备份')
    }

    await copyFile(source, filePath)

    const entry: HistoryEntry = {
      version: schemaVersion,
      timestamp: ts,
      fileName,
      filePath,
      size: (await readFile(filePath)).length
    }

    await this.prune(projectPath)
    return entry
  }

  /** 列出历史版本（按时间倒序） */
  async list(projectPath: string): Promise<HistoryEntry[]> {
    const dir = historyDir(projectPath)
    if (!existsSync(dir)) return []

    const files = await readdir(dir)
    const historyFiles = files.filter((f) => f.startsWith('flow-') && f.endsWith('.json')).sort().reverse()

    const entries: HistoryEntry[] = []
    for (const f of historyFiles) {
      const fp = join(dir, f)
      const stats = await readFile(fp)
      // 从文件名提取时间
      const tsStr = f.replace('flow-', '').replace(/\.json$/, '').replace(/-/g, ':').replace(/\./g, '.')
      entries.push({
        version: '1.0',
        timestamp: tsStr.replace(/T/, ' ').replace(/\.\d+Z/, ''),
        fileName: f,
        filePath: fp,
        size: stats.length
      })
    }

    return entries
  }

  /** 从历史版本恢复 */
  async restore(projectPath: string, fileName: string): Promise<void> {
    if (this.baseDir) assertWithinProject(this.baseDir, projectPath)

    const dir = historyDir(projectPath)
    // 严格校验 fileName：必须规范化后仍在 history 目录内（防止 `../history_evil/` 前缀攻击）
    const backupFile = resolve(dir, fileName)
    const rel = relative(dir, backupFile)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`非法文件路径: ${fileName}`)
    }

    if (!existsSync(backupFile)) {
      throw new Error(`历史版本不存在: ${fileName}`)
    }

    // 先备份当前的 flow.json
    try {
      await this.backup(projectPath)
    } catch {
      // 当前可能没有 flow.json，忽略
    }

    // 恢复历史版
    const target = join(projectPath, '.qqbat', 'flow.json')
    await copyFile(backupFile, target)
  }

  /** 读某个历史版本的 JSON 内容 */
  async read(projectPath: string, fileName: string): Promise<string> {
    const dir = historyDir(projectPath)
    const filePath = resolve(dir, fileName)
    // 严格校验：规范化后必须在 history 目录内
    const rel = relative(dir, filePath)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`非法文件路径: ${fileName}`)
    }
    return await readFile(filePath, 'utf-8')
  }

  /** 清理超出版本限制的历史文件 */
  async prune(projectPath: string): Promise<void> {
    const dir = historyDir(projectPath)
    if (!existsSync(dir)) return

    const files = (await readdir(dir))
      .filter((f) => f.startsWith('flow-') && f.endsWith('.json'))
      .sort()
      .reverse()

    if (files.length <= MAX_VERSIONS) return

    const toDelete = files.slice(MAX_VERSIONS)
    for (const f of toDelete) {
      try { await unlink(join(dir, f)) } catch { /* ignore */ }
    }
  }
}

export const historyService = new HistoryService()
