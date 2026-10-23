// 标签页组件：支持横向滚动、激活态下边框高亮、←/→ 键盘导航

import { useRef, type ReactNode } from 'react';

/** 单个标签定义 */
export interface TabItem {
  /** 唯一标识 */
  key: string;
  /** 标签文字 */
  label: string;
  /** 可选图标 */
  icon?: ReactNode;
  /** 关联的 tabpanel 元素 id（用于 aria-controls，建立 tab↔tabpanel 关联）。
   *  不传则不加 aria-controls（向后兼容现有调用方）。 */
  controls?: string;
}

interface TabsProps {
  /** 标签列表 */
  tabs: TabItem[];
  /** 当前激活的 tab key */
  active: string;
  /** 切换回调 */
  onChange: (key: string) => void;
  /** 附加类名 */
  className?: string;
}

/** 标签页：激活态 border-b-2 border-blue-500，非激活 hover 高亮。
 *  键盘导航遵循 WAI-ARIA tablist 模式：
 *  - ←/→ 在 tab 间移动焦点并自动激活（auto activation）
 *  - Home/End 跳到首/末 tab
 *  - roving tabindex：仅激活 tab 在 tab 序列中（tabIndex=0），其余 -1 */
export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** 聚焦指定 tab 并激活（auto activation：焦点移动即激活，符合多数用户直觉） */
  const focusAndActivate = (index: number) => {
    tabRefs.current[index]?.focus();
    onChange(tabs[index].key);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusAndActivate((currentIndex + 1) % tabs.length);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusAndActivate((currentIndex - 1 + tabs.length) % tabs.length);
        break;
      case 'Home':
        e.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        e.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
    }
  };

  return (
    <div
      className={`flex border-b border-zinc-700 overflow-x-auto ${className}`.trim()}
      role="tablist"
    >
      {tabs.map((tab, i) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={tab.controls}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${isActive ? 'border-blue-500 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`.trim()}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
