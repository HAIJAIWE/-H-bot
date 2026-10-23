// 从 PropertyDrawer.tsx 拆分而来（P0-D1 重构）
// 集中存放文本字段清单、JSON 字段示例与节点参数描述查询函数。
//
// ⚠️ 字段显示名/说明/选项**不在本文件**：真源是 i18n/fieldLabels.ts
// （fieldLabel / fieldHint / portHint）与 shared/nodes/fieldOptions.ts。
// 2026-10-24 删除了恢复期误带的 CONFIG_LABELS / CONFIG_HINTS / PORT_HINTS /
// SELECT_OPTIONS 四份旧字典 —— 10/18 客户端的同一模块里也没有它们，且运行期 0 引用。
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { t } from '../../i18n'

/** 从 catalog 获取节点参数的描述信息 */
export function getNodeInputDescriptions(nodeKind: string): Record<string, string> {
  const entry = NODE_CATALOG_V2.find(e => e.kind === nodeKind)
  if (!entry) return {}
  const descs: Record<string, string> = {}
  for (const input of entry.inputs) {
    descs[input.id] = input.description || ''
  }
  return descs
}

/** 多行文本字段（用 textarea） */
export const MULTILINE_FIELDS = new Set(['expression', 'template', 'text', 'message', 'prompt'])

/** JSON 编辑字段（用大 textarea + 格式提示）。
 *  扩展包含 http_request/api_call/send_message forward 等场景的 JSON 字段，
 *  让它们也用 JSON_EXAMPLES 提供格式示例（避免空白 textarea 无从下手）。 */
export const JSON_FIELDS = new Set([
  'cases',
  'transitions',
  'segments', // 分支/状态机/消息段
  'headers',
  'body',
  'params', // http_request / api_call
  'messages', // send_message forward 模式
  'variables_json', // format_text 命名变量
])

/** JSON 字段格式示例 placeholder：给新手提供格式参考。
 *  - 优先级：JSON_EXAMPLES[field.key] > fieldHint(field.key) > '输入 JSON...'
 *  - 与 hint（说明性文字）互补：示例更直观，hint 更详细，二者择优 */
export const JSON_EXAMPLES: Record<string, string> = {
  // 用 getter 而不是字面量：语言切换后 placeholder 要跟着变（常量在模块加载时只求值一次）。
  get cases() {
    return t('blocks.placeholders.cases')
  },
  get transitions() {
    return t('blocks.placeholders.transitions')
  },
  get segments() {
    return t('blocks.placeholders.segments')
  },
  get headers() {
    return t('blocks.placeholders.headers')
  },
  get body() {
    return t('blocks.placeholders.body')
  },
  get params() {
    return t('blocks.placeholders.params')
  },
  get messages() {
    return t('blocks.placeholders.messages')
  },
  get variables_json() {
    return t('blocks.placeholders.variablesJson')
  },
}
