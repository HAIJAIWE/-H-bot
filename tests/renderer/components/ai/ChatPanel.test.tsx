// tests/renderer/components/ai/ChatPanel.test.tsx
//
// ## 恢复说明（2026-10-23）
// 原文件在磁带里只有局部 read/edit，唯一一份完整内容在 4491 字节处被 splice：
// 90-98 行是**另一版**的尾巴（工具痕迹摘要），100-122 行又起了一遍「应用全部」并且
// 丢掉了 `it(...)` 头部，只剩 proposalA/proposalB 的构造。这里按当前组件契约重写，
// 覆盖旧版能确认的 4 个用例 + 补回被 splice 掉的两个（工具痕迹展开、切提案重置选择）。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Proposal } from '@shared/types/proposal'

// 必须在 import aiStore 之前 mock flowStore（vi.mock 会自动提升到文件顶部）
vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: {
    getState: () => ({
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNodeConfig: vi.fn(),
      removeNode: vi.fn(),
      autoLayout: vi.fn(),
      snapshot: vi.fn(() => ({ nodes: [], edges: [] })),
      rollback: vi.fn(),
      generateCode: vi.fn().mockResolvedValue(true),
    }),
  },
}))

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: (selector: (s: { currentProject: null }) => unknown) =>
    selector({ currentProject: null }),
}))

import { t } from '@renderer/i18n'
import { useAiStore } from '@renderer/stores/aiStore'
import { ChatPanel } from '@renderer/components/ai/ChatPanel'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  // 重置 store 状态，确保测试隔离
  useAiStore.setState({
    currentProposal: null,
    messages: [],
    streaming: false,
    currentChunk: '',
    toolCalls: [],
    agentState: { state: 'idle' },
    isBatchMode: false,
  })
})

/** 按钮文案全部来自 i18n：用 t() 取，别把中文写死进断言（否则换语言就红） */
const APPLY_ALL = () => t('ai.proposal.applyAll')
const REJECT = () => t('ai.proposal.reject')
const REJECT_ALL = () => t('ai.proposal.rejectAll')

describe('ChatPanel 集成 ProposalCard', () => {
  const mockProposal: Proposal = {
    id: 'p-1',
    summary: '添加复读节点',
    riskLevel: 'low',
    createdAt: Date.now(),
    operations: [
      { kind: 'add_node', tempRef: 'n1', nodeKind: 'message_received', label: '收到消息' },
    ],
  }

  it('currentProposal 为 null 时不显示 ProposalCard', () => {
    render(<ChatPanel />)
    expect(screen.queryByText('添加复读节点')).not.toBeInTheDocument()
  })

  it('currentProposal 存在时显示 ProposalCard 与三个动作', () => {
    useAiStore.setState({ currentProposal: mockProposal })
    render(<ChatPanel />)
    expect(screen.getByText('添加复读节点')).toBeInTheDocument()
    // 应用 / 拒绝 / 全部拒绝 是三个不同动作，缺一个用户就少一条路
    expect(screen.getByText(APPLY_ALL())).toBeInTheDocument()
    expect(screen.getByText(REJECT())).toBeInTheDocument()
    expect(screen.getByText(REJECT_ALL())).toBeInTheDocument()
  })

  it('点击应用全部调用 applyProposal，且默认全选', () => {
    const applySpy = vi.fn().mockResolvedValue(undefined)
    useAiStore.setState({ currentProposal: mockProposal, applyProposal: applySpy })
    render(<ChatPanel />)
    fireEvent.click(screen.getByText(APPLY_ALL()))
    expect(applySpy).toHaveBeenCalledTimes(1)
    // ProposalCard 默认全选操作，因此传入全部 operations
    expect(applySpy).toHaveBeenCalledWith(mockProposal.operations)
  })

  it('点击拒绝调用 rejectProposal', () => {
    const rejectSpy = vi.fn()
    useAiStore.setState({ currentProposal: mockProposal, rejectProposal: rejectSpy })
    render(<ChatPanel />)
    fireEvent.click(screen.getByText(REJECT()))
    expect(rejectSpy).toHaveBeenCalledTimes(1)
  })

  it('过程行：一行结算 + 展开后逐条工具可读（2026-10-25 按 DSH 重排后）', () => {
    useAiStore.setState({
      messages: [
        { role: 'user', content: '查一下节点' },
        {
          role: 'assistant',
          content: '查完了',
          // 3 次调用、2 个同名 → 摘要要合并计数（list_nodes ×2、read_flow）
          trace: [
            { id: 't1', name: 'list_nodes', args: { kind: 'message_received' }, status: 'done' },
            { id: 't2', name: 'list_nodes', args: { kind: 'message_send' }, status: 'done' },
            { id: 't3', name: 'read_flow', args: {}, status: 'done' },
          ],
        },
      ],
    })
    render(<ChatPanel />)

    // 折叠层级变了：整轮不再折成一行，折的是「过程」（思考 + 工具）这一层
    const summary = t('ai.process.worked')
    expect(screen.getByText(summary), '没有那一行结算').toBeInTheDocument()
    expect(screen.getByText(t('ai.process.tools', { n: '3' }))).toBeInTheDocument()
    // 收起态不该有明细
    expect(screen.queryByText(/message_received/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(summary))
    // 展开后一行显示「工具名 + 目标」，目标就是 nodeKind（不是 kind=… 的拼接）
    expect(screen.getByText(/message_received/)).toBeInTheDocument()
    expect(screen.getByText(/message_send/)).toBeInTheDocument()
  })

  it('换一条提案时选择被重置为全选（应用按钮重新可用）', () => {
    const proposalA: Proposal = {
      id: 'p-a',
      summary: 'A 方案',
      riskLevel: 'low',
      createdAt: Date.now(),
      operations: [
        { kind: 'add_node', tempRef: 'a1', nodeKind: 'message_received', label: 'A1' },
        { kind: 'add_node', tempRef: 'a2', nodeKind: 'message_send', label: 'A2' },
      ],
    }
    const proposalB: Proposal = {
      id: 'p-b',
      summary: 'B 方案',
      riskLevel: 'low',
      createdAt: Date.now(),
      operations: [
        { kind: 'add_node', tempRef: 'b1', nodeKind: 'message_received', label: 'B1' },
        { kind: 'add_node', tempRef: 'b2', nodeKind: 'message_send', label: 'B2' },
      ],
    }

    useAiStore.setState({ currentProposal: proposalA })
    const { rerender } = render(<ChatPanel />)
    // 先「全部拒绝」= 取消全选 → 应用按钮 disabled（没选任何操作就不该让它点）
    fireEvent.click(screen.getByText(REJECT_ALL()))
    expect(screen.getByText(APPLY_ALL())).toBeDisabled()

    // 切到 proposalB：selected 应被重置为全选，应用按钮不再 disabled
    useAiStore.setState({ currentProposal: proposalB })
    rerender(<ChatPanel />)
    expect(screen.getByText('B 方案')).toBeInTheDocument()
    expect(screen.getByText(APPLY_ALL())).not.toBeDisabled()
  })

  it('clearMessages 清理 currentProposal', () => {
    useAiStore.setState({ currentProposal: mockProposal })
    render(<ChatPanel />)
    expect(screen.getByText('添加复读节点')).toBeInTheDocument()
    useAiStore.getState().clearMessages()
    expect(useAiStore.getState().currentProposal).toBeNull()
  })
})

// 第 56 批：回合目录的入口必须真的挂在 ChatPanel 上（web tsc 能过 ≠ 按钮存在 ——
// 这个功能的第一版就是"import 有了、JSX 没有"，所以这里从界面点一次）。
describe('回合目录入口', () => {
  it('点消息工具条上的目录按钮能打开抽屉', () => {
    render(<ChatPanel />)
    fireEvent.click(screen.getByRole('button', { name: t('ai.turnOutline.title') }))
    expect(screen.getByRole('dialog', { name: t('ai.turnOutline.title') })).toBeInTheDocument()
    // 空对话：抽屉如实说"还没有回合"
    expect(screen.getByText(t('ai.turnOutline.empty'))).toBeInTheDocument()
  })
})
