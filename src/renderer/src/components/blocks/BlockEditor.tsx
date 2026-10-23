// src/renderer/src/components/blocks/BlockEditor.tsx
// 画布式（React Flow）流程编辑器：扣子式卡片节点 + 自由画布。
// 关联设计文档：docs/architecture/canvas-refactor-design.md
//
// 职责：
// - 挂载 <ReactFlow>（受控模式），把 flowStore 的节点/边桥接为画布数据
// - onNodesChange/onEdgesChange/onConnect 桥回 flowStore（拖拽开始 push 一次 history）
// - 系统分区 / 分支区域 / 节点分组 背景层（SystemRegionLayer 等，均为 ReactFlow 子组件）
// - 消费 flowStore 的 focusNodeId / errorFixRequest / recommendApplyRequest
// - 保留旧列表式的全部交互能力（画布内实现）：抽屉、右键菜单、多选、分组、
//   折叠子流程（双击跳转 + 返回调用处）、大纲面板、撤销重做、搜索
import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnectStartParams,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  useFlowStore,
  beginHistoryBatch,
  endHistoryBatch,
  pushHistoryPoint,
} from '../../stores/flowStore';
import { useProjectStore } from '../../stores/projectStore';
import { CANVAS_NODE_TYPE, CanvasNode } from '../canvas/CanvasNode';
import { useBlockEditorState } from './useBlockEditorState';
import { recordNodeUsage } from '../../lib/infra/recentStore';
import { PropertyDrawer } from './PropertyDrawer';
import { LocalTestDialog } from '../debug/LocalTestDialog';
import { TemplateLibrary } from './TemplateLibrary';
import { FlowOutline } from './FlowOutline';
import { FlowIssuesButton } from './FlowIssuesButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ShortcutsModal } from './ShortcutsModal';
import { useToast } from '../ui/Toast';
import { Modal } from '../ui/Modal';
import { useGitStore } from '../../stores/gitStore';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { NewChainMenu } from './NewChainMenu';
import { NewCommandWizard } from './NewCommandWizard';
import {
  buildCommandChain,
  normalizeCommand,
  type CommandWizardInput,
} from '../../lib/command/commandWizard';
import { CommandListPanel } from './CommandListPanel';
import { CommandPanelEditor } from './CommandPanelEditor';
import { FactoryConfigPanel } from './FactoryConfigPanel';
import { usePanelDriftStore } from '../../stores/panelDriftStore';
import { ConfigQueryWizard } from './ConfigQueryWizard';
import { buildConfigQueryChain, type ConfigQueryInput } from '../../lib/command/configQueryChain';
import { BlockContextMenu } from './BlockContextMenu';
import { CreateGroupDialog, RenameGroupDialog, CreateSubflowDialog } from './GroupDialogs';
import { NodeSearchDialog } from '../canvas/NodeSearchDialog';
import { NewbieGuide } from '../canvas/NewbieGuide';
import { getNodeIcon } from './iconMap';
import { findSpec } from '../../lib/node/nodeCatalog';
import {
  CanvasEdge,
  CanvasDataEdge,
  CANVAS_EDGE_TYPE,
  CANVAS_DATA_EDGE_TYPE,
} from '../canvas/CanvasEdge';
import { SystemRegionLayer } from '../canvas/SystemRegionLayer';
import { BranchRegionLayer } from '../canvas/BranchRegionLayer';
import { NodeGroupLayer } from '../canvas/NodeGroupLayer';
import {
  toReactFlowNode,
  toReactFlowEdges,
  encodeHandleId,
  decodeHandleId,
} from '../../lib/canvas/reactFlowAdapter';
import { needsLayout, layoutFlow } from '../../lib/canvas/autoLayout';
import {
  setReactFlowInstance,
  consumePendingFocus,
  focusNode,
  fitCanvas,
  panCanvas,
  getReactFlowInstance,
} from '../../lib/canvas/reactFlowBridge';
import { getBranchColor, getBranchLabel } from '../../lib/canvas/branchColors';
import {
  getExecutionChains,
  isControlEdge,
  isSubflowDefine,
} from '../../lib/canvas/executionOrder';
import { createNode, createEdge } from '../../lib/canvas/nodeFactory';
import { NODE_WIDTH } from '../../lib/canvas/canvasConstants';
import { findCompatibleTargets } from '../../lib/canvas/portMatcher';
import { getValidationSummary } from '../../lib/canvas/connectionValidator';
import { splitIssuesByBaseline } from '@shared/nodes/issueBaseline';
import type { FlowNode } from '@shared/types/flow';
import {
  Puzzle,
  Undo2,
  Redo2,
  ChevronRight,
  ListTree,
  ListChecks,
  Database,
  LayoutTemplate,
  Maximize,
  Wand2,
  Search,
  CornerUpLeft,
  AlertTriangle,
  GitBranch,
  ListPlus,
  ClipboardCheck,
  Plus,
} from 'lucide-react';
import type { ContextMenuItem } from './ContextMenu';
import { t, getLocale } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { isPlatformVisible } from '@shared/domain/project/botTypeConfig';
import { TOOLBAR_PLATFORM_TAGS } from '../../lib/node/platformEntries';
import { BlockToolbar } from './BlockToolbar';
import { useStoreRequests } from './useStoreRequests';
import { useFlowBridge } from './useFlowBridge';
import { useEditorActions } from './useEditorActions';
import {
  ERROR_PREVIEW_MAX,
  NOOP,
  PAN_STEP,
  PAN_STEP_FAST,
  RF_CONNECTION_LINE_STYLE,
  RF_PRO_OPTIONS,
  RF_SNAP_GRID,
  placeNewNodesBelow,
  previewError,
} from './blockEditorModel';

/** React Flow 节点/边组件注册（模块级常量，避免每次渲染重建导致组件重复挂载） */
const nodeTypes: NodeTypes = { [CANVAS_NODE_TYPE]: CanvasNode };
const edgeTypes: EdgeTypes = {
  [CANVAS_EDGE_TYPE]: CanvasEdge,
  [CANVAS_DATA_EDGE_TYPE]: CanvasDataEdge,
};

export const BlockEditor = React.memo(function BlockEditor() {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const systems = useFlowStore((s) => s.systems);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const nodeGroups = useFlowStore((s) => s.nodeGroups);
  const executingNodeIds = useFlowStore((s) => s.executingNodeIds);
  const focusNodeId = useFlowStore((s) => s.focusNodeId);
  const errorNodeIds = useFlowStore((s) => s.errorNodeIds);
  const errorFixRequest = useFlowStore((s) => s.errorFixRequest);
  const recommendApplyRequest = useFlowStore((s) => s.recommendApplyRequest);
  const clipboard = useFlowStore((s) => s.clipboard);
  const addNode = useFlowStore((s) => s.addNode);
  const selectNode = useFlowStore((s) => s.selectNode);
  const deleteNodeAndReconnect = useFlowStore((s) => s.deleteNodeAndReconnect);
  const generateCode = useFlowStore((s) => s.generateCode);
  const loadGraph = useFlowStore((s) => s.loadGraph);
  const reset = useFlowStore((s) => s.reset);
  const removeSystem = useFlowStore((s) => s.removeSystem);
  const addNodeGroup = useFlowStore((s) => s.addNodeGroup);
  const removeNodeGroup = useFlowStore((s) => s.removeNodeGroup);
  const toggleNodeGroupCollapse = useFlowStore((s) => s.toggleNodeGroupCollapse);
  const renameNodeGroup = useFlowStore((s) => s.renameNodeGroup);
  const toggleMultiSelect = useFlowStore((s) => s.toggleMultiSelect);
  const clearMultiSelect = useFlowStore((s) => s.clearMultiSelect);
  const isNodeInGroup = useFlowStore((s) => s.isNodeInGroup);
  const foldToSubflow = useFlowStore((s) => s.foldToSubflow);
  const setFocusNode = useFlowStore((s) => s.setFocusNode);
  const validateAllNodes = useFlowStore((s) => s.validateAllNodes);
  const generating = useFlowStore((s) => s.generating);
  const fetchVersions = useGitStore((s) => s.fetchVersions);
  /** 「生成代码」的命名面板状态（2026-10-02：点生成代码先弹面板，填版号与名字） */
  const [genDialog, setGenDialog] = useState(false);
  const [genVersionName, setGenVersionName] = useState('');
  const [genVersionMessage, setGenVersionMessage] = useState('');
  /** 打开面板时，当前提交上已有的版本名（null = 还没有版本）。用于在面板里解释"为什么这次不能新建版本" */
  const [genHeadVersion, setGenHeadVersion] = useState<string | null>(null);
  /** 画布有没有未保存改动：有改动 → 保存时会产生新提交 → 这次能建新版本 */
  const flowDirty = useFlowStore((s) => s.dirty);
  const issues = useFlowStore((s) => s.issues);
  const dirty = useFlowStore((s) => s.dirty);
  const saving = useFlowStore((s) => s.saving);
  const lastSavedAt = useFlowStore((s) => s.lastSavedAt);
  const saveError = useFlowStore((s) => s.saveError);
  const loadError = useFlowStore((s) => s.loadError);
  const setLoadError = useFlowStore((s) => s.setLoadError);
  // 响应式历史深度：canUndo() 读模块级 _past 不在 store 状态内，
  // 零位移拖拽等"栈变但 nodes 不变"的路径下按钮 disabled 会短暂过期
  const undoDepth = useFlowStore((s) => s.undoDepth);
  const redoDepth = useFlowStore((s) => s.redoDepth);
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  // 项目类型 → 决定"平台专属入口"是否出现（与节点库同一套规则）
  const botType = useProjectStore((s) => s.currentProject?.botType);
  const toast = useToast();
  // 「新建指令」向导开关（填命令词 + 回复 → 自动铺好一条连好线的链）
  const [showCommandWizard, setShowCommandWizard] = useState(false);
  // 「指令面板」编辑器开关（挑哪些指令进 QQ 的 `/` 快捷面板）
  const [showCommandPanel, setShowCommandPanel] = useState(false);
  // 「出厂配置」清单开关（凭据/面板/菜单/服务范围/自检 一屏到底）
  const [showFactoryConfig, setShowFactoryConfig] = useState(false);
  // 上一次核对「指令面板 vs QQ」的结果（打开面板时算一次）——
  // 没核对过时 checked=false，角标**不显示**：「没查过」和「查过没问题」是两件事
  //
  // ⚠️ 必须**逐字段订阅**，不能写成 `usePanelDriftStore((s) => ({ ...三个字段 }))`。
  // 那种写法每次都返回一个**新对象字面量**，而 zustand 默认用 `Object.is` 比较快照 →
  // 每次渲染都判定为"变了" → 渲染 → 新对象 → 再渲染 …… React 直接抛
  // `Maximum update depth exceeded`，把**整个中栏**打成「面板渲染崩溃」。
  // （实测踩过：这个 bug 是我在"漂移角标"那轮写下的，用户点开低代码编辑器就崩。）
  const driftStaleScopes = usePanelDriftStore((s) => s.staleScopes);
  const driftStaleItems = usePanelDriftStore((s) => s.staleItems);
  const driftChecked = usePanelDriftStore((s) => s.checked);

  const {
    drawerNodeId,
    setDrawerNodeId,
    showNewChainMenu,
    setShowNewChainMenu,
    showTestDialog,
    setShowTestDialog,
    showTemplateLib,
    setShowTemplateLib,
    showOutline,
    setShowOutline,
    showCommandList,
    setShowCommandList,
    showConfigQueryWizard,
    setShowConfigQueryWizard,
    deleteSystemTarget,
    setDeleteSystemTarget,
    contextMenu,
    setContextMenu,
    paneContextMenu,
    setPaneContextMenu,
    groupDialog,
    setGroupDialog,
    renameDialog,
    setRenameDialog,
    subflowDialog,
    setSubflowDialog,
    highlightField,
    setHighlightField,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    matchIndex,
    searchMatches,
    onSearchKeyDown,
    showShortcuts,
    setShowShortcuts,
    pendingCreatePosRef,
  } = useBlockEditorState(nodes);

  /**
   * 加载失败的处理：**绝不能静默退回"新项目"外观**。
   *
   * 实测事故：flow.json 校验失败时画布被当成新项目清空，用户看到空白画布；
   * 此时点「运行」（启动前强制保存）就把空图写回文件，磁盘上的流程被覆盖。
   * 这里显式报错，并在 store 置 loadError —— `saveNow` 会因此拒绝落盘，
   * 直到成功加载（切项目 / 重新加载）或用户点「忽略并允许保存」。
   */
  const handleLoadFailure = useCallback(
    (rawMessage: string) => {
      const message = rawMessage || t('blocks.editor.unknownError');
      reset(); // 顺序不能反：reset() 会清掉 loadError
      setLoadError(message);
      toast.error(t('blocks.editor.loadFailed', { error: previewError(message) }));
    },
    [reset, setLoadError, toast],
  );

  /**
   * 加载指定项目的 flow.json（切换项目与「重新加载」按钮共用这一条路径）。
   *
   * 三种结果必须分开对待，历史上把它们混成"清空画布"一次事故：
   * - 拿到数据 → 载入画布（position 全 0 的旧图跑一次 ELK 布局）
   * - ok 但没有数据 → 该项目**还没有** flow.json，是真正的新项目，空白画布正确
   * - 失败 → 显式报错 + 置 loadError（见 handleLoadFailure）
   */
  const loadProjectFlow = useCallback(
    async (path: string) => {
      if (!window.qqbat?.flow?.load) {
        // 非 Electron 环境（浏览器预览 / 测试）：没有加载通道，按空项目处理
        reset();
        return;
      }
      // 竞态守卫：path 变化后旧请求仍可能后到，序号递增使过期响应丢弃
      const requestSeq = ++loadRequestSeqRef.current;
      try {
        const result = await window.qqbat.flow.load(path);
        if (requestSeq !== loadRequestSeqRef.current) return;
        if (result?.ok && result.data) {
          const graph = result.data;
          // 把"这张图属于哪个项目"一起交给画布 —— 落盘按它写，避免写进别的项目（见 saveNow）
          loadGraph(graph, path);
          // 从未布局过的图（position 全 0）跑一次自动布局。
          // 传 nodeGroups：有分组时按分组分行，没分组时 layoutFlow 会自己按触发器切链。
          if (needsLayout(graph.nodes)) {
            try {
              const positions = await layoutFlow(graph.nodes, graph.edges, graph.nodeGroups);
              if (requestSeq !== loadRequestSeqRef.current) return;
              useFlowStore.getState().updateNodePositions(positions);
              fitCanvas();
            } catch (e) {
              console.warn('[BlockEditor] 自动布局失败:', e);
            }
          }
          return;
        }
        if (result?.ok) {
          reset(); // 新项目：没有 flow.json 是正常状态
          return;
        }
        handleLoadFailure(result?.error ?? '');
      } catch (e) {
        if (requestSeq !== loadRequestSeqRef.current) return;
        handleLoadFailure(e instanceof Error ? e.message : String(e));
      }
    },
    [loadGraph, reset, handleLoadFailure],
  );

  // 切换项目时加载 flow.json
  useEffect(() => {
    if (!projectPath) {
      reset();
      return;
    }
    void loadProjectFlow(projectPath);
  }, [projectPath, loadProjectFlow, reset]);

  // 加载失败横幅：数据安全提示必须常驻（toast 会消失），并给出两条出路
  const loadErrorBanner = loadError ? (
    <div className="shrink-0 flex items-start gap-2 px-3 py-2 border-b border-red-900/60 bg-red-950/40">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
      <div className="flex-1 min-w-0 text-xs">
        <div className="font-medium text-red-300">{t('blocks.editor.loadFailedTitle')}</div>
        <div className="mt-0.5 text-red-200/80 break-all" title={loadError}>
          {previewError(loadError)}
        </div>
        <div className="mt-0.5 text-red-200/60">{t('blocks.editor.loadFailedDesc')}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (projectPath) void loadProjectFlow(projectPath);
          }}
        >
          {t('blocks.editor.reload')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setLoadError(null)}>
          {t('blocks.editor.ignoreAndAllowSave')}
        </Button>
      </div>
    </div>
  ) : null;

  // 节点列表或配置变化时自动验证（配置签名短路，拖拽不触发）
  // config 指纹缓存：store 节点不可变，拖拽只替换 position 不换 config 引用——
  // 按引用复用指纹，避免拖拽每帧对全量 config 做 JSON.stringify（C 修复）
  const lastValidationSigRef = useRef('');
  // 项目加载竞态守卫：快速切换项目时递增序号，过期 load 响应直接丢弃
  const loadRequestSeqRef = useRef(0);
  const configSigCacheRef = useRef(new Map<string, { ref: unknown; sig: string }>());
  useEffect(() => {
    const cache = configSigCacheRef.current;
    // 重建缓存：只保留当前节点的条目，已删除节点的旧条目（含 config 引用）随之释放，
    // 避免长会话频繁增删节点时缓存只增不减的缓慢泄漏
    const nextCache = new Map<string, { ref: unknown; sig: string }>();
    const sig =
      nodes
        .map((n) => {
          const cached = cache.get(n.id);
          if (cached && cached.ref === n.data.config) {
            nextCache.set(n.id, cached);
            return cached.sig;
          }
          const sig = JSON.stringify(n.data.config);
          nextCache.set(n.id, { ref: n.data.config, sig });
          return sig;
        })
        .join('|') +
      '#' +
      edges.map((e) => `${e.source}.${e.sourcePort}->${e.target}.${e.targetPort}`).join('|');
    configSigCacheRef.current = nextCache;
    if (sig === lastValidationSigRef.current) return;
    lastValidationSigRef.current = sig;
    if (nodes.length > 0) validateAllNodes();
  }, [nodes, edges, validateAllNodes]);

  const chains = useMemo(() => getExecutionChains(nodes, edges), [nodes, edges]);

  // 抽屉节点相关计算
  const drawerNode = useMemo(
    () => (drawerNodeId ? (nodes.find((n) => n.id === drawerNodeId) ?? null) : null),
    [drawerNodeId, nodes],
  );
  /** 画布模式：控制流前驱（BFS 反向可达）即抽屉"上游节点"（数据绑定来源） */
  const drawerUpstreamNodes = useMemo(() => {
    if (!drawerNodeId) return [];
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      if (!isControlEdge(e, nodes)) continue;
      const list = incoming.get(e.target) ?? [];
      list.push(e.source);
      incoming.set(e.target, list);
    }
    const visited = new Set<string>();
    const queue = [drawerNodeId];
    const result: FlowNode[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const srcId of incoming.get(cur) ?? []) {
        if (visited.has(srcId)) continue;
        visited.add(srcId);
        const srcNode = nodes.find((n) => n.id === srcId);
        if (srcNode) {
          result.push(srcNode);
          queue.push(srcId);
        }
      }
    }
    return result;
  }, [nodes, edges, drawerNodeId]);

  // 撤销/重做 + 删除 + 复制/粘贴 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !typing) {
        // 输入框内保留原生撤销（C 修复：原实现无 !typing，抽屉内 Ctrl+Z 会触发全局撤销并吞掉文本撤销）
        e.preventDefault();
        useFlowStore.getState().undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.shiftKey && e.key === 'Z')) &&
        !typing
      ) {
        e.preventDefault();
        useFlowStore.getState().redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !typing) {
        const st = useFlowStore.getState();
        if (st.selectedNodeId || st.selectedNodeIds.length > 0) st.copySelectedNodes();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !typing) {
        const st = useFlowStore.getState();
        const newIds = st.pasteNodes();
        if (newIds.length > 0) {
          st.selectNode(newIds[0]);
          focusNode(newIds[0]);
          st.highlightNodes(newIds);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        const st = useFlowStore.getState();
        // 多选集合 = 主选中节点（selectedNodeId）+ Ctrl 附加集合（selectedNodeIds）
        const multiIds =
          st.selectedNodeId && !st.selectedNodeIds.includes(st.selectedNodeId)
            ? [st.selectedNodeId, ...st.selectedNodeIds]
            : st.selectedNodeIds;
        if (multiIds.length > 1) {
          for (const id of multiIds) {
            const reason = st.canRemoveNode(id);
            if (reason) {
              toast.error(t('blocks.editor.cannotDelete', { id, reason }));
              return;
            }
          }
          st.removeNodes([...multiIds]);
        } else if (st.selectedNodeId) {
          const reason = st.canRemoveNode(st.selectedNodeId);
          if (reason) {
            toast.error(reason);
          } else {
            st.deleteNodeAndReconnect(st.selectedNodeId);
            setDrawerNodeId(null);
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
        // Ctrl+A 全选（所有可见节点，含子流程定义；折叠分组内的节点不可选）
        e.preventDefault();
        const st = useFlowStore.getState();
        const hidden = new Set<string>();
        for (const g of st.nodeGroups) {
          if (g.collapsed) for (const id of g.nodeIds) hidden.add(id);
        }
        const allIds = st.nodes.filter((n) => !hidden.has(n.id)).map((n) => n.id);
        st.selectAllNodes(allIds);
      } else if (e.key === 'Escape' && !typing) {
        // Esc：关闭抽屉 + 清空选择（优先级低于搜索框内的 Esc，那里由 onSearchKeyDown 处理）
        const st = useFlowStore.getState();
        if (st.selectedNodeId || st.selectedNodeIds.length > 0) {
          st.selectNode(null);
        }
        setDrawerNodeId(null);
      } else if (
        !typing &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        // **方向键平移画布**（2026-09 新增）。
        //
        // 列表式布局改成"一条链一行、不折行"之后，一条 44 节点的链宽约 1.7 万像素
        // （见 `autoLayout.ts` 的说明），光靠鼠标拖太慢 —— 方向键一步步挪才顺手。
        //
        // ⚠️ `preventDefault` 必需：否则方向键还会让外层滚动容器也滚一次，观感是"跳两下"。
        // ⚠️ 输入框里要留给光标移动，所以先判 `!typing`（与上面几个分支同一套判据）。
        e.preventDefault();
        // Shift / Ctrl 加速 —— 长链一路挪过去时不必按几十次
        const step = e.shiftKey || e.ctrlKey || e.metaKey ? PAN_STEP_FAST : PAN_STEP;
        const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
        const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        // 画布未就绪时静默忽略（不报错、不改选择）
        panCanvas(dx, dy);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toast, setDrawerNodeId]);

  // ===== React Flow 桥接（已抽到 useFlowBridge）=====
  const {
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
  } = useFlowBridge({
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
  });

  // ===== 消费 store 请求（已抽到 useStoreRequests）=====
  useStoreRequests({
    errorFixRequest,
    recommendApplyRequest,
    focusNodeId,
    setDrawerNodeId,
    setHighlightField,
  });

  // ===== 交互回调（已抽到 useEditorActions）=====
  const {
    confirmCreateGroup,
    confirmDeleteSystem,
    confirmFoldToSubflow,
    confirmRenameGroup,
    contextMenuItems,
    handleCloseDrawer,
    handleCreateCommand,
    handleCreateConfigQuery,
    handleDeleteNode,
    handleLayoutAll,
    openGenerateDialog,
    paneContextMenuItems,
    runGenerateCode,
    handleAddChain,
  } = useEditorActions({
    contextMenu,
    deleteSystemTarget,
    drawerNodeId,
    groupDialog,
    loadErrorBanner,
    projectPath,
    renameDialog,
    setDeleteSystemTarget,
    setDrawerNodeId,
    setGenHeadVersion,
    setGenVersionMessage,
    setGroupDialog,
    setRenameDialog,
    setShowCommandWizard,
    setShowConfigQueryWizard,
    setShowNewChainMenu,
    setSubflowDialog,
    showCommandWizard,
    showNewChainMenu,
    subflowDialog,
    toast,
    setGenVersionName,
    setGenDialog,
  });

  if (nodes.length === 0) {
    return (
      <div className="h-full flex flex-col bg-zinc-950">
        {loadErrorBanner}
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 overflow-y-auto py-8">
          <p className="text-sm mb-1">{t('blocks.editor.empty.title')}</p>
          <p className="text-xs text-zinc-500 mb-4">{t('blocks.editor.empty.desc')}</p>
          <div className="flex gap-2 flex-wrap justify-center">
            <Button
              variant="primary"
              size="lg"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={() => setShowCommandWizard(true)}
            >
              {t('blocks.editor.wizard.command')}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setShowNewChainMenu(true)}>
              {t('blocks.editor.empty.pickTrigger')}
            </Button>
          </div>
          {showNewChainMenu && (
            <div className="mt-2 w-80">
              <NewChainMenu
                systems={systems}
                onPick={handleAddChain}
                onClose={() => setShowNewChainMenu(false)}
              />
            </div>
          )}

          <div className="mt-6 w-full max-w-2xl px-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-500 leading-relaxed">
              <span className="text-amber-300">{t('blocks.editor.empty.tipLabel')}</span>
              {t('blocks.editor.empty.tipPrefix')}
              <span className="text-zinc-300">{'{var1}'}</span>
              {t('blocks.editor.empty.tipSuffix')}
            </div>
          </div>
        </div>
        <NewCommandWizard
          open={showCommandWizard}
          onCancel={() => setShowCommandWizard(false)}
          onConfirm={handleCreateCommand}
        />
      </div>
    );
  }

  return (
    // 仅开发环境包一层 Profiler：拖动时每帧的真实渲染耗时由 onProfileRender 累计，
    // 松手后 onNodeDragStop 打汇总（见 dragProfile 的说明）。
    <React.Profiler id="BlockEditor" onRender={onProfileRender}>
      <div className="h-full flex flex-col bg-zinc-950">
        <BlockToolbar
          botType={botType}
          chains={chains}
          nodes={nodes}
          edges={edges}
          systems={systems}
          errorNodeIds={errorNodeIds}
          generating={generating}
          driftChecked={driftChecked}
          driftStaleScopes={driftStaleScopes}
          driftStaleItems={driftStaleItems}
          redoDepth={redoDepth}
          undoDepth={undoDepth}
          loadErrorBanner={loadErrorBanner}
          subflowJump={subflowJump}
          setSubflowJump={setSubflowJump}
          showCommandPanel={showCommandPanel}
          setShowCommandPanel={setShowCommandPanel}
          setShowCommandWizard={setShowCommandWizard}
          setShowOutline={setShowOutline}
          setShowConfigQueryWizard={setShowConfigQueryWizard}
          setShowTemplateLib={setShowTemplateLib}
          setDeleteSystemTarget={setDeleteSystemTarget}
          fitCanvas={fitCanvas}
          setShowCommandList={setShowCommandList}
          showDataEdges={showDataEdges}
          setShowDataEdges={setShowDataEdges}
          setShowFactoryConfig={setShowFactoryConfig}
          focusNodeId={focusNodeId}
          showOutline={showOutline}
          showCommandList={showCommandList}
          setShowTestDialog={setShowTestDialog}
          handleLayoutAll={handleLayoutAll}
          openGenerateDialog={openGenerateDialog}
          jumpToNextError={jumpToNextError}
        />
        {/* 主内容区：画布 + 大纲面板（右侧可折叠） */}
        <div className="flex-1 flex overflow-hidden">
          <div
            className="flex-1 relative z-[45]"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
          >
            <ReactFlowProvider>
              <ReactFlow
                nodes={reactFlowNodes}
                edges={reactFlowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={onInit}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                connectionRadius={32}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeContextMenu={onNodeContextMenu}
                onPaneClick={onPaneClick}
                onPaneContextMenu={onPaneContextMenu}
                deleteKeyCode={null}
                // ✅ **必须开**：只渲染视口内的节点与连线。
                //
                // 2026-10-02 实测（同一个 263 节点 / 471 连线的项目，读日志里的 drag-profile）：
                //   开：React 渲染 3.8ms/帧  → 拖拽期间约 112 次/秒，跟手
                //   关：React 渲染 69ms/帧（最慢 241ms）→ 主线程被整块堵住，
                //        4.7 秒的拖拽只处理了 23 次鼠标移动（正常约 280 次）→ 节点一跳一跳
                // 即"一顿一顿"的真因是**单次渲染太贵把输入挤住了**，不是帧率本身。
                //
                // （一度以为它丢 measured 导致 React Flow 报 015，于是撤掉过 —— 判断错了：
                //   015 的真因是我们没接 dimensions 变更、没把 measured 带回去，已单独修好，
                //   修好后 015 计数为 0。两者互不相干，两个都要。）
                onlyRenderVisibleElements
                snapToGrid
                snapGrid={RF_SNAP_GRID}
                fitView
                minZoom={0.1}
                maxZoom={2.5}
                connectionLineStyle={RF_CONNECTION_LINE_STYLE}
                proOptions={RF_PRO_OPTIONS}
                className={`bg-zinc-950 ${isConnecting ? 'qqbat-connecting-mode' : ''}`}
              >
                <Background gap={24} size={1} color="#27272a" />
                {/* 系统分区 / 分支区域 / 节点分组 背景层（必须作为 ReactFlow 子组件以使用 useViewport） */}
                <SystemRegionLayer />
                <BranchRegionLayer />
                <NodeGroupLayer />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) => {
                    // 错误节点红色，选中蓝色，执行中黄色，其他灰色
                    if (errorNodeIds.has(n.id)) return '#ef4444';
                    if (executingNodeIds.has(n.id)) return '#fbbf24';
                    if (n.selected) return '#3b82f6';
                    return '#3f3f46';
                  }}
                  maskColor="rgba(9, 9, 11, 0.7)"
                  className="!bg-zinc-900"
                />
                <Controls
                  position="bottom-left"
                  className="!bg-zinc-900 [&_button]:!border-zinc-700 [&_button]:!bg-zinc-800 [&_button]:!text-zinc-400 [&_button]:hover:!bg-zinc-700"
                />
                {/* 保存状态：以前改完没有任何反馈，用户不知道有没有落盘。
                  保存**失败**必须显眼（红色 + 原因）—— 否则"已同步"徽章会说谎。 */}
                <div
                  className={`absolute bottom-3 right-3 z-20 rounded-lg border px-2 py-1 text-xs shadow-lg ${
                    saveError
                      ? 'border-red-600/70 bg-zinc-900/95 text-red-300'
                      : saving
                        ? 'border-zinc-700 bg-zinc-900/95 text-zinc-400'
                        : dirty
                          ? 'border-amber-600/60 bg-zinc-900/95 text-amber-300'
                          : 'border-zinc-700 bg-zinc-900/95 text-zinc-500'
                  }`}
                  title={saveError || t('blocks.editor.saveHint')}
                >
                  {saveError
                    ? t('blocks.editor.save.failed', { reason: saveError })
                    : saving
                      ? t('blocks.editor.save.saving')
                      : dirty
                        ? t('blocks.editor.save.unsaved')
                        : lastSavedAt
                          ? t('blocks.editor.save.savedAt', {
                              time: new Date(lastSavedAt).toLocaleTimeString(getLocale()),
                            })
                          : t('blocks.editor.save.synced')}
                </div>
                {/* 校验摘要：只把"新问题"当警示；打开项目时就有的历史问题低调度显示 */}
                {issues.length > 0 && (
                  <div
                    className={`absolute bottom-14 right-3 z-20 rounded-lg border px-2 py-1.5 text-xs shadow-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                      hasNewIssues
                        ? 'bg-zinc-900/95 border-amber-600/60 text-amber-300 hover:bg-zinc-800/95'
                        : 'bg-zinc-900/95 border-zinc-700 text-zinc-500 hover:bg-zinc-800/95'
                    }`}
                    onClick={() => {
                      // 打开工具栏那个「问题」面板（同一份数据、按规则分组、默认只看新问题）
                      useFlowStore.getState().setIssuesPanelOpen(true);
                    }}
                    title={t('blocks.editor.tip.issueList')}
                  >
                    <span className={hasNewIssues ? 'text-amber-400' : 'text-zinc-500'}>
                      {hasNewIssues ? '⚠' : 'ℹ'}
                    </span>
                    <span className="text-[10px] max-w-xs truncate">
                      {hasNewIssues
                        ? t('blocks.editor.newIssues', { summary: newIssueSummary })
                        : t('blocks.editor.historyIssues', { count: issues.length })}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-auto">
                      {t('blocks.editor.clickToView')}
                    </span>
                  </div>
                )}
              </ReactFlow>
            </ReactFlowProvider>

            {/* 拖拽节点落点提示：NodePalette 拖出节点悬停画布时显示 */}
            {isNodeDragOver && (
              <div className="absolute inset-0 z-[5] pointer-events-none flex items-center justify-center">
                <div className="px-3 py-1.5 rounded-full bg-zinc-900/95 border border-blue-500/50 text-xs text-blue-300 shadow-lg">
                  {t('blocks.editor.dropHint')}
                </div>
              </div>
            )}

            {/* 拖拽预览幽灵节点（跟随光标） */}
            {dragPreview && (
              <div
                className="fixed z-[100] pointer-events-none transform -translate-x-1/2 -translate-y-1/2 transition-opacity duration-50"
                style={{
                  left: `${dragPreview.x}px`,
                  top: `${dragPreview.y}px`,
                  opacity: 0.85,
                }}
              >
                <div className="w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-700 bg-zinc-800/50">
                    <span className="text-base">
                      {(() => {
                        const Icon = getNodeIcon(dragPreview.kind);
                        return Icon ? <Icon className="w-4 h-4" /> : null;
                      })()}
                    </span>
                    <span className="text-xs font-medium text-zinc-100 truncate flex-1">
                      {findSpec(dragPreview.kind)?.label || dragPreview.kind}
                    </span>
                  </div>
                  <div className="px-2 py-1.5 text-[11px] text-zinc-400">
                    {findSpec(dragPreview.kind)?.description || t('blocks.editor.dragHint')}
                  </div>
                </div>
              </div>
            )}

            {/* 画布搜索（Ctrl+F） */}
            {searchOpen && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-zinc-800/95 border border-zinc-600 rounded-lg px-3 py-2 shadow-xl w-80">
                <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  onBlur={() => setSearchOpen(false)}
                  placeholder={t('blocks.editor.searchPlaceholder')}
                  className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
                />
                <span className="text-xs text-zinc-500 shrink-0 tabular-nums">
                  {searchMatches.length > 0 ? `${matchIndex + 1}/${searchMatches.length}` : '0'}
                </span>
              </div>
            )}
          </div>

          {/* 流程大纲面板（右侧可折叠） */}
          {showOutline && <FlowOutline onClose={() => setShowOutline(false)} />}

          {/* 指令清单面板（只读目录，与大纲共用右侧位置） */}
          {showCommandList && <CommandListPanel onClose={() => setShowCommandList(false)} />}

          {/* 指令面板编辑器（挑哪些指令进 QQ 的 `/` 快捷面板；与它们共用右侧位置） */}
          {showCommandPanel && <CommandPanelEditor onClose={() => setShowCommandPanel(false)} />}

          {/* 出厂配置清单（模态，与右侧面板互不冲突） */}
          {showFactoryConfig && <FactoryConfigPanel onClose={() => setShowFactoryConfig(false)} />}
        </div>

        <LocalTestDialog open={showTestDialog} onClose={() => setShowTestDialog(false)} />
        <NewCommandWizard
          open={showCommandWizard}
          onCancel={() => setShowCommandWizard(false)}
          onConfirm={handleCreateCommand}
        />
        <ConfigQueryWizard
          open={showConfigQueryWizard}
          onCancel={() => setShowConfigQueryWizard(false)}
          onConfirm={handleCreateConfigQuery}
        />
        <TemplateLibrary open={showTemplateLib} onClose={() => setShowTemplateLib(false)} />
        <NewbieGuide />

        {/* 节点属性抽屉：点击节点时弹出 */}
        {drawerNode && (
          <PropertyDrawer
            node={drawerNode}
            edges={edges}
            upstreamNodes={drawerUpstreamNodes}
            onClose={handleCloseDrawer}
            onMoveUp={NOOP}
            onMoveDown={NOOP}
            onDelete={() => handleDeleteNode(drawerNode)}
            canMoveUp={false}
            canMoveDown={false}
            highlightField={highlightField}
            onHighlightConsumed={() => setHighlightField(null)}
          />
        )}

        {/* 快捷键帮助 */}
        <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

        {/* 全局节点搜索（Ctrl+K） */}
        <NodeSearchDialog />

        {/* 删除系统确认 */}
        <ConfirmDialog
          open={deleteSystemTarget !== null}
          onClose={() => setDeleteSystemTarget(null)}
          onConfirm={confirmDeleteSystem}
          title={t('blocks.editor.deleteSystem')}
          message={t('blocks.editor.deleteSystemConfirm', {
            name: deleteSystemTarget?.name ?? '',
          })}
          confirmText={t('drawer.confirmDelete')}
          variant="danger"
        />

        {/* 生成代码的命名面板：版号 + 名字（都预填，可改） */}
        <Modal
          open={genDialog}
          onClose={() => setGenDialog(false)}
          title={
            genHeadVersion !== null && !flowDirty
              ? t('blocks.editor.generateDialogTitleNoVersion')
              : t('blocks.editor.generateDialogTitle')
          }
          width="520px"
        >
          {genHeadVersion !== null && !flowDirty ? (
            // 当前提交已有版本 + 流程没改动 → 不能新建版本（否则"回到哪个版本"没有意义）。
            // **禁用输入框是糟糕的表达**（看起来像功能坏了），所以这里整块换成说明 + 单一出口。
            <div className="space-y-3">
              <p className="text-sm text-yellow-400">
                {t('blocks.editor.versionAtHeadHint', { name: genHeadVersion })}
              </p>
              <p className="text-xs text-zinc-400">{t('blocks.editor.versionNoChangeHowTo')}</p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setGenDialog(false)}>
                  {t('blocks.editor.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={generating}
                  onClick={() => void runGenerateCode(null)}
                >
                  {t('blocks.editor.generateOnly')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1" htmlFor="gen-version-name">
                  {t('blocks.editor.versionNumber')}
                </label>
                <input
                  id="gen-version-name"
                  value={genVersionName}
                  onChange={(e) => setGenVersionName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1" htmlFor="gen-version-message">
                  {t('blocks.editor.versionName')}
                </label>
                <input
                  id="gen-version-message"
                  value={genVersionMessage}
                  onChange={(e) => setGenVersionMessage(e.target.value)}
                  placeholder={t('blocks.editor.versionNamePlaceholder')}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
                />
              </div>
              <p className="text-xs text-zinc-500">{t('blocks.editor.versionHint')}</p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setGenDialog(false)}>
                  {t('blocks.editor.cancel')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={generating}
                  onClick={() => void runGenerateCode(null)}
                >
                  {t('blocks.editor.generateOnly')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={generating || !genVersionName.trim()}
                  onClick={() =>
                    void runGenerateCode({
                      name: genVersionName.trim(),
                      message: genVersionMessage.trim() || undefined,
                    })
                  }
                >
                  {t('blocks.editor.generateWithVersion')}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* 右键菜单（节点 + 画布空白） */}
        <BlockContextMenu
          contextMenu={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
          contextMenuItems={contextMenuItems}
          paneContextMenu={paneContextMenu}
          paneContextMenuItems={paneContextMenuItems}
          onCloseContextMenu={() => setContextMenu(null)}
          onClosePaneContextMenu={() => setPaneContextMenu(null)}
        />

        {/* 创建分组弹窗 */}
        {groupDialog && (
          <CreateGroupDialog
            nodeCount={groupDialog.nodeIds.length}
            onCancel={() => setGroupDialog(null)}
            onConfirm={confirmCreateGroup}
          />
        )}

        {/* 重命名分组弹窗 */}
        {renameDialog && (
          <RenameGroupDialog
            initialTitle={renameDialog.title}
            onCancel={() => setRenameDialog(null)}
            onConfirm={confirmRenameGroup}
          />
        )}

        {/* 折叠成子流程弹窗 */}
        {subflowDialog && (
          <CreateSubflowDialog
            nodeCount={subflowDialog.nodeIds.length}
            onCancel={() => setSubflowDialog(null)}
            onConfirm={confirmFoldToSubflow}
          />
        )}
      </div>
    </React.Profiler>
  );
});
