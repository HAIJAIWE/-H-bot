import * as vm from 'node:vm';

/**
 * TypeScript 代码生成工具库
 * 替代原 pythonUtils.ts，提供 TS 代码生成所需的基础工具函数
 */

/** 导入收集器工厂 - 去重 import 语句 */
export function createImportCollector() {
  const imports = new Set<string>();
  return {
    add(imp: string) { imports.add(imp.trim()); },
    has(imp: string) { return imports.has(imp.trim()); },
    toArray() { return Array.from(imports).sort(); },
    toCode() { return Array.from(imports).sort().join('\n'); },
    clear() { imports.clear(); },
  };
}

export type ImportCollector = ReturnType<typeof createImportCollector>;

/** 缩进字符串生成 */
export function indentStr(level: number): string {
  return '    '.repeat(Math.max(0, level));
}

/** TS 字面量序列化（兼容 tsLiteral 别名） */
export function tsLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) {
    return '[' + value.map(tsLiteral).join(', ') + ']';
  }
  if (typeof value === 'object' && value !== null) {
    const pairs = Object.entries(value).map(([k, v]) => tsLiteral(k) + ': ' + tsLiteral(v));
    return '{' + pairs.join(', ') + '}';
  }
  return 'null';
}

/** TS 标识符合法性校验 */
const TS_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
export function isValidTSIdentifier(value: string): boolean {
  return TS_IDENTIFIER_RE.test(value);
}

/** TypeScript 关键字/保留字集合 */
const TS_KEYWORDS = new Set([
  'abstract', 'as', 'any', 'boolean', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'constructor', 'debugger', 'declare', 'default', 'delete', 'do', 'else',
  'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get',
  'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
  'number', 'package', 'private', 'protected', 'public', 'readonly', 'return', 'set',
  'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'implements',
  'private', 'protected', 'public', 'static', 'type', 'infer', 'in', 'keyof', 'extends',
  'never', 'unknown', 'unique', 'override', 'declare', 'module', 'namespace', 'require',
  'global', 'globalThis', 'never', 'asserts', 'assert', 'target', 'meta', 'module',
  'import', 'export', 'default', 'finally', 'do', 'switch', 'case', 'default', 'throw',
  'try', 'catch', 'finally', 'delete', 'new', 'void', 'typeof', 'instanceof',
  'package', 'private', 'protected', 'public', 'static', 'abstract', 'as', 'is', 'type',
  'interface', 'enum', 'object', 'boolean', 'string', 'symbol', 'bigint', 'never',
]);

/** 检查是否为 TS 关键字 */
export function isTSKeyword(word: string): boolean {
  return TS_KEYWORDS.has(word);
}

/** 转义字符串为 TS 字符串字面量 */
export function escapeTSString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** 生成 TS 字符串字面量 */
export function tsStringLiteral(value: string): string {
  return '"' + escapeTSString(value) + '"';
}

/** 生成 TS 模板字面量 (用于模板字符串) */
export function tsTemplateLiteral(parts: string[], values: unknown[]): string {
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    result += parts[i];
    if (i < values.length) {
      result += '';
    }
  }
  return result;
}

/** 生成 TS 对象字面量 */
export function tsObjectLiteral(obj: Record<string, unknown>, indent = 0): string {
  const pairs = Object.entries(obj).map(([k, v]) => indentStr(indent + 1) + tsLiteral(k) + ': ' + tsLiteral(v));
  if (pairs.length === 0) return '{}';
  return '{\n' + pairs.join(',\n') + '\n' + indentStr(indent) + '}';
}

/** 生成 TS 数组字面量 */
export function tsArrayLiteral(arr: unknown[]): string {
  if (!Array.isArray(arr)) return '[]';
  if (arr.length === 0) return '[]';
  return '[' + arr.map(tsLiteral).join(', ') + ']';
}

/** 生成箭头函数 */
export function arrowFunction(params: string[], body: string, async = false): string {
  const asyncPrefix = async ? 'async ' : '';
  const paramsStr = params.length === 1 ? params[0] : '(' + params.join(', ') + ')';
  return asyncPrefix + '(' + paramsStr + ') => ' + body;
}

/** 生成异步箭头函数 */
export function asyncArrowFunction(params: string[], body: string): string {
  return arrowFunction(params, body, true);
}

/** 生成 await 调用 */
export function awaitCall(expr: string): string {
  return 'await ' + expr;
}

/** 生成 try/catch 块 */
export function tryCatch(tryBody: string, catchBody: string, finallyBody?: string): string {
  let code = 'try {\n' + tryBody + '\n} catch (e) {\n' + catchBody + '\n}';
  if (finallyBody) {
    code += '\nfinally {\n' + finallyBody + '\n}';
  }
  return code;
}

/** 生成 if/else 块 */
export function ifElse(condition: string, ifBody: string, elseBody?: string): string {
  let code = 'if (' + condition + ') {\n' + ifBody + '\n}';
  if (elseBody) {
    code += '\nelse {\n' + elseBody + '\n}';
  }
  return code;
}

/** 生成三元表达式 */
export function ternary(condition: string, trueExpr: string, falseExpr: string): string {
  return condition + ' ? ' + trueExpr + ' : ' + falseExpr;
}

/** 生成解构赋值 */
export function destructuring(names: string[], source: string): string {
  return 'const [' + names.join(', ') + '] = ' + source + ';';
}

/** 生成重命名解构赋值 */
export function destructuringRenamed(mapping: Record<string, string>, source: string): string {
  const pairs = Object.entries(mapping).map(([from, to]) => from + ': ' + to);
  return 'const { ' + pairs.join(', ') + ' } = ' + source + ';';
}

/** 生成类型注解 */
export function typeAnnotation(type: string): string {
  return ': ' + type;
}

/** 生成接口定义 */
export function interfaceDef(
  name: string,
  properties: Record<string, string>,
  extendsClause?: string,
): string {
  const extendsStr = extendsClause ? ' extends ' + extendsClause : '';
  const props = Object.entries(properties).map(([k, v]) => '  ' + k + ': ' + v + ';').join('\n');
  return 'interface ' + name + extendsStr + ' {\n' + props + '\n}';
}

/** 生成类型别名 */
export function typeAlias(name: string, type: string): string {
  return 'type ' + name + ' = ' + type + ';';
}

/** 生成函数签名 */
export function functionSignature(
  name: string,
  params: Array<{ name: string; type?: string }>,
  returnType: string,
  async = false,
): string {
  const asyncPrefix = async ? 'async ' : '';
  const paramsStr = params.map((p: { name: string; type?: string }) => p.name + (p.type ? ': ' + p.type : '')).join(', ');
  return asyncPrefix + 'function ' + name + '(' + paramsStr + '): ' + returnType;
}

/** 生成箭头函数类型 */
export function arrowFunctionType(
  params: Array<{ name: string; type?: string }>,
  returnType: string,
  async = false,
): string {
  const asyncPrefix = async ? 'async ' : '';
  const paramsStr = params.map((p: { name: string; type?: string }) => p.name + (p.type ? ': ' + p.type : '')).join(', ');
  return asyncPrefix + '(' + paramsStr + ') => ' + returnType;
}

/** 生成 import 语句 */
export function importStatement(
  module: string,
  imports: Array<{ name: string; alias?: string; type?: boolean }>,
): string {
  const importStr = imports
    .map((imp: { name: string; alias?: string; type?: boolean }) => {
      const typePrefix = imp.type ? 'type ' : '';
      const alias = imp.alias ? ' as ' + imp.alias : '';
      return typePrefix + imp.name + alias;
    })
    .join(', ');
  return 'import { ' + importStr + ' } from ' + "'" + module + "'" + ';';
}

/** 生成导出语句 */
export function exportStatement(
  name: string,
  value?: string,
  isType = false,
  isDefault = false,
): string {
  const typePrefix = isType ? 'type ' : '';
  const defaultPrefix = isDefault ? 'default ' : '';
  const val = value ? ' = ' + value : '';
  return 'export ' + typePrefix + defaultPrefix + name + val + ';';
}

/** 生成 JSDoc 注释 */
export function jsdoc(
  description: string,
  params?: Record<string, string>,
  returns?: string,
): string {
  let doc = '/**\n';
  doc += ' * ' + description + '\n';
  if (params) {
    for (const [param, desc] of Object.entries(params)) {
      doc += ' * @param ' + param + ' ' + desc + '\n';
    }
  }
  if (returns) {
    doc += ' * @returns ' + returns + '\n';
  }
  doc += ' */';
  return doc;
}

/** 生成合法的 TS 标识符（把非法字符替换为下划线后拼接） */
export function tsIdentifier(...parts: string[]): string {
  return parts
    .map(p => p.replace(/[^a-zA-Z0-9_]/g, '_'))
    .join('_');
}

// 导出类型工具
export type {
};
/**
 * 允许的正则 flags：只保留 `i` `m` `s` `u`。
 *
 * 逐个**提取**而不是整串校验：旧实现就是逐字符 includes 提取的，所以 `'gi'`
 * 在过去等价于 `'i'`；换成"整串不合法就清空"会让 `'gi'` 突然变成大小写敏感。
 * `g`/`y` 有意剔除：带 lastIndex 状态，单次 exec 语义下不需要且易出错。
 */
const ALLOWED_FLAGS = 'imsu';

/**
 * 在**带超时**的子上下文里执行一次正则匹配（用户填的 pattern/text 不可信）。
 *
 * @returns `[整体匹配, ...捕获组]`（未参与匹配的组为 undefined）；无匹配/非法/超时 → null
 *
 * 依据：10/18 产物 `expressionSafety-_Iji_53I.js` 的 `runRegexBounded`（同判据、200ms 超时）。
 */
export function runRegexBounded(
  pattern: string,
  text: string,
  flags: string = ''
): (string | undefined)[] | null {
  if (typeof pattern !== 'string' || pattern === '') return null;
  if (typeof text !== 'string' || text === '') return null;
  const safeFlags = [...flags].filter(c => ALLOWED_FLAGS.includes(c)).join('');
  const script = [
    '(function () {',
    '  var re;',
    "  try { re = new RegExp(pattern, flags); } catch (e) { return '{\"ok\":false}'; }",
    '  var m = re.exec(text);',
    "  if (!m) return '{\"ok\":true,\"m\":null}';",
    "  return JSON.stringify({ ok: true, m: Array.prototype.slice.call(m) });",
    '})()',
  ].join('\n');
  let raw: unknown;
  try {
    raw = vm.runInNewContext(script, { pattern, flags: safeFlags, text }, { timeout: 200 });
  } catch {
    return null;
  }
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const box = parsed as { ok?: boolean; m?: unknown };
  if (box.ok !== true || !Array.isArray(box.m)) return null;
  return (box.m as (string | null)[]).map(v => (v === null ? undefined : v));
}
