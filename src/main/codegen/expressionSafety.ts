// src/main/codegen/expressionSafety.ts
// 表达式安全校验 + 调试输出辅助。
// 从 generator.ts 拆分而来，集中管理用户表达式（if_branch/loop while 条件）的安全过滤。
// 防止用户在表达式中注入 __import__ / eval / exec / open / os / sys 等危险代码。
import { pythonLiteral } from './pythonUtils'

/** 安全表达式正则：只允许安全的 Python 表达式字符（含括号以支持函数调用） */
const SAFE_EXPR_RE = /^[a-zA-Z_][a-zA-Z0-9_ .\[\]()<>=!+\-*/%&|^~'",]*$/

/** 允许的安全函数名白名单 */
const SAFE_FUNCTIONS = new Set([
  // 基础类型转换与数学
  'datetime', 'now', 'len', 'str', 'int', 'float', 'bool', 'abs',
  'max', 'min', 'round', 'sum', 'list', 'dict', 'set', 'tuple',
  'range', 'enumerate', 'zip', 'sorted', 'reversed', 'isinstance',
  // L1 扩充：常用安全内置函数
  'any', 'all', 'map', 'filter', 'format', 'repr', 'chr', 'ord',
  'hash', 'divmod', 'pow',
  // 注意：不包含 type/callable/hasattr/getattr 等元编程函数——
  // 它们可被用于构造 __bases__/__subclasses__ 链定位 subprocess 执行任意命令
  // （见 isExpressionSafe 的绕过说明）。
  // 字符串方法（方法调用 s.method() 也会被提取检查）
  'split', 'join', 'replace', 'strip', 'upper', 'lower',
  'startswith', 'endswith', 'find', 'count', 'isdigit', 'isalpha', 'isalnum',
  'encode', 'decode', 'title', 'capitalize', 'lstrip', 'rstrip', 'ljust', 'rjust',
  // 列表方法
  'append', 'extend', 'insert', 'remove', 'pop', 'index', 'sort', 'reverse', 'copy',
  // 字典方法
  'get', 'keys', 'values', 'items', 'update', 'fromkeys', 'setdefault',
])

/** 危险关键字黑名单：禁止模块导入和危险函数 */
const DANGEROUS_PATTERNS = [
  /__\w+__/,              // dunder 方法（__import__, __builtins__ 等）
  /\bimport\b/,           // import 语句
  /\bexec\b/,             // exec 函数
  /\beval\b/,             // eval 函数
  /\bopen\b/,             // open 函数
  /\bos\b/,               // os 模块
  /\bsys\b/,              // sys 模块
  /\bsubprocess\b/,       // subprocess 模块
]

/**
 * 将用 `+` 连接的相邻字符串字面量折叠为单个字面量（解码转义）。
 *
 * 用于发现把黑名单词拆成片段拼接的绕过，例如 `'sub'+'process'`、
 * `'_'+'_class_'+'_'`：原始文本不匹配任何黑名单正则，折叠后即可命中。
 */
function foldAdjacentStringLiterals(expr: string): string {
  const STR = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`
  const SEQUENCE = new RegExp(
    STR + String.raw`(?:\s*\+\s*` + STR + ')+',
    'g'
  )
  return expr.replace(SEQUENCE, (m) => {
    const parts = m.split(/\s*\+\s*/)
    let out = ''
    for (const p of parts) {
      const body = p.slice(1, -1)
      out += body.replace(/\\(['"\\nrtbf])/g, (_whole, c: string) => {
        switch (c) {
          case 'n': return '\n'
          case 't': return '\t'
          case 'r': return '\r'
          case 'b': return '\b'
          case 'f': return '\f'
          default: return c
        }
      })
    }
    return JSON.stringify(out)
  })
}

/** 检查表达式中的函数调用是否都在白名单中 */
export function isExpressionSafe(expr: string): boolean {
  if (!SAFE_EXPR_RE.test(expr)) return false
  if (DANGEROUS_PATTERNS.some((re) => re.test(expr))) return false
  // dunder 属性访问（x.__class__ / x.__bases__ / x.__subclasses__ 等）
  if (/\.\s*__\w+__/.test(expr)) return false
  // 表达式结果被当作函数调用（(...)(...) / (...)[i](...) 链式调用），
  // 无法用"函数名白名单"约束，且常被用于 object.__subclasses__()[0](...) 攻击链
  if (/\)\s*\(/.test(expr) || /\]\s*\(/.test(expr)) return false
  // 字符串字面量拼接折叠后重查黑名单，拦截 'sub'+'process' 式拆分绕过
  if (DANGEROUS_PATTERNS.some((re) => re.test(foldAdjacentStringLiterals(expr)))) {
    return false
  }
  // 提取所有函数调用名，检查是否在白名单中
  const callMatches = expr.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)
  for (const m of callMatches) {
    if (!SAFE_FUNCTIONS.has(m[1])) return false
  }
  return true
}

/** 安全地转义 debug 标签：返回 Python 字符串字面量（含外层引号），用于在 f-string 外拼接。
 *
 * 注意：不能直接放入 f-string 内部（如 `f"...{safeDebugLabel(label)}..."`）），
 * 因为字面量自带双引号会与 f-string 外层引号冲突，产生 Python 语法错误。
 * 正确用法见 emitDebugPausePrint：在 f-string 外用字符串拼接。
 */
export function safeDebugLabel(label: string): string {
  return pythonLiteral(label)
}

/** 生成 debug 暂停 print 语句：[DEBUG:PAUSE:<nodeId>:<label>:trace_id=<traceVar>]。
 *
 * 安全修复：nodeId 和 label 都通过 pythonLiteral 转义为 Python 字符串字面量，
 * 然后在 f-string 外用 `+` 拼接，避免 f-string 内部嵌套引号导致 Python 语法错误，
 * 同时防止 label/nodeId 含有 `{` `}` `"` 等字符破坏 f-string 或注入代码。
 */
export function emitDebugPausePrint(
  indent: string,
  nodeId: string,
  label: string,
  traceVar: string
): string {
  // 生成：print("[DEBUG:PAUSE:" + "<nodeId>" + ":" + "<label>" + f":trace_id={traceVar}]")
  return `${indent}print("[DEBUG:PAUSE:" + ${safeDebugLabel(nodeId)} + ":" + ${safeDebugLabel(label)} + f":trace_id={${traceVar}}]")`
}

// ─────────────────────────────────────────────────────────────────────────────
// TS 代码生成侧的安全校验（checkExpressionSafety）
//
// 与上面的 Python 版**判据同源、调用形态不同**：
//   · Python 侧只要布尔（isExpressionSafe），失败就退回常量/禁用分支；
//   · TS 生成器要把**原因**回报给用户（"哪条表达式、为什么被拒"），所以这里收集 errors。
// 字符集用宽松版（允许 {}、中文、引号开头），安全性由黑名单 + 函数白名单兜底 ——
// 收紧字符集会误杀合法表达式（字典字面量、切片、中文字符串常量），这是 S3 修过的坑。
// ─────────────────────────────────────────────────────────────────────────────

/** 代码生成器可诊断的安全校验结果 */
export interface ExpressionSafetyResult {
  safe: boolean
  errors: string[]
}

/** TS 生成侧的字符集（比 isExpressionSafe 更宽：允许 dict 字面量 / 中文字符串） */
const SAFE_TS_EXPR_RE =
  /^[a-zA-Z0-9_\-[\{'"(][a-zA-Z0-9_ .[\]()<>=!+\-*/%&|^~'",:{}0-9\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]*$/

/** 检查表达式中的函数调用是否都在白名单中（与 Python 侧同一张表，避免两套"安全"定义漂移） */
function hasComputedCall(expr: string): boolean {
  return /\]\s*\(/.test(expr)
}

function hasChainedInvocation(expr: string): boolean {
  return /\)\s*\(/.test(expr) || hasComputedCall(expr)
}

/**
 * 检查一条表达式能否安全写进生成的代码；失败时给出**人读原因**。
 *
 * 逐项检查（不短路）：字符集 → 黑名单 → dunder 访问 → 链式调用 → 折叠后黑名单 → 函数白名单。
 */
export function checkExpressionSafety(expr: string): ExpressionSafetyResult {
  const errors: string[] = []
  if (!SAFE_TS_EXPR_RE.test(expr)) errors.push('表达式含不允许的字符')
  if (DANGEROUS_PATTERNS.some((re) => re.test(expr))) {
    errors.push('表达式含禁用关键字（import/exec/eval/open/os/sys/subprocess 或 dunder）')
  }
  if (/\.\s*__\w+__/.test(expr)) errors.push('表达式含 dunder 属性访问')
  const folded = foldAdjacentStringLiterals(expr)
  if (hasChainedInvocation(expr) || hasChainedInvocation(folded)) errors.push('表达式含链式调用')
  if (DANGEROUS_PATTERNS.some((re) => re.test(folded))) {
    errors.push('表达式含拼接隐藏的禁用关键字')
  }
  for (const m of expr.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)) {
    if (!SAFE_FUNCTIONS.has(m[1])) errors.push('调用了未授权函数: ' + m[1])
  }
  return { safe: errors.length === 0, errors }
}
