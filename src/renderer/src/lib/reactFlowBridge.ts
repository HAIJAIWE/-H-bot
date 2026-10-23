// src/renderer/src/lib/reactFlowBridge.ts
//
// React Flow 实例桥：让非组件代码（如 aiStore.applyProposal）能调用 fitView / setCenter。
//
// 设计：
// - 模块级 _instance 变量持有引用（非 zustand store，避免订阅导致的重渲染）
// - 实例未就绪时缓存 focus 请求，就绪后由 BlockEditor onInit 消费
// - 节点尚未渲染时 setCenter 找不到节点 → 用 setTimeout 短延迟等 ReactFlow 内部状态同步

import type { ReactFlowInstance } from '@xyflow/react'
// C1 修复：focusNode 兜底尺寸用统一常量（与 CanvasNode 实际尺寸一致）
import { NODE_WIDTH, NODE_HEIGHT_COLLAPSED } from './canvasConstants'

let _instance: ReactFlowInstance | null = null
let _focusNodeRequest: string | null = null

/** 由 BlockEditor onInit 注册/清理实例 */
export function setReactFlowInstance(instance: ReactFlowInstance | null): void {
  _instance = instance
}

/** 把视口对准指定节点（带 1.2x zoom + 400ms 过渡），用于 AI 生成 / FlowOutline 跳转。
 *  实例未就绪时缓存请求，等 onInit 后由 consumePendingFocus 触发。 */
export function focusNode(nodeId: string): void {
  if (!_instance) {
    _focusNodeRequest = nodeId
    return
  }
  void _focusNodeImpl(_instance, nodeId)
}

/** fitView 整个画布 */
export function fitCanvas(): void {
  _instance?.fitView({ padding: 0.2, duration: 400 })
}

/** BlockEditor onInit 时调用：取回实例未就绪期间缓存的 focus 请求 */
export function consumePendingFocus(): string | null {
  const req = _focusNodeRequest
  _focusNodeRequest = null
  return req
}

async function _focusNodeImpl(instance: ReactFlowInstance, nodeId: string): Promise<void> {
  // React Flow 节点可能在 instance 就绪后还需一帧才能查询到，用 rAF 等一帧
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 16)
    }
  })
  const node = instance.getNode(nodeId)
  if (!node) {
    // 节点可能在画布坐标系外，尝试 fitView 作为兜底
    instance.fitView({ padding: 0.2, duration: 400 })
    return
  }
  // 节点中心坐标 = position + 一半尺寸
  // C1 修复：优先用 React Flow 实测尺寸 node.measured.width/height（节点已渲染时可用）
  // 实测不可用时兜底用统一常量（NODE_WIDTH=320 / NODE_HEIGHT_COLLAPSED=80）
  const w = node.measured?.width ?? node.width ?? NODE_WIDTH
  const h = node.measured?.height ?? node.height ?? NODE_HEIGHT_COLLAPSED
  const cx = (node.position.x ?? 0) + w / 2
  const cy = (node.position.y ?? 0) + h / 2
  instance.setCenter(cx, cy, { zoom: 1.2, duration: 400 })
}
