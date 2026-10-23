import { useEffect, useState } from 'react'

/**
 * 返回一个防抖后的值。
 *
 * 当 `value` 变化后，等待 `delayMs` 毫秒才更新返回值；
 * 若在等待期间 `value` 再次变化，则重置计时器。
 *
 * 用于搜索框输入等高频更新场景，避免每次按键都触发昂贵的过滤/远程请求。
 *
 * @example
 * const [text, setText] = useState('')
 * const debounced = useDebouncedValue(text, 300)
 * useEffect(() => { runSearch(debounced) }, [debounced])
 *
 * @param value 需要防抖的值（任意类型）
 * @param delayMs 延迟毫秒数；<= 0 表示立即返回（不防抖）
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
