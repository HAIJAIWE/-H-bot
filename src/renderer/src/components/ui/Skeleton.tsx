// 骨架屏组件：用渐变脉冲动画模拟内容占位

interface SkeletonProps {
  className?: string;
}

/** 基础骨架块：灰底 + 脉冲动画 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-zinc-800/60 ${className}`} aria-hidden="true" />;
}

/** 段落骨架：多行文本占位 */
export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 rounded ${i === lines - 1 ? 'w-3/5' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** 卡片骨架：用于配置表 / 数据表卡片列表加载 */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${className}`}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-10 rounded" />
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

/** 表格行骨架：用于数据表行加载 */
export function SkeletonTableRow({
  columns = 4,
  className = '',
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${className}`} aria-hidden="true">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 rounded ${i === 0 ? 'w-12' : i === columns - 1 ? 'w-16' : 'flex-1'}`}
        />
      ))}
    </div>
  );
}

/** 网格骨架：用于卡片网格加载（如 ConfigPanel） */
export function SkeletonGrid({
  cards = 6,
  className = '',
}: {
  cards?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
