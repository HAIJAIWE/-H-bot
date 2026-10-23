// src/renderer/src/components/canvas/SystemRegionLayer.tsx
//
// 阶段 3：系统分区背景层。
// 在画布上用半透明色块标注每个系统分区的范围，让用户一眼看出哪些节点属于同一系统。
//
// 阶段 4（子流程可视化）：额外渲染子流程定义区标注。
// 每个 subflow_defined 及其内部控制流可达节点构成一个紧凑块，用紫色虚线框标注
// 「📐 子流程:名称」，与主流程区视觉隔离（设计文档 5.7.1）。
//
// 设计要点（详见设计文档 5.5）：
// - 用绝对定位 div 覆盖在 ReactFlow 画布之上（pointer-events: none，点击穿透到画布）
// - 不使用 parentNode/Group 嵌套，避免与 ELK 自动布局冲突
// - 包围盒根据该系统触发器及其控制流可达节点的坐标计算
// - 通过 useViewport() 拿到画布 transform，把画布坐标映射到屏幕坐标
// - 必须作为 ReactFlow 的子组件渲染（这样 useViewport 才能拿到 context）

import { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { useFlowStore } from '../../stores/flowStore';
import { isControlEdge } from '../../lib/canvas/executionOrder';
import { boundsOfNodes, collectSubflowMembers } from '../../lib/canvas/autoLayout';
import type { FlowNode, FlowEdge, SystemGroup } from '@shared/types/flow';
import { t } from '../../i18n';

interface Region {
  systemId: string;
  name: string;
  icon: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 收集从给定触发器集合出发、沿控制流边可达的所有节点 ID（BFS）。
 *  与 executionOrder.getExecutionChains 类似，但更轻量：只关心可达性，不关心执行顺序。 */
function collectReachableNodeIds(
  triggerIds: string[],
  nodes: FlowNode[],
  edges: FlowEdge[],
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const tid of triggerIds) {
    if (nodes.some((n) => n.id === tid)) {
      reachable.add(tid);
      queue.push(tid);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current && !reachable.has(edge.target)) {
        // 仅沿控制流边走（数据流边不代表执行顺序传递）
        if (isControlEdge(edge, nodes)) {
          reachable.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
  }
  return reachable;
}

/** 计算每个系统的包围盒：触发器 + 控制流可达的所有节点 */
function computeRegions(
  nodes: FlowNode[],
  edges: FlowEdge[],
  systems: SystemGroup[],
  reachCache: Map<string, Set<string>>,
): Region[] {
  const regions: Region[] = [];
  for (const sys of systems) {
    if (sys.chainTriggerIds.length === 0) continue;
    const reachable = reachCache.get(sys.id);
    if (!reachable || reachable.size === 0) continue;
    const reachableNodes = nodes.filter((n) => reachable.has(n.id));
    if (reachableNodes.length === 0) continue;

    // 包围盒**含每个节点的真实高度**（见 boundsOfNodes 的说明）
    const box = boundsOfNodes(reachableNodes);
    if (!box) continue;
    regions.push({
      systemId: sys.id,
      name: sys.name,
      icon: sys.icon,
      ...box,
    });
  }
  return regions;
}

const PADDING_X = 24;
const PADDING_Y = 32;

/** 计算子流程块包围盒：define 节点 + 其内部控制流可达节点 */
function computeSubflowRegions(nodes: FlowNode[], membersCache: Map<string, string[]>): Region[] {
  const defineNodes = nodes.filter((n) => n.data.nodeKind === 'subflow_defined');
  const regions: Region[] = [];
  for (const define of defineNodes) {
    const members = membersCache.get(define.id) ?? [];
    const blockNodes = [
      define,
      ...members.map((id) => nodes.find((n) => n.id === id)!).filter(Boolean),
    ];
    if (blockNodes.length === 0) continue;
    // 包围盒**含每个节点的真实高度**（见 boundsOfNodes 的说明）
    const box = boundsOfNodes(blockNodes);
    if (!box) continue;
    const cfg = define.data.config as { subflow_name?: string } | undefined;
    regions.push({
      systemId: define.id,
      name: cfg?.subflow_name || t('drawer.unnamedSubflow'),
      icon: '📐',
      ...box,
    });
  }
  return regions;
}

export function SystemRegionLayer() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const systems = useFlowStore((s) => s.systems);
  const { x: vpX, y: vpY, zoom } = useViewport();

  // 拓扑签名：仅节点/边结构变化时变化（拖拽只改 position，签名不变）
  const topoSig = useMemo(
    () =>
      `${nodes.map((n) => n.id).join('|')}::${edges.map((e) => `${e.source}>${e.target}`).join('|')}`,
    [nodes, edges],
  );

  // 可达性分析（与节点位置无关）：签名不变则复用，避免拖拽每帧重跑 BFS
  const reachability = useMemo(
    () => {
      const systemReach = new Map<string, Set<string>>();
      for (const sys of systems) {
        systemReach.set(sys.id, collectReachableNodeIds(sys.chainTriggerIds, nodes, edges));
      }
      const subflowMembers = new Map<string, string[]>();
      for (const n of nodes) {
        if (n.data.nodeKind === 'subflow_defined') {
          subflowMembers.set(n.id, collectSubflowMembers(n.id, nodes, edges));
        }
      }
      return { systemReach, subflowMembers };
    },
    // 拓扑签名是位置无关的图结构指纹；nodes/edges 引用在拖拽时每帧变化但签名不变
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodes/edges 结构已由 topoSig 表示，引用变化不应触发重算
    [topoSig, systems],
  );

  // 包围盒必须跟随节点位置重算，但只遍历可达集合（远便宜于 BFS）
  const regions = useMemo(
    () => computeRegions(nodes, edges, systems, reachability.systemReach),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edges 结构已由 reachability 派生（topoSig 链），此处仅需节点位置变化触发
    [nodes, systems, reachability],
  );
  const subflowRegions = useMemo(
    () => computeSubflowRegions(nodes, reachability.subflowMembers),
    [nodes, reachability],
  );

  if (regions.length === 0 && subflowRegions.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {regions.map((r) => {
        // 画布坐标 → 屏幕坐标：screen = canvas * zoom + viewport
        const left = r.minX * zoom + vpX - PADDING_X * zoom;
        const top = r.minY * zoom + vpY - PADDING_Y * zoom;
        // r.maxX/maxY 已是节点**右下角**（含真实宽高），所以这里只加 padding
        const width = (r.maxX - r.minX + PADDING_X * 2) * zoom;
        const height = (r.maxY - r.minY + PADDING_Y * 2) * zoom;
        return (
          <div
            key={r.systemId}
            className="absolute border border-dashed border-zinc-600/40 rounded-lg bg-zinc-700/5"
            style={{ left, top, width, height }}
          >
            <div className="absolute -top-5 left-2 text-xs text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded whitespace-nowrap">
              {r.icon} {r.name}
            </div>
          </div>
        );
      })}
      {/* 子流程定义区标注（紫色虚线框，与系统分区区分） */}
      {subflowRegions.map((r) => {
        const left = r.minX * zoom + vpX - PADDING_X * zoom;
        const top = r.minY * zoom + vpY - PADDING_Y * zoom;
        // r.maxX/maxY 已是节点右下角（含真实宽高），只加 padding
        const width = (r.maxX - r.minX + PADDING_X * 2) * zoom;
        const height = (r.maxY - r.minY + PADDING_Y * 2) * zoom;
        return (
          <div
            key={`subflow-${r.systemId}`}
            className="absolute border border-dashed border-purple-500/40 rounded-lg bg-purple-500/5"
            style={{ left, top, width, height }}
          >
            <div className="absolute -top-5 left-2 text-xs text-purple-300 bg-zinc-900/80 px-1.5 py-0.5 rounded whitespace-nowrap">
              {r.icon} {r.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
