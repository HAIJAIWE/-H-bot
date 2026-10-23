// src/main/nodes/builtin/index.ts
import type { NodeRegistry } from '../registry'
// 从 shared 层导入内置节点目录，避免 main 进程反向引用 renderer 模块（架构边界）。
// ai_tool_call 节点已包含在 NODE_CATALOG_V2 中，无需单独注册。
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'

/**
 * 把所有内置节点（NODE_CATALOG_V2）注册到 NodeRegistry。
 *
 * 幂等：调用点散在 bot/tools、ai/context、ai/tools、flow/codegen 等处，同一进程会进来
 * 多次。不判 initialized 的话每次都会全量重放并打出「内置节点重复注册，覆盖旧定义」的
 * 告警（顺手把旧定义覆盖一遍），所以这里用 registry 自己的标记做闸门。
 */
export function registerAllBuiltinNodes(registry: NodeRegistry): void {
  if (registry.isBuiltinInitialized()) return
  for (const spec of NODE_CATALOG_V2) {
    registry.registerBuiltin(spec)
  }
  registry.markBuiltinInitialized()
}
