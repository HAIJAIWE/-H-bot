// src/renderer/src/components/canvas/NodeGroupLayer.tsx
//
// 阶段 6：节点分组背景层。
// 在画布上为每个 NodeGroup 画可交互的虚线框——标题栏可点击折叠/展开，
// 背景框不阻挡画布拖拽（pointer-events 分层控制）。
//
// 设计要点（复刻 SystemRegionLayer 模式 + 可交互扩展）：
// - useViewport() 拿 vpX/vpY/zoom，画布坐标→屏幕坐标：screen = canvas * zoom + viewport
// - 展开态：完整虚线框 + 标题栏（pointer-events: auto）+ chevron 折叠按钮
// - 折叠态：小标签（pointer-events: auto）+ chevron 展开按钮
// - 背景框 pointer-events: none（点击穿透到画布，不阻挡拖拽）
// - 折叠时组内节点由 BlockEditor 的 reactFlowNodes useMemo 过滤隐藏
// - 渲染顺序在 BranchRegionLayer 之后：用户自定义分组在最上层
//
// 视觉：中性色（zinc-500/50 border + zinc-600/5 bg），与 SystemRegionLayer 一致。
// 分组是用户自定义的组织单元，视觉层级低于系统分区/分支区域。

import { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import { boundsOfNodes } from '../../lib/canvas/autoLayout';
import type { FlowNode, NodeGroup } from '@shared/types/flow';
import { groupSummaries } from '../../lib/canvas/autoGroup';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface GroupRegion {
  id: string;
  title: string;
  collapsed: boolean;
  nodeCount: number;
  /** 展开态：组内节点的包围盒 min/max；折叠态：用第一个节点位置作为小标签锚点 */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 标签底边离组内最上面那个节点的**上边缘**多少像素（屏幕坐标，不随 zoom 缩放）。
 *
 * **不乘 zoom**：标签是固定的界面元素（跟折叠卡片一样），放大缩小都该保持可读。
 * 取 4 是因为标签自带 `rounded` 边框，贴太紧会看着像节点的一部分。
 */
const LABEL_GAP = 4;

/**
 * 折叠卡片的**缩放下限**。
 *
 * 折叠卡片的用处是"缩小看全局时还能认出每条指令"。所以它不能：
 *
 * - **完全不缩放** → 真机反馈「缩放的时候…他太大了」，缩小看全局时又大又吵
 * - **完全跟着缩放** → 缩到 30% 就只剩几个像素，**反而看不见了**，失去总览的意义
 *
 * 折中：跟着缩放，但**不小于 0.6 倍**。
 */
const MIN_CARD_SCALE = 0.6;

/**
 * 计算每个 NodeGroup 的区域信息。
 * 折叠态：minX/minY 取组内第一个存在节点的坐标（作为小标签锚点）。
 * 展开态：计算组内所有存在节点的包围盒。
 * 组内节点全部不存在时跳过（返回空）。
 */
export function computeGroupRegions(nodes: FlowNode[], groups: NodeGroup[]): GroupRegion[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const regions: GroupRegion[] = [];

  for (const g of groups) {
    const groupNodes = g.nodeIds
      .map((id) => nodeMap.get(id))
      .filter((n): n is FlowNode => n !== undefined);

    if (groupNodes.length === 0) continue;

    if (g.collapsed) {
      // 折叠态：用第一个节点坐标作为小标签锚点
      const first = groupNodes[0];
      regions.push({
        id: g.id,
        title: g.title,
        collapsed: true,
        nodeCount: g.nodeIds.length,
        minX: first.position.x,
        minY: first.position.y,
        maxX: first.position.x,
        maxY: first.position.y,
      });
    } else {
      // 展开态：包围盒**含每个节点的真实高度**（boundsOfNodes 的说明解释了为什么）
      const box = boundsOfNodes(groupNodes);
      if (!box) continue;
      regions.push({
        id: g.id,
        title: g.title,
        collapsed: false,
        nodeCount: g.nodeIds.length,
        ...box,
      });
    }
  }

  return regions;
}

export function NodeGroupLayer() {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const nodeGroups = useFlowStore((s) => s.nodeGroups);
  const toggleNodeGroupCollapse = useFlowStore((s) => s.toggleNodeGroupCollapse);
  const setMultiSelect = useFlowStore((s) => s.setMultiSelect);
  const { x: vpX, y: vpY, zoom } = useViewport();

  const regions = useMemo(() => computeGroupRegions(nodes, nodeGroups), [nodes, nodeGroups]);

  /**
   * 折叠条上的一行摘要（`/签到 → ✅ 签到成功！当前积分 3`）。
   *
   * **只算折叠态的组**（展开的组看得到内容，不需要摘要），且走批量版
   * —— 每个组各算一次会把整图走 N 遍，而画布平移/缩放都会重渲。
   */
  const summaries = useMemo(() => {
    const collapsed = nodeGroups.filter((g) => g.collapsed);
    return groupSummaries(nodes, edges, collapsed);
  }, [nodes, edges, nodeGroups]);

  if (regions.length === 0) return null;

  /** 点击标题栏：选中分组内所有节点（整体设置，避免已全选时逐个 toggle 反选） */
  const handleTitleClick = (group: NodeGroup) => {
    setMultiSelect(group.nodeIds);
  };

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {regions.map((r) => {
        const group = nodeGroups.find((g) => g.id === r.id);
        if (!group) return null;

        if (r.collapsed) {
          // 折叠态：小卡片（可点击展开）
          const left = r.minX * zoom + vpX;
          const top = r.minY * zoom + vpY;
          // 摘要拿不到就只有标题 —— **不编内容**（见 groupSummaries 的说明）
          const summary = summaries.get(r.id);
          // **跟着缩放，但设下限**：完全跟着缩放（缩太小就看不见了，失去"总览"的意义），
          // 完全不缩放（缩小看全局时又显得又大又吵）。取 0.6 下限折中。
          const cardScale = Math.max(zoom, MIN_CARD_SCALE);
          return (
            <div
              key={r.id}
              data-testid={`node-group-card-${r.id}`}
              className="absolute flex items-center gap-1 px-1.5 py-0.5 bg-zinc-800/95 border border-zinc-600 rounded text-xs text-zinc-300 pointer-events-auto cursor-pointer hover:border-zinc-400 whitespace-nowrap"
              // 锚点用**左上角**：卡片标记的就是节点原来的位置，缩放不该让它挪窝
              style={{
                left,
                top,
                height: '24px',
                transform: `scale(${cardScale})`,
                transformOrigin: '0 0',
              }}
              onClick={() => toggleNodeGroupCollapse(r.id)}
              title={
                summary
                  ? t('canvas.group.expandWithSummaryAria', {
                      name: r.title,
                      summary,
                      count: r.nodeCount,
                    })
                  : t('canvas.group.expandAria', { name: r.title, count: r.nodeCount })
              }
            >
              <ChevronRight className="w-3 h-3 text-zinc-500" />
              <span className="truncate max-w-[120px]">{r.title}</span>
              {summary && <span className="truncate max-w-[220px] text-zinc-500">{summary}</span>}
              <span className="text-zinc-500">({r.nodeCount})</span>
            </div>
          );
        }

        // 展开态：**只留标签栏，不画虚线矩形**（2026-09 产品决定）
        //
        // ## 为什么去掉矩形
        //
        // 那个矩形**没有任何交互**（`pointer-events` 继承父层的 none），
        // 它唯一的"作用"是把组内节点框起来。而列表式布局是**一条链一行**，
        // 行的左右边界本来就说明了范围 —— 矩形纯属视觉噪音。
        //
        // 用户原话：「这虚线…我觉得没啥用，纯影响视觉效果」。
        //
        // ⚠️ **功能不在矩形里**：折叠 / 全选都在下面那个标签栏上，
        // 所以去掉矩形**零功能损失**。
        //
        // ⚠️ 标签的落点**直接贴着组内最上/最左那个节点的角**（`r.minX/minY` 就是它），
        // **不再叠加 PADDING_X/PADDING_Y** —— 那是给矩形留的边距。
        // 实测反馈：「他不在节点界面左上角，间隔太大了」：过去 = 24*zoom(边距) + 20px(-top-5)
        // ≈ 33~44px 的空档，框一去掉就显得浮在半空。
        //
        // ⚠️⚠️ **标签不许再包一层 `absolute` 空壳**（踩过）：
        // 空壳只设 left/top、**唯一子元素又是 absolute**（脱离文档流）→
        // 空壳的 shrink-to-fit 宽度算出来是 **0** → 标签可用宽度 0 →
        // **中文逐字换行**，`/打怪 (44)` 被压成一列字。
        // 现在标签直接挂在这一层上（包含块 = 整块画布），并加 `whitespace-nowrap` 兜底。
        const labelLeft = r.minX * zoom + vpX;
        const labelTop = r.minY * zoom + vpY - LABEL_GAP;

        return (
          <div
            key={r.id}
            data-testid={`node-group-label-${r.id}`}
            className="absolute flex items-center gap-1 bg-zinc-800/95 border border-zinc-600 rounded px-1.5 py-0.5 pointer-events-auto cursor-pointer hover:border-zinc-400 group whitespace-nowrap"
            // **跟着画布一起缩放**（`scale(zoom)`）：
            // 真机反馈「缩放的时候…他太大了」—— 之前它是固定屏幕尺寸，
            // 缩小画布看全局时节点变小、标签不变，就显得又大又吵。
            //
            // 锚点必须是**左下角**（`0 100%`）：这样
            // ① `translateY(-100%)` 把底边放到 `labelTop`
            // ② `scale(zoom)` 绕这个点缩放 → 标签始终咬在节点左上角，不会飘走
            style={{
              left: labelLeft,
              top: labelTop,
              transform: `translateY(-100%) scale(${zoom})`,
              transformOrigin: '0 100%',
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggleNodeGroupCollapse(r.id);
            }}
            title={t('canvas.group.collapseTitle')}
          >
            <ChevronDown className="w-3 h-3 text-zinc-500 group-hover:text-zinc-300" />
            <span
              className="text-xs text-zinc-300 select-none"
              onClick={(e) => {
                e.stopPropagation();
                handleTitleClick(group);
              }}
              title={t('canvas.group.selectAllTitle')}
            >
              {r.title} ({r.nodeCount})
            </span>
          </div>
        );
      })}
    </div>
  );
}
