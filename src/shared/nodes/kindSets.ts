// src/shared/nodes/kindSets.ts
//
// # 按**能力**（resource）派生的 kind 集合 —— 不要手抄 kind 名单
//
// ## 为什么需要它（2026-10-03 审查的产出）
//
// 拆节点的本质是改几何：一个 kind 变成好几个。凡是"按 kind 认节点"的地方
// 都必须跟着改 —— 而这类地方**漏了不会报错、不崩**，只是静默少认一些节点。
//
// 实测两次（都靠人工审查才发现）：
//   · dataTemplateService：只认 variable_persist → 拆成 7 个后玩家字段识别空掉；
//   · PropertyDrawer：只认 variable_persist → 新节点的 key 字段丢掉数据模板选择器。
//
// 所以判据从"kind 名单"改成**能力标签**（目录里的 resource），一处派生、处处引用：
// 以后再加持久化节点，这两处**自动生效**，不需要有人记得去改。
import { NODE_CATALOG_V2 } from './builtinCatalog';

/** 所有"持久化（玩家数据）"节点：读 / 写 / 自增 / 条件更新 / 列表追加 / 删 / 判断存在 */
export const PERSISTENCE_KINDS: ReadonlySet<string> = new Set(
  NODE_CATALOG_V2.filter((s) => s.resource === 'player_data').map((s) => s.kind),
);

/** 某个 kind 是不是持久化节点（含已弃用的 variable_persist —— 老图迁移前也要认） */
export function isPersistenceKind(kind: string | undefined | null): boolean {
  return kind != null && PERSISTENCE_KINDS.has(kind);
}
