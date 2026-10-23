// src/main/services/agent-core/legacyTools.ts
//
// **旧工具 → 循环的工具形态**（2026-10-20，合并双引擎的第 2 步）。
//
// 助手链路那 27 个领域工具（读流程 / 查节点 / 加节点 / 跑校验…）此前只有 chatRun 能用，
// 循环模式里模型根本看不到它们 —— 于是"一个引擎"只能是空话。这里把同一批定义接进循环。
//
// 两条语义照旧，**不新造**：
//   · query：走 `executeTool`（唯一入口，必填参数闸门在里面）。需要渲染层执行的
//     （`needsClientExecution`）用 clientInstruction 派发并**等回执** ——
//     "发完就当成功"是本仓库明文反对的假成功；
//   · mutation：**不执行**，转成提案操作攒进 `pendingOperations`，等用户确认后才落盘
//     （与助手链路的 dispatchToolCalls 同一条路）。
import type { AiToolDefinition } from '@shared/types/ai';
import type { AgentRole } from '@shared/ai/roleDomains';
import type { ProposalOperation } from '@shared/types/proposal';
// 与 chatRun / MCP / ai:tools 用**同一份**清单（defs.ts 聚合 registry 的分组）。
// 曾经这里 import 的是旧的 ai/tools 静态表，模型在循环里看到 27 个、助手链路看到另一套，
// 宣称的工具表就不是真正能执行的那张。
import { ALL_TOOL_DEFINITIONS } from '../ai/tools/defs';
import { executeTool, type ToolExecutionResult } from '../ai/tools/execute';
import { toolCallToOperations } from '../ai/proposal';
import type { ToolExecutionContext } from '../ai/tools/registry';
import type { Tool } from './core';

/** 渲染层回执（与 instructionBridge 的 InstructionOutcome 同形，这里只取需要的两个字段） */
export interface LegacyInstructionOutcome {
  status: string;
  reason?: string;
}

export interface LegacyToolBridge {
  projectPath: string;
  signal?: AbortSignal;
  /** 当前角色：提案期按作用对象拦跨页改动（见 roleDomains） */
  role?: AgentRole;
  /**
   * 待确认操作的累积处。mutation 只往这里 push，**不落盘**；
   * 轮末由调用方（IPC）拿它发提案 —— 没人发就等于什么都没发生。
   */
  pendingOperations: ProposalOperation[];
  /** 执行前的上下文（预览图等）；不传 = 只带 signal */
  context?: () => Promise<ToolExecutionContext>;
  /** 需要渲染层执行的指令；不传 = 这类工具直接失败并说明原因 */
  dispatch?: (instruction: { name: string; args: Record<string, unknown> }) => Promise<LegacyInstructionOutcome>;
  /** 执行器（诊断/测试注入；默认走真实 executeTool） */
  execute?: (call: { id: string; name: string; args: Record<string, unknown> }) => Promise<ToolExecutionResult>;
}

/**
 * 把一条旧定义包成循环的 `Tool`。
 *
 * `executionMode` 不写：由 `executionModeOf` 按 category 推（query → 并行，mutation → 独占）。
 * 这一条很重要 —— 手工给 27 个工具逐个标"能不能并行"迟早标错一个，而错的那个是写工具。
 */
export function adaptLegacyTool(def: AiToolDefinition, bridge: LegacyToolBridge): Tool {
  const isMutation = def.category === 'mutation';
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters as Record<string, unknown>,
    category: def.category ?? 'mutation',
    async run(args) {
      if (isMutation) {
        /**
         * 提案转换是**同步且会抛**的：字段校验失败（路径穿越/代码注入）在这里就该停，
         * 而不是排进一个之后必然失败的队列。
         */
        const ops = toolCallToOperations(def.name, args, bridge.projectPath, bridge.role);
        if (ops.length === 0) {
          return (
            `[工具失败] 工具 ${def.name} 没有可用的提案转换，本次**没有执行**，也没有产生任何改动。` +
            '请换一个工具，或直接告诉用户这一步做不到。'
          );
        }
        bridge.pendingOperations.push(...ops);
        return (
          `操作已加入待确认计划（${ops.length} 项）：` +
          '用户确认后才会落盘。现在不要重复提交同一组操作。'
        );
      }
      const run = bridge.execute ?? ((call) => executeTool(call, bridge.projectPath, ctxOf(bridge)));
      const call = { id: `${def.name}-${Date.now()}`, name: def.name, args };
      const res = await run(call);
      if (res.needsClientExecution && res.clientInstruction) {
        const instruction = res.clientInstruction as { name: string; args: Record<string, unknown> };
        if (!bridge.dispatch) {
          return `[工具失败] ${def.name} 需要在应用界面里执行，但当前没有可用的界面通道`;
        }
        const outcome = await bridge.dispatch(instruction);
        if (outcome.status !== 'applied') {
          return `[工具失败] ${def.name} 没有落地：${outcome.reason ?? outcome.status}`;
        }
        return '操作已提交并收到回执' + (res.result === undefined ? '' : '：' + asText(res.result));
      }
      return asText(res.result);
    },
  };
}

/** 这一轮所有可用的旧工具（顺序与 ALL_TOOL_DEFINITIONS 一致，便于对账） */
export function adaptLegacyTools(bridge: LegacyToolBridge): Tool[] {
  return ALL_TOOL_DEFINITIONS.map((def) => adaptLegacyTool(def, bridge));
}

function ctxOf(bridge: LegacyToolBridge): ToolExecutionContext | undefined {
  return bridge.signal ? { signal: bridge.signal } : undefined;
}

/** 工具结果 → 回给模型的文本（对象就序列化；空值给一句明确的"没内容"） */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '（工具没有返回内容）';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
