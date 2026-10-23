// src/shared/nodes/catalog/registry.ts
//
// 目录语言状态的**运行时唯一入口** —— 解决「目录在 shared 层（main + renderer 共用），
// 但 locale 只在 renderer」这个跨层问题。
//
// 方案：模块级可注入状态，**绝不在模块加载时固化语言**（否则切语言不生效）。
//   - main 进程从不调用 `setCatalogLocale`，永远拿到 zh-CN 契约视图 —— 它的消费点
//     （FlowInterpreter / 代码生成器 / handler 注册）只依赖 kind / 端口 id / handler，
//     语言无关，因此 main 侧零改动、零行为变化；
//   - renderer 侧在 `nodeCatalog.ts` 里 `subscribe()` 到 i18n 变更 -> `setCatalogLocale(l)`，
//     随后复用已有的 `bumpCatalog()` 触发消费方刷新。
//
// 缓存：按语言 memo 一份，避免每次 `getCatalog()` 都重新克隆 48 个节点（buildCatalog
// 对非 zh 语言会逐节点浅拷贝）。
import { buildCatalog, isCatalogLocale, type CatalogLocale } from './build';
import type { NodeSpecV2 } from '../../types/nodeV2';

let activeLocale: CatalogLocale = 'zh-CN';
let cache: NodeSpecV2[] | null = null;

/**
 * 设置当前目录语言。
 * renderer 在 i18n 变更时调用；main 侧不要调用（保持 zh-CN 契约视图）。
 */
export function setCatalogLocale(locale: string): void {
  const next = isCatalogLocale(locale) ? locale : 'zh-CN';
  if (next === activeLocale) return;
  activeLocale = next;
  cache = null;
}

/** 当前目录语言 */
export function getCatalogLocale(): CatalogLocale {
  return activeLocale;
}

/**
 * 当前语言的完整节点目录（memo 缓存）。
 * 这是 renderer 各消费方（PropertyDrawer / CanvasNode / NodePalette / TemplateLibrary /
 * getFieldOptions）应读取的新数据源。
 */
export function getCatalog(): NodeSpecV2[] {
  if (cache === null) cache = buildCatalog(activeLocale);
  return cache;
}

/** kind -> zh-CN 规范名。惰性构建（只在真正写节点时用到） */
let canonicalLabels: Map<string, string> | null = null;

/**
 * 节点的**规范名（恒取 zh-CN）** —— 与当前界面语言无关。
 *
 * 为什么必须有这个：`nodeFactory` 创建节点时会把节点名写进 `node.data.label`，
 * 随后落盘到用户的 `.qqbat/flow.json`，并进入生成代码的注释。若这里跟随界面语言，
 * 英文界面下新建的节点就会把英文名写进用户项目，造成**同一份流程里中英混杂**、
 * 且生成代码注释语言随"建节点时的界面语言"漂移。
 * 所以：**落盘恒用规范名，显示才按当前语言取**（见 renderer 的 nodeDisplayLabel）。
 */
export function getCanonicalNodeLabel(kind: string): string | undefined {
  if (!canonicalLabels) {
    canonicalLabels = new Map(buildCatalog('zh-CN').map((s) => [s.kind, s.label]));
  }
  return canonicalLabels.get(kind);
}
