import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 可聚焦元素选择器（与 Modal 一致，用于 Tab 焦点陷阱） */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** 搜索框值（受控） */
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  /** 可选项总数（用于 ↑↓ 键盘导航边界） */
  itemCount: number;
  /** Enter 选中某个索引时回调 */
  onSelect: (index: number) => void;
  /** 渲染结果列表，通过 render prop 暴露 selectedIndex 与 setSelectedIndex */
  children: (ctx: { selectedIndex: number; setSelectedIndex: (i: number) => void }) => ReactNode;
  width?: string;
}

/**
 * 命令面板组件（Cmd+K 模式）
 *
 * 与 Modal 的区别：
 * - 顶部对齐（pt-[15vh]）而非居中
 * - 无标题栏，顶部直接是搜索输入框
 * - 键盘导航：↑↓ 选择、Enter 确认、Esc 关闭
 * - 底部固定快捷键提示栏
 *
 * 搜索/过滤逻辑由父组件负责（通过 query + itemCount 传入），
 * 本组件只负责面板布局、键盘导航与选中状态管理。
 */
export function CommandPalette({
  open,
  onClose,
  query,
  onQueryChange,
  placeholder = t('ui.searchPlaceholder'),
  itemCount,
  onSelect,
  children,
  width = '520px',
}: CommandPaletteProps) {
  useLocaleSubscription();
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 用 ref 保存最新值，避免 keydown 监听器频繁重绑
  const selectedIndexRef = useRef(0);
  const itemCountRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  const onCloseRef = useRef(onClose);
  selectedIndexRef.current = selectedIndex;
  itemCountRef.current = itemCount;
  onSelectRef.current = onSelect;
  onCloseRef.current = onClose;

  // 结果数变化时重置选中项
  useEffect(() => {
    setSelectedIndex(0);
  }, [itemCount]);

  // 打开时自动聚焦输入框；关闭后恢复焦点
  useEffect(() => {
    if (open) {
      // 记录当前焦点元素
      const prevFocus = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        // 关闭时恢复焦点
        if (prevFocus) prevFocus.focus();
      };
    }
  }, [open]);

  // 键盘导航：↑↓ 选择 / Enter 确认 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, Math.max(itemCountRef.current - 1, 0)));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (itemCountRef.current > 0) {
            onSelectRef.current(selectedIndexRef.current);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onCloseRef.current();
          break;
        case 'Tab': {
          // Tab 焦点陷阱：与 Modal 一致，Tab 在面板内循环，不跳到背景元素
          if (!contentRef.current) break;
          const focusable = contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
          if (focusable.length === 0) {
            e.preventDefault(); // 无可聚焦元素，Tab 留在 input
            break;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (e.shiftKey) {
            if (active === first || !contentRef.current.contains(active)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (active === last || !contentRef.current.contains(active)) {
              e.preventDefault();
              first.focus();
            }
          }
          break;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={contentRef}
        className="flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        style={{ width, maxHeight: '480px' }}
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
      >
        {/* 搜索输入框 */}
        <div className="border-b border-zinc-800">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>

        {/* 结果列表 */}
        <div className="flex-1 overflow-auto">{children({ selectedIndex, setSelectedIndex })}</div>

        {/* 快捷键提示 */}
        <div className="flex items-center gap-4 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          <span>{t('ui.kbdUpDown')}</span>
          <span>{t('ui.kbdEnter')}</span>
          <span>{t('ui.kbdEsc')}</span>
        </div>
      </div>
    </div>
  );
}
