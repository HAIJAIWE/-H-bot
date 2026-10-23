// src/renderer/src/components/deploy/DeployProgress.tsx
import { memo } from 'react';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 日志行 */
export interface LogLine {
  id: number;
  time: string;
  text: string;
  level: 'info' | 'error' | 'success';
}

interface DeployProgressProps {
  logs: LogLine[];
  onClear: () => void;
  logEndRef: React.RefObject<HTMLDivElement | null>;
  error: string;
}

export const DeployProgress = memo(function DeployProgress({
  logs,
  onClear,
  logEndRef,
  error,
}: DeployProgressProps) {
  useLocaleSubscription();
  return (
    <>
      {/* 错误提示 */}
      {error && (
        <div className="border border-red-700 bg-red-900/20 rounded p-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* 日志区 */}
      {logs.length > 0 && (
        <div className="border border-zinc-700 rounded">
          <div className="px-3 py-1.5 text-xs text-zinc-400 border-b border-zinc-700 flex items-center justify-between">
            <span>{t('editor.log.title')}</span>
            <Button variant="ghost" size="sm" onClick={onClear}>
              {t('editor.action.clear')}
            </Button>
          </div>
          <div
            ref={logEndRef}
            className="h-48 overflow-y-auto p-2 font-mono text-xs space-y-0.5 bg-zinc-950"
          >
            {logs.map((line) => (
              <div
                key={line.id}
                className={
                  line.level === 'error'
                    ? 'text-red-400'
                    : line.level === 'success'
                      ? 'text-green-400'
                      : 'text-zinc-300'
                }
              >
                <span className="text-zinc-600 mr-2">{line.time}</span>
                <span className="break-all whitespace-pre-wrap">{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
