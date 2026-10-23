// AI/错误修复的**一次性请求**：CanvasNode 设置，BlockEditor 消费后清空（set null）。
// 不放进 selectionSlice 是因为它们不是选择态，而是"跨组件的命令通道"；
// 两者都是瞬态、不进历史、不落盘。

import type { FlowState, FlowSlice } from './types';

type AiRequestSlice = Pick<
  FlowState,
  | 'errorFixRequest'
  | 'recommendApplyRequest'
  | 'requestErrorFix'
  | 'clearErrorFixRequest'
  | 'requestApplyRecommend'
  | 'clearRecommendApplyRequest'
>;

export const createAiRequestSlice: FlowSlice<AiRequestSlice> = (set, _get) => ({
  errorFixRequest: null,
  recommendApplyRequest: null,

  // 阶段 7 Part A：错误节点一键修复请求
  requestErrorFix: (nodeId: string, fieldKey: string) => set({ errorFixRequest: { nodeId, fieldKey } }),

  clearErrorFixRequest: () => set({ errorFixRequest: null }),

  // 阶段 7 Part D：AI 主动推荐 — 应用推荐请求
  requestApplyRecommend: (req: any) => set({ recommendApplyRequest: req }),

  clearRecommendApplyRequest: () => set({ recommendApplyRequest: null }),
});
