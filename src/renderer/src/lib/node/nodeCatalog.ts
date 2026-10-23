// src/renderer/src/lib/node/nodeCatalog.ts
import type { NodeSpec } from '@shared/types/flow';
import {
  getCatalog,
  getCanonicalNodeLabel,
  setCatalogLocale,
} from '@shared/nodes/catalog/registry';
import { groupLabel } from '@shared/nodes/i18n/groupLabels';
import { visibleCatalog } from '@shared/nodes/deprecation';
import type { NodeSpecV2 } from '@shared/types/nodeV2';
import { getLocale, subscribe as subscribeLocale } from '../../i18n';

/**
 * 内置节点库的单一数据源是 `getCatalog()`（契约层 builtinCatalog.ts + 当前语言文案，
 * 经 shared/nodes/catalog/registry.ts 按语言组装，**zh-CN 就是 NODE_CATALOG_V2 本身**）。
 *
 * 历史说明：原本此处定义了老的 NODE_CATALOG（NodeSpec[]，21 个节点），与 V2 并存导致
 * 前端只看到 21 个老节点。现已删除老 catalog，所有访问统一通过
 * getAllSpecs()/groupByGroup()/findSpec()，它们均以目录为数据源。
 *
 * ## 双语改造
 * 目录在 shared 层、locale 只在 renderer，这层是两者的**桥**：模块加载时把当前语言
 * 注入 shared 的 registry（setCatalogLocale），并订阅语言切换 -> 重新注入 + bumpCatalog()，
 * 触发 `getAllSpecs()` 的下游（左栏 / 画布 / 属性面板）用新语言重建。
 * 注意**不能在模块加载时固化语言**，否则切 English 不会生效。
 */

/** 动态注入的自定义节点 */
let customNodes: NodeSpec[] = [];

/** 动态注入的插件节点 */
let pluginNodes: NodeSpec[] = [];

/** 动态注入的 AI 生成节点（来自 plugins/ai-* 插件包扫描结果，见 scanAiGeneratedNodes） */
let aiGeneratedNodes: NodeSpec[] = [];

/** 目录版本号：任一注入后递增，供消费方（NodePalette/NodeSearchDialog/BlockInsertMenu）刷新派生数据 */
let catalogVersion = 0;

/** 目录变更订阅器（轻量，无依赖）：返回退订函数 */
const catalogListeners = new Set<() => void>();
export function subscribeCatalog(fn: () => void): () => void {
  catalogListeners.add(fn);
  return () => catalogListeners.delete(fn);
}
export function getCatalogVersion(): number {
  return catalogVersion;
}

function bumpCatalog(): void {
  catalogVersion++;
  for (const fn of catalogListeners) fn();
}

// ===== 语言桥 =====
// 目录在 shared 层（main + renderer 共用），locale 只在 renderer：这里把当前语言注入
// shared 的 registry，并在切换时重新注入 + bumpCatalog()，让消费方用新语言重建目录。
// main 进程从不做这件事，因此它永远拿到 zh-CN 契约视图（语言无关，行为不变）。
setCatalogLocale(getLocale());
subscribeLocale((locale) => {
  setCatalogLocale(locale);
  bumpCatalog();
});

/**
 * 分组的**显示名**（当前语言）。
 * `spec.group` 的中文值在本项目里是**稳定键**（GROUP_ORDER 排序、NodePalette 判断图标
 * 都用它），不能翻译，所以显示一律经这里查表；查不到（自定义/插件分组）原样返回。
 */
export function getGroupDisplayName(group: string): string {
  return groupLabel(group, getLocale());
}

/**
 * 注入自定义节点（来自 plugins/custom-* 插件包扫描结果，见 scanCustomNodes）。
 * 调用后左栏分组和 findSpec 都会看到这些节点。
 */
export function setCustomNodes(nodes: NodeSpec[]): void {
  customNodes = nodes;
  bumpCatalog();
}

/**
 * 注入插件节点（来自插件 SDK 加载结果）。
 */
export function setPluginNodes(nodes: NodeSpec[]): void {
  pluginNodes = nodes;
  bumpCatalog();
}

/**
 * 注入 AI 生成节点（来自 plugins/ai-* 插件包扫描结果，见 scanAiGeneratedNodes）。
 * 调用后左栏分组和 findSpec 都会看到这些节点。
 */
export function setAiGeneratedNodes(nodes: NodeSpec[]): void {
  aiGeneratedNodes = nodes;
  bumpCatalog();
}

/**
 * 合并内置 + 自定义 + 插件的全部节点（**当前语言**）。
 *
 * 数据源：`getCatalog()`（76 个内置节点，按当前语言组装）
 *       + 运行期注入的自定义/插件节点。
 *
 * 类型说明：NodeSpecV2 与 NodeSpec 结构兼容（V2 是超集），但 group 字段
 * 类型不同（V2 是 string，老是字面量联合），故使用 `as unknown as` 断言。
 * 运行时所有调用方访问的字段（kind/type/label/group/icon/description/
 * inputs/outputs/defaultConfig）在 V2 中均存在，安全。
 */
/**
 * **列表类**消费者用的节点集（左栏 / 搜索 / 插入菜单 / 连线建议）——
 * 已弃用节点被过滤掉（见 @shared/nodes/deprecation）。
 */
export function getAllSpecs(): NodeSpec[] {
  // 用共享的 visibleCatalog —— 过滤规则只有一处（@shared/nodes/deprecation）
  return visibleCatalog(
    getAllSpecsWithDeprecated() as unknown as NodeSpecV2[],
  ) as unknown as NodeSpec[];
}

/**
 * **查找类**消费者用的全量集（`findSpec` / 标签映射）——
 * 老 flow.json 里可能还躺着已弃用的 kind，必须能找到它的 spec 才能正确渲染 ✗不能过滤。
 */
export function getAllSpecsWithDeprecated(): NodeSpec[] {
  return [
    ...(getCatalog() as unknown as NodeSpec[]),
    ...customNodes,
    ...pluginNodes,
    ...aiGeneratedNodes,
  ];
}

/**
 * 分组认知顺序：按使用频率 / 新手认知排序，常用地靠前，控制流等不常主动使用的分组靠后。
 * 与教学中心 ⑤「节点全貌（共 76 个，分 11 组）」展示顺序一致，确保 UI 与教学统一。
 * 自定义/插件节点产生的未知分组按字母序排在末尾（见 groupByGroup 末尾处理）。
 */
export const GROUP_ORDER = [
  '触发器',
  '消息',
  '动作',
  'AI',
  '存储',
  '数据',
  '计算',
  '判断',
  '文本',
  '上下文',
  '控制流',
  '自定义',
  'AI 生成',
] as const;

/**
 * 按 group 分组返回，供左栏展示。
 * 分组按 GROUP_ORDER 认知顺序输出（与教学中心一致），
 * 未知分组（自定义/插件）按字母序排在末尾，保证可预期。
 */
export function groupByGroup(catalog?: NodeSpec[]): Record<string, NodeSpec[]> {
  const specs = catalog ?? getAllSpecs();
  // 先按 group 收集
  const grouped: Record<string, NodeSpec[]> = {};
  for (const spec of specs) {
    if (!grouped[spec.group]) grouped[spec.group] = [];
    grouped[spec.group].push(spec);
  }
  // 按认知顺序输出已知分组（仅输出实际有节点的分组，不保留空位）
  const result: Record<string, NodeSpec[]> = {};
  for (const g of GROUP_ORDER) {
    if (grouped[g]) result[g] = grouped[g];
  }
  // 未知分组（自定义/插件）按字母序排在末尾
  const known = new Set<string>(GROUP_ORDER);
  const unknown = Object.keys(grouped)
    .filter((g) => !known.has(g))
    .sort();
  for (const g of unknown) result[g] = grouped[g];
  return result;
}

export function findSpec(kind: string): NodeSpec | undefined {
  // 用**全量**集：老流程里的已弃用 kind（如 get_context）也要能拿到 spec
  return getAllSpecsWithDeprecated().find((s) => s.kind === kind);
}

/**
 * 节点在界面上应该显示的标题（**当前语言**）。
 *
 * 背景：`node.data.label` 是**落盘字段**（写进用户的 `.qqbat/flow.json`，也进生成代码注释），
 * 它恒为 zh-CN 规范名（见 `nodeFactory` 与 shared 的 `getCanonicalNodeLabel`）。
 * 直接渲染它会导致"切了 English 画布还是中文"，所以在渲染层统一走这里：
 *   - 存的还是规范名（= 没被自定义过）→ 按当前语言显示目录里的名字；
 *   - 已被用户/AI 改名 → 原样显示（用户数据不翻译）。
 */
/**
 * 内置节点契约表（zh-CN 恒等映射）。
 *
 * 为什么在这里再导出一次：渲染层很多地方只需要"某个 kind 的端口/类型定义"，
 * 从 `@shared/nodes/builtinCatalog` 直接 import 会把渲染层与契约层耦合得更紧；
 * 而画布/属性面板本来就从本模块拿 `findSpec`。历史上 Flat 版
 * （`lib/nodeCatalog.ts`）导出过它，属性面板也是这么 import 的 —— 丢掉这个再导出
 * 会让"内置节点表"与"当前语言目录"变成两套入口。
 */
export { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'

export function nodeDisplayLabel(
  node: { data?: { nodeKind?: string; label?: string } | null } | null | undefined,
): string {
  const kind = node?.data?.nodeKind;
  const stored = node?.data?.label;
  if (!kind) return stored ?? '';

  const canonical = getCanonicalNodeLabel(kind);
  const isUntouched = stored === undefined || stored === '' || stored === canonical;
  if (isUntouched) return findSpec(kind)?.label ?? canonical ?? kind;

  return stored;
}
