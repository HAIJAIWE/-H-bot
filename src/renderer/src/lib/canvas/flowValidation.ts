// src/renderer/src/lib/canvas/flowValidation.ts
import type { FlowEdge, Port } from '@shared/types/flow';
import type { FlowIssue } from '@shared/nodes/flowNormalize';

export interface PortEndpoint {
  nodeId: string;
  port: Port;
}

/**
 * 校验是否可以从 source 连到 target。
 * 规则：
 * - 端口 kind 必须相同（control ↔ control，data ↔ data）
 * - 不能自连
 * - 数据输入端口只能接收一条连线
 */
export function canConnect(
  source: PortEndpoint,
  target: PortEndpoint,
  existingEdges: FlowEdge[] = [],
): boolean {
  if (source.nodeId === target.nodeId) return false;
  if (source.port.kind !== target.port.kind) return false;
  if (target.port.kind === 'data') {
    const occupied = existingEdges.some(
      (e) => e.target === target.nodeId && e.targetPort === target.port.id,
    );
    if (occupied) return false;
  }
  return true;
}

/**
 * 把 `flow:validate` 的问题清单按节点归集：nodeId → 问题消息列表。
 *
 * 用途：画布节点上的 ⚠ 标记（`flowStore.setNodeIssues`）。没有 nodeId 的问题
 * （如"连线 X 指向不存在的节点"）无法落到具体节点，留在问题下拉里即可。
 */
export function groupIssuesByNode(issues: FlowIssue[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    (grouped[issue.nodeId] ??= []).push(issue.message);
  }
  return grouped;
}
