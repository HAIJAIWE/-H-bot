// src/shared/nodes/connectionIssues.ts
//
// 连线/孤立相关的校验规则 —— **共享的唯一实现**。
//
// 为什么会有这个文件（事故）：项目里原来有**两个校验引擎**，互不包含、各说各话：
//   - 主进程 `flowNormalize.validateFlow`：查 未知 kind / 边指向不存在的节点或端口 / 必填配置 / 可达性；
//   - 渲染层 `lib/canvas/connectionValidator.validateGraph`：查 重复边 / 控制环 / 必填端口未连 / 数据类型 / 孤立节点。
// 同一份 246 节点的流程，画布右下角提示「61 个警告 + 1 个提示」，工具栏却显示「43 个提醒」——
// 用户看到哪个数字取决于看哪里（实测截图同屏可见两个数字）。
//
// 现在：规则只写在这里，主进程（validateFlow）与渲染层（connectionValidator）都调它。
//
// 注意边有两种形态：
//   - flow.json（磁盘/主进程）：`sourcePort` / `targetPort` 存端口 id；
//   - React Flow（画布）：`sourceHandle` / `targetHandle` 存 "nodeId__portId"。
// 所以取端口 id 一律走 `edgePortId()`，端口类型一律查节点自身，避免两套形状各写一份规则。
import { NODE_CATALOG_V2 } from './builtinCatalog';
import { isPortApplicable, type VisibilityPort } from './fieldVisibility';

export type ConnectionIssueLevel = 'error' | 'warning' | 'info';

/**
 * 这个节点是不是"流程入口"（触发器）。
 *
 * ⚠️ 必须同时看 `type` 与 `data.nodeKind`：磁盘上的 flow.json 里 `type === 'trigger'`，
 * 但画布（React Flow）上的节点 `type === 'canvasNode'`（组件类型），领域类型只在 `data.nodeKind`。
 * 事故（本轮实测）：可达性分析只用 `type === 'trigger'` 找起点 → 画布上找不到任何起点 →
 * 246 个节点里 200 多个被判成"没有任何入口"，画布提示 309 条而主进程只有 102 条。
 */
export function isTriggerLikeNode(node: IssueNodeLike): boolean {
  if (node.type === 'trigger') return true;
  const kind = node.data?.nodeKind;
  if (!kind) return false;
  return NODE_CATALOG_V2.find((s) => s.kind === kind)?.type === 'trigger';
}

/**
 * 这一层只依赖"长得像节点/边"的最小结构，不依赖 FlowNode/FlowEdge 的具体必填字段。
 * 原因：主进程校验的是 flow.json（`NormalizableNode`，没有 position），
 * 画布校验的是 React Flow 节点（多了 measured/selected 等）—— 两者都要能直接传进来。
 */
export interface IssuePortLike {
  id: string;
  /** 目录里 kind 可能缺省（旧流程的端口定义没写），因此这里可选 */
  kind?: string;
  name?: string;
  required?: boolean;
  default?: unknown;
  dataType?: string;
}

export interface IssueNodeLike {
  id: string;
  type?: string;
  data?: {
    label?: string;
    nodeKind?: string;
    /** 节点配置（属性面板里填的值也算"端口已满足"，见下方必填端口判定） */
    config?: Record<string, unknown>;
    inputs?: IssuePortLike[];
    outputs?: IssuePortLike[];
  };
}

export interface IssueEdgeLike {
  id?: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ConnectionIssue {
  level: ConnectionIssueLevel;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** 给界面的一行修复建议 */
  fixHint?: string;
}

export const CONNECTION_ERROR_CODES = {
  SAME_NODE: 'CONN_SAME_NODE',
  WRONG_PORT_KIND: 'CONN_WRONG_PORT_KIND',
  DATA_TYPE_MISMATCH: 'CONN_DATA_TYPE_MISMATCH',
  DUPLICATE_EDGE: 'CONN_DUPLICATE_EDGE',
  CONTROL_LOOP: 'CONN_CONTROL_LOOP',
  MISSING_REQUIRED_INPUT: 'CONN_MISSING_REQUIRED_INPUT',
  TRIGGER_CANNOT_BE_TARGET: 'CONN_TRIGGER_CANNOT_BE_TARGET',
  ISOLATED_NODE: 'CONN_ISOLATED_NODE',
} as const;

/** 边上的端口 id（兼容 flow.json 与 React Flow 两种形态） */
export function edgePortId(edge: IssueEdgeLike, side: 'source' | 'target'): string {
  const direct = side === 'source' ? edge.sourcePort : edge.targetPort;
  if (typeof direct === 'string' && direct) return direct;
  const handle = (side === 'source' ? edge.sourceHandle : edge.targetHandle) as string | undefined;
  if (typeof handle === 'string' && handle.includes('__')) {
    return handle.slice(handle.indexOf('__') + 2);
  }
  return handle ?? '';
}

/** 查节点某个方向上端口的类型（控制流 / 数据） */
function portKindOf(
  nodesById: Map<string, IssueNodeLike>,
  nodeId: string,
  portId: string,
  side: 'source' | 'target',
): string | undefined {
  const ports =
    (side === 'source'
      ? nodesById.get(nodeId)?.data?.outputs
      : nodesById.get(nodeId)?.data?.inputs) ?? [];
  return ports.find((p) => p.id === portId)?.kind;
}

/** 数据类型兼容规则（渲染层与主进程保持一致） */
export function isDataTypeCompatible(source: string, target: string): boolean {
  if (source === target) return true;
  if (target === 'any') return true;
  if (source === 'any') return true;
  if (source === 'number' && target === 'string') return true;
  return false;
}

/** 加一条控制流边后是否会形成环 */
export function wouldCreateControlLoop(
  sourceNode: IssueNodeLike,
  targetNode: IssueNodeLike,
  existingEdges: IssueEdgeLike[],
  nodesById: Map<string, IssueNodeLike>,
): boolean {
  const visited = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const sKind =
      portKindOf(nodesById, edge.source, edgePortId(edge, 'source'), 'source') ??
      (edge.sourceHandle?.split('__')[0] === 'control' ? 'control' : undefined);
    const tKind =
      portKindOf(nodesById, edge.target, edgePortId(edge, 'target'), 'target') ??
      (edge.targetHandle?.split('__')[0] === 'control' ? 'control' : undefined);
    if (sKind !== 'control' || tKind !== 'control') continue;
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }

  const dfs = (nodeId: string): boolean => {
    if (nodeId === sourceNode.id) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    return (adj.get(nodeId) ?? []).some((n) => dfs(n));
  };

  return dfs(targetNode.id);
}

/**
 * 扫整张图，找出连线层面上的问题。
 *
 * `alreadyReported`：已经由结构性校验（如 unreachable-node）报过的节点 ——
 * 孤立必然是"无入口"的子集，重复报同一件事只会让用户看到两倍数量的警告。
 */
export function collectConnectionIssues(
  nodes: IssueNodeLike[],
  edges: IssueEdgeLike[],
  alreadyReported?: Set<string>,
): ConnectionIssue[] {
  const issues: ConnectionIssue[] = [];

  for (const node of nodes) {
    if (isTriggerLikeNode(node)) continue;

    const ports = node.data?.inputs ?? [];
    // 目录里的 showWhen 才是"这个字段在当前模式下适不适用"的声明（唯一判定入口）。
    // 少了它，`expression_eval` 的「表达式」在 formulas 模式下会被报成"必填端口没接上"，
    // 而运行时根本不读它 —— 假警告（搭 RPG 主线时实测）。
    const spec = NODE_CATALOG_V2.find((s) => s.kind === node.data?.nodeKind);
    for (const port of ports) {
      if (!port.required) continue;
      const specPort = spec?.inputs.find((p) => p.id === port.id);
      if (
        specPort &&
        !isPortApplicable(specPort as VisibilityPort, node.data?.config ?? {}, spec?.defaultConfig)
      ) {
        continue;
      }
      const connected = edges.some(
        (e) => e.target === node.id && edgePortId(e, 'target') === port.id,
      );
      if (connected) continue;
      if (port.kind === 'data' && port.default !== undefined) continue; // 有默认值不算缺失
      // 属性面板里填了值同样算满足 —— 运行时的取值顺序就是「数据边 > config > 默认值」
      // （`nodeInputs.resolveInputKwargs`）。少了这一条，凡是"值存在 config 里"的
      // 必填端口都会误报：`expression_eval` 的「表达式」、`format_text` 的「模板」等，
      // 搭一条 RPG 主线就能刷出 17 条假警告。
      const configured = node.data?.config?.[port.id];
      if (
        port.kind === 'data' &&
        configured !== undefined &&
        configured !== null &&
        configured !== ''
      ) {
        continue;
      }

      issues.push({
        level: 'warning',
        code: CONNECTION_ERROR_CODES.MISSING_REQUIRED_INPUT,
        message:
          port.kind === 'control'
            ? `节点 "${node.data?.label || node.id}" 的必填控制入口 "${port.name}" 未连接`
            : `节点 "${node.data?.label || node.id}" 的必填数据端口 "${port.name}" 未绑定`,
        nodeId: node.id,
        fixHint:
          port.kind === 'control'
            ? '请从上游节点拖拽控制流线到此入口'
            : '请在属性面板绑定数据来源，或连接上游数据输出端口',
      });
    }
  }

  for (const node of nodes) {
    if (isTriggerLikeNode(node)) continue;
    if (alreadyReported?.has(node.id)) continue; // 已按"没有任何入口"报过，不再重复
    const hasAnyEdge = edges.some((e) => e.source === node.id || e.target === node.id);
    if (!hasAnyEdge) {
      issues.push({
        level: 'info',
        code: CONNECTION_ERROR_CODES.ISOLATED_NODE,
        message: `节点 "${node.data?.label || node.id}" 孤立（无任何连线）`,
        nodeId: node.id,
        fixHint: '请将其接入流程，或删除无用节点',
      });
    }
  }

  return issues;
}
