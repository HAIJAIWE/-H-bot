// tests/renderer/components/ai/ProposalCard.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ProposalCard } from '@renderer/components/ai/ProposalCard'
import type { Proposal } from '@shared/types/proposal'

afterEach(() => {
  cleanup()
})

describe('ProposalCard', () => {
  const mockProposal: Proposal = {
    id: 'test-1',
    summary: '添加复读机流程',
    riskLevel: 'low',
    createdAt: Date.now(),
    operations: [
      { kind: 'add_node', tempRef: 'new_trigger', nodeKind: 'message_received', label: '收到消息' },
      { kind: 'add_node', tempRef: 'new_action', nodeKind: 'message_send', label: '发消息' },
      { kind: 'connect', sourceRef: 'new_trigger', sourcePortId: 'out', targetRef: 'new_action', targetPortId: 'in' }
    ]
  }

  it('显示 summary 和风险徽章', () => {
    render(<ProposalCard proposal={mockProposal} onApply={() => {}} onReject={() => {}} />)
    expect(screen.getByText('添加复读机流程')).toBeInTheDocument()
    expect(screen.getByText(/低风险|低/)).toBeInTheDocument()
  })

  it('显示所有操作', () => {
    render(<ProposalCard proposal={mockProposal} onApply={() => {}} onReject={() => {}} />)
    expect(screen.getByText(/收到消息/)).toBeInTheDocument()
    expect(screen.getByText(/发消息/)).toBeInTheDocument()
  })

  it('有应用和拒绝按钮', () => {
    render(<ProposalCard proposal={mockProposal} onApply={() => {}} onReject={() => {}} />)
    expect(screen.getByText('应用全部')).toBeInTheDocument()
    expect(screen.getByText('拒绝')).toBeInTheDocument()
  })

  it('selected 为空时应用全部按钮 disabled', () => {
    render(<ProposalCard proposal={mockProposal} onApply={() => {}} onReject={() => {}} />)
    fireEvent.click(screen.getByText('全部拒绝'))
    const applyBtn = screen.getByText('应用全部')
    expect(applyBtn).toBeDisabled()
  })

  it('selected 非空时应用全部按钮可点击', () => {
    render(<ProposalCard proposal={mockProposal} onApply={() => {}} onReject={() => {}} />)
    const applyBtn = screen.getByText('应用全部')
    expect(applyBtn).not.toBeDisabled()
  })

  it('proposal.id 变化时 selected 重置为全选', () => {
    const { rerender } = render(<ProposalCard proposal={mockProposal} onApply={() => {}} onReject={() => {}} />)
    // 先全部拒绝
    fireEvent.click(screen.getByText('全部拒绝'))
    expect(screen.getByText('应用全部')).toBeDisabled()

    // 切换到新 proposal（不同 id）
    const newProposal: Proposal = {
      ...mockProposal,
      id: 'test-2',
      operations: [
        { kind: 'add_node', tempRef: 'new_a', nodeKind: 'message_received', label: '新节点A' },
        { kind: 'add_node', tempRef: 'new_b', nodeKind: 'message_send', label: '新节点B' }
      ]
    }
    rerender(<ProposalCard proposal={newProposal} onApply={() => {}} onReject={() => {}} />)
    // selected 应被重置为全选，应用全部按钮不再 disabled
    expect(screen.getByText('应用全部')).not.toBeDisabled()
  })
})
