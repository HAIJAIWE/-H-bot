// 局部重布局（ELK 子图）：锚点取子图当前最小 x,y，落地时单次批量更新位置。
// 动态 import 自动布局模块是刻意的 —— 布局算法体积大，只在真正布局时才加载。

import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type LayoutSlice = Pick<FlowState, 'relayoutNodes'>;

export const createLayoutSlice: FlowSlice<LayoutSlice> = (set, get) => ({
  // 阶段 7 Part C：局部重布局
  relayoutNodes: async (nodeIds: string[]) => {
    if (nodeIds.length < 2) return; // 单节点无需重布局
    const { nodes, edges } = get();
    const subNodes = nodes.filter((n) => nodeIds.includes(n.id));
    if (subNodes.length < 2) return;

    // 锚点：子图当前最小 x,y（保持子图整体位置不变）
    const minX = Math.min(...subNodes.map((n) => n.position.x));
    const minY = Math.min(...subNodes.map((n) => n.position.y));

    pushHistory(nodes, edges);
    try {
      const { layoutSubgraph } = await import('../../lib/canvas/autoLayout');
      const positions = await layoutSubgraph(subNodes, edges, { x: minX, y: minY });
      get().updateNodePositions(positions);
    } catch (e) {
      console.warn('[relayoutNodes] 子图布局失败:', e);
    }
  },
});
