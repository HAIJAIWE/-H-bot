// tests/main/services/agent-core/toolTimeout.test.ts
//
// # 工具超时语义（2026-10-26，第 55 批，对齐上游 guard/timeout-policy）
//
// 要钉死的五条：
//   ① 声明了 `timeoutMs`：到点**既**硬停兜底，**也**让工具看到的 signal 进入 aborted；
//   ② 提前跑完：不许被 abort（deadline 只影响它自己的 signal）；
//   ③ 没声明 `timeoutMs`：原样调用，连 signal 对象都不换（脚本/测试的既有行为）；
//   ④ 工具自己抛的错：原样上抛，不许被误报成超时；
//   ⑤ 外层（用户点停止）的 signal：原样传进去；超时与取消在文案上是两件事。
import { describe, it, expect } from 'vitest'
import { runToolWithDeadline, toolTimeoutMessage } from '@main/services/agent-core/toolTimeout'
import {
  runAgentLoop,
  type Tool,
  type ToolCall,
  type ToolRunOutcome,
} from '@main/services/agent-core/core'
import type { ToolContext } from '@main/services/agent-core/toolGate'

const ctx = (signal?: AbortSignal): ToolContext => ({
  workspace: 'C:/proj',
  ...(signal ? { signal } : {}),
})

const tool = (
  opts: { timeoutMs?: number },
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolRunOutcome>,
): Tool => ({
  name: 't',
  description: 't',
  category: 'query',
  ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  run,
})

describe('★ runToolWithDeadline：超时 = 派生 signal + 硬停兜底', () => {
  it('★ 挂起的工具按超时失败收尾，工具看到的 signal 也 aborted', async () => {
    let seen: AbortSignal | undefined
    const t = tool({ timeoutMs: 20 }, (_args, c) => {
      seen = c.signal
      return new Promise<string>(() => undefined)
    })
    await expect(runToolWithDeadline(t, {}, ctx())).rejects.toThrow(toolTimeoutMessage(20))
    expect(seen?.aborted).toBe(true)
  })

  it('★ 提前跑完的不会被 abort（超时计时器只影响派生 signal）', async () => {
    let seen: AbortSignal | undefined
    const t = tool({ timeoutMs: 500 }, async (_args, c) => {
      seen = c.signal
      return 'OK'
    })
    await expect(runToolWithDeadline(t, {}, ctx())).resolves.toBe('OK')
    expect(seen?.aborted).toBe(false)
  })

  it('★ 没声明 timeoutMs：原样调用，ctx.signal 还是同一个对象', async () => {
    const outer = new AbortController()
    const t = tool({}, async (_args, c) => (c.signal === outer.signal ? 'same' : 'diff'))
    await expect(runToolWithDeadline(t, {}, ctx(outer.signal))).resolves.toBe('same')
  })

  it('★ 工具自己抛的错原样保留（不许统一报"超时"）', async () => {
    const t = tool({ timeoutMs: 1000 }, async () => {
      throw new Error('boom')
    })
    await expect(runToolWithDeadline(t, {}, ctx())).rejects.toThrow('boom')
  })

  it('★ 外层 signal 已 aborted：照样传进去（取消而不是超时）', async () => {
    const outer = new AbortController()
    outer.abort()
    let seen: AbortSignal | undefined
    const t = tool({ timeoutMs: 1000 }, async (_args, c) => {
      seen = c.signal
      return 'ran'
    })
    await expect(runToolWithDeadline(t, {}, ctx(outer.signal))).resolves.toBe('ran')
    expect(seen?.aborted).toBe(true)
  })

  it('文案唯一真源：toolTimeoutMessage(N) 与超时抛出的消息一致', () => {
    expect(toolTimeoutMessage(1500)).toBe('工具执行超时（1500ms）')
  })
})

describe('★ 循环集成：超时结果的结构化失败码', () => {
  it('★ output 带超时文案、failure.code=timeout、整轮正常收尾', async () => {
    const t = tool({ timeoutMs: 20 }, () => new Promise<string>(() => undefined))
    const res = await runAgentLoop({
      workspace: 'C:/proj',
      tools: [t],
      model: async () => ({
        calls: [{ id: 'c1', name: 't', args: {} }] as ToolCall[],
      }),
      maxRounds: 1,
    })
    expect(res.toolResults[0].output).toContain(toolTimeoutMessage(20))
    expect(res.toolResults[0].failure?.code).toBe('timeout')
    expect(res.phase.kind).toBe('finished')
  })
})
