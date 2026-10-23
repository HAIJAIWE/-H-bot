// 从 PropertyDrawer.tsx 拆分而来（P0-D1 重构）
// 防抖文本输入组件：本地 state 即时反馈，store 更新延迟 300ms。
// 避免每次按键都触发 pushHistory 全量深拷贝 + 全量重渲染。
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 防抖文本字段：本地 state 即时反馈，store 更新延迟 delayMs。
 * delayMs <= 0 时同步立即提交（非节点场景如面板编辑器，保测试契约与即时性）。
 */
export function useDebouncedField<T>(
  externalValue: T,
  onCommit: (v: T) => void,
  delayMs = 300,
): [T, (v: T) => void] {
  const [local, setLocal] = useState<T>(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // 外部值变化时同步本地（如 undo/redo、切换节点）
  useEffect(() => {
    // 切换节点时取消未提交的防抖写入，防止把上一节点的值提交到新节点
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLocal(externalValue);
  }, [externalValue]);

  const setValue = useCallback(
    (v: T) => {
      setLocal(v);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (delayMs <= 0) {
        timerRef.current = null;
        onCommitRef.current(v);
        return;
      }
      timerRef.current = setTimeout(() => {
        onCommitRef.current(v);
      }, delayMs);
    },
    [delayMs],
  );

  // 卸载时刷新未提交的值（使用 ref 避免闭包捕获过时的 local）
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        onCommitRef.current(localRef.current);
      }
    };
    // 卸载时清理 effect，仅执行一次，无需依赖
  }, []);

  return [local, setValue];
}

/** 防抖文本输入：即时反馈本地 state，延迟提交到 store */
export function DebouncedTextInput({
  value,
  onChange,
  placeholder,
  className,
  list,
  ariaLabel,
  type,
  step,
  inputMode,
  delayMs = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  list?: string;
  ariaLabel?: string;
  type?: string;
  step?: string | number;
  inputMode?: 'text' | 'numeric' | 'decimal';
  delayMs?: number;
}) {
  const [local, setLocal] = useDebouncedField(value, onChange, delayMs);
  return (
    <input
      type={type ?? 'text'}
      step={step}
      inputMode={inputMode}
      list={list}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
    />
  );
}

/** 防抖多行文本：即时反馈本地 state，延迟提交到 store */
export function DebouncedTextarea({
  value,
  onChange,
  placeholder,
  rows,
  className,
  ariaLabel,
  delayMs = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  ariaLabel?: string;
  delayMs?: number;
}) {
  const [local, setLocal] = useDebouncedField(value, onChange, delayMs);
  return (
    <textarea
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={rows}
      className={className}
    />
  );
}
