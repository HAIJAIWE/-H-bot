// src/renderer/src/lib/autoLayout.ts
// 画布式重构 - 阶段 1：ELK 自动布局封装 + 节点高度估算 + 布局检测
// 关联设计文档：docs/architecture/canvas-refactor-design.md 第 5.4 节
//
// 阶段 4：子流程分区布局（设计文档 5.7.1）
// - 主流程区：真实触发器 + 普通节点 + subflow_call（独立 ELK 布局，锚点 0,0）
// - 子流程定义区：每个 subflow_defined + 其内部控制流可达节点，独立 ELK 布局成紧凑小块，
//   纵向堆叠在主流程区下方（块间留出标题/间距）

import type { FlowNode, FlowEdge, NodeGroup } from '@shared/types/flow';
import { isControlEdge, getControlOutputs } from './executionOrder';
import loadElk from './elkLoader';
// C1 修复：尺寸常量统一来源 canvasConstants，避免与 CanvasNode 不一致
import { NODE_WIDTH, NODE_HEIGHT_COLLAPSED } from './canvasConstants';
// 向后兼容 re-export：NodeGroupLayer / SystemRegionLayer 仍从此处 import
export { NODE_WIDTH, NODE_HEIGHT_COLLAPSED };
// 旧别名（向后兼容，外部可能引用 COLLAPSED_NODE_HEIGHT）
export const COLLAPSED_NODE_HEIGHT = NODE_HEIGHT_COLLAPSED;

/** 子流程块之间的纵向间距 —— 统一列表式布局后不再需要单独的子流程分区
 *  （`subflow_defined` 天然是一条独立链，见 `deriveChains`），故已移除。 */

// ---------------------------------------------------------------------------
// 分组「列表式」布局
// ---------------------------------------------------------------------------
//
// 为什么 ELK 不够：ELK layered + direction=RIGHT 确实是横向的，但**同一层的节点间距
// 由算法决定、不受控** —— 一条 37 节点的链实测拉成 **13890 × 3843**
// （`scripts/e2e/bench-elk-layout.mjs` 可复现），完全没法看。
//
// 所以：**图里有 nodeGroups 时**，不喂 ELK，改用下面的列表式布局 ——
// **一条指令（一个分组）一行、链横向一直往右（不折行）**、块与块纵向堆叠。
// 与 `scripts/e2e/apply-list-layout.mjs` 同一套算法与常量，
// 保证「应用里的布局按钮」和「脚本排的版」结果一致。
//
// 没有分组时保持原样走 ELK（普通用户的小图仍然是 ELK 的最优布局）。
//
// 🔴 **2026-09 拿掉了折行**（原 `LIST_WRAP_AT = 12`）：折行省了宽度，
// 但**跨子行的边**变成横穿画布的长对角线，读图反而更糟。详见 `layoutBlocksAsList`。

/** 行内节点横向间距（**导出**：`tests/renderer/lib/autoLayoutList.test.ts` 用它核对
 *  `scripts/e2e/apply-list-layout.mjs` 里的同名常量，防止两边悄悄漂移） */
export const LIST_COL_GAP = 70;
/**
 * 块与块之间的纵向留白。
 *
 * 原值 = `LIST_ROW_GAP(30) + LIST_BLOCK_GAP(110)` —— 不再折行后"子行间距"没有意义了，
 * 合成一个常量，**间距值与改动前完全一致**（140）。
 *
 * **导出**同上：脚本里有同名常量，测试核对两者一致。
 */
export const LIST_BLOCK_GAP = 140;

/** 组内按控制流顺序排序：从组内第一个节点出发 BFS，只走**组内**的控制流边。
 *  组内没被走到的节点按原顺序追加到末尾（避免漏排）。 */
function orderWithinGroup(ids: string[], nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (!isControlEdge(e, nodes)) continue;
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }
  const start = ids[0];
  const seen = new Set([start]);
  const queue = [start];
  const out = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const t of adj.get(cur) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      queue.push(t);
    }
  }
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

/** 布局的最小单位：一个块 = 一行（超长时折成多子行）。 */
export interface LayoutBlock {
  title: string;
  nodeIds: string[];
}

/** 没有分组时，从图结构自己切块：**每个触发器一条链**。
 *
 *  规则：
 *  - 根 = 没有**控制流**入边的节点（触发器 / 子流程定义 / 孤立节点），按图里的出现顺序
 *  - 从每个根出发沿控制流出边 BFS，路上遇到的节点都归这个根；已被前面的根认领的不再抢
 *  - 一条边都没连上的（环形互指等）兜底成最后一块「未连接」
 *
 *  这样 `subflow_defined` 天然自成一棵（它没有控制入边），其内部节点也跟着它，
 *  不需要再为子流程写特例。 */
export function deriveChains(nodes: FlowNode[], edges: FlowEdge[]): LayoutBlock[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!isControlEdge(e, nodes)) continue;
    hasIncoming.add(e.target);
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }

  const claimed = new Set<string>();
  const blocks: LayoutBlock[] = [];
  for (const root of nodes) {
    if (hasIncoming.has(root.id) || claimed.has(root.id)) continue;
    const nodeIds: string[] = [];
    const queue = [root.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (claimed.has(cur)) continue;
      claimed.add(cur);
      nodeIds.push(cur);
      for (const t of adj.get(cur) ?? []) if (!claimed.has(t)) queue.push(t);
    }
    const rawLabel = root.data.config?.label;
    blocks.push({
      title: typeof rawLabel === 'string' && rawLabel ? rawLabel : root.id,
      nodeIds,
    });
  }

  const rest = nodes.filter((n) => !claimed.has(n.id)).map((n) => n.id);
  // 标题只用于调试与测试断言，不渲染到界面上，所以用 ASCII 而不是中文文案
  // （渲染层的硬编码中文闸门 noHardcodedCopy 会拦下中文字面量）
  if (rest.length > 0) blocks.push({ title: '(unconnected)', nodeIds: rest });
  return blocks;
}

/** 决定用哪些块：有分组用分组（长的在上，读起来像目录），没有就从图结构推导。 */
function resolveBlocks(nodes: FlowNode[], edges: FlowEdge[], groups?: NodeGroup[]): LayoutBlock[] {
  if (groups && groups.length > 0) {
    const byId = new Set(nodes.map((n) => n.id));
    return groups
      .map((g) => ({ title: g.title, nodeIds: g.nodeIds.filter((id) => byId.has(id)) }))
      .filter((b) => b.nodeIds.length > 0)
      .sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  }
  return deriveChains(nodes, edges);
}

/**
 * 列表式布局：**一个块一行，链横向一直往右，不折行**，块纵向堆叠。
 *
 * ## ⚠️ 这里曾经是折行的（`LIST_WRAP_AT = 12`），2026-09 拿掉了 —— 原因很重要
 *
 * 当初加折行的理由是**宽度**：不折的话一条 44 节点的链约 1.2 万像素宽，
 * 得一路往右滚。这个理由本身没错。
 *
 * 但**代价在边（连线）上，而边才是流程图的内容**：
 * 折行后第 12 个节点 → 第 13 个节点的边，要从**第一行最右**拉回**第二行最左**，
 * 变成一条**横穿整个画布的长对角线**；一条 44 节点的链就有 **3 条**这种边，
 * 而且它们会穿过其它所有子行的内容。
 *
 * 结论（产品判断，2026-09）：**宽度可以滚，边乱了没救。**
 * 所以改成一条链一行到底 —— 每条边都退化成短的水平跳。
 *
 * 🔴 **不要"顺手修回去"**：折行看起来省空间，但它把可读性换掉了。
 * 真要再折，先解决"跨子行的边怎么走"这个问题。
 *
 * 返回 Map<nodeId, {x,y}>；不属于任何块的节点排在最下面一行。
 */
export function layoutBlocksAsList(
  nodes: FlowNode[],
  edges: FlowEdge[],
  blocks: LayoutBlock[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const ordered = blocks.filter((b) => b.nodeIds.length > 0);

  let y = 0;
  for (const block of ordered) {
    const seq = orderWithinGroup(block.nodeIds, nodes, edges);
    // 一条链一行到底：**不折行**（见上方说明）
    seq.forEach((id, i) => {
      positions.set(id, { x: i * (NODE_WIDTH + LIST_COL_GAP), y });
    });
    y += NODE_HEIGHT_COLLAPSED + LIST_BLOCK_GAP;
  }

  // 不属于任何块的节点（正常为 0）接在最下面，排成一行
  const assigned = new Set(ordered.flatMap((b) => b.nodeIds));
  const orphans = nodes.filter((n) => !assigned.has(n.id));
  orphans.forEach((n, i) => {
    positions.set(n.id, { x: i * (NODE_WIDTH + LIST_COL_GAP), y });
  });

  return positions;
}

/** ELK layered 布局配置：从左到右排列，符合「触发器在左，后续在右」的阅读习惯。
 *  详见设计文档 5.4.2。 */
const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.layered.spacing.edgeNodeBetweenLayers': '30',
  'elk.spacing.nodeNode': '40',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
};

/** 估算节点高度。C1 修复后用真实扣子式卡片尺寸估算（HEADER 30 + Inline 48 + Footer 20 ≈ 98）。
 *  端口数多的节点（如 branch_switch 多 case）按端口数加高，避免 ELK 把它们排得太挤。
 *  真实渲染高度由 CanvasNode 按端口数+内联字段数自适应，这里只是给 ELK 一个合理估算。 */
export function estimateNodeHeight(node: FlowNode): number {
  // 与 CanvasNode 高度公式对齐：max(contentH, portH, 64)
  const HEADER_H = 30,
    FOOTER_H = 20,
    INLINE_ROW_H = 24,
    PORT_SPACING = 18,
    PORT_PAD = 12;
  const inputs = node.data.inputs ?? [];
  const outputs = node.data.outputs ?? [];
  const maxPorts = Math.max(inputs.length, outputs.length);
  const portH = maxPorts > 0 ? PORT_PAD * 2 + maxPorts * PORT_SPACING : 0;
  // 估算 inline 字段数：多数节点 1-2 个，统一按 2 估算（高估一点比低估好）
  const inlineH = 2 * INLINE_ROW_H;
  const contentH = HEADER_H + inlineH + FOOTER_H;
  return Math.max(contentH, portH, NODE_HEIGHT_COLLAPSED);
}

/**
 * 一组节点在画布上的**真实包围盒**（含每个节点的实际宽高）。
 *
 * ## ⚠️ 为什么必须用它，而不是自己取 `position.y` 的最大值
 *
 * `position.y` 是节点的**顶部**，不是底部。而三个背景图层
 * （节点分组 / 系统分区 / 分支区域）过去都这么写高度：
 *
 * ```ts
 * height = (maxY - minY + COLLAPSED_NODE_HEIGHT + PADDING_Y * 2) * zoom
 * ```
 *
 * `COLLAPSED_NODE_HEIGHT = 80` 是**折叠态**高度，而真实节点约 **98**
 * （见 `estimateNodeHeight`：HEADER 30 + inline 2×24 + FOOTER 20）。
 *
 * **矮 18px 的后果**：节点从框底下伸出来 —— 真机截图里 `/打怪 (44)` 的分组框
 * 正好切在 `收到消息` 节点中间（那条"没对上的虚线"就是这个）。
 *
 * 所以这里直接返回**已经含节点高度**的边界，调用方不必再拼高度。
 *
 * @returns 空数组时返回 `null`（调用方直接跳过）
 */
export function boundsOfNodes(
  nodes: readonly FlowNode[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    const right = n.position.x + NODE_WIDTH;
    const bottom = n.position.y + estimateNodeHeight(n);
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { minX, minY, maxX, maxY };
}

/** 检测是否需要自动布局。
 *  - 空数组 → false（无需布局）
 *  - 所有节点 position 全 {0,0} → true（从未布局过，需要跑 ELK）
 *  - 混合状态（部分有坐标）→ false（用户已布局过，不覆盖）
 *  详见设计文档 5.4.1。 */
export function needsLayout(nodes: FlowNode[]): boolean {
  if (nodes.length === 0) return false;
  return nodes.every((n) => n.position.x === 0 && n.position.y === 0);
}

/** 构造 ELK 输入图：只把控制流边喂给 ELK（数据流边不参与布局拓扑，避免干扰节点排列）。 */
function buildElkGraph(nodes: FlowNode[], edges: FlowEdge[]) {
  return {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: nodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: estimateNodeHeight(n),
    })),
    edges: edges
      .filter((e) => isControlEdge(e, nodes))
      .map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
  };
}

/** 收集子流程内部节点：从 subflow_defined 的控制出口出发，沿控制流边 BFS。
 *  - 遇到其他 subflow_defined 节点停止（子流程之间不嵌套遍历）
 *  - 返回内部节点 ID 列表（不含 define 自身） */
export function collectSubflowMembers(
  defineId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): string[] {
  const members: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];
  const define = nodes.find((n) => n.id === defineId);
  if (!define) return members;
  for (const port of getControlOutputs(define)) {
    for (const e of edges) {
      if (e.source === defineId && e.sourcePort === port.portId && !visited.has(e.target)) {
        visited.add(e.target);
        queue.push(e.target);
      }
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodes.find((n) => n.id === current);
    if (!node) continue;
    if (node.data.nodeKind === 'subflow_defined') continue;
    members.push(current);
    for (const e of edges) {
      if (e.source === current && isControlEdge(e, nodes) && !visited.has(e.target)) {
        visited.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return members;
}

/** 全图自动布局：**统一的列表式布局**。
 *
 *  - 有 `nodeGroups` → 一个分组一行
 *  - 没有分组 → 从图结构推导，**每个触发器一条链**（见 `deriveChains`）
 *
 *  两条路都走 `layoutBlocksAsList`：链横向一直往右（**不折行**）、块纵向堆叠。
 *  返回 Map<nodeId, {x,y}>，调用方据此 updateNodePosition。
 *
 *  为什么这一版**不再用 ELK**：ELK 的 layered + direction=RIGHT 确实横向，
 *  但节点间距由算法决定、不受控 —— 一条 37 节点的链实测 13890 × 3843
 *  （`scripts/e2e/bench-elk-layout.mjs` 可复现），完全没法看。
 *  ELK 仍用于 `layoutSubgraph`（对选中子图做紧凑排布），那里不存在超长链问题。
 *
 *  ⚠️ **不再折行**（2026-09）：折行省宽度，但跨子行的边会变成横穿画布的长对角线。
 *  详见 `layoutBlocksAsList` 的说明。
 */
export async function layoutFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  groups?: NodeGroup[],
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();
  const blocks = resolveBlocks(nodes, edges, groups);
  if (blocks.length === 0) return new Map();
  return layoutBlocksAsList(nodes, edges, blocks);
}

/** 阶段 7 Part C：对传入的子图节点跑 ELK 布局。
 *  - 只考虑子图内部的边（source 和 target 都在 subNodes 中）
 *  - anchorPosition 指定子图左上角锚点坐标（默认 {0,0}），最终坐标会加上 anchor 偏移
 *  - 控制流边参与布局拓扑，数据流边不参与（与 layoutFlow 一致）
 *  详见设计文档 5.4.3。 */
export async function layoutSubgraph(
  subNodes: FlowNode[],
  allEdges: FlowEdge[],
  anchorPosition: { x: number; y: number } = { x: 0, y: 0 },
): Promise<Map<string, { x: number; y: number }>> {
  if (subNodes.length === 0) return new Map();

  const ELK = await loadElk();
  const elk = new ELK();

  const subNodeIds = new Set(subNodes.map((n) => n.id));
  // 只考虑子图内部边（source 和 target 都在子图中）
  const subEdges = allEdges.filter((e) => subNodeIds.has(e.source) && subNodeIds.has(e.target));

  const result = await elk.layout(buildElkGraph(subNodes, subEdges));
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) {
    positions.set(child.id, {
      x: (child.x ?? 0) + anchorPosition.x,
      y: (child.y ?? 0) + anchorPosition.y,
    });
  }
  return positions;
}
