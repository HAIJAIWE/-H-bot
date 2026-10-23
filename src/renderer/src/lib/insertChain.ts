// src/renderer/src/lib/exprSyntax.ts
//
// 表达式**完整语法校验**（渲染层这一侧）：把表达式原文交给主进程，
// 用与运行时同一套翻译器 + `new Function` 试构造，把结论（或错误信息）拿回来。
//
// ## 为什么不在渲染层自己 `new Function`
//
// 因为渲染层的 CSP 里**没有 `unsafe-eval`**（`src/renderer/index.html`：
// `script-src 'self' https://cdn.jsdelivr.net`），渲染进程里 `new Function(...)` 一定抛
// `EvalError: ... 'unsafe-eval' is not an allowed source of script`（2026-09-26 用真实
// Chromium 页面实测复现）。而且它**不会**表现为"检查不了"：
//
//   1. 翻译器内部的三元自校验（`isParsableExpr`）会把这个异常**吞成 false**；
//   2. 于是 `x if c else y` 这种**完全合法**的写法翻译不出来、原样返回；
//   3. 再拿去判语法 → 每条表达式都亮红字。
//
// 那正是这个功能最容易死的方式（离线脚本 `report-expr-vars.mjs` 第一版 23 条全是误报，
// 教训见 `docs/game/rpg-node-gap-audit.md` §8.2），所以判定放在**表达式真正执行的那个进程**里做。
//
// ## 硬要求：只报语法/翻译错误，绝不报"未定义变量"
//
// 主进程侧只构造、不调用（见 `src/main/runtime/expressionCheck.ts`），所以
// `get(v1,"hp",0)` 里 v1 存不存在、`len(...)` 有没有被白名单放出，都**不会**在这里报错。
// "哪些名字可用"由同一面板的变量清单负责。
//
// ## 拿不到结论时一律返回"没问题"
//
// 桥不存在（单元测试环境）、IPC 抛错、返回的形状不认识 —— 这三种情况都返回 `{ok: true}`。
// 理由：红字是**断言"这句跑不通"**，而报错的代价（用户去改一句本来没错的表达式）远大于
// 漏报的代价（运行时本来就会如实报错）。宁可不说，也不说错。
import type { ExprSyntaxResult } from '../types/ipc';

export type { ExprSyntaxResult };

/** 主进程那一侧的实现（形如 `{"ok":false,"error":"…"}`）；取不到就说"不知道" */
function bridge() {
  return typeof window !== 'undefined' ? window.qqbat?.expression?.checkSyntax : undefined;
}

/**
 * 检查一条表达式能否跑通（翻译 + 语法）。
 *
 * `{ ok: true }` = **没有发现语法/翻译问题**，不代表运行时不报错。
 */
export async function checkExprSyntax(text: string): Promise<ExprSyntaxResult> {
  if (typeof text !== 'string' || !text.trim()) return { ok: true };
  const call = bridge();
  if (typeof call !== 'function') return { ok: true };
  try {
    const r = await call(text);
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return { ok: true };
      if (r.ok === false && typeof r.error === 'string' && r.error.trim()) {
        return { ok: false, error: r.error };
      }
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
