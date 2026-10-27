// src/main/services/agent-runtime/index.ts
//
// **第 62 批（P1 第一步）：AgentRuntime 缝**。
//
// 目的：把「驱动一轮 agent 运行」从 Electron/IPC 里独立出来。宿主要做的事只有两件——
//   · `emit(event)`：运行时把"在干什么"推给你，送到 IPC / WebSocket / 日志 / 丢弃，运行时不管；
//   · `approval(req)`：要写盘/跑命令时问一句，默认拒绝（不传就一律拒）。
// 运行时自己不碰 BrowserWindow / ipcMain / app —— 这条由 `tests/guards/agentRuntimeElectronFree.test.ts` 钉死。
//
// **本批只引入缝，行为零变更**：实现就是 `runAgentTurn` 的薄包装，事件名到回调的映射而已。
// 下一批（P1 第二步）把 `aiAgentCore.ts` 里的一轮运行体真正搬进这个目录，届时宿主对
// "旧链路"的依赖只剩这两个回调。
import type { LlmConfig } from '../ai/llm'
import type { AiRunStats } from '@shared/types/ai'
import type { ApprovalRequest } from '../agent-core/contracts'
import type { ToolCall } from '../agent-core/core'
import type { CompactionOutcome } from '../agent-core/contextGate'
import { runAgentTurn, type RunTurnInput, type RunTurnResult } from '../agent-core/runTurn'

/** 运行时推给宿主的帧。字段刻意少：宿主需要什么，再加什么（加之前先问"这是不是契约"）。 */
export type AgentRuntimeEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'step'; index: number; total: number }
  | { type: 'work/start'; call: ToolCall }
  | { type: 'work/end'; call: ToolCall; output: string; ok?: boolean }
  | { type: 'stats'; stats: AiRunStats }
  | { type: 'compacted'; info: CompactionOutcome }

/** 宿主侧接口：运行时只认这两个洞，其它一切都由 input 显式注入。 */
export interface AgentRuntimeHost {
  emit(event: AgentRuntimeEvent): void
  /** 审批：默认拒绝。签名与 `RunTurnInput.approval` 同（P1 第三步再抽成独立契约）。 */
  approval?: (req: ApprovalRequest, signal?: AbortSignal) => Promise<boolean>
}

/**
 * 一轮运行需要的输入 = `RunTurnInput` 去掉"流式观测"那组回调。
 *
 * 为什么去掉：那些回调是**宿主的事**，运行时统一翻译成事件流 —— 这样宿主换一种传输
 * （IPC / WS / 子进程管道）不用改运行时，运行时也不许假设宿主怎么显示。
 * 其余字段（trace/session/spill/inbox/tools/planOnly…）保持原样透传：它们描述的是
 * 这一轮"用哪个服务"，不是"怎么展示"。
 */
export type AgentRuntimeTurnInput = Omit<
  RunTurnInput,
  | 'onTextChunk'
  | 'onReasoningChunk'
  | 'onStep'
  | 'onToolStart'
  | 'onToolEnd'
  | 'onStats'
  | 'onCompact'
>

/** 结果与 `runAgentTurn` 同形（本批不另造一层；将来加完 dispose/cancel 再升版本）。 */
export type AgentRuntimeResult = RunTurnResult

export interface AgentRuntime {
  runTurn(input: AgentRuntimeTurnInput): Promise<AgentRuntimeResult>
}

/**
 * 建一个运行时。宿主拿到的对象只依赖自己的 `emit`/`approval`，不依赖 Electron。
 *
 * 用法（一个假宿主就能把整轮跑完，不需要窗口）：
 * ```ts
 * const runtime = createAgentRuntime({ emit: e => console.log(e) })
 * await runtime.runTurn({ projectPath, requirement, config })
 * ```
 */
export function createAgentRuntime(host: AgentRuntimeHost): AgentRuntime {
  return {
    async runTurn(input) {
      return runAgentTurn({
        ...input,
        ...(host.approval ? { approval: host.approval } : {}),
        onTextChunk: text => host.emit({ type: 'text', delta: text }),
        onReasoningChunk: text => host.emit({ type: 'reasoning', delta: text }),
        onStep: info => host.emit({ type: 'step', index: info.step, total: info.maxSteps }),
        onToolStart: call => host.emit({ type: 'work/start', call }),
        onToolEnd: (call, output, ok) =>
          host.emit({ type: 'work/end', call, output, ...(ok === undefined ? {} : { ok }) }),
        onStats: stats => host.emit({ type: 'stats', stats }),
        onCompact: info => host.emit({ type: 'compacted', info }),
      })
    },
  }
}

/** 给宿主用的便捷类型：模型配置的别名（免得每个宿主都 import LlmConfig）。 */
export type AgentRuntimeModelConfig = LlmConfig
