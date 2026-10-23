// src/renderer/src/lib/canvas/executionOrder.ts
import type { FlowNode, FlowEdge } from '@shared/types/flow';
/**
 * ⚠️ 控制流端口的判定规则**已经搬到共享层**（`@shared/nodes/controlPorts`，2026-10-15）——
 * 因为主进程的 AI 预览也要用它；规则只写在渲染层时，主进程只能自己抄一份正则，
 * 结果两边对「出口能不能分叉」得出不同结论（分歧探测器抓到的那次）。
 *
 * 这里**再导出**同名符号，现有调用方（flowStore / BlockView / PropertyDrawer 等）不用改。
 */
import {
  CONTROL_INPUT_NAMES,
  CONTROL_PORT_NAMES,
  getControlInput,
  isControlEdgeByName,
  isControlPortName,
} from '@shared/nodes/controlPorts';
export { CONTROL_PORT_NAMES, isControlPortName, isControlEdgeByName, getControlInput };

/** 判断节点是否为子流程定义（subflow_defined）。
 *  subflow_defined 的 type 也是 'trigger'，但不应被事件直接触发，
 *  只能由 subflow_call 调用。调用方需据此区分真实触发器与子流程定义。
 */
export function isSubflowDefine(node: FlowNode): boolean {
  return node.data.nodeKind === 'subflow_defined';
}

/**
 * 获取节点的控制流出口端口列表。
 * 普通节点 1 个（如 'out'/'next'）；branch_if 有 2 个（true/false）；loop 有 2 个（body/done）。
 * 端口定义缺失时根据端口名称回退推断。
 */
export function getControlOutputs(node: FlowNode): { portId: string; name: string }[] {
  const controlPorts = node.data.outputs.filter((p) => p.kind === 'control');
  if (controlPorts.length > 0) {
    return controlPorts.map((p) => ({ portId: p.id, name: p.name }));
  }
  // 端口定义缺失时（如模板节点），根据端口名称回退推断
  return node.data.outputs
    .filter((p) => CONTROL_PORT_NAMES.has(p.id))
    .map((p) => ({ portId: p.id, name: p.name }));
}

/** 判断边是否为控制流边（source 端口是 control 类型）。
 *  带节点查找的精确判断：能正确处理 branch_switch 的动态分支端口（case label 不在 catalog 中，
 *  但属于控制流出口）。画布渲染/ELK 布局过滤控制流边时应使用本函数而非 isControlEdgeByName。
 *  isControlEdgeByName 仅按端口名判断，会漏掉 branch_switch 动态分支。
 *  nodes 可传 Map（高频路径如画布边转换时避免 O(N) find）。 */
export function isControlEdge(edge: FlowEdge, nodes: FlowNode[] | Map<string, FlowNode>): boolean {
  const sourceNode =
    nodes instanceof Map ? nodes.get(edge.source) : nodes.find((n) => n.id === edge.source);
  if (!sourceNode) return false;
  const sourcePort = sourceNode.data.outputs.find((p) => p.id === edge.sourcePort);
  if (sourcePort) return sourcePort.kind === 'control';

  // branch_switch 的分支端口是动态的（case label），不在 catalog 中定义
  // 如果 sourcePort 不在数据端口列表中，则认为是控制流边
  if (sourceNode.data.nodeKind === 'branch_switch') {
    const dataPortIds = sourceNode.data.outputs.filter((p) => p.kind === 'data').map((p) => p.id);
    return !dataPortIds.includes(edge.sourcePort);
  }

  // 端口定义缺失时（如模板节点），根据端口名称回退推断
  return CONTROL_PORT_NAMES.has(edge.sourcePort);
}

/**
 * 计算执行顺序（控制流 BFS）。
 *
 * - 从 trigger 节点开始 BFS 遍历控制流边
 * - 多 trigger 时返回多条链（每条链独立显示）
 * - 没有触发器时返回空数组（避免误把孤立节点当成链）
 *
 * 注意：返回值含 subflow_defined 链（其 type 也是 'trigger'）。
 * 调用方如需区分真实触发器与子流程定义，用 isSubflowDefine(chain.trigger) 判断。
 *
 * 这是 StepListPanel 顺序的"金标准"，逻辑复制自 main/codegen/topo.ts。
 */
export interface ExecutionChain {
  trigger: FlowNode;
  sequence: FlowNode[];
}

export function getExecutionChains(nodes: FlowNode[], edges: FlowEdge[]): ExecutionChain[] {
  const triggers = nodes.filter((n) => n.type === 'trigger');
  return triggers.map((trigger) => {
    const sequence = traverseControlFlow(trigger, nodes, edges);
    return { trigger, sequence };
  });
}

function traverseControlFlow(start: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const sequence: FlowNode[] = [start];
  const visited = new Set<string>([start.id]);
  const queue: string[] = [start.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const controlOutEdges = edges.filter((e) => e.source === currentId && isControlEdge(e, nodes));
    for (const edge of controlOutEdges) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (targetNode) {
          sequence.push(targetNode);
          queue.push(edge.target);
        }
      }
    }
  }

  return sequence;
}

/**
 * 获取从某个 trigger 出发的、未被任何控制流链包含的孤立节点。
 * 用于在 StepListPanel 末尾显示"未连接"节点，提示用户。
 */
export function getOrphanNodes(nodes: FlowNode[], chains: ExecutionChain[]): FlowNode[] {
  const chainIds = new Set<string>();
  for (const chain of chains) {
    for (const node of chain.sequence) {
      chainIds.add(node.id);
    }
  }
  return nodes.filter((n) => !chainIds.has(n.id));
}

/**
 * 找出两个节点之间的控制流边。
 */
export function findControlEdge(
  sourceId: string,
  targetId: string,
  edges: FlowEdge[],
  nodes: FlowNode[],
): FlowEdge | undefined {
  return edges.find(
    (e) => e.source === sourceId && e.target === targetId && isControlEdge(e, nodes),
  );
}

/**
 * 找出节点 A → 节点 B 之间所有边（含控制流和数据流）。
 */
export function findAllEdgesBetween(
  sourceId: string,
  targetId: string,
  edges: FlowEdge[],
): FlowEdge[] {
  return edges.filter((e) => e.source === sourceId && e.target === targetId);
}
