// src/main/services/pluginLoader.ts
// 插件加载器：动态加载/注册/卸载 JS 插件节点

import { existsSync } from 'fs'
import type { PluginPackage, PluginNode, PluginInfo } from '@shared/types/plugin-sdk'
import type { NodeSpec } from '@shared/types/flow'
import { loadPluginPackage } from './pluginScanner'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// 内置节点注册接口（由渲染进程调用 bridge 注入）
// ---------------------------------------------------------------------------

/** 插件注册的回调函数类型 */
export type PluginNodeRegistrar = (specs: NodeSpec[]) => void

let registerNodesCallback: PluginNodeRegistrar | null = null

/**
 * 设置注册回调，由主进程 IPC 在初始化时提供
 * 实际调用渲染进程的 setPluginNodes 更新 NodePalette
 */
export function setPluginRegistrar(callback: PluginNodeRegistrar): void {
  registerNodesCallback = callback
}

// ---------------------------------------------------------------------------
// 插件注册表
// ---------------------------------------------------------------------------

interface LoadedPlugin {
  pkg: PluginPackage
  specs: NodeSpec[]
  enabled: boolean
  path: string
}

/** 已加载的插件注册表（name -> LoadedPlugin） */
const registry = new Map<string, LoadedPlugin>()

// ---------------------------------------------------------------------------
// 核心函数
// ---------------------------------------------------------------------------

/** 将 PluginNode 转换为 NodeSpec */
export function pluginNodeToSpec(pluginName: string, node: PluginNode): NodeSpec {
  return {
    kind: `plugin_${pluginName}_${node.kind}`,
    type: node.type,
    label: node.label,
    group: (node.group || '插件') as NodeSpec['group'],
    icon: node.icon || '🧩',
    description: node.description || `${pluginName}: ${node.label}`,
    defaultConfig: node.defaultConfig || {},
    inputs: node.inputs || [{ id: 'in', name: 'in', kind: 'control' }],
    outputs: node.outputs || [{ id: 'out', name: 'out', kind: 'control' }]
  }
}

/**
 * 动态加载节点的 JS 定义文件
 * 读取指定插件目录的 manifest.json + index.js，返回 PluginPackage
 */
export async function loadPlugin(packagePath: string): Promise<PluginPackage | null> {
  if (!existsSync(packagePath)) return null
  // loadPluginPackage 现在返回 PackageLoadResult，这里解包以维持本函数签名
  const result = await loadPluginPackage(packagePath)
  return result.package
}

/**
 * 注册插件节点到流程可用节点列表
 * 调用后插件节点会出现在 NodePalette 的"插件"分组
 */
export function registerPlugin(pluginPkg: PluginPackage, pluginPath: string): boolean {
  const name = pluginPkg.name
  if (registry.has(name)) {
    logger.warn(`[pluginLoader] 插件 "${name}" 已注册，跳过`)
    return false
  }

  // nodes 在 manifest 里可省略（只有命令/事件的插件包），按空列表处理
  const specs = (pluginPkg.nodes ?? []).map((node) => pluginNodeToSpec(name, node))

  registry.set(name, {
    pkg: pluginPkg,
    specs,
    enabled: true,
    path: pluginPath
  })

  // 通知渲染进程更新节点列表
  if (registerNodesCallback) {
    registerNodesCallback(getAllPluginSpecs())
  }

  logger.info(`[pluginLoader] 插件 "${name}" v${pluginPkg.version} 已注册，${specs.length} 个节点`)
  return true
}

/**
 * 卸载插件
 * 从注册表中移除并通知渲染进程
 */
export function unregisterPlugin(pluginName: string): boolean {
  if (!registry.has(pluginName)) {
    logger.warn(`[pluginLoader] 插件 "${pluginName}" 未注册`)
    return false
  }

  registry.delete(pluginName)

  if (registerNodesCallback) {
    registerNodesCallback(getAllPluginSpecs())
  }

  logger.info(`[pluginLoader] 插件 "${pluginName}" 已卸载`)
  return true
}

/**
 * 启用/禁用插件
 */
export function setPluginEnabled(pluginName: string, enabled: boolean): boolean {
  const plugin = registry.get(pluginName)
  if (!plugin) return false
  plugin.enabled = enabled

  if (registerNodesCallback) {
    registerNodesCallback(getAllPluginSpecs())
  }
  return true
}

/** 获取所有已注册插件的 NodeSpec（仅启用的插件） */
export function getAllPluginSpecs(): NodeSpec[] {
  const result: NodeSpec[] = []
  for (const [, plugin] of registry) {
    if (plugin.enabled) {
      result.push(...plugin.specs)
    }
  }
  return result
}

/** 获取插件信息列表 */
export function getPluginInfos(): PluginInfo[] {
  return Array.from(registry.entries()).map(([name, plugin]) => ({
    name,
    version: plugin.pkg.version,
    author: plugin.pkg.author,
    description: plugin.pkg.description,
    nodeCount: plugin.specs.length,
    enabled: plugin.enabled,
    loaded: true,
    path: plugin.path
  }))
}

/**
 * 按节点 kind 找回它属于哪个插件。
 *
 * 消费方 `src/main/codegen/emitters.ts:197`：把画布上的节点翻成 TS 时，插件节点要知道
 * 包名（kind = plugin_<包名>_<kind>），找不到就沿用调用方自己的兜底。只在**已加载**的
 * 插件里找；停用但未卸载的插件同样能命中（画布上已有节点仍需生成代码）。
 */
export interface PluginNodeHit {
  pluginName: string
  nodeKind: string
  node: PluginNode
}

export function findPluginNode(nodeKind: string | null | undefined): PluginNodeHit | null {
  if (!nodeKind) return null
  for (const [pluginName, entry] of registry) {
    const node = (entry.pkg.nodes ?? []).find((n) => n.kind === nodeKind)
    if (node) return { pluginName, nodeKind: node.kind, node }
  }
  return null
}

/** 获取已加载的插件包 */
export function getPluginPackage(name: string): PluginPackage | undefined {
  return registry.get(name)?.pkg
}

/** 清除所有插件 */
export function clearAllPlugins(): void {
  registry.clear()
  if (registerNodesCallback) {
    registerNodesCallback([])
  }
}

/** 获取注册表大小 */
export function getPluginCount(): number {
  return registry.size
}
