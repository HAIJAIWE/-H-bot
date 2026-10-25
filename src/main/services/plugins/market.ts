// src/main/services/plugins/market.ts
//
// **插件市场**（2026-10-20）：把"发现 → 下载 → 校验 → 装载 → 卸载/恢复"收成一条链。
//
// 目录布局（userData/market，纯 Node/测试可传 root 覆盖）：
//   sources.json     用户添加的来源（官方离线源恒在最前，不可删）
//   installed.json   已安装记录（id/name/version/requires/source/sha256/installedAt）
//   plugins/<id>/    安装目录（文件来自索引内联文本，路径已逐条校验）
//
// 为什么记录 sha256：市场装进来的代码和用户手改过的代码必须能区分 —— 否则"更新"
// 会静默覆盖本地修改。恢复（启动时）也只加载哈希对得上的目录，被改过的标记 changed
// 但不加载，让用户自己决定是卸载还是保留。
//
// 为什么所有安装/卸载串行：installed.json 是单文件读改写，并发安装会互相覆盖记录。
import { createHash } from 'crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'
import { app } from 'electron'
import {
  MARKET_MANIFEST_FILE,
  isSafeMarketPath,
  latestCompatibleVersion,
  parseMarketIndex,
  type MarketFile,
  type MarketIndex,
  type MarketInstallInfo,
  type MarketInstallPlan,
  type MarketItem,
  type MarketListResult,
  type MarketPlugin,
  type MarketSourceInfo,
  type MarketTrust,
  type MarketVersion,
} from '@shared/plugins/market'
import { normalizeSettingSpecs } from '@shared/plugins/settings'
import { validatePluginIdentity } from '@shared/plugins/manifest'
import { userDataPath } from '../infra/paths'
import { BUNDLED_MARKET_INDEX, BUNDLED_SOURCE } from './marketBundledIndex'
import {
  aiPluginIdOf,
  aiPluginPermissionsOf,
  loadAiPluginPackage,
  setAiPluginEnabledByName,
  unloadAiPluginByName,
  type AiPluginManifestFile,
} from './aiPluginLoader'
import { MAIN_PLUGIN_HOST_VERSION } from './host'

export const MARKET_STATE_FORMAT = 1
export const MARKET_MAX_SOURCES = 20
const FETCH_TIMEOUT_MS = 15_000
const MAX_INDEX_BYTES = 32 * 1024 * 1024
const SOURCES_FILE = 'sources.json'
const INSTALLED_FILE = 'installed.json'
const PLUGINS_DIR = 'plugins'

export interface MarketRecord {
  id: string
  name: string
  version: string
  requires?: string
  source: string
  /** 老记录没有这一项：读盘时按来源回落（bundled 才算 official） */
  trust: MarketTrust
  /** 市场索引没有签名，这里只能是 false */
  signed: boolean
  sha256: string
  installedAt: string
}

export type MarketResult<T> = { ok: true; value: T } | { ok: false; error: string }

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 市场根目录；显式 root 优先（测试），否则 userData/market */
function marketRoot(root?: string): string {
  if (root) return root
  const dir = userDataPath('market', app)
  if (!dir) throw new Error('市场目录不可用：不是 Electron 主进程，也没有 QQBAT_USER_DATA_DIR')
  return dir
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(text)
    return parsed as T
  } catch {
    return fallback
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// installed.json 读改写串行化：并发安装会丢记录（见文件头注释）
let marketQueue: Promise<unknown> = Promise.resolve()
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = marketQueue.then(task, task)
  marketQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readSources(root: string): Promise<string[]> {
  const raw = await readJson<unknown>(join(root, SOURCES_FILE), null)
  if (!isRecord(raw) || !Array.isArray(raw.sources)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw.sources) {
    if (typeof entry !== 'string' || entry.trim() === '') continue
    if (entry === BUNDLED_SOURCE || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out.slice(0, MARKET_MAX_SOURCES)
}

async function writeSources(root: string, sources: readonly string[]): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, SOURCES_FILE),
    JSON.stringify({ format: MARKET_STATE_FORMAT, sources }, null, 2),
    'utf8',
  )
}

async function readInstalled(root: string): Promise<MarketRecord[]> {
  const raw = await readJson<unknown>(join(root, INSTALLED_FILE), null)
  if (!isRecord(raw) || !Array.isArray(raw.installs)) return []
  const out: MarketRecord[] = []
  for (const entry of raw.installs) {
    if (!isRecord(entry)) continue
    if (
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.version !== 'string' ||
      typeof entry.source !== 'string' ||
      typeof entry.sha256 !== 'string'
    ) {
      continue
    }
    out.push({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      ...(typeof entry.requires === 'string' ? { requires: entry.requires } : {}),
      source: entry.source,
      trust:
        entry.trust === 'official' || entry.trust === 'community'
          ? entry.trust
          : entry.source === BUNDLED_SOURCE
            ? 'official'
            : 'community',
      signed: entry.signed === true,
      sha256: entry.sha256,
      installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : '',
    })
  }
  return out
}

async function writeInstalled(root: string, records: readonly MarketRecord[]): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, INSTALLED_FILE),
    JSON.stringify({ format: MARKET_STATE_FORMAT, installs: records }, null, 2),
    'utf8',
  )
}

/** 接受的来源：http(s) URL 或本地路径；拒绝其他协议与 "bundled:" 保留前缀 */
export function normalizeMarketSource(raw: string): string | null {
  const source = String(raw ?? '').trim()
  if (!source || source.length > 500) return null
  if (/^bundled:/i.test(source)) return null
  if (/^https?:\/\//i.test(source)) {
    try {
      new URL(source)
      return source
    } catch {
      return null
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return null
  return source
}

export async function listMarketSources(root?: string): Promise<string[]> {
  const base = marketRoot(root)
  return [BUNDLED_SOURCE, ...(await readSources(base))]
}

async function readSourceIndex(
  source: string,
): Promise<{ ok: true; index: MarketIndex } | { ok: false; error: string }> {
  if (source === BUNDLED_SOURCE) {
    const parsed = parseMarketIndex(BUNDLED_MARKET_INDEX, source)
    return parsed.ok ? { ok: true, index: parsed.value } : { ok: false, error: parsed.error }
  }
  let raw: unknown
  if (/^https?:\/\//i.test(source)) {
    try {
      const res = await fetch(source, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > MAX_INDEX_BYTES) return { ok: false, error: 'market index is too large' }
      const text = await res.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES) {
        return { ok: false, error: 'market index is too large' }
      }
      raw = JSON.parse(text)
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  } else {
    try {
      raw = JSON.parse(await readFile(source, 'utf8'))
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  }
  const parsed = parseMarketIndex(raw, source)
  return parsed.ok ? { ok: true, index: parsed.value } : { ok: false, error: parsed.error }
}

interface CollectedEntry {
  source: string
  plugin: MarketPlugin
}

async function collectMarketEntries(base: string): Promise<{
  entries: CollectedEntry[]
  sources: MarketSourceInfo[]
}> {
  const sources = await listMarketSources(base)
  const entries: CollectedEntry[] = []
  const seen = new Set<string>()
  const infos: MarketSourceInfo[] = []
  for (const source of sources) {
    const result = await readSourceIndex(source)
    if (!result.ok) {
      infos.push({ source, error: result.error })
      continue
    }
    infos.push({ source, title: result.index.title })
    for (const plugin of result.index.plugins) {
      // 官方离线源在最前：同 id 以先出现的为准，后出现的忽略（不静默顶替）
      if (seen.has(plugin.id)) continue
      seen.add(plugin.id)
      entries.push({ source, plugin })
    }
  }
  return { entries, sources: infos }
}

function highestVersion(versions: readonly MarketVersion[]): MarketVersion | null {
  let best: MarketVersion | null = null
  let bestValue = -1
  for (const entry of versions) {
    const parts = entry.version.split('.').map(n => Number(n))
    const value = (parts[0] ?? 0) * 1e6 + (parts[1] ?? 0) * 1e3 + (parts[2] ?? 0)
    if (value > bestValue) {
      bestValue = value
      best = entry
    }
  }
  return best
}

async function hashDirectory(dir: string): Promise<string> {
  const files = (await walkFiles(dir, dir)).sort()
  const outer = createHash('sha256')
  for (const rel of files) {
    const text = await readFile(join(dir, ...rel.split('/')), 'utf8')
    outer.update(rel)
    outer.update('\0')
    outer.update(createHash('sha256').update(text, 'utf8').digest())
    outer.update('\n')
  }
  return outer.digest('hex')
}

/** 单文件 sha256（hex），安装计划里逐条展示 */
function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 索引内联文件的内容指纹。必须和 hashDirectory 完全同构：
 * 路径先按默认字典序，逐条 path → '\0' → 文件 sha256 的二进制 → '\n'，最后外层 sha256。
 * 这样 plan.digest 才能和装完目录的哈希直接比对（测试会钉住这条等式）。
 */
function digestOfMarketFiles(files: readonly MarketFile[]): string {
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const outer = createHash('sha256')
  for (const file of ordered) {
    outer.update(file.path)
    outer.update('\0')
    outer.update(createHash('sha256').update(file.text, 'utf8').digest())
    outer.update('\n')
  }
  return outer.digest('hex')
}

function trustOf(source: string): MarketTrust {
  return source === BUNDLED_SOURCE ? 'official' : 'community'
}

async function walkFiles(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)))
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(sep).join('/'))
    }
  }
  return out
}

async function integrityMatches(dir: string, expected: string): Promise<boolean> {
  try {
    return (await hashDirectory(dir)) === expected
  } catch {
    return false
  }
}

export async function listMarketPlugins(root?: string): Promise<MarketListResult> {
  const base = marketRoot(root)
  const { entries, sources } = await collectMarketEntries(base)
  const records = await readInstalled(base)
  const byId = new Map(records.map(r => [r.id, r]))
  const plugins: MarketItem[] = []
  for (const { source, plugin } of entries) {
    const latest = latestCompatibleVersion(plugin.versions, MAIN_PLUGIN_HOST_VERSION)
    const highest = highestVersion(plugin.versions)
    const record = byId.get(plugin.id)
    let installed: MarketItem['installed']
    if (record) {
      const dir = join(base, PLUGINS_DIR, record.id)
      const exists = await pathExists(dir)
      installed = {
        version: record.version,
        modified: exists ? !(await integrityMatches(dir, record.sha256)) : false,
        missing: !exists,
      }
    }
    plugins.push({
      id: plugin.id,
      name: plugin.name,
      ...(plugin.title !== undefined ? { title: plugin.title } : {}),
      description: plugin.description,
      ...(plugin.author !== undefined ? { author: plugin.author } : {}),
      source,
      latestVersion: latest ? latest.version : null,
      ...(highest ? { availableVersion: highest.version } : {}),
      ...(latest && latest.requires !== undefined ? { requires: latest.requires } : {}),
      ...(installed ? { installed } : {}),
    })
  }
  return { plugins, sources }
}

export async function addMarketSource(raw: string, root?: string): Promise<MarketResult<string[]>> {
  const source = normalizeMarketSource(raw)
  if (!source) return { ok: false, error: '来源必须是 http(s) 地址或本地路径' }
  return exclusive(async () => {
    const base = marketRoot(root)
    const sources = await readSources(base)
    if (sources.includes(source)) return { ok: false, error: '这个来源已经在列表里' }
    if (sources.length >= MARKET_MAX_SOURCES) {
      return { ok: false, error: '来源数量已达上限（' + MARKET_MAX_SOURCES + '）' }
    }
    const next = [...sources, source]
    await writeSources(base, next)
    return { ok: true, value: [BUNDLED_SOURCE, ...next] }
  })
}

export async function removeMarketSource(
  raw: string,
  root?: string,
): Promise<MarketResult<string[]>> {
  const source = String(raw ?? '').trim()
  if (source === BUNDLED_SOURCE) return { ok: false, error: '官方离线源不能删除' }
  return exclusive(async () => {
    const base = marketRoot(root)
    const sources = await readSources(base)
    if (!sources.includes(source)) return { ok: false, error: '来源不存在' }
    const next = sources.filter(s => s !== source)
    await writeSources(base, next)
    return { ok: true, value: [BUNDLED_SOURCE, ...next] }
  })
}

function parseMarketManifest(
  text: string,
  plugin: MarketPlugin,
  version: MarketVersion,
  paths: readonly string[],
): { ok: true; value: AiPluginManifestFile } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'manifest.json 不是合法 JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'manifest.json 必须是对象' }
  if (raw.ai !== true) return { ok: false, error: '市场插件必须是 AI 插件（manifest.ai = true）' }
  const identity = validatePluginIdentity({
    id: aiPluginIdOf(typeof raw.name === 'string' ? raw.name : ''),
    name: raw.name,
    version: raw.version,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
  })
  if (!identity.ok) return { ok: false, error: identity.error }
  if (identity.value.name !== plugin.name) {
    return { ok: false, error: 'manifest.name 与市场索引的 name 不一致' }
  }
  if (identity.value.version !== version.version) {
    return { ok: false, error: 'manifest.version 与市场索引的版本不一致' }
  }
  const entry = raw.entry
  if (typeof entry !== 'string' || !isSafeMarketPath(entry)) {
    return { ok: false, error: 'manifest.entry 必须是安全的相对路径' }
  }
  if (!paths.includes(entry)) {
    return { ok: false, error: 'manifest.entry 不在安装文件列表里' }
  }
  return {
    ok: true,
    value: {
      name: identity.value.name,
      version: identity.value.version,
      entry,
      ai: true,
      ...(identity.value.description ? { description: identity.value.description } : {}),
      // 这两个字段原先被丢掉，市场插件的权限/设置声明会静默失效；原样交给装载器
      ...(raw.permissions !== undefined ? { permissions: raw.permissions } : {}),
      ...(raw.settings !== undefined ? { settings: raw.settings } : {}),
    },
  }
}

interface MarketAssessment {
  plan: MarketInstallPlan
  found: CollectedEntry
  version: MarketVersion | null
  manifest: AiPluginManifestFile | null
  target: string
  existing?: MarketRecord
}

/**
 * 安装前检查：只读，不写盘。安装和"检查"共用这一份判断，避免两处规则漂移。
 * 阻塞顺序：没有兼容版本 → 目录无记录 → 本地改过 → 同版本 → 跨来源 → 清单坏。
 */
async function assessMarketInstall(
  base: string,
  id: string,
  records: readonly MarketRecord[],
): Promise<MarketResult<MarketAssessment>> {
  const { entries } = await collectMarketEntries(base)
  const found = entries.find(e => e.plugin.id === id)
  if (!found) return { ok: false, error: '市场里没有这个插件: ' + id }
  const version = latestCompatibleVersion(found.plugin.versions, MAIN_PLUGIN_HOST_VERSION)
  const target = join(base, PLUGINS_DIR, id)
  const existing = records.find(r => r.id === id)
  const targetExists = await pathExists(target)
  const files = version
    ? [...version.files]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map(file => ({
          path: file.path,
          bytes: Buffer.byteLength(file.text, 'utf8'),
          sha256: sha256Text(file.text),
        }))
    : []
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const digest = version ? digestOfMarketFiles(version.files) : ''
  let blocked: string | undefined
  let manifest: AiPluginManifestFile | null = null
  let summary: MarketInstallPlan['manifest'] = null
  if (!version) {
    blocked = '没有兼容当前宿主（' + MAIN_PLUGIN_HOST_VERSION + '）的版本'
  } else {
    const manifestText = version.files.find(f => f.path === MARKET_MANIFEST_FILE)?.text ?? ''
    const parsed = parseMarketManifest(
      manifestText,
      found.plugin,
      version,
      files.map(f => f.path),
    )
    if (!parsed.ok) {
      blocked = parsed.error
    } else {
      manifest = parsed.value
      let settingCount = 0
      try {
        settingCount = normalizeSettingSpecs(parsed.value.settings).length
      } catch {
        settingCount = 0
      }
      summary = {
        name: parsed.value.name,
        version: parsed.value.version,
        entry: parsed.value.entry,
        permissions: aiPluginPermissionsOf(parsed.value.permissions).map(String),
        settingCount,
      }
    }
  }
  if (!blocked && version && existing && targetExists) {
    if (!(await integrityMatches(target, existing.sha256))) {
      blocked = '已安装目录被本地修改过，请先卸载再安装'
    } else if (existing.version === version.version) {
      blocked = '已安装版本 ' + version.version
    } else if (existing.source !== found.source) {
      blocked =
        '已安装版本来自另一个来源（' +
        existing.source +
        '），不能从 ' +
        found.source +
        ' 静默更新；请先卸载再安装'
    }
  } else if (!blocked && targetExists && !existing) {
    blocked = '安装目录已存在且不受市场管理: ' + target
  }
  const plan: MarketInstallPlan = {
    id: found.plugin.id,
    name: found.plugin.name,
    ...(found.plugin.title !== undefined ? { title: found.plugin.title } : {}),
    description: found.plugin.description,
    ...(found.plugin.author !== undefined ? { author: found.plugin.author } : {}),
    source: found.source,
    trust: trustOf(found.source),
    signed: false,
    version: version ? version.version : null,
    ...(version && version.requires !== undefined ? { requires: version.requires } : {}),
    files,
    totalBytes,
    digest,
    manifest: summary,
    ...(existing
      ? {
          update: {
            fromVersion: existing.version,
            fromSource: existing.source,
            sameSource: existing.source === found.source,
          },
        }
      : {}),
    ...(blocked ? { blocked } : {}),
  }
  return {
    ok: true,
    value: { plan, found, version, manifest, target, ...(existing ? { existing } : {}) },
  }
}

/** 只读的安装前检查（界面用来生成确认面板） */
export async function inspectMarketPlugin(
  id: string,
  root?: string,
): Promise<MarketResult<MarketInstallPlan>> {
  const base = marketRoot(root)
  const records = await readInstalled(base)
  const assessed = await assessMarketInstall(base, id, records)
  return assessed.ok ? { ok: true, value: assessed.value.plan } : assessed
}

export async function installMarketPlugin(
  id: string,
  root?: string,
  expectDigest?: string,
): Promise<MarketResult<MarketInstallInfo>> {
  return exclusive(async () => {
    const base = marketRoot(root)
    const records = await readInstalled(base)
    const assessed = await assessMarketInstall(base, id, records)
    if (!assessed.ok) return assessed
    const { plan, found, version, manifest, target, existing } = assessed.value
    if (plan.blocked || !version || !manifest) {
      return { ok: false, error: plan.blocked ?? '安装检查没有通过' }
    }
    if (expectDigest && expectDigest !== plan.digest) {
      return {
        ok: false,
        error:
          '索引在确认后变了（确认的是 ' +
          expectDigest.slice(0, 12) +
          '…，现在是 ' +
          plan.digest.slice(0, 12) +
          '…）；请重新检查再安装',
      }
    }
    const targetExists = await pathExists(target)
    if (existing && targetExists) {
      unloadAiPluginByName(existing.name)
      await rm(target, { recursive: true, force: true })
    } else if (targetExists) {
      return { ok: false, error: '安装目录已存在且不受市场管理: ' + target }
    }

    let loadedName: string | null = null
    try {
      await mkdir(target, { recursive: true })
      for (const file of version.files) {
        if (!isSafeMarketPath(file.path)) throw new Error('索引里有不安全的路径: ' + file.path)
        const dest = resolve(target, ...file.path.split('/'))
        if (dest !== target && !dest.startsWith(target + sep)) {
          throw new Error('索引里有越界路径: ' + file.path)
        }
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, file.text, 'utf8')
      }
      const load = await loadAiPluginPackage(target, manifest)
      if (!load.ok) throw new Error(load.error)
      loadedName = manifest.name
      const actual = await hashDirectory(target)
      if (actual !== plan.digest) {
        throw new Error('装完的内容指纹与安装检查不一致（可能写盘异常），已回滚')
      }
      const record: MarketRecord = {
        id: found.plugin.id,
        name: manifest.name,
        version: version.version,
        ...(version.requires !== undefined ? { requires: version.requires } : {}),
        source: found.source,
        trust: plan.trust,
        signed: false,
        sha256: actual,
        installedAt: new Date().toISOString(),
      }
      await writeInstalled(base, records.filter(r => r.id !== id).concat(record))
      return {
        ok: true,
        value: {
          id: found.plugin.id,
          pluginId: load.pluginId,
          name: manifest.name,
          version: version.version,
          source: found.source,
          trust: plan.trust,
          signed: false,
          digest: actual,
        },
      }
    } catch (e) {
      if (loadedName) unloadAiPluginByName(loadedName)
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, error: errorText(e) }
    }
  })
}

export async function uninstallMarketPlugin(
  id: string,
  root?: string,
): Promise<MarketResult<{ id: string }>> {
  return exclusive(async () => {
    const base = marketRoot(root)
    const records = await readInstalled(base)
    const record = records.find(r => r.id === id)
    if (!record) return { ok: false, error: '没有安装记录: ' + id }
    try {
      // 先清覆盖层（恢复默认启用）再卸载，否则下次同 id 装载会继承"已停用"
      await setAiPluginEnabledByName(record.name, true)
    } catch {
      // 清理覆盖层失败不影响卸载本身
    }
    unloadAiPluginByName(record.name)
    await rm(join(base, PLUGINS_DIR, record.id), { recursive: true, force: true })
    await writeInstalled(
      base,
      records.filter(r => r.id !== id),
    )
    return { ok: true, value: { id } }
  })
}

export interface MarketRestoreResult {
  restored: string[]
  changed: string[]
  missing: string[]
  failed: { id: string; error: string }[]
}

function parseInstalledManifest(
  text: string,
  record: MarketRecord,
): { ok: true; value: AiPluginManifestFile } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'manifest.json 不是合法 JSON' }
  }
  if (!isRecord(raw) || raw.ai !== true) {
    return { ok: false, error: 'manifest.ai 必须为 true' }
  }
  const identity = validatePluginIdentity({
    id: aiPluginIdOf(typeof raw.name === 'string' ? raw.name : ''),
    name: raw.name,
    version: raw.version,
  })
  if (!identity.ok) return { ok: false, error: identity.error }
  if (identity.value.name !== record.name || identity.value.version !== record.version) {
    return { ok: false, error: '清单与安装记录不一致' }
  }
  const entry = raw.entry
  if (typeof entry !== 'string' || !isSafeMarketPath(entry)) {
    return { ok: false, error: 'manifest.entry 必须是安全的相对路径' }
  }
  return {
    ok: true,
    value: {
      name: identity.value.name,
      version: identity.value.version,
      entry,
      ai: true,
      ...(raw.permissions !== undefined ? { permissions: raw.permissions } : {}),
      ...(raw.settings !== undefined ? { settings: raw.settings } : {}),
    },
  }
}

/** 启动时恢复：只装回哈希对得上的市场插件；其他分列 changed/missing/failed，不拦启动 */
export async function restoreInstalledMarketPlugins(root?: string): Promise<MarketRestoreResult> {
  const result: MarketRestoreResult = { restored: [], changed: [], missing: [], failed: [] }
  let base: string
  try {
    base = marketRoot(root)
  } catch (e) {
    result.failed.push({ id: '*', error: errorText(e) })
    return result
  }
  const records = await readInstalled(base)
  for (const record of records) {
    const dir = join(base, PLUGINS_DIR, record.id)
    if (!(await pathExists(dir))) {
      result.missing.push(record.id)
      continue
    }
    if (!(await integrityMatches(dir, record.sha256))) {
      result.changed.push(record.id)
      continue
    }
    try {
      const manifest = parseInstalledManifest(
        await readFile(join(dir, MARKET_MANIFEST_FILE), 'utf8'),
        record,
      )
      if (!manifest.ok) {
        result.failed.push({ id: record.id, error: manifest.error })
        continue
      }
      const load = await loadAiPluginPackage(dir, manifest.value)
      if (!load.ok) {
        result.failed.push({ id: record.id, error: load.error })
        continue
      }
      result.restored.push(record.id)
    } catch (e) {
      result.failed.push({ id: record.id, error: errorText(e) })
    }
  }
  return result
}

/** 供测试/诊断：当前安装记录 */
export async function listInstalledMarketPlugins(root?: string): Promise<MarketRecord[]> {
  return readInstalled(marketRoot(root))
}
