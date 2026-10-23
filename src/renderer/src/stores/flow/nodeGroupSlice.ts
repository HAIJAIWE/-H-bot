// 节点分组（画布上的框）：创建/批量创建/删除/折叠/改名/查询归属。
// 分组**不在撤销栈里**（pushHistory 只快照 nodes/edges，这是拆分前就文档化的约定），
// 所以这里所有操作都不 pushHistory —— 保持与旧实现逐字一致。

import type { NodeGroup } from '@shared/types/flow';
import type { FlowState, FlowSlice } from './types';

type NodeGroupSlice = Pick<
  FlowState,
  | 'nodeGroups'
  | 'addNodeGroup'
  | 'addNodeGroups'
  | 'removeAllNodeGroups'
  | 'removeNodeGroup'
  | 'toggleNodeGroupCollapse'
  | 'renameNodeGroup'
  | 'isNodeInGroup'
>;

export const createNodeGroupSlice: FlowSlice<NodeGroupSlice> = (set, get) => ({
  nodeGroups: [],

  addNodeGroup: (title: string, nodeIds: string[]) =>
    set((s) => {
      if (nodeIds.length === 0) return s;
      const id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newGroup: NodeGroup = { id, title, nodeIds: [...nodeIds], collapsed: false };
      return { nodeGroups: [...s.nodeGroups, newGroup], selectedNodeIds: [] };
    }),

  addNodeGroups: (groups: NodeGroup[]) =>
    set((s) => {
      // 空组没有意义（会渲染成一个空框），直接滤掉而不是留个坑
      const valid = groups.filter((g: NodeGroup) => g.nodeIds.length > 0);
      if (valid.length === 0) return s;
      const stamp = Date.now();
      const created: NodeGroup[] = valid.map((g: NodeGroup, i: number) => ({
        id: `grp_${stamp}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        title: g.title,
        nodeIds: [...g.nodeIds],
        collapsed: g.collapsed,
      }));
      return { nodeGroups: [...s.nodeGroups, ...created], selectedNodeIds: [] };
    }),

  removeAllNodeGroups: () => set(() => ({ nodeGroups: [] })),

  removeNodeGroup: (groupId: string) =>
    set((s) => ({
      nodeGroups: s.nodeGroups.filter((g) => g.id !== groupId),
    })),

  toggleNodeGroupCollapse: (groupId: string) =>
    set((s) => ({
      nodeGroups: s.nodeGroups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
      ),
    })),

  renameNodeGroup: (groupId: string, title: string) =>
    set((s) => ({
      nodeGroups: s.nodeGroups.map((g) => (g.id === groupId ? { ...g, title } : g)),
    })),

  isNodeInGroup: (nodeId: string) => {
    const { nodeGroups } = get();
    for (const g of nodeGroups) {
      if (g.nodeIds.includes(nodeId)) return g;
    }
    return null;
  },
});
