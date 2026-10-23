/**
 * 批量数据查询纯 TS 实现
 * 历史：由已移除的 qqbat_nodes/builtin/query.py 移植而来，现状以本文件为准
 */

import { getDbSync, extractStoredValue } from './persistentStore';

// ============================================================
// 常量与类型定义
// ============================================================

type Scope = 'user' | 'group' | 'global';

/** 查询 scope 前缀时用到的事件字段 */
interface ScopeEvent {
  user_id?: string | number;
  group_id?: string | number;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

interface QueryOptions {
  mode?: 'list' | 'sort' | 'filter' | 'aggregate';
  key_pattern?: string;
  scope?: Scope;
  sort_by?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  filter_expr?: string;
  aggregate_func?: 'count' | 'sum' | 'avg';
}

interface QueryResult {
  results: unknown[];
  count: number;
  error: string;
}

// ============================================================
// 工具函数
// ============================================================

function parseOperand(operandStr: string): unknown {
  const s = operandStr.trim();
  
  // 带引号字符串
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  
  // 数值
  try {
    if (s.includes('.')) return parseFloat(s);
    return parseInt(s);
  } catch {}
  
  // 布尔
  const low = s.toLowerCase();
  if (low === 'true') return true;
  if (low === 'false') return false;
  if (low === 'null' || low === 'none') return null;
  
  // 裸字符串
  return s;
}

function stripScopePrefix(fullKey: string, scope: string, event: ScopeEvent | null): string {
  const prefixes = {
    user: `user_${event?.user_id}:`,
    group: `group_${event?.group_id}:`,
    global: ''
  };
  const prefix = prefixes[scope as keyof typeof prefixes] || '';
  if (prefix && fullKey.startsWith(prefix)) {
    return fullKey.slice(prefix.length);
  }
  return fullKey;
}

function getSortValue(recordValue: unknown, sortBy: string): unknown {
  if (!sortBy) return recordValue;
  if (typeof recordValue === 'object' && recordValue !== null) {
    return (recordValue as Record<string, unknown>)[sortBy];
  }
  return null;
}

function sortKeyFunc(item: { _sort_value: unknown }): [number, number | string] {
  const v = item._sort_value;
  if (v === null || v === undefined) return [0, 0];
  if (typeof v === 'boolean') return [1, v ? 1 : 0];
  if (typeof v === 'number') return [1, v];
  return [2, String(v)];
}

function matchFilter(recordValue: unknown, field: string, op: string, operand: unknown): boolean {
  let target: unknown;
  if (field === 'value') {
    target = recordValue;
  } else if (typeof recordValue === 'object' && recordValue !== null) {
    target = (recordValue as Record<string, unknown>)[field];
  } else {
    target = null;
  }
  
  if (op === 'contains') {
    if (target == null) return false;
    try {
      return String(target).includes(String(operand));
    } catch {
      return false;
    }
  }
  
  if (target == null) {
    if (op === '==') return operand == null;
    if (op === '!=') return operand != null;
    return false;
  }
  
  try {
    let a: unknown = target;
    let b: unknown = operand;
    
    // 类型转换尝试
    if (typeof a === 'number' && typeof b === 'string') {
      const num = b.includes('.') ? parseFloat(b) : parseInt(b);
      if (!isNaN(num)) b = num;
    }
    if (typeof b === 'number' && typeof a === 'string') {
      const num = a.includes('.') ? parseFloat(a) : parseInt(a);
      if (!isNaN(num)) a = num;
    }

    // 比较语义与 JS 关系运算符一致（值来自 JSON，只可能是原始类型）
    const left = a as number | string;
    const right = b as number | string;
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '>': return left > right;
      case '>=': return left >= right;
      case '<': return left < right;
      case '<=': return left <= right;
      default: return false;
    }
  } catch {
    return false;
  }
}

// ============================================================
// 核心查询函数 - 真正查询 persistentStore 数据库
// ============================================================

export async function query(options: {
  mode?: 'list' | 'sort' | 'filter' | 'aggregate';
  key_pattern?: string;
  scope?: 'user' | 'group' | 'global';
  sort_by?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  filter_expr?: string;
  aggregate_func?: 'count' | 'sum' | 'avg';
  bot?: unknown;
  event?: ScopeEvent;
}): Promise<{ results: unknown[]; count: number; error: string }> {
  try {
    // 参数解析
    const mode = (options.mode || 'list').toLowerCase();
    const keyPattern = options.key_pattern || '*';
    const scope = (options.scope || 'global') as 'user' | 'group' | 'global';
    const sortBy = options.sort_by || '';
    const order = (options.order || 'asc').toLowerCase();
    const aggregateFunc = (options.aggregate_func || 'count').toLowerCase();
    
    // 参数校验
    if (!['user', 'group', 'global'].includes(scope)) {
      return { results: [], count: 0, error: `非法 scope: ${scope}` };
    }
    
    if (!['list', 'sort', 'filter', 'aggregate'].includes(options.mode || 'list')) {
      return { results: [], count: 0, error: `未知 mode: ${options.mode}` };
    }
    
    if (order !== 'asc' && order !== 'desc') {
      options.order = 'asc';
    }
    
    let limit = DEFAULT_LIMIT;
    try {
      const lim = parseInt(String(options.limit));
      if (lim > 0) limit = lim;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    } catch {
      // use default
    }
    
    // 解析 filter 表达式
    let filterField: string | null = null;
    let filterOp: string | null = null;
    let filterOperand: unknown = null;
    
    if (options.mode === 'filter' && options.filter_expr?.trim()) {
      const match = options.filter_expr.trim().match(/^\s*(\w+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+?)\s*$/);
      if (!match) {
        return { results: [], count: 0, error: `filter_expr 格式错误: ${options.filter_expr}` };
      }
      const [, field, op, operand] = match;
      filterField = field;
      filterOp = op;
      filterOperand = parseOperand(operand);
    }
    
    // 聚合函数校验
    if (options.mode === 'aggregate' && !['count', 'sum', 'avg'].includes(aggregateFunc)) {
      return { results: [], count: 0, error: `未知 aggregate_func: ${options.aggregate_func}` };
    }
    
    // 获取数据库连接
    const db = getDbSync();
    
    // 构造 scope 前缀（用于查询）
    const scopePrefix = scope === 'user' 
      ? `user_${options.event?.user_id}:`
      : scope === 'group' 
        ? `group_${options.event?.group_id}:`
        : '';
    
    // 构建 SQL 查询
    let sql = 'SELECT key, value, scope, qq FROM _persistent WHERE 1=1';
    const params: unknown[] = [];
    
    // scope 过滤
    if (scopePrefix) {
      sql += ' AND key LIKE ?';
      params.push(scopePrefix + '%');
    } else if (scope === 'global') {
      sql += ' AND scope = ?';
      params.push('global');
    }
    
    // key_pattern 过滤（转换 * 为 %）
    if (keyPattern && keyPattern !== '*') {
      const pattern = keyPattern.replace(/\*/g, '%');
      sql += ' AND key LIKE ?';
      params.push(pattern);
    }
    
    // 执行查询
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    
    // 处理结果
    let results: Array<Record<string, unknown>> = [];
    
    for (const row of rows) {
      const { value, expired } = extractStoredValue(row.value);
      if (expired) continue;
      
      const key = stripScopePrefix(row.key, scope, { user_id: options.event?.user_id, group_id: options.event?.group_id });
      
      let recordValue = value;
      
      // filter 过滤
      if (filterField && filterOp && filterOperand !== undefined) {
        if (!matchFilter(recordValue, filterField, filterOp, filterOperand)) {
          continue;
        }
      }
      
      results.push({
        key,
        value: recordValue,
        scope: row.scope,
        qq: row.qq
      });
    }
    
    // 排序
    if (mode === 'sort' || mode === 'filter') {
      if (sortBy) {
        results.sort((a, b) => {
          const av = getSortValue(a, sortBy);
          const bv = getSortValue(b, sortBy);
          const [typeA, valA] = sortKeyFunc({ _sort_value: av });
          const [typeB, valB] = sortKeyFunc({ _sort_value: bv });
          if (typeA !== typeB) return typeA - typeB;
          const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
          return order === 'asc' ? cmp : -cmp;
        });
      }
    }
    
    // 聚合
    if (mode === 'aggregate') {
      let aggResult: unknown;
      switch (aggregateFunc) {
        case 'count':
          aggResult = results.length;
          break;
        case 'sum':
          aggResult = results.reduce((sum, r) => {
            const val = getSortValue(r.value, sortBy);
            return sum + (typeof val === 'number' ? val : 0);
          }, 0);
          break;
        case 'avg':
          if (results.length === 0) aggResult = 0;
          else {
            const sum = results.reduce((sum, r) => {
              const val = getSortValue(r.value, sortBy);
              return sum + (typeof val === 'number' ? val : 0);
            }, 0);
            aggResult = sum / results.length;
          }
          break;
      }
      return { results: [{ aggregate: aggResult }], count: results.length, error: '' };
    }
    
    // 应用 limit
    if (limit > 0 && results.length > limit) {
      results = results.slice(0, limit);
    }
    
    return { results, count: results.length, error: '' };
    
  } catch (e) {
    return { results: [], count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export type { QueryOptions, QueryResult };