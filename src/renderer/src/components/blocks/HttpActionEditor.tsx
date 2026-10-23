// src/renderer/src/components/blocks/HttpActionEditor.tsx
// http_request 节点的配置编辑器
// 从 PropertyDrawer 中拆出：HTTP 请求节点的专属配置区域
// 当前 http_request 使用通用 configFields 渲染，此组件为未来专用编辑器预留
import { memo } from 'react'

interface HttpActionEditorProps {
  /** 当前节点 ID */
  nodeId: string
  /** 节点配置对象 */
  config: Record<string, unknown>
  /** 配置变更回调 */
  onConfigChange: (patch: Record<string, unknown>) => void
}

/** http_request 节点的配置编辑器（预留扩展） */
export const HttpActionEditor = memo(function HttpActionEditor({
  // 当前预留：http_request 节点使用通用 configFields 渲染，
  // 未来可在此添加专属 UI，如：
  // - 请求体编辑器（JSON/表单切换）
  // - 请求头可视化编辑
  // - 响应预览
  // - cURL 导入/导出
  nodeId: _nodeId,
  config: _config,
  onConfigChange: _onConfigChange,
}: HttpActionEditorProps) {
  return null
})
