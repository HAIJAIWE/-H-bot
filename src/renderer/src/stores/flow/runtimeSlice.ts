// 运行态可视化：正在执行 / 已完成 / 出错的节点集合，以及主进程执行事件监听（initExecuteListener）。
// 这些是**一次运行的过程态**，与配置校验错误（validationSlice）各管一段；
// 跨项目事件在这里按当前项目路径过滤，避免把别的项目的节点点亮。

import { useProjectStore } from '../projectStore';
import { t } from '../../i18n';
import { _runtimeErrorMessages } from './nodeErrorCore';
import type { FlowState, FlowSlice } from './types';

type RuntimeSlice = Pick<
  FlowState,
  | 'executingNodeIds'
  | 'errorNodeIds'
  | 'doneNodeIds'
  | 'setExecutingNodes'
  | 'addExecutingNode'
  | 'removeExecutingNode'
  | 'clearExecutingNodes'
  | 'addDoneNode'
  | 'removeDoneNode'
  | 'clearDoneNodes'
  | 'setErrorNodes'
  | 'addErrorNode'
  | 'removeErrorNode'
  | 'clearErrorNodes'
  | 'initExecuteListener'
>;

export const createRuntimeSlice: FlowSlice<RuntimeSlice> = (set, get) => ({
  executingNodeIds: new Set(),
  errorNodeIds: new Set<string>(),
  doneNodeIds: new Set(),

  setExecutingNodes: (ids: string[]) => set({ executingNodeIds: new Set(ids) }),

  addExecutingNode: (id: string) =>
    set((s) => {
      if (s.executingNodeIds.has(id)) return s;
      const next = new Set(s.executingNodeIds);
      next.add(id);
      return { executingNodeIds: next };
    }),

  removeExecutingNode: (id: string) =>
    set((s) => {
      if (!s.executingNodeIds.has(id)) return s;
      const next = new Set(s.executingNodeIds);
      next.delete(id);
      return { executingNodeIds: next };
    }),

  clearExecutingNodes: () => set({ executingNodeIds: new Set() }),

  addDoneNode: (id: string) =>
    set((s) => {
      if (s.doneNodeIds.has(id)) return s;
      const next = new Set(s.doneNodeIds);
      next.add(id);
      return { doneNodeIds: next };
    }),

  removeDoneNode: (id: string) =>
    set((s) => {
      if (!s.doneNodeIds.has(id)) return s;
      const next = new Set(s.doneNodeIds);
      next.delete(id);
      return { doneNodeIds: next };
    }),

  clearDoneNodes: () => set({ doneNodeIds: new Set() }),

  setErrorNodes: (ids: string[]) => set({ errorNodeIds: new Set(ids) }),

  addErrorNode: (id: string) =>
    set((s) => {
      if (s.errorNodeIds.has(id)) return s;
      const next = new Set(s.errorNodeIds);
      next.add(id);
      return { errorNodeIds: next };
    }),

  removeErrorNode: (id: string) =>
    set((s) => {
      if (!s.errorNodeIds.has(id)) return s;
      const next = new Set(s.errorNodeIds);
      next.delete(id);
      return { errorNodeIds: next };
    }),

  clearErrorNodes: () => {
    _runtimeErrorMessages.clear();
    set({ errorNodeIds: new Set(), nodeErrors: {} });
  },

  initExecuteListener: () => {
    // 主进程发送的 payload 是 { projectPath, event } 包装对象，需解构取 event
    // （原实现把整个 payload 当作 event 用，导致 status/nodeId 都是 undefined，
    //  节点执行高亮/错误标记完全失效）
    return window.qqbat.runtime.onExecuteNode(({ projectPath, event }) => {
      // 多项目过滤：仅处理当前项目的节点事件，避免跨项目污染
      const currentPath = useProjectStore.getState().currentProject?.path;
      if (projectPath && currentPath && projectPath !== currentPath) return;
      if (event.status === 'enter') {
        // 重新执行 = 上一轮的运行时错误已经过期；配置校验错误不受影响
        get().clearRuntimeNodeError(event.nodeId);
        get().addExecutingNode(event.nodeId);
      } else if (event.status === 'exit') {
        get().removeExecutingNode(event.nodeId);
        get().addDoneNode(event.nodeId);
      } else if (event.status === 'error') {
        get().removeExecutingNode(event.nodeId);
        get().addErrorNode(event.nodeId);
        // 写真实原因（解释器带上来的 message），而不是笼统的"运行时错误"——
        // 用户不必翻「输出」面板才知道哪个节点为什么挂
        get().setRuntimeNodeError(event.nodeId, event.message || t('flow.runtimeError'));
      }
    });
  },
});
