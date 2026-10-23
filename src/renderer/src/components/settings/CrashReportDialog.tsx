import { useState, useEffect, useCallback } from 'react';
import type { CrashReportMeta, CrashReportDetail } from '../../types/ipc';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { formatTimestamp } from '../../lib/infra/format';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface CrashReportDialogProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  get uncaughtException() {
    return t('settings.crash.typeUncaught');
  },
  get unhandledRejection() {
    return t('settings.crash.typeUnhandledRejection');
  },
  get renderer() {
    return t('settings.crash.typeRenderer');
  },
  get captured() {
    return t('settings.crash.typeCaptured');
  },
};

const TYPE_COLORS: Record<string, string> = {
  uncaughtException: 'text-red-400',
  unhandledRejection: 'text-yellow-400',
  renderer: 'text-orange-400',
  captured: 'text-blue-400',
};

export function CrashReportDialog({ open, onClose }: CrashReportDialogProps) {
  useLocaleSubscription();
  const [reports, setReports] = useState<CrashReportMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrashReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.qqbat.crash.getReports();
      if (res.ok && res.data) {
        setReports(res.data);
      } else {
        setError(res.error ?? t('settings.crash.loadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadReports();
      setSelectedId(null);
      setDetail(null);
    }
  }, [open, loadReports]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    window.qqbat.crash
      .readReport(selectedId)
      .then((res) => {
        if (res.ok && res.data) {
          setDetail(res.data);
        } else {
          setError(res.error ?? t('settings.crash.readFailed'));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const handleClear = async () => {
    try {
      const res = await window.qqbat.crash.clearReports();
      if (res.ok) {
        setReports([]);
        setSelectedId(null);
        setDetail(null);
      } else {
        setError(res.error ?? t('settings.crash.clearFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await window.qqbat.crash.exportDiagnostic();
      if (!res.ok) {
        setError(res.error ?? t('editor.metrics.exportFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        reports.length > 0
          ? t('settings.crash.titleWithCount', { count: reports.length })
          : t('settings.crash.title')
      }
      width="720px"
      footer={
        <>
          {reports.length > 0 && (
            <Button variant="secondary" size="md" onClick={handleClear}>
              {t('settings.crash.clearHistory')}
            </Button>
          )}
          <Button variant="secondary" size="md" onClick={loadReports} loading={loading}>
            {t('editor.action.refresh')}
          </Button>
          <Button variant="primary" size="md" onClick={handleExport} loading={exporting}>
            {t('settings.crash.exportBundle')}
          </Button>
        </>
      }
    >
      {error && (
        <div
          className="mb-4 p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-400"
          id="crash-dialog-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* 表格 */}
      <div className="border border-zinc-700 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
              <th className="px-3 py-2 text-left w-40">{t('settings.crash.colTime')}</th>
              <th className="px-3 py-2 text-left w-24">{t('settings.crash.colType')}</th>
              <th className="px-3 py-2 text-left">{t('settings.crash.colMessage')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-700">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-zinc-500">
                  {t('editor.action.loading')}
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <EmptyState
                    title={t('settings.crash.empty')}
                    description={t('settings.crash.emptyDesc')}
                    action={
                      <Button variant="secondary" size="sm" onClick={loadReports}>
                        {t('editor.action.refresh')}
                      </Button>
                    }
                  />
                </td>
              </tr>
            ) : (
              reports.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  className={`cursor-pointer transition-colors hover:bg-zinc-800 ${
                    selectedId === r.id ? 'bg-zinc-800' : ''
                  }`}
                  onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(r.id === selectedId ? null : r.id);
                    }
                  }}
                  aria-label={t('settings.crash.rowAria', { message: r.message })}
                >
                  <td className="px-3 py-2 text-zinc-300 font-mono text-xs whitespace-nowrap">
                    {formatTimestamp(r.timestamp)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs ${TYPE_COLORS[r.type] ?? 'text-zinc-400'}`}>
                      {TYPE_LABELS[r.type] ?? r.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-200 truncate max-w-xs">{r.message}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 展开的堆栈详情 */}
      {selectedId && (
        <div className="mt-3 border border-zinc-700 rounded bg-zinc-950 p-3 overflow-y-auto max-h-60">
          {detailLoading ? (
            <div className="text-sm text-zinc-500 text-center py-4">
              {t('settings.crash.loadingDetail')}
            </div>
          ) : detail ? (
            <div>
              <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-zinc-400">
                <div>{t('settings.crash.version', { value: detail.version })}</div>
                <div>{t('settings.crash.os', { value: detail.os })}</div>
              </div>
              {detail.extra && Object.keys(detail.extra).length > 0 && (
                <div className="mb-3 text-xs text-zinc-400">
                  <span className="font-medium">{t('settings.crash.extra')}</span>
                  <pre className="mt-1 text-zinc-300 whitespace-pre-wrap">
                    {JSON.stringify(detail.extra, null, 2)}
                  </pre>
                </div>
              )}
              <div className="text-xs text-zinc-400">
                <span className="font-medium">{t('settings.crash.stack')}</span>
                <pre className="mt-1 text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {detail.stack || t('settings.crash.noStack')}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500 text-center py-4">
              {t('settings.crash.detailFailed')}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
