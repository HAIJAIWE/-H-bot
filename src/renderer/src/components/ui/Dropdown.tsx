import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { inputForm } from './inputStyles';

interface DropdownOption<T extends string | number = string> {
  value: T;
  label: string;
  /** 可选分组：有 group 字段时按组渲染（组标题分隔），提升多选项可查找性。
   *  无 group 的选项平铺（向后兼容现有调用方）。 */
  group?: string;
}

interface DropdownProps<T extends string | number = string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly DropdownOption<T>[];
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 可访问名称（屏幕阅读器读取） */
  ariaLabel?: string;
}

export function Dropdown<T extends string | number = string>({
  value,
  onChange,
  options,
  className = '',
  placeholder,
  disabled,
  ariaLabel,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // a11y：combobox 用 aria-activedescendant 指向当前高亮 option 的 id，
  // 屏幕阅读器据此播报键盘导航选中项（无此属性则只播报 button 文本，无法感知 ↑↓ 高亮）
  const baseId = useId();
  const optionId = (idx: number) => `${baseId}-opt-${idx}`;
  // Portal 浮层位置：脱离父级 stacking context（React Flow 节点的 transform 会创建独立层叠上下文，
  // 导致 absolute z-50 浮层被相邻节点遮挡）。用 fixed + 屏幕坐标定位到 body，避免遮挡。
  const [floatPos, setFloatPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const close = useCallback(() => {
    setOpen(false);
    setHighlightedIndex(-1);
    setFloatPos(null);
  }, []);

  // 外部点击关闭：同时检查触发按钮容器和浮层（浮层 Portal 到 body 后不在 ref 内）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (listRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // 打开时重置高亮 + 计算浮层位置（按钮屏幕坐标 + 底部溢出改上方）
  useEffect(() => {
    if (!open) {
      setFloatPos(null);
      return;
    }
    setHighlightedIndex(-1);
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const LIST_MAX_H = 192; // max-h-48 = 12rem = 192px
    const vh = window.innerHeight;
    // 底部空间不足 → 浮层改按钮上方；否则放按钮下方 +4px
    const top =
      rect.bottom + LIST_MAX_H > vh ? Math.max(8, rect.top - LIST_MAX_H - 4) : rect.bottom + 4;
    setFloatPos({ top, left: rect.left, width: rect.width });
  }, [open]);

  // 滚动/resize 时关闭浮层（位置会失效，避免浮层漂移）
  // 用捕获阶段监听以覆盖所有可滚动容器；但浮层列表自身滚动（max-h-48 overflow-y-auto）
  // 也会先触发捕获，此时目标在 listRef 内，应跳过关闭，否则用户滚动选项时浮层会闪退
  useEffect(() => {
    if (!open) return;
    const closeOnScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => {
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [open, close]);

  /** 键盘导航：↑↓ 选择 / Enter 确认 / Esc 关闭 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          onChange(options[highlightedIndex].value);
          close();
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  // 高亮项滚动到可视区域（分组渲染后 listRef.children 是组容器而非按钮，用 data-idx 定位）
  useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelector(`[data-idx="${highlightedIndex}"]`) as
      HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, open]);

  const selected = options.find((o) => o.value === value);
  const displayText = selected ? selected.label : (placeholder ?? '');

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-owns={open ? `${baseId}-listbox` : undefined}
        aria-activedescendant={
          open && highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
        }
        className={`w-full ${inputForm} disabled:opacity-50 text-left flex items-center justify-between`}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      >
        <span className={displayText ? '' : 'text-zinc-500'}>
          {displayText || placeholder || ''}
        </span>
        <svg
          className="w-3 h-3 text-zinc-500 ml-1 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
          />
        </svg>
      </button>
      {open &&
        floatPos &&
        createPortal(
          <div
            ref={listRef}
            id={`${baseId}-listbox`}
            className="fixed z-[9999] bg-zinc-800 border border-zinc-700 rounded shadow-lg max-h-48 overflow-y-auto"
            style={{
              top: `${floatPos.top}px`,
              left: `${floatPos.left}px`,
              width: `${floatPos.width}px`,
            }}
            role="listbox"
          >
            {(() => {
              // 单个选项按钮（data-idx 用于分组后 scrollIntoView 定位）
              const renderOption = (opt: DropdownOption<T>, idx: number) => (
                <button
                  key={String(opt.value)}
                  id={optionId(idx)}
                  data-idx={idx}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  className={`w-full text-left px-2 py-1 text-sm transition-colors ${
                    idx === highlightedIndex ? 'bg-zinc-700' : ''
                  } ${opt.value === value ? 'bg-zinc-700 text-blue-400' : 'text-zinc-200 hover:bg-zinc-700'}`}
                  onClick={() => {
                    onChange(opt.value);
                    close();
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  {opt.label}
                </button>
              );
              // 无分组 → 平铺（向后兼容现有调用方）
              if (!options.some((o) => o.group)) {
                return options.map((opt, idx) => renderOption(opt, idx));
              }
              // 有分组 → 按 group 字段分组（保留插入顺序），每组前渲染粘性组标题
              const groupMap = new Map<string, { opt: DropdownOption<T>; idx: number }[]>();
              options.forEach((opt, idx) => {
                const g = opt.group ?? '';
                if (!groupMap.has(g)) groupMap.set(g, []);
                groupMap.get(g)!.push({ opt, idx });
              });
              return Array.from(groupMap.entries()).map(([groupName, items]) => (
                <div key={groupName || '__none__'}>
                  {groupName && (
                    <div className="px-2 py-0.5 text-[10px] text-zinc-500 bg-zinc-900/60 sticky top-0 z-10 border-b border-zinc-700/50">
                      {groupName}
                    </div>
                  )}
                  {items.map(({ opt, idx }) => renderOption(opt, idx))}
                </div>
              ));
            })()}
          </div>,
          document.body,
        )}
    </div>
  );
}
