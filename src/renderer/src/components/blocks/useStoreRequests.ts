// src/renderer/src/components/blocks/useStoreRequests.ts
//
// **消费 store 请求**——从 `BlockEditor` 抽出的第一个 hook（拆分 Step 3a）。
//
// 这一块的性质最适合先抽：三个 `useEffect`、**没有任何输出**（纯"响应式副作用"），
// 输入只有 5 个（3 个来自 store 的请求字段 + 2 个来自编辑器的界面状态 setter）。
//
// 三个响应分别是：
//   · `errorFixRequest`      错误修复跳转：打开抽屉 + 高亮字段
//   · `recommendApplyRequest` AI 推荐：建节点 + 连线 + 高亮 + 聚焦
//   · `focusNodeId`          画布平移聚焦（大纲 / 子流程跳转等）
import { useEffect } from 'react';
import { useFlowStore } from '@renderer/stores/flowStore';
import { createNode, createEdge } from '../../lib/canvas/nodeFactory';
import { NODE_WIDTH } from '../../lib/canvas/canvasConstants';
import { focusNode } from '../../lib/canvas/reactFlowBridge';

export interface UseStoreRequestsOptions {
  errorFixRequest: { nodeId: string; fieldKey: string | null } | null | undefined;
  recommendApplyRequest:
    | {
        sourceNodeId: string;
        sourcePortId: string;
        nodeKind: string;
        targetPortId: string;
      }
    | null
    | undefined;
  focusNodeId: string | null;
  setDrawerNodeId: (v: string | null) => void;
  setHighlightField: (v: string | null) => void;
}

export function useStoreRequests(opts: UseStoreRequestsOptions): void {
  const {
    errorFixRequest,
    recommendApplyRequest,
    focusNodeId,
    setDrawerNodeId,
    setHighlightField,
  } = opts;
  const selectNode = useFlowStore((s) => s.selectNode);

  /** 错误修复跳转：打开抽屉 + 高亮字段 */
  useEffect(() => {
    if (!errorFixRequest) return;
    setDrawerNodeId(errorFixRequest.nodeId);
    selectNode(errorFixRequest.nodeId);
    setHighlightField(errorFixRequest.fieldKey);
    useFlowStore.getState().clearErrorFixRequest();
  }, [errorFixRequest, setDrawerNodeId, selectNode, setHighlightField]);

  /** AI 推荐应用：创建节点 + 连线 + 高亮 + 聚焦 */
  useEffect(() => {
    if (!recommendApplyRequest) return;
    const st = useFlowStore.getState();
    const req = recommendApplyRequest;
    const sourceNode = st.nodes.find((n) => n.id === req.sourceNodeId);
    const basePos = sourceNode
      ? { x: sourceNode.position.x + NODE_WIDTH + 80, y: sourceNode.position.y }
      : { x: 0, y: 0 };
    const newNode = createNode(req.nodeKind as never, basePos);
    st.addNode(newNode);
    if (sourceNode) {
      st.addEdge(createEdge(sourceNode.id, req.sourcePortId, newNode.id, req.targetPortId));
    }
    st.selectNode(newNode.id);
    st.highlightNodes([newNode.id]);
    focusNode(newNode.id);
    st.clearRecommendApplyRequest();
  }, [recommendApplyRequest]);

  /** focusNodeId 变化 → 画布平移聚焦（FlowOutline/子流程跳转等） */
  useEffect(() => {
    if (focusNodeId) focusNode(focusNodeId);
  }, [focusNodeId]);
}
