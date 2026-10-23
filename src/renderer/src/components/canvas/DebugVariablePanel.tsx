// src/renderer/src/components/canvas/DebugVariablePanel.tsx
import { useState, useCallback, useMemo, useId } from 'react';
import { useDebugStore } from '../../stores/debugStore';
import type { DebugVar, DebugFrame } from '@shared/types/debug';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 递归渲染变量值（支持对象/数组展开） */
function VariableValue({
  name,
  value,
  type,
  depth = 0,
}: {
  name: string;
  value: string;
  type: string;
  depth?: number;
}) {
  useLocaleSubscription();
  const [expanded, setExpanded] = useState(depth < 1);
  const isExpandable = type === 'object' || type === 'dict' || type === 'list' || type === 'array';
  // 稳定 id，便于屏幕阅读器关联按钮与其控制的内容
  const contentId = useId();

  const displayValue = isExpandable && !expanded ? '{...}' : value;

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <div className="font-mono" style={{ paddingLeft: depth * 12 }}>
      <div className="flex items-center gap-1 py-0.5">
        {isExpandable && (
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-500 hover:text-zinc-300 text-xs w-3"
            onClick={toggle}
            aria-label={
              expanded
                ? t('canvas.debugVars.collapseAria', { name })
                : t('canvas.debugVars.expandAria', { name })
            }
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
          </Button>
        )}
        {!isExpandable && <span className="w-3" aria-hidden="true" />}
        <span className="text-blue-300">{name}</span>
        <span className="text-zinc-500">:</span>
        <span id={contentId} className="text-green-300 truncate max-w-[200px]">
          {displayValue}
        </span>
        <span className="text-zinc-500 text-xs ml-auto">({type})</span>
      </div>
    </div>
  );
}

/** 变量列表 */
function VariableList({ variables }: { variables: DebugVar[] }) {
  useLocaleSubscription();
  if (variables.length === 0) {
    return <div className="text-zinc-500 text-xs p-2">{t('canvas.debugVars.empty')}</div>;
  }

  return (
    <div className="space-y-0.5">
      {variables.map((v) => (
        <VariableValue
          key={`${v.portId ?? ''}_${v.name}`}
          name={v.name}
          value={v.value}
          type={v.type}
        />
      ))}
    </div>
  );
}

/** 调用栈帧 */
function CallStackView({ frames }: { frames: DebugFrame[] }) {
  useLocaleSubscription();
  if (frames.length === 0) {
    return <div className="text-zinc-500 text-xs p-2">{t('common.empty')}</div>;
  }

  return (
    <div className="space-y-1">
      {[...frames].reverse().map((frame) => (
        <div
          key={`${frame.nodeId}_${frame.enteredAt}`}
          className="bg-zinc-800/50 rounded px-2 py-1"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200">{frame.nodeLabel}</span>
            <span className="text-zinc-500 text-xs">
              {new Date(frame.enteredAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 变量查看器面板 */
export function DebugVariablePanel() {
  useLocaleSubscription();
  const debugState = useDebugStore((s) => s.debugState);
  const [tab, setTab] = useState<'variables' | 'stack'>('variables');
  const [search, setSearch] = useState('');

  const isPaused = debugState.status === 'paused';

  const filteredVars = useMemo(() => {
    if (!search.trim()) return debugState.variables;
    const q = search.toLowerCase();
    return debugState.variables.filter(
      (v) => v.name.toLowerCase().includes(q) || v.value.toLowerCase().includes(q),
    );
  }, [debugState.variables, search]);

  if (!isPaused) return null;

  return (
    <div className="absolute right-2 top-14 z-20 w-72 max-h-[70vh] bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl flex flex-col overflow-hidden">
      {/* 标题 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-xs font-medium text-zinc-200">
          {debugState.pausedNodeId ? (
            <>
              {t('canvas.debugVars.pausedAt')}{' '}
              <span className="text-yellow-400">{debugState.pausedNodeId}</span>
            </>
          ) : (
            t('canvas.debugVars.title')
          )}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-700">
        <Button
          variant="ghost"
          size="sm"
          className={`flex-1 text-xs py-1.5 ${
            tab === 'variables'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
          onClick={() => setTab('variables')}
        >
          {t('canvas.debugVars.tab', { count: debugState.variables.length })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`flex-1 text-xs py-1.5 ${
            tab === 'stack'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
          onClick={() => setTab('stack')}
        >
          {t('canvas.debugVars.stackTab', { count: debugState.callStack.length })}
        </Button>
      </div>

      {/* 搜索框（仅变量 tab） */}
      {tab === 'variables' && debugState.variables.length > 5 && (
        <div className="px-2 py-1.5 border-b border-zinc-800">
          <input
            className="w-full bg-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 outline-none border border-zinc-700 focus:border-blue-500"
            placeholder={t('canvas.debugVars.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {tab === 'variables' ? (
          <VariableList variables={filteredVars} />
        ) : (
          <CallStackView frames={debugState.callStack} />
        )}
      </div>
    </div>
  );
}
