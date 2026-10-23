// src/renderer/src/lib/node/nodeSearch.ts
// 阶段 7 Part B：画布 Ctrl+F 搜索 — 抽纯函数便于测试
import type { FlowNode } from '@shared/types/flow';
import { nodeDisplayLabel } from './nodeCatalog';

/** 搜索匹配函数：按 label / nodeKind / id 模糊匹配（不区分大小写）。
 *  返回匹配的节点 ID 列表（按 nodes 原始顺序）。
 *  label 取**当前语言**的显示名（nodeDisplayLabel）—— 用户看到的是哪个词，
 *  就该能用哪个词搜到；英文界面下搜 "Send message" 必须命中。 */
export function searchNodes(query: string, nodes: FlowNode[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter((n) => {
      const label = nodeDisplayLabel(n).toLowerCase();
      const kind = (n.data.nodeKind ?? '').toLowerCase();
      return label.includes(q) || kind.includes(q) || n.id.toLowerCase().includes(q);
    })
    .map((n) => n.id);
}
