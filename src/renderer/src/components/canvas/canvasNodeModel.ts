// src/renderer/src/components/canvas/canvasNodeModel.ts
//
// **画布节点的纯函数与常量**（2026-10 从 CanvasNode.tsx 抽出，原来混在 1209 行里）：
// 尺寸常量、端口收纳计数、句柄像素定位、字段样式、状态点颜色/文案、节点类型标签。
//
// 这里**没有任何 React**（返回 JSX 的 getDataTypeBadge 留在组件文件里）—— 所以这些函数能被单测直接调，
// 也能被 postDominator 这类非组件模块复用。

import { t } from '../../i18n';
import type { FlowNodeData, Port } from '@shared/types/flow';

/** 模块级共享空集：避免 selector 每次返回新 Set 引用导致 zustand 无限重渲染 */
export const EMPTY_STRING_SET = new Set<string>();
/** 同理：问题列表的空数组也必须共享同一引用 */
export const EMPTY_STRING_ARRAY: string[] = [];

/** 画布节点类型标识（React Flow nodeTypes 注册用） */
export const CANVAS_NODE_TYPE = 'canvasNode';

/** 卡片尺寸常量（NODE_WIDTH 已统一到 canvasConstants，C1 修复） */
export const HEADER_H = 30;
export const FOOTER_H = 20;
// 内联字段行高：text-11px 输入框(py-0.5) + 行间距(space-y-1)，实测 ≈28px
export const INLINE_ROW_H = 28;
/**
 * 备注行高度（节点名下方那行「这个节点是干什么的」）。
 *
 * ⚠️ 它**必须进高度公式**（canvasNodeModel 的 NOTE_ROW_H → CanvasNode 的 nodeHeight）：
 * 否则备注行会顶出卡片，端口带跟着错位（tests/renderer/components/canvas/canvasNodeNote.test.tsx 钉住）。
 */
export const NOTE_ROW_H = 20;
export const PORT_SPACING = 20;
export const PORT_PAD = 12;
/**
 * 端口名标签的最大宽度（卡片内部）。
 *
 * 卡片宽 320px，两侧端口名各占一半再留点余量 —— 太长会互相压住，
 * 超出部分由 `truncate` 省略，完整名称在 hover tooltip 里。
 */
export const PORT_LABEL_MAX_W = 140;
// 错误条高度：text-xs + py-1 + border ≈ 24px
export const ERROR_H = 24;

/**
 * 解析 branch_switch 节点的 config.cases JSON，返回动态 case 控制出口端口列表。
 * 每个 case 的 label 对应一个控制出口端口（id=label），与 isControlEdge 逻辑一致。
 * 非 branch_switch 节点或 cases 缺失/格式错误时返回空数组（不抛错）。
 * reservedIds：与静态 control 端口 id 冲突的 label 会被排除（罕见配置错误，
 * 避免同一 Handle id 渲染两次导致连线行为未定义；运行时按 label 匹配的约定不可加前缀）。
 */
export function parseSwitchCases(
  nodeKind: string,
  config: unknown,
  reservedIds?: Set<string>,
): Port[] {
  if (nodeKind !== 'branch_switch') return [];
  try {
    const cfg = config as { cases?: unknown };
    const raw = cfg?.cases;
    if (typeof raw !== 'string') return [];
    const cases = JSON.parse(raw) as Array<{ match?: unknown; label?: string }>;
    return cases
      .filter(
        (c) => typeof c.label === 'string' && c.label.length > 0 && !reservedIds?.has(c.label),
      )
      .map((c) => ({ id: c.label!, name: c.label!, kind: 'control' as const }));
  } catch {
    return [];
  }
}

/**
 * 按 showWhen 过滤数据端口（折叠态行为；展开态返回全部）。
 * 与 DataBindingSelect 的过滤逻辑保持单一数据源（catalog 中 Port.showWhen）。
 */
export function filterDataOutputs(
  outputs: Port[],
  config: Record<string, unknown>,
  _expanded?: boolean,
): Port[] {
  // ⚠️ 2026-10-03：**展开态不再返回全部端口**。
  //
  // 原来展开态把全部数据端口挂出来 ✗ —— 于是像 `message_send`（30 个输入洞，按模式各自
  // 才相关）一展开就是 30 个洞，用户"根本不知道怎么拼"。而面板/数据绑定**都是按
  // showWhen 过滤的**（configFieldModel / DataBindingSelect）—— 只有画布展开态例外 ✗。
  //
  // 现在统一：**任何状态都按 showWhen 过滤**；`expanded` 只决定"是否截断"（见 visibleLeftPorts），
  // 不再决定"要不要过滤"。（保留参数是为了不改调用方签名，语义已变。）
  const dataOutputs = outputs.filter((p) => p.kind === 'data');
  return dataOutputs.filter((p) => (typeof p.showWhen === 'function' ? p.showWhen(config) : true));
}

/**
 * 计算折叠态溢出端口数（用于 "+N" 视觉提示）。
 * 展开态始终返回 0；折叠态返回该侧端口数超出 limit 的部分（不小于 0）。
 *
 * **左右两侧各调一次**：原来只算右侧，左侧被截断时没有任何提示 ——
 * channel_op 扩到 47 模式后左端口一次挂出十几个，折叠卡只显示前 4 个且不报数，
 * 看上去像是「这个节点压根没有这些输入」。
 */
export function computeHiddenPortCount(
  totalPorts: number,
  expanded: boolean,
  limit = 4,
): number {
  if (expanded) return 0;
  return Math.max(0, totalPorts - limit);
}

/**
 * 计算端口在卡片上的垂直像素位置。
 *
 * ## 为什么不是"均匀分摊"
 *
 * 原实现是 `availStart + (i+1)*availH/(total+1)`，把端口均匀摊到
 * `[HEADER_H, nodeHeight - FOOTER_H - errorH]` 这段高度里。但卡片高度是按
 * `PORT_SPACING * 端口数` 预留的，两套算法不一致 —— 实测 4 个端口时
 * availH = 96-30-20 = 46，间距只有 9.2px，而标签字号 11px（行高约 15px），
 * 于是端口名称互相压在一起（用户反馈："节点洞"糊成一团）。
 *
 * 现在改成**固定行距**：每个端口占 `PORT_SPACING` 一格，整组在可用带内居中。
 * 节点更高时整组下移居中，而不是把端口拉散。
 *
 * @param bandStart 端口带起点（Header 之下、内联字段之下）
 * @param bandEnd   端口带终点（Footer 与错误条之上）
 */
export function handleTopPx(
  index: number,
  total: number,
  bandStart: number,
  bandEnd: number,
): number {
  if (total <= 0) return bandStart;
  const bandH = Math.max(bandEnd - bandStart, 0);
  const needed = total * PORT_SPACING;
  // 只有带宽超出所需时才居中；不足时从带顶开始铺（宁可压住 footer 也不重叠标签）
  const offset = Math.max((bandH - needed) / 2, 0);
  return bandStart + offset + PORT_SPACING * index + PORT_SPACING / 2;
}

/** 单个 Handle 的样式生成：像素定位避开 Header/Footer。
 *  control 圆形可连，data 菱形不可连。
 *  isConnectingFrom=true 时（本端口是连线拖拽起点）放大 + 蓝色发光高亮。 */
export function handleStyle(
  kind: Port['kind'],
  index: number,
  total: number,
  side: 'left' | 'right',
  portBandStart: number,
  portBandEnd: number,
  isConnectingFrom: boolean = false,
  isCompatible: boolean = true, // 新增：目标端口兼容性状态
): React.CSSProperties {
  const topPx = handleTopPx(index, total, portBandStart, portBandEnd);
  const base: React.CSSProperties = {
    position: 'absolute',
    top: `${topPx}px`,
    // 起点端口高亮：放大 + 蓝色 + 发光，让用户清楚连线从哪开始
    width: isConnectingFrom ? '14px' : '10px',
    height: isConnectingFrom ? '14px' : '10px',
    background: isConnectingFrom
      ? '#3b82f6'
      : !isCompatible
        ? '#3f3f46' // 不兼容：暗灰
        : kind === 'control'
          ? '#71717a'
          : '#0ea5e9',
    border: isConnectingFrom
      ? '2px solid #93c5fd'
      : !isCompatible
        ? '1px solid #27272a'
        : kind === 'control'
          ? '1px solid #3f3f46'
          : '1px solid #38bdf8',
    boxShadow: isConnectingFrom
      ? '0 0 8px rgba(59, 130, 246, 0.7)'
      : !isCompatible
        ? 'none'
        : undefined,
    opacity: isCompatible ? 1 : 0.4, // 不兼容：半透明置灰
    cursor: isCompatible ? 'crosshair' : 'not-allowed',
    transition: 'all 0.15s ease',
  };
  if (kind === 'control') {
    base.borderRadius = '50%';
    base.transform = 'translateY(-50%)';
  } else {
    // 菱形：CSS rotate 45deg 实现菱形外观
    base.borderRadius = '0';
    base.transform = 'translateY(-50%) rotate(45deg)';
  }
  // 偏移让 Handle 中心对齐卡片边界：10px 时 -5px，14px（起点高亮）时 -7px
  base[side] = isConnectingFrom ? '-7px' : '-5px';
  return base;
}

/** 获取 dataType 对应的图标和颜色。label 经 i18n(type.*) 取当前语言。
 *  dataType 支持 json / event 这些 iconMap 里没有的类型，故这里保留独立的多一层映射，
 *  type.* 里补了 json / event。 */
export const DATA_TYPE_BADGE_KEY: Record<string, string> = {
  string: 'type.string',
  number: 'type.number',
  boolean: 'type.boolean',
  object: 'type.object',
  list: 'type.list',
  json: 'type.json',
  datetime: 'type.datetime',
  event: 'type.event',
};

/** 执行状态点颜色 */
export function statusDotColor(status: 'idle' | 'running' | 'done' | 'error'): string {
  switch (status) {
    case 'running':
      return 'bg-amber-400 animate-pulse';
    case 'done':
      return 'bg-emerald-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-zinc-600';
  }
}

/** 执行状态中文标签（状态点 tooltip） */
export function statusLabel(status: 'idle' | 'running' | 'done' | 'error'): string {
  switch (status) {
    case 'running':
      return t('canvas.exec.running');
    case 'done':
      return t('canvas.exec.done');
    case 'error':
      return t('settings.diagnosticsDialog.phaseError');
    default:
      return t('ai.status.idle');
  }
}

/** 节点类型标签：Header 中显示的小标签，让用户一眼识别节点类别 */
export const NODE_TYPE_LABEL: Record<string, { text: string; cls: string }> = {
  trigger: {
    get text() {
      return t('palette.typeTrigger');
    },
    cls: 'bg-blue-500/20 text-blue-300',
  },
  action: {
    get text() {
      return t('palette.typeAction');
    },
    cls: 'bg-emerald-500/20 text-emerald-300',
  },
  logic: {
    get text() {
      return t('palette.typeLogic');
    },
    cls: 'bg-amber-500/20 text-amber-300',
  },
  data: {
    get text() {
      return t('canvas.portData');
    },
    cls: 'bg-purple-500/20 text-purple-300',
  },
  ai: { text: 'AI', cls: 'bg-pink-500/20 text-pink-300' },
  custom: {
    get text() {
      return t('palette.typeCustom');
    },
    cls: 'bg-zinc-500/20 text-zinc-300',
  },
};

export interface CanvasNodeData extends FlowNodeData {
  /** 阶段 2 由 BlockEditor 注入的执行态标记（仅用于触发动画，不写入 flow.json） */
  _executing?: boolean;
}
