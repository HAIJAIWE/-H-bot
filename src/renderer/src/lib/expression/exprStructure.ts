// src/renderer/src/lib/expression/exprStructure.ts
//
// 表达式**结构检查**：括号/引号配不配对。
//
// ## 它是什么、不是什么（别把它当"语法校验"）
//
// 它**只报结构**：`(` `[` `{` 与 `)` `]` `}` 是否配对、引号是否闭合。这类错误**无歧义** ——
// 不存在"其实是合法写法"的情况，所以**零误报**，可以边打字边报。
//
// 它**不是**语法校验：`clamp(a * 2, 1, 99)` 写错成 `claamp(...)`、`x if c else y` 里多写一个字，
// 它都看不出来。那部分由 **`lib/expression/exprSyntax.ts` 的 `checkExprSyntax`** 负责 ——
// 2026-09-26 已接上（`ExpressionVarHelper` 里两个结果一起显示，结构错优先）。
// 判定走**主进程**（`expression:checkSyntax` → `main/runtime/expressionCheck.ts`），
// 用的是与运行时同一套翻译器 + `new Function`；之所以不在渲染层自己 `new Function`：
// 这里的 CSP 没有 `unsafe-eval`，`new Function` 必抛 EvalError，而翻译器的自校验会把
// 这个异常吞成 false → **合法写法反而被判成语法错**（详见 `shared/nodes/pyToJs.ts` 文件头）。
// 代价是它比结构检查晚约 250ms 到（防抖 + 一次 IPC），所以这一层仍然是必要的快速路径。
//
// ## 为什么要跳过字符串与注释
//
// `"背包（3 种）"` 这类字符串里的全角括号、模板占位符的花括号、以及**界面文案函数调用**里的括号，
// 都不该参与配对 —— 不跳字符串就会误报，而误报正是这个功能最容易死的地方
// （离线脚本 `report-expr-vars.mjs` 第一版 23 条全是误报，教训见 docs/game/rpg-node-gap-audit.md §8.2）。

export interface ExprStructureResult {
  ok: boolean;
  /** 人话的错误说明（含位置），`ok=true` 时为空串 */
  error: string;
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/** 第 n 个字符在第几行第几列（1 基），给错误定位用 */
function posOf(text: string, index: number): string {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const col = index - (before.lastIndexOf('\n') + 1) + 1;
  return `第 ${line} 行第 ${col} 列`;
}

export function checkExprStructure(text: string): ExprStructureResult {
  const stack: Array<{ ch: string; at: number }> = [];
  let quote: string | null = null;
  let quoteAt = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // 行注释：跳到行尾（`//` 后面的括号不算数）
    if (quote === null && ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }

    if (quote !== null) {
      if (ch === '\\') {
        i++; // 转义：跳过下一个字符
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      quoteAt = i;
      continue;
    }

    if (PAIRS[ch]) {
      stack.push({ ch, at: i });
      continue;
    }

    if (CLOSERS.has(ch)) {
      const top = stack.pop();
      if (!top) {
        return {
          ok: false,
          error: `多了个 \`${ch}\`（${posOf(text, i)}）：前面没有与之配对的左括号`,
        };
      }
      if (PAIRS[top.ch] !== ch) {
        return {
          ok: false,
          error: `括号配错了（${posOf(text, i)}）：这里的 \`${ch}\` 关不上 ${posOf(text, top.at)} 的 \`${top.ch}\``,
        };
      }
    }
  }

  if (quote !== null) {
    return { ok: false, error: `引号没闭合（${posOf(text, quoteAt)} 的 \`${quote}\`）` };
  }
  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    const need = PAIRS[last.ch];
    return {
      ok: false,
      error: `括号没闭合（${posOf(text, last.at)} 的 \`${last.ch}\`）：还差一个 \`${need}\``,
    };
  }
  return { ok: true, error: '' };
}
