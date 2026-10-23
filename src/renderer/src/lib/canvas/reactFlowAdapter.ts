// src/renderer/src/lib/canvas/reactFlowAdapter.ts
// 画布式重构 - 阶段 1：FlowNode/FlowEdge ↔ React Flow Node/Edge 转换
// 关联设计文档：docs/architecture/canvas-refactor-design.md 第 5.2、5.3 节

import type { FlowNode, FlowEdge, Port } from '@shared/types/flow';
import type { Node, Edge } from '@xyflow/react';
import { isControlEdge } from './executionOrder';

// ---------------------------------------------------------------------------
// Handle id 编码：${kind}__${portId}
// ---------------------------------------------------------------------------

/** Port → React Flow Handle id：${kind}__${portId}（如 'control__next'、'data__text'）。
 *  画布渲染时节点组件用此编码生成 Handle id，边转换时也用此编码匹配 Handle。
 *  注意：flowStore 内部仍用 ${nodeId}__${portId} 编码（nodeFactory/connectionSuggester），
 *  本函数负责单向转换，不改 flowStore。 */
export function encodeHandleId(port: Pick<Port, 'kind' | 'id'>): string {
  return `${port.kind}__${port.id}`;
}

/** Handle id → { kind, portId }。
 *  portId 可能含 `__`（branch_switch 动态 case 名是用户自由输入的 label），
 *  必须从第一个 `__` 处分割并保留完整剩余部分——split('__')[1] 会截断成错端口。 */
export function decodeHandleId(handleId: string): { kind: string; portId: string } {
  const idx = handleId.indexOf('__');
  if (idx < 0) return { kind: handleId, portId: handleId };
  return { kind: handleId.slice(0, idx), portId: handleId.slice(idx + 2) };
}

/** 查找端口在节点上的 kind。
 *  - 先在 outputs（source 边）或 inputs（target 边）中按 portId 查找
 *  - 查不到（branch_switch 动态分支端口不在 catalog 中）→ 默认 'control'
 *    （因为本函数仅对控制流边调用，查不到的端口必是 branch_switch 动态控制出口） */
function resolvePortKind(
  node: FlowNode,
  portId: string,
  direction: 'output' | 'input',
): Port['kind'] {
  const ports = direction === 'output' ? node.data.outputs : node.data.inputs;
  const port = ports.find((p) => p.id === portId);
  if (port) return port.kind;
  // branch_switch 动态分支端口不在 catalog 中，但已被 isControlEdge 判定为控制流边 → control
  return 'control';
}

// ---------------------------------------------------------------------------
// FlowNode → React Flow Node
// ---------------------------------------------------------------------------

/** FlowNode → React Flow Node（画布渲染用）。
 *  保留 position / type / data，Stage 2 的 CanvasNode 组件据此渲染。 */
export function toReactFlowNode(node: FlowNode): Node {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    // FlowNodeData 有明确字段，React Flow 的 data 是 Record<string, unknown>
    data: node.data as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// FlowEdge[] → React Flow Edge[]（仅控制流边 + handle 编码转换）
// ---------------------------------------------------------------------------

/** FlowEdge[] → React Flow Edge[]。
 *  - 只保留控制流边（数据流边不画在画布，设计 5.3.3）
 *  - 用带节点查找的 isControlEdge 过滤（正确处理 branch_switch 动态分支）
 *  - handle 编码从 flowStore 的 ${nodeId}__${portId} 转为画布的 ${kind}__${portId}
 *  - type 固定 'control'，对应 Stage 2 注册的 CanvasEdge 组件 */
export function toReactFlowEdges(edges: FlowEdge[], nodes: FlowNode[]): Edge[] {
  // 一次建索引，避免每条边 O(N) 找源/目标节点
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result: Edge[] = [];
  for (const edge of edges) {
    if (!isControlEdge(edge, nodeMap)) continue;
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    // 节点缺失时跳过（数据不一致，不应发生）
    if (!sourceNode || !targetNode) continue;

    const sourceKind = resolvePortKind(sourceNode, edge.sourcePort, 'output');
    const targetKind = resolvePortKind(targetNode, edge.targetPort, 'input');

    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: `${sourceKind}__${edge.sourcePort}`,
      targetHandle: `${targetKind}__${edge.targetPort}`,
      type: 'control',
    });
  }
  return result;
}
