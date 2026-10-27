// src/renderer/src/components/blocks/useFlowBridge.tsx
//
// **React Flow 桥接**——从 `BlockEditor` 抽出的第三块（拆分 Step 3c，540 行）。
//
// 这一块把 store 里的图（nodes/edges/nodeGroups…）接到 React Flow 的 props 上：
// 节点/边/分组的变更、连线校验、拖拽进出与落点、右键、双击、拖拽预览、连线建议、
// 以及"跳下一个错误"这类画布级动作。
//
// **13 个输入 → 32 个产出**都是 AST 算出来的：产出 = 区域里声明且"区域之后还在用"的名字；
// 输入 = 区域引用、声明在区域之前的名字（减去 import —— 那些由本文件自己引入）。
import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import {
  toReactFlowNode,
  toReactFlowEdges,
  encodeHandleId,
  decodeHandleId,
} from '../../lib/canvas/reactFlowAdapter';
import { useFlowStore } from '@renderer/stores/flowStore';
import { useToast } from '../ui/Toast';
import {
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnectStartParams,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import { CANVAS_NODE_TYPE } from '../canvas/CanvasNode';
import { recordNodeUsage } from '../../lib/infra/recentStore';
import {
  setReactFlowInstance,
  consumePendingFocus,
  focusNode,
  getReactFlowInstance,
} from '../../lib/canvas/reactFlowBridge';
import { getBranchColor, getBranchLabel } from '../../lib/canvas/branchColors';
import { isControlEdge } from '../../lib/canvas/executionOrder';
import { createNode, createEdge } from '../../lib/canvas/nodeFactory';
import { findSpec } from '../../lib/node/nodeCatalog';
import { nodePlatformBlockReason } from '../../lib/node/platformGuard';
import { toast } from '../ui/Toast';
import { findCompatibleTargets } from '../../lib/canvas/portMatcher';
import { getValidationSummary } from '../../lib/canvas/connectionValidator';
import { splitIssuesByBaseline } from '@shared/nodes/issueBaseline';
import { FlowNode } from '@shared/types/flow';
import { t } from '../../i18n';

/** 直接用 store 的 state 类型派生 —— 精确且随 store 自维护 */
type FlowState = ReturnType<typeof useFlowStore.getState>;

/** React Flow 桥接需要的全部外部量 */
export interface UseFlowBridgeOptions {
  addNode: FlowState['addNode'];
  clearMultiSelect: FlowState['clearMultiSelect'];
  edges: FlowState['edges'];
  errorNodeIds: FlowState['errorNodeIds'];
  executingNodeIds: FlowState['executingNodeIds'];
  issues: FlowState['issues'];
  nodeGroups: FlowState['nodeGroups'];
  nodes: FlowState['nodes'];
  selectNode: FlowState['selectNode'];
  selectedNodeId: FlowState['selectedNodeId'];
  selectedNodeIds: FlowState['selectedNodeIds'];
  toast: ReturnType<typeof useToast>;
  toggleMultiSelect: FlowState['toggleMultiSelect'];
  setDrawerNodeId: (id: string | null) => void;
  pendingCreatePosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  setPaneContextMenu: (v: { x: number; y: number; flowX: number; flowY: number } | null) => void;
  setContextMenu: (v: { x: number; y: number; nodeId: string } | null) => void;
}

export function useFlowBridge(opts: UseFlowBridgeOptions) {
  const {
    addNode,
    clearMultiSelect,
    edges,
    errorNodeIds,
    executingNodeIds,
    issues,
    nodeGroups,
    nodes,
    selectNode,
    selectedNodeId,
    selectedNodeIds,
    toast,
    toggleMultiSelect,
    setDrawerNodeId,
    pendingCreatePosRef,
    setPaneContextMenu,
    setContextMenu,
  } = opts;

  // ===== React Flow 桥接 =====

  /** 折叠分组中的节点不渲染（连同其边） */
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const g of nodeGroups) {
      if (g.collapsed) {
        for (const id of g.nodeIds) hidden.add(id);
      }
    }
    return hidden;
  }, [nodeGroups]);

  // React Flow 节点对象缓存：store 节点引用未变化时复用旧 RF 节点对象。
  // React Flow 内部用 `userNode === 传入节点` 的引用相等做 checkEquality，
  // 若每次渲染都新建对象会强制内部重建节点 → measured 尺寸丢失 → 拖拽报 error#015。
  //
  // ⚠️ 但缓存只能救"没变的节点"。**被拖拽的那个节点每帧必然是新对象**（位置变了），
  // 所以它每帧都会被重建、measured 每帧被抹 → 每帧报 015、拖不动。
  // 补法是把尺寸存进 measuredRef 并在重建时带回去（见那里的说明）。
  const rfNodeCache = useRef(
    new Map<
      string,
      { storeNode: FlowNode; rfNode: Node; measured?: { width: number; height: number } }
    >(),
  );
  // 拖拽边 data 缓存：key=边id+执行态+分支色+分支标签，命中时复用同一 data 引用
  const edgeDataCacheRef = useRef(new Map<string, Edge['data']>());

  /** 数据流可见性开关：默认关闭（避免画布交叉混乱），开启后以虚线显示数据流绑定边 */
  const [showDataEdges, setShowDataEdges] = useState(false);

  /**
   * React Flow 量出来的节点尺寸（id → {width,height}）。
   *
   * ⚠️ **为什么必须自己存**：React Flow 把"测好的尺寸"写进它内部的 nodeLookup，
   * 而我们每次给它新的 `nodes` 数组时，它会**按我们给的对象重建**那个内部节点。
   * 被拖拽的节点每帧都会换新对象（位置变了）→ 重建时只能从我们的对象取 `measured` →
   * 我们从来没带过它 → **尺寸每帧被抹掉** → 下一次 mousemove 就报
   * `[React Flow]: trying to drag a node that is not initialized`（错误码 015），
   * 内部快速路径随之失效、节点只能等 React 提交位置 → **不跟手**。
   * 这也解释了为什么是"拖拽时每帧刷屏"。
   */
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());

  const reactFlowNodes = useMemo<Node[]>(() => {
    const cache = rfNodeCache.current;
    const nextCache = new Map<
      string,
      { storeNode: FlowNode; rfNode: Node; measured?: { width: number; height: number } }
    >();
    const result = nodes
      .filter((n) => !hiddenNodeIds.has(n.id))
      .map((n) => {
        const selected = selectedNodeId === n.id || selectedNodeIds.includes(n.id);
        const measured = measuredRef.current.get(n.id);
        const cached = cache.get(n.id);
        if (
          cached &&
          cached.storeNode === n &&
          cached.rfNode.selected === selected &&
          cached.measured === measured // 尺寸变了要重建，否则会停留在旧值
        ) {
          nextCache.set(n.id, cached);
          return cached.rfNode;
        }
        const rfNode: Node = {
          ...toReactFlowNode(n),
          type: CANVAS_NODE_TYPE,
          selected,
          // 把量到的尺寸原样带回去 —— 这是"不被抹掉"的关键
          ...(measured ? { measured } : {}),
        };
        nextCache.set(n.id, { storeNode: n, rfNode, measured });
        return rfNode;
      });
    rfNodeCache.current = nextCache;
    return result;
  }, [nodes, hiddenNodeIds, selectedNodeId, selectedNodeIds]);

  const reactFlowEdges = useMemo<Edge[]>(() => {
    const visible = nodes.filter((n) => !hiddenNodeIds.has(n.id));
    const visibleIds = new Set(visible.map((n) => n.id));
    const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    // 一次建索引，避免每条边 O(E·N) 的 find（原实现 edges.find + nodes.find 嵌套）
    const edgeMap = new Map(edges.map((e) => [e.id, e]));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    // 拖拽边 data 缓存：边 data（执行态/分支色/分支标签）与节点 position 无关。
    // 拖拽只改 position → nodes 引用变化 → useMemo 重算；若无缓存，每条边重建 data，
    // React Flow 的边 memo 浅比较失败 → 全量重渲染。缓存命中时返回同一 data 引用，
    // 拖拽期间边组件零重渲染。
    const cache = edgeDataCacheRef.current;
    // 控制流边：实线 + 箭头 + 执行态流动动画
    const controlEdges = toReactFlowEdges(visibleEdges, visible).map((e) => {
      const fe = edgeMap.get(e.id);
      if (!fe) return e;
      const src = nodeMap.get(fe.source);
      const executing = executingNodeIds.has(fe.source) || executingNodeIds.has(fe.target);
      const branchColor = src ? getBranchColor(src.data.nodeKind, fe.sourcePort) : undefined;
      const branchLabel = src ? getBranchLabel(src.data.nodeKind, fe.sourcePort) : undefined;
      const cacheKey = `${fe.id}::${executing ? 1 : 0}::${branchColor ?? ''}::${branchLabel ?? ''}`;
      const cached = cache.get(cacheKey);
      if (cached) return { ...e, data: cached };
      const data: Edge['data'] = { executing, branchColor, branchLabel };
      cache.set(cacheKey, data);
      return { ...e, data };
    });
    // 数据流边：仅当开关开启时渲染（虚线蓝色，只读展示数据绑定关系）
    const dataEdges: Edge[] = [];
    if (showDataEdges) {
      for (const fe of visibleEdges) {
        if (isControlEdge(fe, nodeMap)) continue;
        const src = nodeMap.get(fe.source);
        const tgt = nodeMap.get(fe.target);
        if (!src || !tgt) continue;
        dataEdges.push({
          id: `data__${fe.id}`,
          source: fe.source,
          target: fe.target,
          sourceHandle: encodeHandleId({ kind: 'data', id: fe.sourcePort }),
          targetHandle: encodeHandleId({ kind: 'data', id: fe.targetPort }),
          type: 'data',
          data: {
            sourcePortName: fe.sourcePort,
            targetPortName: fe.targetPort,
          },
        });
      }
    }
    return [...controlEdges, ...dataEdges];
  }, [edges, nodes, hiddenNodeIds, executingNodeIds, showDataEdges]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    setReactFlowInstance(instance);
    // 实例就绪期间缓存的 focus 请求（AI 生成/大纲跳转可能在画布挂载前发起）
    const pending = consumePendingFocus();
    if (pending) focusNode(pending);
  }, []);

  // 卸载时清理桥实例
  useEffect(() => {
    return () => setReactFlowInstance(null);
  }, []);

  /**
   * 拖拽性能计量（**仅开发环境**）。
   *
   * 用 React `Profiler` 记拖拽期间每帧的**真实渲染耗时**，松手后在控制台打汇总。
   * 目的：判定"拖动不跟手"到底是不是"每帧渲染太贵导致位置更新到得晚"（频度问题），
   * 而不是靠猜。用户反馈 2026-10-02：263 节点 / 471 连线时拖动卡顿。
   */
  const dragProfile = useRef<{
    frames: number;
    total: number;
    max: number;
    startedAt: number;
  } | null>(null);
  /** 是否正在拖拽 */
  const draggingRef = useRef(false);
  /** 拖拽期间写回位置的次数（受控模式下**必须**写回，否则节点完全不跟手）≈ 鼠标事件数 */
  const dragPositionWrites = useRef(0);
  /**
   * 拖拽期间 React Flow 报 `trying to drag a node that is not initialized`（错误码 015）的次数。
   *
   * 这是**"拖拽被打断"的直接指标**：它来自 React Flow 内部 nodeLookup 里被拖节点的 `measured` 丢了。
   * 我们每写回一次位置，被拖节点就会换一个新对象、React Flow 重建一次内部节点 —— 若重建时
   * `measured` 没被带回去，这一步就报一次。期望：**接近 0**。
   */
  const dragCount015 = useRef(0);
  /** console 是否已打过计数补丁（HMR 会重复执行模块，用 window 标记防重复叠加） */
  const count015Patched = useRef(false);
  const onProfileRender = useCallback((_id: string, _phase: string, actualDuration: number) => {
    const p = dragProfile.current;
    if (!p) return;
    p.frames += 1;
    p.total += actualDuration;
    if (actualDuration > p.max) p.max = actualDuration;
  }, []);

  /** 拖拽开始：push 一次 history（拖拽中 updateNodePosition 不产生历史） */
  const dragStartPositions = useRef(new Map<string, { x: number; y: number }>());
  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    draggingRef.current = true;
    dragPositionWrites.current = 0;
    dragCount015.current = 0;
    // 统计 React Flow 的 015（devWarn 走 console，具体是 warn 还是 error 不做假设，两个都数）
    if (import.meta.env.DEV) {
      const w = window as unknown as { __qqbatCount015?: boolean };
      if (!w.__qqbatCount015) {
        w.__qqbatCount015 = true;
        for (const level of ['warn', 'error'] as const) {
          const orig = console[level].bind(console);
          console[level] = (...args: unknown[]) => {
            if (args.some((a) => typeof a === 'string' && a.includes('not initialized'))) {
              dragCount015.current += 1;
            }
            orig(...args);
          };
        }
      }
    }
    if (import.meta.env.DEV) {
      dragProfile.current = { frames: 0, total: 0, max: 0, startedAt: performance.now() };
    }
    dragStartPositions.current.set(node.id, { x: node.position.x, y: node.position.y });
    useFlowStore.getState().beginDragHistory();
  }, []);

  /** 拖拽结束：位置未变化的拖拽（误触/原地松开）取消历史快照，避免污染撤销栈 */
  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes?: Node[]) => {
    draggingRef.current = false;
    const st = useFlowStore.getState();
    void draggedNodes; // 多选拖拽的位置同样由 onNodesChange 每帧写回，这里无需再补
    const start = dragStartPositions.current.get(node.id);
    const current = st.nodes.find((n) => n.id === node.id);
    if (start && current && current.position.x === start.x && current.position.y === start.y) {
      st.cancelDragHistory(); // 零位移（误触/原地松开）：撤掉拖拽开始时压的历史快照
    }
    dragStartPositions.current.delete(node.id);

    // 仅开发环境：拖完把真实渲染耗时打出来（定位"卡"到底是渲染贵还是别的）
    if (import.meta.env.DEV && dragProfile.current) {
      const p = dragProfile.current;
      dragProfile.current = null;
      const elapsed = performance.now() - p.startedAt;
      const avg = p.total / Math.max(1, p.frames);
      const line =
        `[drag-profile] 拖拽 ${elapsed.toFixed(0)}ms · React 渲染 ${p.frames} 帧 · ` +
        `平均 ${avg.toFixed(1)}ms/帧 · 最慢 ${p.max.toFixed(1)}ms · 渲染合计 ${p.total.toFixed(0)}ms` +
        ` · 写回位置 ${dragPositionWrites.current} 次 · 015 报错 ${dragCount015.current} 次`;
      console.warn(line);
      // 同时写进主进程日志（%APPDATA%/qqbat/logs/main.log）——这样排查不需要人工截图
      void window.qqbat.diagnostics?.rendererLog?.(line);
    }
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const st = useFlowStore.getState();
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        // ⚠️ **拖拽过程中不写 store**。
        //
        // 拖拽的视觉位移本来就由 React Flow 内部完成（直接改 DOM transform，最快路径）；
        // 我们若每帧把位置写进 store，会同时造成两件事：
        //   ① 每帧重建被拖节点的对象 → React Flow 内部节点被重建 → **拖拽被打断**（一顿一顿的根源）
        //   ② 每帧触发整棵树渲染（实测 ~110 次/秒、3.8ms/次）→ 位置要等 React 提交才落地
        // 位置在 **onNodeDragStop 里一次性提交**（历史仍在拖拽开始时压一次）。
        // 注意只跳过 `dragging: true`——程序化移动（自动布局、向导生成）仍然是立即生效的。
        // ⚠️ 这里**必须每帧写回**：React Flow 在受控模式下靠它同步内部位置，
        // 不写就会表现为"节点完全跟不上鼠标"（2026-10-02 试过一版"拖拽期间不写 store"，直接把拖拽弄坏了）。
        // 真正要治的是**每次写回导致节点对象被重建 → 内部 015 报错 → 拖拽被打断**，
        // 所以解法是把 measured 带回去（见 measuredRef），而不是不写。
        if (draggingRef.current) dragPositionWrites.current += 1;
        st.updateNodePosition(ch.id, ch.position);
      } else if (ch.type === 'dimensions' && ch.dimensions) {
        // ⚠️ 必须接住尺寸变更（原实现完全忽略它）：React Flow 量到的尺寸要记下来，
        // 并在重建节点对象时带回去。否则被拖拽的节点每帧都会被抹掉 measured，
        // 于是每次 mousemove 报错误 015、且走不到内部快速路径 → 拖动不跟手。
        const prev = measuredRef.current.get(ch.id);
        if (!prev || prev.width !== ch.dimensions.width || prev.height !== ch.dimensions.height) {
          measuredRef.current.set(ch.id, {
            width: ch.dimensions.width,
            height: ch.dimensions.height,
          });
        }
      } else if (ch.type === 'remove') {
        st.removeNode(ch.id);
        measuredRef.current.delete(ch.id);
      }
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const ch of changes) {
      if (ch.type === 'remove') {
        useFlowStore.getState().removeEdge(ch.id);
      }
    }
  }, []);

  /** 拖拽连线松手建边：编码 kind__portId → flowStore 端口 ID
   *  用 decodeHandleId 从首个 __ 分割——branch_switch 动态 case 名可含 __，split()[1] 会截断 */
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
      const sourcePortId = decodeHandleId(conn.sourceHandle).portId;
      const targetPortId = decodeHandleId(conn.targetHandle).portId;
      const st = useFlowStore.getState();
      const existing = st.edges.find(
        (e) => e.source === conn.source && e.sourcePort === sourcePortId,
      );
      // target 侧占用同样会静默替换，给出对称提示
      const existingTarget = st.edges.find(
        (e) => e.target === conn.target && e.targetPort === targetPortId,
      );
      const edge = createEdge(conn.source, sourcePortId, conn.target, targetPortId);
      st.addEdge(edge);
      if (existing) toast.success(t('blocks.editor.replacedEdge'));
      else if (existingTarget) toast.success(t('blocks.editor.replacedTargetEdge'));
    },
    [toast],
  );

  const onConnectStart = useCallback((_: unknown, params: OnConnectStartParams) => {
    if (!params.nodeId || !params.handleId) return;
    const { portId: sourcePortId } = decodeHandleId(params.handleId);

    // 记录起点端口
    useFlowStore.getState().setConnectingFromPort({
      nodeId: params.nodeId,
      portId: sourcePortId,
    });

    // 实时计算所有兼容目标端口（用于高亮/置灰）
    const sourceNode = useFlowStore.getState().nodes.find((n) => n.id === params.nodeId);
    if (sourceNode) {
      const allNodes = useFlowStore.getState().nodes;
      const allEdges = useFlowStore.getState().edges;
      const compatibleTargets = findCompatibleTargets(sourceNode, allNodes, allEdges);

      const portMap = new Map<string, Set<string>>();
      for (const target of compatibleTargets) {
        const portIds = new Set(target.matchedPorts.map((m) => m.targetPort.id));
        portMap.set(target.node.id, portIds);
      }
      useFlowStore.getState().setCompatibleTargetPorts(portMap);
    }
  }, []);

  const onConnectEnd = useCallback(() => {
    useFlowStore.getState().setConnectingFromPort(null);
    useFlowStore.getState().setCompatibleTargetPorts(new Map());
  }, []);

  /** 连线校验：仅控制流端口可连 + 拒绝自连（A→A 自环会导致代码生成死循环）。
   *  与 flowValidation.canConnect 语义一致。 */
  const isValidConnection = useCallback((conn: Connection | Edge) => {
    const sourceKind = conn.sourceHandle?.split('__')[0];
    const targetKind = conn.targetHandle?.split('__')[0];
    if (sourceKind !== 'control' || targetKind !== 'control') return false;
    if (conn.source && conn.target && conn.source === conn.target) return false;
    return true;
  }, []);

  /** 连线拖拽中：画布切换"可连/禁停"端口视觉（globals.css 的 .qqbat-connecting-mode 规则） */
  const isConnecting = useFlowStore((s) => s.connectingFromPort !== null);

  /**
   * 校验摘要（右下角显示）—— 读主进程统一校验的结果（store.issues）。
   *
   * 只把**本次新出现的问题**当警示；打开项目时就有的历史问题低调度显示，
   * 否则一个老项目一打开就满屏警告，小白会以为"工具坏了"（见 @shared/nodes/issueBaseline.ts）。
   */
  const issueBaseline = useFlowStore((s) => s.issueBaseline);
  const newIssueSummary = useMemo(() => {
    const { newIssues } = splitIssuesByBaseline(issues, issueBaseline);
    return getValidationSummary(
      newIssues.map((i) => ({
        level: i.severity,
        code: i.code,
        message: i.message,
        nodeId: i.nodeId,
        fixHint: i.fixHint,
      })),
    );
  }, [issues, issueBaseline]);
  const hasNewIssues = newIssueSummary !== t('blocks.editor.noIssues');

  /** 拖拽节点落点提示：NodePalette 拖出时显示虚线遮罩 */
  const [isNodeDragOver, setIsNodeDragOver] = useState(false);
  /** 拖拽预览（幽灵节点跟随光标） */
  const [dragPreview, setDragPreview] = useState<{ kind: string; x: number; y: number } | null>(
    null,
  );
  const dragLeaveTimer = useRef<number | null>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/node-kind')) {
      if (dragLeaveTimer.current !== null) window.clearTimeout(dragLeaveTimer.current);
      setIsNodeDragOver(true);
      const kind = e.dataTransfer.getData('text/node-kind');
      if (kind) {
        setDragPreview({ kind, x: e.clientX, y: e.clientY });
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 延迟清除：拖过画布子元素时 dragleave 冒泡会短暂触发，防止遮罩闪烁
    if (e.dataTransfer.types.includes('text/node-kind')) {
      if (dragLeaveTimer.current !== null) window.clearTimeout(dragLeaveTimer.current);
      dragLeaveTimer.current = window.setTimeout(() => {
        setIsNodeDragOver(false);
        setDragPreview(null);
      }, 60);
    }
  }, []);

  /** 拖放节点到画布：仅响应 NodePalette 拖出的 node-kind 数据 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/node-kind')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // 更新幽灵节点位置
      const kind = e.dataTransfer.getData('text/node-kind');
      if (kind) {
        setDragPreview((prev) =>
          prev ? { ...prev, x: e.clientX, y: e.clientY } : { kind, x: e.clientX, y: e.clientY },
        );
      }
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsNodeDragOver(false);
      setDragPreview(null);
      const kind = e.dataTransfer.getData('text/node-kind');
      if (!kind) return;
      // 第 65 批：拖放是第三个添加入口（前面是节点库点击、命令面板），同样过平台守卫
      const blocked = nodePlatformBlockReason(findSpec(kind));
      if (blocked) {
        toast.error(blocked);
        return;
      }
      const instance = getReactFlowInstance();
      if (!instance) return;
      // 屏幕坐标 → 画布坐标，节点创建在鼠标松开位置
      const pos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node = createNode(kind, { x: pos.x, y: pos.y });
      recordNodeUsage(kind);
      addNode(node);
      selectNode(node.id);
    },
    [addNode, selectNode],
  );

  /** 单击节点：选中 + 打开抽屉（Ctrl/⌘+点击切换多选） */
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
        toggleMultiSelect(node.id);
        return;
      }
      selectNode(node.id);
      setDrawerNodeId(node.id);
    },
    [selectNode, toggleMultiSelect, setDrawerNodeId],
  );

  /** 错误节点定位：点击「错误 N」按钮循环跳到下一个错误节点并打开抽屉 */
  const [errorJumpIndex, setErrorJumpIndex] = useState(0);
  // Set 的插入序即节点发现顺序；派生稳定数组供跳转索引使用
  const errorList = useMemo(() => [...errorNodeIds], [errorNodeIds]);

  // 错误集变化时重置跳转游标，避免修复/新增错误后索引错位
  useEffect(() => {
    setErrorJumpIndex(0);
  }, [errorNodeIds]);

  const jumpToNextError = useCallback(() => {
    if (errorList.length === 0) return;
    const next = errorJumpIndex % errorList.length;
    setErrorJumpIndex((next + 1) % errorList.length);
    const nodeId = errorList[next];
    selectNode(nodeId);
    setDrawerNodeId(nodeId);
    useFlowStore.getState().setFocusNode(nodeId);
    focusNode(nodeId);
    useFlowStore.getState().highlightNodes([nodeId]);
  }, [errorList, errorJumpIndex, selectNode, setDrawerNodeId]);

  /** 跳转来源记录（「返回调用处」按钮用）：从 subflow_call 跳到 subflow_defined 时记录。
   *  用 state 而非 ref：渲染期读取 ref 的变化不触发重渲染，
   *  「返回调用处」按钮的显隐可能不随跳转更新 */
  const [subflowJump, setSubflowJump] = useState<{
    fromCallId: string;
    toDefineId: string;
  } | null>(null);

  /** 从 subflow_call 节点跳转到其 subflow_defined 定义：记录跳转来源（返回按钮）+ 聚焦 */
  const jumpToSubflowDefine = useCallback((callNodeId: string) => {
    const st = useFlowStore.getState();
    const callNode = st.nodes.find((x) => x.id === callNodeId);
    if (!callNode) return;
    const defineId = String(callNode.data.config?.subflow_id ?? '');
    const define = st.nodes.find((x) => x.id === defineId);
    if (!define) return;
    setSubflowJump({ fromCallId: callNodeId, toDefineId: defineId });
    st.setFocusNode(define.id);
    focusNode(define.id);
  }, []);

  /** 双击节点：subflow_call 跳转到定义；其他打开抽屉 */
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const n = useFlowStore.getState().nodes.find((x) => x.id === node.id);
      if (!n) return;
      if (n.data.nodeKind === 'subflow_call') {
        jumpToSubflowDefine(n.id);
        return;
      }
      setDrawerNodeId(node.id);
    },
    [setDrawerNodeId, jumpToSubflowDefine],
  );

  const onPaneClick = useCallback(() => {
    clearMultiSelect();
    selectNode(null);
  }, [clearMultiSelect, selectNode]);

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const clientX = event.clientX;
      const clientY = event.clientY;
      pendingCreatePosRef.current = { x: clientX, y: clientY };
      setPaneContextMenu({ x: clientX, y: clientY, flowX: clientX, flowY: clientY });
    },
    [pendingCreatePosRef, setPaneContextMenu],
  );

  /** 右键节点：打开上下文菜单 */
  const handleContextMenu = useCallback(
    (node: FlowNode, x: number, y: number) => {
      if (!selectedNodeIds.includes(node.id) && selectedNodeIds.length === 0) {
        selectNode(node.id);
      }
      setContextMenu({ x, y, nodeId: node.id });
    },
    [selectedNodeIds, selectNode, setContextMenu],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const n = nodes.find((x) => x.id === node.id);
      if (!n) return;
      handleContextMenu(n, event.clientX, event.clientY);
    },
    [nodes, handleContextMenu],
  );

  return {
    dragPreview,
    dragProfile,
    handleDragEnter,
    handleDragLeave,
    hasNewIssues,
    isConnecting,
    isNodeDragOver,
    isValidConnection,
    jumpToNextError,
    newIssueSummary,
    onConnect,
    onConnectEnd,
    onConnectStart,
    onDragOver,
    onDrop,
    onEdgesChange,
    onInit,
    onNodeClick,
    onNodeContextMenu,
    onNodeDoubleClick,
    onNodeDragStart,
    onNodeDragStop,
    onNodesChange,
    onPaneClick,
    onPaneContextMenu,
    onProfileRender,
    reactFlowEdges,
    reactFlowNodes,
    setShowDataEdges,
    setSubflowJump,
    showDataEdges,
    subflowJump,
  };
}
