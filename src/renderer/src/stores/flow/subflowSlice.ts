// 折叠成子流程：把一段连续节点抽成 subflow_defined，原位置插入 subflow_call。
// 注意 pushHistory 必须在**所有校验都通过之后**才调用（旧实现放在开头，5 处 return null
// 会清空 redo 并压入幻影快照）—— 这个顺序是行为的一部分，原样保留。

import type { FlowEdge } from '@shared/types/flow';
import { createEdge, createNode } from '../../lib/canvas/nodeFactory';
import { getControlInput, getControlOutputs } from '../../lib/canvas/executionOrder';
import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type SubflowSlice = Pick<FlowState, 'foldToSubflow'>;

export const createSubflowSlice: FlowSlice<SubflowSlice> = (set, get) => ({
  foldToSubflow: (nodeIds: string[], name: string) => {
    const { nodes, edges } = get();
    if (nodeIds.length === 0) return null;
    // 不允许包含触发器
    if (
      nodeIds.some((id: string) => {
        const n = nodes.find((nn) => nn.id === id);
        return n?.type === 'trigger';
      })
    )
      return null;

    // 按控制流顺序排序选中节点：找到首节点（入边来自选中集合外或无入边）
    const selectedSet = new Set(nodeIds);
    // 控制流入边：source 不在选中集合中的节点为首节点候选
    const firstCandidates = nodeIds.filter((id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return false;
      const inPort = getControlInput(node);
      if (!inPort) return true;
      const inEdge = edges.find((e) => e.target === id && e.targetPort === inPort.portId);
      // 入边不存在或来源不在选中集合 → 是首节点候选
      return !inEdge || !selectedSet.has(inEdge.source);
    });
    if (firstCandidates.length !== 1) return null;
    const firstId = firstCandidates[0];

    // 沿控制流从首节点遍历，确定选中节点在链上的顺序
    const ordered: string[] = [firstId];
    const remaining = new Set(nodeIds.filter((id: string) => id !== firstId));
    let currentId: string | undefined = firstId;
    while (remaining.size > 0 && currentId) {
      const currentNode = nodes.find((n) => n.id === currentId);
      if (!currentNode) break;
      const outPorts = getControlOutputs(currentNode);
      // 找下一个选中节点：当前节点的任一控制流出口连到 remaining 中的节点
      let nextId: string | undefined;
      for (const port of outPorts) {
        const edge = edges.find((e) => e.source === currentId && e.sourcePort === port.portId);
        if (edge && remaining.has(edge.target)) {
          nextId = edge.target;
          break;
        }
      }
      if (!nextId) break;
      ordered.push(nextId);
      remaining.delete(nextId);
      currentId = nextId;
    }
    if (remaining.size > 0) return null; // 选中节点不连续

    const firstNode = nodes.find((n) => n.id === ordered[0]);
    const lastNode = nodes.find((n) => n.id === ordered[ordered.length - 1]);
    if (!firstNode || !lastNode) return null;

    // 找首节点的前驱（控制流入口边）
    const firstInPort = getControlInput(firstNode);
    const prevEdge = firstInPort
      ? edges.find((e) => e.target === firstNode.id && e.targetPort === firstInPort.portId)
      : undefined;
    const prevNode = prevEdge ? nodes.find((n) => n.id === prevEdge.source) : null;
    const prevOutPort =
      prevNode && prevEdge
        ? getControlOutputs(prevNode).find((p) => p.portId === prevEdge.sourcePort)
        : null;

    // 找尾节点的后继（控制流出口边，单出口节点）
    const lastOutPorts = getControlOutputs(lastNode);
    // 尾节点必须单出口（否则折叠会丢失分支）
    const nextEdge =
      lastOutPorts.length === 1
        ? edges.find((e) => e.source === lastNode.id && e.sourcePort === lastOutPorts[0].portId)
        : undefined;
    const nextNode = nextEdge ? nodes.find((n) => n.id === nextEdge.target) : null;
    const nextInPort = nextNode ? getControlInput(nextNode) : null;

    // 创建 subflow_defined 节点（trigger 类型）
    const defineNode = createNode('subflow_defined', { x: 0, y: 0 });
    defineNode.data.config = {
      subflow_name: name,
      params: '[]', // 默认无参数，用户后续可在抽屉中配置
    };

    // 创建 subflow_call 节点（action 类型）
    const callNode = createNode('subflow_call', { x: 0, y: 0 });
    callNode.data.config = { subflow_id: defineNode.id };

    // 构建新边和新节点列表
    const newEdges: FlowEdge[] = [];
    const removeEdgeIds = new Set<string>();

    // 1. 断开前驱→首节点
    if (prevEdge) removeEdgeIds.add(prevEdge.id);
    // 2. 断开尾节点→后继
    if (nextEdge) removeEdgeIds.add(nextEdge.id);

    // 3. subflow_defined.next → 首节点
    const defineNextPort = defineNode.data.outputs.find((p) => p.id === 'next');
    const firstInPortForDefine = getControlInput(firstNode);
    if (!defineNextPort || !firstInPortForDefine) return null;
    newEdges.push(
      createEdge(defineNode.id, defineNextPort.id, firstNode.id, firstInPortForDefine.portId),
    );

    // 4. 前驱 → subflow_call → 后继
    const callInPort = getControlInput(callNode);
    const callOutPort = getControlOutputs(callNode)[0]; // 'out' 端口
    if (!callInPort || !callOutPort) return null;
    if (prevNode && prevOutPort) {
      newEdges.push(createEdge(prevNode.id, prevOutPort.portId, callNode.id, callInPort.portId));
    }
    if (nextNode && nextInPort) {
      newEdges.push(createEdge(callNode.id, callOutPort.portId, nextNode.id, nextInPort.portId));
    }

    const filteredEdges = edges.filter((e) => !removeEdgeIds.has(e.id));

    // 所有校验通过，仅在此时点 push history，避免失败路径污染撤销栈
    // （原实现 pushHistory 在函数开头，5 处 return null 会清空 _future 并压入幻影快照）
    pushHistory(nodes, edges);

    set({
      nodes: [...nodes, defineNode, callNode],
      edges: [...filteredEdges, ...newEdges],
      selectedNodeIds: [],
      focusNodeId: defineNode.id,
    });
    return defineNode.id;
  },
});
