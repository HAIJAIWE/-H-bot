// src/renderer/src/lib/canvas/autoGroup.ts
//
// **按指令自动分组**（D5 第 3 步「指令卡」的纯逻辑部分）。
//
// ## 解决什么
//
// 用户那张图 **77 个节点平铺**，一屏根本看不完 —— 20 条指令混在一起，
// 想改 `/签到` 得先在画布上找半天。分组不是新概念（`NodeGroup` 早就有、
// `NodeGroupLayer` 也有 24px 折叠条），缺的是**"按触发器自动成组 + 默认折叠"**。
//
// ## 为什么是纯函数
//
// 分组是**不可撤销**的（`nodeGroups` 不在撤销栈里 —— 见 `flowStore` 的
// `pushHistory(nodes, edges)`，它只快照节点与边）。既然改坏了没法 Ctrl+Z，
// 那就必须**先把计划算出来给人看**：确认弹窗显示"将创建 N 个分组"，
// 用户点了才落地。这与「折叠模板」的 `planFlattenTemplates` 是同一套纪律。
//
// ## 复用而不是重写
//
// 走链（`getExecutionChains`）、读命令词（`readTriggerCommand`）、
// 读回复摘要（`readReply`）**都已经有了** —— 这里只在它们之上做"分组规划"，
// 绝不自己再写一遍 BFS（那种重复迟早两边走法不一致）。

import type { FlowEdge, FlowNode, NodeGroup } from '@shared/types/flow';
import { getExecutionChains } from './executionOrder';
import { buildCommandRows, triggerDisplayName } from '../command/commandList';
// ⚠️ 跳过原因**是给用户看的界面文案**，必须走 i18n。
// 与 `flattenTemplate.ts` 同一个做法（那边的跳过原因也都走 i18n）——
// 硬编码中文会被 `tests/renderer/i18n/noHardcodedCopy.test.ts` 拦下，那是对的。
//
// 附注：i18n 完整性测试会扫**源码里所有** `t(...)` 字面量，**包括注释** ——
// 在注释里举一个不存在的 key 当例子，会把那条测试弄红（我踩过）。
import { t } from '../../i18n';

/** 一个待创建的分组 */
export interface AutoGroupItem {
  /** 组标题：指令用 `/命令词`，其他触发用节点名 */
  title: string;
  /** 组内节点 id（按执行顺序） */
  nodeIds: string[];
  /** 默认折叠 —— 这才是"一屏看完"的关键 */
  collapsed: boolean;
}

/** 被跳过的链，**必须带原因**（用户才知道为什么少了几条） */
export interface AutoGroupSkip {
  triggerId: string;
  name: string;
  reason: string;
}

export interface AutoGroupPlan {
  groups: AutoGroupItem[];
  skipped: AutoGroupSkip[];
}

/**
 * 规划"按指令自动分组"。
 *
 * ## 跳过规则（每一条都是为了**不做坏事**）
 *
 * | 情况 | 为什么跳过 |
 * | --- | --- |
 * | 链上只有触发器自己 | 一个孤零零的触发器包成组没有意义，反而多一个框 |
 * | 链里有节点**已在别的组** | 分组**不允许重叠**（重叠时折叠条会互相盖住、双击展开语义也乱） |
 * | 已存在**完全相同的分组** | 重复点一次不该又叠一层 |
 *
 * ⚠️ **只跳过，不合并、不挪动**：用户的既有分组是他自己摆的，自动功能不该替他重排。
 *
 * @param existingGroups 现有分组（用来判重叠与重复）
 */
export function planAutoGroups(
  nodes: FlowNode[],
  edges: FlowEdge[],
  existingGroups: NodeGroup[] = [],
): AutoGroupPlan {
  /** 节点 → 它所属分组的标题 */
  const groupOfNode = new Map<string, string>();
  for (const g of existingGroups) {
    for (const id of g.nodeIds) groupOfNode.set(id, g.title);
  }

  const groups: AutoGroupItem[] = [];
  const skipped: AutoGroupSkip[] = [];
  /** 已经规划进本次分组的节点（防止两条链共享下游时重叠） */
  const claimed = new Set<string>();

  for (const chain of getExecutionChains(nodes, edges)) {
    const title = triggerDisplayName(chain.trigger);
    const nodeIds = chain.sequence.map((n) => n.id);

    if (nodeIds.length <= 1) {
      skipped.push({
        triggerId: chain.trigger.id,
        name: title,
        reason: t('autoGroup.onlyTrigger'),
      });
      continue;
    }

    // ⚠️ **"已存在完全相同的分组"必须排在"重叠"之前** ——
    // 完全相同也是重叠的一种，先判重叠就会给出更含糊的原因
    // （"已在分组「X」里"而不是"已有相同分组「X」"）。
    // 跳过原因越具体，用户越知道该怎么办。
    const sameSet = existingGroups.find(
      (g) => g.nodeIds.length === nodeIds.length && nodeIds.every((id) => g.nodeIds.includes(id)),
    );
    if (sameSet) {
      skipped.push({
        triggerId: chain.trigger.id,
        name: title,
        reason: t('autoGroup.duplicate', { title: sameSet.title }),
      });
      continue;
    }

    // 与**已有分组**重叠
    const inExisting = nodeIds.find((id) => groupOfNode.has(id));
    if (inExisting) {
      skipped.push({
        triggerId: chain.trigger.id,
        name: title,
        reason: t('autoGroup.overlapExisting', { group: groupOfNode.get(inExisting) ?? '' }),
      });
      continue;
    }

    // 与**本次已规划**的分组重叠（两条链共用下游节点）
    if (nodeIds.some((id) => claimed.has(id))) {
      skipped.push({
        triggerId: chain.trigger.id,
        name: title,
        reason: t('autoGroup.overlapPlanned'),
      });
      continue;
    }

    for (const id of nodeIds) claimed.add(id);
    groups.push({
      title,
      nodeIds,
      // **默认折叠**：一屏看完的关键。想展开双击折叠条即可。
      collapsed: true,
    });
  }

  return { groups, skipped };
}

/** 折叠条上那张卡片的文字上限（再长就截断 —— 它只有 24px 高、约 80px 宽） */
export const GROUP_SUMMARY_MAX = 28;

/**
 * 这一段文本**除了占位符之外什么都没有**吗？
 *
 * ### 为什么需要这个判断（来自真机截图）
 *
 * 用户那张图里有 4 条指令（`/装备` `/使用` `/技能` `/卸下`）的回复就是**光秃秃的
 * `{var1}`** —— 那是运行期由上游节点填的模板。折叠卡上显示 `/装备 → {var1}`
 * **等于没有摘要**，还白占宽度。
 *
 * 所以：**只剩占位符 → 当作没有摘要**（卡片只显示标题 + 节点数，更干净）。
 *
 * ⚠️ 只判"**只剩**占位符"：`本群号: {var1}` 这种**有真实文字**的照常显示
 * （真机图里的 `/群号` 就是这一种）。
 */
export function isOnlyPlaceholders(text: string): boolean {
  // 先把 `{var1}`~`{varN}` 与 `{variables_json}` 这类占位符全部去掉
  const stripped = text
    .replace(/\{var\d+\}/gi, '')
    .replace(/\{[a-z_][a-z0-9_]*\}/gi, '')
    .replace(/[\s·—\-–:：,，.。!！?？]+/g, '');
  return stripped.length === 0;
}

/**
 * **批量**算摘要：`分组 id → 摘要文本`。
 *
 * ## 为什么要有批量版
 *
 * `buildCommandRows` 会把整张图走一遍。折叠条每渲染一个分组就调一次的话，
 * 20 个分组 = **20 次整图遍历** —— 而画布是每次平移/缩放都重渲的。
 * 批量版只走一次，然后按触发器 id 查表。
 */
export function groupSummaries(
  nodes: FlowNode[],
  edges: FlowEdge[],
  groups: readonly NodeGroup[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (groups.length === 0) return out;

  const rows = buildCommandRows(nodes, edges);

  for (const g of groups) {
    const idSet = new Set(g.nodeIds);
    // 找到属于这个分组的那一行（分组的第一个触发器）
    const row = rows.find((r) => idSet.has(r.triggerId));
    if (!row || !row.reply) continue;
    const flat = row.reply.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    // 只剩占位符（`{var1}` 这种）→ 当没有摘要，别在卡片上占宽度（见 isOnlyPlaceholders）
    if (isOnlyPlaceholders(flat)) continue;
    const clipped = flat.length > GROUP_SUMMARY_MAX ? `${flat.slice(0, GROUP_SUMMARY_MAX)}…` : flat;
    out.set(g.id, `${row.triggerText} → ${clipped}`);
  }

  return out;
}

/**
 * 折叠条上显示的**一行摘要**：`/签到 → ✅ 签到成功！当前积分 3`。
 *
 * ## 为什么走 `buildCommandRows` 而不是自己读节点
 *
 * 「指令清单」面板的那四列就是它算的。这里如果自己再读一遍触发器配置和发消息文案，
 * 就会出现"**清单说的**和**折叠卡说的**不是一回事"—— 而这种不一致在界面上极难发现
 * （两处都像是对的）。**同一件事只有一个算法。**
 *
 * ⚠️ 要算**多个**分组时用 `groupSummaries`（只遍历一次图）。
 *
 * 拿不到触发器或回复时返回 `null`（调用方就**只显示标题**，不编内容）。
 */
export function groupSummary(
  nodes: FlowNode[],
  edges: FlowEdge[],
  nodeIds: readonly string[],
): string | null {
  // 用一个假 NodeGroup 走批量路径，保证两条路径**永远一致**
  const probe: NodeGroup = { id: '__probe__', title: '', nodeIds: [...nodeIds], collapsed: true };
  return groupSummaries(nodes, edges, [probe]).get('__probe__') ?? null;
}
