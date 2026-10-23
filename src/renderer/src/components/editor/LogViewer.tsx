// src/renderer/src/components/editor/LogViewer.tsx
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { useLogStore } from '../../stores/logStore';
import { useProjectStore } from '../../stores/projectStore';
import { useFlowStore } from '../../stores/flowStore';
import { useUiStore } from '../../stores/uiStore';
import type { LogEntry, LogLevel } from '@shared/types/log';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { t, getLocale } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-zinc-100',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

const FILTERS: (LogLevel | 'all')[] = ['all', 'debug', 'info', 'warn', 'error'];

const FILTER_LABELS: Record<LogLevel | 'all', string> = {
  get all() {
    return t('editor.filter.all');
  },
  get debug() {
    return t('editor.filter.debug');
  },
  get info() {
    return t('editor.filter.info');
  },
  get warn() {
    return t('editor.filter.warn');
  },
  get error() {
    return t('editor.filter.error');
  },
};

/** 虚拟化行高：text-xs 单行内容 + 上下留白（行内容单行截断，完整内容看 title 悬停提示） */
const ROW_HEIGHT = 28;

/** 渲染带节点标记的日志消息
 * 使用 React.memo：日志行在高频更新时只应渲染新增条目，已有条目（message 未变）应跳过。
 * message 为字符串，浅比较即可正确识别未变行。
 * 单行截断（truncate + title）：配合 react-window 固定行高虚拟化，
 * 完整消息通过悬停 title 查看。
 */
const LogMessage = memo(function LogMessage({ message }: { message: string; traceId?: string }) {
  useLocaleSubscription();
  const selectNode = useFlowStore((s) => s.selectNode);
  const setCenterTab = useUiStore((s) => s.setCenterTab);

  // 匹配消息中的 [NODE:status:id] 标记
  const nodeMatch = message.match(/\[NODE:(enter|exit|error):([^\]]+)\]/);

  if (!nodeMatch) {
    return (
      <span className="text-zinc-300 truncate min-w-0 flex-1" title={message}>
        {message}
      </span>
    );
  }

  const [, status, nodeId] = nodeMatch;
  const statusIcon = status === 'enter' ? '🔵' : status === 'exit' ? '🟢' : '🔴';
  const prefix = message.substring(0, nodeMatch.index);
  const suffix = message.substring((nodeMatch.index ?? 0) + nodeMatch[0].length);

  const handleClick = () => {
    selectNode(nodeId);
    setCenterTab('blocks');
  };

  return (
    <span className="text-zinc-300 truncate min-w-0 flex-1" title={message}>
      {prefix && <span>{prefix}</span>}
      <Button
        variant="secondary"
        size="sm"
        className="cursor-pointer"
        onClick={handleClick}
        title={t('editor.log.jumpToNode', { id: nodeId })}
      >
        {statusIcon} {nodeId.slice(0, 8)}
      </Button>
      {suffix && <span>{suffix}</span>}
    </span>
  );
});

/** traceId 标签组件
 * 使用 React.memo：traceId 为字符串，浅比较即可；避免日志新增时所有 badge 重渲染。
 */
const TraceIdBadge = memo(function TraceIdBadge({ traceId }: { traceId: string }) {
  useLocaleSubscription();
  const traceFilter = useLogStore((s) => s.traceFilter);
  const setTraceFilter = useLogStore((s) => s.setTraceFilter);
  const isActive = traceFilter === traceId;

  return (
    <Button
      variant="secondary"
      size="sm"
      className={`shrink-0 px-1 rounded text-xs font-mono ${
        isActive ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-indigo-300 hover:bg-zinc-700'
      }`}
      onClick={() => setTraceFilter(isActive ? undefined : traceId)}
      title={
        isActive
          ? t('editor.log.traceTitleActive', { id: traceId })
          : t('editor.log.traceTitle', { id: traceId })
      }
    >
      {traceId.slice(0, 8)}
    </Button>
  );
});

/** 虚拟化日志行（模块级定义保持组件引用稳定，避免 FixedSizeList 整表重挂载）。
 *  数据经 itemData 传入：itemData 引用变化时 react-window 自动重渲染可视行。 */
function LogRow({ index, style, data }: ListChildComponentProps) {
  const e = (data as LogEntry[])[index];
  return (
    <div style={style} className="flex gap-2 items-center px-1 rounded hover:bg-zinc-900/50">
      <span className="text-zinc-600 shrink-0 w-16 tabular-nums">
        {new Date(e.timestamp).toLocaleTimeString(getLocale(), { hour12: false })}
      </span>
      <span className={`shrink-0 w-10 ${LEVEL_COLORS[e.level]}`}>{FILTER_LABELS[e.level]}</span>
      {e.traceId && <TraceIdBadge traceId={e.traceId} />}
      <LogMessage message={e.message} />
    </div>
  );
}

export function LogViewer() {
  useLocaleSubscription();
  const entries = useLogStore((s) => s.entries);
  const filter = useLogStore((s) => s.filter);
  const traceFilter = useLogStore((s) => s.traceFilter);
  const currentProjectPath = useProjectStore((s) => s.currentProject?.path);
  const setFilter = useLogStore((s) => s.setFilter);
  const setTraceFilter = useLogStore((s) => s.setTraceFilter);
  const clear = useLogStore((s) => s.clear);

  // useMemo 避免每次渲染都重新执行 filter（日志条目可能上千条）
  const filtered = useMemo(() => {
    // 按项目路径过滤：只显示当前项目的日志
    let result = currentProjectPath
      ? entries.filter((e) => !e.projectPath || e.projectPath === currentProjectPath)
      : entries;
    if (filter !== 'all') {
      result = result.filter((e) => e.level === filter);
    }
    if (traceFilter) {
      result = result.filter((e) => e.traceId === traceFilter);
    }
    return result;
  }, [entries, filter, traceFilter, currentProjectPath]);

  // 列表可用高度：ResizeObserver 测量容器（窗口缩放 / 底栏拖动时自适应）
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((obs) => {
      const h = Math.floor(obs[0].contentRect.height);
      setListHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-xs font-mono">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
        <span className="text-zinc-500 text-xs mr-1">{t('editor.log.title')}</span>
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant="ghost"
            size="sm"
            className={`px-2 py-0.5 rounded text-xs ${
              filter === f ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => setFilter(f)}
            aria-label={
              f === 'all'
                ? t('editor.log.aria.showAll')
                : t('editor.log.aria.filterLevel', { level: f })
            }
            aria-pressed={filter === f}
          >
            {FILTER_LABELS[f]}
          </Button>
        ))}
        {traceFilter && (
          <Button
            variant="secondary"
            size="sm"
            className="px-2 py-0.5 rounded text-xs bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50"
            onClick={() => setTraceFilter(undefined)}
            aria-label={t('editor.log.aria.clearTraceFilter')}
          >
            {t('editor.log.traceLabel')} {traceFilter.slice(0, 8)}
            <span className="ml-1">&times;</span>
          </Button>
        )}
        <div className="flex-1" />
        <span className="text-zinc-600">{t('editor.count.lines', { count: filtered.length })}</span>
        <Button
          variant="danger"
          size="sm"
          className="text-zinc-500 hover:text-red-400 text-xs"
          onClick={clear}
          aria-label={t('editor.log.aria.clear')}
        >
          {t('editor.action.clear')}
        </Button>
      </div>

      {/* 日志列表：react-window 虚拟化，只渲染可视区行（替代此前最多 1000 行全量 DOM） */}
      <div
        ref={listContainerRef}
        className="flex-1 min-h-0 p-2"
        role="log"
        aria-live="polite"
        aria-label={t('editor.log.aria.runtime')}
      >
        {filtered.length === 0 ? (
          <EmptyState
            title={traceFilter ? t('editor.log.emptyFilteredTitle') : t('editor.log.emptyTitle')}
            description={
              traceFilter ? t('editor.log.emptyFilteredDesc') : t('editor.log.emptyDesc')
            }
          />
        ) : listHeight > 0 ? (
          <FixedSizeList
            height={listHeight}
            itemCount={filtered.length}
            itemSize={ROW_HEIGHT}
            width="100%"
            itemData={filtered}
            className="scrollbar-thin"
          >
            {LogRow}
          </FixedSizeList>
        ) : null}
      </div>
    </div>
  );
}
