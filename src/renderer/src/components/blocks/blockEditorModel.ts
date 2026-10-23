// src/renderer/src/components/blocks/blockEditorModel.ts
//
// `BlockEditor` 的**纯**常量与小工具（拆分 Step 2）。
//
// 判据：**不依赖 React 渲染、不引入组件**的东西才放这里。所以：
//   · React Flow 的 props 常量 ✓（关键是"模块级"——内联会让 React Flow 每帧当它变了）
//   · 平移步长 / 错误预览长度 / 截断函数 ✓
//   · `placeNewNodesBelow` ✓（只跟 flowStore 打交道，模块级函数）
//   · **不**放 `nodeTypes` / `edgeTypes` ✗ —— 它们引用 `CanvasNode` 等组件，
//     搬进来会让这个"模型"文件依赖 React 组件树（违背了它存在的意义）
import type { CSSProperties } from 'react';
import { useFlowStore } from '@renderer/stores/flowStore';
import { NODE_WIDTH } from '@renderer/lib/canvas/canvasConstants';

/**
 * 新建节点横向间距（卡片宽度 + 留白）。
 *
 * ⚠️ 必须 ≥ NODE_WIDTH：这里曾写成固定 300，而卡片宽 320 ——
 * 向导一次生成的「触发器 + 回复」两个节点会右压左叠 20px，
 * 端口标签直接糊在隔壁卡片上。
 */
const NEW_NODE_GAP = 80;

/**
 * React Flow 的 props 常量。
 *
 * ⚠️ 这些**必须是模块级常量**：内联写成 `proOptions={{...}}` / `snapGrid={[8,8]}`
 * 会在每次渲染产生新引用，React Flow 内部把它当"变了"，跟着做额外工作 ——
 * 而拖拽时编辑器每帧都渲染一次（官方文档也点名过这个坑）。
 */
export const RF_PRO_OPTIONS = { hideAttribution: true } as const;
export const RF_SNAP_GRID: [number, number] = [8, 8];
export const RF_CONNECTION_LINE_STYLE: CSSProperties = { stroke: '#3b82f6', strokeWidth: 2 };

/** 空操作回调 */
export const NOOP = (): void => {};

/**
 * 方向键平移画布的步长（屏幕像素）。
 *
 * 为什么需要键盘平移：列表式布局是**一条链一行、不折行**（见 `autoLayout.ts`），
 * 一条 44 节点的链宽约 1.7 万像素 —— 光靠鼠标拖太慢。
 */
export const PAN_STEP = 80;
/** 按住 Shift / Ctrl 时的加速步长（长链一路挪过去不必按几十次） */
export const PAN_STEP_FAST = 400;

/** 加载失败文案的预览长度（zod 校验错误可能上千字，界面只展示开头，全文放 title） */
export const ERROR_PREVIEW_MAX = 200;

/** 截断过长的错误文案（保留全文给 title / 复制排查） */
export function previewError(message: string): string {
  return message.length > ERROR_PREVIEW_MAX ? message.slice(0, ERROR_PREVIEW_MAX) + '…' : message;
}

/**
 * 把刚插入的节点摆到现有内容下方（横向排开）。
 *
 * `updateNodePositions` 不进历史 —— 向导生成的链因此能被一次 Ctrl+Z 整体撤销，
 * 而不是"撤销三次才回到创建前"。
 */
export function placeNewNodesBelow(ids: string[]): void {
  // 读插入后的最新状态（getState 是快照，插入前的那个对象看不到新节点）
  const latest = useFlowStore.getState();
  const maxY = latest.nodes.length ? Math.max(...latest.nodes.map((n) => n.position.y)) : 0;
  const baseY = latest.nodes.length > ids.length ? maxY + 160 : 0;
  useFlowStore
    .getState()
    .updateNodePositions(
      new Map(ids.map((id, i) => [id, { x: 40 + i * (NODE_WIDTH + NEW_NODE_GAP), y: baseY }])),
    );
}
