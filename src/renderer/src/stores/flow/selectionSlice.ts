// 选择 / 高亮 / 焦点 / 连线拖拽的临时 UI 态：单选、多选、AI 高亮、搜索命中、连线起点与兼容端口。
// 这些字段都**不进撤销栈、不写 flow.json**（见 exportGraph 只导出图数据），
// 集中成片是为了让"选中态变更"这件事只有一个入口。

import type { FlowState, FlowSlice } from './types';

type SelectionSlice = Pick<
  FlowState,
  | 'selectNode'
  | 'selectAllNodes'
  | 'selectedNodeIds'
  | 'focusNodeId'
  | 'highlightedNodeIds'
  | 'searchMatchIds'
  | 'connectingFromPort'
  | 'compatibleTargetPorts'
  | 'toggleMultiSelect'
  | 'clearMultiSelect'
  | 'setMultiSelect'
  | 'setFocusNode'
  | 'highlightNodes'
  | 'setSearchHighlights'
  | 'setConnectingFromPort'
  | 'setCompatibleTargetPorts'
>;

export const createSelectionSlice: FlowSlice<SelectionSlice> = (set, get) => ({
  selectedNodeIds: [],
  focusNodeId: null,
  highlightedNodeIds: new Set(),
  searchMatchIds: new Set(),
  connectingFromPort: null,
  compatibleTargetPorts: new Map(),

  // 阶段 8 Part A：单选时清空多选集合（普通点击应清空多选，符合标准交互）
  selectNode: (nodeId: string) => set({ selectedNodeId: nodeId, selectedNodeIds: [] }),

  // Ctrl+A 全选：进入多选模式（selectedNodeId=null，selectedNodeIds=全部可见节点）
  selectAllNodes: (nodeIds: string[]) => set({ selectedNodeId: null, selectedNodeIds: nodeIds }),

  toggleMultiSelect: (nodeId: string) =>
    set((s) => ({
      selectedNodeIds: s.selectedNodeIds.includes(nodeId)
        ? s.selectedNodeIds.filter((id: string) => id !== nodeId)
        : [...s.selectedNodeIds, nodeId],
    })),

  clearMultiSelect: () => set({ selectedNodeIds: [] }),

  setMultiSelect: (nodeIds: string[]) =>
    set((s) => ({
      selectedNodeIds:
        nodeIds.length > 0 && s.selectedNodeIds.length === nodeIds.length ? [] : [...nodeIds],
    })),

  setFocusNode: (id: string) => set({ focusNodeId: id }),

  highlightNodes: (ids: string[]) => {
    const highlightSet = new Set(ids);
    set({ highlightedNodeIds: highlightSet });
    // 3秒后自动清除（与 foldToSubflow 的 setFocusNode 模式一致）
    // 仅在当前高亮仍是本次设置时清除（避免被后续调用覆盖后又误清）
    setTimeout(() => {
      if (get().highlightedNodeIds === highlightSet) {
        set({ highlightedNodeIds: new Set() });
      }
    }, 3000);
  },

  // 搜索匹配高亮：持续高亮，无自动清除；与 AI 高亮（highlightNodes 3秒清除）独立
  /**
   * 设置搜索高亮节点。
   *
   * ⚠️ **必须幂等**：内容是同一批 id 时不换 `Set` 引用。
   * 原实现无条件 `new Set(ids)` —— 拖拽期间调用方每帧都会调它（nodes 每帧换引用
   * 导致依赖它的 effect 每帧重跑），于是每帧产生一次 store 写入 + 通知全部订阅者
   * （`CanvasNode` 每个节点都订阅 searchMatchIds）→ 拖拽掉帧（2026-10-02 性能排查）。
   */
  setSearchHighlights: (ids: string[]) =>
    set((s) => {
      if (s.searchMatchIds.size === ids.length && ids.every((id: string) => s.searchMatchIds.has(id))) {
        return {}; // 内容未变：不改引用、不触发任何重渲染
      }
      return { searchMatchIds: new Set(ids) };
    }),

  // 连线起点端口高亮：onConnectStart 设置，onConnectEnd 清空
  setConnectingFromPort: (port: any) => set({ connectingFromPort: port }),

  /** 设置兼容目标端口（拖拽时实时计算，用于高亮/置灰） */
  setCompatibleTargetPorts: (ports: any) => set({ compatibleTargetPorts: ports }),
});
