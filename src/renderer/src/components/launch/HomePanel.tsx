// src/renderer/src/components/launch/HomePanel.tsx
//
// 主页面：最近项目 + 当前项目 + 快捷入口。
// 之前启动页只有仪表盘（一个项目内部的运行态），"有哪些项目、上次做到哪"没有落点 ——
// 左栏 Bot 管理只能启动/停止，recentProjects 状态也一直没人渲染。
import { memo, useCallback, useEffect, useState } from 'react';
import { Folder, FolderOpen, Globe, LayoutDashboard, Plus, SquareCode, X } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUiStore, type CenterTab } from '../../stores/uiStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { NewProjectDialog } from '../project/NewProjectDialog';
import { formatDateTime } from '../../lib/format';
import type { ProjectMeta, RecentProject } from '@shared/types/project';

/** 快捷入口：都落到已有的页签上，不新造目的地 */
const QUICK_ENTRIES: {
  key: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  go: { mode: 'launch' | 'dev' | 'browser'; centerTab?: CenterTab; launchTab?: 'dashboard' };
}[] = [
  {
    key: 'dashboard',
    labelKey: 'launch.nav.dashboard',
    icon: LayoutDashboard,
    go: { mode: 'launch', launchTab: 'dashboard' },
  },
  { key: 'blocks', labelKey: 'launch.center.tabLowcode', icon: SquareCode, go: { mode: 'dev', centerTab: 'blocks' } },
  { key: 'code', labelKey: 'launch.center.tabCode', icon: SquareCode, go: { mode: 'dev', centerTab: 'code' } },
  { key: 'panels', labelKey: 'launch.center.tabPanels', icon: SquareCode, go: { mode: 'dev', centerTab: 'panels' } },
  { key: 'browser', labelKey: 'launch.nav.browser', icon: Globe, go: { mode: 'browser' } },
];

export const HomePanel = memo(function HomePanel() {
  useLocaleSubscription();
  const toast = useToast();
  const currentProject = useProjectStore((s) => s.currentProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const setMode = useUiStore((s) => s.setMode);
  const setLaunchTab = useUiStore((s) => s.setLaunchTab);
  const setCenterTab = useUiStore((s) => s.setCenterTab);

  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyPath, setBusyPath] = useState('');
  const [creating, setCreating] = useState(false);

  const loadRecents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.qqbat.project.listRecent();
      if (res.ok) setRecents((res.data ?? []) as RecentProject[]);
      else setError(res.error || t('launch.home.listFailed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  /** 打开项目：先 open（主进程会记入最近列表）→ 再取 meta 设成当前项目 */
  const openProject = useCallback(
    async (projectPath: string) => {
      if (!projectPath || busyPath) return;
      setBusyPath(projectPath);
      try {
        const opened = await window.qqbat.project.open(projectPath);
        if (!opened.ok) {
          toast.error(opened.error || t('launch.home.openFailed'));
          return;
        }
        const metaRes = await window.qqbat.project.getMeta(projectPath);
        const name = metaRes.ok && metaRes.data ? metaRes.data.name : projectPath;
        if (metaRes.ok && metaRes.data) setCurrentProject(metaRes.data as ProjectMeta);
        // 让左栏「Bot 管理」也能看到它：工作区扫描只看 projects/ 下一层，
        // 从外面打开的项目不会自己出现在列表里。
        try {
          await window.qqbat.botManager.register(projectPath);
        } catch {
          /* 注册失败不影响打开 */
        }
        await loadRecents();
        toast.success(t('launch.home.opened', { name }));
        setMode('launch');
        setLaunchTab('dashboard');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyPath('');
      }
    },
    [busyPath, loadRecents, setCurrentProject, setLaunchTab, setMode, toast],
  );

  const openFolder = useCallback(
    async (projectPath: string) => {
      const res = await window.qqbat.project.openFolder(projectPath);
      if (!res.ok) toast.error(res.error || t('launch.home.openFolderFailed'));
    },
    [toast],
  );

  const removeRecent = useCallback(
    async (projectPath: string) => {
      const res = await window.qqbat.project.removeRecent(projectPath);
      if (!res.ok) {
        toast.error(res.error || t('launch.home.removeFailed'));
        return;
      }
      toast.success(t('launch.home.removed'));
      await loadRecents();
    },
    [loadRecents, toast],
  );

  const pickExisting = useCallback(async () => {
    const picked = await window.qqbat.project.pickDirectory();
    if (!picked.ok) {
      // 用户点「取消」时主进程以 canceled 报错，不该弹红条
      if (picked.error !== 'canceled') toast.error(picked.error || t('launch.home.openFailed'));
      return;
    }
    await openProject(String(picked.data));
  }, [openProject, toast]);

  const handleCreated = useCallback(
    (meta: ProjectMeta) => {
      setCreating(false);
      setCurrentProject(meta);
      toast.success(t('launch.home.created', { name: meta.name }));
      void loadRecents();
      setMode('launch');
      setLaunchTab('dashboard');
    },
    [loadRecents, setCurrentProject, setLaunchTab, setMode, toast],
  );

  const go = useCallback(
    (entry: (typeof QUICK_ENTRIES)[number]) => {
      if (entry.go.centerTab) setCenterTab(entry.go.centerTab);
      if (entry.go.launchTab) setLaunchTab(entry.go.launchTab);
      setMode(entry.go.mode);
    },
    [setCenterTab, setLaunchTab, setMode],
  );

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl space-y-6 px-6 py-5">
        <section>
          <h2 className="mb-2 text-xs font-medium text-zinc-500">{t('launch.home.currentProject')}</h2>
          {currentProject ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-200">
                      {currentProject.name}
                    </span>
                    {currentProject.botType && (
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {t(`launch.botType.${currentProject.botType}`)}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-1 truncate font-mono text-[11px] text-zinc-500"
                    title={currentProject.path}
                  >
                    {currentProject.path}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void openFolder(currentProject.path)}
                    leftIcon={<Folder size={13} />}
                  >
                    {t('launch.home.openFolder')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCreating(true)}
                    leftIcon={<Plus size={13} />}
                  >
                    {t('launch.home.newProject')}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 p-4">
              <p className="text-sm text-zinc-400">{t('launch.home.noProject')}</p>
              <p className="mt-1 text-xs text-zinc-500">{t('launch.home.noProjectHint')}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setCreating(true)}
                  leftIcon={<Plus size={13} />}
                >
                  {t('launch.home.newProject')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void pickExisting()}
                  leftIcon={<FolderOpen size={13} />}
                >
                  {t('launch.home.openExisting')}
                </Button>
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-medium text-zinc-500">{t('launch.home.quickStart')}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {QUICK_ENTRIES.map((entry) => {
              const Icon = entry.icon;
              return (
                <Button
                  key={entry.key}
                  variant="secondary"
                  size="sm"
                  className="h-16 flex-col gap-1.5"
                  onClick={() => go(entry)}
                >
                  <Icon size={16} />
                  <span className="text-xs">{t(entry.labelKey)}</span>
                </Button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium text-zinc-500">{t('launch.home.recent')}</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => void loadRecents()} loading={loading}>
                {t('launch.common.refresh')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void pickExisting()}
                leftIcon={<FolderOpen size={13} />}
              >
                {t('launch.home.openExisting')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(true)}
                leftIcon={<Plus size={13} />}
              >
                {t('launch.home.newProject')}
              </Button>
            </div>
          </div>
          {error ? (
            <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
              <Spinner size="sm" />
              {t('launch.common.loading')}
            </div>
          ) : recents.length === 0 ? (
            <EmptyState
              title={t('launch.home.recentEmpty')}
              description={t('launch.home.recentEmptyHint')}
            />
          ) : (
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {recents.map((recent) => (
                <li
                  key={recent.path}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-zinc-200">{recent.name}</span>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        {t('launch.home.lastOpened', { time: formatDateTime(recent.lastOpenedAt) })}
                      </span>
                    </div>
                    <p className="truncate font-mono text-[11px] text-zinc-500" title={recent.path}>
                      {recent.path}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busyPath === recent.path}
                    onClick={() => void openProject(recent.path)}
                  >
                    {t('launch.home.open')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('launch.home.openFolder')}
                    aria-label={t('launch.home.openFolder')}
                    onClick={() => void openFolder(recent.path)}
                    leftIcon={<Folder size={13} />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('launch.home.remove')}
                    aria-label={t('launch.home.remove')}
                    onClick={() => void removeRecent(recent.path)}
                    leftIcon={<X size={13} />}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {creating && (
        <NewProjectDialog open onClose={() => setCreating(false)} onCreated={handleCreated} />
      )}
    </div>
  );
});
