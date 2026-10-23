// 全局 Toast 系统：ToastProvider + useToast，用 createPortal 挂载到 body

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** Toast 类型 */
type ToastType = 'success' | 'error' | 'warning' | 'info';

/** 单条 Toast 数据 */
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

/** useToast 返回值 */
interface ToastContextValue {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * 模块级 toast 持有器：ToastProvider 挂载时填充，卸载时清空。
 * 供非组件环境（如 zustand store）通过 `toast` 调用，避免 useToast 必须在组件内使用的限制。
 */
let toastHolder: ToastContextValue | null = null;

/**
 * 非 hook 版 toast：可在 React 组件外（如 zustand store、定时器回调）调用。
 * 若 ToastProvider 尚未挂载，调用会被静默丢弃（不抛错），避免初始化阶段崩溃。
 */
export const toast: ToastContextValue = {
  success: (message, duration) => {
    toastHolder?.success(message, duration);
  },
  error: (message, duration) => {
    toastHolder?.error(message, duration);
  },
  warning: (message, duration) => {
    toastHolder?.warning(message, duration);
  },
  info: (message, duration) => {
    toastHolder?.info(message, duration);
  },
};

/** 类型对应的左侧边框颜色 */
const TYPE_BORDER: Record<ToastType, string> = {
  success: 'border-l-green-500',
  error: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500',
};

/** 类型对应的小图标 */
const TYPE_ICON: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

/** 单条 Toast 展示 */
function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  useLocaleSubscription();
  return (
    <div
      className={`flex items-start gap-2 bg-zinc-800 border border-zinc-700 border-l-4 ${TYPE_BORDER[item.type]} rounded shadow-lg px-3 py-2 text-sm text-zinc-200 min-w-[200px] max-w-[360px]`.trim()}
      role="alert"
    >
      <span className="shrink-0 mt-0.5 text-xs font-bold text-zinc-400">
        {TYPE_ICON[item.type]}
      </span>
      <span className="flex-1 break-words">{item.message}</span>
      <button
        type="button"
        className="shrink-0 text-zinc-500 hover:text-zinc-300 leading-none"
        onClick={() => onClose(item.id)}
        aria-label={t('launch.common.close')}
      >
        ×
      </button>
    </div>
  );
}

/** Toast Provider：在根节点包裹，提供全局通知能力 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  /** 移除指定 Toast 并清理其定时器 */
  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  /** 推送一条 Toast，默认 3 秒后自动消失 */
  const push = useCallback(
    (type: ToastType, message: string, duration = 3000) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, type, message }]);
      if (duration > 0) {
        const timer = setTimeout(() => remove(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [remove],
  );

  const success = useCallback((m: string, d?: number) => push('success', m, d), [push]);
  const error = useCallback((m: string, d?: number) => push('error', m, d), [push]);
  const warning = useCallback((m: string, d?: number) => push('warning', m, d), [push]);
  const info = useCallback((m: string, d?: number) => push('info', m, d), [push]);

  // 组件卸载时清理所有定时器，避免卸载后 setState 警告
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // 挂载时注册非 hook 版 toast 持有器，供 zustand store 等非组件环境调用
  useEffect(() => {
    toastHolder = { success, error, warning, info };
    return () => {
      toastHolder = null;
    };
  }, [success, error, warning, info]);

  // value 用 useMemo 保持引用稳定：toasts 列表变化不应导致全部消费组件重渲染，
  // 也不应使 useToast() 返回的新对象触发依赖它的 effect 重跑
  const ctxValue = useMemo(
    () => ({ success, error, warning, info }),
    [success, error, warning, info],
  );

  return (
    <ToastContext.Provider value={ctxValue}>
      {children}
      {createPortal(
        <div
          className="fixed top-4 right-4 z-[100] flex flex-col gap-2"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} onClose={remove} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** 获取 Toast API，必须在 ToastProvider 内使用 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 <ToastProvider> 内部使用');
  }
  return ctx;
}
