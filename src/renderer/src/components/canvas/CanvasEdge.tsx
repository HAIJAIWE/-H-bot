// src/renderer/src/components/canvas/CanvasEdge.tsx
//
// React Flow EdgeType 组件：渲染控制流边 + 箭头 + 执行态流动动画。
// 仅用于控制流边（数据流绑定走 PropertyDrawer，不在画布上画边）。
//
// 设计：
// - 静止态：灰色实线（#71717a）+ 箭头
// - hover 态：浅灰加粗（#a1a1aa，2.5px）— 提示可点击/可删
// - 选中态：蓝色加粗（#60a5fa，2.5px）
// - 执行态：绿色虚线（#10b981）+ 流动动画（dashoffset 滚动）
// - 颜色优先级：执行态绿 > 分支色 > 选中蓝 > hover 浅灰 > 默认灰
// - hover/选中时在中点显示 × 删除按钮（扣子式快捷操作）

import { memo, useState, useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { buildBackwardEdgePath, isBackwardEdge } from '../../lib/canvas/edgePath';
import { X } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 画布边类型标识（React Flow edgeTypes 注册用） */
export const CANVAS_EDGE_TYPE = 'control';

/** 数据流边类型标识：仅展示数据绑定关系（虚线蓝色），只读不可删除 */
export const CANVAS_DATA_EDGE_TYPE = 'data';

interface CanvasEdgeData {
  /** 执行态标记，由 BlockEditor 注入 */
  executing?: boolean;
  /** 分支色（hex），由 BlockEditor 从 source 节点 kind + sourcePort 派生注入。
   *  undefined 表示走默认灰。 */
  branchColor?: string;
  /** 分支中文标签（如 '真'/'假'/'循环体'），undefined 表示不显示标签 */
  branchLabel?: string;
}

/** 数据流边数据：展示绑定关系的源/目标端口名 */
interface CanvasDataEdgeData {
  sourcePortName?: string;
  targetPortName?: string;
}

export const CanvasEdge = memo(function CanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  useLocaleSubscription();
  const [hovered, setHovered] = useState(false);
  // hover 态变化触发的重渲染不改变几何形状，memo 短路重复的路径计算（C 修复）
  //
  // 两套几何：
  // - **普通边** → 贝塞尔（原来的样子）
  // - **回退边**（目标明显在源左边，如 `branch_if → 更早的节点` 这种循环）
  //   → 走"行下方 U 形绕行"。贝塞尔在这种情况下是一条横穿整行节点的长直线
  //   （真机实测最长回退 5070px，用户反馈"角度太奇怪"）。见 `lib/canvas/edgePath.ts`。
  const {
    path: edgePath,
    labelX,
    labelY,
  } = useMemo(() => {
    const geo = { sourceX, sourceY, targetX, targetY };
    if (isBackwardEdge(geo)) {
      // 回退边：正交 U 形绕行（见 lib/canvas/edgePath.ts）
      const b = buildBackwardEdgePath(geo);
      return { path: b.path, labelX: b.labelX, labelY: b.labelY };
    }
    // 普通边：贝塞尔。`getBezierPath` 返回 5 元组，只取前三个
    const [path, lx, ly] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    return { path, labelX: lx, labelY: ly };
  }, [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition]);

  const edgeData = data as CanvasEdgeData | undefined;
  const isExecuting = !!edgeData?.executing;
  const branchColor = edgeData?.branchColor;
  const branchLabel = edgeData?.branchLabel;

  // 颜色优先级：执行态绿 > 分支色 > 选中蓝 > hover 浅灰 > 默认灰
  const stroke = isExecuting
    ? '#10b981'
    : branchColor
      ? branchColor
      : selected
        ? '#60a5fa'
        : hovered
          ? '#a1a1aa'
          : '#71717a';

  // 加粗优先级：选中 = hover > 执行态 > 默认
  const strokeWidth = selected || hovered ? 2.5 : isExecuting ? 2.5 : 2;

  // 删除按钮显示条件：hover 或选中（执行态也允许删除，方便调试中断）
  const showDeleteBtn = hovered || selected;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#canvas-arrow)"
        interactionWidth={20}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: isExecuting ? '6 3' : undefined,
          animation: isExecuting ? 'dashflow 0.5s linear infinite' : undefined,
          transition: 'stroke 0.15s, stroke-width 0.15s',
        }}
      />
      {/* EdgeLabelRenderer：中点 hover 检测区 + 分支标签 + 删除按钮 */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            minWidth: '24px',
            minHeight: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="nodrag nopan"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* 分支标签（始终显示）：有分支色时背景/边框用其淡化色，无则中性灰 */}
          {branchLabel && (
            <div
              className="rounded px-1.5 py-0.5 text-xs font-medium border"
              style={{
                pointerEvents: 'none',
                backgroundColor: branchColor ? `${branchColor}26` : 'rgba(39, 39, 42, 0.9)',
                borderColor: branchColor ? `${branchColor}66` : '#52525b',
              }}
            >
              <span style={{ color: stroke }}>{branchLabel}</span>
            </div>
          )}
          {/* 删除按钮：hover/选中时显示在右上角 */}
          {showDeleteBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                useFlowStore.getState().removeEdge(id);
              }}
              className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 rounded-full bg-zinc-700 hover:bg-red-600 text-zinc-200 hover:text-white p-1 shadow-md border border-zinc-600 hover:border-red-400 flex items-center justify-center"
              title={t('canvas.edge.delete')}
              aria-label={t('canvas.edge.delete')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

/** 数据流边组件：虚线蓝色，展示节点间数据绑定关系。
 *  只读展示——数据绑定在配置面板（PropertyDrawer）中编辑，画布上不可直接删除/重连。 */
export const CanvasDataEdge = memo(function CanvasDataEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = useMemo(
    () =>
      getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  );
  const edgeData = data as CanvasDataEdgeData | undefined;
  const stroke = selected ? '#38bdf8' : hovered ? '#7dd3fc' : '#0ea5e9';
  const strokeWidth = selected || hovered ? 1.8 : 1.2;

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        path={edgePath}
        interactionWidth={14}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: '5 4',
          transition: 'stroke 0.15s, stroke-width 0.15s',
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className="rounded bg-sky-950/80 px-1.5 py-0.5 text-[10px] text-sky-300 border border-sky-700/60 whitespace-nowrap"
            style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {edgeData?.sourcePortName ?? ''} → {edgeData?.targetPortName ?? ''}
          </div>
        </div>
      </EdgeLabelRenderer>
    </g>
  );
});
