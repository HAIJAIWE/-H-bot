// src/shared/nodes/i18n/copy.types.ts
//
// 节点目录的**文案层**类型（只有显示文案，没有契约字段）。
//
// 为什么契约与文案要分家：handler / toolName / showWhen / 选项 value / defaultConfig
// 这些是运行时与代码生成器依赖的契约，**必须**单一真相（在 builtinCatalog.ts）；
// 其余语言只提供"怎么显示"，缺译文时回退中文并登记，绝不把契约翻一遍。
//
// 键的约定（与 catalog/build.ts 的查表方式严格对应）：
//   - CatalogCopy 的键 = 节点 kind
//   - NodeCopy.ports 的键 = `${'inputs'|'outputs'}.${端口id}`
//   - NodeCopy.options 的键 = 配置字段名，内层键 = 选项 value

/** 下拉选项的文案。group 是分组标题，可选。 */
export interface OptionCopy {
  label: string
  group?: string
}

/** 单个端口（输入/输出）的文案。name 必填，description 可选（有中文说明才要求）。 */
export interface PortCopy {
  name: string
  description?: string
}

/** 单个节点的文案。 */
export interface NodeCopy {
  label: string
  description?: string
  summary?: string
  tags?: readonly string[]
  /** 键形如 'inputs.mode' / 'outputs.next' */
  ports?: Record<string, PortCopy>
  /** 配置字段名 → 选项 value → 文案 */
  options?: Record<string, Record<string, OptionCopy>>
}

/** 整张文案表：节点 kind → 文案。 */
export type CatalogCopy = Record<string, NodeCopy>
