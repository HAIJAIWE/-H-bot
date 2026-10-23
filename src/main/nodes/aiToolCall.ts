// src/main/nodes/aiToolCall.ts
import type { NodeSpecV2 } from '@shared/types/nodeV2'

/** ai_tool_call 节点 — 运行期 AI 动态选择并调用其他节点 */
export const AI_TOOL_CALL_SPEC: NodeSpecV2 = {
  kind: 'ai_tool_call',
  type: 'ai',
  label: 'AI 工具调用',
  group: 'AI',
  icon: '🧠',
  description: 'AI 根据用户消息动态选择并调用其他节点',
  summary: '运行期 AI 智能体节点，根据用户消息动态选择可用工具节点并调用，适用于需要 AI 自主决策的场景',
  sideEffects: [],
  tags: ['AI', '工具', '智能体', '决策'],
  handler: { source: 'builtin', module: 'ai_tool_call' },
  exposedAsTool: false,
  defaultConfig: {
    max_rounds: 3,
    confirm_high_risk: true,
    system_prompt: '你是一个智能助手，根据用户消息选择合适的工具调用。'
  },
  inputs: [
    { id: 'in', name: '入口', kind: 'control' },
    { id: 'user_message', name: '用户消息', kind: 'data', dataType: 'string', required: true, description: '用户输入的消息文本' }
  ],
  outputs: [
    { id: 'out', name: '出口', kind: 'control' },
    { id: 'response', name: 'AI 回复', kind: 'data', dataType: 'string', description: 'AI 最终回复文本' }
  ]
}
