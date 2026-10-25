// tests/main/services/agent-core/toolPipeline.test.ts
//
// 第 45 批：工具执行适配层（prepare / dispatch / complete）。这里钉的是**语义**：
// 未知工具是一条失败结果、钩子能拒能拦、取消在派发前后各有各的文案。
import { describe, expect, it } from 'vitest'
import type {
  ChatTurn,
  GateRequest,
  Tool,
  ToolContext,
  ToolResultEntry,
} from '@main/services/agent-core/core'
import type { PlannedExec, ToolSlot } from '@main/services/agent-core/scheduler'
import {
  createToolPipeline,
  type ToolPipelineDeps,
  type ToolPipelineHooks,
} from '@main/services/agent-core/toolPipeline'
import { executeToolBatch } from '@main/vendor/dsh/tool-batch/batch'

function makeTool(name: string, run: Tool['run'], extra: Partial<Tool> = {}): Tool {
  return { name, description: name, run, ...extra }
}

function makeExec(
  call: { id?: string; name: string; args?: Record<string, unknown> },
  index = 0,
): PlannedExec {
  const planned = { id: call.id ?? 'call-1', name: call.name, args: call.args ?? {} }
  return { callId: planned.id, name: planned.name, call: planned, index, startedAt: 0 }
}

interface HarnessOptions {
  tools: Tool[]
  signal?: AbortSignal
  hooks?: ToolPipelineHooks
  onToolResult?: (output: string, ok?: boolean) => void
  /** 动作闸门（第 46 批：审批只在 prepare 里过一次） */
  gate?: ToolContext['gate']
}

/** 一个最小的"落地出口"：真实实现是 scheduler 的 commitSlot，这里只记事实 */
function makeHarness(options: HarnessOptions) {
  const messages: ChatTurn[] = []
  const results: ToolResultEntry[] = []
  const started: string[] = []
  const completed: Array<{ output: string; ok: boolean }> = []
  const ctx: ToolContext = {
    workspace: '/tmp',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.gate ? { gate: options.gate } : {}),
  }
  const deps: ToolPipelineDeps = {
    tools: options.tools,
    ctx,
    messages,
    results,
    round: 2,
    from: 1,
    onToolStart: call => started.push(call.name),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    complete: async (exec, slot) => {
      results.push({
        name: exec.name,
        args: exec.call.args ?? {},
        output: slot.output,
        ok: slot.ok,
        ...(slot.failure ? { failure: slot.failure } : {}),
      })
      completed.push({ output: slot.output, ok: slot.ok })
      options.onToolResult?.(slot.output, slot.ok)
      messages.push({
        role: 'tool',
        name: exec.name,
        content: slot.output,
        toolResult: slot.output,
      })
      return slot.concludesTurn ? { concludesTurn: true } : {}
    },
  }
  return { pipeline: createToolPipeline(deps), messages, results, started, completed, ctx }
}

describe('toolPipeline：executionMode（isConcurrencySafe fail-closed）', () => {
  it('声明了 isConcurrencySafe 就只认字面 true；没声明退回 category 推断', () => {
    const safe = (args: Record<string, unknown>) => args.ok === true
    const strict = makeTool('strict', async () => 'ok', {
      category: 'mutation',
      isConcurrencySafe: safe,
    })
    const inferred = makeTool('inferred', async () => 'ok', { category: 'query' })
    const harness = makeHarness({ tools: [strict, inferred] })
    const modeOf = (name: string, args: Record<string, unknown> = {}) =>
      harness.pipeline.executionMode(makeExec({ name, args }))
    expect(modeOf('strict', { ok: true })).toBe('parallel')
    expect(modeOf('strict', { ok: 'true' })).toBe('exclusive')
    expect(modeOf('inferred')).toBe('parallel')
  })

  it('isConcurrencySafe 抛错时 fail-closed（不并行）', () => {
    const tool = makeTool('boom', async () => 'ok', {
      category: 'query',
      isConcurrencySafe: () => {
        throw new Error('判定坏了')
      },
    })
    const harness = makeHarness({ tools: [tool] })
    expect(harness.pipeline.executionMode(makeExec({ name: 'boom' }))).toBe('exclusive')
  })
})

describe('toolPipeline：prepare', () => {
  it('未知工具 → settled 失败结果（不 throw），模型拿到"[工具失败] 未知工具: x"', async () => {
    const harness = makeHarness({ tools: [] })
    const exec = makeExec({ id: 'c1', name: 'x', args: { a: 1 } })
    const outcome = await executeToolBatch({ execs: [exec], maxParallel: 2 }, harness.pipeline)
    expect(outcome.consumed).toBe(1)
    expect(harness.started).toEqual(['x'])
    expect(harness.results).toHaveLength(1)
    expect(harness.results[0]?.output).toBe('[工具失败] 未知工具: x')
    expect(harness.messages[0]?.content).toBe('[工具失败] 未知工具: x')
  })

  it('beforeExecute deny → settled + 理由，且不调 tool.run', async () => {
    let runs = 0
    const tool = makeTool('write_file', async () => {
      runs += 1
      return 'done'
    })
    const harness = makeHarness({
      tools: [tool],
      hooks: {
        beforeExecute: [async () => ({ kind: 'deny', reason: '不允许写盘' })],
      },
    })
    const outcome = await executeToolBatch(
      { execs: [makeExec({ name: 'write_file' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(outcome.consumed).toBe(1)
    expect(runs).toBe(0)
    expect(harness.results[0]?.output).toBe('[工具失败] 不允许写盘')
  })

  it('deny 时 onToolResult 收到 ok:false（界面看得见这条拒绝）', async () => {
    const seen: Array<{ output: string; ok?: boolean }> = []
    const harness = makeHarness({
      tools: [makeTool('write_file', async () => 'done')],
      hooks: {
        beforeExecute: [async () => ({ kind: 'deny', reason: '风险太高' })],
      },
      onToolResult: (output, ok) => seen.push({ output, ok }),
    })
    await executeToolBatch(
      { execs: [makeExec({ name: 'write_file' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(seen).toEqual([{ output: '[工具失败] 风险太高', ok: false }])
  })
})

describe('toolPipeline：dispatch 的取消语义', () => {
  it('派发前已取消 → before-dispatch 文案，且不调 tool.run', async () => {
    const controller = new AbortController()
    controller.abort()
    let runs = 0
    const tool = makeTool(
      'read_file',
      async () => {
        runs += 1
        return 'x'
      },
      { category: 'query' },
    )
    const harness = makeHarness({ tools: [tool], signal: controller.signal })
    const exec = makeExec({ name: 'read_file' })
    harness.pipeline.start(exec)
    const slot = await harness.pipeline.dispatch(exec)
    expect(slot.output).toBe('[工具失败] Error: tool call aborted before dispatch')
    expect(slot.ok).toBe(false)
    expect(slot.failure?.code).toBe('cancelled')
    expect(runs).toBe(0)
  })

  it('body 跑完才取消、结果成功 → 改判 aborted（保留 startedAt）', async () => {
    const controller = new AbortController()
    const harness = makeHarness({
      tools: [
        makeTool('slow', async () => {
          controller.abort()
          return '跑完了'
        }),
      ],
      signal: controller.signal,
    })
    const exec = makeExec({ name: 'slow' })
    harness.pipeline.start(exec)
    const slot = await harness.pipeline.dispatch(exec)
    expect(slot.output).toBe('[工具失败] Error: tool call aborted')
    expect(slot.ok).toBe(false)
    expect(slot.failure?.code).toBe('cancelled')
    expect(slot.startedAt).toBe(exec.startedAt)
  })

  it('body 跑完才取消、但结果本来就是失败 → 保留工具自己的文案（不覆盖）', async () => {
    const controller = new AbortController()
    const harness = makeHarness({
      tools: [
        makeTool('slow', async () => {
          controller.abort()
          return '[工具失败] 工具自己的错'
        }),
      ],
      signal: controller.signal,
    })
    const exec = makeExec({ name: 'slow' })
    harness.pipeline.start(exec)
    const slot = await harness.pipeline.dispatch(exec)
    expect(slot.output).toBe('[工具失败] 工具自己的错')
    expect(slot.ok).toBe(false)
  })
})

describe('toolPipeline：complete 的 afterExecute', () => {
  it('block → 模型拿到"[工具失败] <feedback>"，且钩子先于 onToolResult', async () => {
    const seen: string[] = []
    const harness = makeHarness({
      tools: [makeTool('read_file', async () => '正常结果', { category: 'query' })],
      hooks: {
        afterExecute: [async () => ({ kind: 'block', feedback: '不许这么干' })],
      },
      onToolResult: output => seen.push(output),
    })
    const exec = makeExec({ name: 'read_file' })
    harness.pipeline.start(exec)
    const slot: ToolSlot = await harness.pipeline.dispatch(exec)
    await harness.pipeline.complete(exec, slot)
    expect(harness.completed).toEqual([{ output: '[工具失败] 不许这么干', ok: false }])
    expect(harness.messages[0]?.content).toBe('[工具失败] 不许这么干')
    expect(seen).toEqual(['[工具失败] 不许这么干'])
  })
})

describe('toolPipeline：审批的单一入口（第 46 批）', () => {
  /** 记录闸门收到的请求；allow=false 用它模拟"人拒绝" */
  function recorder(allow = true) {
    const seen: GateRequest[] = []
    return {
      seen,
      gate: async (req: GateRequest) => {
        seen.push(req)
        return allow
      },
    }
  }

  it('★ 没声明 approval 的 mutation 也要过闸（插件工具以前完全不过）', async () => {
    let runs = 0
    const tool = makeTool(
      'market_coin',
      async () => {
        runs += 1
        return 'heads'
      },
      { category: 'mutation' },
    )
    const { seen, gate } = recorder()
    const harness = makeHarness({ tools: [tool], gate })
    await executeToolBatch(
      { execs: [makeExec({ name: 'market_coin', args: { n: 1 } })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(seen).toEqual([{ kind: 'tool', tool: 'market_coin', args: { n: 1 } }])
    expect(runs).toBe(1)
    expect(harness.results[0]?.ok).toBe(true)
  })

  it('★ mutation 被拒绝 → 不派发，模型拿到"工具 x 被拒绝（未通过闸门）"', async () => {
    let runs = 0
    const tool = makeTool(
      'market_coin',
      async () => {
        runs += 1
        return 'heads'
      },
      { category: 'mutation' },
    )
    const { gate } = recorder(false)
    const harness = makeHarness({ tools: [tool], gate })
    const outcome = await executeToolBatch(
      { execs: [makeExec({ name: 'market_coin' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(outcome.consumed).toBe(1)
    expect(runs).toBe(0)
    expect(harness.results[0]?.output).toBe('[工具失败] 工具 market_coin 被拒绝（未通过闸门）')
    expect(harness.results[0]?.ok).toBe(false)
  })

  it('query 不问人：闸门一次都不调，照跑', async () => {
    const { seen, gate } = recorder()
    const harness = makeHarness({
      tools: [makeTool('read_file', async () => '内容', { category: 'query' })],
      gate,
    })
    await executeToolBatch(
      { execs: [makeExec({ name: 'read_file' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(seen).toEqual([])
    expect(harness.results[0]?.output).toBe('内容')
  })

  it('显式声明优先于 category 推断（同一个 mutation 可以只报 write，不带 args）', async () => {
    const { seen, gate } = recorder()
    const tool = makeTool('write_file', async () => '已写入', {
      category: 'mutation',
      approval: args => ({ kind: 'write', path: String(args.path) }),
    })
    const harness = makeHarness({ tools: [tool], gate })
    await executeToolBatch(
      { execs: [makeExec({ name: 'write_file', args: { path: 'a.txt' } })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(seen).toEqual([{ kind: 'write', path: 'a.txt' }])
  })

  it('★ 声明 approval: () => null ⇒ 不问（旧工具提案制已在界面确认过，别再问一遍）', async () => {
    const { seen, gate } = recorder()
    const tool = makeTool('add_node', async () => '加好了', {
      category: 'mutation',
      approval: () => null,
    })
    const harness = makeHarness({ tools: [tool], gate })
    await executeToolBatch(
      { execs: [makeExec({ name: 'add_node' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(seen).toEqual([])
    expect(harness.results[0]?.ok).toBe(true)
  })

  it('★ 闸门抛异常（角色写域这么拒）→ [工具失败] <原因>，且不派发', async () => {
    let runs = 0
    const tool = makeTool(
      'write_file',
      async () => {
        runs += 1
        return '已写入'
      },
      { category: 'mutation' },
    )
    const harness = makeHarness({
      tools: [tool],
      gate: async () => {
        throw new Error('代码助手不能改 flow.json')
      },
    })
    await executeToolBatch(
      { execs: [makeExec({ name: 'write_file' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(runs).toBe(0)
    expect(harness.results[0]?.output).toBe('[工具失败] 代码助手不能改 flow.json')
    expect(harness.results[0]?.ok).toBe(false)
  })

  it('没有闸门（脚本/测试形态）⇒ 保持旧行为：不问、照跑', async () => {
    let runs = 0
    const harness = makeHarness({
      tools: [
        makeTool(
          'market_coin',
          async () => {
            runs += 1
            return 'heads'
          },
          { category: 'mutation' },
        ),
      ],
    })
    await executeToolBatch(
      { execs: [makeExec({ name: 'market_coin' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(runs).toBe(1)
    expect(harness.results[0]?.output).toBe('heads')
  })

  it('声明 approval 自己抛错（如路径越界）⇒ settled 失败，原因回灌，不派发', async () => {
    let runs = 0
    const tool = makeTool(
      'write_file',
      async () => {
        runs += 1
        return '已写入'
      },
      {
        category: 'mutation',
        approval: () => {
          throw new Error('路径越界: ../x')
        },
      },
    )
    const harness = makeHarness({ tools: [tool], gate: async () => true })
    await executeToolBatch(
      { execs: [makeExec({ name: 'write_file' })], maxParallel: 2 },
      harness.pipeline,
    )
    expect(runs).toBe(0)
    expect(harness.results[0]?.output).toBe('[工具失败] 路径越界: ../x')
  })
})
