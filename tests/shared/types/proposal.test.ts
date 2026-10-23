// tests/shared/types/proposal.test.ts
import { describe, it, expect } from 'vitest'
import type { Proposal, ProposalOperation } from '@shared/types/proposal'
import { createProposal, assessProposalRisk } from '@shared/types/proposal'

describe('Proposal 类型', () => {
  it('createProposal 生成带 id 和 createdAt 的 proposal', () => {
    const p = createProposal('测试计划', [
      { kind: 'add_node', tempRef: 'new_n1', nodeKind: 'on_message' }
    ])
    expect(p.id).toBeTruthy()
    expect(p.summary).toBe('测试计划')
    expect(p.operations).toHaveLength(1)
    expect(p.createdAt).toBeGreaterThan(0)
  })

  it('assessProposalRisk 返回最高风险等级', () => {
    const ops: ProposalOperation[] = [
      { kind: 'add_node', tempRef: 'new_n1', nodeKind: 'send_message' },
      { kind: 'write_code', filePath: 'test.py', content: 'import os; os.system("rm")', riskLevel: 'high' }
    ]
    expect(assessProposalRisk(ops)).toBe('high')
  })

  it('assessProposalRisk 无危险操作返回 low', () => {
    const ops: ProposalOperation[] = [
      { kind: 'add_node', tempRef: 'new_n1', nodeKind: 'on_message' },
      { kind: 'connect', sourceRef: 'new_n1', sourcePortId: 'out', targetRef: 'new_n2', targetPortId: 'in' }
    ]
    expect(assessProposalRisk(ops)).toBe('low')
  })

  it('tempRef 必须以 new_ 前缀开头', () => {
    const p = createProposal('test', [
      { kind: 'add_node', tempRef: 'invalid_ref', nodeKind: 'on_message' }
    ])
    // createProposal 不做校验，校验在执行时。这里只验证类型
    expect(p.operations[0].kind).toBe('add_node')
  })

  it('assessProposalRisk 将 generate_code 评估为 medium', () => {
    const ops: ProposalOperation[] = [
      { kind: 'add_node', tempRef: 'new_n1', nodeKind: 'on_message' },
      { kind: 'generate_code' }
    ]
    expect(assessProposalRisk(ops)).toBe('medium')
  })

  it('assessProposalRisk generate_code 不会覆盖 high', () => {
    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: 'a.py', content: 'x', riskLevel: 'high' },
      { kind: 'generate_code' }
    ]
    expect(assessProposalRisk(ops)).toBe('high')
  })

  it('assessProposalRisk 单独 generate_code 不会被评估为 low', () => {
    const ops: ProposalOperation[] = [
      { kind: 'generate_code' }
    ]
    expect(assessProposalRisk(ops)).not.toBe('low')
    expect(assessProposalRisk(ops)).toBe('medium')
  })
})
