// 空状态组件：居中显示图标、标题、描述与可选行动按钮

import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** 可选图标 */
  icon?: ReactNode;
  /** 标题 */
  title: string;
  /** 描述文字 */
  description?: string;
  /** 可选行动按钮/节点 */
  action?: ReactNode;
}

/** 空状态：居中、zinc-500 文字，常用于列表/面板无数据时 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center" role="status">
      {icon && <div className="mb-3 text-zinc-600">{icon}</div>}
      <p className="text-sm text-zinc-500">{title}</p>
      {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
