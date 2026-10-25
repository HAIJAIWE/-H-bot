// src/main/services/agent-core/scheduler.ts
//
// **一批工具调用怎么跑** —— 算法本身搬自上游 `packages/core/tools/src/batch.ts`
// （见 `src/main/vendor/dsh/tool-batch/batch.ts`），这里只做「我们的工具 → 上游调度器」的适配：
// 工具从哪找、结果怎么落盘/落界面/回灌模型、取消时补什么样的合成结果。
//
// 上游的规则（不再自己发明）：
//   ① 独占调用是**屏障**；② 可并行调用走**有界滚动池**，启动前重新分类；
//   ③ 结果**按模型给的顺序**提交；④ 取消：不再起新的，已起的排空并提交，
//   剩下的每个调用补一条**合成失败结果**（重放才完整 —— 之前这里是空的）。
import type { ToolFailure } from '@shared/ai/toolFailure'
import { classifyToolFailure, toolFailureForCode } from '@shared/ai/toolFailure'
import type { ChatTurn, Tool, ToolCall, ToolContext, ToolResultEntry } from './core'
import { normalizeToolOutcome, withTimeout } from './core'
import type { BatchCommit, BatchPipeline } from '../../vendor/dsh/tool-batch/batch'
import { executeToolBatch } from '../../vendor/dsh/tool-batch/batch'

/** 一个工具调用的落地结果（调度器内部用；适配层 toolPipeline.ts 也要读） */
export interface ToolSlot {
  output: string
  ok: boolean
  failure?: ToolFailure
  /** 这次调用的开始时刻（trace 里的 ms 靠它：并行时不能拿批次时刻算） */
  startedAt: number
  /** 这条结果是否要求本轮到此为止（上游 `concludesTurn`） */
  concludesTurn?: boolean
}

/** 调度器需要的"落地出口"（由循环注入；调度器自己不碰文件/窗口） */
export interface ToolGroupDeps {
  ctx: ToolContext
  tools: Tool[]
  /** 回灌给模型的对话（按模型顺序追加） */
  messages: ChatTurn[]
  /** 诊断用的调用结果（按模型顺序追加） */
  results: ToolResultEntry[]
  maxParallel: number
  isAborted: () => boolean
  /** 模型看到的结果（可能先落盘再给节选，见 toolOutput 的 modelFacingOutput） */
  modelFacing: (name: string, output: string) => Promise<string>
  onToolStart?: (call: ToolCall) => void
  onToolResult?: (call: ToolCall, output: string, ok?: boolean, failure?: ToolFailure) => void
  trace?: (event: { kind: 'tool'; name: string; ms: number; ok: boolean }) => void
  appendSession?: (turn: { role: 'tool'; content: string }) => Promise<void>
}

/** 工具的执行模式：显式声明优先，否则按 category **保守**推断（未知 = 独占） */
export function executionModeOf(tool: Tool | undefined): 'parallel' | 'exclusive' {
  if (!tool) return 'exclusive' // 未知工具不并行：它可能根本不是只读工具
  return tool.executionMode ?? (tool.category === 'query' ? 'parallel' : 'exclusive')
}

/**
 * 执行**一个**工具调用：绝不抛错 —— 失败也变成一条 `[工具失败] …` 的结果。
 *
 * 抽出来是因为并行池里每个调用各跑一份：错误处理只要还在调用点里写一遍，
 * 并行路径迟早出现"某条分支忘了 catch"的漏网（而漏网的那条会让整轮挂掉）。
 */
export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
  tools: readonly Tool[],
): Promise<{ output: string; ok: boolean; failure?: ToolFailure; concludesTurn?: boolean }> {
  const tool = tools.find(t => t.name === call.name)
  let output: string
  let ok: boolean
  let failure: ToolFailure | undefined
  let concludesTurn: boolean | undefined
  try {
    if (!tool) throw new Error('未知工具: ' + call.name)
    const raw = await (tool.timeoutMs
      ? withTimeout(tool.run(call.args, ctx), tool.timeoutMs)
      : tool.run(call.args, ctx))
    const outcome = normalizeToolOutcome(raw)
    output = outcome.text
    // 显式 ok 优先；没给才回退到前缀（兼容只有字符串的老工具）
    ok = outcome.ok ?? !output.startsWith('[工具失败]')
    if (outcome.concludesTurn === true) concludesTurn = true
    if (!ok) {
      // 显式 code 优先（工具自己知道原因）；否则按文本启发式分类
      failure = outcome.error ? toolFailureForCode(outcome.error.code) : classifyToolFailure(output)
    }
  } catch (e) {
    output = '[工具失败] ' + (e instanceof Error ? e.message : String(e))
    ok = false
    failure = classifyToolFailure(output)
  }
  return {
    output,
    ok,
    ...(failure ? { failure } : {}),
    ...(concludesTurn ? { concludesTurn } : {}),
  }
}

/** 取消时补的那条结果：与上游 executor 的 TOOL_ABORTED_BEFORE_DISPATCH 同一句 */
const ABORTED_TEXT = '[工具失败] Error: tool call aborted before dispatch'

/** 调度器眼里的一个调用（含原始 ToolCall；适配层 prepare/dispatch 要用） */
export interface PlannedExec {
  callId: string
  name: string
  call: ToolCall
  /** 在本次 remaining 里的下标（做 id 兜底与 trace 用） */
  index: number
  startedAt: number
}

/**
 * 跑**一组**工具调用（从 `from` 开始）：独占屏障，或可并行调用走有界滚动池。
 *
 * @returns consumed 这一组真正启动了几个（调用方据此接着处理剩下的）；
 *          aborted 是否被取消；concluded 是否有工具要求本轮结束
 */
export async function runToolGroup(
  calls: ToolCall[],
  from: number,
  round: number,
  deps: ToolGroupDeps,
): Promise<{ consumed: number; aborted: boolean; concluded: boolean }> {
  const remaining = calls.slice(from)
  const execs: PlannedExec[] = remaining.map((call, index) => ({
    callId: call.id,
    name: call.name,
    call,
    index,
    startedAt: 0,
  }))

  const pipeline: BatchPipeline<PlannedExec, ToolSlot> = {
    executionMode: exec => executionModeOf(deps.tools.find(t => t.name === exec.name)),
    prepare: async () => ({ kind: 'dispatch' }),
    start: exec => {
      /**
       * 工具 id：模型没给（有些厂商只在流里给一次）就**当场补一个稳定 id** ——
       * 开始/结束两条事件必须能对上，否则界面上会多出一行永不结束的"运行中"。
       */
      if (!exec.call.id) exec.call.id = `call-${round}-${from + exec.index}`
      exec.startedAt = Date.now()
      // 先报"开始"再执行：连拼错工具名也要在界面上留下一行（而不是静默跳过）
      deps.onToolStart?.(exec.call)
    },
    dispatch: async exec => {
      const slot = await executeToolCall(exec.call, deps.ctx, deps.tools)
      return { ...slot, startedAt: exec.startedAt }
    },
    complete: async (exec, slot): Promise<BatchCommit> => {
      const call = exec.call
      deps.results.push({
        name: call.name,
        args: call.args ?? {},
        output: slot.output,
        ok: slot.ok,
        ...(slot.failure ? { failure: slot.failure } : {}),
      })
      // 观测：每个工具一行 trace（**带真实耗时**——投影里的 ms 全靠它）；会话日志同时记一条
      deps.trace?.({ kind: 'tool', name: call.name, ms: Date.now() - slot.startedAt, ok: slot.ok })
      if (deps.appendSession) {
        await deps.appendSession({
          role: 'tool',
          content: call.name + ': ' + slot.output.slice(0, 200),
        })
      }
      // 界面/诊断拿**原始**输出（摘要要按真实行数算），模型只拿节选（见 modelFacingOutput）
      deps.onToolResult?.(call, slot.output, slot.ok, slot.failure)
      const facing = await deps.modelFacing(call.name, slot.output)
      /**
       * 带 `toolResult`：provider 会把它变成 `role: 'tool'` + `tool_call_id`，
       * 与上一条 assistant 的 `toolCalls` 配对（见 core 的 push）。
       * `content` 里仍留人看的"[工具 X] 返回…"前缀 —— 走没有原生协议的回退路径时
       * 模型也要看得出这段是数据、不是指令。
       */
      deps.messages.push({
        role: 'tool',
        name: call.name,
        content: facing,
        toolResult: facing,
      })
      return slot.concludesTurn ? { concludesTurn: true } : {}
    },
    /**
     * 取消时**没派发**的调用也要有结果：模型发起的每个 tool_call 都必须配一条 tool 回合，
     * 否则下一轮的 messages 里 assistant(tool_calls) 是悬空的（厂商直接 400）。
     * 不报 onToolStart/onToolResult，也不进 trace —— 界面不该为没跑的东西画一行"已完成"。
     */
    skip: async exec => {
      const call = exec.call
      const failure = toolFailureForCode('cancelled')
      deps.results.push({
        name: call.name,
        args: call.args ?? {},
        output: ABORTED_TEXT,
        ok: false,
        failure,
      })
      deps.messages.push({
        role: 'tool',
        name: call.name,
        content: ABORTED_TEXT,
        toolResult: ABORTED_TEXT,
      })
    },
  }

  return executeToolBatch(
    { execs, signal: deps.ctx.signal, maxParallel: deps.maxParallel },
    pipeline,
  )
}
