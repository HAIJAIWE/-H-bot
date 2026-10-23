// 系统分组（侧边栏里的"系统"）—— 只负责 systems 数组与链触发器归属；
// 删除系统会连带删掉其链上的节点，因此这里也要 pushHistory（行为与拆分前一致）。

import type { SystemGroup } from '@shared/types/flow';
import { isControlPortName } from '../../lib/canvas/executionOrder';
import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type SystemSlice = Pick<FlowState, 'systems' | 'addChainToSystem' | 'removeSystem'>;

export const createSystemSlice: FlowSlice<SystemSlice> = (set, _get) => ({
  systems: [],

  addChainToSystem: (systemId: any, triggerId: any) =>
    set((s) => ({
      systems: s.systems.map((g: SystemGroup) =>
        g.id === systemId && !g.chainTriggerIds.includes(triggerId)
          ? { ...g, chainTriggerIds: [...g.chainTriggerIds, triggerId] }
          : g,
      ),
    })),

  removeSystem: (systemId: any) =>
    set((s) => {
      const sys = s.systems.find((g: SystemGroup) => g.id === systemId);
      if (!sys) return s;
      // 删除整个系统是可撤销操作（C 修复：原实现不 pushHistory，撤销栈与 UI 状态不一致）
      pushHistory(s.nodes, s.edges);
      // 找出该系统下所有链的节点 ID
      const chainNodeIds = new Set<string>();
      for (const triggerId of sys.chainTriggerIds) {
        chainNodeIds.add(triggerId);
        // 沿控制流边收集后继节点（必须过滤 sourcePort 类型，否则会沿数据流边
        // 扩散到其他链路上的数据消费者，导致误删无关节点）
        const queue = [triggerId];
        const visited = new Set<string>();
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          for (const e of s.edges) {
            if (e.source === id && isControlPortName(e.sourcePort)) {
              const targetNode = s.nodes.find((n) => n.id === e.target);
              if (targetNode && !visited.has(e.target)) {
                chainNodeIds.add(e.target);
                queue.push(e.target);
              }
            }
          }
        }
      }
      return {
        nodes: s.nodes.filter((n) => !chainNodeIds.has(n.id)),
        edges: s.edges.filter((e) => !chainNodeIds.has(e.source) && !chainNodeIds.has(e.target)),
        systems: s.systems.filter((g: SystemGroup) => g.id !== systemId),
        selectedNodeId: chainNodeIds.has(s.selectedNodeId ?? '') ? null : s.selectedNodeId,
        // 清理被删节点的分组成员引用与多选状态（C 修复）
        selectedNodeIds: s.selectedNodeIds.filter((id: string) => !chainNodeIds.has(id)),
        nodeGroups: s.nodeGroups
          .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !chainNodeIds.has(id)) }))
          .filter((g) => g.nodeIds.length > 0),
      };
    }),
});
