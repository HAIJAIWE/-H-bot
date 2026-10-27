// src/renderer/src/components/ai/builtinAgentSurface.tsx
//
// 内置「对话窗口」作为 agent surface 的注册（第 68 批）。
//
// import 即生效：`RightPanel` 在渲染前先 import 本模块，保证注册表里至少有一个窗口。
// order=1000 表示「默认」——贡献方注册更小的 order 即可接管整个智能体窗口。
import { registerAgentSurface } from '../../lib/ai/agentSurface'
import { ChatPanel } from './ChatPanel'

registerAgentSurface({
  id: 'chat',
  order: 1000,
  render: () => <ChatPanel />,
})
