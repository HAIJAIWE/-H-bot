// src/renderer/src/lib/executionOrder.ts
import type { FlowNode, FlowEdge } from '@shared/types/flow';

/** 常见的控制流入口端口名称（用于端口定义缺失时的回退推断） */
const CONTROL_INPUT_NAMES = new Set(['in']);

/** 控制流端口名称集合（用于端口定义缺失时的回退推断 + 边类型识别）。
 *  覆盖所有内置节点的控制流端口：
 *  - next/out: 通用顺序出口
 *  - true/false: branch_if 条件分支
 *  - body/done: loop 循环体/完成
 *  - try/catch/finally: try_catch 异常捕获三分支
 *  注：branch_switch 的动态分支端口（case label）不在此列，
 *      因为其 outputs 中只有 out 是 control，其余均为 data。
 */
export const CONTROL_PORT_NAMES = new Set([
  'next',
  'out',
  'true',
  'false',
  'body',
  'done',
  'try',
  'catch',
  'finally',
]);

/** 判断端口名是否为控制流端口（供其他模块复用，避免硬编码重复） */
export function isControlPortName(portName: string): boolean {
  return CONTROL_PORT_NAMES.has(portName);
}

/** 判断节点是否为子流程定义（subflow_defined）。
 *  subflow_defined 的 type 也是 'trigger'，但不应被事件直接触发，
 *  只能由 subflow_call 调用。调用方需据此区分真实触发器与子流程定义。
 */
export function isSubflowDefine(node: FlowNode): boolean {
  return node.data.nodeKind === 'subflow_defined';
}

/** 判断边是否为控制流边（任一端为控制端口即视为控制流边）。
 *  供 DataBindingSelect / BlockView / PropertyDrawer / flowStore 复用。
 */
export function isControlEdgeByName(edge: { sourcePort: string; targetPort: string }): boolean {
  return CONTROL_PORT_NAMES.has(edge.sourcePort) || CONTROL_PORT_NAMES.has(edge.targetPort);
}

/**
 * 获取节点的控制流入口端口（kind==='control' 的 input）。
 * 大多数节点只有一个控制入口；触发器没有。
 * 端口定义缺失时根据端口名称回退推断。
 */
export function getControlInput(node: FlowNode): { portId: string } | null {
  const port = node.data.inputs.find((p) => p.kind === 'control');
  if (port) return { portId: port.id };
  // 端口定义缺失时（如模板节点），根据端口名称回退推断
  if (node.data.inputs.length === 0) return null;
  const fallback = node.data.inputs.find((p) => CONTROL_INPUT_NAMES.has(p.id));
  return fallback ? { portId: fallback.id } : null;
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
