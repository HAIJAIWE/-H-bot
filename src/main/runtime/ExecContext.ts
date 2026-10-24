/**
 * 执行上下文 —— 从迁移前 Python 解释器的 _ExecContext 移植
 *
 * 维护变量表（key: "nodeId:portId"）、控制流索引、数据流索引。
 */

// 图结构以 shared 类型为唯一真源（运行时不另立一套，否则 FlowInterpreter 与
// nodeInputs/controlFlow 之间的结构不兼容 —— TS2345 满地都是）。
import type { FlowEdge, FlowGraph, FlowNode } from '../../shared/types/flow';

export type { FlowEdge, FlowGraph, FlowNode };

/** 控制流索引：source → [(sourcePort, targetId)] */
export type ControlOutIndex = Map<string, Array<[string, string]>>;

/** 数据流索引：targetId → { targetPort: edge } */
export type DataInIndex = Map<string, Map<string, FlowEdge>>;

/** 构建控制流/数据流索引（供 Interpreter 缓存复用） */
export function buildGraphIndexes(edges: FlowEdge[]): {
  controlOut: ControlOutIndex;
  dataIn: DataInIndex;
} {
  const controlOut: ControlOutIndex = new Map();
  const dataIn: DataInIndex = new Map();

  for (const edge of edges) {
    const src = edge.source ?? '';
    const srcPort = edge.sourcePort ?? '';
    const tgt = edge.target ?? '';
    const tgtPort = edge.targetPort ?? '';

    if (!controlOut.has(src)) controlOut.set(src, []);
    controlOut.get(src)!.push([srcPort, tgt]);

    if (!dataIn.has(tgt)) dataIn.set(tgt, new Map());
    const portMap = dataIn.get(tgt)!;
    if (!portMap.has(tgtPort)) portMap.set(tgtPort, edge);
  }

  return { controlOut, dataIn };
}

/**
 * 链执行上下文。
 * variables 的 key 为 "nodeId:portId"，value 为端口值。
 */
export class ExecContext {
  readonly graph: FlowGraph;
  readonly nodesById: Map<string, FlowNode>;
  readonly edges: FlowEdge[];
  readonly variables: Record<string, unknown>;
  readonly traceId: string;
  /**
   * 链标识：同一条逻辑链跨事件恢复时保持不变（`wait_input` 挂起/唤醒用）。
   * 缺省等于本次事件的 traceId —— 即"本次事件就是一条新链"。
   */
  readonly chainId: string;

  /** 已执行节点 ID 列表（按执行顺序，供自动变量解析） */
  readonly executedNodes: string[] = [];
  private readonly executedSet = new Set<string>();

  /** subflow 递归深度（防止循环调用栈溢出） */
  subflowDepth: number;

  private readonly controlOut: ControlOutIndex;
  private readonly dataIn: DataInIndex;

  constructor(
    graph: FlowGraph,
    nodesById: Map<string, FlowNode>,
    edges: FlowEdge[],
    variables: Record<string, unknown>,
    traceId: string,
    controlOut?: ControlOutIndex,
    dataIn?: DataInIndex,
    subflowDepth = 0,
    chainId?: string,
  ) {
    this.graph = graph;
    this.nodesById = nodesById;
    this.edges = edges;
    this.variables = variables;
    this.traceId = traceId;
    this.chainId = chainId ?? traceId;
    this.subflowDepth = subflowDepth;

    if (controlOut && dataIn) {
      this.controlOut = controlOut;
      this.dataIn = dataIn;
    } else {
      const idx = buildGraphIndexes(edges);
      this.controlOut = idx.controlOut;
      this.dataIn = idx.dataIn;
    }
  }

  /** 记录已执行节点（O(1) 去重） */
  recordExecuted(nodeId: string): void {
    if (!this.executedSet.has(nodeId)) {
      this.executedSet.add(nodeId);
      this.executedNodes.push(nodeId);
    }
  }

  /** 收集 variable_set 设置的全局变量（key 前缀 "__var__:"） */
  collectGlobalVars(exclude?: Set<string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const excludeSet = exclude ?? new Set();
    for (const [k, v] of Object.entries(this.variables)) {
      if (k.startsWith('__var__:')) {
        const varName = k.slice('__var__:'.length);
        if (!excludeSet.has(varName)) result[varName] = v;
      }
    }
    return result;
  }

  /** 构建表达式求值可见变量表（branch_if / loop while 使用） */
  buildExprVariables(value: unknown): Record<string, unknown> {
    const variables: Record<string, unknown> = { value };
    for (const [varName, val] of Object.entries(this.collectGlobalVars(new Set(['value'])))) {
      if (!(varName in variables)) variables[varName] = val;
    }
    for (const [k, v] of Object.entries(this.variables)) {
      if (k.startsWith('__var__:')) continue;
      const idx = k.lastIndexOf(':');
      if (idx > 0) {
        const portId = k.slice(idx + 1);
        if (portId !== 'value') variables[portId] = v;
      }
    }
    return variables;
  }

  /** 自动解析上游节点输出（端口定义丢失时的兜底） */
  autoResolve(portId: string): unknown {
    for (let i = this.executedNodes.length - 1; i >= 0; i--) {
      const nodeId = this.executedNodes[i];
      const node = this.nodesById.get(nodeId);
      if (!node) continue;

      const outputs = node.data?.outputs ?? [];
      const dataOutputs = outputs.filter((p) => p.kind === 'data');

      if (dataOutputs.length > 0) {
        // 策略1：同名端口
        for (const p of dataOutputs) {
          if (p.id === portId) {
            const val = this.variables[`${nodeId}:${portId}`];
            if (val !== undefined && val !== null) return val;
          }
        }
        // 策略2：result 端口
        for (const p of dataOutputs) {
          if (p.id === 'result') {
            const val = this.variables[`${nodeId}:result`];
            if (val !== undefined && val !== null) return val;
          }
        }
        // 策略3：第一个数据输出端口
        const firstPortId = dataOutputs[0].id;
        const val = this.variables[`${nodeId}:${firstPortId}`];
        if (val !== undefined && val !== null) return val;
      } else {
        // 端口定义丢失：从 variables 查找该节点任意输出
        const resultKey = `${nodeId}:result`;
        if (resultKey in this.variables) return this.variables[resultKey];
        for (const fallbackPort of ['out', 'text']) {
          const key = `${nodeId}:${fallbackPort}`;
          if (key in this.variables) return this.variables[key];
        }
      }
    }
    return null;
  }

  /** 查找节点目标控制端口连接的下一个节点 */
  findControlNext(node: FlowNode, portId?: string): FlowNode | null {
    const nodeId = node.id;

    if (portId === undefined) {
      const outputs = node.data?.outputs ?? [];
      for (const port of outputs) {
        if (port.kind === 'control') {
          portId = port.id;
          break;
        }
      }
      if (portId === undefined) {
        const entries = this.controlOut.get(nodeId);
        if (entries && entries.length > 0) {
          return this.nodesById.get(entries[0][1]) ?? null;
        }
        return null;
      }
    }

    for (const [srcPort, targetId] of this.controlOut.get(nodeId) ?? []) {
      if (srcPort === portId) {
        return this.nodesById.get(targetId) ?? null;
      }
    }
    return null;
  }

  /** 查找连接到指定输入端口的数据边 */
  findDataEdge(nodeId: string, portId: string): FlowEdge | null {
    return this.dataIn.get(nodeId)?.get(portId) ?? null;
  }

  /** 派生子上下文（parallel_exec 等并发分支使用） */
  spawn(): ExecContext {
    return new ExecContext(
      this.graph,
      this.nodesById,
      this.edges,
      { ...this.variables },
      this.traceId,
      this.controlOut,
      this.dataIn,
      this.subflowDepth,
      this.chainId,
    );
  }
}
