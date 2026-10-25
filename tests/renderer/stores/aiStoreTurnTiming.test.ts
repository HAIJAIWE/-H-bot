// tests/renderer/stores/aiStoreTurnTiming.test.ts
//
// # 一轮的结算行不许靠时序决定（2026-10-25）
//
// 真机撞到：同一句话，有时过程行写「工作了 5 秒」，有时写「已完成」——
// 因为收尾有两条路：`ai:response` 事件，和 `agentCoreRun` 的 invoke 回执兜底。
// 两条消息谁先到没有保证；兜底那条以前只写正文，耗时/思考/工具痕迹全丢。
//
// 这里钉住两件事：
//   1. 回执先到（事件没来）时，兜底收尾**也要带耗时、思考、工具痕迹**；
//   2. 事件已经收尾过，兜底不许再加一条同样的消息。
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
const TURN_MS = 4_200

let runImpl: () => Promise<unknown> = async () => ({ ok: true, data: {} })

function installBridge(): void {
  ;(globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = {
    ai: {
      agentCoreRun: vi.fn(() => runImpl()),
      cancelChat: vi.fn(async () => ({ ok: true, data: { cancelled: true } })),
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

function seedStreaming(): void {
  useAiStore.setState({
    ...emptyConversation(),
    conversations: {},
    conversationPath: '/p/当前',
    messages: [{ role: 'user', content: '做点事' }],
    streaming: true,
    currentChunk: '半截正文',
    currentReasoning: '先看一眼',
    runStartedAt: Date.now() - TURN_MS,
    toolCalls: [],
  })
}

beforeEach(() => {
  runImpl = async () => ({
    ok: true,
    finalText: '做完了',
    rounds: 1,
    toolResults: [{ name: 'list_dir', args: { path: '.' }, output: 'data/ src/' }],
  })
  installBridge()
  seedStreaming()
})

describe('一轮的耗时从开始算到收尾（兜底收尾同样算）', () => {
  it('★ 回执先到：兜底收尾也要带耗时 / 思考 / 工具痕迹', async () => {
    // 只伪造 Date：sendMessage 里 `runStartedAt: Date.now()` 是开头，
    // 回执到达时把时钟拨快 4.2s —— 这才是"一轮到底花了多久"的真实形状
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-25T10:00:00Z').getTime()
    vi.setSystemTime(t0)
    runImpl = async () => {
      vi.setSystemTime(t0 + TURN_MS)
      return {
        ok: true,
        finalText: '做完了',
        rounds: 1,
        toolResults: [{ name: 'list_dir', args: { path: '.' }, output: 'data/ src/' }],
      }
    }
    await useAiStore.getState().sendMessage('/p/当前', '做点事')
    vi.useRealTimers()

    const last = useAiStore.getState().messages.at(-1)
    expect(last?.role).toBe('assistant')
    expect(last?.content).toBe('做完了')
    expect(last?.reasoning).toBe('先看一眼')
    expect(last?.trace?.map(t => t.name)).toEqual(['list_dir'])
    expect(last?.turnMs).toBeGreaterThanOrEqual(TURN_MS)
    // 收尾后这一轮的时间戳要归零，否则下一轮会把上一轮的时长算进去
    expect(useAiStore.getState().runStartedAt).toBe(0)
    expect(useAiStore.getState().streaming).toBe(false)
  })

  it('事件已经收过尾了，兜底不许再加一条', async () => {
    runImpl = async () => {
      // 模拟 `ai:response` 先到：流式态已收，messages 里已有终稿
      useAiStore.setState({
        streaming: false,
        currentChunk: '',
        currentReasoning: '',
        runStartedAt: 0,
      })
      return { ok: true, finalText: '做完了', rounds: 1, toolResults: [] }
    }
    await useAiStore.getState().sendMessage('/p/当前', '做点事')

    const messages = useAiStore.getState().messages.filter(m => m.role === 'assistant')
    expect(messages).toHaveLength(0)
  })
})
