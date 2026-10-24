// src/renderer/src/components/canvas/CanvasNode.tsx
//
// React Flow NodeType 组件：渲染画布上的节点（扣子式大卡片）。
//
// 设计要点（扣子式重构）：
// - 卡片宽 320px，高度按内联字段数 + 端口数自适应
// - 三段式布局：Header（左边界色条 + 图标 + 标题 + 状态点）+ Inline Fields + Footer（摘要）
// - 每节点 1-2 个最常用字段直接在卡片编辑（InlineNodeFields），复杂字段走 PropertyDrawer
// - 单击节点 = 选中 + 打开 PropertyDrawer（交互习惯不变）
// - 内联字段 stopPropagation 防误触发
// - Handle 编码用 `${kind}__${portId}`（画布专用），像素定位避开 Header/Footer 区域
// - 每个端口旁渲染名称标签（卡片外侧），让用户看清端口用途
// - control 端口可连（圆形），data 端口不可连（菱形 isConnectable=false）

import { useDialogFocus } from '../../hooks/useDialogFocus';
import { hasKey, t } from '../../i18n';
import {
  BLOCK_COLORS,
  INLINE_FIELDS_MAP,
  NODE_WIDTH,
  formatSummary,
} from '../../lib/canvas/canvasConstants';
import { findEdgesOnPort } from '../../lib/canvas/connectedEdges';
import { findSpec, nodeDisplayLabel } from '../../lib/node/nodeCatalog';
import { encodeHandleId } from '../../lib/canvas/reactFlowAdapter';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { suggestNextNodes } from '../../services/connectionSuggester';
import type { NextNodeRecommendation } from '../../services/connectionSuggester';
import { parseErrorFieldKey, useFlowStore } from '../../stores/flowStore';
import { useI18nStore } from '../../stores/i18nStore';
import { getNodeIcon } from '../blocks/iconMap';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { toast } from '../ui/Toast';
import { InlineNodeFields } from './InlineNodeFields';
import {
  DATA_TYPE_BADGE_KEY,
  EMPTY_STRING_ARRAY,
  EMPTY_STRING_SET,
  ERROR_H,
  FOOTER_H,
  HEADER_H,
  INLINE_ROW_H,
  NODE_TYPE_LABEL,
  NOTE_ROW_H,
  PORT_LABEL_MAX_W,
  PORT_PAD,
  PORT_SPACING,
  computeHiddenPortCount,
  filterDataOutputs,
  handleStyle,
  handleTopPx,
  parseSwitchCases,
  statusDotColor,
  statusLabel,
} from './canvasNodeModel';
import type { CanvasNodeData } from './canvasNodeModel';
import type { FlowNode, Port } from '@shared/types/flow';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  ChevronDown,
  Database,
  GitBranch,
  Hash,
  Info,
  Plus,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 对外表面不变：这 5 个原来就在本文件导出（postDominator 与测试在用），2026-10 搬进 canvasNodeModel 后在此转出。
export {
  CANVAS_NODE_TYPE,
  parseSwitchCases,
  filterDataOutputs,
  computeHiddenPortCount,
  handleTopPx,
} from './canvasNodeModel';

/** 获取 dataType 对应的图标和颜色 */
function getDataTypeBadge(
  dataType?: string,
): { icon: React.ReactNode; color: string; label: string } | null {
  if (!dataType || dataType === 'any') return null;
  const badges: Record<string, { icon: React.ReactNode; color: string }> = {
    string: { icon: <Hash className="w-2.5 h-2.5" />, color: 'text-blue-400' },
    number: { icon: <Zap className="w-2.5 h-2.5" />, color: 'text-amber-400' },
    boolean: { icon: <Database className="w-2.5 h-2.5" />, color: 'text-emerald-400' },
    object: { icon: <Database className="w-2.5 h-2.5" />, color: 'text-purple-400' },
    list: { icon: <Database className="w-2.5 h-2.5" />, color: 'text-cyan-400' },
    json: { icon: <Database className="w-2.5 h-2.5" />, color: 'text-violet-400' },
    datetime: { icon: <Database className="w-2.5 h-2.5" />, color: 'text-rose-400' },
    event: { icon: <Zap className="w-2.5 h-2.5" />, color: 'text-pink-400' },
  };
  const base = badges[dataType];
  if (!base) return null;
  const key = DATA_TYPE_BADGE_KEY[dataType];
  return { ...base, label: key && hasKey(key) ? t(key) : String(dataType) };
}

export const CanvasNode = memo(function CanvasNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as CanvasNodeData;
  // 订阅 locale：节点标题/端口名/说明都来自目录，切语言必须重取（否则画布仍显示旧语言）
  const locale = useI18nStore((s) => s.locale);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- findSpec() 内部按当前语言取目录，locale 是它的隐含依赖，eslint 看不出来
  const spec = useMemo(() => findSpec(nodeData.nodeKind), [nodeData.nodeKind, locale]);
  const NodeIcon = getNodeIcon(nodeData.nodeKind);
  // 阶段 7 Part D：AI 主动推荐浮层
  const [showRecommend, setShowRecommend] = useState(false);
  const [recommendations, setRecommendations] = useState<NextNodeRecommendation[]>([]);
  // 打磨：hover 端口名称时显示自定义 tooltip（含 dataType + description）
  const [hoveredPort, setHoveredPort] = useState<Port | null>(null);
  // W6 修复：tooltip 方向自适应（节点在视口顶部时改向下渲染，避免被 .react-flow overflow:hidden 裁剪）
  const [tooltipAbove, setTooltipAbove] = useState(true);
  // P3 修复：mouseleave 后延迟 80ms 清空，避免相邻端口间隙移动时 tooltip 闪烁
  const hoveredPortLeaveTimer = useRef<number | null>(null);
  // W3 修复：AI 推荐浮层用屏幕坐标系（fixed + createPortal 到 document.body），
  // 避免 React Flow viewport 的 transform 把 absolute 定位截获成画布坐标系定位
  const [recommendPos, setRecommendPos] = useState<{ top: number; left: number } | null>(null);
  // P0-D3：删除分支节点前的二次确认（替代 window.confirm）；删除不可移除节点时仅提示（替代 window.alert）
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // P0-D2：AI 推荐浮层焦点管理（Esc 关闭 / Tab 循环 / 焦点回归）
  const { ref: recommendRef, titleId: recommendTitleId } = useDialogFocus<HTMLDivElement>(
    showRecommend,
    () => {
      setShowRecommend(false);
      setRecommendPos(null);
    },
  );
  // P0-D2：subflow_defined 调用位置浮层焦点管理（复用同一钩子模式）
  const [showRefs, setShowRefs] = useState(false);
  const [refsPos, setRefsPos] = useState<{ top: number; left: number } | null>(null);
  const [refCallers, setRefCallers] = useState<FlowNode[]>([]);
  const { ref: refsRef, titleId: refsTitleId } = useDialogFocus<HTMLDivElement>(showRefs, () => {
    setShowRefs(false);
    setRefsPos(null);
  });
  const enterPort = (p: Port, evt?: React.MouseEvent) => {
    if (hoveredPortLeaveTimer.current) {
      clearTimeout(hoveredPortLeaveTimer.current);
      hoveredPortLeaveTimer.current = null;
    }
    // W6：根据节点在屏幕的位置决定 tooltip 方向（上方空间 < 180 时改向下）
    if (evt) {
      const nodeEl = (evt.currentTarget as HTMLElement).closest(
        '.react-flow__node',
      ) as HTMLElement | null;
      if (nodeEl) {
        const rect = nodeEl.getBoundingClientRect();
        setTooltipAbove(rect.top > 180);
      }
    }
    setHoveredPort(p);
  };
  const leavePort = () => {
    hoveredPortLeaveTimer.current = window.setTimeout(() => setHoveredPort(null), 80);
  };
  // 组件卸载时清空定时器避免泄漏
  useEffect(() => {
    return () => {
      if (hoveredPortLeaveTimer.current) clearTimeout(hoveredPortLeaveTimer.current);
    };
  }, []);

  /** 点击 + 按钮：计算推荐并显示浮层
   *  W3 修复：浮层用屏幕坐标系（fixed + createPortal 到 document.body），
   *  避免被 React Flow viewport 的 transform 截获成 absolute 定位。
   *  按钮屏幕坐标 + 边界检测：右溢出改左侧，下溢出上移。 */
  const handleShowRecommend = (evt: React.MouseEvent<HTMLButtonElement>) => {
    const { nodes, edges } = useFlowStore.getState();
    // 构造当前节点对象（CanvasNode 拿不到完整 FlowNode，用 nodes 查找）
    const currentNode = nodes.find((n) => n.id === id);
    if (!currentNode) return;
    const recs = suggestNextNodes(currentNode, nodes, edges);
    setRecommendations(recs);
    // 打磨 P1：打开推荐浮层时清空端口 tooltip，避免残留"幽灵 tooltip"
    setHoveredPort(null);
    // W3：用按钮屏幕坐标定位浮层，避开 viewport transform
    const rect = evt.currentTarget.getBoundingClientRect();
    const FLOAT_W = 224; // w-56 = 14rem = 224px
    const FLOAT_H_EST = 200; // 估算高度（header 32 + 列表 max-h-48 ≈ 192 + padding）
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 水平：默认放按钮右侧 +4px；右边界溢出 → 左侧；两侧都不够 → 贴右边界
    let left = rect.right + 4;
    if (left + FLOAT_W > vw - 8) {
      left = rect.left - FLOAT_W - 4;
      if (left < 8) left = Math.max(8, vw - FLOAT_W - 8);
    }
    // 垂直：对齐按钮顶部；底部溢出 → 上移保证可见
    let top = rect.top;
    if (top + FLOAT_H_EST > vh - 8) {
      top = Math.max(8, vh - FLOAT_H_EST - 8);
    }
    setRecommendPos({ top, left });
    setShowRecommend(true);
  };

  /** 点击推荐项：发起应用请求 */
  const handleApplyRecommend = (rec: NextNodeRecommendation) => {
    useFlowStore.getState().requestApplyRecommend({
      sourceNodeId: id,
      nodeKind: rec.nodeKind,
      sourcePortId: rec.sourcePortId,
      targetPortId: rec.targetPortId,
      label: rec.label,
    });
    setShowRecommend(false);
  };

  // subflow_defined：统计引用它的 subflow_call 节点数（selector 返回 number，引用稳定不触发重渲染）
  const isSubflowDefine = nodeData.nodeKind === 'subflow_defined';
  const subflowCallCount = useFlowStore((s) => {
    if (!isSubflowDefine) return 0;
    let count = 0;
    for (const n of s.nodes) {
      if (n.data.nodeKind === 'subflow_call' && n.data.config?.subflow_id === id) count++;
    }
    return count;
  });

  /** 点击「被 N 处调用」徽标：收集调用该子流程的 subflow_call 节点并弹出引用列表
   *  W3 同款：浮层用屏幕坐标系（fixed + createPortal 到 document.body） */
  const handleShowRefs = (evt: React.MouseEvent<HTMLButtonElement>) => {
    setHoveredPort(null);
    const callers = useFlowStore
      .getState()
      .nodes.filter((n) => n.data.nodeKind === 'subflow_call' && n.data.config?.subflow_id === id);
    setRefCallers(callers);
    const rect = evt.currentTarget.getBoundingClientRect();
    const FLOAT_W = 224;
    let left = rect.right + 4;
    if (left + FLOAT_W > window.innerWidth - 8) {
      left = rect.left - FLOAT_W - 4;
      if (left < 8) left = Math.max(8, window.innerWidth - FLOAT_W - 8);
    }
    setRefsPos({ top: rect.bottom + 4, left });
    setShowRefs(true);
  };

  const nodeType = (spec?.type ?? 'action') as
    'trigger' | 'action' | 'logic' | 'data' | 'ai' | 'custom';
  const typeMeta = NODE_TYPE_LABEL[nodeType];
  // start_node/end_node 边界节点特殊配色：绿色起点 / 红色终点，便于识别流程边界
  const boundaryColorClass =
    nodeData.nodeKind === 'start_node'
      ? 'border-l-emerald-500 bg-emerald-950/30'
      : nodeData.nodeKind === 'end_node'
        ? 'border-l-rose-500 bg-rose-950/30'
        : null;
  const colorClass = boundaryColorClass ?? BLOCK_COLORS[nodeType] ?? BLOCK_COLORS.custom;
  const isTrigger = nodeType === 'trigger';
  // 摘要不用 useMemo：它内部走 i18n 取当前语言，而组件本就订阅 locale，
  // 语言切换时重渲染重算一次即可拿到新语言（formatSummary 是轻量 switch，无需缓存）。
  const summary = formatSummary({
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: nodeData,
  });

  // 仅订阅本节点执行状态，避免 N+1 重渲染（执行状态已改为 Set，has 为 O(1)）
  const isExecuting = useFlowStore((s) => s.executingNodeIds.has(id));
  const hasError = useFlowStore((s) => s.errorNodeIds.has(id));
  const isDone = useFlowStore((s) => s.doneNodeIds.has(id));
  // 阶段 6：AI 生成后高亮新增节点
  const isHighlighted = useFlowStore((s) => s.highlightedNodeIds.has(id));
  // 搜索匹配高亮（独立于 AI 高亮，持续显示直到搜索关闭）
  const isSearchMatch = useFlowStore((s) => s.searchMatchIds.has(id));
  // 连线起点端口高亮：本节点某端口是拖拽起点时，放大变蓝发光（仅起点节点重渲染，其他节点返回 null 不变）
  const connectingFromPortId = useFlowStore((s) =>
    s.connectingFromPort?.nodeId === id ? s.connectingFromPort.portId : null,
  );
  // 实时连线预判：当前节点的哪些端口是兼容目标（拖拽时高亮，不兼容置灰）
  // 注意：无数据时必须返回共享空集（模块级常量），否则每次渲染返回新 Set 引用，
  // zustand 认为状态持续变化 → useSyncExternalStore 无限重渲染（Maximum update depth）
  const compatibleTargetPortIds = useFlowStore(
    (s) => s.compatibleTargetPorts.get(id) ?? EMPTY_STRING_SET,
  );
  // 获取所有边（用于端口 tooltip 显示已连接节点）
  const allEdges = useFlowStore((s) => s.edges);
  const allNodes = useFlowStore((s) => s.nodes);
  const errorMsg = useFlowStore((s) => s.nodeErrors[id]?.[0]);
  // 运行前问题（来自 flow:validate 的统一真相层）：与"配置校验/运行时错误"分开显示，
  // 用琥珀色 ⚠ 提醒，红色错误条仍由 nodeErrors 独占
  const issues = useFlowStore((s) => s.nodeIssues[id] ?? EMPTY_STRING_ARRAY);
  const executionStatus: 'idle' | 'running' | 'done' | 'error' = hasError
    ? 'error'
    : isExecuting
      ? 'running'
      : isDone
        ? 'done'
        : 'idle';

  // 阶段 3：执行态/错误态边框视觉反馈
  const stateBorderClass = hasError
    ? 'border-red-500'
    : isExecuting
      ? 'border-blue-400 animate-pulse'
      : 'border-zinc-700';

  // ring 优先级（互斥显示，避免多种 ring 叠加视觉混乱）：
  // hasError > 搜索匹配(蓝) > AI 高亮(绿+pulse) > selected(蓝)
  // 搜索匹配用纯蓝色 ring（无 pulse），AI 高亮用绿色 ring + pulse（区分两者场景）
  const ringClass = hasError
    ? selected
      ? 'ring-2 ring-red-400'
      : ''
    : isSearchMatch
      ? 'ring-2 ring-blue-400'
      : isHighlighted
        ? 'ring-2 ring-emerald-400 animate-pulse'
        : selected
          ? 'ring-2 ring-blue-500'
          : '';

  // 打磨 #3：hover 边框高亮（仅默认态启用，不覆盖错误/执行态边框色）
  // 错误/执行态保留 stateBorderClass 的红/蓝边框，避免 hover 覆盖关键状态信息
  const hoverBorderClass =
    !hasError && !isExecuting ? 'hover:border-zinc-500 hover:shadow-lg hover:shadow-black/30' : '';

  // 端口列表：优先用 catalog spec，回退到 node.data
  const inputs = useMemo(() => spec?.inputs ?? nodeData.inputs ?? [], [spec, nodeData.inputs]);
  const outputs = useMemo(() => spec?.outputs ?? nodeData.outputs ?? [], [spec, nodeData.outputs]);

  // 控制流端口（用于画 Handle）
  const controlInputs = useMemo(() => inputs.filter((p) => p.kind === 'control'), [inputs]);
  // 与 filterDataOutputs 同一条规则：**任何状态都按 showWhen 过滤**（展开只影响截断长度）
  const dataInputs = useMemo(
    () =>
      inputs
        .filter((p) => p.kind === 'data')
        .filter((p) => (typeof p.showWhen === 'function' ? p.showWhen(nodeData.config) : true)),
    [inputs, nodeData.config],
  );
  const controlOutputs = useMemo(() => outputs.filter((p) => p.kind === 'control'), [outputs]);
  const dataOutputs = useMemo(
    () => filterDataOutputs(outputs, nodeData.config, !!nodeData.expanded),
    [outputs, nodeData.expanded, nodeData.config],
  );

  // 阶段 4：branch_switch 动态 case 分支端口（解析 config.cases JSON）
  // 排除与静态 control 输出端口 id 冲突的 case label（罕见配置错误，见 parseSwitchCases 注释）
  const reservedCaseIds = useMemo(() => new Set(controlOutputs.map((p) => p.id)), [controlOutputs]);
  const dynamicCaseOutputs = useMemo(
    () => parseSwitchCases(nodeData.nodeKind, nodeData.config, reservedCaseIds),
    [nodeData.nodeKind, nodeData.config, reservedCaseIds],
  );

  // 合并静态控制出口 + 动态 case 端口（静态在前，动态在后）
  const allControlOutputs = useMemo(
    () => [...controlOutputs, ...dynamicCaseOutputs],
    [controlOutputs, dynamicCaseOutputs],
  );

  // 合并左右端口数组（用于百分比 handle 定位）
  const leftPorts = useMemo(() => {
    if (isTrigger) return [] as Port[];
    return [...controlInputs, ...dataInputs];
  }, [isTrigger, controlInputs, dataInputs]);
  const rightPorts = useMemo(
    () => [...allControlOutputs, ...dataOutputs],
    [allControlOutputs, dataOutputs],
  );

  // 阶段 5：节点高度自适应 + 折叠态溢出 "+N" 提示
  const isExpanded = !!nodeData.expanded;
  // 折叠态只渲染前 COLLAPSED_PORT_LIMIT 个端口，与右下角 "+N" 提示一致
  // （原实现全部渲染仍提示隐藏数，摘要卡被端口撑满且提示矛盾）
  const COLLAPSED_PORT_LIMIT = 4;
  const visibleLeftPorts = isExpanded ? leftPorts : leftPorts.slice(0, COLLAPSED_PORT_LIMIT);
  const visibleRightPorts = isExpanded ? rightPorts : rightPorts.slice(0, COLLAPSED_PORT_LIMIT);
  const maxPortCount = Math.max(visibleLeftPorts.length, visibleRightPorts.length);
  // 左右两侧各自统计溢出数量：折叠态只渲染前 COLLAPSED_PORT_LIMIT 个端口，
  // 每侧各给一个 "+N" 胶囊。原来只算右侧 —— 左侧被截断时没有任何提示，
  // 用户会以为节点本来就没有这些输入端口（channel_op 扩到 47 模式后尤其明显）。
  const hiddenLeftPortCount = computeHiddenPortCount(
    leftPorts.length,
    isExpanded,
    COLLAPSED_PORT_LIMIT,
  );
  const hiddenRightPortCount = computeHiddenPortCount(
    rightPorts.length,
    isExpanded,
    COLLAPSED_PORT_LIMIT,
  );

  // 内联字段数（按 showWhen 过滤；折叠态不显示内联字段，卡片压缩为「标题 + 摘要」摘要卡）
  const inlineFields = INLINE_FIELDS_MAP[nodeData.nodeKind] ?? [];
  const visibleInlineCount = isExpanded
    ? inlineFields.filter((f) => !f.showWhen || f.showWhen(nodeData.config)).length
    : 0;
  const inlineH = visibleInlineCount * INLINE_ROW_H;

  // 高度计算：max(内容高度, 端口所需高度, 最小高度) + 错误条高度
  //
  // 端口所需高度必须**包含 Header/内联字段**：端口带从 Header（或内联字段）之下开始，
  // 若只按 `maxPortCount * PORT_SPACING` 预留，端口带会被压扁 → 标签重叠（历史 bug）。
  // `PORT_PAD` 作为端口带上下各留的余量（单端口节点也不会贴着头/脚）。
  const contentH = HEADER_H + inlineH + FOOTER_H;
  const portsBodyH = maxPortCount > 0 ? maxPortCount * PORT_SPACING + PORT_PAD : 0;
  const portsNeedH = HEADER_H + inlineH + portsBodyH + FOOTER_H;
  const errorH = hasError && errorMsg ? ERROR_H : 0;
  /**
   * 备注行高度。**必须加进 nodeHeight**：否则备注行会把卡片顶高、
   * 端口带（按 portBandStart/End 算）就跟着错位 —— canvasNodeNote 测试钉的第二条。
   */
  const noteH = nodeData.description ? NOTE_ROW_H : 0;
  const nodeHeight = Math.max(contentH, portsNeedH, 64) + noteH + errorH;
  // 端口带：Header（含内联字段）之下 → Footer 与错误条之上
  const portBandStart = HEADER_H + inlineH;
  const portBandEnd = nodeHeight - FOOTER_H - errorH;

  return (
    <div
      className={`group relative flex flex-col rounded-lg border-l-2 ${colorClass} border ${stateBorderClass} ${hoverBorderClass} ${ringClass} shadow-md transition-[border-color,box-shadow] duration-150`}
      style={{ width: `${NODE_WIDTH}px`, minHeight: `${nodeHeight}px` }}
      title={hasError && errorMsg ? t('canvas.node.errorTitle', { msg: errorMsg }) : undefined}
    >
      {/* 选中态删除浮层：右上角 × 按钮（扣子式快捷操作，trigger 不可删） */}
      {selected && !isTrigger && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // W2 修复：删除前校验
            // 1. canRemoveNode 检查（subflow_defined 被引用时返回错误信息）
            //    → P0-D3：用 toast.error 提示，替代阻塞式 window.alert
            // 2. 多分支节点（branch_if/branch_switch/try_catch/loop）删除会断开非延续分支，
            //    → P0-D3：用 ConfirmDialog 二次确认，替代阻塞式 window.confirm
            const reason = useFlowStore.getState().canRemoveNode(id);
            if (reason) {
              toast.error(reason);
              return;
            }
            const node = useFlowStore.getState().nodes.find((n) => n.id === id);
            const multiBranchKinds = ['branch_if', 'branch_switch', 'try_catch', 'loop'];
            if (node && multiBranchKinds.includes(node.data.nodeKind)) {
              setDeleteConfirm(id);
              return;
            }
            useFlowStore.getState().deleteNodeAndReconnect(id);
          }}
          className="absolute -top-2 -right-2 z-20 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg border border-red-400 transition-colors"
          title={t('canvas.node.deleteWithShortcut')}
          aria-label={t('drawer.deleteNode')}
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* P4：trigger 节点选中时显示提示条（无删除入口，引导用户去删除系统分组） */}
      {selected && isTrigger && (
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded bg-zinc-700 text-[10px] text-zinc-300 whitespace-nowrap shadow-md border border-zinc-600 pointer-events-none"
          title={t('canvas.node.triggerProtected')}
        >
          {t('canvas.node.triggerGroupHint')}
        </div>
      )}

      {/* Handle: inputs 在左侧（像素定位） + 端口名称标签 */}
      {visibleLeftPorts.map((p, i) => {
        const badge = getDataTypeBadge(p.dataType);
        const isConnecting = connectingFromPortId !== null;
        // 只有在连线拖拽时且当前节点是目标节点时，才检查兼容性
        const isTargetCompatible = isConnecting ? compatibleTargetPortIds.has(p.id) : true;

        return (
          <Fragment key={`li-${p.id}`}>
            <Handle
              id={encodeHandleId({ kind: p.kind, id: p.id })}
              type="target"
              position={Position.Left}
              isConnectable={p.kind === 'control'}
              className={p.kind === 'control' ? 'port-control' : 'port-data'}
              style={handleStyle(
                p.kind,
                i,
                visibleLeftPorts.length,
                'left',
                portBandStart,
                portBandEnd,
                connectingFromPortId === p.id,
                isTargetCompatible,
              )}
            />
            {/* 端口名画在卡片**内部**（原实现画在卡片外 `right:100%`：会和左侧邻居
                的端口名/连线挤在一起，看起来像"字飘在画布上"）。类型徽标放外侧，
                让"名称贴近端口、徽标在外"的读法两侧一致。 */}
            <span
              role="text"
              tabIndex={0}
              data-port-side="input"
              aria-label={t('canvas.portInputAria', {
                kind: p.kind === 'control' ? t('canvas.portControl') : t('canvas.portData'),
                name: p.name,
              })}
              className="absolute -translate-y-1/2 select-none text-left text-[11px] leading-none text-zinc-300 hover:text-zinc-100 cursor-help focus:outline-none focus:ring-1 focus:ring-blue-500/50 rounded-sm flex items-center gap-1"
              title={
                p.kind === 'data'
                  ? t('canvas.node.dataPortTitle', {
                      name: p.name,
                      type: p.dataType ? ` (${p.dataType})` : '',
                    })
                  : undefined
              }
              style={{
                top: `${handleTopPx(i, visibleLeftPorts.length, portBandStart, portBandEnd)}px`,
                left: '12px',
                maxWidth: `${PORT_LABEL_MAX_W}px`,
              }}
              onMouseEnter={(e) => enterPort(p, e)}
              onMouseLeave={leavePort}
            >
              <span className="truncate min-w-0">{p.name}</span>
              {badge && (
                <span
                  className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-mono ${badge.color} bg-black/30 border border-current/20`}
                  title={t('canvas.node.badgeTypeTitle', {
                    label: badge.label,
                    type: p.dataType ?? '',
                  })}
                >
                  {badge.icon}
                  <span className="hidden sm:inline">{badge.label}</span>
                </span>
              )}
            </span>
          </Fragment>
        );
      })}

      {/* ===== Header：左边界色条 + 图标 + 标题 + 状态点 ===== */}
      <div
        className="flex items-center gap-1.5 px-2 border-b border-zinc-700/50"
        style={{ height: `${HEADER_H}px` }}
      >
        <span className="text-base shrink-0">
          {NodeIcon ? <NodeIcon className="w-4 h-4" /> : null}
        </span>
        <span
          className="text-xs font-medium text-zinc-100 truncate flex-1 cursor-help"
          title={spec?.description || nodeDisplayLabel({ data: nodeData }) || nodeData.nodeKind}
        >
          {nodeDisplayLabel({ data: nodeData }) || nodeData.nodeKind}
        </span>
        {/* 类型标签：仅展开态显示（折叠态由彩色左边界条承担类型辨识，给标题/徽标腾空间） */}
        {typeMeta && isExpanded && (
          <span className={`shrink-0 rounded px-1 text-[10px] leading-tight ${typeMeta.cls}`}>
            {typeMeta.text}
          </span>
        )}
        {/* subflow_defined：引用计数徽标，点击弹出调用位置列表 */}
        {isSubflowDefine && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleShowRefs(e);
            }}
            className={`shrink-0 rounded px-1 text-[10px] leading-tight border transition-colors ${
              subflowCallCount > 0
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
            }`}
            title={
              subflowCallCount > 0
                ? t('canvas.node.viewCallSites', { count: subflowCallCount })
                : t('canvas.node.notCalledTitle')
            }
          >
            {subflowCallCount > 0
              ? t('canvas.node.calledTimes', { count: subflowCallCount })
              : t('canvas.node.notCalled')}
          </button>
        )}
        {hasError && (
          <AlertTriangle
            className="w-3.5 h-3.5 text-red-400 shrink-0"
            aria-label={t('canvas.node.execError')}
          />
        )}
        {/* 展开/折叠按钮：始终显示，点击切换（stopPropagation 防冒泡到卡片单击开抽屉） */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            useFlowStore.getState().setNodeExpanded(id, !isExpanded);
          }}
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300"
          aria-label={isExpanded ? t('canvas.node.collapseAria') : t('canvas.node.expandAria')}
          title={isExpanded ? t('canvas.node.collapseTitle') : t('canvas.node.expandTitle')}
        >
          <ChevronDown
            className={`w-3 h-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
          />
        </button>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor(executionStatus)}`}
          title={t('canvas.node.statusTitle', { status: statusLabel(executionStatus) })}
        />
        {/* 运行前问题标记：画布上直接看见"哪个节点有问题"，不必等跑起来或翻面板。
            红色错误条已由 nodeErrors 负责，这里只在没有红色错误时显示琥珀提醒。 */}
        {issues.length > 0 && !hasError && (
          <span
            className="shrink-0 flex items-center"
            data-testid={`node-issue-${id}`}
            title={t('canvas.node.issuesTitle', { issues: issues.join('\n') })}
          >
            <AlertTriangle className="w-3 h-3 text-amber-400" />
          </span>
        )}
      </div>

      {/* ===== 备注行：显示在【节点名下方】=====
          用户 2026-10-10 提的：AI 会去拼「收到消息/签到」这种「类型名 + 意图」的标题，
          根因是画布上唯一能写字的地方就是标题。备注只要看得见，就不必污染标题。
          高度已计入 nodeHeight（NOTE_ROW_H）—— 没备注时**不渲染**（不留空行）。 */}
      {nodeData.description && (
        <div
          className="px-2 text-[11px] text-zinc-400 truncate border-b border-zinc-700/30"
          style={{ height: `${NOTE_ROW_H}px`, lineHeight: `${NOTE_ROW_H}px` }}
          title={nodeData.description}
        >
          {nodeData.description}
        </div>
      )}
      {/* ===== Inline Fields：内联配置字段（仅展开态显示；折叠态为摘要卡片） ===== */}
      {isExpanded && visibleInlineCount > 0 && (
        <div className="border-b border-zinc-700/50 bg-zinc-900/30">
          <InlineNodeFields nodeId={id} nodeKind={nodeData.nodeKind} config={nodeData.config} />
        </div>
      )}

      {/* ===== Footer：摘要（视觉锚点 + 配置摘要 + 节点 ID 辅助调试） =====
          W4 修复：mt-auto 把 Footer 推到卡片底部，避免端口多时 Footer 悬浮在卡片中段留空白 */}
      <div
        className="mt-auto px-2 flex items-center gap-1 bg-zinc-900/30 border-t border-zinc-700/30"
        style={{ height: `${FOOTER_H}px` }}
      >
        <Info className="w-2.5 h-2.5 text-zinc-600 shrink-0" aria-hidden />
        <p
          className={`text-[11px] truncate font-mono flex-1 transition-colors ${summary ? 'text-zinc-400 group-hover:text-zinc-300' : 'text-zinc-600 italic'}`}
          title={
            summary
              ? `${isExpanded ? t('canvas.node.summary') : t('canvas.node.summaryHint')}：${summary}`
              : t('canvas.node.notConfiguredHint')
          }
        >
          {summary || t('canvas.summary.notConfigured')}
        </p>
        <span
          className={`text-[10px] text-zinc-600 shrink-0 tabular-nums font-mono transition-opacity ${isExpanded ? '' : 'opacity-0 group-hover:opacity-100'}`}
          title={t('canvas.node.idTitle', { id })}
        >
          {id}
        </span>
      </div>

      {/* 阶段 7 Part A：错误消息可点击跳转修复 */}
      {hasError && errorMsg && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // 解析错误消息中的字段 key 并发起修复请求
            const fieldKey = parseErrorFieldKey(errorMsg);
            useFlowStore.getState().requestErrorFix(id, fieldKey);
          }}
          className="block w-full text-left px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border-t border-red-500/30 truncate cursor-pointer"
          title={t('canvas.node.fixHint')}
        >
          <AlertTriangle className="w-3 h-3 inline-block mr-1 -translate-y-px" />
          {errorMsg}
        </button>
      )}

      {/* 阶段 7 Part D：AI 主动推荐 — + 按钮（右下角）。
          选中节点时常驻显示（蓝色背景区分），未选中时 hover 显示（不嘈杂画布）。 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleShowRecommend(e);
        }}
        className={`absolute -right-1.5 -bottom-1.5 w-5 h-5 rounded-full flex items-center justify-center transition-opacity z-10 ${
          selected
            ? 'opacity-100 bg-blue-500 text-white'
            : 'opacity-0 group-hover:opacity-100 bg-zinc-700 hover:bg-blue-500 text-zinc-300 hover:text-white'
        }`}
        title={t('canvas.node.aiSuggestAria')}
      >
        <Sparkles className="w-3 h-3" />
      </button>

      {/* 阶段 7 Part D：推荐浮层
          W3 修复：用 createPortal 渲染到 document.body + fixed 定位，
          脱离 React Flow viewport 的 transform，避免浮层位置随画布缩放/平移错乱 */}
      {showRecommend &&
        recommendPos &&
        createPortal(
          <>
            {/* 透明遮罩：点击关闭浮层 */}
            <div
              className="fixed inset-0 z-[9998]"
              onClick={(e) => {
                e.stopPropagation();
                setShowRecommend(false);
                setRecommendPos(null);
              }}
            />
            <div
              ref={recommendRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={recommendTitleId}
              tabIndex={-1}
              className="fixed z-[9999] w-56 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg overflow-hidden outline-none"
              style={{ top: `${recommendPos.top}px`, left: `${recommendPos.left}px` }}
            >
              <div className="px-2 py-1.5 text-xs text-zinc-500 border-b border-zinc-700 flex items-center gap-1 bg-zinc-900/50">
                <Plus className="w-3 h-3" />
                <span id={recommendTitleId}>{t('canvas.node.suggest')}</span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {recommendations.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-zinc-500">
                    {t('canvas.node.noSuggestion')}
                  </div>
                ) : (
                  recommendations.map((rec, recIndex) => {
                    const RecIcon = getNodeIcon(rec.nodeKind);
                    return (
                      <button
                        // 同一 kind 可能有多个推荐（不同来源端口），用 index 保证 key 唯一
                        key={`${rec.nodeKind}-${recIndex}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApplyRecommend(rec);
                          setRecommendPos(null);
                        }}
                        className="w-full px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-700/50 flex items-center gap-2 border-b border-zinc-700/50 last:border-b-0"
                        title={rec.reason}
                      >
                        <RecIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="flex-1 truncate">{rec.label}</span>
                        <span className="text-xs text-zinc-500 shrink-0 tabular-nums">
                          {Math.round(rec.confidence * 100)}%
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* subflow_defined 调用位置浮层：列出引用它的 subflow_call 节点，点击跳转聚焦 */}
      {showRefs &&
        refsPos &&
        createPortal(
          <>
            {/* 透明遮罩：点击关闭浮层 */}
            <div
              className="fixed inset-0 z-[9998]"
              onClick={(e) => {
                e.stopPropagation();
                setShowRefs(false);
                setRefsPos(null);
              }}
            />
            <div
              ref={refsRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={refsTitleId}
              tabIndex={-1}
              className="fixed z-[9999] w-56 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg overflow-hidden outline-none"
              style={{ top: `${refsPos.top}px`, left: `${refsPos.left}px` }}
            >
              <div className="px-2 py-1.5 text-xs text-zinc-500 border-b border-zinc-700 flex items-center gap-1 bg-zinc-900/50">
                <GitBranch className="w-3 h-3" />
                <span id={refsTitleId}>{t('canvas.node.callSites')}</span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {refCallers.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-zinc-500">
                    {t('canvas.node.noCallSites')}
                  </div>
                ) : (
                  refCallers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowRefs(false);
                        setRefsPos(null);
                        focusNode(c.id);
                      }}
                      className="w-full px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-700/50 flex items-center gap-2 border-b border-zinc-700/50 last:border-b-0"
                      title={t('canvas.node.jumpToCaller', { id: c.id })}
                    >
                      <span className="flex-1 truncate">
                        {nodeDisplayLabel(c) || c.data.nodeKind}
                      </span>
                      <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums font-mono">
                        {c.id}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* 折叠态溢出端口提示（左右各一个 "+N" 胶囊，双击展开查看）
          原样式是 10px 的 zinc-500 纯文字，在深色画布上几乎看不见 —— 用户会以为
          节点只有这几个端口。现在改成有底有边的胶囊，并在 tooltip 里说清怎么展开。
          左侧胶囊贴左下；右侧胶囊贴右下但要避开 AI 推荐按钮（-right-1.5 的圆形按钮），
          所以用 right-6 让出位置。 */}
      {!isExpanded && hiddenLeftPortCount > 0 && (
        <span
          className="absolute -bottom-1 left-1.5 z-10 rounded border border-zinc-600 bg-zinc-800 px-1 text-[10px] leading-4 text-zinc-300 cursor-pointer hover:border-zinc-400 hover:text-zinc-100"
          title={t('canvas.node.hiddenLeftPorts', { count: hiddenLeftPortCount })}
        >
          +{hiddenLeftPortCount}
        </span>
      )}
      {!isExpanded && hiddenRightPortCount > 0 && (
        <span
          className="absolute -bottom-1 right-6 z-10 rounded border border-zinc-600 bg-zinc-800 px-1 text-[10px] leading-4 text-zinc-300 cursor-pointer hover:border-zinc-400 hover:text-zinc-100"
          title={t('canvas.node.hiddenRightPorts', { count: hiddenRightPortCount })}
        >
          +{hiddenRightPortCount}
        </span>
      )}

      {/* Handle: outputs 在右侧（像素定位） + 端口名称标签 */}
      {visibleRightPorts.map((p, i) => {
        const badge = getDataTypeBadge(p.dataType);
        const isTargetCompatible = connectingFromPortId ? true : true; // 暂时都兼容
        return (
          <Fragment key={`ro-${p.id}`}>
            <Handle
              id={encodeHandleId({ kind: p.kind, id: p.id })}
              type="source"
              position={Position.Right}
              isConnectable={p.kind === 'control'}
              className={p.kind === 'control' ? 'port-control' : 'port-data'}
              style={handleStyle(
                p.kind,
                i,
                visibleRightPorts.length,
                'right',
                portBandStart,
                portBandEnd,
                connectingFromPortId === p.id,
                isTargetCompatible,
              )}
            />
            {/* 与输入侧对称：名称贴近端口（右对齐），类型徽标在更内侧 */}
            <span
              role="text"
              tabIndex={0}
              data-port-side="output"
              aria-label={t('canvas.portOutputAria', {
                kind: p.kind === 'control' ? t('canvas.portControl') : t('canvas.portData'),
                name: p.name,
              })}
              className="absolute -translate-y-1/2 select-none text-right text-[11px] leading-none text-zinc-300 hover:text-zinc-100 cursor-help focus:outline-none focus:ring-1 focus:ring-blue-500/50 rounded-sm flex items-center justify-end gap-1"
              title={
                p.kind === 'data'
                  ? t('canvas.node.dataPortTitle', {
                      name: p.name,
                      type: p.dataType ? ` (${p.dataType})` : '',
                    })
                  : undefined
              }
              style={{
                top: `${handleTopPx(i, visibleRightPorts.length, portBandStart, portBandEnd)}px`,
                right: '12px',
                maxWidth: `${PORT_LABEL_MAX_W}px`,
              }}
              onMouseEnter={(e) => enterPort(p, e)}
              onMouseLeave={leavePort}
            >
              {badge && (
                <span
                  className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-mono ${badge.color} bg-black/30 border border-current/20`}
                  title={t('canvas.node.badgeTypeTitle', {
                    label: badge.label,
                    type: p.dataType ?? '',
                  })}
                >
                  {badge.icon}
                  <span className="hidden sm:inline">{badge.label}</span>
                </span>
              )}
              <span className="truncate min-w-0">{p.name}</span>
            </span>
          </Fragment>
        );
      })}

      {/* 打磨：hover 端口名称时显示自定义 tooltip（含 dataType + description + 端口类型）
          W6 修复：tooltip 方向自适应 — 节点在视口顶部时（上方空间不足）改向下渲染，
          避免 .react-flow 容器 overflow:hidden 裁剪掉 tooltip */}
      {hoveredPort && (
        <div
          className={`absolute ${tooltipAbove ? 'bottom-full mb-1' : 'top-full mt-1'} left-1/2 -translate-x-1/2 z-30 w-64 rounded-md bg-zinc-900 border border-zinc-700 shadow-lg p-2 pointer-events-none`}
          role="tooltip"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${hoveredPort.kind === 'control' ? 'bg-emerald-400' : 'bg-blue-400 rotate-45'}`}
            />
            <span className="text-xs font-medium text-zinc-100 truncate flex-1">
              {hoveredPort.name}
            </span>
            {hoveredPort.dataType && (
              <span className="text-[10px] text-zinc-500 shrink-0 ml-auto">
                {hoveredPort.dataType}
              </span>
            )}
          </div>
          {hoveredPort.description && (
            <p className="text-[11px] text-zinc-400 leading-snug mb-1">{hoveredPort.description}</p>
          )}
          {/* 显示已连接的节点 */}
          {(() => {
            // 按「节点 + 端口」找，不看 handle —— 原因见 lib/canvas/connectedEdges.ts
            // （原来比的是 `${节点id}__${端口}`，而渲染用的是 `${端口类型}__${端口}`，
            //  两套约定永不相等 → 这一栏对所有边都不显示）
            const isInputPort = inputs.some((p) => p.id === hoveredPort.id);
            const connected = findEdgesOnPort(allEdges, id, hoveredPort.id, isInputPort);
            if (connected.length === 0) return null;
            return (
              <div className="mb-1 p-1.5 bg-zinc-800/50 rounded text-[10px]">
                <span className="text-zinc-500">
                  {t('canvas.node.connected', { count: connected.length })}
                </span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {connected.map((e) => {
                    const otherNodeId = hoveredPort.kind === 'control' ? e.target : e.source;
                    const otherNode = allNodes.find((n) => n.id === otherNodeId);
                    return (
                      <span
                        key={e.id}
                        className="px-1.5 py-0.5 bg-zinc-700/50 rounded text-zinc-300 hover:bg-zinc-600 cursor-pointer transition-colors"
                        title={`${hoveredPort.kind === 'control' ? '→' : '←'} ${otherNode?.data?.label || otherNodeId}`}
                        onClick={() => {
                          if (otherNode) focusNode(otherNodeId);
                        }}
                      >
                        {hoveredPort.kind === 'control' ? '→ ' : '← '}
                        {otherNode?.data?.label || otherNodeId}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-1 text-[10px] text-zinc-500 mb-1">
            <div>
              <span className="text-zinc-400">{t('canvas.node.typePrefix')}</span>
              <span className="text-zinc-300">
                {hoveredPort.kind === 'control' ? t('canvas.portControl') : t('canvas.portData')}
              </span>
            </div>
            <div>
              <span className="text-zinc-400">{t('canvas.node.requiredPrefix')}</span>
              <span className={hoveredPort.required ? 'text-red-400' : 'text-emerald-400'}>
                {hoveredPort.required ? t('data.yes') : t('data.no')}
              </span>
            </div>
            {hoveredPort.default !== undefined && (
              <div className="col-span-2">
                <span className="text-zinc-400">{t('canvas.node.defaultPrefix')}</span>
                <span className="text-zinc-300 font-mono text-[9px]">
                  {String(hoveredPort.default).slice(0, 20)}
                </span>
              </div>
            )}
            <div className="col-span-2 text-[10px] text-zinc-600">
              {hoveredPort.kind === 'control'
                ? t('canvas.node.portLegendControl')
                : t('canvas.node.portLegendData')}
            </div>
          </div>
        </div>
      )}

      {/* P0-D3：删除分支节点二次确认（替代 window.confirm，ConfirmDialog 内部走 createPortal） */}
      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            useFlowStore.getState().deleteNodeAndReconnect(deleteConfirm);
          }
          setDeleteConfirm(null);
        }}
        title={t('drawer.deleteBranchNode')}
        message={t('drawer.deleteBranchConfirm')}
        confirmText={t('drawer.confirmDelete')}
        variant="danger"
      />
    </div>
  );
});
