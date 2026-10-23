// 图本身（nodes/edges/systems 之外的节点-边拓扑）与"项目身份"字段：nodes/edges、
// selectedNodeId/projectName/graphCreatedAt。
// 为什么单独成片：这些字段是**图的生命周期**（增删改节点/边、导出图），
// 与节点属性（nodeSlice）、系统分组（systemSlice）、持久化（persistenceSlice）分开，
// 避免又长成一个上帝对象；它们之间只通过 get()/set() 互相调用，行为与拆分前完全一致。

import type { FlowEdge, FlowNode, NodeGroup, SystemGroup } from '@shared/types/flow';
import { FLOW_SCHEMA_VERSION } from '@shared/types/flow';
import { validateFlow } from '@shared/nodes/flowNormalize';
import { createEdge } from '../../lib/canvas/nodeFactory';
import { nodeDisplayLabel } from '../../lib/node/nodeCatalog';
import {
  isControlPortName,
  getControlInput,
  getControlOutputs,
  isSubflowDefine,
} from '../../lib/canvas/executionOrder';
import { t } from '../../i18n';
import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type GraphSlice = Pick<
  FlowState,
  | 'nodes'
  | 'edges'
  | 'selectedNodeId'
  | 'projectName'
  | 'graphCreatedAt'
  | 'setProjectName'
  | 'addNode'
  | 'removeNode'
  | 'canRemoveNode'
  | 'addEdge'
  | 'removeEdge'
  | 'deleteNodeAndReconnect'
  | 'deleteUnreachableNodes'
  | 'removeNodes'
  | 'exportGraph'
>;

export const createGraphSlice: FlowSlice<GraphSlice> = (set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  projectName: 'untitled',
  graphCreatedAt: null,

  setProjectName: (name: string) => set({ projectName: name }),

  /** 添加节点到画布（记录历史） */
  addNode: (node: FlowNode) =>
    set((s) => {
      pushHistory(s.nodes, s.edges);
      return { nodes: [...s.nodes, node] };
    }),

  /** 删除节点及其关联边（subflow_defined 被引用时静默跳过，记录历史） */
  removeNode: (nodeId: string) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node) return {};
      // 保护 subflow_defined：如果有 subflow_call 引用它，阻止删除
      if (isSubflowDefine(node)) {
        const callers = s.nodes.filter(
          (n) => n.data.nodeKind === 'subflow_call' && n.data.config?.subflow_id === nodeId,
        );
        if (callers.length > 0) {
          // 不删除，静默返回（调用方应通过 canRemoveNode 提前检查并提示用户）
          return {};
        }
      }
      pushHistory(s.nodes, s.edges);
      // 同步清理引用该节点的分组（保留分组，仅剔除该节点 ID）
      const nodeGroups = s.nodeGroups
        .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) }))
        .filter((g) => g.nodeIds.length > 0);
      // 同步清理系统分组的链触发器引用（C 修复：原实现漏清 chainTriggerIds）
      const systems = s.systems.map((g: SystemGroup) =>
        g.chainTriggerIds.includes(nodeId)
          ? { ...g, chainTriggerIds: g.chainTriggerIds.filter((id: string) => id !== nodeId) }
          : g,
      );
      return {
        nodes: s.nodes.filter((n) => n.id !== nodeId),
        edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
        selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
        selectedNodeIds: s.selectedNodeIds.filter((id: string) => id !== nodeId),
        nodeGroups,
        systems,
      };
    }),

  canRemoveNode: (nodeId: string) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    // 普通触发器可删（右键菜单按产品设计不提供删除项，但 store 层允许）；
    // 仅 subflow_defined 在被引用时不可删
    if (isSubflowDefine(node)) {
      const callers = state.nodes.filter(
        (n) => n.data.nodeKind === 'subflow_call' && n.data.config?.subflow_id === nodeId,
      );
      if (callers.length > 0) {
        const names = callers.map((c) => nodeDisplayLabel(c) || c.id).join(', ');
        return t('flow.subflowInUse', { names });
      }
    }
    return null;
  },

  addEdge: (edge: FlowEdge) =>
    set((s) => {
      pushHistory(s.nodes, s.edges);
      /**
       * 每个**数据**输入端口只能有一条入边（值必须来自一个地方）——
       * 但**控制**输入端口可以有多条（= 汇合点）。
       *
       * ## 为什么允许控制口多入边（2026-09-26）
       *
       * 原来控制口也按"一条"去重，于是**分支永远无法汇合**：`branch_if` 的 true/false
       * 只能各自接一条独立的后续链，想"两边都接着做同一件事"就必须把那段逻辑**整段复制**。
       * 这正是一直没能把 `bt_state`（回合结算：5 个互斥结局各自产出完整的 13 键结果对象）
       * 拆成节点的**结构性原因** —— 它不是"缺某个节点"，是**图形本身不允许汇合**。
       *
       * 而运行时**本来就支持**：执行是沿控制边走的，节点到达一次就执行一次
       * （见 `tests/main/runtime/branchJoin.test.ts` 的实测）。
       *
       * ## 为什么这样是安全的（可证明，不是"应该没事"）
       *
       * 本 store 同时禁止**控制出口分叉**（下面那条规则：同一 source+sourcePort 只能连一个目标）。
       * 于是：若两条边 `A → M`、`B → M` 同时存在（A≠B），则 A 与 B **必然互斥**——
       * 若 A 在 B 的上游，则 A 的唯一后继是 M，B 根本不会被执行；反之亦然。
       * 所以汇合点在一次执行里**只会被到达一次**，不存在"两个分支都跑、节点执行两遍、
       * 消息发两条"的情况。
       */
      const targetNode = s.nodes.find((n) => n.id === edge.target);
      const targetIsControl = targetNode
        ? getControlInput(targetNode)?.portId === edge.targetPort
        : isControlPortName(edge.targetPort);
      let filtered = targetIsControl
        ? s.edges
        : s.edges.filter((e) => e.target !== edge.target || e.targetPort !== edge.targetPort);
      // 控制流出口不能分叉：同一个 source+sourcePort 只能连一个目标
      if (isControlPortName(edge.sourcePort)) {
        filtered = filtered.filter(
          (e) => e.source !== edge.source || e.sourcePort !== edge.sourcePort,
        );
      }
      return { edges: [...filtered, edge] };
    }),

  removeEdge: (edgeId: string) =>
    set((s) => {
      pushHistory(s.nodes, s.edges);
      return { edges: s.edges.filter((e) => e.id !== edgeId) };
    }),

  /** 删除节点并自动重连控制流（单次 pushHistory）。单出口直连后继，多出口重连到延续出口 */
  deleteNodeAndReconnect: (nodeId: string) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node) return {};
      // 保护 subflow_defined：被引用时不可删
      if (isSubflowDefine(node)) {
        const callers = s.nodes.filter(
          (n) => n.data.nodeKind === 'subflow_call' && n.data.config?.subflow_id === nodeId,
        );
        if (callers.length > 0) return {};
      }

      pushHistory(s.nodes, s.edges);

      // ── 找前驱边 ──
      // ⚠️ 控制口允许**多条**入边（汇合点，见 addEdge 的注释），所以这里必须取**全部**前驱：
      // 只取第一条的话，其余入边会悬空指向已删节点（validateFlow 会报"悬空边"），
      // 而且原来那条分支的后续就断了。
      const ctrlIn = getControlInput(node);
      const inEdges = ctrlIn
        ? s.edges.filter((e) => e.target === nodeId && e.targetPort === ctrlIn.portId)
        : [];
      const inEdge = inEdges[0];

      // ── 找后继边 ──
      const outPorts = getControlOutputs(node);
      // 收集所有控制流出口的边
      const outEdges = outPorts
        .map((p) => s.edges.find((e) => e.source === nodeId && e.sourcePort === p.portId))
        .filter((e): e is FlowEdge => e !== undefined);

      // ── 决定重连目标 ──
      /** 被删节点的"延续"后继（多出口时取 done/finally/out/next） */
      let targetEdge: FlowEdge | undefined;
      if (inEdge && outEdges.length > 0) {
        if (outEdges.length === 1) {
          // 单出口：直接用唯一后继
          targetEdge = outEdges[0];
        } else {
          // 多出口：找"延续"出口（done/finally/out/next）
          const continuationPorts = new Set(['done', 'finally', 'out', 'next']);
          targetEdge = outEdges.find((e) => continuationPorts.has(e.sourcePort));
          if (!targetEdge) targetEdge = outEdges[0]; // 回退到第一个
        }
      }

      /** 每条前驱 →（延续后继）的重连边；汇合点会有多条 */
      const reconnectEdges: FlowEdge[] = [];
      if (targetEdge) {
        const nextNode = s.nodes.find((n) => n.id === targetEdge.target);
        const nextIn = nextNode ? getControlInput(nextNode) : null;
        if (nextNode && nextIn) {
          for (const inE of inEdges) {
            const prevNode = s.nodes.find((n) => n.id === inE.source);
            if (!prevNode) continue;
            // 用原入边的 sourcePort 重连：多出口前驱（branch_if 等）必须回到
            // 被删节点原本连着的那个出口（如 false），否则重连会抢占首个出口、孤立兄弟分支
            const prevOuts = getControlOutputs(prevNode);
            const prevOut = prevOuts.find((p) => p.portId === inE.sourcePort) ?? prevOuts[0];
            if (prevOut) {
              reconnectEdges.push(
                createEdge(prevNode.id, prevOut.portId, nextNode.id, nextIn.portId),
              );
            }
          }
        }
      }

      // ── 一次性更新：删除节点 + 清理边 + 添加重连边 ──
      const nodeGroups = s.nodeGroups
        .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) }))
        .filter((g) => g.nodeIds.length > 0);

      let newEdges = s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      for (const reconnectEdge of reconnectEdges) {
        // 提取属性避免在闭包中使用非空断言（TypeScript 无法在闭包内窄化）
        const reSource = reconnectEdge.source;
        const reSourcePort = reconnectEdge.sourcePort;
        const reTarget = reconnectEdge.target;
        const reTargetPort = reconnectEdge.targetPort;
        // 控制流出口不能分叉：如果前驱的同一出口已有边，先移除
        if (isControlPortName(reSourcePort)) {
          newEdges = newEdges.filter((e) => e.source !== reSource || e.sourcePort !== reSourcePort);
        }
        // 数据入口只能有一条入边；**控制入口不清**（那是汇合点，清掉就把别的分支弄断了）
        const nextNodeForPort = s.nodes.find((n) => n.id === reTarget);
        const reTargetIsControl = nextNodeForPort
          ? getControlInput(nextNodeForPort)?.portId === reTargetPort
          : isControlPortName(reTargetPort);
        if (!reTargetIsControl) {
          newEdges = newEdges.filter((e) => e.target !== reTarget || e.targetPort !== reTargetPort);
        }
        newEdges.push(reconnectEdge);
      }

      return {
        nodes: s.nodes.filter((n) => n.id !== nodeId),
        edges: newEdges,
        selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
        selectedNodeIds: s.selectedNodeIds.filter((id: string) => id !== nodeId),
        nodeGroups,
      };
    }),

  deleteUnreachableNodes: () => {
    const graph = get().exportGraph();
    // 用统一校验引擎判定（与问题清单同一个引擎），避免"清单说有 43 个、删的时候数不一样"
    const issues = validateFlow(graph as unknown as Parameters<typeof validateFlow>[0]);
    const ids = [
      ...new Set(
        issues
          .filter((i) => i.code === 'unreachable-node' && i.nodeId)
          .map((i) => i.nodeId as string),
      ),
    ];
    if (ids.length === 0) return 0;
    get().removeNodes(ids);
    return ids.length;
  },

  removeNodes: (nodeIds: string[]) =>
    set((s) => {
      if (nodeIds.length === 0) return s;
      // 被引用的 subflow_defined 剔除（普通触发器可删；保护逻辑与 removeNode 一致）
      const idSet = new Set(
        nodeIds.filter((id: string) => {
          const n = s.nodes.find((x) => x.id === id);
          if (!n) return false;
          if (isSubflowDefine(n)) {
            return !s.nodes.some(
              (x) => x.data.nodeKind === 'subflow_call' && x.data.config?.subflow_id === id,
            );
          }
          return true;
        }),
      );
      if (idSet.size === 0) return s;
      pushHistory(s.nodes, s.edges);
      // 同步清理引用这些节点的分组（剔除后若分组为空则移除分组）
      const nodeGroups = s.nodeGroups
        .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !idSet.has(id)) }))
        .filter((g) => g.nodeIds.length > 0);
      // 同步清理系统分组的链触发器引用（C 修复）
      const systems = s.systems.map((g: SystemGroup) =>
        g.chainTriggerIds.some((id: string) => idSet.has(id))
          ? { ...g, chainTriggerIds: g.chainTriggerIds.filter((id: string) => !idSet.has(id)) }
          : g,
      );
      return {
        nodes: s.nodes.filter((n) => !idSet.has(n.id)),
        edges: s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
        selectedNodeId: idSet.has(s.selectedNodeId ?? '') ? null : s.selectedNodeId,
        selectedNodeIds: s.selectedNodeIds.filter((id: string) => !idSet.has(id)),
        nodeGroups,
        systems,
      };
    }),

  exportGraph: () => {
    const { nodes, edges, projectName, systems, nodeGroups, graphCreatedAt } = get();
    const now = new Date().toISOString();
    // 剥离 UI 临时态字段（expanded），保持 flow.json 干净
    const cleanNodes = nodes.map((n) => {
      const { expanded: _expanded, ...dataRest } = n.data;
      return { ...n, data: dataRest };
    });
    return {
      schemaVersion: FLOW_SCHEMA_VERSION,
      systems,
      nodes: cleanNodes,
      edges,
      variables: [],
      nodeGroups,
      metadata: {
        name: projectName,
        version: '1.0',
        runtime: 'typescript',
        // createdAt 是文件身份：从文件加载来的原样保留；只有全新流程才用当前时间
        createdAt: graphCreatedAt ?? now,
        updatedAt: now,
      },
    };
  },
});
