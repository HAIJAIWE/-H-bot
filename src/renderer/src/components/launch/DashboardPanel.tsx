import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useBotStore } from '../../stores/botStore';
import type { TimelineItem, DashboardStatus } from '@shared/types/launch';
import type { AdapterType, ProjectMeta } from '@shared/types/project';
import { ConnectionConfigDialog } from './ConnectionConfigDialog';
import { SkeletonText } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { NewProjectDialog } from '../project/NewProjectDialog';
import { useToast } from '../ui/Toast';
import { Play, Square, Settings, Info, AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// 在线时长显示子组件：独立维护 1 秒定时器，避免父组件每秒重渲染
function UptimeDisplay({ startedAt }: { startedAt: string | null }) {
  // 本地 tick 仅用于触发每秒重渲染，值本身不被使用
  useLocaleSubscription();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    // 组件卸载或 startedAt 变化时清除定时器
    return () => clearInterval(id);
  }, [startedAt]);

  // 格式化时长为「X时Y分」或「X分Y秒」或「X秒」
  const fmtDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h > 0
      ? t('launch.dashboard.uptimeHm', { h: String(h), m: String(m % 60) })
      : m > 0
        ? t('launch.dashboard.uptimeMs', { m: String(m), s: String(s % 60) })
        : t('launch.dashboard.uptimeS', { s: String(s) });
  };

  if (!startedAt) return <span>-</span>;
  const started = new Date(startedAt).getTime();
  // 无效日期字符串时返回占位符，避免显示「NaN秒」
  if (isNaN(started)) return <span>-</span>;
  return <>{fmtDuration(Date.now() - started)}</>;
}

export const DashboardPanel = React.memo(function DashboardPanel() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const toast = useToast();
  const botStatus = useBotStore((s) => {
    if (!projectPath) return undefined;
    return s.bots.find((b) => b.projectPath === projectPath);
  });
  const running = botStatus?.status === 'running' || botStatus?.status === 'starting';
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [dashboardStatus, setDashboardStatus] = useState<DashboardStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [operating, setOperating] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  // 翻译器端口（自动分配，只读）
  const [translatorPort, setTranslatorPort] = useState<number | undefined>(undefined);
  // 适配器类型（用于 UI 显示）
  const [adapterType, setAdapterType] = useState<AdapterType | undefined>(undefined);
  // 加载/操作错误信息（用于在 UI 显示友好提示，null 表示无错误）
  const [error, setError] = useState<string | null>(null);
  // 新建项目对话框
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // 卸载标志：异步 IPC resolve 后若已卸载，跳过 setState 避免 React 警告
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCreated = (meta: ProjectMeta) => {
    setNewProjectOpen(false);
    useProjectStore.getState().setCurrentProject(meta);
  };

  // 适配器中文映射
  const adapterLabel = (() => {
    const a = adapterType ?? botStatus?.adapter ?? '';
    if (a === 'official') return t('launch.dashboard.adapterOfficial');
    return a || '-';
  })();

  // 每次 botStatus 变化时同步更新仪表盘状态
  const [lastChange, setLastChange] = useState(0);
  useEffect(() => {
    setLastChange(Date.now());
  }, [botStatus?.status]);

  const load = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      // Promise.allSettled 替代 Promise.all：单个 IPC 失败不会让另一个的结果丢失
      const [timelineRes, statusRes] = await Promise.all([
        window.qqbat.launchDashboard.getTimeline(projectPath),
        window.qqbat.launchDashboard.getStatus(projectPath),
      ]).then(([t, s]) => [t, s] as const);
      // 卸载后跳过 setState，避免 React 警告（5s 定时器可能在卸载后才 resolve）
      if (!mountedRef.current) return;
      // 时间线加载失败时记录错误信息并在 UI 提示；成功时清空错误
      if (!timelineRes.ok) {
        setError(timelineRes.error ?? t('launch.dashboard.timelineFailed'));
        setTimeline([]);
      } else if (timelineRes.data) {
        setTimeline(timelineRes.data);
        setError(null);
      }
      if (statusRes.ok && statusRes.data) {
        setDashboardStatus(statusRes.data);
      } else if (!timelineRes.ok) {
        // timeline 和 status 都失败时，error 已由 timelineRes 分支设置，此处不覆盖
      } else {
        // timeline 成功但 status 失败，不阻塞展示时间线，提示用户
        console.error('[DashboardPanel] 加载状态数据失败:', statusRes.error);
        toast.error(t('launch.dashboard.statusFailed'));
      }
    } catch (err) {
      // IPC 调用本身抛出异常（如桥接失败）时记录并提示用户
      console.error('[DashboardPanel] 加载仪表盘数据失败:', err);
      if (!mountedRef.current) return;
      setError(t('launch.dashboard.dashboardFailed'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectPath, toast]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
    // 当状态变化时也刷新
  }, [load, lastChange]);

  // 加载项目配置（用于读取翻译器端口和适配器类型）
  useEffect(() => {
    if (!projectPath) return;
    window.qqbat.project
      .getConfig(projectPath)
      .then((res) => {
        if (res.ok && res.data) {
          setTranslatorPort(res.data.translatorPort);
          setAdapterType(res.data.adapter);
        }
      })
      .catch((err) => {
        // IPC 桥接失败时记录日志，提示用户
        console.error('[DashboardPanel] 加载项目配置失败:', err);
        toast.error(t('launch.dashboard.configFailed'));
      });
  }, [projectPath, toast]);

  const handleStart = async () => {
    if (!projectPath) return;
    const { startBot } = useBotStore.getState();
    setOperating(true);
    try {
      await startBot(projectPath);
      await load();
    } catch (err) {
      console.error('[DashboardPanel] 启动失败:', err);
      setError(
        t('launch.dashboard.startFailed', {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setOperating(false);
    }
  };

  const handleStop = async () => {
    if (!projectPath) return;
    const { stopBot } = useBotStore.getState();
    setOperating(true);
    try {
      await stopBot(projectPath);
      await load();
    } catch (err) {
      console.error('[DashboardPanel] 停止失败:', err);
      setError(
        t('launch.dashboard.stopFailed', {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setOperating(false);
    }
  };

  /** 保存连接配置（翻译器端口）—— 旧名 handleSaveNapcat 是 NapCat 时代的遗留命名 */
  const handleSaveTranslatorPort = async (data: { translatorPort: number }) => {
    if (!projectPath) return;
    try {
      // 保存翻译器端口
      if (data.translatorPort !== translatorPort) {
        await window.qqbat.project.updateTranslatorPort(projectPath, data.translatorPort);
        setTranslatorPort(data.translatorPort);
      }
      setError(null);
    } catch (err) {
      // 保存配置时 IPC 抛出异常，记录日志并在 UI 提示
      console.error('[DashboardPanel] 保存连接配置失败:', err);
      setError(t('launch.dashboard.saveConfigFailed'));
    }
  };

  if (!projectPath) {
    return (
      <>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title={t('launch.common.selectProject')}
            description={t('launch.common.selectProjectHint')}
            action={
              <Button variant="primary" size="sm" onClick={() => setNewProjectOpen(true)}>
                {t('launch.common.newProject')}
              </Button>
            }
          />
        </div>
        {newProjectOpen && (
          <NewProjectDialog
            open
            onClose={() => setNewProjectOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </>
    );
  }

  return (
    <div className="@container flex-1 flex flex-col bg-zinc-950 overflow-y-auto p-3 @md:p-4 gap-3 @md:gap-4">
      {/* 操作栏：启停按钮 + 连接配置。
          中栏可能只有 380px（两侧面板可拖宽），固定单行会把按钮压到互相重叠，窄的时候允许换行。 */}
      <div className="flex flex-wrap items-center gap-2 bg-zinc-900 rounded-lg border border-zinc-800 px-3 @md:px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button
            variant="success"
            size="md"
            onClick={handleStart}
            disabled={operating || running}
            leftIcon={<Play className="w-3.5 h-3.5" />}
          >
            {operating ? t('launch.common.working') : t('launch.dashboard.start')}
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={handleStop}
            disabled={operating || !running}
            leftIcon={<Square className="w-3.5 h-3.5" />}
          >
            {t('launch.dashboard.stop')}
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">
            {adapterType === 'official'
              ? t('launch.dashboard.translatorPort', { port: String(translatorPort ?? '-') })
              : t('launch.dashboard.adapterName', { name: String(adapterType ?? '-') })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfigDialogOpen(true)}
            title={t('launch.dashboard.connectionTitle')}
            leftIcon={<Settings className="w-3 h-3" />}
          >
            {t('launch.dashboard.connection')}
          </Button>
          {/* 端口说明帮助提示 */}
          <span
            className="text-zinc-500 hover:text-zinc-300 cursor-help select-none inline-flex items-center"
            title={
              adapterType === 'official'
                ? t('launch.dashboard.officialHint')
                : t('launch.dashboard.adapterConfig')
            }
          >
            <Info className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {loading && timeline.length === 0 && (
        <div className="px-4 py-4 space-y-3">
          <SkeletonText lines={4} />
          <div className="border-t border-zinc-800 my-3" />
          <SkeletonText lines={3} />
          <div className="border-t border-zinc-800 my-3" />
          <SkeletonText lines={4} />
        </div>
      )}

      {/* 加载/操作失败时的友好错误提示，附带重试按钮 */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-2.5 text-sm text-red-300 flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="w-4 h-4 shrink-0" />
            {error}
          </span>
          <Button
            variant="danger"
            size="sm"
            className="text-xs text-red-400 hover:text-red-200 underline ml-2 shrink-0"
            onClick={load}
          >
            {t('launch.common.retry')}
          </Button>
        </div>
      )}

      {/* 状态卡片 */}
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-5">
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{t('launch.dashboard.runtimeStatus')}</div>
          <div
            className={`text-lg font-semibold inline-flex items-center gap-2 ${running ? 'text-green-400' : 'text-zinc-500'}`}
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${running ? 'bg-green-400' : 'bg-zinc-600'}`}
            />
            {running ? t('launch.dashboard.running') : t('launch.dashboard.stopped')}
          </div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{t('launch.dashboard.uptime')}</div>
          <div className="text-lg font-semibold text-zinc-200">
            <UptimeDisplay startedAt={running ? (botStatus?.startedAt ?? null) : null} />
          </div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{t('data.field.messageCount')}</div>
          <div className="text-lg font-semibold text-zinc-200">
            {dashboardStatus?.messageCount ?? 0}
          </div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{t('launch.dashboard.adapter')}</div>
          <div className="text-lg font-semibold text-zinc-200">{adapterLabel}</div>
        </div>
        {/* 翻译器端口（自动分配，只读） */}
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{t('launch.connection.translatorPort')}</div>
          <div className="text-lg font-semibold text-zinc-200">
            {translatorPort != null ? translatorPort : '-'}
          </div>
        </div>
      </div>

      {/* 时间线 */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 flex-1 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-300">
            {t('launch.dashboard.recentActivity')}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-zinc-500 hover:text-zinc-300"
            onClick={load}
          >
            {t('launch.common.refresh')}
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {timeline.length === 0 && (
            <EmptyState
              title={t('launch.common.noActivity')}
              description={t('launch.dashboard.noActivityHint')}
              action={
                <Button variant="secondary" size="sm" onClick={load}>
                  {t('launch.common.refresh')}
                </Button>
              }
            />
          )}
          {timeline.map((item) => (
            <div key={item.id} className="flex gap-2 text-sm items-baseline">
              <span className="text-zinc-500 shrink-0 w-16 font-mono text-xs">{item.time}</span>
              <span
                className={
                  'shrink-0 text-xs ' +
                  (item.type === 'message'
                    ? 'text-blue-400'
                    : item.type === 'reply'
                      ? 'text-green-400'
                      : 'text-yellow-400')
                }
              >
                {item.type === 'message'
                  ? t('launch.dashboard.eventMessage')
                  : item.type === 'reply'
                    ? t('launch.dashboard.eventReply')
                    : t('launch.dashboard.eventEvent')}
              </span>
              <span className="text-zinc-300 break-all">{item.content}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 连接配置弹窗 */}
      <ConnectionConfigDialog
        open={configDialogOpen}
        onClose={() => setConfigDialogOpen(false)}
        onSave={handleSaveTranslatorPort}
        adapter={adapterType ?? 'official'}
        translatorPort={translatorPort ?? 0}
      />
    </div>
  );
});
