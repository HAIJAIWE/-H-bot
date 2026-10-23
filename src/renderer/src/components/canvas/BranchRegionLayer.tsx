// src/renderer/src/components/canvas/BranchRegionLayer.tsx
//
// 阶段 5：分支区域背景层。
// 在画布上用半透明虚线框标注每个分支节点（branch_if/loop/try_catch/branch_switch）
// 的分支区域——从分支节点到其立即后支配节点（IPD）之间的所有控制流可达节点。
//
// 设计要点（复刻 SystemRegionLayer 模式）：
// - 用绝对定位 div 覆盖在 ReactFlow 画布之上（pointer-events: none，点击穿透）
// - 不使用 parentNode/Group 嵌套，避免与 ELK 自动布局冲突
// - 包围盒根据分支节点 → IPD 之间所有控制流可达节点的坐标计算
// - 通过 useViewport() 拿到画布 transform，把画布坐标映射到屏幕坐标
// - 必须作为 ReactFlow 的子组件渲染（这样 useViewport 才能拿到 context）
// - 4 种分支各用弱化色（4% bg + 35% border）：
//   - branch_if → emerald（绿，与 true 分支边色同源）
//   - loop → sky（蓝，与 body 分支边色同源）
//   - try_catch → amber（琥珀，与 catch 分支边色同源）
//   - branch_switch → violet（紫，与动态 case 调色板同源）
// - 渲染顺序在 SystemRegionLayer 之后：分支区域是系统分区的子集，DOM 顺序决定视觉叠加

import { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { useFlowStore } from '../../stores/flowStore';
import { computePostDominators, collectBranchNodes } from '../../lib/canvas/postDominator';
import { boundsOfNodes } from '../../lib/canvas/autoLayout';
import type { FlowNode } from '@shared/types/flow';

interface BranchRegion {
  id: string;
  branchNodeId: string;
  branchKind: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  bg: string;
  border: string;
}

/** 4 种分支节点的区域配色（弱化版，避免遮挡节点本体和连线） */
const BRANCH_REGION_COLORS: Record<string, { bg: string; border: string }> = {
  branch_if: { bg: 'rgba(16, 185, 129, 0.04)', border: 'rgba(16, 185, 129, 0.35)' }, // emerald
  loop: { bg: 'rgba(14, 165, 233, 0.04)', border: 'rgba(14, 165, 233, 0.35)' }, // sky
  try_catch: { bg: 'rgba(245, 158, 11, 0.04)', border: 'rgba(245, 158, 11, 0.35)' }, // amber
  branch_switch: { bg: 'rgba(139, 92, 246, 0.04)', border: 'rgba(139, 92, 246, 0.35)' }, // violet
};

/**
 * 是否画出分支区域框。
 *
 * ## 为什么默认**关**
 *
 * 这些框**没有任何交互**（整层 `pointer-events-none`）、**没有标签**，
 * 唯一作用是"用颜色提示这几个节点属于同一个 if/else 分支"。
 * 用户看了真机截图后的判断：「没啥用，纯影响视觉效果」——
 * 而且它和**节点分组框**叠在同一批节点上（项目里 31 个分组框 + 8 个分支框），
 * 两种虚线都偏灰，谁是谁很难分。
 *
 * ## 怎么开回来
 *
 * 改成 `true` 即可 —— 分析逻辑 `computeBranchRegions` 与它的测试**都还在**，没删。
 * 将来也可以做成设置项让用户自己决定。
 */
const SHOW_BRANCH_REGIONS = false;

const PADDING_X = 20;
const PADDING_Y = 24;

/** 计算所有分支节点的区域包围盒 */
function computeBranchRegions(
  nodes: FlowNode[],
  analysis: Array<{ branchNodeId: string; branchKind: string; collected: Set<string> }>,
): BranchRegion[] {
  const regions: BranchRegion[] = [];

  for (const res of analysis) {
    const collectedNodes = nodes.filter((n) => res.collected.has(n.id));

    // 单节点不画框（分支节点自身无扩展）
    if (collectedNodes.length < 2) continue;

    // 包围盒**含每个节点的真实高度**（见 boundsOfNodes 的说明：
    // 过去用 position.y 的最大值 + COLLAPSED_NODE_HEIGHT，比真实高度矮 18px，节点会伸出框外）
    const box = boundsOfNodes(collectedNodes);
    if (!box) continue;
    const { minX, minY, maxX, maxY } = box;

    const colors = BRANCH_REGION_COLORS[res.branchKind] ?? BRANCH_REGION_COLORS.branch_if;
    regions.push({
      id: `${res.branchNodeId}__branch-region`,
      branchNodeId: res.branchNodeId,
      branchKind: res.branchKind,
      minX,
      minY,
      maxX,
      maxY,
      bg: colors.bg,
      border: colors.border,
    });
  }

  return regions;
}

export function BranchRegionLayer() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const { x: vpX, y: vpY, zoom } = useViewport();

  // 拓扑签名：仅节点/边结构变化时变化（拖拽只改 position，签名不变）
  const topoSig = useMemo(
    () =>
      `${nodes.map((n) => n.id).join('|')}::${edges.map((e) => `${e.source}>${e.target}`).join('|')}`,
    [nodes, edges],
  );

  // 支配树 + 分支可达集合（与节点位置无关）：签名不变则复用，避免拖拽每帧重跑支配树/BFS
  const branchAnalysis = useMemo(() => {
    const ipdResults = computePostDominators(nodes, edges);
    return ipdResults
      .filter((res) => res.ipdId)
      .map((res) => ({
        branchNodeId: res.branchNodeId,
        branchKind: res.branchKind,
        collected: collectBranchNodes(res.branchNodeId, res.ipdId!, nodes, edges),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topoSig 已捕获节点/边的结构变化（位置无关指纹），拖拽时引用变化但签名不变，不应重算
  }, [topoSig]);

  // 包围盒必须跟随节点位置重算，但只遍历分支内节点（远便宜于支配树/BFS）
  const regions = useMemo(
    () => computeBranchRegions(nodes, branchAnalysis),
    [nodes, branchAnalysis],
  );

  // 关闭时**整个不渲染**（见文件头 SHOW_BRANCH_REGIONS 的说明）。
  // ⚠️ 这个 return 必须在所有 Hook **之后**，否则违反 Hooks 规则。
  if (!SHOW_BRANCH_REGIONS) return null;
  if (regions.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {regions.map((r) => {
        // 画布坐标 → 屏幕坐标：screen = canvas * zoom + viewport
        const left = r.minX * zoom + vpX - PADDING_X * zoom;
        const top = r.minY * zoom + vpY - PADDING_Y * zoom;
        // r.maxX/maxY 已是节点**右下角**（含真实宽高），所以这里不再 + NODE_WIDTH/高度
        const width = (r.maxX - r.minX + PADDING_X * 2) * zoom;
        const height = (r.maxY - r.minY + PADDING_Y * 2) * zoom;
        return (
          <div
            key={r.id}
            className="absolute border border-dashed rounded-lg"
            style={{
              left,
              top,
              width,
              height,
              backgroundColor: r.bg,
              borderColor: r.border,
            }}
          />
        );
      })}
    </div>
  );
}
