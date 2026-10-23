// tests/main/services/pluginScanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  scanPlugins,
  loadPluginPackage,
  validateManifest,
  ScanResult
} from '@main/services/pluginScanner'
import type { PluginManifest } from '@shared/types/plugin-sdk'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

let tmpDir: string
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qqbat-pscan-'))
})
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** 写一个插件包到 {projectPath}/plugins/{dir}/，包含 manifest.json 和可选的入口文件 */
async function writePlugin(
  projectPath: string,
  dir: string,
  manifest: PluginManifest,
  entryCode?: string
): Promise<void> {
  const pluginDir = join(projectPath, 'plugins', dir)
  await mkdir(pluginDir, { recursive: true })
  await writeFile(join(pluginDir, 'manifest.json'), JSON.stringify(manifest))
  if (entryCode !== undefined) {
    await writeFile(join(pluginDir, manifest.entry), entryCode)
  }
}

/** 合法入口文件内容：导出含 nodes 数组的对象 */
const validEntryCode = `module.exports = {
  nodes: [
    { kind: 'test_node', type: 'action', label: 'Test', handler: 'async (ctx) => ({})' }
  ]
}`

// ---------------------------------------------------------------------------
// scanPlugins
// ---------------------------------------------------------------------------
describe('scanPlugins', () => {
  it('目录不存在时返回空数组且无错误', async () => {
    const result = await scanPlugins(tmpDir)
    expect(result).toBeInstanceOf(ScanResult)
    expect(result.length).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.plugins.length).toBe(0)
  })

  it('空 plugins 目录返回空数组', async () => {
    await mkdir(join(tmpDir, 'plugins'))
    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('识别有效插件并解析元数据（name/version/description）', async () => {
    await writePlugin(tmpDir, 'my-plugin', {
      name: 'my-plugin',
      version: '1.2.3',
      entry: 'index.js',
      description: '一个测试插件',
      permissions: ['db']
    }, validEntryCode)

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(1)
    const p = result[0]
    expect(p.name).toBe('my-plugin')
    expect(p.version).toBe('1.2.3')
    expect(p.description).toBe('一个测试插件')
    expect(p.path).toBe(join(tmpDir, 'plugins', 'my-plugin'))
    expect(p.loaded).toBe(true)
    expect(p.nodeCount).toBe(0) // 扫描阶段不加载节点
    expect(p.enabled).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('入口文件缺失时 loaded 为 false 但仍列入插件列表', async () => {
    await writePlugin(tmpDir, 'no-entry', {
      name: 'no-entry',
      version: '0.1.0',
      entry: 'index.js'
    }) // 不写入口文件

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('no-entry')
    expect(result[0].loaded).toBe(false)
    expect(result.errors).toEqual([])
  })

  it('manifest 缺失的子目录被静默跳过（不记录错误）', async () => {
    await mkdir(join(tmpDir, 'plugins', 'no-manifest'), { recursive: true })
    await writePlugin(tmpDir, 'real-plugin', {
      name: 'real-plugin',
      version: '1.0.0',
      entry: 'index.js'
    }, validEntryCode)

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('real-plugin')
    expect(result.errors).toEqual([])
  })

  it('隐藏目录（以 . 开头）被跳过', async () => {
    await mkdir(join(tmpDir, 'plugins', '.hidden'), { recursive: true })
    await writeFile(
      join(tmpDir, 'plugins', '.hidden', 'manifest.json'),
      JSON.stringify({ name: 'hidden', version: '1.0.0', entry: 'index.js' })
    )
    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(0)
  })

  it('非目录条目（如文件）被跳过', async () => {
    await mkdir(join(tmpDir, 'plugins'))
    await writeFile(join(tmpDir, 'plugins', 'README.md'), 'hello')
    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(0)
  })

  it('manifest 为非法 JSON 时跳过并记录 manifest_invalid 错误', async () => {
    const pluginDir = join(tmpDir, 'plugins', 'broken-json')
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, 'manifest.json'), '{ not valid json }}}')

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('manifest_invalid')
    expect(result.errors[0].pluginName).toBe('broken-json')
    expect(result.errors[0].message).toMatch(/读取 manifest 失败/)
  })

  it('manifest 必填字段缺失时跳过并记录错误', async () => {
    // manifest 缺少 version 和 entry；不写入口文件
    const pluginDir = join(tmpDir, 'plugins', 'bad-manifest')
    await mkdir(pluginDir, { recursive: true })
    await writeFile(
      join(pluginDir, 'manifest.json'),
      JSON.stringify({ name: 'bad-manifest' })
    )

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('manifest_invalid')
    expect(result.errors[0].pluginName).toBe('bad-manifest')
  })

  it('损坏的插件文件被跳过而不崩溃（损坏 manifest）', async () => {
    // 多个插件混合：一个损坏 + 一个正常，扫描应继续不崩溃
    const brokenDir = join(tmpDir, 'plugins', 'broken')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(join(brokenDir, 'manifest.json'), '!!!corrupted@@@')

    await writePlugin(tmpDir, 'good', {
      name: 'good',
      version: '1.0.0',
      entry: 'index.js'
    }, validEntryCode)

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('good')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].pluginName).toBe('broken')
  })

  it('多个有效插件都被返回', async () => {
    await writePlugin(tmpDir, 'alpha', {
      name: 'alpha',
      version: '1.0.0',
      entry: 'index.js'
    }, validEntryCode)
    await writePlugin(tmpDir, 'beta', {
      name: 'beta',
      version: '2.0.0',
      entry: 'index.js',
      description: 'beta plugin'
    }, validEntryCode)
    await writePlugin(tmpDir, 'gamma', {
      name: 'gamma',
      version: '3.0.0',
      entry: 'index.js'
    }, validEntryCode)

    const result = await scanPlugins(tmpDir)
    expect(result.length).toBe(3)
    // 扫描器不排序，按目录枚举顺序返回；用集合断言避免依赖顺序
    // 注意：ScanResult 继承 Array，map() 返回值仍带 errors 属性，需转纯数组比较
    const names = Array.from(result, (p) => p.name).sort()
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('返回的 ScanResult 可同时作为数组和带 errors 的对象使用', async () => {
    await writePlugin(tmpDir, 'ok', {
      name: 'ok',
      version: '1.0.0',
      entry: 'index.js'
    }, validEntryCode)

    const result = await scanPlugins(tmpDir)
    expect(Array.isArray(result)).toBe(true)
    expect(result.plugins).toBe(result) // plugins getter 返回自身
    expect(result.length).toBe(result.plugins.length)
  })
})

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------
describe('validateManifest', () => {
  it('合法 manifest 返回空错误数组', () => {
    const errors = validateManifest({
      name: 'p',
      version: '1.0.0',
      entry: 'index.js'
    })
    expect(errors).toEqual([])
  })

  it('带可选字段 description / permissions 仍合法', () => {
    const errors = validateManifest({
      name: 'p',
      version: '1.0.0',
      entry: 'index.js',
      description: 'desc',
      permissions: ['db', 'network']
    })
    expect(errors).toEqual([])
  })

  it('非对象返回错误', () => {
    expect(validateManifest(null)).toContain('manifest 必须是 JSON 对象')
    expect(validateManifest('string')).toContain('manifest 必须是 JSON 对象')
    expect(validateManifest(undefined)).toContain('manifest 必须是 JSON 对象')
  })

  it('name 缺失或非字符串返回错误', () => {
    const errors = validateManifest({ version: '1.0.0', entry: 'index.js' })
    expect(errors.some((e) => e.includes('manifest.name'))).toBe(true)
  })

  it('version 缺失返回错误', () => {
    const errors = validateManifest({ name: 'p', entry: 'index.js' })
    expect(errors.some((e) => e.includes('manifest.version'))).toBe(true)
  })

  it('entry 缺失返回错误', () => {
    const errors = validateManifest({ name: 'p', version: '1.0.0' })
    expect(errors.some((e) => e.includes('manifest.entry'))).toBe(true)
  })

  it('description 非字符串返回错误', () => {
    const errors = validateManifest({
      name: 'p',
      version: '1.0.0',
      entry: 'index.js',
      description: 123
    })
    expect(errors.some((e) => e.includes('manifest.description'))).toBe(true)
  })

  it('permissions 非数组返回错误', () => {
    const errors = validateManifest({
      name: 'p',
      version: '1.0.0',
      entry: 'index.js',
      permissions: 'db'
    })
    expect(errors.some((e) => e.includes('manifest.permissions 必须为数组'))).toBe(true)
  })

  it('permissions 元素非字符串返回错误', () => {
    const errors = validateManifest({
      name: 'p',
      version: '1.0.0',
      entry: 'index.js',
      permissions: ['db', 123]
    })
    expect(errors.some((e) => e.includes('manifest.permissions 元素必须为字符串'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// loadPluginPackage
// ---------------------------------------------------------------------------
describe('loadPluginPackage', () => {
  it('manifest 缺失返回 null 且无错误', async () => {
    const pluginDir = join(tmpDir, 'empty-pkg')
    await mkdir(pluginDir, { recursive: true })
    const result = await loadPluginPackage(pluginDir)
    expect(result.package).toBeNull()
    expect(result.errors).toEqual([])
  })

  it('manifest 非法 JSON 返回 null 并记录错误', async () => {
    const pluginDir = join(tmpDir, 'bad-json')
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, 'manifest.json'), '!!!not json!!!')

    const result = await loadPluginPackage(pluginDir)
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('unknown')
  })

  it('manifest 字段缺失返回 null 并记录 manifest_invalid 错误', async () => {
    const pluginDir = join(tmpDir, 'bad-manifest')
    await mkdir(pluginDir, { recursive: true })
    await writeFile(
      join(pluginDir, 'manifest.json'),
      JSON.stringify({ name: 'bad' })
    )

    const result = await loadPluginPackage(pluginDir)
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('manifest_invalid')
  })

  it('入口文件缺失返回 null 并记录 entry_missing 错误', async () => {
    await writePlugin(tmpDir, 'no-entry-pkg', {
      name: 'no-entry-pkg',
      version: '1.0.0',
      entry: 'index.js'
    }) // 不写入口

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'no-entry-pkg'))
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('entry_missing')
  })

  it('入口文件为空返回 null 并记录 entry_empty 错误', async () => {
    await writePlugin(tmpDir, 'empty-entry', {
      name: 'empty-entry',
      version: '1.0.0',
      entry: 'index.js'
    }, '   \n  \t  \n')

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'empty-entry'))
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('entry_empty')
  })

  it('入口文件语法错误返回 null 并记录 syntax_error 错误', async () => {
    await writePlugin(tmpDir, 'syntax-err', {
      name: 'syntax-err',
      version: '1.0.0',
      entry: 'index.js'
    }, 'module.exports = { function {{{ syntax error')

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'syntax-err'))
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('syntax_error')
  })

  it('未导出对象返回 null 并记录 no_export 错误', async () => {
    await writePlugin(tmpDir, 'no-export', {
      name: 'no-export',
      version: '1.0.0',
      entry: 'index.js'
    }, '// 什么都不导出\nvar x = 1;\n')

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'no-export'))
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('no_export')
  })

  it('导出的 nodes 非数组返回 null 并记录 no_export 错误', async () => {
    await writePlugin(tmpDir, 'bad-nodes', {
      name: 'bad-nodes',
      version: '1.0.0',
      entry: 'index.js'
    }, 'module.exports = { nodes: "not an array" }')

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'bad-nodes'))
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('no_export')
    expect(result.errors[0].message).toMatch(/nodes 数组/)
  })

  it('导出合法 nodes 返回 package', async () => {
    await writePlugin(tmpDir, 'good-pkg', {
      name: 'good-pkg',
      version: '1.0.0',
      entry: 'index.js',
      description: 'desc'
    }, validEntryCode)

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'good-pkg'))
    expect(result.package).not.toBeNull()
    expect(result.package!.nodes).toHaveLength(1)
    expect(result.package?.nodes?.[0]?.kind).toBe('test_node')
    expect(result.errors).toEqual([])
  })

  it('package 的 name/version 在未导出时回退到 manifest', async () => {
    await writePlugin(tmpDir, 'fallback-pkg', {
      name: 'fallback-pkg',
      version: '2.5.0',
      entry: 'index.js'
    }, 'module.exports = { nodes: [] }') // 未导出 name/version

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'fallback-pkg'))
    expect(result.package).not.toBeNull()
    expect(result.package!.name).toBe('fallback-pkg')
    expect(result.package!.version).toBe('2.5.0')
  })

  it('损坏的入口文件被跳过而不崩溃', async () => {
    // 语法严重错误的入口文件，不应抛出异常
    await writePlugin(tmpDir, 'corrupted', {
      name: 'corrupted',
      version: '1.0.0',
      entry: 'index.js'
    }, 'function {{{{ totally broken')

    const result = await loadPluginPackage(join(tmpDir, 'plugins', 'corrupted'))
    expect(result.package).toBeNull()
    expect(result.errors).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// ScanResult
// ---------------------------------------------------------------------------
describe('ScanResult', () => {
  it('create 构造包含插件和错误', () => {
    const plugins = [
      { name: 'a', version: '1.0.0', nodeCount: 0, enabled: true, loaded: true, path: '/a' }
    ]
    const errors = [{ type: 'unknown' as const, message: 'err' }]
    const result = ScanResult.create(plugins, errors)
    expect(result).toBeInstanceOf(ScanResult)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('a')
    expect(result.errors).toBe(errors)
  })

  it('plugins getter 返回自身', () => {
    const result = ScanResult.create(
      [{ name: 'a', version: '1.0.0', nodeCount: 0, enabled: true, loaded: true, path: '/a' }],
      []
    )
    expect(result.plugins).toBe(result)
    expect(result.plugins.length).toBe(1)
  })

  it('可作为数组直接使用（forEach / map）', () => {
    const result = ScanResult.create(
      [
        { name: 'a', version: '1.0.0', nodeCount: 0, enabled: true, loaded: true, path: '/a' },
        { name: 'b', version: '2.0.0', nodeCount: 0, enabled: true, loaded: true, path: '/b' }
      ],
      []
    )
    expect(Array.isArray(result)).toBe(true)
    // ScanResult 继承 Array，map()/forEach() 均可正常使用
    expect(Array.from(result, (p) => p.name)).toEqual(['a', 'b'])
    let count = 0
    result.forEach(() => count++)
    expect(count).toBe(2)
  })
})
