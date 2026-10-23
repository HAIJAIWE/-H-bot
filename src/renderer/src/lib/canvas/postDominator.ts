// src/renderer/src/lib/canvas/postDominator.ts
//
// 阶段 5：post-dominator analysis（立即后支配节点 IPD 计算）。
// 用于 BranchRegionLayer 找分支汇合点——所有分支出口最终汇合到的最近节点。
//
// 算法（标准 post-dominator 简化版）：
// 1. 对每个分支节点 X，获取所有控制出口端口（catalog 静态 control + branch_switch 动态 case）
// 2. 对每个出口端口，BFS 收集可达节点集合（含距离 dist）
// 3. 求所有分支可达集合的交集
// 4. IPD = 交集中"取所有分支到此节点的最大距离（最弱路径）"的最小值对应节点
// 5. 排除 IPD = 分支节点自身（自环场景）
// 6. 交集为空 → ipdId = null（分支未汇合，不画框）
//
// loop 回边处理：BFS 维护 visited Set 防止死循环，但允许 sourceId 被重新进入一次
// （reentered flag）。重新进入时扩展非 sourcePort 的出口，让 body 分支能通过回边到达
// done 之后的汇合点。详见 bfsReachableWithDist 注释。
//
// 复杂度：O(B × N × (V+E))，50 节点 / 5 分支 < 1ms；200 节点 / 20 分支 < 5ms。
//
// 关键复用：
// - isControlEdge from executionOrder.ts（含 branch_switch 动态分支识别）
// - getControlOutputs from executionOrder.ts（catalog 中的 control 出口）
// - parseSwitchCases from CanvasNode.tsx（branch_switch 动态 case 端口，单一数据源）

import type { FlowNode, FlowEdge } from '@shared/types/flow';
import { isControlEdge, getControlOutputs } from './executionOrder';
import { parseSwitchCases } from '../../components/canvas/CanvasNode';

export interface PostDominatorResult {
  /** 分支节点 ID */
  branchNodeId: string;
  /** 分支节点 kind（用于 BranchRegionLayer 选色） */
  branchKind: 'branch_if' | 'loop' | 'try_catch' | 'branch_switch';
  /** 立即后支配节点 ID；null = 分支未汇合（不画区域框） */
  ipdId: string | null;
  /** 分支的所有控制出口端口 ID（true/false/body/done/try/catch/finally/case labels） */
  branchOutputIds: string[];
}

const BRANCH_KINDS = new Set(['branch_if', 'loop', 'try_catch', 'branch_switch']);

/** 计算所有分支节点的立即后支配节点（IPD）。 */
export function computePostDominators(nodes: FlowNode[], edges: FlowEdge[]): PostDominatorResult[] {
  const results: PostDominatorResult[] = [];

  for (const node of nodes) {
    if (!BRANCH_KINDS.has(node.data.nodeKind)) continue;

    // 获取分支的所有控制出口端口：catalog 静态 control + branch_switch 动态 case
    const staticOutputs = getControlOutputs(node).map((p) => p.portId);
    // 与静态端口 id 冲突的 case label 必须排除（保留字），否则同一出口被重复计入分支数
    const dynamicCases = parseSwitchCases(
      node.data.nodeKind,
      node.data.config,
      new Set(staticOutputs),
    ).map((p) => p.id);
    const branchOutputIds = [...staticOutputs, ...dynamicCases];

    // 单出口节点不构成"分支"（如 branch_switch 仅有 out 静态出口时不算）
    if (branchOutputIds.length < 2) continue;

    // 收集每个分支出口的可达节点集合（含距离）
    const branchReachable = new Map<string, { id: string; dist: number }[]>();
    for (const outId of branchOutputIds) {
      const reachable = bfsReachableWithDist(node.id, outId, nodes, edges);
      branchReachable.set(outId, reachable);
    }

    // 求所有分支可达集合的交集。
    // 跳过悬空出口端口（可达集合为空 = 端口未连线）：悬空端口不应让其他汇合的分支失效。
    // 例：branch_switch 的 out 端口未连线时，5 个 case 都汇合到 merge 仍应识别 IPD = merge。
    // 若所有端口都悬空 → intersection 保持 null → IPD = null（分支未汇合）。
    let intersection: Set<string> | null = null;
    for (const [, list] of branchReachable) {
      if (list.length === 0) continue; // 跳过悬空出口
      const ids = new Set(list.map((r) => r.id));
      if (intersection === null) {
        intersection = ids;
      } else {
        const next = new Set<string>();
        for (const id of intersection) {
          if (ids.has(id)) next.add(id);
        }
        intersection = next;
      }
    }

    if (!intersection || intersection.size === 0) {
      // 分支未汇合
      results.push({
        branchNodeId: node.id,
        branchKind: node.data.nodeKind as PostDominatorResult['branchKind'],
        ipdId: null,
        branchOutputIds,
      });
      continue;
    }

    // IPD = 交集中"取所有分支到此节点的最大距离（最弱路径）"的最小值对应节点。
    // 跳过悬空端口（空 list）：距离计算只基于有连线的出口端口。
    let ipdId: string | null = null;
    let ipdMaxDist = Infinity;
    const reachableLists = [...branchReachable.values()].filter((list) => list.length > 0);
    for (const id of intersection) {
      // 此节点到每个分支的距离取最大值（最弱路径）
      const maxDist = Math.max(
        ...reachableLists.map((list) => {
          const found = list.find((r) => r.id === id);
          return found ? found.dist : Infinity;
        }),
      );
      if (maxDist < ipdMaxDist) {
        ipdMaxDist = maxDist;
        ipdId = id;
      }
    }

    // 排除 IPD = 分支节点自身（自环场景，理论不应发生但兜底）
    if (ipdId === node.id) ipdId = null;

    results.push({
      branchNodeId: node.id,
      branchKind: node.data.nodeKind as PostDominatorResult['branchKind'],
      ipdId,
      branchOutputIds,
    });
  }

  return results;
}

/**
 * 从 source 节点的指定出口端口出发 BFS 收集可达节点（含距离 dist）。
 * 不含 source 自身（result 中）。
 *
 * loop 回边处理：
 * - visited 不含 sourceId（允许回边一次）
 * - 当遇到 target === sourceId 时（回边到分支节点自身），用 reentered flag
 *   允许重新进入一次，扩展 sourceId 的非 sourcePort 出口到非 sourceId 的目标
 * - 重新进入后，再次遇到 target === sourceId 时跳过（visited 已含 sourceId 标记）
 *
 * 示例：loop 节点
 * - body → A → loop.in（回边）→ 此处 reentered=true，扩展 loop 的非 body 出口（done）→ merge
 * - done → merge（直接可达）
 * - body 可达集合 = {A, merge, D}，done 可达集合 = {merge, D}
 * - 交集 = {merge, D}，IPD = merge（距离更近）
 */
function bfsReachableWithDist(
  sourceId: string,
  sourcePort: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): { id: string; dist: number }[] {
  const result: { id: string; dist: number }[] = [];
  // visited 不含 sourceId，允许回边一次
  const visited = new Set<string>();
  // sourceReentered: sourceId 是否已被重新进入过（仅允许一次）
  let sourceReentered = false;
  const queue: { id: string; dist: number }[] = [];

  // 起点：sourcePort 出边的目标节点
  for (const edge of edges) {
    if (edge.source === sourceId && edge.sourcePort === sourcePort && isControlEdge(edge, nodes)) {
      if (edge.target !== sourceId && !visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({ id: edge.target, dist: 1 });
        result.push({ id: edge.target, dist: 1 });
      }
      // 若 target === sourceId（自环），忽略——不应有节点自己连自己
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === cur.id && isControlEdge(edge, nodes)) {
        const target = edge.target;

        // 回边到 sourceId：允许重新进入一次，扩展 sourceId 的非 sourcePort 出口
        if (target === sourceId) {
          if (sourceReentered) continue; // 已重新进入过，跳过防止死循环
          sourceReentered = true;
          // 扩展 sourceId 的所有非 sourcePort 出口（到非 sourceId 目标）
          for (const edge2 of edges) {
            if (
              edge2.source === sourceId &&
              edge2.sourcePort !== sourcePort &&
              isControlEdge(edge2, nodes) &&
              edge2.target !== sourceId &&
              !visited.has(edge2.target)
            ) {
              visited.add(edge2.target);
              // dist 经过 sourceId 中转，+2（cur→sourceId + sourceId→target）
              queue.push({ id: edge2.target, dist: cur.dist + 2 });
              result.push({ id: edge2.target, dist: cur.dist + 2 });
            }
          }
          continue;
        }

        if (!visited.has(target)) {
          visited.add(target);
          queue.push({ id: target, dist: cur.dist + 1 });
          result.push({ id: target, dist: cur.dist + 1 });
        }
      }
    }
  }

  return result;
}

/**
 * BFS 收集从分支节点 X 到 IPD 之间的所有控制流可达节点 ID（含 X 和 IPD）。
 * 遇到 IPD 后停止扩展（IPD 之后的节点不属于该分支区域）。
 * 带 visited Set 防止 loop 回边死循环。
 */
export function collectBranchNodes(
  branchNodeId: string,
  ipdId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): Set<string> {
  const collected = new Set<string>([branchNodeId]);
  const visited = new Set<string>([branchNodeId]);
  const queue: string[] = [branchNodeId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === ipdId) continue; // IPD 之后不再扩展
    for (const edge of edges) {
      if (edge.source === cur && isControlEdge(edge, nodes) && !visited.has(edge.target)) {
        visited.add(edge.target);
        collected.add(edge.target);
        if (edge.target !== ipdId) queue.push(edge.target);
      }
    }
  }
  return collected;
}
