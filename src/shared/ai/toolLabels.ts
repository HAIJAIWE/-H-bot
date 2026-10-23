// src/shared/ai/toolLabels.ts
//
// 工具调用的**人话标签**（2026-10-18）。
//
// 界面上一行 `● write_file plugins/x.js` 对开发者还行，对作者不像话。
// 这里给常用工具一套中文短标签 + 状态词；渲染层只查表，不拼字符串
// （也绕开渲染层「不许硬编码文案」的闸门）。

export const TOOL_LABELS: Record<string, string> = {
  read_file: '读取',
  write_file: '写入',
  read_code: '读代码',
  write_code: '编辑代码',
  run_command: '运行命令',
  run_test: '跑测试',
  validate_flow: '校验流程',
  preview_flow: '预览流程',
  read_flow: '读流程',
  list_nodes: '查节点',
  list_templates: '查片段',
  list_node_examples: '查示例',
  search_capabilities: '查能力',
  invoke_capability: '调能力',
  add_node: '加节点',
  connect_nodes: '连线',
  update_node: '改节点',
  delete_node: '删节点',
  apply_template: '套片段',
  new_command: '建指令',
  new_lookup: '建查询',
  create_ai_node: '造节点',
};

/** 没登记的工具退回原名（宁可看不懂，也不要瞎翻译） */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}
