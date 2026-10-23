// src/shared/nodes/deprecation.ts
//
// 已弃用节点的判定（唯一一处）。
//
// 「弃用」的语义（2026-10-03 立）：节点被拆分/替代后，条目**保留在目录里**当老 flow.json 的契约，
// 但**列表类消费者要隐藏它** —— 面板、搜索、插入菜单、AI 工具列表都只该展示新节点。
//
// 为什么保留而不是删除：摘掉一个 kind 会连带打断夹具、模板、代码生成器等 20+ 处引用
// （实测 46 个测试红），而它对老流程仍然有效。弃用 = 停止推荐，不是立刻删除。
//
// 迁移见 graphPreprocess（例如 get_context 的 CONTEXT_SPLIT_BY_MODE）。
import type { NodeSpecV2 } from '@shared/types/nodeV2';
import { NODE_CATALOG_V2 } from './builtinCatalog';

/** 这个节点是否已弃用（面板/搜索/AI 列表要过滤掉） */
export function isDeprecatedSpec(spec: { deprecated?: unknown }): boolean {
  return Boolean(spec.deprecated);
}

/** 已弃用的 kind 集合 */
export const DEPRECATED_KINDS: readonly string[] = NODE_CATALOG_V2.filter((s) =>
  isDeprecatedSpec(s),
).map((s) => s.kind);

/** 这个 kind 是否已弃用 */
export function isDeprecatedKind(kind: string): boolean {
  return DEPRECATED_KINDS.includes(kind);
}

/** 可见目录（列表类消费者用这个） */
export function visibleCatalog(catalog: readonly NodeSpecV2[] = NODE_CATALOG_V2): NodeSpecV2[] {
  return catalog.filter((s) => !isDeprecatedSpec(s));
}
