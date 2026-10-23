// src/main/services/fileOps.ts
import { readFile, writeFile, rename, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { assertWithinProject } from './pathGuard'

export interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export async function readProjectFile(projectPath: string, relativePath: string): Promise<string> {
  const fullPath = joinSafe(projectPath, relativePath)
  return readFile(fullPath, 'utf-8')
}

export async function writeProjectFile(projectPath: string, relativePath: string, content: string): Promise<void> {
  const fullPath = joinSafe(projectPath, relativePath)
  await writeFile(fullPath, content, 'utf-8')
}

/**
 * 原子写入：先写 .tmp 临时文件，再 rename 替换目标文件。
 *
 * 保证写入操作的原子性，避免因进程崩溃或异常导致目标文件被写一半。
 * rename 在同一文件系统上是原子的（POSIX/Windows 均保证）。
 *
 * @param filePath 目标文件绝对路径
 * @param content 文件内容（UTF-8 编码）
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, filePath)
}

export async function listProjectFiles(projectPath: string, relativeDir: string = ''): Promise<FileInfo[]> {
  const fullPath = joinSafe(projectPath, relativeDir)
  const entries = await readdir(fullPath, { withFileTypes: true })
  const results: FileInfo[] = []
  for (const entry of entries) {
    const rel = relativeDir ? join(relativeDir, entry.name) : entry.name
    const full = join(fullPath, entry.name)
    const s = await stat(full)
    results.push({ name: entry.name, path: rel, isDirectory: entry.isDirectory(), size: s.size })
  }
  return results.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
}

function joinSafe(projectPath: string, relativePath: string): string {
  assertWithinProject(projectPath, relativePath)
  return join(projectPath, relativePath)
}
