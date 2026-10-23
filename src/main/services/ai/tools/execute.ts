// src/main/services/ai/tools/execute.ts
//
// **工具执行**：必填参数闸门（唯一入口，一次覆盖所有工具）+ 22 个工具的 switch 分发。
//
// ⚠️ 闸门拒绝时要说清三件事：**缺哪个、它是什么、这次没执行**。第三条最重要 ——
// 不写清楚的话模型会以为改动已经提交了（见下面 gate 的注释）。

import { findToolDef } from './defs';
import { getRegisteredHandler } from './registry';
import type { ToolExecutionContext } from './registry';
import type { AiToolCall, AiToolDefinition } from '@shared/types/ai';

// 执行上下文类型仍从本模块导出（`tools/index.ts` 的 barrel 与测试都从这里取）
export type { ToolExecutionContext } from './registry';

// ====== Tool 执行引擎 ======

export interface ToolExecutionResult {
  result: unknown;
  /** 是否需要渲染层执行（流程操作） */
  needsClientExecution?: boolean;
  clientInstruction?: Record<string, unknown>;
}

/**
 * 工具执行被取消。
 *
 * 单独一个类，是为了让调用方能**区分**"工具失败了（该把错误回给模型）"
 * 和"用户取消了（什么都不该做）" —— 后者若被当成失败回给模型，
 * 模型会开始"修复"一个根本没发生的问题。
 */
export class ToolAbortedError extends Error {
  constructor() {
    super('工具执行已取消');
    this.name = 'ToolAbortedError';
  }
}

/**
 * 按工具定义里的 `required` 找出**没给**的必填参数。
 *
 * ## 为什么需要这一处（2026-09-30 审计发现的真缺口）
 *
 * `required` 从这些工具建起就写在每个定义的 JSON Schema 里，**但全仓没有任何地方
 * 在运行时读它** —— 实测 `.required` 的读取点只有：节点端口（`context.ts`）、
 * B 侧工具（`bot/tools.ts`）、配置表字段（`configService.ts`）。**A 侧这 21 个工具一个都没有。**
 *
 * 后果不是"报错"，是**假成功**：
 * - `add_node` 漏传 `nodeKind` → 工具照样回「操作已提交」→ 错误推迟到很远的地方，
 *   最后以「未知 kind」这种看不懂的形式出现；
 * - `create_ai_node` 漏传 `funcName` → 被 `String(args.funcName ?? '')` 变成空字符串继续往下走。
 *
 * 这正是本项目最忌讳的那一类（看起来成功了）。判据放在**唯一的入口**，
 * 21 个工具一次覆盖，不靠每个 handler 各自记得检查。
 *
 * ## 判据用"空值"而不是 `in`
 *
 * 模型经常给出 `nodeKind: ""`、`config: {}` 这类**给了但没用**的值 ——
 * 与没给是同一回事（`update_node` 传个空 config 等于没配置）。
 * 所以 `undefined / null / 空白字符串 / 空数组 / 空对象` 一律算"没给"。
 */
export function missingRequiredArgs(
  def: AiToolDefinition,
  args: Record<string, unknown> | undefined | null,
): string[] {
  const required = (def.parameters as { required?: unknown }).required;
  if (!Array.isArray(required)) return [];
  const a = args ?? {};
  const isEmpty = (v: unknown): boolean => {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v as object).length === 0;
    return false;
  };
  return required.filter((k): k is string => typeof k === 'string' && isEmpty(a[k]));
}

/** 把缺的参数拼成**可读的**提示（带上定义里那句 description，也就是模型自己看到过的说明） */
function describeMissingArgs(def: AiToolDefinition, missing: readonly string[]): string {
  const props =
    (def.parameters as { properties?: Record<string, { description?: string }> }).properties ?? {};
  return missing
    .map((k) => (props[k]?.description ? `${k}（${props[k].description}）` : k))
    .join('、');
}

export async function executeTool(
  toolCall: AiToolCall,
  projectPath: string,
  ctx?: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (ctx?.signal?.aborted) throw new ToolAbortedError();
  return raceWithAbort(executeToolInner(toolCall, projectPath, ctx), ctx?.signal);
}

/**
 * 让一个 Promise 与取消信号竞速：信号一到就**立刻**把它判为取消
 * （不等工具自己跑完 —— 它可能永远不会跑完）。
 *
 * 注意这里给 `p` 挂了 then/catch：即使竞速已经因取消而结束，
 * `p` 之后若再 reject 也**不会**变成 unhandled rejection（那会在 Electron 里报一条
 * 莫名其妙的错误日志，把真正的取消掩盖掉）。
 */
function raceWithAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new ToolAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** 各工具的实际实现（外层 `executeTool` 负责取消语义） */
async function executeToolInner(
  toolCall: AiToolCall,
  projectPath: string,
  ctx?: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const { name, args } = toolCall;
  const def = findToolDef(name);
  if (def) {
    const missing = missingRequiredArgs(def, args);
    if (missing.length > 0) {
      const allRequired = (def.parameters as { required?: string[] }).required ?? [];
      return {
        result: `⚠️ 调用 \`${name}\` 缺少必填参数：${describeMissingArgs(def, missing)}。\n**本次调用没有执行，也没有产生任何改动。**\n该工具的必填参数是：${allRequired.join('、')}。请补齐后重新调用。`,
      };
    }
  }
  /**
   * **唯一的实现入口**：声明与实现都在 `registry.ts`（2026-10-07 迁移完成）。
   *
   * 这里留下的不是"分发逻辑"而是**顺序**：必填参数闸门先跑（缺参数绝不进实现），
   * 进来之后才查 registry；查不到就明确说"没有这个工具" —— 这条兜底必须留着，
   * 否则模型编一个工具名只会拿到一个 undefined 式的沉默失败。
   */
  const registered = getRegisteredHandler(name);
  if (registered) return registered({ name, args, projectPath, ...ctx });
  throw new Error(`未知工具: ${name}`);
}
