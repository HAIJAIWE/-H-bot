import { useEffect, useState, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { useLogStore } from '../../stores/logStore';
import { useGitStore } from '../../stores/gitStore';
import { useThemeStore } from '../../stores/themeStore';
import { useI18nStore } from '../../stores/i18nStore';
import { t } from '../../i18n';
import { STORAGE_KEYS } from '../../lib/infra/storageKeys';
import { useBotStore } from '../../stores/botStore';
import { useFlowStore } from '../../stores/flowStore';
import { DiagnosticsDialog } from '../settings/DiagnosticsDialog';
import { FrameworkDevDialog } from '../settings/FrameworkDevDialog';
import { FrameworkDevBadge } from './FrameworkDevBadge';
import { useFrameworkDevStore } from '../../stores/frameworkDevStore';
import { Dropdown } from '../ui/Dropdown';
import { Button } from '../ui/Button';
import { CrashReportDialog } from '../settings/CrashReportDialog';
import { BotStateDialog } from '../settings/BotStateDialog';
import { GitHistoryDialog } from '../settings/GitHistoryDialog';
import { AIProviderConfig } from '../settings/AIProviderConfig';
import { PluginManager } from '../settings/PluginManager';
import { useToast } from '../ui/Toast';
import {
  GitBranch,
  Circle,
  AlertTriangle,
  Sun,
  Moon,
  Bug,
  Archive,
  Package,
  Play,
  Square,
  Cpu,
  Puzzle,
} from 'lucide-react';

function formatUptime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return t('topbar.uptime', { m: String(m), s: String(s) });
}

const CRASH_VIEWED_KEY = STORAGE_KEYS.crashLastViewed;

function getCrashLastViewed(): string {
  try {
    return localStorage.getItem(CRASH_VIEWED_KEY) ?? '';
  } catch {
    return '';
  }
}

function setCrashLastViewed(): void {
  try {
    localStorage.setItem(CRASH_VIEWED_KEY, new Date().toISOString());
  } catch {
    // ignore
  }
}

export function TopBar() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [crashOpen, setCrashOpen] = useState(false);
  const [botStateOpen, setBotStateOpen] = useState(false);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const [aiProviderOpen, setAiProviderOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  // 框架开发模式（默认关）。开着时顶栏必须**一直**挂着一个醒目标识（规则⑥）——
  // 这个状态归主进程所有（file:getDevMode），这里只负责显示与转发切换请求。
  //
  // ⚠️ 对话框开没开**放在 store 里**：创作模式提示条上也要能开它（P1-8）。
  // 实例只此一份（本文件末尾那个）—— 它要用 useToast，散在组件树里会各自要求 Provider。
  const frameworkDevOpen = useFrameworkDevStore((s) => s.dialogOpen);
  const setFrameworkDevOpen = useFrameworkDevStore((s) => s.setDialogOpen);
  const frameworkDevEnabled = useFrameworkDevStore((s) => s.enabled);
  /** 本次会话动过的护栏文件数（>0 时顶栏常驻一个标记） */
  const securityCriticalCount = useFrameworkDevStore((s) => s.securityCriticalWrites.length);
  const refreshFrameworkDev = useFrameworkDevStore((s) => s.refresh);
  const [hasNewCrash, setHasNewCrash] = useState(false);
  const [showHotReload, setShowHotReload] = useState(false);
  const hotReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  // Bot 管理状态（必须在下方 useEffect 之前声明，否则依赖数组引用会触发 TDZ）
  const bots = useBotStore((s) => s.bots);
  const selectedBotPath = useBotStore((s) => s.selectedBotPath);
  const selectBot = useBotStore((s) => s.selectBot);
  const selectedBot = bots.find((b) => b.projectPath === selectedBotPath);
  const botStatus = selectedBot?.status ?? 'stopped';
  const botPid = selectedBot?.pid ?? null;
  const uptime = selectedBot?.uptime ?? null;

  // 监听代码生成成功事件，Bot 运行中时显示"热更新已生效"提示
  const lastGeneratedAt = useFlowStore((s) => s.lastGeneratedAt);
  useEffect(() => {
    if (lastGeneratedAt && botStatus === 'running') {
      setShowHotReload(true);
      if (hotReloadTimerRef.current) clearTimeout(hotReloadTimerRef.current);
      hotReloadTimerRef.current = setTimeout(() => setShowHotReload(false), 3000);
    }
    return () => {
      if (hotReloadTimerRef.current) clearTimeout(hotReloadTimerRef.current);
    };
  }, [lastGeneratedAt, botStatus]);

  const project = useProjectStore((s) => s.currentProject);
  const projectPath = project?.path ?? '';

  // Bot 运行时状态（starting flag 由按钮操作控制）
  const starting = useRuntimeStore((s) => s.starting);
  const setStarting = useRuntimeStore((s) => s.setStarting);
  const runtimeInit = useRuntimeStore((s) => s.init);

  // 主题
  const currentThemeId = useThemeStore((s) => s.currentThemeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const isDark = useThemeStore((s) => s.isDark);

  // 国际化
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  const handleToggleTheme = () => {
    setTheme(currentThemeId === 'qqbat-dark' ? 'qqbat-light' : 'qqbat-dark');
  };

  // Git 状态
  const gitBranch = useGitStore((s) => s.branch);
  const gitClean = useGitStore((s) => s.clean);
  const gitCommitCount = useGitStore((s) => s.commitCount);
  const gitInit = useGitStore((s) => s.init);

  // 启动时同步一次框架开发模式（它是主进程持有的进程级状态，重启后要读回来）
  useEffect(() => {
    void refreshFrameworkDev();
  }, [refreshFrameworkDev]);

  // 初始化监听器
  useEffect(() => {
    const cleanup1 = runtimeInit(useLogStore.getState().addLog);
    const cleanup2 = gitInit(projectPath);
    return () => {
      cleanup1();
      cleanup2();
    };
  }, [runtimeInit, gitInit, projectPath]);

  // 崩溃通知：启动时检查是否有新报告
  // handleOpenCrash 在每次渲染都是新函数，直接加入依赖会重复订阅，
  // 改用 ref 持有最新版本，避免空依赖闭包过期问题
  const handleOpenCrashRef = useRef<() => void>(() => {});
  useEffect(() => {
    handleOpenCrashRef.current = () => {
      setHelpOpen(false);
      setCrashOpen(true);
      setHasNewCrash(false);
      setCrashLastViewed();
    };
  });

  useEffect(() => {
    if (!window.qqbat?.crash) return;
    const lastViewed = getCrashLastViewed();
    window.qqbat.crash
      .getReports()
      .then((res) => {
        if (res.ok && res.data && res.data.length > 0) {
          // 如果所有报告的时间戳都晚于上次查看时间，则显示小红点
          const newest = res.data[0];
          if (!lastViewed || newest.timestamp > lastViewed) {
            setHasNewCrash(true);
          }
        }
      })
      .catch(() => {});

    // 监听系统托盘通知点击事件（来自主进程 crashLogger）
    const unsub = window.qqbat.crash.onShowCrashPanel(() => {
      handleOpenCrashRef.current();
    });
    return () => {
      unsub();
    };
  }, []);

  const handleOpenCrash = () => {
    handleOpenCrashRef.current();
  };

  const handleStart = async () => {
    if (!projectPath || starting) return;
    setStarting(true);
    const { startBot } = useBotStore.getState();
    // botManager.startBot 会通过 statusChanged 事件更新 botStore，
    // 但不会自动 setStarting(false)，所以需要手动处理
    try {
      await startBot(projectPath);
    } catch (e) {
      console.error('[TopBar] 启动失败:', e);
      toast.error(t('topbar.startFailed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!projectPath) return;
    const { stopBot } = useBotStore.getState();
    try {
      await stopBot(projectPath);
    } catch (e) {
      console.error('[TopBar] 停止失败:', e);
      toast.error(t('topbar.stopFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const botStatusColor: Record<string, string> = {
    stopped: 'text-zinc-500',
    starting: 'text-yellow-400',
    running: 'text-green-400',
    stopping: 'text-yellow-400',
    error: 'text-red-400',
  };

  const botStatusLabel: Record<string, string> = {
    stopped: t('topbar.statusStopped'),
    starting: t('topbar.statusStarting'),
    running: t('topbar.statusRunning'),
    stopping: t('topbar.statusStopping'),
    error: t('topbar.statusError'),
  };

  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-3">
        {/* Bot 切换下拉框 */}
        <Dropdown
          value={selectedBotPath ?? ''}
          onChange={selectBot}
          ariaLabel={t('topbar.botSelect')}
          options={
            bots.length === 0
              ? [{ value: '', label: t('topbar.noBot') }]
              : bots.map((bot) => ({ value: bot.projectPath, label: bot.name }))
          }
          className="max-w-40"
        />
        {/* 框架开发模式：开着时一眼可见的标识（点它直接进开关 + 回退点） */}
        <FrameworkDevBadge
          enabled={frameworkDevEnabled}
          onClick={() => setFrameworkDevOpen(true)}
        />
        {/*
          护栏可见性（2026-10-16）：本次会话**动过护栏文件**时常驻一个标记。
          与普通改动区分开 —— 只在真的写到了安全关键文件（禁区/备份/模式值域那一类）时出现，
          点开就是那份清单与回退点。没有它的话，用户只能在"改完那一刻"的提示里看到，
          过后就再也想不起来自己动过护栏。
        */}
        {securityCriticalCount > 0 && (
          <button
            type="button"
            onClick={() => setFrameworkDevOpen(true)}
            title={t('frameworkDev.criticalWritesHint')}
            className="inline-flex items-center gap-1 rounded border border-red-600 bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300 hover:bg-red-500/25"
          >
            🛡 {t('frameworkDev.criticalWritesBadge', { count: String(securityCriticalCount) })}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Git 分支（点击查看提交历史） */}
        {gitBranch && (
          <Button
            variant="ghost"
            size="sm"
            className={`text-xs inline-flex items-center gap-1 ${gitClean ? 'text-green-500' : 'text-yellow-400'} hover:underline`}
            onClick={() => setGitHistoryOpen(true)}
            title={t('topbar.gitHistory')}
            aria-label={t('topbar.gitHistory')}
            leftIcon={<GitBranch aria-hidden="true" className="w-3 h-3" />}
          >
            {gitBranch}
            {!gitClean && (
              <span className="text-zinc-500 ml-1">
                {t('topbar.commitCount', { count: String(gitCommitCount) })}
              </span>
            )}
          </Button>
        )}

        {/* 运行状态 */}
        <span className={`text-xs inline-flex items-center gap-1 ${botStatusColor[botStatus]}`}>
          <Circle aria-hidden="true" className="w-2 h-2 fill-current" />
          {botStatusLabel[botStatus]}
          {botStatus === 'running' && botPid && (
            <span className="text-zinc-500 ml-1">PID: {botPid}</span>
          )}
          {botStatus === 'running' && uptime !== null && (
            <span className="text-zinc-500 ml-1">| {formatUptime(uptime)}</span>
          )}
          {botStatus === 'error' && (
            <span className="text-zinc-500 ml-1">{t('topbar.autoRestarting')}</span>
          )}
        </span>

        {/* 热更新提示：Bot 运行中且代码刚生成成功时短暂显示 */}
        {showHotReload && botStatus === 'running' && (
          <span className="text-xs text-green-400 animate-pulse" role="status">
            {t('topbar.hotReload')}
          </span>
        )}

        {/* 运行按钮 */}
        <Button
          variant="success"
          size="sm"
          loading={starting}
          disabled={botStatus === 'running' || starting || !projectPath}
          onClick={handleStart}
          aria-label={starting ? t('topbar.starting') : t('topbar.runBot')}
          title={starting ? t('topbar.startingDots') : t('topbar.run')}
          leftIcon={<Play className="w-3 h-3" />}
        >
          {starting ? t('topbar.startingDots') : t('topbar.run')}
        </Button>

        {/* 停止按钮 */}
        <Button
          variant="danger"
          size="sm"
          disabled={botStatus !== 'running'}
          onClick={handleStop}
          aria-label={t('topbar.stopBot')}
          title={t('topbar.stop')}
          leftIcon={<Square className="w-3 h-3" />}
        >
          {t('topbar.stop')}
        </Button>

        {/* 主题切换 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleTheme}
          title={isDark ? t('topbar.themeToLight') : t('topbar.themeToDark')}
          aria-label={isDark ? t('topbar.themeToLight') : t('topbar.themeToDark')}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        {/* 语言切换 */}
        <Dropdown
          value={locale}
          ariaLabel={t('topbar.language')}
          onChange={(v) => setLocale(v as 'zh-CN' | 'en-US')}
          options={[
            { value: 'zh-CN', label: t('topbar.langZh') },
            { value: 'en-US', label: t('topbar.langEn') },
          ]}
        />

        {/* 帮助菜单 */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHelpOpen(!helpOpen)}
            onBlur={() => setTimeout(() => setHelpOpen(false), 150)}
            aria-label={t('topbar.helpMenu')}
            aria-expanded={helpOpen}
          >
            {t('topbar.help')}
          </Button>
          {helpOpen && (
            <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50 min-w-40">
              <Button
                variant="ghost"
                size="md"
                className="w-full text-left relative"
                onClick={handleOpenCrash}
                leftIcon={<Bug className="w-4 h-4 shrink-0" />}
              >
                {t('topbar.crashReports')}
                {hasNewCrash && (
                  <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="w-full text-left"
                onClick={() => {
                  setHelpOpen(false);
                  setBotStateOpen(true);
                }}
                leftIcon={<Archive className="w-4 h-4 shrink-0" />}
              >
                {t('topbar.botStateManager')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="w-full text-left"
                onClick={() => {
                  setHelpOpen(false);
                  setAiProviderOpen(true);
                }}
                leftIcon={<Cpu className="w-4 h-4 shrink-0" />}
              >
                {t('topbar.aiProvider')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="w-full text-left"
                onClick={() => {
                  setHelpOpen(false);
                  setPluginManagerOpen(true);
                }}
                leftIcon={<Puzzle className="w-4 h-4 shrink-0" />}
              >
                {t('topbar.plugins')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="w-full text-left"
                onClick={() => {
                  setHelpOpen(false);
                  setDiagnosticsOpen(true);
                }}
                leftIcon={<Package className="w-4 h-4 shrink-0" />}
              >
                {t('topbar.diagnostics')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="w-full text-left"
                onClick={() => {
                  setHelpOpen(false);
                  setFrameworkDevOpen(true);
                }}
                leftIcon={<AlertTriangle className="w-4 h-4 shrink-0" />}
              >
                {t('frameworkDev.menuItem')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 诊断对话框 */}
      <DiagnosticsDialog
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        projectPath={projectPath}
      />

      {/* 崩溃报告对话框 */}
      <CrashReportDialog open={crashOpen} onClose={() => setCrashOpen(false)} />

      {/* 运行状态管理对话框 */}
      <BotStateDialog
        open={botStateOpen}
        onClose={() => setBotStateOpen(false)}
        projectPath={projectPath}
      />

      {/* Git 历史对话框 */}
      <GitHistoryDialog
        open={gitHistoryOpen}
        onClose={() => setGitHistoryOpen(false)}
        projectPath={projectPath}
      />

      {/* AI 提供商配置 */}
      {aiProviderOpen && (
        <AIProviderConfig
          onClose={() => setAiProviderOpen(false)}
          onSaved={() => setAiProviderOpen(false)}
        />
      )}

      {/* 插件管理 */}
      <PluginManager open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

      {/* 框架开发模式（开关 + 醒目标识 + 回滚入口） */}
      <FrameworkDevDialog open={frameworkDevOpen} onClose={() => setFrameworkDevOpen(false)} />

      {/* WebUI Token 通知由全局 ToastProvider 提供 */}
    </div>
  );
}
