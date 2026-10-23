import React, { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useBotStore } from '../../stores/botStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTestStore } from '../../stores/testStore';
import { useUiStore } from '../../stores/uiStore';
import { NewProjectDialog } from '../project/NewProjectDialog';
import type { ProjectMeta } from '@shared/types/project';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { inputForm } from '../ui/inputStyles';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { Bot, Circle, Settings, Play, Pencil, Folder, Copy, Trash2 } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface MenuPos {
  x: number;
  y: number;
  projectPath: string;
  name: string;
}

const statusConfig: Record<string, { dot: ReactNode; label: string; color: string }> = {
  running: {
    dot: <Circle className="w-3 h-3 fill-green-500 text-green-500" />,
    get label() {
      return t('launch.dashboard.running');
    },
    color: 'text-green-400',
  },
  starting: {
    dot: <Circle className="w-3 h-3 fill-yellow-500 text-yellow-500" />,
    get label() {
      return t('launch.bots.starting');
    },
    color: 'text-yellow-400',
  },
  stopped: {
    dot: <Circle className="w-3 h-3 fill-zinc-500 text-zinc-500" />,
    get label() {
      return t('launch.dashboard.stopped');
    },
    color: 'text-zinc-500',
  },
  crashed: {
    dot: <Circle className="w-3 h-3 fill-red-500 text-red-500" />,
    get label() {
      return t('launch.bots.error');
    },
    color: 'text-red-400',
  },
  error: {
    dot: <Circle className="w-3 h-3 fill-red-500 text-red-500" />,
    get label() {
      return t('launch.bots.error');
    },
    color: 'text-red-400',
  },
};

const adapterIcons: Record<string, ReactNode> = {
  official: <Circle className="w-3 h-3 fill-blue-500 text-blue-500" />,
};

export const BotManagerPanel = React.memo(function BotManagerPanel() {
  // 分片订阅：整库订阅会让 bots/loading/error 任一字段变化都重渲染整个面板
  useLocaleSubscription();
  const bots = useBotStore((s) => s.bots);
  const selectedBotPath = useBotStore((s) => s.selectedBotPath);
  const loading = useBotStore((s) => s.loading);
  const error = useBotStore((s) => s.error);
  const loadBots = useBotStore((s) => s.loadBots);
  const selectBot = useBotStore((s) => s.selectBot);
  const startBot = useBotStore((s) => s.startBot);
  const stopBot = useBotStore((s) => s.stopBot);
  const restartBot = useBotStore((s) => s.restartBot);
  const toast = useToast();
  // 防御快速点击竞态：用 token 标记每次点击，过期请求的结果被丢弃
  const clickTokenRef = useRef(0);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [renamingMap, setRenamingMap] = useState<Record<string, string>>({});
  const openTestDialog = useTestStore((s) => s.openDialog);
  const botRunning = useTestStore((s) => s.botRunning);
  const setLaunchTab = useUiStore((s) => s.setLaunchTab);
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  // 删除确认 Modal 状态
  const [deleteTarget, setDeleteTarget] = useState<{ projectPath: string; name: string } | null>(
    null,
  );
  // 克隆项目 Modal 状态
  const [cloneTarget, setCloneTarget] = useState<{ projectPath: string; name: string } | null>(
    null,
  );
  const [cloneName, setCloneName] = useState('');
  // 当前正在启停/重启的 bot 路径，用于禁用按钮并显示 loading
  const [operatingBot, setOperatingBot] = useState<string | null>(null);

  const handleBotAction = async (path: string, action: 'start' | 'stop' | 'restart') => {
    setOperatingBot(path);
    try {
      if (action === 'start') {
        await startBot(path);
      } else if (action === 'stop') {
        await stopBot(path);
      } else {
        // restartBot 内部用 setTimeout 延迟 500ms 再 startBot，这里多等一会覆盖该延迟
        await restartBot(path);
        await new Promise((r) => setTimeout(r, 600));
      }
    } finally {
      setOperatingBot(null);
    }
  };

  useEffect(() => {
    loadBots();
  }, [loadBots]);

  // 点击外部或 Escape 关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const handleCreated = (meta: ProjectMeta) => {
    setNewDialogOpen(false);
    useProjectStore.getState().setCurrentProject(meta);
    loadBots().then(() => {
      selectBot(meta.path);
    });
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, projectPath: string, name: string) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, projectPath, name });
    },
    [],
  );

  const handleRename = useCallback(
    async (projectPath: string, oldName: string) => {
      const newName = renamingMap[projectPath]?.trim();
      if (!newName || newName === oldName) {
        setRenamingMap((m) => {
          const c = { ...m };
          delete c[projectPath];
          return c;
        });
        return;
      }
      try {
        const res = await window.qqbat.project.rename(projectPath, newName);
        if (!res.ok) {
          toast.error(
            t('launch.bots.renameFailed', { msg: res.error || t('launch.common.unknownError') }),
          );
          return;
        }
        setRenamingMap((m) => {
          const c = { ...m };
          delete c[projectPath];
          return c;
        });
        // 同步更新当前项目名称
        const current = useProjectStore.getState().currentProject;
        if (current && current.path === projectPath) {
          useProjectStore.getState().setCurrentProject({ ...current, name: newName });
        }
        loadBots();
        toast.success(t('launch.bots.renamed'));
      } catch (e) {
        console.error('[BotManagerPanel] 重命名失败：', e);
        toast.error(
          t('launch.bots.renameFailed', { msg: e instanceof Error ? e.message : String(e) }),
        );
      }
    },
    [renamingMap, loadBots, toast],
  );

  // 打开删除确认 Modal
  const handleDelete = useCallback((projectPath: string, name: string) => {
    setDeleteTarget({ projectPath, name });
  }, []);

  // 确认删除项目
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { projectPath } = deleteTarget;
    try {
      const res = await window.qqbat.project.delete(projectPath);
      if (!res.ok) {
        toast.error(
          t('launch.bots.deleteFailed', { msg: res.error || t('launch.common.unknownError') }),
        );
        return;
      }
      // 如果删除的是当前项目，清除
      const current = useProjectStore.getState().currentProject;
      if (current && current.path === projectPath) {
        useProjectStore.getState().setCurrentProject(null);
      }
      loadBots();
      setDeleteTarget(null);
      toast.success(t('launch.bots.deleted'));
    } catch (e) {
      console.error('[BotManagerPanel] 删除项目失败：', e);
      toast.error(
        t('launch.bots.deleteFailed', { msg: e instanceof Error ? e.message : String(e) }),
      );
    }
  }, [deleteTarget, loadBots, toast]);

  const handleOpenFolder = useCallback(
    async (projectPath: string) => {
      try {
        const res = await window.qqbat.project.openFolder(projectPath);
        if (!res.ok) {
          toast.error(
            t('launch.bots.openFolderFailed', {
              msg: res.error || t('launch.common.unknownError'),
            }),
          );
        }
      } catch (e) {
        console.error('[BotManagerPanel] 打开文件夹失败：', e);
        toast.error(
          t('launch.bots.openFolderFailed', { msg: e instanceof Error ? e.message : String(e) }),
        );
      }
    },
    [toast],
  );

  // 打开克隆项目 Modal
  const handleClone = useCallback((projectPath: string, name: string) => {
    setCloneTarget({ projectPath, name });
    setCloneName(t('launch.bots.copyName', { name }));
  }, []);

  // 确认克隆项目
  const confirmClone = useCallback(async () => {
    if (!cloneTarget) return;
    const { projectPath } = cloneTarget;
    const newName = cloneName.trim();
    if (!newName) return;
    try {
      const res = await window.qqbat.project.clone(projectPath, newName);
      if (res.ok && res.data) {
        useProjectStore.getState().setCurrentProject(res.data as ProjectMeta);
        loadBots();
      }
    } catch (err) {
      // 记录克隆失败的详细错误到控制台，便于排查
      console.error('[BotManagerPanel] 克隆项目失败：', err);
      // 通过全局 Toast 提示用户失败原因
      toast.error(
        t('launch.bots.cloneFailed', { msg: err instanceof Error ? err.message : String(err) }),
      );
    }
    setCloneTarget(null);
  }, [cloneTarget, cloneName, loadBots, toast]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 标题行 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <h3 className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
          <Bot className="w-4 h-4" />
          {t('launch.bots.manage')}
        </h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
              botRunning
                ? 'bg-green-700 hover:bg-green-600 text-white'
                : 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-200'
            }`}
            onClick={openTestDialog}
            title={botRunning ? t('launch.bots.mockTestHint') : t('launch.bots.openMockTest')}
            leftIcon={<Play className="w-3 h-3" />}
          >
            {t('launch.bots.mockTest')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setNewDialogOpen(true)}>
            {t('launch.bots.newBot')}
          </Button>
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && bots.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <Spinner size="sm" />
            <span className="ml-2 text-xs text-zinc-500">{t('launch.common.loading')}</span>
          </div>
        )}

        {error && (
          <div className="px-3 py-3 text-center">
            <p className="text-xs text-red-400 mb-2">{error}</p>
            <Button variant="primary" size="sm" onClick={() => loadBots()}>
              {t('launch.common.retry')}
            </Button>
          </div>
        )}

        {!loading && bots.length === 0 && !error && (
          <EmptyState title={t('launch.bots.empty')} description={t('launch.bots.emptyHint')} />
        )}

        {bots.map((bot) => {
          const cfg = statusConfig[bot.status] ?? statusConfig.stopped;
          const isSelected = selectedBotPath === bot.projectPath;
          const localRenaming = renamingMap[bot.projectPath] !== undefined;
          const localNewName = renamingMap[bot.projectPath] ?? bot.name;

          return (
            <div
              key={bot.projectPath}
              role="button"
              tabIndex={0}
              aria-label={t('launch.bots.selectBotAria', { name: bot.name })}
              className={`mx-2 my-1 px-3 py-2 rounded cursor-pointer border transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-zinc-800'
                  : 'border-transparent bg-zinc-900 hover:bg-zinc-800/60'
              }`}
              onClick={async () => {
                // 防御快速点击竞态：以最后一次点击为准，先 selectBot 再异步拉取 meta
                // 但若用户在 await 期间点了另一个 bot，旧请求 resolve 后仍会覆盖当前项目
                // 用 token 标记本次请求，过期则丢弃结果
                clickTokenRef.current += 1;
                const token = clickTokenRef.current;
                selectBot(bot.projectPath);
                try {
                  const api = window.qqbat.project as unknown as {
                    getMeta: (
                      path: string,
                    ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
                  };
                  const res = await api.getMeta(bot.projectPath);
                  // 若期间用户点了其他 bot，丢弃本次结果
                  if (token !== clickTokenRef.current) return;
                  if (res.ok && res.data) {
                    useProjectStore.getState().setCurrentProject(res.data as ProjectMeta);
                  } else if (!res.ok) {
                    toast.error(
                      t('launch.bots.loadProjectFailed', {
                        msg: res.error ?? t('launch.common.unknownError'),
                      }),
                    );
                  }
                } catch (e) {
                  if (token !== clickTokenRef.current) return;
                  toast.error(
                    t('launch.bots.loadProjectFailed', {
                      msg: e instanceof Error ? e.message : String(e),
                    }),
                  );
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectBot(bot.projectPath);
                  const api = window.qqbat.project as unknown as {
                    getMeta: (
                      path: string,
                    ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
                  };
                  api.getMeta(bot.projectPath).then((res) => {
                    if (res.ok && res.data)
                      useProjectStore.getState().setCurrentProject(res.data as ProjectMeta);
                  });
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, bot.projectPath, bot.name)}
            >
              {/* 头行：名称 + 状态 */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {localRenaming ? (
                    <input
                      className="w-24 bg-zinc-800 border border-blue-500 rounded px-1 py-0.5 text-xs text-zinc-200 outline-none"
                      value={localNewName}
                      onChange={(e) =>
                        setRenamingMap((m) => ({ ...m, [bot.projectPath]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(bot.projectPath, bot.name);
                        if (e.key === 'Escape')
                          setRenamingMap((m) => {
                            const c = { ...m };
                            delete c[bot.projectPath];
                            return c;
                          });
                      }}
                      onBlur={() => handleRename(bot.projectPath, bot.name)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm font-medium text-zinc-200 truncate">{bot.name}</span>
                  )}
                  {bot.qq && <span className="text-xs text-zinc-500 shrink-0">{bot.qq}</span>}
                </div>
                <span className={`text-xs ${cfg.color} shrink-0 ml-2 flex items-center gap-1`}>
                  {cfg.dot} {cfg.label}
                </span>
              </div>

              {/* 第二行：适配器 + 操作 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    {adapterIcons[bot.adapter] ?? (
                      <Settings aria-hidden="true" className="w-3 h-3" />
                    )}
                    {bot.adapter || '-'}
                  </span>
                  {bot.status === 'running' && bot.uptime !== null && (
                    <span className="text-xs text-zinc-500">
                      |{' '}
                      {t('launch.dashboard.uptimeMs', {
                        m: String(Math.floor(bot.uptime / 60)),
                        s: String(bot.uptime % 60),
                      })}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {bot.status === 'running' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={operatingBot === bot.projectPath}
                        title={
                          operatingBot === bot.projectPath
                            ? t('launch.bots.working')
                            : t('launch.console.restart')
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBotAction(bot.projectPath, 'restart');
                        }}
                      >
                        {t('launch.bots.restart')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={operatingBot === bot.projectPath}
                        title={
                          operatingBot === bot.projectPath
                            ? t('launch.bots.working')
                            : t('launch.bots.stopBot')
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBotAction(bot.projectPath, 'stop');
                        }}
                      >
                        {t('launch.dashboard.stop')}
                      </Button>
                    </>
                  )}
                  {bot.status === 'stopped' && (
                    <Button
                      variant="success"
                      size="sm"
                      loading={operatingBot === bot.projectPath}
                      title={
                        operatingBot === bot.projectPath
                          ? t('launch.bots.working')
                          : t('launch.bots.startBot')
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBotAction(bot.projectPath, 'start');
                      }}
                    >
                      {t('launch.dashboard.start')}
                    </Button>
                  )}
                  {(bot.status === 'crashed' || bot.status === 'error') && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={operatingBot === bot.projectPath}
                        title={
                          operatingBot === bot.projectPath
                            ? t('launch.bots.working')
                            : t('launch.console.restart')
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBotAction(bot.projectPath, 'restart');
                        }}
                      >
                        {t('launch.bots.restart')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        title={t('launch.bots.viewBotLog')}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectBot(bot.projectPath);
                          const api = window.qqbat.project as unknown as {
                            getMeta: (
                              path: string,
                            ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
                          };
                          api.getMeta(bot.projectPath).then((res) => {
                            if (res.ok && res.data) {
                              useProjectStore.getState().setCurrentProject(res.data as ProjectMeta);
                            }
                          });
                          if (mode !== 'launch') setMode('launch');
                          setLaunchTab('logs');
                        }}
                      >
                        {t('launch.bots.viewLog')}
                      </Button>
                    </>
                  )}
                  {bot.status === 'starting' && (
                    <span className="text-xs text-yellow-400">{t('launch.bots.startingDots')}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 右键菜单 */}
      {menu && (
        <div
          className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg py-1 w-40"
          role="menu"
          aria-label={t('launch.bots.contextMenu')}
          // 边界裁剪：避免菜单溢出窗口右下边缘
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 220),
          }}
          onClick={() => setMenu(null)}
        >
          <Button
            variant="ghost"
            size="md"
            className="w-full text-left"
            role="menuitem"
            onClick={() => {
              setRenamingMap((m) => ({ ...m, [menu.projectPath]: menu.name }));
              setMenu(null);
            }}
            leftIcon={<Pencil className="w-4 h-4" />}
          >
            {t('launch.bots.rename')}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="w-full text-left"
            role="menuitem"
            onClick={() => {
              handleOpenFolder(menu.projectPath);
              setMenu(null);
            }}
            leftIcon={<Folder className="w-4 h-4" />}
          >
            {t('launch.bots.openFolder')}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="w-full text-left"
            role="menuitem"
            onClick={() => {
              handleClone(menu.projectPath, menu.name);
              setMenu(null);
            }}
            leftIcon={<Copy className="w-4 h-4" />}
          >
            {t('launch.bots.clone')}
          </Button>
          <div className="border-t border-zinc-700 my-1" />
          <Button
            variant="danger"
            size="md"
            className="w-full text-left"
            role="menuitem"
            onClick={() => {
              handleDelete(menu.projectPath, menu.name);
              setMenu(null);
            }}
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            {t('launch.bots.delete')}
          </Button>
        </div>
      )}

      {newDialogOpen && (
        <NewProjectDialog open onClose={() => setNewDialogOpen(false)} onCreated={handleCreated} />
      )}

      {/* 删除项目确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('launch.bots.delete')}
        confirmText={t('launch.common.confirmDelete')}
        variant="danger"
        warning
      >
        <div>
          <p className="text-sm text-zinc-300">
            {t('launch.bots.deleteConfirm', { name: deleteTarget?.name ?? '' })}
          </p>
          <p className="text-xs text-red-400 mt-2">{t('launch.bots.deleteWarning')}</p>
        </div>
      </ConfirmDialog>

      {/* 克隆项目（带输入框） */}
      <ConfirmDialog
        open={cloneTarget !== null}
        onClose={() => setCloneTarget(null)}
        onConfirm={confirmClone}
        title={t('launch.bots.clone')}
        confirmText={t('launch.bots.confirmClone')}
        confirmDisabled={!cloneName.trim()}
      >
        <div>
          <label className="block text-xs text-zinc-400 mb-1.5">
            {t('launch.bots.cloneNameLabel')}
          </label>
          <input
            className={`w-full ${inputForm}`}
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && cloneName.trim()) confirmClone();
            }}
            autoFocus
          />
        </div>
      </ConfirmDialog>
    </div>
  );
});
