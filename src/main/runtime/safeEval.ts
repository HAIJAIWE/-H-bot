/**
 * 安全表达式求值 —— 从迁移前的 Python 实现移植
 *
 * 先把流程图表达式中的 Python 风格写法（True/False/None、and/or/not、A if C else B、
 * f-string、`x in y`）翻译为 JS 表达式，再在受限作用域内求值。
 * 安全约束：
 * - 禁止访问 __proto__ / constructor / prototype / globalThis / window / process / require
 * - 仅暴露 variables 中的变量 + 白名单函数
 * - 求值失败或不安全时返回 false
 */

/** 表达式长度上限（防 DoS） */
const MAX_EXPR_LEN = 10_000;

/** 危险标识符黑名单 */
const FORBIDDEN_PATTERNS = [
  /__proto__/,
  /\bconstructor\b/,
  /\bprototype\b/,
  /\bglobalThis\b/,
  /\bwindow\b/,
  /\bprocess\b/,
  /\brequire\b/,
  /\beval\b/,
  /\bFunction\b/,
  /\bimport\b/,
];

/** 白名单函数（表达式求值允许调用的函数集合） */
const SAFE_FUNCS: Record<string, (...args: never[]) => unknown> = {
  len: (x: unknown) => {
    if (x == null) return 0;
    if (typeof x === 'string' || Array.isArray(x)) return x.length;
    if (typeof x === 'object') return Object.keys(x).length;
    return 0;
  },
  int: (x: unknown) => {
    const n = parseInt(String(x), 10);
    return Number.isNaN(n) ? 0 : n;
  },
  float: (x: unknown) => {
    const n = parseFloat(String(x));
    return Number.isNaN(n) ? 0 : n;
  },
  str: (x: unknown) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'object') {
      try {
        return JSON.stringify(x);
      } catch {
        return String(x);
      }
    }
    return String(x);
  },
  bool: (x: unknown) => Boolean(x),
  abs: (x: unknown) => Math.abs(Number(x)),
  min: (...args: unknown[]) => {
    const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.min(...flat.map(Number));
  },
  max: (...args: unknown[]) => {
    const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.max(...flat.map(Number));
  },
  sum: (arr: unknown[]) => (Array.isArray(arr) ? arr.reduce((a, b) => Number(a) + Number(b), 0) : 0),
  round: (x: unknown, n: unknown = 0) => {
    const factor = Math.pow(10, Number(n) || 0);
    return Math.round(Number(x) * factor) / factor;
  },
  clamp: (x: unknown, lo: unknown, hi: unknown) => Math.min(Math.max(Number(x), Number(lo)), Number(hi)),
  range: (...args: number[]) => {
    const [start, stop, step] = args.length === 1 ? [0, args[0], 1] : [args[0], args[1], args[2] ?? 1];
    const result: number[] = [];
    if (step === 0) return result;
    if (step > 0) {
      for (let i = start; i < stop && result.length < 10000; i += step) result.push(i);
    } else {
      for (let i = start; i > stop && result.length < 10000; i += step) result.push(i);
    }
    return result;
  },
  list: (x: unknown) => (Array.isArray(x) ? x : x == null ? [] : [x]),
  dict: (x: unknown) => (x && typeof x === 'object' ? x : {}),
  json: (x: unknown) => x,
  now: () => Date.now(),
  random: () => Math.random(),
  randint: (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a,
  choice: (arr: unknown[]) => (Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null),
  upper: (s: unknown) => String(s ?? '').toUpperCase(),
  lower: (s: unknown) => String(s ?? '').toLowerCase(),
  strip: (s: unknown) => String(s ?? '').trim(),
  replace: (s: unknown, a: unknown, b: unknown) => String(s ?? '').split(String(a)).join(String(b)),
  split: (s: unknown, sep: unknown = ' ') => String(s ?? '').split(sep as string),
  join: (arr: unknown[], sep: unknown = '') => (Array.isArray(arr) ? arr.map(String).join(String(sep)) : ''),
  startswith: (s: unknown, p: unknown) => String(s ?? '').startsWith(String(p)),
  endswith: (s: unknown, p: unknown) => String(s ?? '').endsWith(String(p)),
  contains: (s: unknown, p: unknown) => String(s ?? '').includes(String(p)),
  format: (s: unknown, ...args: unknown[]) => {
    let i = 0;
    return String(s ?? '').replace(/\{\}/g, () => String(args[i++] ?? ''));
  },
  sort: (arr: unknown[]) => (Array.isArray(arr) ? [...arr].sort((a, b) => ((a as string) > (b as string) ? 1 : (a as string) < (b as string) ? -1 : 0)) : []),
  reverse: (arr: unknown[]) => (Array.isArray(arr) ? [...arr].reverse() : []),
  keys: (o: unknown) => (o && typeof o === 'object' ? Object.keys(o) : []),
  values: (o: unknown) => (o && typeof o === 'object' ? Object.values(o) : []),
  items: (o: unknown) => (o && typeof o === 'object' ? Object.entries(o) : []),
  get: (o: unknown, k: unknown, d: unknown = null) => (o && typeof o === 'object' && (k as string) in o ? (o as Record<string, unknown>)[k as string] : d),
  to_json: (x: unknown) => {
    try {
      return JSON.stringify(x);
    } catch {
      return '{}';
    }
  },
  from_json: (s: unknown) => {
    try {
      return JSON.parse(String(s));
    } catch {
      return null;
    }
  },
  time: () => Math.floor(Date.now() / 1000),
};

/** 将表达式里的 Python 风格写法翻译为 JS 表达式（函数名沿用历史命名，供测试引用） */
function translatePyToJs(expr: string): string {
  let s = expr;

  // 字面量
  s = s.replace(/\bTrue\b/g, 'true');
  s = s.replace(/\bFalse\b/g, 'false');
  s = s.replace(/\bNone\b/g, 'null');

  // 逻辑运算符
  s = s.replace(/\band\b/g, '&&');
  s = s.replace(/\bor\b/g, '||');
  s = s.replace(/\bnot\b/g, '!');

  // f-string: f"..." 或 f'...' → 模板字符串
  s = s.replace(/\bf(["'])((?:\\.|(?!\1).)*)\1/g, (_m, q, body) => {
    return '`' + String(body).replace(/\{([^}]+)\}/g, '${$1}') + '`';
  });

  // 三元表达式：A if COND else B → (COND ? A : B)
  s = s.replace(/^(.+?)\s+if\s+(.+?)\s+else\s+(.+)$/, '($2 ? $1 : $3)');

  // in 运算符：`x in y` → `__in(x, y)`
  // 支持：变量名、带引号字符串、数字、下标访问
  s = s.replace(/(\w+|'[^']*'|"[^"]*")\s+in\s+(\w+|'[^']*'|"[^"]*")/g, '__in($1, $2)');

  return s;
}

/** 检查表达式安全性 */
function isSafe(expr: string): boolean {
  if (!expr || expr.length > MAX_EXPR_LEN) return false;
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(expr)) return false;
  }
  return true;
}

/**
 * 变量名能否作为 `new Function` 的形参名。
 *
 * 流程图的端口 id 里存在 `new`（variable_persist）、`true`/`false`（branch_if）、`in`、
 * `class` 等 JS 保留字。若把它们塞进形参列表，`new Function` 会抛 SyntaxError，
 * 而下面的 catch 会把它变成 `false` —— 于是「凡是接在这些节点后面的条件分支永远走假
 * 分支」。这里按名剔除，靠这些名字的值本来也无法作为裸标识符在表达式里书写。
 */
const paramNameCache = new Map<string, boolean>();

function isUsableParamName(name: string): boolean {
  const cached = paramNameCache.get(name);
  if (cached !== undefined) return cached;
  let usable = false;
  try {
    new Function(name, 'return 0');
    usable = true;
  } catch {
    usable = false;
  }
  paramNameCache.set(name, usable);
  return usable;
}

/** 求值结果：`ok=false` 时 `error` 一定有值（供需要如实报错的调用方使用） */
export interface EvalResult {
  ok: boolean;
  value: unknown;
  error: string;
}

/**
 * 安全求值表达式（**带错误信息**）。
 *
 * 为什么要有它：`safeEvalExpression` 把"表达式不安全 / 语法错 / 变量不存在"统一压成 `false`，
 * 这对 `branch_if` 是对的（求值失败走假分支），但 `expression_eval` 是个**取值**节点 ——
 * 把错误压成 `false` 等于往流程里塞了一个静默的假值，用户完全看不出来。
 */
export function safeEvalDetailed(expression: string, variables: Record<string, unknown>): EvalResult {
  if (!expression || !expression.trim()) {
    return { ok: false, value: null, error: '表达式为空' };
  }
  const trimmed = expression.trim();
  if (trimmed.length > MAX_EXPR_LEN) {
    return { ok: false, value: null, error: `表达式过长（上限 ${MAX_EXPR_LEN} 字符）` };
  }
  if (!isSafe(trimmed)) {
    return { ok: false, value: null, error: '表达式含被禁止的内容（process / require / __proto__ 等）' };
  }

  try {
    const jsExpr = translatePyToJs(trimmed);

    // 构建受限作用域
    const varNames = Object.keys(variables).filter(
      (k) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) && isUsableParamName(k),
    );
    const varValues = varNames.map((k) => variables[k]);
    // 排除与变量名冲突的白名单函数（避免严格模式下重复参数名报错）
    const varNameSet = new Set(varNames);
    const funcNames = Object.keys(SAFE_FUNCS).filter((k) => !varNameSet.has(k));
    const funcValues = funcNames.map((k) => SAFE_FUNCS[k]);

    // __in 辅助函数
    const __in = (a: unknown, b: unknown): boolean => {
      if (b == null) return false;
      if (typeof b === 'string') return b.includes(String(a));
      if (Array.isArray(b)) return b.includes(a);
      if (typeof b === 'object') return Object.prototype.hasOwnProperty.call(b, a as PropertyKey);
      return false;
    };

    const fn = new Function(
      ...varNames,
      ...funcNames,
      '__in',
      `"use strict"; return (${jsExpr});`,
    );

    return { ok: true, value: fn(...varValues, ...funcValues, __in), error: '' };
  } catch (e) {
    return { ok: false, value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 安全求值表达式。
 * 表达式不安全、超长或求值抛错时统一返回 false。
 */
export function safeEvalExpression(expression: string, variables: Record<string, unknown>): unknown {
  const r = safeEvalDetailed(expression, variables);
  return r.ok ? r.value : false;
}

/** 导出白名单供测试使用 */
export { SAFE_FUNCS, translatePyToJs, isSafe };
