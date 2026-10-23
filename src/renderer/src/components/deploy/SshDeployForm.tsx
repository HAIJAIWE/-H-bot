// src/renderer/src/components/deploy/SshDeployForm.tsx
import { memo } from 'react';
import { inputFormSm, inputBase } from '../ui/inputStyles';
import type { SshDeployResult } from '../../types/ipc';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** SSH 部署表单状态 */
export interface SshFormState {
  host: string;
  port: number;
  username: string;
  authMode: 'password' | 'privateKey';
  password: string;
  privateKey: string;
  passphrase: string;
  remotePath: string;
  imageName: string;
  containerPort: number;
  /**
   * 已固定的主机密钥指纹（TOFU）。留空 = 首次信任目标机并把指纹回报在部署日志里；
   * 填了 = 与目标机不一致就**拒绝连接**（防中间人）。
   */
  hostFingerprint: string;
}

export const DEFAULT_SSH_FORM: SshFormState = {
  host: '',
  port: 22,
  username: 'root',
  authMode: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  remotePath: '/opt/qqbat/bot',
  imageName: 'qqbat-bot',
  containerPort: 8080,
  hostFingerprint: '',
};

interface SshDeployFormProps {
  form: SshFormState;
  setForm: React.Dispatch<React.SetStateAction<SshFormState>>;
  busy: boolean;
  result: SshDeployResult | null;
}

export const SshDeployForm = memo(function SshDeployForm({
  form,
  setForm,
  busy: _busy,
  result,
}: SshDeployFormProps) {
  useLocaleSubscription();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('deploy.host')}>
          <input
            type="text"
            className={`w-full ${inputFormSm}`}
            value={form.host}
            onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            placeholder={t('deploy.hostPlaceholder')}
          />
        </Field>
        <Field label={t('deploy.sshPort')}>
          <input
            type="number"
            className={`w-full ${inputFormSm}`}
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 22 }))}
          />
        </Field>
        <Field label={t('deploy.username')}>
          <input
            type="text"
            className={`w-full ${inputFormSm}`}
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="root"
          />
        </Field>
      </div>

      <Field label={t('deploy.authMode')}>
        <div className="flex gap-3">
          <label className="flex items-center gap-1 text-sm text-zinc-300">
            <input
              type="radio"
              checked={form.authMode === 'password'}
              onChange={() => setForm((f) => ({ ...f, authMode: 'password' }))}
            />
            {t('deploy.password')}
          </label>
          <label className="flex items-center gap-1 text-sm text-zinc-300">
            <input
              type="radio"
              checked={form.authMode === 'privateKey'}
              onChange={() => setForm((f) => ({ ...f, authMode: 'privateKey' }))}
            />
            {t('deploy.authPrivateKey')}
          </label>
        </div>
      </Field>

      {form.authMode === 'password' ? (
        <Field label={t('deploy.password')}>
          <input
            type="password"
            className={`w-full ${inputFormSm}`}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder={t('deploy.passwordPlaceholder')}
          />
        </Field>
      ) : (
        <>
          <Field label={t('deploy.privateKey')}>
            <textarea
              className={`w-full ${inputBase} font-mono`}
              rows={4}
              value={form.privateKey}
              onChange={(e) => setForm((f) => ({ ...f, privateKey: e.target.value }))}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
            />
          </Field>
          <Field label={t('deploy.passphrase')}>
            <input
              type="password"
              className={`w-full ${inputFormSm}`}
              value={form.passphrase}
              onChange={(e) => setForm((f) => ({ ...f, passphrase: e.target.value }))}
            />
          </Field>
        </>
      )}

      <Field label={t('deploy.remotePath')}>
        <input
          type="text"
          className={`w-full ${inputFormSm} font-mono`}
          value={form.remotePath}
          onChange={(e) => setForm((f) => ({ ...f, remotePath: e.target.value }))}
          placeholder="/opt/qqbat/bot"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('deploy.imageName')}>
          <input
            type="text"
            className={`w-full ${inputFormSm}`}
            value={form.imageName}
            onChange={(e) => setForm((f) => ({ ...f, imageName: e.target.value }))}
            placeholder="qqbat-bot"
          />
        </Field>
        <Field label={t('deploy.containerPort')}>
          <input
            type="number"
            className={`w-full ${inputFormSm}`}
            value={form.containerPort}
            onChange={(e) =>
              setForm((f) => ({ ...f, containerPort: Number(e.target.value) || 8080 }))
            }
          />
        </Field>
      </div>

      {/*
        主机密钥指纹。留空时我们会把目标机的指纹回报在部署日志里 —— 用户复制过来固定，
        之后指纹一变就拒绝连接（防中间人）。所以提示里要写清"这串从哪来"。
      */}
      <Field label={t('deploy.hostFingerprint')}>
        <input
          type="text"
          className={`w-full ${inputFormSm} font-mono`}
          value={form.hostFingerprint}
          onChange={(e) => setForm((f) => ({ ...f, hostFingerprint: e.target.value }))}
          placeholder="SHA256:..."
        />
        <p className="mt-1 text-xs text-zinc-500">{t('deploy.hostFingerprintHint')}</p>
      </Field>

      {result && (
        <div
          className={`border rounded p-3 space-y-1 ${result.success ? 'border-green-700 bg-green-900/20' : 'border-red-700 bg-red-900/20'}`}
        >
          <div
            className={`text-sm font-medium ${result.success ? 'text-green-300' : 'text-red-300'}`}
          >
            {result.success ? t('deploy.deploySuccess') : t('deploy.err.deployFailed')}
          </div>
          <div className="text-xs text-zinc-300">{result.message}</div>
          {result.remoteId && (
            <div className="text-xs text-zinc-400">
              {t('deploy.remoteId', { id: result.remoteId })}
            </div>
          )}
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
