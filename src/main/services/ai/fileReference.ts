// src/main/services/ai/fileReference.ts
//
// `@` 引用的检索（第 58 批，语义对照 DSH `dsh-file-reference`）。
//
// 两条路径，与上游同构：
//   * query 含 `/`（或为空）：**live 列目录**，不建索引、不递归。用户打 `src/ma` 时
//     他已经在指路了，读一个目录就够；
//   * query 不含 `/`：有界索引（`maxEntries`）+ 五档打分（全等/前缀/包含/全路径包含/子序列）。
//     刚打 `@` 时 query 为空、全部 0 分，于是退化成"目录在前、按名字排"的稳定列表。
//
// 打分**完全确定**：没有随机、没有 mtime 衰减、没有 frecency —— 同一份文件树、同一个
// 查询永远同一个顺序。上游注释里强调过这点，本仓照抄（可复现比"聪明"重要）。
//
// 越界防护：路径段命中 `ALWAYS_FORBIDDEN_SEGMENT_NAMES`（.git / node_modules / .dev-backups）
// 与构建产物目录一律跳过；符号链接目录**永不跟随**（否则一个指向 `C:\` 的链接就能把索引撑爆）。

import { existsSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { ALWAYS_FORBIDDEN_SEGMENT_NAMES, assertWithinProject, joinSafe } from '../infra/pathGuard'
import {
  FILE_REFERENCE_MAX_RESULTS,
  parseFileReferenceMentions,
  type FileReference,
} from '@shared/ai/fileReference'

/** 索引条目上限（上游 5e4；本仓按 2e4，理由：再大一轮 GC 就上百毫秒，用户只是打个 @） */
const MAX_INDEX_ENTRIES = 20_000
/** 索引缓存时长：AGENT 每轮可能连续几次 @ 检索，3 秒内复用同一份快照 */
const INDEX_TTL_MS = 3_000

/** 不参与检索的目录名（按 basename 匹配，不是路径前缀 —— 与上游一致） */
const EXCLUDED_DIRECTORIES = new Set<string>([
  ...ALWAYS_FORBIDDEN_SEGMENT_NAMES,
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  '.gradle',
])

interface IndexSnapshot {
  at: number
  entries: FileReference[]
}

const indexCache = new Map<string, IndexSnapshot>()

/** 清索引（写完文件后主动失效；参数省略 = 全清，测试用） */
export function invalidateFileReferenceIndex(projectPath?: string): void {
  if (projectPath === undefined) indexCache.clear()
  else indexCache.delete(projectPath)
}

/** 把 Win32 分隔符归一成 `/`（下游一律用正斜杠比较与展示） */
function normalizeQuery(raw: string): string {
  return raw.replaceAll('\\', '/')
}

function toPosix(absolute: string): string {
  return absolute.split('\\').join('/')
}

function hasExcludedSegment(path: string): boolean {
  return path.split('/').some(segment => EXCLUDED_DIRECTORIES.has(segment))
}

/**
 * `@src/ma` 里的目录部分 → 绝对路径。
 *
 * 三道闸：相对路径不能以 `..` 逃出工作区；逐段 `lstat` 必须是真目录且**不是符号链接**；
 * 任何异常静默返回 null（检索失败不该让菜单弹红字，空列表就是正确表现）。
 */
async function resolveDirectory(
  projectPath: string,
  displayDirectory: string,
): Promise<string | null> {
  const trimmed = displayDirectory.replace(/\/+$/u, '')
  if (hasExcludedSegment(trimmed)) return null
  const absolute = join(projectPath, trimmed)
  const fromRoot = relative(projectPath, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${'\\'}`) || isAbsolute(fromRoot)) return null
  try {
    const status = await lstat(absolute)
    if (status.isSymbolicLink() || !status.isDirectory()) return null
  } catch {
    return null
  }
  return absolute
}

/** live 列目录：`@src/ma` → 列出 `src/` 下以 `ma` 开头的条目 */
async function listDirectory(
  projectPath: string,
  displayDirectory: string,
  fragment: string,
  limit: number,
): Promise<FileReference[]> {
  const absolute = await resolveDirectory(projectPath, displayDirectory)
  if (absolute === null) return []
  const needle = fragment.toLowerCase()
  const atHidden = needle.startsWith('.')
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return []
  }
  const results: FileReference[] = []
  for (const entry of entries) {
    // 隐藏文件只在用户自己打了 `.` 之后才出现（上游同口径）
    if (entry.name.startsWith('.') && !atHidden) continue
    if (!entry.name.toLowerCase().startsWith(needle)) continue
    const isDirectory = entry.isDirectory()
    // 符号链接一律不跟随（`lstat` 语义：isDirectory() 为 false，但这里显式跳过）
    if (entry.isSymbolicLink()) continue
    if (isDirectory && EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const path = `${displayDirectory}${displayDirectory.endsWith('/') || displayDirectory === '' ? '' : '/'}${entry.name}`
    results.push({ path: toPosix(path), kind: isDirectory ? 'directory' : 'file' })
  }
  results.sort((a, b) =>
    a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'directory' ? -1 : 1,
  )
  return results.slice(0, limit)
}

/** 无界索引（有上限）：BFS 遍历整棵工作区，跳过排除目录与符号链接 */
async function buildIndex(projectPath: string): Promise<FileReference[]> {
  const entries: FileReference[] = []
  const queue: string[] = ['']
  while (queue.length > 0 && entries.length < MAX_INDEX_ENTRIES) {
    const dir = queue.shift() as string
    let children
    try {
      children = await readdir(dir === '' ? projectPath : join(projectPath, dir), {
        withFileTypes: true,
      })
    } catch {
      continue
    }
    for (const child of children) {
      if (entries.length >= MAX_INDEX_ENTRIES) break
      if (child.isSymbolicLink()) continue
      const path = dir === '' ? child.name : `${dir}/${child.name}`
      if (child.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(child.name)) continue
        entries.push({ path, kind: 'directory' })
        queue.push(path)
      } else if (child.isFile()) {
        entries.push({ path, kind: 'file' })
      }
    }
  }
  return entries
}

async function indexFor(projectPath: string): Promise<FileReference[]> {
  const cached = indexCache.get(projectPath)
  const now = Date.now()
  if (cached && now - cached.at < INDEX_TTL_MS) return cached.entries
  const entries = await buildIndex(projectPath)
  indexCache.set(projectPath, { at: now, entries })
  return entries
}

/** 子序列命中：按"中间跳过了多少字符"给分（全等/前缀/包含已在前几档拿走了） */
function subsequenceScore(target: string, query: string): number | undefined {
  let targetIndex = 0
  let gap = 0
  for (const character of query) {
    const found = target.indexOf(character, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return Math.max(0, 100 - gap)
}

/** 五档打分（数值与上游一致：1000/900/700/500/300+子序列，目录 +25） */
function scoreCandidate(candidate: FileReference, query: string): number | undefined {
  if (query === '') return 0
  const path = candidate.path.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needle = query.toLowerCase()
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0
  if (name === needle) return 1_000 + directoryBonus
  if (name.startsWith(needle)) return 900 + directoryBonus
  if (name.includes(needle)) return 700 + directoryBonus
  if (path.includes(needle)) return 500 + directoryBonus
  const subsequence = subsequenceScore(path, needle)
  return subsequence === undefined ? undefined : 300 + subsequence + directoryBonus
}

/** 全局检索时隐藏 `@` 目录段（用户打了 `.` 才显示） */
function visibleForGlobalQuery(path: string, query: string): boolean {
  if (query.startsWith('.') || query.includes('/.')) return true
  return !path.split('/').some(segment => segment.startsWith('.'))
}

function rankCandidates(
  candidates: FileReference[],
  query: string,
  limit: number,
): FileReference[] {
  const ranked: Array<{ candidate: FileReference; score: number }> = []
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query)
    if (score !== undefined) ranked.push({ candidate, score })
  }
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      (left.candidate.kind === right.candidate.kind
        ? 0
        : left.candidate.kind === 'directory'
          ? -1
          : 1) ||
      (query === '' ? 0 : left.candidate.path.length - right.candidate.path.length) ||
      left.candidate.path.localeCompare(right.candidate.path),
  )
  return ranked.slice(0, limit).map(entry => entry.candidate)
}

/**
 * 检索候选。
 *
 * `limit` 夹在 1..50：调用方（IPC）可能传更大的值，多给没用 —— 菜单一屏就 20 行。
 * `baseDir`：框架开发模式下调用方会把"框架根"当护栏基准传进来（与 file:* 其余通道同源）；
 * 给了就先断言 `projectPath` 在这条基准之内，越界的项目路径直接抛（和别的文件通道一致）。
 */
export async function searchFileReferences(
  projectPath: string,
  rawQuery: string,
  limit: number = FILE_REFERENCE_MAX_RESULTS,
  baseDir?: string,
): Promise<FileReference[]> {
  if (baseDir) assertWithinProject(baseDir, projectPath)
  const cap = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 0 || 1, 50))
  const query = normalizeQuery(rawQuery)
  const slash = query.lastIndexOf('/')
  if (query === '' || slash >= 0) {
    const directory = slash < 0 ? '' : query.slice(0, slash + 1)
    const fragment = slash < 0 ? '' : query.slice(slash + 1)
    return listDirectory(projectPath, directory, fragment, cap)
  }
  const entries = await indexFor(projectPath)
  const visible = entries.filter(candidate => visibleForGlobalQuery(candidate.path, query))
  return rankCandidates(visible, query, cap)
}

/**
 * 用户这一句里 `@` 了、但工作区里**并不存在**的路径，整理成一段给模型的提示。
 *
 * 为什么要有它：`@` 只是把路径写进句子里（不塞内容），模型看到 `@src/utl.ts`
 * 会直接去 `read_file`，打错一个字母就是白烧一轮；而"文件不存在"这件事
 * **在这边就能知道**，不必让模型去试。存在但不该读（越界/禁止目录）的不提 ——
 * 那种情况 `read_file` 自己会给出越界错误，说多了反而像在教它绕过护栏。
 *
 * @returns 没有可提的内容时返回空串（调用方按空串跳过，别在提示里留空段）
 */
export function describeMissingFileReferences(projectPath: string, text: string, max = 5): string {
  const mentions = parseFileReferenceMentions(text)
  if (mentions.length === 0) return ''
  const missing: string[] = []
  for (const reference of mentions) {
    // 越界/绝对路径/禁止目录：交给 read_file 的护栏报错，不在这里预告
    let full: string | null = null
    try {
      full = joinSafe(projectPath, reference.path)
    } catch {
      continue
    }
    if (!existsSync(full) && !missing.includes(reference.path)) missing.push(reference.path)
    if (missing.length >= max) break
  }
  if (missing.length === 0) return ''
  return [
    '用户这句里 `@` 到的下列路径在工作区里**不存在**（可能是打错字）：',
    ...missing.map(path => '- ' + path),
    '先说清找不到，再问他要的是哪个文件 —— 不要凭猜读别的文件当成它。',
  ].join('\n')
}
