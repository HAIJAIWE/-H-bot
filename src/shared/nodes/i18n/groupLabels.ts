// src/shared/nodes/i18n/groupLabels.ts
//
// 节点**分组名**的显示文案。
//
// 为什么分组名不放进 `catalog.*.ts`：`spec.group` 的中文字面量在本项目里被当作**稳定键**
// 使用，不是纯显示字段 ——
//   - `src/renderer/src/lib/node/nodeCatalog.ts` 的 `GROUP_ORDER` 用它排序；
//   - `src/renderer/src/components/canvas/NodePalette.tsx` 用 `spec.group === 'AI 生成'`
//     判断图标。
// 所以 `spec.group` 的值**不分语言**（始终是中文键），显示时经本表查一次。
// 这样既不动既有分支逻辑，又能让英文界面显示英文分组名。
//
// 运行时注入的自定义/插件节点会带自己的分组名，查不到时**原样显示**（见 groupLabel）。

/** 目录里实际使用的分组（与 builtinCatalog.ts 的 `group` 取值一一对应） */
export const CATALOG_GROUP_KEYS = [
  '触发器',
  '消息',
  '动作',
  '判断',
  '控制流',
  '数据',
  'AI',
  '存储',
  '计算',
  '上下文',
  '文本',
] as const;

/** 分组键 -> 各语言显示名。zh-CN 是恒等映射（中文键本身就是中文名） */
const GROUP_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': {
    触发器: '触发器',
    消息: '消息',
    动作: '动作',
    判断: '判断',
    控制流: '控制流',
    数据: '数据',
    AI: 'AI',
    存储: '存储',
    计算: '计算',
    上下文: '上下文',
    文本: '文本',
    // 下面两个不是内置目录的分组，而是运行期注入节点的分组（NodePalette 里有专门判断）
    自定义: '自定义',
    'AI 生成': 'AI 生成',
  },
  'en-US': {
    触发器: 'Triggers',
    消息: 'Messages',
    动作: 'Actions',
    判断: 'Conditions',
    控制流: 'Control flow',
    数据: 'Data',
    AI: 'AI',
    存储: 'Storage',
    计算: 'Compute',
    上下文: 'Context',
    文本: 'Text',
    自定义: 'Custom',
    'AI 生成': 'AI generated',
  },
};

/**
 * 取分组显示名。
 * 查不到时**原样返回**分组键 —— 自定义/插件节点会带任意分组名，不能吞掉。
 */
export function groupLabel(group: string, locale: string): string {
  return GROUP_LABELS[locale]?.[group] ?? GROUP_LABELS['zh-CN'][group] ?? group;
}
