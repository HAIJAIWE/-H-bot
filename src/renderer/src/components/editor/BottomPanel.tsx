// src/renderer/src/components/editor/BottomPanel.tsx
import React, { useEffect, useRef, useCallback, useState, lazy, Suspense } from 'react';
import { useUiStore, type BottomTab } from '../../stores/uiStore';
import { useLogStore } from '../../stores/logStore';
import { useTestStore, type TestLogSource } from '../../stores/testStore';
import { useProjectStore } from '../../stores/projectStore';
import type { LogLevel } from '@shared/types/log';
import { Button } from '../ui/Button';
import { t, getLocale } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// 懒加载 TerminalPanel（xterm，~500KB），仅在终端 tab 激活时加载
const TerminalPanel = lazy(() => import('./Terminal').then((m) => ({ default: m.TerminalPanel })));

const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  {
    id: 'output',
    get label() {
      return t('editor.tab.problems');
    },
  },
  {
    id: 'test',
    get label() {
      return t('editor.tab.test');
    },
  },
  {
    id: 'terminal',
    get label() {
      return t('editor.tab.terminal');
    },
  },
  {
    id: 'ports',
    get label() {
      return t('editor.tab.ports');
    },
  },
];

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-zinc-300',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

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

/** 测试日志来源标签。
 *  用函数而不是模块级常量：取值时机必须跟渲染一致，否则切语言后这里会冻在旧语言。
 *  用 source 键而不是日志里的显示文案做判断：显示文案会随语言变，拿它做逻辑判断
 *  在英文界面下会静默失效（过滤/配色全错）。 */
const SOURCE_LABEL: Record<TestLogSource, () => string> = {
  bot: () => 'Bot',
  system: () => t('editor.test.label.system'),
  translator: () => t('editor.test.source.translator'),
  manager: () => t('editor.test.source.manager'),
  test: () => t('editor.tab.test'),
  node: () => t('editor.test.label.node'),
};

/** 问题面板 — 只显示报错和警告（类似 VSCode Problems），用于开发时定位代码/节点问题 */
function OutputPanel() {
  useLocaleSubscription();
  const entries = useLogStore((s) => s.entries);
  const traceFilter = useLogStore((s) => s.traceFilter);
  const setTraceFilter = useLogStore((s) => s.setTraceFilter);
  const clear = useLogStore((s) => s.clear);
  const currentProjectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const [filter, setFilter] = useState<'all' | 'warn' | 'error'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = entries
    // 按当前项目隔离
    .filter((e) => !currentProjectPath || !e.projectPath || e.projectPath === currentProjectPath)
    // 只显示报错和警告
    .filter((e) => e.level === 'warn' || e.level === 'error')
    .filter((e) => (filter === 'all' ? true : e.level === filter));
  const display = traceFilter ? filtered.filter((e) => e.traceId === traceFilter) : filtered;

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-xs font-mono">
      {/* 工具栏 */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <span className="text-zinc-500 text-xs mr-1">{t('editor.tab.problems')}</span>
        {(['all', 'warn', 'error'] as const).map((f) => (
          <Button
            key={f}
            variant="ghost"
            size="sm"
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              filter === f ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? t('editor.filter.all')
              : f === 'warn'
                ? t('editor.filter.warn')
                : t('editor.filter.error')}
          </Button>
        ))}
        {traceFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="px-2 py-0.5 rounded text-xs bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50"
            onClick={() => setTraceFilter(undefined)}
          >
            {t('editor.log.traceLabel')} {traceFilter.slice(0, 8)} ✕
          </Button>
        )}
        <div className="flex-1" />
        <span className="text-zinc-600 mr-2">
          {t('editor.count.lines', { count: display.length })}
        </span>
        <Button variant="danger" size="sm" onClick={clear}>
          {t('editor.action.clear')}
        </Button>
      </div>
      {/* 日志列表 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-px">
        {display.length === 0 && (
          <div className="text-zinc-600 text-center mt-6">
            {traceFilter ? t('editor.log.emptyFilteredTitle') : t('editor.problems.empty')}
          </div>
        )}
        {display.map((e) => (
          <div
            key={e.id}
            className="flex gap-2 hover:bg-zinc-900/60 px-1.5 py-0.5 rounded items-baseline"
          >
            <span className="text-zinc-500 shrink-0 w-16 text-xs">
              {new Date(e.timestamp).toLocaleTimeString(getLocale(), { hour12: false })}
            </span>
            <span className={`shrink-0 w-10 text-xs ${LEVEL_COLORS[e.level]}`}>
              {FILTER_LABELS[e.level]}
            </span>
            {e.traceId && (
              <Button
                variant="ghost"
                size="sm"
                className={`shrink-0 px-1 rounded text-xs font-mono ${
                  traceFilter === e.traceId
                    ? 'bg-indigo-500 text-white'
                    : 'bg-zinc-800 text-indigo-300 hover:bg-zinc-700'
                }`}
                onClick={() => setTraceFilter(traceFilter === e.traceId ? undefined : e.traceId)}
              >
                {e.traceId.slice(0, 8)}
              </Button>
            )}
            <span className="text-zinc-300 break-all flex-1">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 测试面板 — 显示模拟测试消息、节点执行事件、bot 日志和错误警告 */
function TestPanel() {
  useLocaleSubscription();
  const log = useTestStore((s) => s.log);
  const clearLog = useTestStore((s) => s.clearLog);
  const openDialog = useTestStore((s) => s.openDialog);
  const botRunning = useTestStore((s) => s.botRunning);
  const [filter, setFilter] = useState<'all' | 'test' | 'node' | 'error'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = log.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'test') return e.source === 'test' || e.source === 'system';
    if (filter === 'node') return e.source === 'node';
    if (filter === 'error') return e.level === 'error' || e.level === 'warn';
    return true;
  });

  // 有新日志时滚动到顶部（日志是倒序，最新在顶部）
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [log.length]);

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-xs font-mono">
      {/* 工具栏 */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className={`px-2 py-0.5 rounded text-xs ${
            botRunning
              ? 'bg-green-700 hover:bg-green-600 text-white'
              : 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-200'
          }`}
          onClick={openDialog}
          title={botRunning ? t('editor.test.sendTitle') : t('editor.test.openTitle')}
        >
          {t('editor.test.open')}
        </Button>
        <span
          className={`w-1.5 h-1.5 rounded-full ${botRunning ? 'bg-green-400' : 'bg-zinc-600'}`}
        />
        <span className="text-xs text-zinc-500">
          {botRunning ? t('editor.test.botRunning') : t('editor.test.botStopped')}
        </span>
        <div className="w-px h-3 bg-zinc-700 mx-1" />
        {(['all', 'test', 'node', 'error'] as const).map((f) => (
          <Button
            key={f}
            variant="ghost"
            size="sm"
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              filter === f ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={() => setFilter(f)}
          >
            {
              {
                all: t('editor.filter.all'),
                test: t('editor.test.label.message'),
                node: t('editor.test.label.node'),
                error: t('editor.filter.error'),
              }[f]
            }
          </Button>
        ))}
        <div className="flex-1" />
        <span className="text-zinc-600 mr-2">
          {t('editor.count.items', { count: filtered.length })}
        </span>
        <Button variant="danger" size="sm" onClick={clearLog}>
          {t('editor.action.clear')}
        </Button>
      </div>
      {/* 日志列表（倒序，最新在顶部） */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-px">
        {filtered.length === 0 && (
          <div className="text-zinc-600 text-center mt-6">
            {botRunning ? t('editor.test.emptyRunning') : t('editor.test.emptyStopped')}
          </div>
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-1.5 px-1.5 py-0.5 rounded hover:bg-zinc-900/60 items-baseline"
          >
            <span className="text-zinc-500 shrink-0 w-14 text-xs">{e.time}</span>
            <span className="shrink-0">{e.icon}</span>
            <span
              className={`shrink-0 w-8 text-xs ${
                e.source === 'node'
                  ? 'text-blue-300'
                  : e.source === 'test'
                    ? 'text-green-300'
                    : 'text-zinc-500'
              }`}
            >
              {SOURCE_LABEL[e.source]()}
            </span>
            <span
              className={`break-all flex-1 ${
                e.level === 'error'
                  ? 'text-red-300'
                  : e.level === 'warn'
                    ? 'text-yellow-300'
                    : 'text-zinc-300'
              }`}
            >
              {e.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 端口面板 — 实时显示端口占用信息 */
function PortsPanel() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const [translator, setTranslator] = useState<{ running: boolean; port: number | null }>({
    running: false,
    port: null,
  });

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const trRes = await window.qqbat.official.getTranslatorStatus();
        if (cancelled) return;
        if (trRes.ok && trRes.data) setTranslator(trRes.data);
      } catch {
        // 忽略刷新失败
      }
    };

    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectPath]);

  const ports = [
    { port: translator.port, desc: t('editor.ports.translator'), running: translator.running },
  ].filter((p) => p.port != null);

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-xs font-mono">
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <span className="text-zinc-500">{t('editor.tab.ports')}</span>
        <div className="flex-1" />
        <span className="text-zinc-600">{t('editor.count.units', { count: ports.length })}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <div className="space-y-1">
          {ports.length === 0 && (
            <div className="text-zinc-600 text-center mt-6">{t('editor.ports.empty')}</div>
          )}
          {ports.map((p) => (
            <div
              key={`${p.port}-${p.desc}`}
              className="flex items-center gap-3 px-1.5 py-1 rounded hover:bg-zinc-900/60"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${p.running ? 'bg-green-400' : 'bg-zinc-600'}`}
              />
              <span className="text-blue-300 font-mono w-16">{p.port}</span>
              <span className="text-zinc-400 flex-1">{p.desc}</span>
              <span className={`text-xs ${p.running ? 'text-green-500' : 'text-zinc-500'}`}>
                {p.running ? t('editor.status.running') : t('editor.status.stopped')}
              </span>
            </div>
          ))}
        </div>
        <div className="text-zinc-500 mt-4 text-center text-xs">
          {t('editor.ports.autoRefresh')}
        </div>
      </div>
    </div>
  );
}

export const BottomPanel = React.memo(function BottomPanel() {
  useLocaleSubscription();
  const bottomTab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);
  const terminalHeight = useUiStore((s) => s.terminalHeight);
  const setTerminalHeight = useUiStore((s) => s.setTerminalHeight);
  const terminalHeightRef = useRef(terminalHeight);

  // 同步 ref 到最新值
  useEffect(() => {
    terminalHeightRef.current = terminalHeight;
  }, [terminalHeight]);

  const startDrag = useCallback(() => {
    return (delta: number) => setTerminalHeight(terminalHeightRef.current + delta);
  }, [setTerminalHeight]);

  // 拖拽手柄
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let dragging = true;
      let startY = e.clientY;
      const onDrag = startDrag();
      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging) return;
        const delta = startY - ev.clientY;
        startY = ev.clientY;
        onDrag(delta);
      };
      const handleMouseUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [startDrag],
  );

  return (
    <>
      {/* 拖拽手柄 */}
      <div
        className="h-1.5 hover:h-2 bg-zinc-800 hover:bg-blue-500/60 cursor-row-resize shrink-0 transition-colors relative z-10"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-x-0 -top-1 -bottom-1" />
      </div>
      {/* 面板 */}
      <div
        style={{ height: terminalHeight }}
        className="shrink-0 overflow-hidden border-t border-zinc-800 flex flex-col"
      >
        {/* 标签栏 */}
        <div className="flex items-center h-7 px-1 bg-zinc-900 border-b border-zinc-800 shrink-0">
          {BOTTOM_TABS.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              className={`px-3 h-full text-xs transition-colors ${
                bottomTab === t.id
                  ? 'text-zinc-100 border-b-2 border-blue-500 bg-zinc-800/50'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              onClick={() => setBottomTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
          <div className="flex-1" />
        </div>
        {/* 内容 */}
        <div className="flex-1 overflow-hidden">
          {bottomTab === 'output' && <OutputPanel />}
          {bottomTab === 'test' && <TestPanel />}
          {bottomTab === 'terminal' && (
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                  {t('editor.terminal.loading')}
                </div>
              }
            >
              <TerminalPanel />
            </Suspense>
          )}
          {bottomTab === 'ports' && <PortsPanel />}
        </div>
      </div>
    </>
  );
});
