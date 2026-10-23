// src/shared/nodes/portOptions.ts
//
// 枚举型字段选项的**统一查询入口** —— 属性面板、画布内联卡片都从这里取，
// 不再各自维护一份清单（历史上 5 处各写一份导致的漂移见 docs/nodes-audit-handoff.md 闸 1）。
//
// 查找顺序：
//   1. 数据端口的 `options`（有端口的字段：绝大多数）；
//   2. 节点级 `configFieldOptions`（触发器/开始节点这类没有输入端口的节点）。
// 两处都没有 → 返回 undefined，调用方按普通文本输入渲染。
//
// 双语改造：改从 `getCatalog()` 取当前语言的目录，并按语言缓存索引 ——
// 否则英文界面下选项仍是中文（index 是模块级缓存，语言切换后必须失效重建）。
import type { FieldOption, NodeSpecV2 } from '../types/nodeV2';
import { getCatalog, getCatalogLocale } from './catalog/registry';

let specIndex: Map<string, NodeSpecV2> | null = null;
/** 索引是按哪种语言建的；语言变了必须重建，否则英文界面拿到中文选项 */
let specIndexLocale: string | null = null;

function specOf(kind: string): NodeSpecV2 | undefined {
  const locale = getCatalogLocale();
  if (!specIndex || specIndexLocale !== locale) {
    specIndex = new Map(getCatalog().map((s) => [s.kind, s]));
    specIndexLocale = locale;
  }
  return specIndex.get(kind);
}

/**
 * 取某节点某个配置字段的可选值清单。
 * @param kind 节点 kind（规范名，如 `message_send`）
 * @param key 配置字段 / 端口 id（如 `mode`）
 */
export function getFieldOptions(kind: string, key: string): readonly FieldOption[] | undefined {
  const spec = specOf(kind);
  if (!spec) return undefined;
  const fromPort = spec.inputs.find((p) => p.id === key)?.options;
  return fromPort ?? spec.configFieldOptions?.[key];
}