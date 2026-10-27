// src/renderer/src/components/layout/CenterPanel.tsx
import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { useUiStore, type LaunchTab } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';
import { LaunchPanel, type RegisteredPanel } from './LaunchPanel';
import { FlowPanel } from './FlowPanel';
import { CodePanel } from './CodePanel';
import { ButtonPanelManager } from '../launch/ButtonPanelManager';
import { AdapterConfigDialog } from '../launch/AdapterConfigDialog';
import { BottomPanel } from '../editor/BottomPanel';
import { inputSm } from '../ui/inputStyles';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { NewProjectDialog } from '../project/NewProjectDialog';
import type { ProjectMeta } from '@shared/types/project';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { flushFlow } from '@renderer/lib/canvas/flushFlow';
import { platformTagsVisible, projectPlatformFamily } from '@shared/domain/platform/registry';
import { TOP_TAB_PLATFORM_TAGS } from '../../lib/node/platformEntries';

const LAUNCH_TABS: { id: LaunchTab; label: string }[] = [
  {
    id: 'home',
    get label() {
      return t('launch.nav.home');
    },
  },
  {
    id: 'dashboard',
    get label() {
      return t('launch.nav.dashboard');
    },
  },
  {
    id: 'logs',
    get label() {
      return t('launch.nav.logs');
    },
  },
  {
    id: 'console',
    get label() {
      return t('launch.nav.console');
    },
  },
  {
    id: 'dataview',
    get label() {
      return t('launch.nav.dataview');
    },
  },
  {
    id: 'template',
    get label() {
      return t('launch.nav.template');
    },
  },
  {
    id: 'panels',
    get label() {
      return t('launch.nav.panels');
    },
  },
  {
    id: 'config',
    get label() {
      return t('launch.nav.config');
    },
  },
  {
    id: 'agent',
    get label() {
      return t('launch.nav.agent');
    },
  },
];

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  iframeUrl: string;
  history: string[];
  historyIdx: number;
}

function createTab(title = t('launch.browser.newTabTitle')): BrowserTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    url: '',
    iframeUrl: '',
    history: [],
    historyIdx: -1,
  };
}

function NewTabPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  useLocaleSubscription();
  const [searchInput, setSearchInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = () => {
    if (!searchInput.trim()) return;
    const trimmed = searchInput.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      onNavigate(trimmed);
    } else if (/^[\w-]+\.[\w-]+/.test(trimmed)) {
      onNavigate('https://' + trimmed);
    } else {
      onNavigate(`https://www.google.com/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 bg-zinc-950">
      <div className="w-full max-w-lg px-4">
        <div className="relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            className="w-full h-12 pl-10 pr-4 bg-zinc-800/60 border border-zinc-700/50 rounded-full text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500/60 focus:bg-zinc-800 transition-colors"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder={t('launch.browser.searchPlaceholder')}
            aria-label={t('launch.browser.searchPlaceholder')}
          />
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-6 px-4">
        {[
          { icon: '🤖', label: t('launch.center.officialPlatform'), url: 'https://q.qq.com' },
          {
            icon: '📘',
            label: t('launch.center.flowDoc'),
            url: 'https://www.typescriptlang.org/docs/',
          },
          { icon: '💬', label: t('launch.center.qqGroup'), url: 'https://pub.qq.com' },
        ].map((s) => (
          <Button
            key={s.label}
            variant="ghost"
            className="flex flex-col items-center gap-2 w-20 group"
            onClick={() => onNavigate(s.url)}
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center text-2xl group-hover:bg-zinc-700/60 group-hover:border-zinc-600/60 transition-colors">
              {s.icon}
            </div>
            <span className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors truncate w-full text-center">
              {s.label}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

const BrowserPanel = memo(function BrowserPanel() {
  useLocaleSubscription();
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const navigate = useCallback(
    (target: string) => {
      let normalized = target.trim();
      if (!normalized) return;
      if (/^https?:\/\//i.test(normalized)) {
        // ok
      } else if (/^[\w-]+\.[\w-]+/.test(normalized)) {
        normalized = 'https://' + normalized;
      } else {
        normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
      }
      const title = (() => {
        try {
          return new URL(normalized).hostname;
        } catch {
          return normalized;
        } // 非合法 URL 时返回原字符串
      })();
      updateTab(activeTabId, {
        url: target,
        title,
        iframeUrl: '',
        history: [...activeTab.history.slice(0, activeTab.historyIdx + 1), normalized].slice(-50),
        historyIdx: Math.min(activeTab.historyIdx + 1, 49),
      });
      setTimeout(() => {
        updateTab(activeTabId, { iframeUrl: normalized });
      }, 0);
    },
    [activeTabId, activeTab, updateTab],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigate(activeTab.url);
      inputRef.current?.blur();
    }
  };

  const handleBack = () => {
    if (activeTab.historyIdx > 0) {
      const idx = activeTab.historyIdx - 1;
      const url = activeTab.history[idx];
      updateTab(activeTabId, { url, iframeUrl: url, historyIdx: idx });
    }
  };

  const handleForward = () => {
    if (activeTab.historyIdx < activeTab.history.length - 1) {
      const idx = activeTab.historyIdx + 1;
      const url = activeTab.history[idx];
      updateTab(activeTabId, { url, iframeUrl: url, historyIdx: idx });
    }
  };

  const handleRefresh = () => {
    if (activeTab.iframeUrl) {
      const url = activeTab.iframeUrl;
      updateTab(activeTabId, { iframeUrl: '' });
      setTimeout(() => updateTab(activeTabId, { iframeUrl: url }), 0);
    }
  };

  const addTab = () => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx].id);
      }
      return next;
    });
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* 地址栏 */}
      <div className="h-9 flex items-center gap-1.5 px-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          disabled={activeTab.historyIdx <= 0}
          title={t('launch.browser.back')}
          leftIcon="◀"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleForward}
          disabled={activeTab.historyIdx >= activeTab.history.length - 1}
          title={t('launch.browser.forward')}
          leftIcon="▶"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          title={t('launch.common.refresh')}
          leftIcon="⟳"
        />
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            className={`w-full ${inputSm} focus:outline-none focus:border-zinc-500`}
            value={activeTab.url}
            onChange={(e) => updateTab(activeTabId, { url: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={t('launch.browser.addressPlaceholder')}
            aria-label={t('launch.browser.addressAria')}
          />
        </div>
      </div>
      {/* 标签栏 */}
      <div
        className="h-8 flex items-end gap-0.5 px-1 bg-zinc-950 border-b border-zinc-800 shrink-0 overflow-x-auto"
        role="tablist"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={tab.id === activeTabId ? 0 : -1}
            aria-selected={tab.id === activeTabId}
            className={`group flex items-center gap-1.5 h-7 px-2.5 rounded-t text-xs cursor-pointer max-w-32 shrink-0 transition-colors ${
              tab.id === activeTabId
                ? 'bg-zinc-800 text-zinc-100'
                : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
            }`}
            onClick={() => setActiveTabId(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveTabId(tab.id);
              }
            }}
          >
            <span className="truncate">{tab.title}</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-0.5 w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title={t('launch.browser.closeTab')}
              leftIcon="×"
            />
          </div>
        ))}
        <Button
          variant="ghost"
          size="md"
          className="w-7 h-7 shrink-0"
          onClick={addTab}
          title={t('launch.browser.newTabAria')}
          leftIcon="+"
        />
      </div>
      {/* 内容区 */}
      {activeTab.iframeUrl ? (
        <iframe
          key={activeTab.id}
          src={activeTab.iframeUrl}
          title={activeTab.title || t('launch.browser.contentAria')}
          className="flex-1 w-full border-0 bg-zinc-900"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
        />
      ) : (
        <NewTabPage onNavigate={navigate} />
      )}
    </div>
  );
});

/** 终端统一由底部 BottomPanel 管理，避免重复挂载多个 xterm 会话 */

const TABS = [
  {
    id: 'blocks',
    get label() {
      return t('launch.center.tabLowcode');
    },
  },
  {
    id: 'code',
    get label() {
      return t('launch.center.tabCode');
    },
  },
  {
    id: 'panels',
    get label() {
      return t('launch.center.tabPanels');
    },
  },
] as const;

export function CenterPanel() {
  useLocaleSubscription();
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const launchTab = useUiStore((s) => s.launchTab);
  const setLaunchTab = useUiStore((s) => s.setLaunchTab);
  const tab = useUiStore((s) => s.centerTab);
  const setTab = useUiStore((s) => s.setCenterTab);
  // 平台专属标签页：「面板」是 QQ 平台专有（按钮面板 = inline keyboard），
  // 换到通用/别的平台的项目里就不出现 ✓（规则与节点库、工具栏入口同一条）
  const botType = useProjectStore((s) => s.currentProject?.botType);
  const projectFamily = projectPlatformFamily({ botType });
  const visibleTabs = useMemo(
    () =>
      TABS.filter((x: (typeof TABS)[number]) =>
        x.id === 'panels' ? platformTagsVisible(TOP_TAB_PLATFORM_TAGS.panels, projectFamily) : true,
      ),
    [projectFamily],
  );
  useEffect(() => {
    // 藏起来时若正停在这一页，切回低代码 —— 否则内容区一片空白 ✗
    if (tab === 'panels' && !visibleTabs.some((x) => x.id === 'panels')) setTab('blocks');
  }, [tab, visibleTabs, setTab]);
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');

  const [registeredPanels, setRegisteredPanels] = useState<RegisteredPanel[]>([]);
  const [adapterConfigOpen, setAdapterConfigOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // ── 顶栏自适应（2026-10-24，696 极限档 CDP 实测）──────────────────────
  // 中栏压到 ~336px 时，模式按钮(170) + 分隔(9) + 「QQ 官方 API」(95) 就把这一行
  // 吃干净，9 个页签只剩 50px —— 连「主页」都露一半，其余全靠横向滚动、而且
  // **滚不到当前页签**（实测 scrollLeft 恒为 0）。窄的时候让页签条换到第二行
  // 占满整行、适配器入口收成图标，页签可用宽度从 50px 变 300px+；再把当前页签
  // 滚进可视区。宽窗口下保持原来的一行（页签条 flex-1 填满剩余空间）。
  const topBarRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [topBarW, setTopBarW] = useState(0);
  useEffect(() => {
    const el = topBarRef.current;
    if (!el) return;
    const measure = () => setTopBarW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 520 ≈ 模式按钮(170) + 分隔(9) + 适配器图标(32) + 页签行至少 300
  const barStacked = topBarW > 0 && topBarW < 520;
  // 换行后模式按钮不能再吃 h-full（父级没有确定高度 ⇒ h-full 解析成整条栏的高度，
  // 会把按钮拉成 72px 高的大块，页签行还被挤到栏外）。给固定 h-10。
  const modeBtnH = barStacked ? 'h-10' : 'h-full';
  const handleCreated = (meta: ProjectMeta) => {
    setNewProjectOpen(false);
    useProjectStore.getState().setCurrentProject(meta);
  };
  const launchTabs = useMemo(
    () =>
      mode === 'launch'
        ? [
            ...LAUNCH_TABS,
            ...registeredPanels.map((p) => ({ id: p.panelId as LaunchTab, label: p.label })),
          ]
        : [],
    [mode, registeredPanels],
  );
  const activeTabIndex =
    mode === 'launch'
      ? launchTabs.findIndex((x) => x.id === launchTab)
      : visibleTabs.findIndex((x) => x.id === tab);
  // 当前页签必须可见：横向把 scrollLeft 挪到刚好露出来（不用 scrollIntoView ——
  // 那会连带把外层页面/其它滚动容器一起滚，实测会跳一下）
  useEffect(() => {
    const strip = tabStripRef.current;
    const inner = strip?.firstElementChild as HTMLElement | null;
    if (!strip || !inner || activeTabIndex < 0) return;
    const btn = inner.children[activeTabIndex] as HTMLElement | undefined;
    if (!btn) return;
    const sr = strip.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    if (br.left < sr.left) strip.scrollLeft -= sr.left - br.left + 8;
    else if (br.right > sr.right) strip.scrollLeft += br.right - sr.right + 8;
  }, [activeTabIndex, barStacked, topBarW]);
  useEffect(() => {
    if (mode === 'launch' && projectPath) {
      // 架构：**读盘前先冲刷** —— 面板配置来自 flow.json 的 admin_panel 节点，
      // 不冲刷的话"刚加的面板"不会出现在列表里（见 lib/canvas/flushFlow.ts）
      void flushFlow(projectPath)
        .then(() => window.qqbat.panel.listRegistered(projectPath))
        .then((res) => {
          if (res.ok && res.data) setRegisteredPanels(res.data as RegisteredPanel[]);
        });
    }
  }, [mode, projectPath]);

  return (
    <div className="flex-1 flex flex-col bg-zinc-900 min-w-0">
      {/* 顶栏（窄中栏时页签条换行，见 barStacked 注释） */}
      <div
        ref={topBarRef}
        className={`flex flex-wrap items-center border-b border-zinc-800 shrink-0 ${
          barStacked ? '' : 'h-10'
        }`}
      >
        <Button
          variant={mode === 'launch' ? 'secondary' : 'ghost'}
          size="md"
          className={modeBtnH}
          onClick={() => setMode('launch')}
        >
          {t('launch.nav.start')}
        </Button>
        <Button
          variant={mode === 'dev' ? 'secondary' : 'ghost'}
          size="md"
          className={modeBtnH}
          onClick={() => setMode('dev')}
        >
          {t('launch.nav.dev')}
        </Button>
        <Button
          variant={mode === 'browser' ? 'secondary' : 'ghost'}
          size="md"
          className={modeBtnH}
          onClick={() => setMode('browser')}
        >
          {t('launch.nav.browser')}
        </Button>
        <div className="w-px h-5 bg-zinc-800 mx-1 shrink-0" />
        {/* 页签数量会随项目里注册的管理面板增长，中栏窄的时候必须能横向滚动，
            否则后面的页签直接被裁掉、点都点不到（之前就只剩到「控制台」可见）。 */}
        <div
          ref={tabStripRef}
          className={`min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            barStacked ? 'order-last basis-full h-10' : 'flex-1'
          }`}
        >
          <div className="flex h-full items-center">
            {mode === 'launch'
              ? launchTabs.map((t) => (
                  <Button
                    key={t.id}
                    variant="ghost"
                    size="md"
                    className={`h-full whitespace-nowrap ${launchTab === t.id ? 'border-b-2 border-blue-500' : ''}`}
                    onClick={() => setLaunchTab(t.id)}
                  >
                    {t.label}
                  </Button>
                ))
              : visibleTabs.map((t) => (
                  <Button
                    key={t.id}
                    variant="ghost"
                    size="md"
                    className={`h-full whitespace-nowrap ${tab === t.id ? 'border-b-2 border-blue-500' : ''}`}
                    onClick={() => {
                      // 这排页签在浏览器模式下也显示（与开发模式共用一行）。只改 centerTab
                      // 的话内容区还在渲染 BrowserPanel，点了像没反应 —— 必须同时切回开发模式。
                      if (mode !== 'dev') setMode('dev');
                      setTab(t.id);
                    }}
                  >
                    {t.label}
                  </Button>
                ))}
          </div>
        </div>
        {mode === 'launch' && projectPath && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className={`${modeBtnH} shrink-0 font-medium hover:bg-zinc-800/50 text-blue-400 hover:text-blue-300`}
              onClick={() => setAdapterConfigOpen(true)}
              title={t('launch.adapter.title')}
              leftIcon={<span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            >
              {/* 窄中栏：只剩状态点（详情/配置在仪表盘的「连接设置」里，功能不丢） */}
              <span className={barStacked ? 'sr-only' : undefined}>
                {t('launch.adapter.officialApi')}
              </span>
            </Button>
          </>
        )}
      </div>
      <AdapterConfigDialog
        open={adapterConfigOpen}
        projectPath={projectPath}
        onClose={() => setAdapterConfigOpen(false)}
        onSaved={() => {
          window.qqbat.project.getMeta(projectPath).then((res) => {
            if (res.ok && res.data) {
              useProjectStore.getState().setCurrentProject(res.data);
            }
          });
        }}
      />
      {/* 内容区 + 终端（中间栏底部） */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* 内容区 */}
        <div className="flex-1 relative overflow-hidden">
          {!projectPath && (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState
                title={t('launch.browser.noProject')}
                description={t('launch.browser.newFirstProject')}
                action={
                  <Button variant="primary" size="sm" onClick={() => setNewProjectOpen(true)}>
                    {t('launch.common.newProject')}
                  </Button>
                }
              />
            </div>
          )}
          {projectPath && mode === 'launch' && (
            <LaunchPanel
              launchTab={launchTab}
              projectPath={projectPath}
              registeredPanels={registeredPanels}
            />
          )}
          {/* 没有项目时不要渲染 FlowPanel：它的空状态（「先建一条能跑的指令」+ 新建指令按钮）
              会与上面的「请先创建一个项目」覆盖层叠在一起，出现两个重叠的行动按钮。 */}
          {mode === 'dev' && tab === 'blocks' && projectPath && <FlowPanel />}
          {mode === 'dev' && tab === 'code' && <CodePanel />}
          {mode === 'dev' && tab === 'panels' && projectPath && <ButtonPanelManager />}
          {mode === 'browser' && <BrowserPanel />}
        </div>
        {/* 底部面板（浏览器模式隐藏） */}
        {mode !== 'browser' && <BottomPanel />}
      </div>
      {newProjectOpen && (
        <NewProjectDialog open onClose={() => setNewProjectOpen(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
