import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { formatDateTime, formatFileSize } from '../../lib/infra/format';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface StateEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

interface StatsData {
  stateCount: number;
  sessionCount: number;
  dbSize: number;
}

interface BotStateDialogProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}

export function BotStateDialog({ open, onClose, projectPath }: BotStateDialogProps) {
  useLocaleSubscription();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [entries, setEntries] = useState<StateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, entriesRes] = await Promise.all([
        window.qqbat.stateStore.stats(projectPath),
        window.qqbat.stateStore.getAllStateEntries(projectPath),
      ]);
      if (statsRes.ok && statsRes.data) setStats(statsRes.data);
      else if (!statsRes.ok) setError(statsRes.error ?? t('settings.botState.statsFailed'));

      if (entriesRes.ok && entriesRes.data) setEntries(entriesRes.data);
      else if (!entriesRes.ok) setError(entriesRes.error ?? t('settings.botState.entriesFailed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) {
      loadData();
      setShowConfirmClear(false);
    }
  }, [open, loadData]);

  const handleClearAll = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await window.qqbat.stateStore.clearAll(projectPath);
      if (res.ok) {
        setStats({ stateCount: 0, sessionCount: 0, dbSize: 0 });
        setEntries([]);
        setShowConfirmClear(false);
      } else {
        setError(res.error ?? t('settings.botState.clearFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.botState.title')}
      width="520px"
      footer={
        !showConfirmClear ? (
          <div className="w-full flex justify-between items-center">
            <div className="text-xs text-zinc-500">{t('settings.botState.dbHint')}</div>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="md"
                onClick={() => setShowConfirmClear(true)}
                disabled={loading || (stats?.stateCount === 0 && stats?.sessionCount === 0)}
              >
                {t('settings.botState.clearAll')}
              </Button>
              <Button variant="secondary" size="md" onClick={onClose}>
                {t('editor.action.close')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="w-full">
            <p className="text-sm text-red-400 mb-3">{t('settings.botState.clearConfirm')}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setShowConfirmClear(false)}
                disabled={loading}
              >
                {t('editor.action.cancel')}
              </Button>
              <Button variant="danger" size="md" onClick={handleClearAll} disabled={loading}>
                {loading ? t('settings.botState.clearing') : t('settings.botState.confirmClear')}
              </Button>
            </div>
          </div>
        )
      }
    >
      {/* 概览统计 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-blue-400">
            {loading ? '...' : (stats?.stateCount ?? 0)}
          </div>
          <div className="text-xs text-zinc-400 mt-1">{t('settings.botState.variables')}</div>
        </div>
        <div className="bg-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-400">
            {loading ? '...' : (stats?.sessionCount ?? 0)}
          </div>
          <div className="text-xs text-zinc-400 mt-1">{t('settings.botState.sessions')}</div>
        </div>
        <div className="bg-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-yellow-400">
            {loading ? '...' : stats ? formatFileSize(stats.dbSize) : '0 B'}
          </div>
          <div className="text-xs text-zinc-400 mt-1">{t('settings.botState.dbSize')}</div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-400">
          {error}
        </div>
      )}

      {/* 状态列表 */}
      <div className="mb-2">
        <h3 className="text-sm font-medium text-zinc-400 mb-2">{t('settings.botState.list')}</h3>
        {loading && entries.length === 0 ? (
          <div className="text-center text-zinc-500 py-8">{t('editor.action.loading')}</div>
        ) : entries.length === 0 ? (
          <div className="text-center text-zinc-500 py-8">{t('settings.botState.empty')}</div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => (
              <div
                key={entry.key}
                className="flex items-start justify-between p-2 bg-zinc-800/50 rounded text-sm gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 font-mono text-xs break-all">{entry.key}</div>
                  <div className="text-zinc-500 text-xs mt-0.5">
                    {t('settings.botState.updatedAt', { time: formatDateTime(entry.updatedAt) })}
                  </div>
                </div>
                <div className="text-zinc-400 font-mono text-xs truncate max-w-[200px]">
                  {typeof entry.value === 'object'
                    ? JSON.stringify(entry.value).slice(0, 60)
                    : String(entry.value).slice(0, 60)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
