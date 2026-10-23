import type { ReactNode } from 'react';
import { useRef, useEffect, useId } from 'react';
import { Button } from './Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// C1 修复：用 ref 持有最新 onClose，effect 依赖只留 [open]。
// 原实现依赖 [open, onClose]，父组件传内联箭头函数（onClose={() => setShow(false)}）时，
// 每次父组件 re-render 都会让 onClose 引用变化 → effect 重跑 → cleanup→重绑 keydown，
// 且重新执行 focusStack.push(activeElement) 重复压栈。关闭时只 pop 一次，栈里残留脏元素，
// 堆叠 Modal 场景下焦点会跳到错误位置。

/**
 * 焦点栈：堆叠 Modal 场景下（如 Modal 内再开确认 Modal），按 LIFO 顺序恢复焦点。
 * 原实现用单一模块级变量，第二个 Modal 的 open 会覆盖第一个 Modal 记录的焦点元素，
 * 导致关闭后焦点跳到错误位置。
 */
const focusStack: (HTMLElement | null)[] = [];

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, width = '520px' }: ModalProps) {
  useLocaleSubscription();
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 用 ref 持有最新 onClose，避免其进入 effect 依赖（见文件顶部 C1 修复说明）
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 打开时聚焦 Modal 容器，监听 ESC 关闭与 Tab 焦点循环；关闭后恢复焦点
  // 依赖仅 [open]：只在 open 翻转时压栈/出栈，父组件 re-render 不会重复压栈
  useEffect(() => {
    if (!open) {
      // 弹出栈顶（本 Modal 记录的焦点），避免堆叠 Modal 互相覆盖
      const prev = focusStack.pop();
      if (prev) prev.focus();
      return;
    }
    // 压栈当前焦点
    focusStack.push(document.activeElement as HTMLElement | null);

    const modal = modalRef.current;
    if (!modal) return;

    modal.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !modal.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !modal.contains(active)) {
          e.preventDefault();
          first.focus();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl flex flex-col max-h-[80vh] max-w-[90vw] outline-none"
        style={{ width }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
          <span id={titleId} className="text-sm font-medium text-zinc-200">
            {title}
          </span>
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
            onClick={onClose}
            aria-label={t('launch.common.close')}
          >
            &times;
          </button>
        </div>
        {/* 内容 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {/* 底部按钮 */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 通用底部按钮 */
export function ModalFooter({
  onCancel,
  onConfirm,
  cancelText = t('launch.common.cancel'),
  confirmText = t('launch.common.save'),
  confirmDisabled = false,
  confirmVariant = 'primary',
  confirmTitle,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  cancelText?: string;
  confirmText?: string;
  confirmDisabled?: boolean;
  confirmVariant?: 'primary' | 'danger';
  /** 禁用时悬停提示（解释为何禁用） */
  confirmTitle?: string;
}) {
  useLocaleSubscription();
  return (
    <>
      <Button variant="secondary" size="md" onClick={onCancel}>
        {cancelText}
      </Button>
      <Button
        variant={confirmVariant}
        size="md"
        onClick={onConfirm}
        disabled={confirmDisabled}
        title={confirmDisabled && confirmTitle ? confirmTitle : undefined}
      >
        {confirmText}
      </Button>
    </>
  );
}
