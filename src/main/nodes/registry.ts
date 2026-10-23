// src/main/nodes/registry.ts
import type { NodeSpecV2 } from '@shared/types/nodeV2'
import { logger } from '../services/logger'

/**
 * 节点注册表 — 统一管理内置/自定义/AI 生成节点。
 * 全局单例，通过 getNodeRegistry() 获取。
 *
 * 修复 H3: registerCustom/registerAiGenerated 添加重复注册告警，
 * 防止静默覆盖。find() 优先级 builtin > custom > aiGenerated，
 * 当 custom 与 builtin 同名时告警（custom 会被影子化）。
 *
 * 修复 M4: 暴露 _resetRegistryForTesting 供单元测试隔离使用。
 *
 * 修复 L4: getToolExposedNodes 懒缓存，注册时失效，避免每次 O(n) 遍历。
 */
export class NodeRegistry {
  private builtin = new Map<string, NodeSpecV2>()
  private custom = new Map<string, NodeSpecV2>()
  private aiGenerated = new Map<string, NodeSpecV2>()
  private toolExposedCache: NodeSpecV2[] | null = null
  private builtinInitialized = false

  /** 标记 builtin 节点已注册（用于 registerAllBuiltinNodes 幂等） */
  markBuiltinInitialized(): void {
    this.builtinInitialized = true
  }

  /** builtin 节点是否已注册 */
  isBuiltinInitialized(): boolean {
    return this.builtinInitialized
  }

  private invalidateCache(): void {
    this.toolExposedCache = null
  }

  registerBuiltin(spec: NodeSpecV2): void {
    if (this.builtin.has(spec.kind)) {
      logger.warn(`[NodeRegistry] 内置节点 "${spec.kind}" 重复注册，覆盖旧定义`)
    }
    this.builtin.set(spec.kind, spec)
    this.invalidateCache()
  }

  registerCustom(spec: NodeSpecV2): void {
    if (this.builtin.has(spec.kind)) {
      logger.warn(
        `[NodeRegistry] 自定义节点 "${spec.kind}" 与内置节点同名，将被内置节点影子化（find 返回内置版本）`
      )
    }
    if (this.custom.has(spec.kind)) {
      logger.warn(`[NodeRegistry] 自定义节点 "${spec.kind}" 重复注册，覆盖旧定义`)
    }
    this.custom.set(spec.kind, spec)
    this.invalidateCache()
  }

  registerAiGenerated(spec: NodeSpecV2): void {
    if (this.builtin.has(spec.kind) || this.custom.has(spec.kind)) {
      logger.warn(
        `[NodeRegistry] AI 生成节点 "${spec.kind}" 与已有节点同名，将被影子化`
      )
    }
    this.aiGenerated.set(spec.kind, spec)
    this.invalidateCache()
  }

  find(kind: string): NodeSpecV2 | undefined {
    return this.builtin.get(kind) ?? this.custom.get(kind) ?? this.aiGenerated.get(kind)
  }

  listAll(): NodeSpecV2[] {
    return [
      ...this.builtin.values(),
      ...this.custom.values(),
      ...this.aiGenerated.values()
    ]
  }

  /** 返回所有 exposedAsTool=true 的节点（供 ai_tool_call 使用） */
  getToolExposedNodes(): NodeSpecV2[] {
    if (this.toolExposedCache) return this.toolExposedCache
    this.toolExposedCache = this.listAll().filter((s) => s.exposedAsTool)
    return this.toolExposedCache
  }

  clearCustom(): void {
    this.custom.clear()
    this.invalidateCache()
  }

  clearAiGenerated(): void {
    this.aiGenerated.clear()
    this.invalidateCache()
  }
}

let _registry: NodeRegistry | null = null

export function getNodeRegistry(): NodeRegistry {
  if (!_registry) {
    _registry = new NodeRegistry()
  }
  return _registry
}

/**
 * 仅供单元测试使用：重置单例以便隔离测试用例。
 * 生产代码不要调用此函数。
 */
export function _resetRegistryForTesting(): void {
  _registry = null
}
