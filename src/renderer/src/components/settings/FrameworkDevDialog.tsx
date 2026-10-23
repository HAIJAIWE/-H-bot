import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { useToast } from '../ui/Toast';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { formatFileSize, formatFullDateTime } from '../../lib/infra/format';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { useFrameworkDevStore } from '../../stores/frameworkDevStore';
import type { FrameworkDevRevision } from '../../types/ipc';

/** 回退点来源 → 文案 key（kind 是主进程给的稳定值，这里只做展示映射） */
function kindLabel(revision: FrameworkDevRevision): string {
  if (revision.kind === 'write') return t('frameworkDev.kindWrite');
  if (revision.kind === 'restore') return t('frameworkDev.kindRestore');
  return t('frameworkDev.kindUnknown');
}

/**
 * 「框架开发模式」对话框：**开关 + 醒目标识 + 回滚入口**（规则⑤⑥）。
 *
 * 三件事必须在同一屏里，理由：用户打开这个模式的目的就是"改框架"，而改框架
 * 最需要的是"改坏了怎么办" —— 把回退点列表放在开关旁边，回滚才是一次点击的事。
 */
export function FrameworkDevDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLocaleSubscription();
  const toast = useToast();
  const enabled = useFrameworkDevStore((s) => s.enabled);
  const frameworkRoot = useFrameworkDevStore((s) => s.frameworkRoot);
  const backups = useFrameworkDevStore((s) => s.backups);
  const loading = useFrameworkDevStore((s) => s.loading);
  const error = useFrameworkDevStore((s) => s.error);
  const usage = useFrameworkDevStore((s) => s.usage);
  const securityCriticalWrites = useFrameworkDevStore((s) => s.securityCriticalWrites);
  const inWorkspace = useFrameworkDevStore((s) => s.inWorkspace);
  const refresh = useFrameworkDevStore((s) => s.refresh);
  const setEnabled = useFrameworkDevStore((s) => s.setEnabled);
  const restore = useFrameworkDevStore((s) => s.restore);
  const enterWorkspace = useFrameworkDevStore((s) => s.enterWorkspace);
  const leaveWorkspace = useFrameworkDevStore((s) => s.leaveWorkspace);
  const [busy, setBusy] = useState(false);
  /** 进入框架工作区的**二次确认**：点一次只是展开确认条，再点一次才真的进 */
  const [confirmEnter, setConfirmEnter] = useState(false);

  // 每次打开都从主进程拉一次：界面上的"开着吗"绝不能是缓存里的旧值
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleToggle = async (next: boolean) => {
    setBusy(true);
    const res = await setEnabled(next);
    await refresh();
    setBusy(false);
    if (!res.ok) {
      toast.error(t('frameworkDev.setFailed'));
      return;
    }
    if (!res.persisted) {
      // 走到这里说明主进程没落盘 —— 它的状态**没有变**（fail-closed），界面上刷新后还是原状态
      toast.warning(t('frameworkDev.persistFailed'));
      return;
    }
    setConfirmEnter(false);
    if (next) {
      toast.success(t('frameworkDev.enabledToast'));
      return;
    }
    /**
     * ★ 关闭时：**创作模式已经写不了任何东西了**（文件 IPC 立即拒绝框架根），
     * 所以 store 把它退回了"跟页面"——这里必须告诉用户，否则他会以为自己还在创作模式。
     */
    if (res.resetCreatorMode) toast.warning(t('frameworkDev.creatorModeReset'));
    // ★ 关闭时：如果刚才正待在框架工作区，**必须退回普通项目** ——
    // 不能留在一个已经失去授权的会话里（主进程已经不再放行框架根了）
    if (res.leftFrameworkWorkspace || inWorkspace) {
      const left = await leaveWorkspace();
      toast.success(left ? t('frameworkDev.leftToProject') : t('frameworkDev.leftNoProject'));
      return;
    }
    toast.success(t('frameworkDev.disabledToast'));
  };

  const handleEnterWorkspace = async () => {
    setBusy(true);
    const ok = await enterWorkspace();
    setBusy(false);
    setConfirmEnter(false);
    if (!ok) {
      toast.error(t('frameworkDev.enterFailed'));
      return;
    }
    toast.success(t('frameworkDev.enterDone'));
  };

  const handleLeaveWorkspace = async () => {
    setBusy(true);
    const left = await leaveWorkspace();
    setBusy(false);
    toast.success(left ? t('frameworkDev.leftToProject') : t('frameworkDev.leftNoProject'));
  };

  const handleRestore = async (revisionId: string, relativePath?: string) => {
    setBusy(true);
    const result = await restore(revisionId, relativePath);
    await refresh();
    setBusy(false);
    if (!result) {
      toast.error(t('frameworkDev.restoreFailed'));
      return;
    }
    toast.success(
      t('frameworkDev.restored', {
        restored: String(result.restored.length),
        removed: String(result.removed.length),
        point: result.rollbackPoint,
      }),
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t('frameworkDev.title')} width="720px">
      <div className="space-y-4">
        {/* 开关 */}
        <div className="flex items-start justify-between gap-4">
          <Switch
            checked={enabled}
            disabled={busy}
            onChange={(v) => void handleToggle(v)}
            label={t('frameworkDev.switchLabel')}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            title={t('frameworkDev.refresh')}
          >
            <RefreshCw aria-hidden="true" className="w-3 h-3" />
          </Button>
        </div>

        {/* 开了才说的两句硬话：正在改框架自己 / 主进程要重启 */}
        {enabled && (
          <div className="flex items-start gap-2 rounded border border-amber-600 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle aria-hidden="true" className="mt-0.5 w-4 h-4 shrink-0" />
            <div className="space-y-1">
              <p>{t('frameworkDev.warning')}</p>
              <p className="font-semibold">{t('frameworkDev.mainProcessNote')}</p>
            </div>
          </div>
        )}

        {/* 边界（框架根） + 回退点占用 */}
        <div className="text-xs text-zinc-400">
          <div className="mb-1">{t('frameworkDev.rootPath')}</div>
          <code className="block break-all rounded bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300">
            {frameworkRoot || t('frameworkDev.rootUnknown')}
          </code>
          <div className="mt-1 text-[11px] text-zinc-500">
            {t('frameworkDev.usage', {
              count: String(usage.count),
              limit: String(usage.limit),
              size: formatFileSize(usage.bytes),
            })}
          </div>
        </div>

        {/*
          ★ 护栏可见性（2026-10-16）：**本次会话动过的护栏文件**。
          与普通改动分开说清楚 —— 用户可能几轮之后才发现"禁区没了 / 备份不写了"。
        */}
        {securityCriticalWrites.length > 0 && (
          <div className="rounded border border-red-700 bg-red-500/10 p-2.5 text-xs text-red-200">
            <div className="font-semibold">
              {t('frameworkDev.criticalWritesTitle')}（{securityCriticalWrites.length}）
            </div>
            <ul className="mt-1 space-y-0.5">
              {securityCriticalWrites.map((w) => (
                <li key={w.path} className="font-mono text-[11px]" title={w.why}>
                  · {w.path}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-[11px] text-red-300">
              {t('frameworkDev.criticalWritesHint')}
            </div>
          </div>
        )}

        {/* 框架工作区：显式进入（**不进项目下拉框**），先二次确认 */}
        <div className="rounded border border-zinc-700 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-300">
              {t('frameworkDev.workspaceNow')}
              <span
                className={inWorkspace ? 'ml-1 font-semibold text-amber-300' : 'ml-1 text-zinc-400'}
              >
                {inWorkspace
                  ? t('frameworkDev.workspaceFramework')
                  : t('frameworkDev.workspaceProject')}
              </span>
            </div>
            {inWorkspace ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void handleLeaveWorkspace()}
              >
                {t('frameworkDev.leaveWorkspace')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={!enabled || busy}
                title={!enabled ? t('frameworkDev.enterDisabledHint') : undefined}
                onClick={() => setConfirmEnter(true)}
              >
                {t('frameworkDev.enterWorkspace')}
              </Button>
            )}
          </div>
          {confirmEnter && !inWorkspace && (
            <div className="mt-3 space-y-2 border-t border-zinc-700 pt-3">
              <div className="flex items-start gap-2 text-xs text-amber-200">
                <AlertTriangle aria-hidden="true" className="mt-0.5 w-4 h-4 shrink-0" />
                <p>{t('frameworkDev.enterConfirm')}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmEnter(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleEnterWorkspace()}
                >
                  {t('frameworkDev.confirmEnter')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-red-400">
            {t('frameworkDev.loadFailed')}: {error}
          </div>
        )}

        {/* 回退点 */}
        <div>
          <div className="mb-2 text-sm font-medium text-zinc-200">
            {t('frameworkDev.backupsTitle')}
          </div>
          {/* 已知限制（Lead 2026-10-15 定的）：回滚不是事务，必须写在按钮看得见的地方 */}
          <div className="mb-2 text-[11px] text-zinc-500">{t('frameworkDev.restoreNotAtomic')}</div>
          {backups.length === 0 ? (
            <div className="text-xs text-zinc-500">{t('frameworkDev.noBackups')}</div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {backups.map((revision) => (
                <div
                  key={revision.id}
                  className="rounded border border-zinc-700 bg-zinc-950/60 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-zinc-300">{revision.id}</div>
                      <div className="text-[11px] text-zinc-500">
                        {kindLabel(revision)}
                        {revision.createdAt ? ' · ' + formatFullDateTime(revision.createdAt) : ''}
                        {' · ' +
                          t('frameworkDev.entriesCount', {
                            count: String(revision.entries.length),
                          })}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!enabled || busy || revision.incomplete}
                      title={!enabled ? t('frameworkDev.restoreDisabledHint') : undefined}
                      onClick={() => void handleRestore(revision.id)}
                      leftIcon={<RotateCcw aria-hidden="true" className="w-3 h-3" />}
                    >
                      {t('frameworkDev.restoreRevision')}
                    </Button>
                  </div>
                  {revision.incomplete && (
                    <div className="mt-1 text-[11px] text-red-400">
                      {t('frameworkDev.incomplete')}
                    </div>
                  )}
                  <ul className="mt-2 space-y-1">
                    {revision.entries.map((entry) => (
                      <li
                        key={entry.path}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-zinc-400"
                          title={entry.path}
                        >
                          {entry.path}
                        </span>
                        <span className={entry.existed ? 'text-zinc-500' : 'text-amber-400'}>
                          {entry.existed
                            ? t('frameworkDev.existedTrue')
                            : t('frameworkDev.existedFalse')}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!enabled || busy}
                          onClick={() => void handleRestore(revision.id, entry.path)}
                        >
                          {t('frameworkDev.restoreOne')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
