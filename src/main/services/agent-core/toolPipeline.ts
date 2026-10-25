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
import {
  type ChatTurn,
  type GateRequest,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolResultEntry,
} from './core'
import { approvalRequestOf } from './toolGate'
import type { BatchCommit, BatchPipeline, BatchPrepared } from '../../vendor/dsh/tool-batch/batch'
import {
  cancellationText,
  composeWaterfall,
  failClosedMode,
  failureMessageFromText,
  isAborted,
  TOOL_ABORTED_BEFORE_DISPATCH_TEXT,
  toolErrorMessage,
  type ToolExecutionMode,
  type Waterfall,
} from '../../vendor/dsh/tool-pipeline/pipeline'
import type { PlannedExec, ToolSlot } from './scheduler'
import { executeToolCall, executionModeOf } from './scheduler'

/** prepare 钩子拿到的调用摘要（args 是**快照**：钩子改它不影响真正传给工具的参数） */
export interface PreExecuteInput {
  callId: string
  name: string
  args: Record<string, unknown>
}

/**
 * prepare 的三态：放行 / 拒绝（给模型看的理由） / 要审批。
 *
 * `ask` 不再是一句"暂不支持"：它现在走**同一道**审批闸门（`ctx.gate`），
 * 与工具自己声明的 `approval` 汇到一处 —— 钩子要不要问人，和工具要不要问人，
 * 不该是两套机制。
 */
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

/** 闸门请求的一句话（"写哪个文件 / 跑什么命令 / 哪个工具"） */
function describeGate(req: GateRequest): string {
  if (req.kind === 'write') return '写 ' + req.path
  if (req.kind === 'command') return '命令 ' + req.command
  return '工具 ' + req.tool
}

/** 拒绝文案：与闸门搬进 prepare 之前**逐字相同**（模型文案与历史测试都对得上） */
function rejectedText(req: GateRequest): string {
  if (req.kind === 'write') return '写操作被拒绝（未通过闸门）'
  if (req.kind === 'command') return '命令被拒绝（未通过闸门）'
  return '工具 ' + req.tool + ' 被拒绝（未通过闸门）'
}

/** 一次审批的结果：放行，或者"回灌给模型的那句失败" */
type GateOutcome = { allow: true } | { allow: false; text: string }

/**
 * 过闸门（**唯一**一处调用 `ctx.gate` 的地方）。三条纪律：
 * ① 没有闸门 = 没人可问：需要审批的调用**不擅自执行**；
 * ② 闸门抛异常（角色的写域拒绝就是这么拒的）→ `[工具失败] <原因>`，与旧路径"run 里 throw"一致；
 * ③ 拒绝 → 一句可按类别对账的话；`[工具失败]` 前缀让模型知道这条路走不通。
 */
async function askGate(ctx: ToolContext, req: GateRequest): Promise<GateOutcome> {
  const gate = ctx.gate
  if (!gate) {
    return {
      allow: false,
      text: FAILURE_PREFIX + '没有可用的审批通道，这次调用没有执行：' + describeGate(req),
    }
  }
  try {
    if (await gate(req)) return { allow: true }
  } catch (error: unknown) {
    // 角色写域用的是 throw（原因里带"这是谁的活、怎么才能做"），不能被吞成一句"未通过闸门"
    return { allow: false, text: FAILURE_PREFIX + toolErrorMessage(error) }
  }
  return { allow: false, text: FAILURE_PREFIX + rejectedText(req) }
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
  // 声明了 isConcurrencySafe 走 fail-closed；没声明才沿用 scheduler 的保守推断（不重复实现）
  if (tool?.isConcurrencySafe) return failClosedMode(tool.isConcurrencySafe, args)
  return executionModeOf(tool)
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
      const tool = deps.tools.find(t => t.name === exec.name)
      // 未知工具是"一条失败结果"，不是整轮崩溃：模型拼错名字时要能在界面上看见
      if (!tool) {
        return {
          kind: 'settled',
          slot: failedSlot(FAILURE_PREFIX + '未知工具: ' + exec.name, exec.startedAt),
        }
      }
      // ① 前钩子：可以拒绝，也可以点名"这条要人点头"（ask 与工具自己声明的审批走同一个口子）
      if (before.length > 0) {
        const decide = composeWaterfall<PreExecuteInput, PreExecuteDecision>(before, async () => ({
          kind: 'allow',
        }))
        const decision = await decide({
          callId: exec.callId,
          name: exec.name,
          args: snapshotArgs(exec.call.args),
        })
        if (decision.kind === 'deny') {
          return {
            kind: 'settled',
            slot: failedSlot(FAILURE_PREFIX + decision.reason, exec.startedAt),
          }
        }
        if (decision.kind === 'ask') {
          // 钩子都说"要人"了：没有审批通道时 fail-closed（不擅自替人放行）
          const outcome = await askGate(deps.ctx, {
            kind: 'tool',
            tool: exec.name,
            args: snapshotArgs(exec.call.args),
          })
          if (!outcome.allow) {
            return { kind: 'settled', slot: failedSlot(outcome.text, exec.startedAt) }
          }
        }
      }
      // ② 审批：工具声明优先，没声明按 category 保守推断（mutation 一律要问）
      const args = exec.call.args ?? {}
      let approval: GateRequest | null
      try {
        approval = approvalRequestOf(tool, args, deps.ctx)
      } catch (error: unknown) {
        // 声明里就抛的（比如路径越界）：不派发，原因照旧回灌给模型
        return {
          kind: 'settled',
          slot: failedSlot(FAILURE_PREFIX + toolErrorMessage(error), exec.startedAt),
        }
      }
      /**
       * 没有闸门 = 调用方没接审批（脚本 / 测试的旧形态）—— 保持旧行为：不问人，直接跑。
       * 一旦接了闸门，声明要审批的调用就必须过：这是本批唯一的语义变化
       * （插件工具标着 mutation 却从不问人，就是靠这一点修掉的）。
       */
      if (approval && deps.ctx.gate) {
        const outcome = await askGate(deps.ctx, approval)
        if (!outcome.allow) {
          return { kind: 'settled', slot: failedSlot(outcome.text, exec.startedAt) }
        }
      }
      return { kind: 'dispatch' }
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
