// src/main/services/agent-core/runTurn.ts
//
// **一次运行的总入口**（2026-10-18）：把模型适配器、五个服务、循环装在一起。
//
// 调用方只需要给「项目路径 + 需求 + 模型配置」，其余默认值都保守：
//   · 审批默认**拒绝**（没有接审批 UI 之前不能写盘）；
//   · 会话/观测默认是无副作用实现（不写文件、不发网络）。
// 这样它可以在任何地方被调用（测试、脚本、以后的 UI 开关），不会悄悄改用户项目。
import type { LlmConfig } from '../ai/llm';
import { runAgentLoop, type ChatTurn, type LoopPhase, type ToolCall } from './core';
import { createModelFn } from './modelAdapter';
import {
  assembleAgentServices,
  makeApprovalService,
  makeContextService,
  makeSandboxService,
  makeSessionStore,
  makeTraceSink,
} from './adapters';
import type { ApprovalRequest, TraceEvent } from './contracts';
import { buildSystemPrompt, PLAN_ONLY_NOTE } from './prompt';
import { listTools } from './core';
import { estimateTokens, type CompactionOptions, type CompactionOutcome } from './contextGate';

export interface RunTurnInput {
  projectPath: string;
  requirement: string;
  config: LlmConfig;
  /** 审批：默认一律拒绝（写盘必须显式放开） */
  approval?: (req: ApprovalRequest, signal?: AbortSignal) => Promise<boolean>;
  trace?: (projectPath: string, event: TraceEvent) => void;
  session?: {
    append: (projectPath: string, turn: { role: string; content: string }) => Promise<void>;
    load: (projectPath: string, limit?: number) => Promise<Array<{ role: string; content: string }>>;
  };
  /** 注入的模型调用（测试/替换 provider）；不传走真实 callLlm */
  call?: Parameters<typeof createModelFn>[1] extends { call?: infer C } ? C : never;
  maxRounds?: number;
  signal?: AbortSignal;
  /**
   * **流式观测**（界面实时显示"它在干什么"）。
   *
   * 三条都不是必需的：不传就是原来的"跑完才回执"。
   * 2026-10-18 真机教训：一轮 150 秒、界面只有一个计时器在跳 —— 用户说是卡死都不过分。
   */
  /**
   * **跨轮记忆**：这一轮之前发生过的对话（已按 token 预算裁好、时间序）。
   *
   * 不传 = 全新开始（测试/脚本的默认）。传了就拼在系统提示之后、这一轮的要求之前 ——
   * 顺序错了模型会以为"以前说过的话"是刚刚说的。
   */
  history?: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** 历史被裁掉时的交代（describeDropped）：拼进系统提示，别让模型以为自己什么都没忘 */
  historyNote?: string;
  /**
   * **这一轮的角色说明**（角色强调句 + 会话预设的附加要求）：拼进系统提示。
   *
   * 与 historyNote 分开是因为语义不同：那条是"你看不到的东西是什么"，
   * 这条是"你现在是谁、该干什么"。混成一条字符串后，加角色就得改历史那边。
   */
  roleNote?: string;
  /**
   * **先计划**（2026-10-18，对齐 DSH 的 plan 阶段）：只给只读工具，产出一份计划。
   *
   * 两层约束，缺一不可：系统提示说明"这一轮要什么"，工具集**物理上**裁掉写/命令 ——
   * 只靠提示词约束"只许看"，模型多试两次就绕过去了。
   */
  planOnly?: boolean;
  /**
   * 溢出存储：超长的工具结果**完整落盘**，模型只拿头尾 + 路径（失败返回 undefined）。
   * 不传 = 按上限裁并如实说"没保存"（脚本/测试的默认，无副作用）。
   */
  spill?: (toolName: string, text: string) => Promise<string | undefined>;
  /**
   * **写盘之前**的钩子（项目内相对路径）：轮次日志靠它记下 before，撤回才有依据。
   * 不传 = 不记（脚本/测试的默认，无副作用）。
   */
  onBeforeWrite?: (relPath: string) => Promise<void>;
  /**
   * **步边界收插话**：每轮开始前问一次有没有新输入（用户中途纠偏）。
   * 返回 null = 没有。不传 = 这一轮不收插话（测试/脚本的默认）。
   */
  inbox?: () => ChatTurn | null;
  /**
   * **步边界**（每轮问模型之前一次）：界面靠它显示「第 N / 共 M 步」。
   * 与 onToolStart/onToolEnd 不同：那两个描述某次工具，这个描述整轮走到哪一步。
   */
  onStep?: (info: { step: number; maxSteps: number }) => void;
  /** 模型吐字（半句半句地来） */
  onTextChunk?: (text: string) => void;
  /** 思考过程增量（厂商回传 reasoning_content 时才有；不传 = 丢弃） */
  onReasoningChunk?: (text: string) => void;
  /** 某个工具开始跑（先摆一行"运行中"） */
  onToolStart?: (call: ToolCall) => void;
  /** 某个工具跑完（更新成 done / error） */
  /** 自定义工具集（迁移阶段 2a：旧链路切过来时只给只读子集）；不传 = 注册表全量 */
  tools?: import('./core').Tool[];
  /** 工具结束（ok 显式给出时以它为准，没给看输出前缀） */
  onToolEnd?: (call: ToolCall, output: string, ok?: boolean) => void;
  /** 循环内上下文闸门（见 ./contextGate）：不传 = 不压 */
  compaction?: CompactionOptions;
  /** 真的压了才回调（主进程日志/以后的界面提示靠它） */
  onCompact?: (info: CompactionOutcome) => void;
}

export interface RunTurnResult {
  finalText: string;
  rounds: number;
  phase: LoopPhase;
  /** args 也一起回（界面上的工具行要显示"改的是哪个文件"，光有输出看不出动作） */
  toolResults: Array<{ name: string; args: Record<string, unknown>; output: string }>;
}

export async function runAgentTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const services = assembleAgentServices({
    sandbox: makeSandboxService(),
    approval: makeApprovalService(input.approval ?? (async () => false)),
    context: makeContextService({
      // 与 contextGate 同一口径：旧的 length/3 对中文低估约 3 倍，预算永远对不上
      estimate: (text) => estimateTokens(text),
      compact: async (messages) => messages,
      spill: async (text) => text,
    }),
    session: makeSessionStore({
      append: input.session?.append ?? (async () => undefined),
      load: input.session?.load ?? (async () => []),
    }),
    trace: makeTraceSink(input.trace ?? (() => undefined)),
  });
  const model = createModelFn(input.config, {
    ...(input.call ? { call: input.call } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onTextChunk ? { onChunk: input.onTextChunk } : {}),
    ...(input.onReasoningChunk ? { onReasoning: input.onReasoningChunk } : {}),
  });
  /**
   * **实际交给循环的工具表**：先算一次，系统提示与调用表共用同一份。
   *
   * 分开算吃过亏：提示里按注册表全量广告，模型照着调过去却是「未知工具」，
   * 一轮就白烧。预设白名单（input.tools）与先计划（只留 query 类）都在这里收敛。
   */
  const effectiveTools = input.planOnly
    ? (input.tools ?? listTools()).filter((t) => t.category === 'query')
    : input.tools;
  const result = await runAgentLoop({
    workspace: input.projectPath,
    /**
     * ⚠️ 系统提示 + 用户要求**必须**先摆进对话：第一版漏了这一步，真机上第一轮请求
     * 的 messages 是空数组，厂商直接 400（"the role in last message must be ..."）。
     * 单测里模型是假的，所以一直绿。
     */
    initialTurns: [
      {
        role: 'system',
        content:
          buildSystemPrompt(
            input.projectPath,
            [],
            effectiveTools ? { tools: effectiveTools.map((t) => t.name) } : {},
          ) +
          (input.planOnly ? '\n\n' + PLAN_ONLY_NOTE : '') +
          (input.roleNote ? '\n\n' + input.roleNote : '') +
          (input.historyNote ? '\n\n' + input.historyNote : ''),
      },
      ...(input.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: input.requirement },
    ],
    model,
    // 不传 = 注册表全量（脚本/测试的默认）；传了就**只有**这些进调用表
    ...(effectiveTools ? { tools: effectiveTools } : {}),
    services,
    ...(input.onStep ? { onStep: input.onStep } : {}),
    ...(input.onToolStart ? { onToolStart: input.onToolStart } : {}),
    ...(input.onToolEnd ? { onToolResult: input.onToolEnd } : {}),
    ...(input.spill ? { spill: input.spill } : {}),
    ...(input.inbox ? { inbox: input.inbox } : {}),
    ...(input.onBeforeWrite ? { onBeforeWrite: input.onBeforeWrite } : {}),
    ...(input.maxRounds ? { maxRounds: input.maxRounds } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.compaction ? { compaction: input.compaction } : {}),
    ...(input.onCompact ? { onCompact: input.onCompact } : {}),
  });
  return {
    finalText: result.finalText,
    rounds: result.rounds,
    phase: result.phase,
    toolResults: result.toolResults,
  };
}

/** 供调用方做类型收窄（避免在 UI 层写 as） */
export function isToolCall(value: unknown): value is ToolCall {
  return !!value && typeof value === 'object' && 'name' in value && 'args' in value;
}