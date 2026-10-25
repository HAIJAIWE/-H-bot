// tests/renderer/stores/aiStoreHistoryTrace.test.ts
//
// 重启后旧轮也要有过程行（2026-10-25）：历史 JSONL 里的思考 / 工具行 / 耗时
// 读回界面时要挂到那条 assistant 消息上（换 id，形状与实时痕迹一致）。
//
// 反面同样重要：**老历史没有这三个字段**，读回时不能给每条消息长出一条空过程行。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: {
    getState: () => ({ saveNow: vi.fn(async () => true), snapshot: () => null, rollback: vi.fn() }),
  },
  beginHistoryBatch: vi.fn(),
  endHistoryBatch: vi.fn(),
  pushHistoryPoint: vi.fn(),
}))

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ currentProject: { path: '/p/当前' } }),
    subscribe: () => () => {},
  },
}))

vi.mock('@renderer/stores/uiStore', () => ({
  useUiStore: { getState: () => ({ centerTab: 'agent', agentModeOverride: undefined }) },
}))

vi.mock('@renderer/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ activeFilePath: undefined }) },
}))

import { useAiStore, emptyConversation } from '@renderer/stores/aiStore'

const noopUnsub = () => () => {}

let entries: unknown[] = []

function installBridge(): void {
  ;(globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = {
    ai: {
      getHistory: vi.fn(async () => ({ ok: true, data: { entries } })),
      agentCoreRun: vi.fn(async () => ({ ok: true, finalText: '', rounds: 0, toolResults: [] })),
      cancelChat: vi.fn(async () => ({ ok: true, data: { cancelled: false } })),
      isRunning: vi.fn(async () => ({ ok: true, data: { running: false } })),
      onToolCall: () => noopUnsub(),
      onChunk: () => noopUnsub(),
      onResponse: () => noopUnsub(),
      onProposal: () => noopUnsub(),
      onAgentState: () => noopUnsub(),
      onCompact: () => noopUnsub(),
      onClientInstruction: () => noopUnsub(),
      onTodo: () => noopUnsub(),
      onAgentStep: () => noopUnsub(),
      onStats: () => noopUnsub(),
      onError: () => noopUnsub(),
      onWarning: () => noopUnsub(),
      onApprovalRequest: () => noopUnsub(),
      onApprovalResolved: () => noopUnsub(),
    },
  }
}

beforeEach(() => {
  entries = []
  installBridge()
  useAiStore.setState({
    ...emptyConversation(),
    conversations: {},
    conversationPath: '/p/当前',
    messages: [],
  })
})

describe('历史里的过程痕迹读回界面', () => {
  it('★ 思考 / 工具行 / 耗时挂到 assistant 那条上', async () => {
    entries = [
      { role: 'user', content: '看一眼', ts: new Date().toISOString() },
      {
        role: 'assistant',
        content: '看完了',
        ts: new Date().toISOString(),
        reasoning: '先 list_dir',
        trace: [{ name: 'list_dir', args: { path: '.' }, status: 'done', result: 'data/' }],
        turnMs: 4200,
      },
    ]
    await useAiStore.getState().loadHistoryFromDisk('/p/当前', { force: true })
    const answer = useAiStore.getState().messages.at(-1)!
    expect(answer.role).toBe('assistant')
    expect(answer.content).toBe('看完了')
    expect(answer.reasoning).toBe('先 list_dir')
    expect(answer.turnMs).toBe(4200)
    expect(answer.trace?.map(t => t.name)).toEqual(['list_dir'])
    // 痕迹的 id 是读回时新造的（历史里没有 id），但不能重复
    expect(answer.trace?.[0].id).toBe('hist-1-0')
  })

  it('老历史没有痕迹 → 不挂空字段（否则每条消息都长出一条过程行）', async () => {
    entries = [
      { role: 'user', content: '旧问题', ts: new Date().toISOString() },
      { role: 'assistant', content: '旧回答', ts: new Date().toISOString() },
    ]
    await useAiStore.getState().loadHistoryFromDisk('/p/当前', { force: true })
    const answer = useAiStore.getState().messages.at(-1)!
    expect(answer.reasoning).toBeUndefined()
    expect(answer.trace).toBeUndefined()
    expect(answer.turnMs).toBeUndefined()
  })
})
