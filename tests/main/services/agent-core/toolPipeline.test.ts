// tests/main/services/agent-core/toolPipeline.test.ts
//
// 第 45 批：工具执行适配层（prepare / dispatch / complete）。这里钉的是**语义**：
// 未知工具是一条失败结果、钩子能拒能拦、取消在派发前后各有各的文案。
import { describe, expect, it } from 'vitest'
import type { ChatTurn, Tool, ToolContext, ToolResultEntry } from '@main/services/agent-core/core'
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
        beforeExecute: [
          async () => ({ kind: 'deny', reason: '不允许写盘' }),
        ],
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
