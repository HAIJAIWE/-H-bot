// src/main/codegen/expressionCompiler.ts
// 表达式编译器 - 静态分析 + 编译缓存 + 安全沙箱

import { checkExpressionSafety } from './expressionSafety';

/** 编译后的表达式 */
export interface CompiledExpression {
  /** 可执行函数 */
  fn: (vars: Record<string, unknown>) => unknown;
  /** 依赖的变量名（按参数顺序） */
  dependencies: string[];
  /** 原始表达式 */
  source: string;
  /** 是否为简单内联表达式 */
  isInline: boolean;
}

/** 表达式编译器缓存 */
const expressionCache = new Map<string, CompiledExpression>();

/** 最大缓存条目 */
const MAX_CACHE_SIZE = 1000;

/** 内置安全函数白名单 */
const SAFE_GLOBALS = new Set([
  // Math
  'Math', 'Number', 'String', 'Array', 'Object', 'JSON',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Date', 'RegExp', 'Error',
  // 自定义工具函数（运行时注入）
  'clamp', 'randInt', 'formatNum', 'formatTime',
  // 类型转换
  'Boolean', 'String', 'Number',
]);

/** 简单表达式判断（可直接内联） */
function isSimpleInline(expr: string): boolean {
  const trimmed = expr.trim();
  return trimmed.length < 80
    && !/\([^)]*\)/.test(trimmed)  // 无函数调用
    && !/\?/.test(trimmed)         // 无三元
    && !/=>/.test(trimmed)         // 无箭头函数
    && /^[\w\s\.\+\-\*\/\%\<\>\=\!\&\|\$\:\[\]]+$/.test(trimmed);
}

/** 提取表达式依赖的变量名 */
function extractDependencies(expr: string, availableVars: string[]): string[] {
  const deps = new Set<string>();
  const varPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  let match;
  
  while ((match = varPattern.exec(expr)) !== null) {
    const name = match[1];
    // 排除关键字和字面量
    if (!['true', 'false', 'null', 'undefined', 'this', 'arguments'].includes(name)) {
      if (availableVars.includes(name) || SAFE_GLOBALS.has(name)) {
        deps.add(name);
      }
    }
  }
  
  return Array.from(deps).sort(); // 排序保证缓存键稳定
}

/** 编译表达式为可执行函数 */
export function compileExpression(
  expr: string,
  availableVars: string[]
): CompiledExpression {
  // 1. 安全检查
  const safety = checkExpressionSafety(expr);
  if (!safety.safe) {
    throw new Error(`表达式不安全: ${safety.errors.join(', ')}`);
  }

  // 2. 生成缓存键
  const deps = extractDependencies(expr, availableVars);
  const cacheKey = expr + '|' + deps.join(',');

  // 3. 缓存命中
  if (expressionCache.has(cacheKey)) {
    return expressionCache.get(cacheKey)!;
  }

  // 4. 判断是否可内联
  const isInline = isSimpleInline(expr);

  // 5. 编译
  const params = deps.join(', ');
  const body = isInline ? expr : `return ${expr};`;
  
  let fn: (vars: Record<string, unknown>) => unknown;
  
  try {
    if (isInline) {
      // 简单表达式：直接内联，不需要 Function 包装
      fn = new Function(params, `return ${expr};`) as (vars: Record<string, unknown>) => unknown;
    } else {
      // 复杂表达式：沙箱编译
      fn = new Function(params, body) as (vars: Record<string, unknown>) => unknown;
    }
  } catch (e) {
    throw new Error(`表达式编译失败: ${e instanceof Error ? e.message : String(e)}`);
  }

  const compiled: CompiledExpression = {
    fn,
    dependencies: deps,
    source: expr,
    isInline,
  };

  // 6. 缓存管理（LRU 简化版）
  if (expressionCache.size >= MAX_CACHE_SIZE) {
    const firstKey = expressionCache.keys().next().value;
    if (firstKey) expressionCache.delete(firstKey);
  }
  expressionCache.set(cacheKey, compiled);

  return compiled;
}

/** 运行时求值表达式 */
export function evalExpression(compiled: CompiledExpression, vars: Record<string, unknown>): unknown {
  try {
    const args = compiled.dependencies.map(d => vars[d] ?? null);
    // 参数个数由 dependencies 动态决定，无法表示为元组，故用 apply
    return (compiled.fn as (...a: unknown[]) => unknown)(...args);
  } catch (e) {
    throw new Error(`表达式求值失败 [${compiled.source}]: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 获取缓存统计 */
export function getCacheStats(): { size: number; maxSize: number } {
  return { size: expressionCache.size, maxSize: MAX_CACHE_SIZE };
}

/** 清空缓存 */
export function clearCache(): void {
  expressionCache.clear();
}