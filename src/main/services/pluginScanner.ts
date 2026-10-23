// src/main/services/pluginScanner.ts
// 插件扫描服务：扫描 {project}/plugins/ 目录下的第三方插件包

import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import vm from 'vm'
import type { PluginPackage, PluginManifest, PluginInfo } from '@shared/types/plugin-sdk'
import { logger } from './logger'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------
// 结构化错误类型定义
// ---------------------------------------------------------------------------

/** 插件加载错误类型 */
export type PluginLoadErrorType =
  | 'manifest_invalid' // manifest 验证失败
  | 'entry_missing' // 入口文件缺失
  | 'entry_empty' // 入口文件为空
  | 'syntax_error' // 语法错误
  | 'execution_failed' // 执行失败
  | 'no_export' // 未导出有效对象
  | 'unknown' // 未知错误

/** 结构化插件加载错误 */
export interface PluginLoadError {
  type: PluginLoadErrorType
  message: string
  pluginName?: string
  filePath?: string
}

/**
 * 扫描结果：继承自 Array<PluginInfo>，向后兼容直接作为数组使用的代码，
 * 同时暴露 errors 字段供调用方获取加载失败信息。
 */
export class ScanResult extends Array<PluginInfo> {
  /** 加载失败的错误列表 */
  errors: PluginLoadError[] = []

  /** 成功加载的插件列表（等于数组本身） */
  get plugins(): PluginInfo[] {
    return this
  }

  /** 工厂方法：从插件列表和错误列表构造 ScanResult */
  static create(plugins: PluginInfo[], errors: PluginLoadError[]): ScanResult {
    const result = new ScanResult()
    for (const p of plugins) result.push(p)
    result.errors = errors
    return result
  }
}

/** 单个插件包加载结果 */
export interface PackageLoadResult {
  /** 加载成功的插件包（失败时为 null） */
  package: PluginPackage | null
  /** 加载过程中收集的错误 */
  errors: PluginLoadError[]
}

/** 验证 manifest 格式，返回验证错误信息（空表示通过） */
export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = []
  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest 必须是 JSON 对象')
    return errors
  }
  const m = manifest as Record<string, unknown>
  if (typeof m.name !== 'string' || !m.name) errors.push('manifest.name 必填且为字符串')
  if (typeof m.version !== 'string' || !m.version) errors.push('manifest.version 必填且为字符串')
  if (typeof m.entry !== 'string' || !m.entry) errors.push('manifest.entry 必填且为字符串')
  if (m.description !== undefined && typeof m.description !== 'string') errors.push('manifest.description 必须为字符串')
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      errors.push('manifest.permissions 必须为数组')
    } else if (!m.permissions.every((p) => typeof p === 'string')) {
      errors.push('manifest.permissions 元素必须为字符串')
    }
  }
  return errors
}

/**
 * 扫描 {projectPath}/plugins/ 目录
 * 读取每个子目录的 manifest.json + index.js
 * 返回 ScanResult（可作为数组直接使用，也可通过 .errors 获取加载失败信息）
 */
export async function scanPlugins(projectPath: string): Promise<ScanResult> {
  const pluginsDir = join(projectPath, 'plugins')
  if (!existsSync(pluginsDir)) return ScanResult.create([], [])

  const entries = await readdir(pluginsDir, { withFileTypes: true })
  const plugins: PluginInfo[] = []
  const errors: PluginLoadError[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue

    const pluginDir = join(pluginsDir, entry.name)
    const manifestPath = join(pluginDir, 'manifest.json')

    if (!existsSync(manifestPath)) continue

    try {
      const raw = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw) as PluginManifest
      const manifestErrors = validateManifest(manifest)
      if (manifestErrors.length > 0) {
        const msg = `manifest 验证失败: ${manifestErrors.join('; ')}`
        logger.warn(`[pluginScanner] ${entry.name}: ${msg}`)
        errors.push({ type: 'manifest_invalid', message: msg, pluginName: entry.name, filePath: manifestPath })
        continue
      }

      const entryPath = join(pluginDir, manifest.entry)
      const loaded = existsSync(entryPath)

      plugins.push({
        name: manifest.name,
        version: manifest.version,
        author: manifest.permissions?.includes('author') ? undefined : undefined,
        description: manifest.description,
        nodeCount: 0, // 扫描单个插件时不加载节点
        enabled: true,
        loaded,
        path: pluginDir
      })
    } catch (e) {
      const msg = `读取 manifest 失败: ${errorMessage(e)}`
      logger.warn(`[pluginScanner] ${entry.name}: ${msg}`)
      errors.push({ type: 'manifest_invalid', message: msg, pluginName: entry.name, filePath: manifestPath })
    }
  }

  return ScanResult.create(plugins, errors)
}

/**
 * 扫描并加载指定插件包，返回 PackageLoadResult
 * 包含加载成功的 package（失败时为 null）和加载过程中收集的 errors
 */
export async function loadPluginPackage(pluginDir: string): Promise<PackageLoadResult> {
  const manifestPath = join(pluginDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return { package: null, errors: [] }
  }

  const errors: PluginLoadError[] = []
  const pluginName = basename(pluginDir)

  try {
    const raw = await readFile(manifestPath, 'utf-8')
    const manifest = JSON.parse(raw) as PluginManifest
    const manifestErrors = validateManifest(manifest)
    if (manifestErrors.length > 0) {
      const msg = `manifest 验证失败: ${manifestErrors.join('; ')}`
      logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
      errors.push({ type: 'manifest_invalid', message: msg, pluginName, filePath: manifestPath })
      return { package: null, errors }
    }

    const pkg = await loadPluginJs(pluginDir, manifest, errors)
    return { package: pkg, errors }
  } catch (e) {
    const msg = `加载失败: ${errorMessage(e)}`
    logger.error(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'unknown', message: msg, pluginName, filePath: manifestPath })
    return { package: null, errors }
  }
}

/**
 * 加载插件的 JavaScript 定义文件（通过 vm 模块）
 * 加载过程中的错误会收集到 errors 数组中，同时保留 logger.warn 输出
 */
async function loadPluginJs(
  pluginDir: string,
  manifest: PluginManifest,
  errors: PluginLoadError[]
): Promise<PluginPackage | null> {
  const pluginName = manifest.name || basename(pluginDir)
  const entryPath = join(pluginDir, manifest.entry)

  if (!existsSync(entryPath)) {
    const msg = `入口文件不存在: ${entryPath}`
    logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'entry_missing', message: msg, pluginName, filePath: entryPath })
    return null
  }

  const code = await readFile(entryPath, 'utf-8')
  if (!code.trim()) {
    const msg = `入口文件为空: ${entryPath}`
    logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'entry_empty', message: msg, pluginName, filePath: entryPath })
    return null
  }

  // 先语法校验
  try {
    vm.compileFunction(code, [], { filename: entryPath })
  } catch (e) {
    const msg = `插件代码语法错误: ${errorMessage(e)}`
    logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'syntax_error', message: msg, pluginName, filePath: entryPath })
    return null
  }

  // 创建并冻结 sandbox，阻断原型链逃逸
  const sandbox = Object.freeze({
    module: { exports: {} as PluginPackage | undefined },
    exports: {} as PluginPackage | undefined,
    console: {
      log: (...args: unknown[]) => logger.info('[plugin]', ...args),
      warn: (...args: unknown[]) => logger.warn('[plugin]', ...args),
      error: (...args: unknown[]) => logger.error('[plugin]', ...args)
    },
    setTimeout,
    clearTimeout,
    Buffer: undefined,
    process: undefined,
    require: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined
  })

  try {
    vm.runInNewContext(code, vm.createContext(sandbox), {
      filename: entryPath,
      timeout: 5000,
      microtaskMode: 'afterEvaluate',
      contextCodeGeneration: { wasm: false, strings: false }
    })
  } catch (e) {
    const msg = `执行插件代码失败: ${errorMessage(e)}`
    logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'execution_failed', message: msg, pluginName, filePath: entryPath })
    return null
  }

  const pkg = sandbox.module.exports || sandbox.exports
  if (!pkg || typeof pkg !== 'object') {
    const msg = '插件未导出有效对象'
    logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'no_export', message: msg, pluginName, filePath: entryPath })
    return null
  }

  // 补充 name/version 从 manifest
  if (!pkg.name) pkg.name = manifest.name
  if (!pkg.version) pkg.version = manifest.version

  // 验证节点定义
  if (!Array.isArray(pkg.nodes)) {
    const msg = '插件必须导出 nodes 数组'
    logger.warn(`[pluginScanner] ${pluginName}: ${msg}`)
    errors.push({ type: 'no_export', message: msg, pluginName, filePath: entryPath })
    return null
  }

  return pkg as PluginPackage
}
