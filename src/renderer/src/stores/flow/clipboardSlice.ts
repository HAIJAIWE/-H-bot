// 剪贴板（内存态，不持久化）与对齐。复制/粘贴只处理节点与它们之间的内部边；
// 粘贴位置 +40,+40 且会递增剪贴板坐标（多次粘贴不重叠）—— 这两个偏移量是既有行为，未改。

import type { FlowNode, FlowEdge } from '@shared/types/flow';
import { createNode } from '../../lib/canvas/nodeFactory';
import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type ClipboardSlice = Pick<
  FlowState,
  'clipboard' | 'copySelectedNodes' | 'pasteNodes' | 'alignNodes'
>;

export const createClipboardSlice: FlowSlice<ClipboardSlice> = (set, get) => ({
  clipboard: null,

  // 阶段 8 Part B：复制选中节点到剪贴板（含内部边）
  copySelectedNodes: () => {
    const { nodes, edges, selectedNodeIds, selectedNodeId } = get();
    // 多选优先；无多选时尝试单选
    let targetIds = selectedNodeIds;
    if (targetIds.length === 0 && selectedNodeId) {
      targetIds = [selectedNodeId];
    }
    if (targetIds.length === 0) return;
    const selectedSet = new Set(targetIds);
    const selectedNodes = nodes.filter((n) => selectedSet.has(n.id));
    if (selectedNodes.length === 0) return;
    // 内部边：source 和 target 都在选中集合中
    const internalEdges = edges.filter(
      (e) => selectedSet.has(e.source) && selectedSet.has(e.target),
    );
    set({
      clipboard: { nodes: structuredClone(selectedNodes), edges: structuredClone(internalEdges) },
    });
  },

  // 阶段 8 Part B：粘贴剪贴板内容，位置偏移 +40,+40
  pasteNodes: () => {
    const { clipboard } = get();
    if (!clipboard || clipboard.nodes.length === 0) return [];

    pushHistory(get().nodes, get().edges);

    // ID 映射：旧 ID → 新 ID
    const idMap = new Map<string, string>();
    const newNodes: FlowNode[] = [];
    for (const oldNode of clipboard.nodes) {
      // 用 createNode 分配新 ID（递增计数器），但保留 label 和 config
      const newNode = createNode(oldNode.data.nodeKind, {
        x: oldNode.position.x + 40,
        y: oldNode.position.y + 40,
      });
      if (oldNode.data.label) newNode.data.label = oldNode.data.label;
      newNode.data.config = structuredClone(oldNode.data.config);
      if (oldNode.data.description) newNode.data.description = oldNode.data.description;
      idMap.set(oldNode.id, newNode.id);
      newNodes.push(newNode);
    }

    // 重映射内部边的 source/target
    const newEdges: FlowEdge[] = clipboard.edges.map((e: FlowEdge) => ({
      ...e,
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));

    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
    }));

    // 阶段 8 打磨 #6：更新 clipboard 中节点位置（递增偏移，避免多次粘贴重叠）
    set({
      clipboard: {
        nodes: clipboard.nodes.map((n: any) => ({
          ...n,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
        })),
        edges: clipboard.edges,
      },
    });

    // 高亮新增节点 + 聚焦第一个
    const newIds = newNodes.map((n) => n.id);
    get().highlightNodes(newIds);
    get().setFocusNode(newIds[0]);
    return newIds;
  },

  // 阶段 8 打磨 #5：对齐选中节点位置
  alignNodes: (nodeIds: string[], type: any) => {
    if (nodeIds.length < 2) return;
    const { nodes } = get();
    const targetNodes = nodes.filter((n) => nodeIds.includes(n.id));
    if (targetNodes.length < 2) return;
    pushHistory(get().nodes, get().edges);
    const xs = targetNodes.map((n) => n.position.x);
    const ys = targetNodes.map((n) => n.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // 节点宽度固定 200px，右对齐=左边缘对齐到最右节点的左边缘
    const targetX = type === 'left' ? minX : type === 'right' ? maxX : null;
    const targetY = type === 'top' ? minY : type === 'bottom' ? maxY : null;
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (!nodeIds.includes(n.id)) return n;
        return {
          ...n,
          position: {
            x: targetX !== null ? targetX : n.position.x,
            y: targetY !== null ? targetY : n.position.y,
          },
        };
      }),
    }));
  },
});
