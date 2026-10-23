// 节点**属性**（位置/配置/输出端口/标题/描述/输入端口改名/展开态）。
// 与 graphSlice 的分界：这里改的是"某个节点长什么样"，不增删节点、不动拓扑；
// renameNodeInputPort 会同时改边，但仍属"端口配置"域（见该函数自己的长注释）。

import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type NodeSlice = Pick<
  FlowState,
  | 'updateNodePosition'
  | 'updateNodePositions'
  | 'updateNodeConfig'
  | 'updateNodeOutputs'
  | 'updateNodeLabel'
  | 'renameNodeInputPort'
  | 'updateNodeDescription'
  | 'setNodeExpanded'
>;

export const createNodeSlice: FlowSlice<NodeSlice> = (set, _get) => ({
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) =>
    set((s) => {
      // 节点不存在（拖拽中异步删除/卸载）时不产生新引用、不触发重渲染（C 修复）
      if (!s.nodes.some((n) => n.id === nodeId)) return {};
      return {
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
      };
    }),

  /** 批量更新节点位置：单次 set + 单次数组重建（布局落地用） */
  updateNodePositions: (positions: Map<string, { x: number; y: number }>) =>
    set((s) => {
      if (positions.size === 0) return {};
      let changed = false;
      const nodes = s.nodes.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return n;
        changed = true;
        return { ...n, position: pos };
      });
      return changed ? { nodes } : {};
    }),

  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) =>
    set((s) => {
      // 节点不存在（如内联字段卸载时节点已被删除）不压历史、不产生幽灵快照（C 修复）
      if (!s.nodes.some((n) => n.id === nodeId)) return {};
      pushHistory(s.nodes, s.edges);
      return {
        nodes: s.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, config: { ...n.data.config, ...config } } }
            : n,
        ),
      };
    }),

  updateNodeOutputs: (nodeId: string, outputs: Record<string, unknown>) =>
    set((s) => {
      if (!s.nodes.some((n) => n.id === nodeId)) return {};
      pushHistory(s.nodes, s.edges);
      return {
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, outputs } } : n)),
      };
    }),

  updateNodeLabel: (nodeId: string, label: string) =>
    set((s) => {
      // 与 updateNodeConfig 一致：改名可撤销（C 修复：原实现不进历史）
      if (!s.nodes.some((n) => n.id === nodeId)) return {};
      pushHistory(s.nodes, s.edges);
      return {
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)),
      };
    }),

  /**
   * 重命名节点的**输入端口**（变量槽）：`v1` → `hp`。
   *
   * 为什么必须是一个原子动作、而不是"调用方自己改 inputs 再改 edges"：
   * 端口 id 同时也是**表达式里的变量名**，改名会牵动三处，缺一处就是静默损坏：
   *
   * 1. `node.data.inputs[].id` —— 端口本身；
   * 2. **所有指向这个端口的边**的 `targetPort` —— 不改的话连线挂空（运行时就取不到值）；
   * 3. 那些边的 `targetHandle` —— 只在它**确实指的是这个端口**时把后缀换掉，
   *    并**保留它原来的前缀写法**。
   *
   * ⚠️ 关于 handle（2026-09-26 修正）：画布上真正渲染的 handle 是
   * `${端口类型}__${端口id}`（`encodeHandleId`：`control__in` / `data__var1`），
   * 而 `nodeFactory` 写的是 `${节点id}__${端口id}` —— **历史上有两套约定**，
   * 磁盘上还有 212/357 条压根没有 handle。
   * 所以：① 「谁连到这里」的提示已经改成**不看 handle**（见 `lib/canvas/connectedEdges.ts`）；
   * ② 这里不再"发明"某个约定，只把已有的 handle 后缀改对。逻辑不要建立在 handle 上。
   *
   * 表达式文本里的旧名字由**调用方**用 `renameVarInText` 一起改（那是纯逻辑，能单测）。
   *
   * 端口 `name`（画布上显示的名字）跟着改成新 id：用户给变量起名就是为了看懂它，
   * 显示还留着「变量1」会让画布和表达式对不上。
   */
  renameNodeInputPort: (nodeId: string, fromId: string, toId: string) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node || fromId === toId) return {};
      pushHistory(s.nodes, s.edges);
      return {
        nodes: s.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  inputs: (n.data.inputs ?? []).map((p) =>
                    p.id === fromId ? { ...p, id: toId, name: toId } : p,
                  ),
                },
              }
            : n,
        ),
        edges: s.edges.map((e) =>
          e.target === nodeId && e.targetPort === fromId
            ? {
                ...e,
                targetPort: toId,
                // handle 只改**后缀**、保留它原来的前缀写法（两种约定并存，见上面的说明）；
                // handle 指的本来就不是这个端口时一律不动。
                ...(() => {
                  const h = e.targetHandle;
                  if (!h || !h.includes('__')) return {};
                  const idx = h.indexOf('__');
                  const prefix = h.slice(0, idx);
                  const oldPort = h.slice(idx + 2);
                  return oldPort === fromId ? { targetHandle: `${prefix}__${toId}` } : {};
                })(),
              }
            : e,
        ),
      };
    }),

  updateNodeDescription: (nodeId: string, description: string) =>
    set((s) => {
      // 与 updateNodeConfig 一致：节点不存在时不压历史、不产生幽灵快照（C 修复）
      if (!s.nodes.some((n) => n.id === nodeId)) return {};
      pushHistory(s.nodes, s.edges);
      return {
        nodes: s.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, description } } : n,
        ),
      };
    }),

  setNodeExpanded: (nodeId: string, expanded: any) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, expanded } } : n)),
    })),
});
