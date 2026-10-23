// src/main/services/agent-core/scheduler.ts
//
// **一批工具调用怎么跑**（2026-10-20，对齐 DSH 的 `tool-calls` 调度器：读它的行为，不抄代码）。
//
// 规则四条：
//   ① 独占调用是**屏障**：它自己单独跑，前后的调用都不许和它重叠；
//   ② 可并行调用走**有界滚动池**（`maxParallel'），完成一个补一个；
//   ③ 结果**按模型给的顺序提交**（不是按完成顺序）—— 并行只该省时间，
//      不该改变模型看到的世界：trace / 会话 / 界面 / 回灌给模型的结果都按原顺序；
//   ④ 取消：不再起新的，已经起的跑完并提交，剩下的原样不动。
//
// 为什么单独一个文件：core.ts 是"轮/步状态机 + 工具定义"，调度是另一件事，
// 而这段的规则密度最高（屏障、乱序完成、顺序提交、取消边界），混进 900 行的循环里没人读得动。
import type { ToolFailure } from '@shared/ai/toolFailure';
import { classifyToolFailure, toolFailureForCode } from '@shared/ai/toolFailure';
import type { ChatTurn, Tool, ToolCall, ToolContext, ToolResultEntry } from './core';
import { normalizeToolOutcome, withTimeout } from './core';

/** 一个工具调用的落地结果（只有调度器自己用） */
interface ToolSlot {
  output: string;
  ok: boolean;
  failure?: ToolFailure;
  /** 这次调用的开始时刻（trace 里的 ms 靠它：并行时不能拿批次时刻算） */
  startedAt: number;
}

/** 调度器需要的"落地出口"（由循环注入；调度器自己不碰文件/窗口） */
export interface ToolGroupDeps {
  ctx: ToolContext;
  tools: Tool[];
  /** 回灌给模型的对话（按模型顺序追加） */
  messages: ChatTurn[];
  /** 诊断用的调用结果（按模型顺序追加） */
  results: ToolResultEntry[];
  maxParallel: number;
  isAborted: () => boolean;
  /** 模型看到的结果（可能先落盘再给节选，见 core 的 modelFacingOutput） */
  modelFacing: (name: string, output: string) => Promise<string>;
  onToolStart?: (call: ToolCall) => void;
  onToolResult?: (
    call: ToolCall,
    output: string,
    ok?: boolean,
    failure?: ToolFailure,
  ) => void;
  trace?: (event: { kind: 'tool'; name: string; ms: number; ok: boolean }) => void;
  appendSession?: (turn: { role: 'tool'; content: string }) => Promise<void>;
}

/** 工具的执行模式：显式声明优先，否则按 category **保守**推断（未知 = 独占） */
export function executionModeOf(tool: Tool | undefined): 'parallel' | 'exclusive' {
  if (!tool) return 'exclusive'; // 未知工具不并行：它可能根本不是只读工具
  return tool.executionMode ?? (tool.category === 'query' ? 'parallel' : 'exclusive');
}

/**
 * 执行**一个**工具调用：绝不抛错 —— 失败也变成一条 `[工具失败] …` 的结果。
 *
 * 抽出来是因为并行池里每个调用各跑一份：错误处理只要还在调用点里写一遍，
 * 并行路径迟早出现"某条分支忘了 catch"的漏网（而漏网的那条会让整轮挂掉）。
 */
async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
  tools: Tool[],
): Promise<{ output: string; ok: boolean; failure?: ToolFailure }> {
  const tool = tools.find((t) => t.name === call.name);
  let output: string;
  let ok: boolean;
  let failure: ToolFailure | undefined;
  try {
    if (!tool) throw new Error('未知工具: ' + call.name);
    const raw = await (tool.timeoutMs
      ? withTimeout(tool.run(call.args, ctx), tool.timeoutMs)
      : tool.run(call.args, ctx));
    const outcome = normalizeToolOutcome(raw);
    output = outcome.text;
    // 显式 ok 优先；没给才回退到前缀（兼容只有字符串的老工具）
    ok = outcome.ok ?? !output.startsWith('[工具失败]');
    if (!ok) {
      // 显式 code 优先（工具自己知道原因）；否则按文本启发式分类
      failure = outcome.error
        ? toolFailureForCode(outcome.error.code)
        : classifyToolFailure(output);
    }
  } catch (e) {
    output = '[工具失败] ' + (e instanceof Error ? e.message : String(e));
    ok = false;
    failure = classifyToolFailure(output);
  }
  return { output, ok, ...(failure ? { failure } : {}) };
}

/**
 * 跑**一组**工具调用（从 `from` 开始）：独占屏障，或可并行调用走有界滚动池。
 *
 * @returns consumed 这一组真正启动了几个（调用方据此接着处理剩下的）
 */
export async function runToolGroup(
  calls: ToolCall[],
  from: number,
  round: number,
  deps: ToolGroupDeps,
): Promise<{ consumed: number; aborted: boolean }> {
  const mode = executionModeOf(deps.tools.find((t) => t.name === calls[from].name));
  const slots: Array<ToolSlot | undefined> = [];
  const inFlight = new Map<number, Promise<number>>();
  const { maxParallel } = deps;
  let nextToStart = from;
  let committed = from;

  const isParallelAt = (index: number): boolean =>
    executionModeOf(deps.tools.find((t) => t.name === calls[index].name)) === 'parallel';

  const startAt = (index: number): void => {
    const call = calls[index];
    /**
     * 工具 id：模型没给（有些厂商只在流里给一次）就**当场补一个稳定 id** ——
     * 开始/结束两条事件必须能对上，否则界面上会多出一行永不结束的"运行中"。
     */
    if (!call.id) call.id = `call-${round}-${index}`;
    // 先报"开始"再执行：连拼错工具名也要在界面上留下一行（而不是静默跳过）
    deps.onToolStart?.(call);
    const startedAt = Date.now();
    inFlight.set(
      index,
      executeToolCall(call, deps.ctx, deps.tools).then((slot) => {
        slots[index] = { ...slot, startedAt };
        return index;
      }),
    );
    nextToStart = index + 1;
  };

  /** 把**已经连续就绪**的结果按顺序提交（乱序完成不会乱序落地） */
  const commitReady = async (): Promise<void> => {
    while (committed < calls.length) {
      const slot = slots[committed];
      if (!slot) break;
      const call = calls[committed];
      deps.results.push({
        name: call.name,
        args: call.args ?? {},
        output: slot.output,
        ...(slot.failure ? { failure: slot.failure } : {}),
      });
      // 观测：每个工具一行 trace（**带真实耗时**——投影里的 ms 全靠它）；会话日志同时记一条
      deps.trace?.({ kind: 'tool', name: call.name, ms: Date.now() - slot.startedAt, ok: slot.ok });
      if (deps.appendSession) {
        await deps.appendSession({ role: 'tool', content: call.name + ': ' + slot.output.slice(0, 200) });
      }
      // 界面/诊断拿**原始**输出（摘要要按真实行数算），模型只拿节选（见 modelFacingOutput）
      deps.onToolResult?.(call, slot.output, slot.ok, slot.failure);
      deps.messages.push({
        role: 'tool',
        name: call.name,
        content: await deps.modelFacing(call.name, slot.output),
      });
      committed += 1;
    }
  };

  /** 补位：可并行就一直起，碰到独占 / 池满 / 取消就停 */
  const fill = (): void => {
    while (!deps.isAborted() && inFlight.size < maxParallel) {
      if (nextToStart >= calls.length) return;
      // 独占组只跑第一个；它没结算之前谁都不许起
      if (mode === 'exclusive' && inFlight.size > 0) return;
      // 并行组碰到一个独占调用：它自己成屏障，留给下一组
      if (mode === 'parallel' && nextToStart > from && !isParallelAt(nextToStart)) return;
      startAt(nextToStart);
    }
  };

  fill();
  while (inFlight.size > 0) {
    const settled = await Promise.race(inFlight.values());
    inFlight.delete(settled);
    await commitReady();
    fill();
  }
  await commitReady();

  return {
    consumed: nextToStart - from,
    // 只有"取消导致提前收尾"才算 aborted（正常收尾时 consumed 覆盖了这一组该跑的调用）
    aborted: deps.isAborted() && nextToStart < calls.length,
  };
}
