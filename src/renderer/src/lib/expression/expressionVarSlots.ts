// src/renderer/src/lib/expression/expressionVarSlots.ts
//
// D4 · 表达式节点的"按需变量" —— 核心纯逻辑（UI 接线在下一步）。
//
// 现状：`expression_eval` 固定显示 v1~v11 共 11 个变量框，而公式通常只用 1~3 个
// （用户实测："选择框出现太多了，完全不知道怎么设计这个节点是干啥的"）。
// 目标：**按用户真实用到几个变量就显示几个框**，并支持手动增删。
//
// 与输出端口的关系：变量框数量决定动态输出端口（既有 `getExpressionEvalOutputs` 逻辑不变）。
// 上限沿用 11（与目录里的端口定义一致），避免出现"框有了但没有对应输出端口"。

export const MAX_VAR_SLOTS = 11;

/**
 * 从表达式文本里找出用到的变量序号（`v1`、`v12`…）。
 * 只认 `v<数字>` 且前后不是标识符字符，避免把 `value1` / `av2` 误判成变量。
 */
export function usedVariableIndices(expression: string): number[] {
  if (!expression) return [];
  const found = new Set<number>();
  for (const m of expression.matchAll(/(?<![A-Za-z0-9_$])v(\d{1,2})(?![A-Za-z0-9_$])/g)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/** 从 formulas（JSON 字符串或数组）里收集所有表达式文本 */
function collectFormulaExpressions(formulas: unknown): string[] {
  let list: unknown = formulas;
  if (typeof formulas === 'string') {
    try {
      list = JSON.parse(formulas);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((f) =>
      f && typeof f === 'object' ? String((f as { expression?: unknown }).expression ?? '') : '',
    )
    .filter(Boolean);
}

/**
 * 应显示的变量框数量。
 *
 * 取三者的最大值并夹在 [1, MAX_VAR_SLOTS]：
 *   1. 表达式中实际用到的最大序号
 *   2. formulas 模式里各公式用到的最大序号
 *   3. 用户手动增加的框数（删/增的结果，调用方传入）
 *
 * 任何情况都**至少 1 个**（表达式节点没有"零变量"的形态）。
 */
export function computeVariableSlotCount(opts: {
  expression?: string;
  formulas?: unknown;
  manualCount?: number;
}): number {
  const sources = [opts.expression ?? '', ...collectFormulaExpressions(opts.formulas)];
  let maxUsed = 0;
  for (const text of sources) {
    for (const idx of usedVariableIndices(text)) {
      if (idx > maxUsed) maxUsed = idx;
    }
  }
  const manual = Number.isFinite(opts.manualCount) ? Number(opts.manualCount) : 0;
  const wanted = Math.max(1, maxUsed, manual);
  return Math.min(wanted, MAX_VAR_SLOTS);
}
