// src/renderer/src/components/blocks/ContextMenu.tsx
import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** 通用右键菜单：固定定位，点击外部或 ESC 关闭 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  useLocaleSubscription();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('blocks.contextMenu.ariaLabel')}
      className="fixed z-50 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded shadow-lg text-xs py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          role="menuitem"
          className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent bg-transparent border-0 cursor-pointer text-xs"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
