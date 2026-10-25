// tests/main/ipc/aiAgentCoreOnboarding.test.ts
//
// # 开荒（还没有项目）也走同一条循环 —— 装配与事件形状
//
// 这一个分支的性质：**循环没变，变的是装配**。所以测试也只钉装配与事件：
//   · 传下去的工具只剩能力层那三个，轮数上限 8，roleNote 是开荒强调句；
//   · 事件通道/键与主链路完全一致（渲染层一行不用改，也就不能被这里悄悄改坏）；
//   · 有提议就只发提案、不发正文（与主链路同一条分工）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

type ToolDef = {
  name: string
  description: string
  category: 'query' | 'mutation'
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: unknown) => Promise<string>
}

const h = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  runAgentTurn: vi.fn(),
  adaptLegacyTools: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@main/services/ai/appAiConfig', () => ({ resolveAuthorAiConfig: h.resolveConfig }))
vi.mock('@main/services/ai/agents', () => ({
  ONBOARDING_HINT: '开荒强调句',
  ONBOARDING_TOOLS: ['search_capabilities', 'describe_capability', 'propose_capability'],
}))
vi.mock('@main/services/agent-core/legacyTools', () => ({ adaptLegacyTools: h.adaptLegacyTools }))
vi.mock('@main/services/agent-core/runTurn', () => ({ runAgentTurn: h.runAgentTurn }))
vi.mock('@main/services/infra/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { runOnboardingTurn, ONBOARDING_MAX_ROUNDS } from '@main/ipc/aiAgentCoreOnboarding'
import { aiAgentCoreRunSchema } from '@main/schemas/ai'

const CONFIG = { baseUrl: 'http://example.invalid', apiKey: 'k', model: 'm' }
const RESULT = {
  finalText: '好的',
  rounds: 1,
  phase: { kind: 'finished', reason: 'completed' },
  toolResults: [],
}

/** 发出的通道序列（断言顺序与"有没有多发一条"） */
function channels(): string[] {
  return h.send.mock.calls.map(c => String(c[0]))
}
/** 某个通道的全部载荷 */
function payloads(channel: string): Array<Record<string, unknown>> {
  return h.send.mock.calls.filter(c => c[0] === channel).map(c => c[1] as Record<string, unknown>)
}

function legacyTable(bridge?: { pendingOperations: unknown[] }): ToolDef[] {
  const table: ToolDef[] = [
    {
      name: 'search_capabilities',
      description: '查',
      category: 'query',
      parameters: {},
      run: async () => '[]',
    },
    {
      name: 'describe_capability',
      description: '看',
      category: 'query',
      parameters: {},
      run: async () => '{}',
    },
    {
      name: 'read_file',
      description: '读文件（开荒不该有它）',
      category: 'query',
      parameters: {},
      run: async () => 'x',
    },
  ]
  // 真工具的 propose 只是"攒操作"：真正的提案由收尾统一出（所以卡片只有一张）
  table.push({
    name: 'propose_capability',
    description: '提议',
    category: 'mutation',
    parameters: {},
    run: async args => {
      bridge?.pendingOperations.push({
        kind: 'capability',
        capabilityId: String(args.capabilityId ?? 'project.create'),
        capabilityArgs: (args.args as Record<string, unknown> | undefined) ?? {},
        riskLevel: 'medium',
      })
      return '已加入待确认计划'
    },
  })
  return table
}

describe('★ 开荒进循环：装配', () => {
  beforeEach(() => {
    h.resolveConfig.mockReset().mockResolvedValue(CONFIG)
    h.send.mockReset()
    h.runAgentTurn.mockReset().mockResolvedValue(RESULT)
    h.adaptLegacyTools
      .mockReset()
      .mockImplementation((bridge: { pendingOperations: unknown[] }) => legacyTable(bridge))
  })

  it('schema 允许空 projectPath（空串 = 开荒），仍然限长', () => {
    expect(
      aiAgentCoreRunSchema.safeParse({ projectPath: '', requirement: '做个机器人' }).success,
    ).toBe(true)
    expect(
      aiAgentCoreRunSchema.safeParse({ projectPath: 'x'.repeat(501), requirement: 'a' }).success,
    ).toBe(false)
    // requirement 还是必填：开荒也不能空发一轮
    expect(aiAgentCoreRunSchema.safeParse({ projectPath: '', requirement: '' }).success).toBe(false)
  })

  it('★ 只给能力层三个工具，轮数上限 8，roleNote 是开荒强调句', async () => {
    await runOnboardingTurn({
      win: { webContents: { send: h.send } } as never,
      requirement: '做个签到机器人',
    })
    const passed = h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>
    expect(passed.projectPath).toBe('')
    expect(passed.requirement).toBe('做个签到机器人')
    expect(passed.maxRounds).toBe(ONBOARDING_MAX_ROUNDS)
    expect(passed.roleNote).toBe('开荒强调句')
    const names = (passed.tools as ToolDef[]).map(t => t.name).sort()
    expect(names).toEqual(['describe_capability', 'propose_capability', 'search_capabilities'])
    // 记忆/插话/溢出/审批都不参与：它们都以 projectPath 为键，空串会拼出 cwd 里的路径
    for (const key of ['history', 'session', 'spill', 'inbox', 'compaction', 'approval']) {
      expect(key in passed, key).toBe(false)
    }
  })

  it('★ 事件形状与主链路一致：thinking → step → chunk → toolCall → response → idle', async () => {
    h.runAgentTurn.mockImplementation(async (input: Record<string, unknown>) => {
      ;(input.onStep as (i: { step: number; maxSteps: number }) => void)({ step: 1, maxSteps: 8 })
      ;(input.onTextChunk as (s: string) => void)('好的')
      ;(input.onReasoningChunk as (s: string) => void)('想一下')
      const call = { id: 'c1', name: 'search_capabilities', args: { query: '签到' } }
      ;(input.onToolStart as (c: unknown) => void)(call)
      ;(input.onToolEnd as (c: unknown, o: string) => void)(call, '[]')
      return RESULT
    })
    const res = await runOnboardingTurn({
      win: { webContents: { send: h.send } } as never,
      requirement: '做个签到机器人',
    })
    expect(res).toMatchObject({ ok: true, finalText: '好的' })
    expect(channels()).toEqual([
      'ai:agentState',
      'ai:agentStep',
      'ai:chunk',
      'ai:chunk',
      'ai:toolCall',
      'ai:toolCall',
      'ai:response',
      'ai:agentState',
    ])
    // 空 projectPath 显式写出来：渲染层 routeTo('') = "当前视图"，这正是开荒要的
    for (const channel of [
      'ai:agentState',
      'ai:chunk',
      'ai:agentStep',
      'ai:toolCall',
      'ai:response',
    ]) {
      for (const p of payloads(channel)) expect(p.projectPath).toBe('')
    }
    expect(payloads('ai:chunk')[1]).toMatchObject({ text: '想一下', kind: 'reasoning' })
    expect(payloads('ai:agentStep')[0]).toMatchObject({ step: 1, maxSteps: 8 })
    expect(payloads('ai:toolCall')[0]).toMatchObject({
      id: 'c1',
      name: 'search_capabilities',
      args: { query: '签到' },
      status: 'running',
    })
    expect(payloads('ai:toolCall')[1]).toMatchObject({ status: 'done', result: '[]' })
    expect(payloads('ai:agentState').map(p => p.state)).toEqual(['thinking', 'idle'])
  })

  it('工具失败按前缀判 error（循环里失败是返回值，不是异常）', async () => {
    h.runAgentTurn.mockImplementation(async (input: Record<string, unknown>) => {
      const call = { id: 'c2', name: 'search_capabilities', args: {} }
      ;(input.onToolStart as (c: unknown) => void)(call)
      ;(input.onToolEnd as (c: unknown, o: string) => void)(call, '[工具失败] 目录不存在')
      return RESULT
    })
    await runOnboardingTurn({ win: { webContents: { send: h.send } } as never, requirement: 'x' })
    expect(payloads('ai:toolCall')[1].status).toBe('error')
  })

  it('★ 有提议就只发提案、不发正文（卡片接手收尾）', async () => {
    h.runAgentTurn.mockImplementation(async (input: Record<string, unknown>) => {
      const propose = (input.tools as ToolDef[]).find(t => t.name === 'propose_capability')
      expect(propose, 'propose_capability 没交给循环').toBeTruthy()
      await propose!.run({ capabilityId: 'project.create', args: { name: '签到机器人' } }, {})
      return RESULT
    })
    const res = await runOnboardingTurn({
      win: { webContents: { send: h.send } } as never,
      requirement: '做个签到机器人',
    })
    expect(res.ok).toBe(true)
    const sent = payloads('ai:proposal')
    expect(sent).toHaveLength(1)
    const proposal = sent[0].proposal as {
      summary: string
      operations: unknown[]
      riskLevel: string
    }
    expect(proposal.summary).toBe('做个签到机器人')
    expect(proposal.operations).toHaveLength(1)
    // 没有画布可校验：不传 validation/verdict（卡片显示"未校验"是事实）
    expect((proposal as Record<string, unknown>).validation).toBeUndefined()
    expect((proposal as Record<string, unknown>).verdict).toBeUndefined()
    expect(channels()).not.toContain('ai:response')
    expect(channels().at(-1)).toBe('ai:agentState')
  })

  it('没有模型配置 → ok:false + ai:error，不空跑一轮', async () => {
    h.resolveConfig.mockResolvedValue(null)
    const res = await runOnboardingTurn({ win: null, requirement: 'x' })
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: string }).error).toContain('没有可用的模型配置')
    expect(h.runAgentTurn).not.toHaveBeenCalled()
    // 没有窗口时事件静默丢弃，但状态机该走的还是走（不抛）
    expect(h.send).not.toHaveBeenCalled()
  })

  it('★ 工具表为空 → 明确报装配错，不让模型"什么都不能做"', async () => {
    h.adaptLegacyTools.mockReturnValue([])
    const res = await runOnboardingTurn({
      win: { webContents: { send: h.send } } as never,
      requirement: 'x',
    })
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: string }).error).toContain('开荒工具集为空')
    expect(payloads('ai:error')).toHaveLength(1)
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('循环抛错 → ai:error + idle（界面不会一直转圈）', async () => {
    h.runAgentTurn.mockRejectedValue(new Error('厂商 403'))
    const res = await runOnboardingTurn({
      win: { webContents: { send: h.send } } as never,
      requirement: 'x',
    })
    expect(res).toMatchObject({ ok: false, error: '厂商 403' })
    expect(payloads('ai:error')[0].message).toBe('厂商 403')
    expect(payloads('ai:agentState').at(-1)?.state).toBe('idle')
  })
})
