// src/renderer/src/components/blocks/AiActionEditor.tsx
// ai_chat / llm_chat 节点的配置编辑器
// 从 PropertyDrawer 中拆出：AI 对话节点的专属配置区域
// 当前 llm_chat 使用通用 configFields 渲染，此组件为未来专用编辑器预留
import { memo } from 'react'

interface AiActionEditorProps {
  /** 当前节点 ID */
  nodeId: string
  /** 节点配置对象 */
  config: Record<string, unknown>
  /** 配置变更回调 */
  onConfigChange: (patch: Record<string, unknown>) => void
}

/** ai_chat / llm_chat 节点的配置编辑器（预留扩展） */
export const AiActionEditor = memo(function AiActionEditor({
  // 当前预留：llm_chat 节点使用通用 configFields 渲染，
  // 未来可在此添加专属 UI，如：
  // - 系统提示词模板选择
  // - 温度滑块
  // - 模型选择下拉
  // - 对话历史预览
  nodeId: _nodeId,
  config: _config,
  onConfigChange: _onConfigChange,
}: AiActionEditorProps) {
  return null
})
