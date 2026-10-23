// 校验与问题清单：配置校验错误（nodeErrors）、主进程统一校验结果（issues/nodeIssues）、
// 以及"打开项目时已有问题"的基线。
// 注意两套错误必须分开记账：nodeErrors 里既有静态配置错误也有运行时错误，
// 运行时的部分由 _runtimeErrorMessages 单独记（见 ./nodeErrorCore），
// 这样"节点重新开始执行"只清运行时那条，不会抹掉用户还没修的配置错误。

import { issueKey } from '@shared/nodes/issueBaseline';
import { findSpec } from '../../lib/node/nodeCatalog';
import { _computeNodeErrors, _runtimeErrorMessages } from './nodeErrorCore';
import type { FlowState, FlowSlice } from './types';

type ValidationSlice = Pick<
  FlowState,
  | 'nodeErrors'
  | 'nodeIssues'
  | 'issues'
  | 'issuesPanelOpen'
  | 'issueBaseline'
  | 'issueBaselineProject'
  | 'setNodeIssues'
  | 'setIssues'
  | 'setIssuesPanelOpen'
  | 'captureIssueBaseline'
  | 'setNodeErrors'
  | 'setRuntimeNodeError'
  | 'clearRuntimeNodeError'
  | 'clearNodeErrors'
  | 'validateNode'
  | 'validateAllNodes'
>;

export const createValidationSlice: FlowSlice<ValidationSlice> = (set, get) => ({
  nodeErrors: {},
  nodeIssues: {},
  issues: [],
  issuesPanelOpen: false,
  issueBaseline: new Set<string>(),
  issueBaselineProject: null,

  setNodeIssues: (issues: any) => set({ nodeIssues: issues }),

  setIssues: (issues: any) => set({ issues }),

  setIssuesPanelOpen: (open: any) => set({ issuesPanelOpen: open }),

  captureIssueBaseline: (projectPath: any) => {
    if (!projectPath) return;
    const { issueBaselineProject, issues } = get();
    if (issueBaselineProject === projectPath) return; // 本项目已经记过基线
    set({
      issueBaselineProject: projectPath,
      issueBaseline: new Set(issues.map(issueKey)),
    });
  },

  setNodeErrors: (nodeId: string, errors: any) =>
    set((s) => {
      const next = new Set(s.errorNodeIds);
      if (errors.length > 0) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return {
        // 空数组时删除 key，与 validateNode/clearNodeErrors 保持一致，
        // 避免 Object.keys(nodeErrors).length 误判为"有错误"
        nodeErrors:
          errors.length > 0
            ? { ...s.nodeErrors, [nodeId]: errors }
            : (() => {
                const { [nodeId]: _, ...rest } = s.nodeErrors;
                return rest;
              })(),
        errorNodeIds: next,
      };
    }),

  setRuntimeNodeError: (nodeId: string, message: any) => {
    _runtimeErrorMessages.set(nodeId, message);
    set((s) => {
      // 运行时原因排在最前：CanvasNode / PropertyDrawer 展示的是第一条
      const others = (s.nodeErrors[nodeId] ?? []).filter((msg: any) => msg !== message);
      return {
        nodeErrors: { ...s.nodeErrors, [nodeId]: [message, ...others] },
        errorNodeIds: (() => {
          const next = new Set(s.errorNodeIds);
          next.add(nodeId);
          return next;
        })(),
      };
    });
  },

  clearRuntimeNodeError: (nodeId: string) => {
    const message = _runtimeErrorMessages.get(nodeId);
    if (message === undefined) return;
    _runtimeErrorMessages.delete(nodeId);
    set((s) => {
      // 只摘掉运行时那条：用户还没修的配置校验错误保留
      const remaining = (s.nodeErrors[nodeId] ?? []).filter((msg: any) => msg !== message);
      const { [nodeId]: _removed, ...rest } = s.nodeErrors;
      if (remaining.length > 0) return { nodeErrors: { ...rest, [nodeId]: remaining } };
      const next = new Set(s.errorNodeIds);
      next.delete(nodeId);
      return { nodeErrors: rest, errorNodeIds: next };
    });
  },

  clearNodeErrors: (nodeId: string) =>
    set((s) => {
      _runtimeErrorMessages.delete(nodeId);
      const { [nodeId]: _, ...rest } = s.nodeErrors;
      const next = new Set(s.errorNodeIds);
      next.delete(nodeId);
      return { nodeErrors: rest, errorNodeIds: next };
    }),

  validateNode: (nodeId: string) => {
    const { nodes, edges, nodeErrors, errorNodeIds } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const spec = findSpec(node.data.nodeKind);
    if (!spec) return;
    const errors = _computeNodeErrors(node, spec, edges);
    // 引用级比较：错误未变化时不 set，避免每次校验都触发全 store 订阅者重渲染（C 修复）
    const current = nodeErrors[nodeId];
    if (errors.length === 0) {
      if (current === undefined && !errorNodeIds.has(nodeId)) return;
    } else if (
      current !== undefined &&
      current.length === errors.length &&
      current.every((msg: any, i: number) => msg === errors[i])
    ) {
      return;
    }
    set((s) => ({
      nodeErrors:
        errors.length > 0
          ? { ...s.nodeErrors, [nodeId]: errors }
          : (() => {
              const { [nodeId]: _, ...rest } = s.nodeErrors;
              return rest;
            })(),
      errorNodeIds: (() => {
        const next = new Set(s.errorNodeIds);
        if (errors.length > 0) {
          next.add(nodeId);
        } else {
          next.delete(nodeId);
        }
        return next;
      })(),
    }));
  },

  /** 校验所有节点配置，更新 nodeErrors 和 errorNodeIds */
  validateAllNodes: () => {
    const { nodes, edges } = get();
    const newNodeErrors: Record<string, string[]> = {};
    const newErrorNodeIds = new Set<string>();
    for (const node of nodes) {
      const spec = findSpec(node.data.nodeKind);
      if (!spec) continue;
      const errors = _computeNodeErrors(node, spec, edges);
      if (errors.length > 0) {
        newNodeErrors[node.id] = errors;
        newErrorNodeIds.add(node.id);
      }
    }
    set({ nodeErrors: newNodeErrors, errorNodeIds: newErrorNodeIds });
  },
});
