// src/renderer/src/components/launch/fieldValues.ts
//
// **值的读写与显示**：布尔判定、存储值 ↔ 输入框字符串、显示格式化（含持久化值的解包）。
//
// 这里的两条转换（valueToInput / inputToValue）必须**成对**改：一条负责"存进去的值怎么显示"，
// 一条负责"用户改完怎么存回去" —— 只改一边就会出现"打开编辑器值变了"或"改完没保存"。

import { getLocale, t } from '../../i18n';
import { type FieldType } from './dataBrowserData';
import { unwrapPersistentValue } from '@shared/persist/value';

/** 获取字段的原始 key（去掉前缀） */
export function getRawKey(fullKey: string): string {
  const parts = fullKey.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : parts[0];
}

/** 判断值是否为布尔类型 */
export function isBooleanValue(val: unknown): boolean {
  return val === true || val === false || val === 'true' || val === 'false';
}

/** 将值解析为布尔 */
export function toBooleanValue(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return Boolean(val);
}

/** 将存储值转换为 input 可显示的字符串 */
export function valueToInput(value: unknown, type: FieldType): string {
  // `_persistent` 的原始值是 `{"value":x,"expire_at":t}` 包装。
  // 不解包的话编辑框里会是 `{"value":55,"expire_at":null}` —— 用户改的是**存储格式**，
  // 不是他的数据。这里统一解包（非包装的裸值原样通过）。
  const inner = unwrapPersistentValue(value);
  value = inner;
  if (value === null || value === undefined) return '';
  if (type === 'datetime') {
    let ms: number;
    if (typeof value === 'number') {
      ms = value > 1e11 ? value : value * 1000;
    } else {
      ms = new Date(String(value)).getTime();
    }
    if (!isNaN(ms)) {
      const d = new Date(ms);
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        'T' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes())
      );
    }
    return '';
  }
  if (type === 'boolean') {
    return toBooleanValue(value) ? 'true' : 'false';
  }
  if (type === 'json') {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (type === 'number') {
    return String(value);
  }
  return String(value);
}

/** 将 input 字符串转换回存储值 */
export function inputToValue(input: string, type: FieldType, originalValue: unknown): unknown {
  if (type === 'number') {
    const n = parseFloat(input);
    return isNaN(n) ? 0 : n;
  }
  if (type === 'boolean') {
    return input === 'true' || input === '1';
  }
  if (type === 'datetime') {
    const d = new Date(input);
    if (isNaN(d.getTime())) return originalValue;
    if (typeof originalValue === 'number') {
      return originalValue > 1e11 ? d.getTime() : Math.floor(d.getTime() / 1000);
    }
    return d.toISOString();
  }
  if (type === 'date') {
    return input;
  }
  if (type === 'json') {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  return input;
}

export function formatValue(val: unknown, col?: string): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? t('data.yes') : t('data.no');
  if (typeof val === 'number') {
    if (
      col?.toLowerCase().includes('time') ||
      col?.toLowerCase().includes('date') ||
      col?.toLowerCase().includes('at')
    ) {
      const ms = val > 1e11 ? val : val * 1000;
      const d = new Date(ms);
      if (d.getFullYear() > 2000 && d.getFullYear() < 2100)
        return d.toLocaleString(getLocale(), {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
    }
    if (Math.abs(val) >= 10000 && Number.isInteger(val)) return val.toLocaleString(getLocale());
    // 整数浮点数去掉小数点 (42.0 → 42)
    if (Number.isInteger(val)) return String(val);
    return String(val);
  }
  // 字符串类型：尝试解析 JSON
  if (typeof val === 'string') {
    // 时间戳字符串
    if (
      col?.toLowerCase().includes('time') ||
      col?.toLowerCase().includes('date') ||
      col?.toLowerCase().includes('at')
    ) {
      const d = new Date(val);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        return d.toLocaleString(getLocale(), {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
    // 数字字符串 (42.0 → 42, 3.14 → 3.14)
    const trimmed = val.trim();
    if (/^-?\d+\.0+$/.test(trimmed)) return String(parseInt(trimmed, 10));
    if (/^-?\d+\.\d+$/.test(trimmed)) {
      const n = parseFloat(trimmed);
      if (!isNaN(n) && Number.isInteger(n)) return String(n);
    }
    // JSON 字符串
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed));
      } catch {
        /* 忽略 */
      }
    }
  }
  // 对象 / 数组（已解包的背包、卡组、配置等）→ JSON 文本。
  // 少了这一条，`String({})` 会渲染成 `[object Object]` —— 面板上写着
  // `bag [object Object]`，用户什么也看不到。
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/** 判断字段值是否为空/零（不展示）。关键字段（hp/mp/level 等）的 0 值仍然展示 */
export function isEmptyValue(value: string): boolean {
  return value === '—' || value === '' || value === t('data.no') || value === 'false';
}

export function isPlayersTable(t: string): boolean {
  return t === 'players';
}

export function isPersistentTable(t: string): boolean {
  return t === '_persistent';
}
