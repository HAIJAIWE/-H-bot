import fs from 'fs/promises'
import path from 'path'
import { isWithinProject } from './pathGuard'
import { logger } from './logger'

const MAX_BACKUPS = 100

/**
 * 校验备份名必须在项目 backups 目录内（防止 `..` 路径穿越）。
 * 备份名只允许字母/数字/下划线/横线/点，且不得包含路径分隔符。
 */
function assertSafeBackupName(projectPath: string, backupName: string): void {
  if (!backupName || typeof backupName !== 'string') {
    throw new Error('备份名不能为空')
  }
  // 仅允许文件名（无路径分隔符、无 `..`）
  if (/[\\/]/.test(backupName) || backupName === '.' || backupName === '..') {
    throw new Error(`非法备份名: ${backupName}`)
  }
  const backupDir = path.join(projectPath, 'data', 'backups')
  const backupPath = path.join(backupDir, backupName)
  if (!isWithinProject(backupDir, backupPath)) {
    throw new Error(`路径越界：${backupName} 不在备份目录内`)
  }
}

export async function createBackup(projectPath: string, dbPath: string, description: string): Promise<string | null> {
  try {
    await fs.access(dbPath)
  } catch (e) {
    logger.warn('[backupService] 读取备份目录失败:', e)
    return null
  }
  const backupDir = path.join(projectPath, 'data', 'backups')
  await fs.mkdir(backupDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${path.basename(dbPath)}_${timestamp}.bak`
  const backupPath = path.join(backupDir, backupName)
  await fs.copyFile(dbPath, backupPath)
  // 记录备份元数据
  const stat = await fs.stat(dbPath)
  const metaPath = backupPath + '.meta.json'
  await fs.writeFile(metaPath, JSON.stringify({ original: dbPath, time: timestamp, description, size: stat.size }))
  // 清理旧备份
  await cleanupOldBackups(backupDir)
  return backupPath
}

export async function listBackups(projectPath: string): Promise<{ name: string; time: string; description: string; size: number }[]> {
  const backupDir = path.join(projectPath, 'data', 'backups')
  try {
    await fs.access(backupDir)
  } catch (e) {
    logger.warn('[backupService] 列出备份失败:', e)
    return []
  }
  const allFiles = await fs.readdir(backupDir)
  const metaFiles = allFiles.filter(f => f.endsWith('.meta.json'))
  const entries = await Promise.all(metaFiles.map(async (f) => {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(backupDir, f), 'utf-8'))
      return { name: f.replace('.meta.json', ''), time: meta.time, description: meta.description, size: meta.size }
    } catch (e) {
      // meta 文件损坏时跳过，但记录警告
      logger.warn(`[backupService] meta 文件解析失败: ${f}`, e)
      return null
    }
  }))
  return entries
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b.time.localeCompare(a.time))
}

export async function restoreBackup(projectPath: string, backupName: string): Promise<boolean> {
  // 校验备份名，防止路径穿越攻击
  assertSafeBackupName(projectPath, backupName)
  const backupDir = path.join(projectPath, 'data', 'backups')
  const backupPath = path.join(backupDir, backupName)
  const metaPath = backupPath + '.meta.json'
  try {
    await fs.access(backupPath)
    await fs.access(metaPath)
  } catch (e) {
    logger.warn('[backupService] 读取备份失败:', e)
    return false
  }
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
  // 关键安全校验：meta.original 必须在项目内（防止伪造 meta 写入任意路径）
  // meta.original 形如 /project/data/players.db
  if (typeof meta.original !== 'string' || !isWithinProject(projectPath, meta.original)) {
    throw new Error(`备份元数据中的目标路径越界: ${meta.original}`)
  }
  await fs.copyFile(backupPath, meta.original)
  return true
}

export async function createSnapshot(projectPath: string, name?: string): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const snapshotName = name ? `${name}_${dateStr}` : `snapshot_${dateStr}`
  // 每个快照独立子目录，便于包含多个数据库文件
  const snapshotDir = path.join(projectPath, 'data', 'backups', snapshotName)
  await fs.mkdir(snapshotDir, { recursive: true })

  // 递归复制项目 data/ 下所有 .db/.sqlite 文件到快照目录（保持相对路径结构）
  const dataDir = path.join(projectPath, 'data')
  const backupsDir = path.join(dataDir, 'backups') // 排除备份目录自身，避免递归复制
  const copiedFiles: string[] = []
  await copyDbFiles(dataDir, snapshotDir, dataDir, backupsDir, copiedFiles)

  // 写快照标识文件，记录元数据（含复制的文件清单）
  await fs.writeFile(
    path.join(snapshotDir, 'snapshot.meta.json'),
    JSON.stringify({ time: new Date().toISOString(), projectPath, files: copiedFiles })
  )
  return snapshotDir
}

/**
 * 递归复制 .db/.sqlite 文件到目标目录，保持相对 dataRoot 的路径结构。
 * 排除 backupsDir（避免递归复制快照自身）。
 */
async function copyDbFiles(
  currentDir: string,
  destDir: string,
  dataRoot: string,
  backupsDir: string,
  copiedFiles: string[]
): Promise<void> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    // 跳过 backups 目录，避免递归复制快照
    if (fullPath === backupsDir) continue
    if (entry.isDirectory()) {
      await copyDbFiles(fullPath, destDir, dataRoot, backupsDir, copiedFiles)
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase()
      if (lower.endsWith('.db') || lower.endsWith('.sqlite')) {
        const relPath = path.relative(dataRoot, fullPath)
        const destPath = path.join(destDir, relPath)
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.copyFile(fullPath, destPath)
        copiedFiles.push(relPath)
      }
    }
  }
}

async function cleanupOldBackups(backupDir: string): Promise<void> {
  const allFiles = await fs.readdir(backupDir)
  let metaFiles = allFiles.filter(f => f.endsWith('.meta.json')).sort()
  while (metaFiles.length > MAX_BACKUPS) {
    const oldest = metaFiles.shift()!
    const baseName = oldest.replace('.meta.json', '')
    try { await fs.unlink(path.join(backupDir, oldest)) } catch (e) { logger.warn(`[backupService] 删除旧备份 meta 失败: ${oldest}`, e) }
    try { await fs.unlink(path.join(backupDir, baseName)) } catch (e) { logger.warn(`[backupService] 删除旧备份文件失败: ${baseName}`, e) }
  }
}