// 模板导入 / 片段插入 / 整图替换。
// 三者都是"一次性把一批 nodes/edges 换进画布"，都走 pushHistory 形成**单个撤销单元**
// （replaceGraph 的注释解释了为什么不能逐个调 removeNode/addEdge）。
// importTemplate 末尾会 fire-and-forget 触发子集自动布局，完全保持旧时序。

import type { FlowEdge, FlowNode } from '@shared/types/flow';
import { createEdge, createNode } from '../../lib/canvas/nodeFactory';
import { getControlInput, getControlOutputs } from '../../lib/canvas/executionOrder';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { pushHistory } from './historyStack';
import type { FlowState, FlowSlice } from './types';

type TemplateSlice = Pick<FlowState, 'importTemplate' | 'insertTemplate' | 'replaceGraph'>;

export const createTemplateSlice: FlowSlice<TemplateSlice> = (set, get) => ({
  importTemplate: (templateNodes: FlowNode[], templateEdges: FlowEdge[]) => {
    const { nodes, edges } = get();
    pushHistory(nodes, edges);
    // 计算当前流程的最大坐标，在右下角空位插入
    let maxX = 0;
    let maxY = 0;
    for (const n of nodes) {
      if (n.position.x > maxX) maxX = n.position.x;
      if (n.position.y > maxY) maxY = n.position.y;
    }
    const OFFSET = 100;
    const offsetX = maxX + OFFSET;
    const offsetY = maxY + OFFSET;

    // 自动分配连续 ID（n1, n2, n3... / e1, e2, e3...）
    // 预扫描一次现有 ID 的最大序号后单调递增（原实现每个 ID 从 1 递增扫描，O(K·N)）
    const usedSet = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
    let nextN = 0;
    let nextE = 0;
    for (const id of usedSet) {
      const nm = /^n(\d+)$/.exec(id);
      if (nm) nextN = Math.max(nextN, Number(nm[1]));
      const em = /^e(\d+)$/.exec(id);
      if (em) nextE = Math.max(nextE, Number(em[1]));
    }
    const nextNodeId = () => {
      nextN++;
      return `n${nextN}`;
    };
    const nextEdgeId = () => {
      nextE++;
      return `e${nextE}`;
    };

    const idMap = new Map<string, string>();
    const importedNodes: FlowNode[] = templateNodes.map((n) => {
      const newId = nextNodeId();
      idMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        position: {
          x: n.position.x + offsetX,
          y: n.position.y + offsetY,
        },
      };
    });

    // 模板边引用的节点必须在模板内（idMap 中有映射），否则丢弃避免悬空边
    const importedEdges: FlowEdge[] = templateEdges
      .map((e): FlowEdge | null => {
        const newSource = idMap.get(e.source);
        const newTarget = idMap.get(e.target);
        if (!newSource || !newTarget) {
          console.warn(
            `[importTemplate] 丢弃引用外部节点的边: ${e.id}（source=${e.source}, target=${e.target}）`,
          );
          return null;
        }
        return { ...e, id: nextEdgeId(), source: newSource, target: newTarget };
      })
      .filter((e): e is FlowEdge => e !== null);

    set({
      nodes: [...nodes, ...importedNodes],
      edges: [...edges, ...importedEdges],
    });

    // ★ 阶段 3：模板导入后若新增节点互相重叠（原模板坐标全 0 → 偏移后仍重叠），跑子集 ELK 布局
    // 仅布局新导入节点 + 它们之间的边，不干扰已有节点的位置；最后聚焦到首个新节点。
    if (importedNodes.length > 0) {
      const firstPos = importedNodes[0].position;
      const allOverlap = importedNodes.every(
        (n) => n.position.x === firstPos.x && n.position.y === firstPos.y,
      );
      if (allOverlap) {
        // 收集 imported 节点之间的内部边（不包含与已有节点的连接）
        const importedIdSet = new Set(importedNodes.map((n) => n.id));
        const internalEdges = importedEdges.filter(
          (e) => importedIdSet.has(e.source) && importedIdSet.has(e.target),
        );
        // fire-and-forget：不阻塞 importTemplate 同步返回
        void (async () => {
          try {
            const { layoutFlow } = await import('../../lib/canvas/autoLayout');
            // 导入的是一整块新子图，按触发器切链排成列表（不带分组）
            const positions = await layoutFlow(importedNodes, internalEdges);
            // 在布局输出坐标基础上加 (offsetX, offsetY)，放到画布空位
            const offsetPositions = new Map<string, { x: number; y: number }>();
            for (const [id, pos] of positions) {
              offsetPositions.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
            }
            get().updateNodePositions(offsetPositions);
          } catch (e) {
            console.warn('[importTemplate] 子集自动布局失败:', e);
          }
          // 聚焦到首个新节点（无论布局是否成功）
          focusNode(importedNodes[0].id);
          // 阶段 6：高亮所有新增节点
          get().highlightNodes(importedNodes.map((n) => n.id));
        })();
      }
    }
  },

  insertTemplate: (template: any, afterNodeId?: string) => {
    const { nodes, edges } = get();
    pushHistory(nodes, edges);

    // 用 createNode 创建节点（自动分配 ID 和默认配置）
    const importedNodes: FlowNode[] = template.nodes.map((def: any) => {
      const node = createNode(def.kind, { x: 0, y: 0 });
      // 合并自定义配置
      if (def.config) {
        node.data.config = { ...node.data.config, ...def.config };
      }
      if (def.label) {
        node.data.label = def.label;
      }
      return node;
    });

    // 用 createEdge 创建边（用新节点 ID）。加边界检查避免模板数据损坏时抛 TypeError
    const importedEdges: FlowEdge[] = template.edges
      .map((e: any): FlowEdge | null => {
        const sourceNode = importedNodes[e.from];
        const targetNode = importedNodes[e.to];
        if (!sourceNode || !targetNode) {
          console.warn(
            `[insertTemplate] 边引用了不存在的节点索引: from=${e.from}, to=${e.to}（模板节点数=${importedNodes.length}），跳过该边`,
          );
          return null;
        }
        return createEdge(sourceNode.id, e.fromPort, targetNode.id, e.toPort);
      })
      .filter((e: unknown): e is FlowEdge => e !== null);

    // 智能接入：若指定 afterNodeId，将片段串联到该节点之后
    // afterNodeId 无效 / 无可用控制端口时降级为独立放置
    const extraEdges: FlowEdge[] = [];
    const removedEdgeIds = new Set<string>();
    if (afterNodeId && importedNodes.length > 0) {
      const afterNode = nodes.find((n) => n.id === afterNodeId);
      if (afterNode) {
        const afterOuts = getControlOutputs(afterNode);
        const afterOut = afterOuts[0];
        const firstIn = getControlInput(importedNodes[0]);
        if (afterOut && firstIn) {
          // afterNode → 片段首节点
          extraEdges.push(
            createEdge(afterNodeId, afterOut.portId, importedNodes[0].id, firstIn.portId),
          );
          // 片段尾节点 → afterNode 的原下一个节点（断开原边并重连）
          const lastNode = importedNodes[importedNodes.length - 1];
          const lastOut = getControlOutputs(lastNode)[0];
          const existingNextEdge = edges.find(
            (e) => e.source === afterNodeId && e.sourcePort === afterOut.portId,
          );
          if (existingNextEdge && lastOut) {
            const nextNode = nodes.find((n) => n.id === existingNextEdge.target);
            const nextIn = nextNode ? getControlInput(nextNode) : null;
            if (nextNode && nextIn) {
              extraEdges.push(createEdge(lastNode.id, lastOut.portId, nextNode.id, nextIn.portId));
              removedEdgeIds.add(existingNextEdge.id);
            }
          }
        }
      }
    }

    const finalEdges = edges.filter((e) => !removedEdgeIds.has(e.id));

    set({
      nodes: [...nodes, ...importedNodes],
      edges: [...finalEdges, ...importedEdges, ...extraEdges],
    });

    // 选中并聚焦首个新节点
    get().selectNode(importedNodes[0].id);
    get().setFocusNode(importedNodes[0].id);
    // 阶段 6：高亮所有新增节点，让用户看到模板插入了哪些节点
    get().highlightNodes(importedNodes.map((n) => n.id));

    // 返回新节点 ID 列表（供 UI 选中/聚焦）
    return importedNodes.map((n) => n.id);
  },

  replaceGraph: (nodes: FlowNode[], edges: FlowEdge[]) =>
    set((s) => {
      pushHistory(s.nodes, s.edges);
      // 整图变换会删节点：清掉指向已删节点的选中/焦点/多选/高亮，
      // 否则属性抽屉会挂在一个已经不存在的节点上
      const alive = new Set(nodes.map((n: any) => n.id));
      const keep = (id: string | null) => (id && alive.has(id) ? id : null);
      return {
        nodes,
        edges,
        selectedNodeId: keep(s.selectedNodeId),
        focusNodeId: keep(s.focusNodeId),
        selectedNodeIds: s.selectedNodeIds.filter((id: string) => alive.has(id)),
        highlightedNodeIds: new Set([...s.highlightedNodeIds].filter((id) => alive.has(id))),
        connectingFromPort: null,
      };
    }),
});
