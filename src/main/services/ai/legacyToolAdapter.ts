// src/main/services/ai/legacyToolAdapter.ts
//
// **旧工具 → 新循环的工具形态**（迁移阶段 1，2026-10-18）。
//
// 旧链路的工具声明在 `@shared/types/ai` 的 `AiToolDefinition`（name/description/parameters/category），
// 执行靠 `tools/execute.ts` 的 switch；新循环要的是 `Tool`（带 run）。
// 这里只做**形态转换**，执行器由调用方注入 —— 适配器不该知道 registry、更不该碰 BrowserWindow。
//
// 为什么执行器注入而不是直接 import executeTool：
//   · 诊断（tests）可以给假执行器，验证"新循环能驱动旧工具"；
//   · 阶段 2 接真实执行器时只换一个实参，适配器一行不改。
//
// 闸门：旧工具的 `category === 'mutation'` 必须**先过 gate**（新循环的审批口）。
// 不闸的话，迁移进来的写工具等于绕过了审批 —— 这是迁移里最容易漏的一条。
import type { AiToolDefinition } from '@shared/types/ai';
import type { Tool } from '../agent-core/core';

/** 注入的执行器：跑一个旧工具，返回回给模型的文本 */
export type LegacyToolRunner = (
  def: AiToolDefinition,
  args: Record<string, unknown>,
) => Promise<string>;

/**
 * 把一条旧定义包成新循环的 `Tool`。
 *
 * @param def 旧定义（来自 `ALL_TOOL_DEFINITIONS`）
 * @param run 真执行器（阶段 1 的诊断里是假的；阶段 2 是 executeTool）
 */
export function adaptLegacyTool(def: AiToolDefinition, run: LegacyToolRunner): Tool {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    // 阶段 0 已对齐词汇：两边都是 query / mutation，这里直接透传
    category: def.category,
    async run(args, ctx) {
      // 会改东西的旧工具先过审批闸门（拒绝时按新循环的约定返回 "[工具失败] …"）
      if (def.category === 'mutation') {
        const verdict = ctx.gate
          ? await ctx.gate({ kind: 'command', command: def.name })
          : true;
        if (!verdict) return '[工具失败] 被拒绝（未通过闸门）';
      }
      const text = await run(def, args);
      return typeof text === 'string' ? text : String(text ?? '');
    },
  };
}
