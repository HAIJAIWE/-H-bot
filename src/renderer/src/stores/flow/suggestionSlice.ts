// 连线建议列表与应用动作。applySuggestion 刻意复用 addEdge 的语义
// （可撤销 + 扇出去重 + 目标端口占用替换），而不是直接改 edges —— 这是拆分前就定好的行为，原样保留。

import { createEdge } from '../../lib/canvas/nodeFactory';
import { decodeHandleId } from '../../lib/canvas/reactFlowAdapter';
import type { FlowState, FlowSlice } from './types';

type SuggestionSlice = Pick<
  FlowState,
  | 'suggestions'
  | 'setSuggestions'
  | 'applySuggestion'
  | 'applyAllSuggestions'
  | 'dismissAllSuggestions'
>;

export const createSuggestionSlice: FlowSlice<SuggestionSlice> = (set, get) => ({
  suggestions: [],

  setSuggestions: (suggestions: any) => set({ suggestions }),

  applySuggestion: (suggestion: any) => {
    const sourcePortId = decodeHandleId(suggestion.sourceHandle).portId;
    const targetPortId = decodeHandleId(suggestion.targetHandle).portId;
    if (!sourcePortId || !targetPortId) return;
    // 复用 addEdge 语义：pushHistory（可撤销）+ 扇出去重 + 目标端口占用替换
    // （原实现直接 set：撤销不掉、不去重、同对重复边漏网）
    get().addEdge(
      createEdge(suggestion.sourceNodeId, sourcePortId, suggestion.targetNodeId, targetPortId),
    );
    set((s) => ({
      suggestions: s.suggestions.filter(
        (sug: any) =>
          !(
            sug.sourceNodeId === suggestion.sourceNodeId &&
            sug.targetNodeId === suggestion.targetNodeId
          ),
      ),
    }));
  },

  applyAllSuggestions: () => {
    const { suggestions } = get();
    for (const suggestion of suggestions) {
      get().applySuggestion(suggestion);
    }
  },

  dismissAllSuggestions: () => set({ suggestions: [] }),
});
