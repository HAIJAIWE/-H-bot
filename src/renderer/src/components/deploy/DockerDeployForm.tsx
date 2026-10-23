// src/renderer/src/components/deploy/DockerDeployForm.tsx
import { memo } from 'react';
import { Button } from '../ui/Button';
import { inputFormSm } from '../ui/inputStyles';
import type { DockerExportResult } from '../../types/ipc';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 适配器类型 */
export type Adapter = 'official';

/** Docker 导出表单状态 */
export interface DockerFormState {
  adapter: Adapter;
  outputDir: string;
  imageName: string;
  port: number;
}

export const DEFAULT_DOCKER_FORM: DockerFormState = {
  adapter: 'official',
  outputDir: '',
  imageName: 'qqbat-bot',
  port: 8080,
};

interface DockerDeployFormProps {
  form: DockerFormState;
  setForm: React.Dispatch<React.SetStateAction<DockerFormState>>;
  busy: boolean;
  result: DockerExportResult | null;
  onPickOutputDir: () => void;
  onOpenFolder: () => void;
  onCopy: (text: string) => void;
}

export const DockerDeployForm = memo(function DockerDeployForm({
  form,
  setForm,
  busy,
  result,
  onPickOutputDir,
  onOpenFolder,
  onCopy,
}: DockerDeployFormProps) {
  useLocaleSubscription();
  return (
    <div className="space-y-3">
      <Field label={t('deploy.containerPort')}>
        <input
          type="number"
          className={`w-full ${inputFormSm}`}
          value={form.port}
          onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 8080 }))}
        />
      </Field>

      <Field label={t('deploy.imageName')}>
        <input
          type="text"
          className={`w-full ${inputFormSm}`}
          value={form.imageName}
          onChange={(e) => setForm((f) => ({ ...f, imageName: e.target.value }))}
          placeholder="qqbat-bot"
        />
      </Field>

      <Field label={t('deploy.outputDir')}>
        <div className="flex gap-2">
          <input
            type="text"
            className={`flex-1 ${inputFormSm}`}
            value={form.outputDir}
            onChange={(e) => setForm((f) => ({ ...f, outputDir: e.target.value }))}
            placeholder={t('deploy.outputDirPlaceholder')}
          />
          <Button
            variant="secondary"
            size="sm"
            className="whitespace-nowrap"
            onClick={onPickOutputDir}
            disabled={busy}
          >
            {t('deploy.browse')}
          </Button>
        </div>
      </Field>

      {/* 导出结果 */}
      {result && (
        <div className="border border-green-700 bg-green-900/20 rounded p-3 space-y-2">
          <div className="text-sm text-green-300 font-medium">{t('deploy.exportSuccess')}</div>
          <div className="text-xs text-zinc-400">
            {t('deploy.generatedFiles', { count: result.files.length })}
          </div>
          <div className="flex flex-wrap gap-1">
            {result.files.map((f) => (
              <span key={f} className="px-2 py-0.5 text-xs bg-zinc-800 rounded text-zinc-300">
                {f}
              </span>
            ))}
          </div>
          <div className="text-xs text-zinc-400 mt-2">{t('deploy.buildCmd')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-zinc-900 px-2 py-1 rounded text-zinc-300 overflow-x-auto">
              {result.buildCommand}
            </code>
            <Button variant="secondary" size="sm" onClick={() => onCopy(result.buildCommand)}>
              {t('editor.terminal.copy')}
            </Button>
          </div>
          <div className="text-xs text-zinc-400 mt-2">{t('deploy.runCmd')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-zinc-900 px-2 py-1 rounded text-zinc-300 overflow-x-auto">
              {result.runCommand}
            </code>
            <Button variant="secondary" size="sm" onClick={() => onCopy(result.runCommand)}>
              {t('editor.terminal.copy')}
            </Button>
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" size="sm" onClick={onOpenFolder}>
              {t('deploy.openOutputDir')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

/** 表单字段包装器 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-400">{label}</label>
      {children}
    </div>
  );
}
