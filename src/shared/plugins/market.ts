// src/shared/plugins/market.ts
//
// **插件市场索引契约**（2026-10-20）：一份市场索引 = 若干插件 × 若干版本 × 内联文件。
//
// 为什么内联文件而不是给 URL：离线可用、可复现、装之前就能算完哈希；
// 远程闭包（dir/tarball）会引入重定向、压缩炸弹、半装状态，先不做。
//
// 解析是 fail-closed 的：任何路径越界、重复版本、超限大小都整体拒绝。
// 错误文案用英文 —— 主进程与渲染层共用（渲染层有"不许硬编码中文界面文案"的闸门）。
import { PLUGIN_ID_PATTERN, PLUGIN_VERSION_PATTERN } from './manifest'
import { parsePluginVersion, satisfiesPluginRange } from './version'

export const MARKET_FORMAT = 1
export const MARKET_MANIFEST_FILE = 'manifest.json'
export const MARKET_MAX_PLUGINS = 500
export const MARKET_MAX_VERSIONS = 50
export const MARKET_MAX_FILES = 200
export const MARKET_MAX_FILE_BYTES = 2 * 1024 * 1024
export const MARKET_MAX_TOTAL_BYTES = 20 * 1024 * 1024

export interface MarketFile {
  /** 相对安装目录的 POSIX 路径，如 "index.js" */
  path: string
  text: string
}

export interface MarketVersion {
  version: string
  /** 宿主版本范围，交给 satisfiesPluginRange */
  requires?: string
  files: MarketFile[]
}

export interface MarketPlugin {
  id: string
  /** 宿主插件名（AI 插件目录名 = aiPluginIdOf(name)） */
  name: string
  title?: string
  description: string
  author?: string
  versions: MarketVersion[]
}

export interface MarketIndex {
  format: number
  title: string
  description?: string
  plugins: MarketPlugin[]
}

/** 已安装状态（列表用）：版本 + 是否被本地改过 + 目录是否还在 */
export interface MarketInstalledInfo {
  version: string
  modified: boolean
  missing: boolean
}

/** 来源信任级别：official 仅指"随包离线源"，不是密码学校验 */
export type MarketTrust = 'official' | 'community'

/** 安装计划里的单个文件：装之前就能核对的内容指纹 */
export interface MarketPackageFile {
  path: string
  bytes: number
  sha256: string
}

/** manifest 里会影响运行时的声明，安装前展示给用户看 */
export interface MarketManifestSummary {
  name: string
  version: string
  entry: string
  permissions: string[]
  settingCount: number
}

/**
 * 安装前检查结果（不写盘）。version=null 表示没有兼容版本；
 * blocked 非空表示确认也不能装（同版本/本地改过/跨来源/清单坏）。
 */
export interface MarketInstallPlan {
  id: string
  name: string
  title?: string
  description: string
  author?: string
  source: string
  trust: MarketTrust
  /** 市场索引没有签名；这里永远是 false，界面必须如实说 */
  signed: boolean
  version: string | null
  requires?: string
  files: MarketPackageFile[]
  totalBytes: number
  /** 与安装后目录哈希同算法的内容指纹；没有版本时是空串 */
  digest: string
  manifest: MarketManifestSummary | null
  update?: { fromVersion: string; fromSource: string; sameSource: boolean }
  blocked?: string
}

/** 市场列表项（主进程算好兼容性/安装状态，渲染层只展示） */
export interface MarketItem {
  id: string
  name: string
  title?: string
  description: string
  author?: string
  source: string
  /** 宿主可用的最高版本；null = 没有兼容版本 */
  latestVersion: string | null
  /** 索引里存在过的最高版本（即便不兼容），用于界面提示 */
  availableVersion?: string
  requires?: string
  installed?: MarketInstalledInfo
}

export interface MarketSourceInfo {
  source: string
  title?: string
  error?: string
}

export interface MarketListResult {
  plugins: MarketItem[]
  sources: MarketSourceInfo[]
}

export interface MarketInstallInfo {
  id: string
  pluginId: string
  name: string
  version: string
  source: string
  trust: MarketTrust
  signed: boolean
  digest: string
}

export interface MarketParseFailure {
  ok: false
  error: string
}

export type MarketParseResult = { ok: true; value: MarketIndex } | MarketParseFailure

function fail(source: string, path: string, message: string): MarketParseFailure {
  return { ok: false, error: `${source}: ${path}: ${message}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * 安装路径是否安全：只接受 POSIX 相对路径，且不允许空段 / "." / ".." / 反斜杠 / 盘符 / 前导斜杠。
 * 这是防止 zip-slip 的唯一入口 —— 主进程写文件前必须再调一次（防御纵深）。
 */
export function isSafeMarketPath(path: string): boolean {
  if (typeof path !== 'string') return false
  if (path.length === 0 || path.length > 240) return false
  if (path.includes('\\')) return false
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false
  const segments = path.split('/')
  return segments.every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

function optionalString(
  source: string,
  path: string,
  raw: Record<string, unknown>,
  key: string,
): { ok: true; value?: string } | MarketParseFailure {
  const v = raw[key]
  if (v === undefined) return { ok: true }
  if (typeof v !== 'string')
    return { ok: false, error: `${source}: ${path}.${key}: must be a string` }
  return { ok: true, value: v }
}

function parseVersion(
  source: string,
  basePath: string,
  raw: unknown,
): { ok: true; value: MarketVersion } | MarketParseFailure {
  if (!isRecord(raw))
    return { ok: false, error: `${source}: ${basePath}: version entry must be an object` }
  const version = raw.version
  if (typeof version !== 'string' || !PLUGIN_VERSION_PATTERN.test(version)) {
    return fail(source, `${basePath}.version`, 'must be x.y.z')
  }
  const requires = optionalString(source, basePath, raw, 'requires')
  if (!requires.ok) return requires

  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    return fail(source, `${basePath}.files`, 'must be a non-empty array')
  }
  if (raw.files.length > MARKET_MAX_FILES) {
    return fail(source, `${basePath}.files`, `contains more than ${MARKET_MAX_FILES} files`)
  }
  const files: MarketFile[] = []
  const seen = new Set<string>()
  let total = 0
  for (let i = 0; i < raw.files.length; i += 1) {
    const entry = raw.files[i]
    const at = `${basePath}.files[${i}]`
    if (!isRecord(entry)) return fail(source, at, 'file entry must be an object')
    const p = entry.path
    if (typeof p !== 'string' || !isSafeMarketPath(p)) {
      return fail(source, `${at}.path`, 'must be a safe relative POSIX path')
    }
    if (seen.has(p)) return fail(source, `${at}.path`, `duplicate file path "${p}"`)
    seen.add(p)
    if (typeof entry.text !== 'string') return fail(source, at, 'file text must be a string')
    const bytes = utf8Bytes(entry.text)
    if (bytes > MARKET_MAX_FILE_BYTES) {
      return fail(source, `${at}.text`, `exceeds ${MARKET_MAX_FILE_BYTES} bytes`)
    }
    total += bytes
    if (total > MARKET_MAX_TOTAL_BYTES) {
      return fail(source, `${basePath}.files`, `exceeds ${MARKET_MAX_TOTAL_BYTES} bytes in total`)
    }
    files.push({ path: p, text: entry.text })
  }
  if (!seen.has(MARKET_MANIFEST_FILE)) {
    return fail(source, `${basePath}.files`, `must include ${MARKET_MANIFEST_FILE}`)
  }
  return {
    ok: true,
    value: {
      version,
      ...(requires.value !== undefined ? { requires: requires.value } : {}),
      files,
    },
  }
}

function parsePlugin(
  source: string,
  basePath: string,
  raw: unknown,
  seenIds: Set<string>,
): { ok: true; value: MarketPlugin } | MarketParseFailure {
  if (!isRecord(raw))
    return { ok: false, error: `${source}: ${basePath}: plugin entry must be an object` }
  const id = raw.id
  if (typeof id !== 'string' || !PLUGIN_ID_PATTERN.test(id)) {
    return fail(source, `${basePath}.id`, 'is missing or has invalid characters')
  }
  if (seenIds.has(id)) return fail(source, `${basePath}.id`, `duplicate plugin id "${id}"`)
  seenIds.add(id)
  const name = raw.name
  if (typeof name !== 'string' || name.trim() === '') {
    return fail(source, `${basePath}.name`, 'is required')
  }
  if (typeof raw.description !== 'string') {
    return fail(source, `${basePath}.description`, 'is required')
  }
  const title = optionalString(source, basePath, raw, 'title')
  if (!title.ok) return title
  const author = optionalString(source, basePath, raw, 'author')
  if (!author.ok) return author

  if (!Array.isArray(raw.versions) || raw.versions.length === 0) {
    return fail(source, `${basePath}.versions`, 'must be a non-empty array')
  }
  if (raw.versions.length > MARKET_MAX_VERSIONS) {
    return fail(
      source,
      `${basePath}.versions`,
      `contains more than ${MARKET_MAX_VERSIONS} versions`,
    )
  }
  const versions: MarketVersion[] = []
  const seenVersions = new Set<string>()
  for (let i = 0; i < raw.versions.length; i += 1) {
    const parsed = parseVersion(source, `${basePath}.versions[${i}]`, raw.versions[i])
    if (!parsed.ok) return parsed
    if (seenVersions.has(parsed.value.version)) {
      return fail(source, `${basePath}.versions[${i}].version`, 'duplicate version')
    }
    seenVersions.add(parsed.value.version)
    versions.push(parsed.value)
  }
  return {
    ok: true,
    value: {
      id,
      name: name.trim(),
      ...(title.value !== undefined ? { title: title.value } : {}),
      description: raw.description,
      ...(author.value !== undefined ? { author: author.value } : {}),
      versions,
    },
  }
}

/** 严格解析市场索引；任何一处不合格整体拒绝，并给出 source + 字段路径。 */
export function parseMarketIndex(raw: unknown, source: string): MarketParseResult {
  if (!isRecord(raw)) return { ok: false, error: `${source}: $: market index must be an object` }
  if (raw.format !== MARKET_FORMAT) {
    return fail(source, '$.format', `unsupported market format (expected ${MARKET_FORMAT})`)
  }
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    return fail(source, '$.title', 'is required')
  }
  const description = optionalString(source, '$', raw, 'description')
  if (!description.ok) return description
  if (!Array.isArray(raw.plugins)) return fail(source, '$.plugins', 'must be an array')
  if (raw.plugins.length > MARKET_MAX_PLUGINS) {
    return fail(source, '$.plugins', `contains more than ${MARKET_MAX_PLUGINS} plugins`)
  }
  const plugins: MarketPlugin[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.plugins.length; i += 1) {
    const parsed = parsePlugin(source, `$.plugins[${i}]`, raw.plugins[i], seenIds)
    if (!parsed.ok) return parsed
    plugins.push(parsed.value)
  }
  return {
    ok: true,
    value: {
      format: MARKET_FORMAT,
      title: raw.title,
      ...(description.value !== undefined ? { description: description.value } : {}),
      plugins,
    },
  }
}

/** 按语义版本降序挑出宿主可用的最高版本；没有可用版本返回 null。 */
export function latestCompatibleVersion(
  versions: readonly MarketVersion[],
  hostVersion: string,
): MarketVersion | null {
  let best: MarketVersion | null = null
  let bestParsed: [number, number, number] | null = null
  for (const entry of versions) {
    if (!satisfiesPluginRange(hostVersion, entry.requires)) continue
    const parsed = parsePluginVersion(entry.version)
    if (!parsed) continue
    if (!bestParsed || compareVersions(parsed, bestParsed) > 0) {
      best = entry
      bestParsed = parsed
    }
  }
  return best
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}
