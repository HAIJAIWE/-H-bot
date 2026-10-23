import { useCallback, useRef } from 'react';

/**
 * 为动态增删列表维护稳定的 React key 数组，避免用数组索引作 key
 * 导致删除/编辑时 DOM 错位、输入焦点丢失。
 *
 * - 长度增长（add / JSON 应用 / 外部重置）：自动追加新 key
 * - 长度缩短（外部重置 / undo / redo）：截断到目标长度
 * - 删除指定索引：调用方需在 splice 数据前先调用 removeKey(idx)
 *
 * 返回 [keys, removeKey] —— keys 直接传给 React 的 key 属性。
 *
 * @example
 * const [keys, removeKey] = useStableKeys(items.length)
 * // 渲染：items.map((item, idx) => <div key={keys[idx]}>...</div>)
 * // 删除：removeKey(idx); setItems(items.filter((_, i) => i !== idx))
 */
export function useStableKeys(length: number): [string[], (idx: number) => void] {
  const keysRef = useRef<string[]>([]);
  const counterRef = useRef(0);

  if (keysRef.current.length !== length) {
    if (keysRef.current.length < length) {
      while (keysRef.current.length < length) {
        counterRef.current += 1;
        keysRef.current.push(`k${counterRef.current}`);
      }
    } else {
      keysRef.current.length = length;
    }
  }

  const removeKey = useCallback((idx: number) => {
    keysRef.current.splice(idx, 1);
  }, []);

  return [keysRef.current, removeKey];
}
