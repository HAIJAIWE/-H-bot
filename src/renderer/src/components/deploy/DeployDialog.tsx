// src/renderer/src/components/deploy/DeployDialog.tsx
// 部署对话框：支持两种模式
//   1. Docker 导出 — 本地生成 Dockerfile + docker-compose.yml + 启动脚本等，用户手动 docker build
//   2. SSH 部署   — 通过 SSH/SFTP 上传到远程服务器并自动构建/启动容器
//
// 设计原则：
// - 组合式组件，子组件各自管理表单 UI，DeployDialog 管理状态与部署逻辑
// - 不引入新的状态管理库；用 useState 管理表单与日志
// - 实时日志通过订阅 docker:progress / ssh:log 事件实现
// - Docker 模式默认折叠 SSH 表单，反之亦然，降低视觉负担

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Tabs } from '../ui/Tabs';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DockerDeployForm, DEFAULT_DOCKER_FORM, type DockerFormState } from './DockerDeployForm';
import { SshDeployForm, DEFAULT_SSH_FORM, type SshFormState } from './SshDeployForm';
import { DeployProgress, type LogLine } from './DeployProgress';
import type { DockerExportResult, SshDeployResult } from '../../types/ipc';
import { t, getLocale } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 部署模式 */
type DeployMode = 'docker' | 'ssh';

interface Props {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 项目路径（包含 .qqbat/flow.json 的项目根目录） */
  projectPath: string;
  /** 项目名称（用于显示） */
  projectName: string;
}

export function DeployDialog({ open, onClose, projectPath, projectName }: Props) {
  useLocaleSubscription();
  const [mode, setMode] = useState<DeployMode>('docker');

  // Docker 表单
  const [dockerForm, setDockerForm] = useState<DockerFormState>(DEFAULT_DOCKER_FORM);
  // SSH 表单
  const [sshForm, setSshForm] = useState<SshFormState>(DEFAULT_SSH_FORM);

  // 运行状态
  const [busy, setBusy] = useState(false);
  // SSH 部署确认弹窗
  const [showSshConfirm, setShowSshConfirm] = useState(false);
  // 日志（两种模式共用）
  const [logs, setLogs] = useState<LogLine[]>([]);
  // Docker 导出结果
  const [dockerResult, setDockerResult] = useState<DockerExportResult | null>(null);
  // SSH 部署结果
  const [sshResult, setSshResult] = useState<SshDeployResult | null>(null);
  // 错误信息
  const [error, setError] = useState('');

  const logEndRef = useRef<HTMLDivElement>(null);
  // 日志唯一 id 计数器（用于稳定 React key）
  const logIdRef = useRef(0);

  /** 添加一条日志 */
  const addLog = useCallback((text: string, level: LogLine['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logIdRef.current += 1;
    setLogs((prev) => [...prev, { id: logIdRef.current, time, text, level }]);
  }, []);

  /** 自动滚动到底部 */
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollTop = logEndRef.current.scrollHeight;
    }
  }, [logs]);

  // 重置状态（每次打开时）
  useEffect(() => {
    if (open) {
      setLogs([]);
      setError('');
      setDockerResult(null);
      setSshResult(null);
      setBusy(false);
      // 默认输出目录：在项目同级目录下创建 deploy 子目录
      if (projectPath) {
        const parent = projectPath.replace(/[\\/][^\\/]+$/, '');
        setDockerForm((f) => ({ ...f, outputDir: `${parent}/deploy/${projectName || 'bot'}` }));
        setSshForm((f) => ({ ...f, remotePath: `/opt/qqbat/${projectName || 'bot'}` }));
      }
    }
  }, [open, projectPath, projectName]);

  // 订阅 docker:progress
  useEffect(() => {
    if (!open || mode !== 'docker') return;
    const unsubscribe = window.qqbat.docker.onProgress((data) => {
      addLog(`[${data.phase}] ${data.message}`);
    });
    return unsubscribe;
  }, [open, mode, addLog]);

  // 订阅 ssh:log
  useEffect(() => {
    if (!open || mode !== 'ssh') return;
    const unsubscribe = window.qqbat.ssh.onLog((data) => {
      const text = data.line;
      const level: LogLine['level'] = text.includes('[ERROR]')
        ? 'error'
        : text.includes('[cleanup]')
          ? 'info'
          : 'info';
      addLog(text, level);
    });
    return unsubscribe;
  }, [open, mode, addLog]);

  /** 选择输出目录 */
  const handlePickOutputDir = async () => {
    try {
      const result = await window.qqbat.project.pickDirectory();
      if (result.ok && result.data) {
        setDockerForm((f) => ({ ...f, outputDir: result.data as string }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 执行 Docker 导出 */
  const handleDockerExport = async () => {
    if (!dockerForm.outputDir.trim()) {
      setError(t('deploy.err.outputDir'));
      return;
    }
    setBusy(true);
    setError('');
    setLogs([]);
    setDockerResult(null);
    addLog(t('deploy.log.exportStart', { path: dockerForm.outputDir }));

    try {
      const result = await window.qqbat.docker.export({
        projectPath,
        adapter: dockerForm.adapter,
        outputDir: dockerForm.outputDir,
        imageName: dockerForm.imageName || undefined,
        port: dockerForm.port || undefined,
      });
      if (!result.ok) {
        setError(result.error || t('editor.metrics.exportFailed'));
        addLog(t('editor.code.exportFailed', { error: result.error ?? '' }), 'error');
        return;
      }
      setDockerResult(result.data as DockerExportResult);
      addLog(
        t('deploy.log.exportDone', {
          count: (result.data as DockerExportResult).files.length,
        }),
        'success',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(t('deploy.log.exception', { error: msg }), 'error');
    } finally {
      setBusy(false);
    }
  };

  /** 测试 SSH 连接 */
  const handleTestSshConnection = async () => {
    if (!sshForm.host.trim()) {
      setError(t('deploy.err.host'));
      return;
    }
    setBusy(true);
    setError('');
    addLog(
      t('deploy.log.testSsh', {
        target: `${sshForm.username}@${sshForm.host}:${sshForm.port}`,
      }),
    );

    try {
      const result = await window.qqbat.ssh.testConnection({
        host: sshForm.host,
        port: sshForm.port,
        username: sshForm.username,
        password: sshForm.authMode === 'password' ? sshForm.password : undefined,
        privateKey: sshForm.authMode === 'privateKey' ? sshForm.privateKey : undefined,
        passphrase: sshForm.passphrase || undefined,
        hostFingerprint: sshForm.hostFingerprint.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error || t('settings.aiProvider.connectFailed'));
        addLog(t('deploy.log.connectFailed', { error: result.error ?? '' }), 'error');
        return;
      }
      const data = result.data as { connected: boolean; latency: number; fingerprint?: string };
      addLog(t('deploy.log.connectOk', { ms: data.latency }), 'success');
      // 首次连接（还没固定指纹）时把目标机指纹摆出来 —— 用户正是靠它来启用校验。
      // 不显示的话，"主机指纹"这一栏对用户来说就是个没有任何来源的空盒子。
      if (!sshForm.hostFingerprint.trim() && data.fingerprint) {
        addLog(t('deploy.log.fingerprint', { fingerprint: data.fingerprint }), 'info');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(t('deploy.log.exception', { error: msg }), 'error');
    } finally {
      setBusy(false);
    }
  };

  /** 执行 SSH 部署 */
  const handleSshDeploy = async () => {
    if (!sshForm.host.trim()) {
      setError(t('deploy.err.host'));
      return;
    }
    if (sshForm.authMode === 'password' && !sshForm.password) {
      setError(t('deploy.err.password'));
      return;
    }
    if (sshForm.authMode === 'privateKey' && !sshForm.privateKey) {
      setError(t('deploy.err.privateKey'));
      return;
    }
    if (!sshForm.remotePath.trim()) {
      setError(t('deploy.err.remotePath'));
      return;
    }

    setShowSshConfirm(true);
  };

  /** 实际执行 SSH 部署（确认后调用） */
  const doSshDeploy = async () => {
    setShowSshConfirm(false);
    setBusy(true);
    setError('');
    setLogs([]);
    setSshResult(null);
    addLog(t('deploy.log.deployStart', { target: `${sshForm.host}:${sshForm.remotePath}` }));

    try {
      const result = await window.qqbat.ssh.deploy({
        projectPath,
        host: sshForm.host,
        port: sshForm.port,
        username: sshForm.username,
        password: sshForm.authMode === 'password' ? sshForm.password : undefined,
        privateKey: sshForm.authMode === 'privateKey' ? sshForm.privateKey : undefined,
        passphrase: sshForm.passphrase || undefined,
        hostFingerprint: sshForm.hostFingerprint.trim() || undefined,
        remotePath: sshForm.remotePath,
        adapter: 'official',
        imageName: sshForm.imageName || undefined,
        containerPort: sshForm.containerPort || undefined,
      });
      // 即使失败也尝试获取日志
      const data = result.data as SshDeployResult | { logs: string[] } | undefined;
      if (data && Array.isArray((data as SshDeployResult).logs)) {
        // 用 setLogs 函数式更新 + prev 比对避免闭包陷阱
        const newLines = (data as SshDeployResult).logs;
        setLogs((prev) => {
          const existing = new Set(prev.map((l) => l.text));
          const toAdd = newLines.filter((line) => !existing.has(line));
          if (toAdd.length === 0) return prev;
          const time = new Date().toLocaleTimeString(getLocale(), { hour12: false });
          return [
            ...prev,
            ...toAdd.map((line) => {
              logIdRef.current += 1;
              return { id: logIdRef.current, time, text: line, level: 'info' as const };
            }),
          ];
        });
      }
      if (!result.ok) {
        setError(result.error || t('deploy.err.deployFailed'));
        addLog(t('deploy.log.deployFailed', { error: result.error ?? '' }), 'error');
        return;
      }
      const deployResult = result.data as SshDeployResult;
      setSshResult(deployResult);
      addLog(deployResult.message, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(t('deploy.log.exception', { error: msg }), 'error');
    } finally {
      setBusy(false);
    }
  };

  /** 打开导出目录 */
  const handleOpenFolder = async () => {
    if (dockerResult?.outputDir) {
      await window.qqbat.docker.openFolder(dockerResult.outputDir);
    }
  };

  /** 复制文本到剪贴板 */
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      addLog(t('deploy.copied'));
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('deploy.title', { name: projectName })}
      width="720px"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t('editor.action.close')}
          </Button>
          {mode === 'docker' && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleDockerExport}
              disabled={busy || !dockerForm.outputDir.trim()}
              title={!dockerForm.outputDir.trim() ? t('deploy.err.outputDir') : undefined}
            >
              {busy ? t('deploy.exporting') : t('deploy.exportDocker')}
            </Button>
          )}
          {mode === 'ssh' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTestSshConnection}
                disabled={busy || !sshForm.host.trim()}
                title={!sshForm.host.trim() ? t('deploy.err.host') : undefined}
              >
                {t('settings.aiProvider.test')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSshDeploy}
                disabled={busy || !sshForm.host.trim() || !sshForm.remotePath.trim()}
                title={
                  !sshForm.host.trim()
                    ? t('deploy.err.host')
                    : !sshForm.remotePath.trim()
                      ? t('deploy.err.remotePathShort')
                      : undefined
                }
              >
                {busy ? t('deploy.deploying') : t('deploy.startDeploy')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* 模式切换 */}
        <Tabs
          tabs={[
            { key: 'docker', label: t('deploy.dockerTab') },
            { key: 'ssh', label: t('deploy.sshTab') },
          ]}
          active={mode}
          onChange={(k) => setMode(k as DeployMode)}
        />

        {/* Docker 模式表单 */}
        {mode === 'docker' && (
          <DockerDeployForm
            form={dockerForm}
            setForm={setDockerForm}
            busy={busy}
            result={dockerResult}
            onPickOutputDir={handlePickOutputDir}
            onOpenFolder={handleOpenFolder}
            onCopy={handleCopy}
          />
        )}

        {/* SSH 模式表单 */}
        {mode === 'ssh' && (
          <SshDeployForm form={sshForm} setForm={setSshForm} busy={busy} result={sshResult} />
        )}

        {/* 错误提示 + 日志区 */}
        <DeployProgress
          logs={logs}
          onClear={() => setLogs([])}
          logEndRef={logEndRef}
          error={error}
        />

        {/* 帮助说明 */}
        <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-2">
          {mode === 'docker' ? (
            <div>
              {t('deploy.dockerHelpPrefix')} <code className="text-zinc-400">docker build</code>{' '}
              {t('deploy.dockerHelpSuffix')}
            </div>
          ) : (
            <div>
              {t('deploy.sshHelpPrefix')}
              <strong className="text-zinc-400">{t('deploy.sshDependency')}</strong>
              {t('deploy.sshHelpMid')} <code className="text-zinc-400">npm install ssh2</code>
              {t('deploy.sshHelpEnd')}
            </div>
          )}
        </div>
      </div>

      {/* SSH 部署确认弹窗 */}
      <ConfirmDialog
        open={showSshConfirm}
        onClose={() => setShowSshConfirm(false)}
        onConfirm={() => void doSshDeploy()}
        title={t('deploy.confirmDeploy')}
        message={t('deploy.confirmMessage', {
          target: `${sshForm.username}@${sshForm.host}:${sshForm.port}${sshForm.remotePath}`,
        })}
        confirmText={t('deploy.confirmDeploy')}
        variant="danger"
      />
    </Modal>
  );
}
