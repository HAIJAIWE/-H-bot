// tests/main/services/agent-core/toolScheduling.test.ts
//
// # 一批工具调用怎么调度（2026-10-20，对齐 DSH 的 tool-calls 调度器）
//
// 四件事必须成立：
//   ① 可并行调用**真的重叠**（不是"看起来并行"）；
//   ② 独占调用是**屏障**（前后都不许和它重叠）；
//   ③ 结果**按模型给的顺序**提交（完成顺序乱，落地顺序不能乱）；
//   ④ 取消后**不再起新的**，已经起的照常提交；没派发的每个调用**补一条合成失败结果**
//      （上游 batch 的 semantics：assistant(tool_calls) 与 tool 回合必须成对，否则下一轮 400）。
import { describe, it, expect } from 'vitest'
import {
  executionModeOf,
  runAgentLoop,
  type ChatTurn,
  type Tool,
  type ToolCall,
  type ToolResultEntry,
} from '@main/services/agent-core/core'
import { runToolGroup } from '@main/services/agent-core/scheduler'

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 记录起止时刻的工具（假工具，不碰磁盘） */
interface Probe {
  name: string
  startAt: number
  endAt: number
}
function probeTool(name: string, ms: number, probes: Probe[], extra: Partial<Tool> = {}): Tool {
  return {
    name,
    description: 'probe ' + name,
    ...(extra.category ? { category: extra.category } : { category: 'query' }),
    ...(extra.executionMode ? { executionMode: extra.executionMode } : {}),
    async run() {
      const entry: Probe = { name, startAt: Date.now(), endAt: 0 }
      probes.push(entry)
      await delay(ms)
      entry.endAt = Date.now()
      return 'done:' + name
    },
  }
}

/** 只跑一轮工具、第二轮给纯文本 */
function modelOnce(calls: ToolCall[]) {
  let round = 0
  return async () => {
    round += 1
    return round === 1 ? { text: '', calls } : { text: 'finished' }
  }
}

describe('★ 执行模式：显式声明优先，否则按 category 保守推断', () => {
  it('★ query 默认可并行；mutation / 未知工具默认独占', () => {
    expect(
      executionModeOf({ name: 'q', description: '', category: 'query', run: async () => '' }),
    ).toBe('parallel')
    expect(
      executionModeOf({ name: 'm', description: '', category: 'mutation', run: async () => '' }),
    ).toBe('exclusive')
    // 没标注 category 的工具**不该**被当成安全工具
    expect(executionModeOf({ name: 'u', description: '', run: async () => '' })).toBe('exclusive')
    expect(executionModeOf(undefined)).toBe('exclusive')
    // 显式声明盖过推断（写工具确实可以并行时，由工具自己负责）
    expect(
      executionModeOf({
        name: 'x',
        description: '',
        category: 'mutation',
        executionMode: 'parallel',
        run: async () => '',
      }),
    ).toBe('parallel')
  })
})

describe('★ 可并行调用：真的重叠', () => {
  it('★ 三个各自 60ms 的查询并行跑完 ≈ 60ms，而不是 180ms', async () => {
    const probes: Probe[] = []
    const tools = ['a', 'b', 'c'].map(n => probeTool(n, 60, probes))
    const t0 = Date.now()
    const result = await runAgentLoop({
      workspace: process.cwd(),
      tools,
      model: modelOnce(tools.map((t, i) => ({ id: 'c' + i, name: t.name, args: {} }))),
      maxRounds: 2,
    })
    const elapsed = Date.now() - t0
    expect(result.toolResults.map(r => r.name)).toEqual(['a', 'b', 'c'])
    // 串行下界 180ms；并行上界给足余量（CI 上慢机器也别抖）
    expect(elapsed).toBeLessThan(160)
    // 三个的区间确实重叠（第一个还没结束，后两个就已经开始了）
    expect(probes[1].startAt).toBeLessThan(probes[0].endAt)
    expect(probes[2].startAt).toBeLessThan(probes[0].endAt)
  })

  it('★ maxParallelToolCalls = 1 时退回全串行', async () => {
    const probes: Probe[] = []
    const tools = ['a', 'b', 'c'].map(n => probeTool(n, 30, probes))
    const t0 = Date.now()
    await runAgentLoop({
      workspace: process.cwd(),
      tools,
      maxParallelToolCalls: 1,
      model: modelOnce(tools.map((t, i) => ({ id: 'c' + i, name: t.name, args: {} }))),
      maxRounds: 2,
    })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(85)
    for (let i = 1; i < probes.length; i += 1) {
      expect(probes[i].startAt).toBeGreaterThanOrEqual(probes[i - 1].endAt)
    }
  })
})

describe('★ 独占调用是屏障', () => {
  it('★ 写操作前面的查询跑完之后才轮到它，它跑完才轮到后面的查询', async () => {
    const probes: Probe[] = []
    const q1 = probeTool('q1', 40, probes)
    const m1 = probeTool('m1', 40, probes, { category: 'mutation' })
    const q2 = probeTool('q2', 40, probes)
    await runAgentLoop({
      workspace: process.cwd(),
      tools: [q1, m1, q2],
      model: modelOnce([
        { id: 'a', name: 'q1', args: {} },
        { id: 'b', name: 'm1', args: {} },
        { id: 'c', name: 'q2', args: {} },
      ]),
      maxRounds: 2,
    })
    const at = (n: string) => probes.find(p => p.name === n)!
    // 屏障前：q1 结束之后 m1 才开始
    expect(at('m1').startAt).toBeGreaterThanOrEqual(at('q1').endAt)
    // 屏障后：m1 结束之后 q2 才开始
    expect(at('q2').startAt).toBeGreaterThanOrEqual(at('m1').endAt)
  })
})

describe('★ 提交顺序 = 模型给的顺序（不是完成顺序）', () => {
  it('★ 慢的先给、快的后给：落地顺序仍是 a、b', async () => {
    const probes: Probe[] = []
    const tools = [probeTool('a', 80, probes), probeTool('b', 5, probes)]
    const committed: string[] = []
    const result = await runAgentLoop({
      workspace: process.cwd(),
      tools,
      model: modelOnce([
        { id: 'a', name: 'a', args: {} },
        { id: 'b', name: 'b', args: {} },
      ]),
      onToolResult: call => committed.push(call.name),
      maxRounds: 2,
    })
    // b 先跑完，但 a 没提交之前 b 也不能提交
    expect(probes[1].endAt).toBeLessThan(probes[0].endAt)
    expect(committed).toEqual(['a', 'b'])
    expect(result.toolResults.map(r => r.name)).toEqual(['a', 'b'])
  })
})

describe('★ 取消：不再起新的，已经起的照常提交', () => {
  it('★ 第一个还在跑时取消：第二个从没开始、第一个照常提交，第二个补一条"取消"结果', async () => {
    const probes: Probe[] = []
    const tools = [probeTool('slow', 120, probes), probeTool('never', 10, probes)]
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 30)
    const result = await runAgentLoop({
      workspace: process.cwd(),
      tools,
      signal: ctrl.signal,
      /**
       * 串行（1）才能问出"取消后不再起新的"：并行时第二个在 t=0 就已经派出去了，
       * 那不是漏调度、是"派出时还没取消"。要测的是**取消之后**的补位。
       */
      maxParallelToolCalls: 1,
      model: modelOnce([
        { id: 'a', name: 'slow', args: {} },
        { id: 'b', name: 'never', args: {} },
      ]),
      maxRounds: 2,
    })
    // 真跑过的只有第一个 —— 第二个确实没被派发
    expect(probes.map(p => p.name)).toEqual(['slow'])
    // 但结果里两个都在：第二个是调度器补的合成失败（上游 abort 语义），不是执行出来的
    expect(result.toolResults.map(r => r.name)).toEqual(['slow', 'never'])
    // 第 45 批新语义：第一个 body 跑完时 caller 已经 abort，成功结果改判为 aborted
    expect(result.toolResults[0].failure?.code).toBe('cancelled')
    expect(result.toolResults[0].output).toBe('[工具失败] Error: tool call aborted')
    // 没派发的那个仍是 before dispatch（文案不许变）
    expect(result.toolResults[1].failure?.code).toBe('cancelled')
    expect(result.toolResults[1].output).toBe('[工具失败] Error: tool call aborted before dispatch')
    expect(result.phase).toEqual({ kind: 'finished', reason: 'cancelled' })
  })

  it('★ 取消时补的结果与 assistant 的 toolCalls 一一配对（协议不能悬空）', async () => {
    const probes: Probe[] = []
    const tools = [probeTool('slow', 80, probes), probeTool('never', 5, probes)]
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 20)
    const messages: Array<{ role: string; name?: string; toolResult?: string }> = [
      { role: 'assistant' },
      { role: 'assistant' },
    ]
    const result = await runToolGroup(
      [
        { id: 'a', name: 'slow', args: {} },
        { id: 'b', name: 'never', args: {} },
      ],
      0,
      1,
      {
        ctx: { workspace: process.cwd(), signal: ctrl.signal },
        tools,
        messages: messages as never,
        results: [],
        maxParallel: 1,
        isAborted: () => ctrl.signal.aborted,
        modelFacing: async (_n, out) => out,
      },
    )
    expect(result.consumed).toBe(2)
    expect(result.aborted).toBe(true)
    // 两条 tool 回合都在，第二条写明是取消，而不是"没有结果"
    const toolTurns = messages.filter(m => m.role === 'tool')
    expect(toolTurns.map(m => m.name)).toEqual(['slow', 'never'])
    expect(toolTurns[1].toolResult).toContain('aborted before dispatch')
  })

  it('★ 工具说"到此为止"：本轮结束，不再问模型（上游 concludesTurn）', async () => {
    let asked = 0
    const finishTool: Tool = {
      name: 'finish',
      description: 'finish',
      category: 'query',
      async run() {
        return { text: 'done', concludesTurn: true }
      },
    }
    const result = await runAgentLoop({
      workspace: process.cwd(),
      tools: [finishTool],
      model: async () => {
        asked += 1
        return asked === 1
          ? { text: '', calls: [{ id: 'c', name: 'finish', args: {} }] }
          : { text: 'again' }
      },
      maxRounds: 3,
    })
    expect(asked).toBe(1)
    expect(result.phase).toEqual({ kind: 'finished', reason: 'completed' })
  })
})

describe('★ 接线后：hooks 可选、取消文案不变（第 45 批）', () => {
  it('★ 不传 hooks 时行为与旧版一致：结果/失败标记/回合都照旧', async () => {
    const tools = [probeTool('a', 10, [])]
    const result = await runAgentLoop({
      workspace: process.cwd(),
      tools,
      model: modelOnce([{ id: 'a', name: 'a', args: { q: 1 } }]),
      maxRounds: 2,
    })
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].name).toBe('a')
    expect(result.toolResults[0].args).toEqual({ q: 1 })
    expect(result.toolResults[0].output).toBe('done:a')
    expect(result.toolResults[0].failure).toBeUndefined()
    expect(result.phase).toEqual({ kind: 'finished', reason: 'completed' })
  })

  it('★ 传了 hooks 才会生效：beforeExecute deny → 一条失败结果，工具不跑', async () => {
    let runs = 0
    const tool: Tool = {
      name: 'write_file',
      description: 'write_file',
      category: 'mutation',
      async run() {
        runs += 1
        return 'done'
      },
    }
    const messages: ChatTurn[] = []
    const results: ToolResultEntry[] = []
    await runToolGroup([{ id: 'w', name: 'write_file', args: {} }], 0, 1, {
      ctx: { workspace: process.cwd() },
      tools: [tool],
      messages,
      results,
      maxParallel: 1,
      isAborted: () => false,
      modelFacing: async (_n, out) => out,
      hooks: { beforeExecute: [async () => ({ kind: 'deny', reason: '不该写' })] },
    })
    expect(runs).toBe(0)
    expect(results[0]?.output).toBe('[工具失败] 不该写')
    expect(results[0]?.ok).toBe(false)
    const toolTurns = messages.filter(m => m.role === 'tool')
    expect(toolTurns[0]?.content).toBe('[工具失败] 不该写')
  })

  it('★ 一个都没派发时 skip 文案仍是逐字 before-dispatch', async () => {
    const controller = new AbortController()
    controller.abort()
    const messages: ChatTurn[] = []
    const results: ToolResultEntry[] = []
    await runToolGroup([{ id: 'x', name: 'never', args: {} }], 0, 1, {
      ctx: { workspace: process.cwd(), signal: controller.signal },
      tools: [probeTool('never', 1, [])],
      messages,
      results,
      maxParallel: 1,
      isAborted: () => true,
      modelFacing: async (_n, out) => out,
    })
    const toolTurns = messages.filter(m => m.role === 'tool')
    expect(toolTurns).toHaveLength(1)
    expect(toolTurns[0]?.content).toBe('[工具失败] Error: tool call aborted before dispatch')
    expect(toolTurns[0]?.toolResult).toBe('[工具失败] Error: tool call aborted before dispatch')
    expect(results[0]?.failure?.code).toBe('cancelled')
  })
})
