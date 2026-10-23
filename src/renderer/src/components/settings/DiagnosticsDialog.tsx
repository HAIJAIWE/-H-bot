import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface ProgressData {
  phase: string;
  message: string;
  error?: string;
}

interface DiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}

const PHASE_LABELS: Record<string, string> = {
  get collecting_logs() {
    return t('settings.diagnosticsDialog.phaseLogs');
  },
  get collecting_config() {
    return t('settings.diagnosticsDialog.phaseRedact');
  },
  get collecting_flow() {
    return t('settings.diagnosticsDialog.phaseFlow');
  },
  get collecting_env() {
    return t('settings.diagnosticsDialog.phaseEnv');
  },
  get collecting_runtime() {
    return t('settings.diagnosticsDialog.phaseState');
  },
  get collecting_crashes() {
    return t('settings.diagnosticsDialog.phaseCrashes');
  },
  get packaging() {
    return t('settings.diagnosticsDialog.phasePack');
  },
  get done() {
    return t('settings.diagnosticsDialog.phaseDone');
  },
  get error() {
    return t('settings.diagnosticsDialog.phaseError');
  },
};

const PHASE_ORDER = [
  'collecting_logs',
  'collecting_config',
  'collecting_flow',
  'collecting_env',
  'collecting_runtime',
  'collecting_crashes',
  'packaging',
  'done',
];

function getProgressPercent(phase: string): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1) return 0;
  return Math.round((idx / (PHASE_ORDER.length - 1)) * 100);
}

export function DiagnosticsDialog({ open, onClose, projectPath }: DiagnosticsDialogProps) {
  useLocaleSubscription();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [result, setResult] = useState<{ outputPath: string; fileSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    if (!projectPath || running) return;
    setRunning(true);
    setProgress(null);
    setResult(null);
    setError(null);

    // 监听进度
    const cleanup = window.qqbat.diagnostics.onProgress((data) => {
      setProgress(data);
    });

    try {
      const res = await window.qqbat.diagnostics.export(projectPath);
      if (res.ok && res.data) {
        setResult(res.data);
      } else {
        setError(res.error ?? t('editor.metrics.exportFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      cleanup();
    }
  }, [projectPath, running]);

  // 焦点管理、Tab 循环、Esc 关闭由 Modal 组件统一处理

  useEffect(() => {
    if (open && projectPath) {
      handleExport();
    }
    // handleExport 依赖 running，补全后会在导出完成(running→false)时反复触发导出，造成无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const phase = progress?.phase ?? '';
  const progressPercent = getProgressPercent(phase);
  const isDone = phase === 'done';
  const isError = phase === 'error' || error !== null;
  const displayError = error || progress?.error;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.diagnostics')}
      width="384px"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={running}>
            {isDone ? t('editor.action.close') : t('editor.action.cancel')}
          </Button>
          {isError && (
            <Button
              variant="primary"
              size="md"
              onClick={handleExport}
              disabled={running}
              loading={running}
            >
              {t('panel.crash.retry')}
            </Button>
          )}
        </>
      }
    >
      {/* 进度条 */}
      {(running || progress) && !isDone && !isError && (
        <div aria-busy="true" className="mb-4">
          <div className="w-full bg-zinc-700 rounded-full h-2 mb-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-sm text-zinc-300">
            {progress
              ? (PHASE_LABELS[progress.phase] ?? progress.phase)
              : t('settings.diagnosticsDialog.preparing')}
          </p>
          {progress?.message && <p className="text-xs text-zinc-500 mt-1">{progress.message}</p>}
        </div>
      )}

      {/* 完成 */}
      {isDone && result && (
        <div className="mb-4">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <span>✅</span>
            <span>{t('settings.diagnosticsDialog.done')}</span>
          </div>
          <p className="text-sm text-zinc-300 break-all">
            {t('settings.diagnosticsDialog.filePath', { path: result.outputPath })}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {t('settings.diagnosticsDialog.fileSize', {
              size: (result.fileSize / 1024).toFixed(1),
            })}
          </p>
        </div>
      )}

      {/* 错误 */}
      {isError && (
        <div className="mb-4" id="diagnostics-dialog-error" role="alert">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <span>❌</span>
            <span>{t('editor.metrics.exportFailed')}</span>
          </div>
          <p className="text-sm text-zinc-300">{displayError}</p>
        </div>
      )}
    </Modal>
  );
}
