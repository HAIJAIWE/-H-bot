// 撤销/重做对 UI 暴露的那一层：undo/redo/snapshot/rollback 与拖拽历史检查点。
// 真正的栈（_past/_future）在 ./historyStack 里是**模块级单例** ——
// 这里只是把它接到 store 上（含 undoDepth/redoDepth 的响应式镜像）。

import { _past, _future, _syncHistoryState, pushHistory } from './historyStack';
import type { FlowSnapshot, FlowState, FlowSlice } from './types';

/**
 * 本次拖拽是否**真的**压入过撤销点。
 *
 * `pushHistory` 在 history batch 未闭合时会静默跳过（返回 false），而
 * `cancelDragHistory` 原来无条件 `_past.pop()` —— 那种情况下它会**吃掉更早的一个
 * 合法撤销点**（2026-10-02 逐行审查发现，非本次重构引入）。用这个标记做配对。
 */
let dragHistoryPushed = false;

type HistorySlice = Pick<
  FlowState,
  | 'undoDepth'
  | 'redoDepth'
  | 'snapshot'
  | 'rollback'
  | 'undo'
  | 'redo'
  | 'canUndo'
  | 'canRedo'
  | 'beginDragHistory'
  | 'cancelDragHistory'
>;

export const createHistorySlice: FlowSlice<HistorySlice> = (set, get) => ({
  undoDepth: 0,
  redoDepth: 0,

  snapshot: () => {
    const { nodes, edges } = get();
    return {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      // 记录快照时的历史深度：rollback 时修剪 _past，撤销快照之后的中间态
      // （如批量操作期间/回滚前压入的条目），避免撤销栈出现与当前图不符的幻影历史
      historyDepth: _past.length,
    };
  },

  rollback: (prev: FlowSnapshot) => {
    // C 修复：恢复到快照同时作废快照之后的所有撤销单元（修剪 _past），并清空 redo
    if (typeof prev.historyDepth === 'number') {
      if (_past.length > prev.historyDepth) _past.length = prev.historyDepth;
    }
    _future.length = 0;
    _syncHistoryState();
    set({ nodes: prev.nodes, edges: prev.edges });
  },

  undo: () =>
    set((s) => {
      if (_past.length === 0) return s;
      const prev = _past.pop()!;
      _future.push({ nodes: structuredClone(s.nodes), edges: structuredClone(s.edges) });
      _syncHistoryState();
      return { nodes: prev.nodes, edges: prev.edges };
    }),

  redo: () =>
    set((s) => {
      if (_future.length === 0) return s;
      const next = _future.pop()!;
      _past.push({ nodes: structuredClone(s.nodes), edges: structuredClone(s.edges) });
      _syncHistoryState();
      return { nodes: next.nodes, edges: next.edges };
    }),

  canUndo: () => _past.length > 0,

  canRedo: () => _future.length > 0,

  beginDragHistory: () =>
    set((s) => {
      dragHistoryPushed = pushHistory(s.nodes, s.edges);
      return {};
    }),

  /** 取消拖拽产生的历史快照：onNodeDragStop 检测零位移拖拽时调用，避免空操作污染撤销栈 */
  cancelDragHistory: () => {
    // ★ 只有"真的压入过"才回退（见 dragHistoryPushed 的说明）：
    // 否则会误 pop 掉更早的一个合法撤销点。
    if (!dragHistoryPushed) return;
    dragHistoryPushed = false;
    _past.pop();
    _syncHistoryState();
  },
});
