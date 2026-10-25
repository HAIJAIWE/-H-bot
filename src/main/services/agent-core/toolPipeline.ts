// src/main/services/agent-core/toolPipeline.ts
//
// **一次工具调用的两段式适配层**（第 45 批，语义搬自上游 `ToolExecutionPipeline`）。
// 调度器只决定次序与并发；这里决定「能不能派发」「派发后结果还算不算数」：
//   prepare  : 找不到工具 / beforeExecute 拒绝 → 交一条现成的失败结果（settled，不 throw）
//   dispatch : 跑 executeToolCall，并把取消语义补全（派发前取消 / 跑完才取消但结果 ok 改判）
//   complete : afterExecute（block 换失败文案、accept 换输出）之后，交给 scheduler 的落地出口
//
// 钩子全可选：不传 = 行为与搬之前逐字一致（"跑完才取消"是本批唯一新补的判定）。
// 执行器与模式推断留在 scheduler（改动面小），这里只 import 它们的类型和 executeToolCall；
// 其余依赖（落盘出口、消息、开始回调）由 deps 注入，避免和 core 之间形成更多环。
import { classifyToolFailure, toolFailureForCode } from '@shared/ai/toolFailure'
import type { ChatTurn, Tool, ToolCall, ToolContext, ToolResultEntry } from './core'
import type { BatchCommit, BatchPipeline, BatchPrepared } from '../../vendor/dsh/tool-batch/batch'
import {
  cancellationText,
  composeWaterfall,
  failClosedMode,
  failureMessageFromText,
  isAborted,
  TOOL_ABORTED_BEFORE_DISPATCH_TEXT,
  type ToolExecutionMode,
  type Waterfall,
} from '../../vendor/dsh/tool-pipeline/pipeline'
import type { PlannedExec, ToolSlot } from './scheduler'
import { executeToolCall } from './scheduler'

/** prepare 钩子拿到的调用摘要（args 是**快照**：钩子改它不影响真正传给工具的参数） */
export interface PreExecuteInput {
  callId: string
  name: string
  args: Record<string, unknown>
}

/** prepare 的三态：放行 / 拒绝（给模型看的理由） / 要审批（本批不产生，留接口位） */
export type PreExecuteDecision =
  { kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }

/** complete 钩子看到的工具结果摘要 */
export interface PostExecuteInput {
  name: string
  output: string
  ok: boolean
}

/** complete 的两态：接受（可换输出） / 拦下（换一句失败反馈给模型） */
export type PostExecuteDecision =
  { kind: 'accept'; content?: string } | { kind: 'block'; feedback: string }

/** 前后钩子；数组内按 composeWaterfall 的顺序执行（短路即生效） */
export interface ToolPipelineHooks {
  beforeExecute?: readonly Waterfall<PreExecuteInput, PreExecuteDecision>[]
  afterExecute?: readonly Waterfall<PostExecuteInput, PostExecuteDecision>[]
}

/** 适配层需要的"落地出口"（由 scheduler.runToolGroup 注入；与 ToolGroupDeps 一一对应） */
export interface ToolPipelineDeps {
  tools: readonly Tool[]
  ctx: ToolContext
  /** 回灌模型的对话（skip 补合成结果用） */
  messages: ChatTurn[]
  /** 诊断用的结果（skip 补合成结果用） */
  results: ToolResultEntry[]
  /** 本次 runToolGroup 的轮次与起点（给缺 id 的调用补稳定 callId） */
  round: number
  from: number
  onToolStart?: (call: ToolCall) => void
  /** scheduler 的落地出口（results/trace/session/onToolResult/回灌 messages 都在里面） */
  complete: (exec: PlannedExec, slot: ToolSlot) => Promise<BatchCommit | void>
  hooks?: ToolPipelineHooks
}

/** 取消且**没派发**时补的那条结果：文案必须与旧版逐字相同（历史日志对账用） */
const ABORTED_TEXT = '[工具失败] ' + TOOL_ABORTED_BEFORE_DISPATCH_TEXT
const FAILURE_PREFIX = '[工具失败] '

function failedSlot(output: string, startedAt: number): ToolSlot {
  return { output, ok: false, failure: classifyToolFailure(output), startedAt }
}

/**
 * 取消的结果。`bodyInvoked` = 工具 body 有没有真的跑过：
 * 没跑过说 before dispatch，跑过了说 aborted（上游 toolAbortedResult 的区分）。
 */
function cancelledSlot(startedAt: number, bodyInvoked: boolean): ToolSlot {
  return {
    output: FAILURE_PREFIX + cancellationText(bodyInvoked),
    ok: false,
    failure: toolFailureForCode('cancelled'),
    startedAt,
  }
}

/** 参数快照：structuredClone 失败（含函数/循环引用）就落回原对象 —— 快照是增强，不是前置条件 */
function snapshotArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const input = args ?? {}
  try {
    return structuredClone(input)
  } catch {
    return input
  }
}

/**
 * 一个工具调用的执行模式（上游 fail-closed 规则优先）：
 * 声明了 isConcurrencySafe 就必须当场返回字面 true 才并行；没声明才退回 category 推断。
 */
function executionModeFor(
  tool: Tool | undefined,
  args: Record<string, unknown>,
): ToolExecutionMode {
  if (!tool) return 'exclusive'
  if (tool.isConcurrencySafe) return failClosedMode(tool.isConcurrencySafe, args)
  return tool.executionMode ?? (tool.category === 'query' ? 'parallel' : 'exclusive')
}

/** 把 scheduler 的依赖翻成 vendor 的 BatchPipeline（prepare / dispatch / complete 三段） */
export function createToolPipeline(deps: ToolPipelineDeps): BatchPipeline<PlannedExec, ToolSlot> {
  const before = deps.hooks?.beforeExecute ?? []
  const after = deps.hooks?.afterExecute ?? []
  return {
    executionMode(exec) {
      return executionModeFor(
        deps.tools.find(t => t.name === exec.name),
        exec.call.args ?? {},
      )
    },

    async prepare(exec): Promise<BatchPrepared<ToolSlot>> {
      // 未知工具是"一条失败结果"，不是整轮崩溃：模型拼错名字时要能在界面上看见
      if (!deps.tools.some(t => t.name === exec.name)) {
        return { kind: 'settled', slot: failedSlot(FAILURE_PREFIX + '未知工具: ' + exec.name, 0) }
      }
      if (before.length === 0) return { kind: 'dispatch' }
      const decide = composeWaterfall<PreExecuteInput, PreExecuteDecision>(before, async () => ({
        kind: 'allow',
      }))
      const decision = await decide({
        callId: exec.callId,
        name: exec.name,
        args: snapshotArgs(exec.call.args),
      })
      if (decision.kind === 'allow') return { kind: 'dispatch' }
      if (decision.kind === 'ask') {
        // 审批上移本批不做；没有审批通道时上游也是 fail-closed 拒绝（不擅自放行）
        return {
          kind: 'settled',
          slot: failedSlot(
            FAILURE_PREFIX + `tool "${exec.name}" requires approval (not yet supported)`,
            0,
          ),
        }
      }
      return { kind: 'settled', slot: failedSlot(FAILURE_PREFIX + decision.reason, 0) }
    },

    async dispatch(exec) {
      const startedAt = exec.startedAt
      if (isAborted(deps.ctx.signal)) return cancelledSlot(startedAt, false)
      const slot = await executeToolCall(exec.call, deps.ctx, deps.tools)
      // 上游语义：body 已经开始就绝不放弃 —— 先跑完，再按"取消优先于成功"改判；
      // 本来失败的保留工具自己的文案（取消不该盖掉真正的原因）。
      if (isAborted(deps.ctx.signal) && slot.ok) return cancelledSlot(startedAt, true)
      return { ...slot, startedAt }
    },

    async complete(exec, slot) {
      let finalSlot = slot
      if (after.length > 0) {
        const decide = composeWaterfall<PostExecuteInput, PostExecuteDecision>(after, async () => ({
          kind: 'accept',
        }))
        const decision = await decide({ name: exec.name, output: slot.output, ok: slot.ok })
        if (decision.kind === 'block') {
          finalSlot = failedSlot(
            FAILURE_PREFIX + failureMessageFromText(decision.feedback),
            slot.startedAt,
          )
        } else if (decision.content !== undefined) {
          finalSlot = { ...slot, output: decision.content }
        }
      }
      // 钩子改判发生在 scheduler 的 onToolResult / 回灌 messages **之前**：
      // 界面显示的就是最终喂给模型的那句话（测试里钉死顺序）。
      return deps.complete(exec, finalSlot)
    },

    start(exec) {
      /** 模型没给 id（有些厂商只在流里给一次）就补一个稳定 id —— 开始/结束事件要对得上 */
      if (!exec.call.id) exec.call.id = `call-${deps.round}-${deps.from + exec.index}`
      exec.startedAt = Date.now()
      // 先报"开始"再执行：连拼错工具名也要在界面上留下一行（而不是静默跳过）
      deps.onToolStart?.(exec.call)
    },

    /** 取消时没派发的调用也要有结果（否则 assistant(tool_calls) 悬空，厂商直接 400） */
    async skip(exec) {
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
}
