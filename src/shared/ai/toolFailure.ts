// src/shared/ai/toolFailure.ts
//
// **工具失败的结构化分类**（2026-10-19）：把 "[工具失败] …" 的字符串变成可判定的 code，
// 让界面/上层能给出**下一步动作**，而不是只显示一句话。
//
// 分类是**启发式**（按错误文本），刻意保守：认不出就是 unknown，不猜。
// 工具可以用 ToolOutcome.error.code 显式给出，循环优先信它。
export type ToolFailureCode =
  | 'permission_denied'
  | 'cancelled'
  | 'timeout'
  | 'not_found'
  | 'invalid_args'
  | 'upstream_error'
  | 'unknown';

/** 建议动作（界面据此给提示；是否可执行由上层决定） */
export type ToolFailureAction =
  | 'approve'
  | 'retry'
  | 'change_args'
  | 'switch_model';

export interface ToolFailure {
  code: ToolFailureCode;
  actions: ToolFailureAction[];
}

const ACTIONS: Record<ToolFailureCode, ToolFailureAction[]> = {
  permission_denied: ['approve'],
  cancelled: [],
  timeout: ['retry'],
  not_found: ['change_args'],
  invalid_args: ['change_args'],
  upstream_error: ['retry', 'switch_model'],
  unknown: ['retry'],
};

/** 已知 code → 完整失败（工具显式给出 code 时用：动作表仍由这里统一） */
export function toolFailureForCode(code: ToolFailureCode): ToolFailure {
  return { code, actions: ACTIONS[code] };
}

/** 文本 → 失败分类（顺序重要：先判"更具体"的原因） */
export function classifyToolFailure(message: string): ToolFailure {
  const text = String(message ?? '');
  const code: ToolFailureCode = (() => {
    if (/权限|拒绝|denied|permission|审批/i.test(text)) return 'permission_denied';
    if (/取消|cancelled|canceled|abort/i.test(text)) return 'cancelled';
    if (/超时|timeout|timed out/i.test(text)) return 'timeout';
    if (/未知工具|不存在|没有找到|ENOENT|no such file|not found/i.test(text)) return 'not_found';
    if (/参数|invalid|schema|JSON 解析/i.test(text)) return 'invalid_args';
    if (/ECONN|ETIMEDOUT|network|fetch failed|HTTP|status[ =:]+\d{3}|\b(4\d\d|5\d\d)\b/i.test(text)) {
      return 'upstream_error';
    }
    return 'unknown';
  })();
  return { code, actions: ACTIONS[code] };
}
