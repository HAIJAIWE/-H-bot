import { useEffect, useState } from 'react';
import type { ProjectConfig } from '@shared/types/project';
import { Modal } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { inputForm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface Props {
  open: boolean;
  projectPath: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function AdapterConfigDialog({ open, projectPath, onClose, onSaved }: Props) {
  useLocaleSubscription();
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  /**
   * 当前选中的平台。
   *
   * ⚠️ 以前这里是**写死 QQ 官方**的（连保存时都硬编码 `adapter: 'official'`），
   * 于是「换平台」根本做不到 —— 手改 project.json 也会被下一次保存覆盖回去。
   */
  const [platform, setPlatform] = useState<'official' | 'lark' | 'dingtalk'>('official');

  // QQ 官方 API
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [wsUrl, setWsUrl] = useState('');

  // 飞书
  const [larkAppId, setLarkAppId] = useState('');
  const [larkAppSecret, setLarkAppSecret] = useState('');
  const [larkEventMode, setLarkEventMode] = useState<'long-connection' | 'webhook'>(
    'long-connection',
  );

  // 钉钉（官方叫 AppKey / AppSecret，代码里是 clientId / clientSecret）
  const [dingClientId, setDingClientId] = useState('');
  const [dingClientSecret, setDingClientSecret] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle');

  const [officialStatus, setOfficialStatus] = useState<string>('disconnected');
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !projectPath) return;
    // mounted 守卫：open 或 projectPath 变化后旧异步回调直接丢弃，避免旧响应覆盖新会话状态
    let cancelled = false;
    setLoading(true);
    setError('');
    setSuccess(false);
    setTestResult('idle');
    setEvents([]);
    window.qqbat.project
      .getConfig(projectPath)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          const c = res.data;
          setConfig(c);
          // 已保存的平台判据：adapter 字段（与 platforms.ts 的单一来源一致）
          setPlatform(
            c.adapter === 'lark' ? 'lark' : c.adapter === 'dingtalk' ? 'dingtalk' : 'official',
          );
          setAppId(c.official?.appId || '');
          setAppSecret(c.official?.appSecret || '');
          setSandbox(c.official?.sandbox ?? true);
          setWsUrl(c.official?.wsUrl || '');
          // 飞书段（主进程读的是整份 project.json，所以这里一定能拿到）
          const lark = (c as { lark?: { appId?: string; appSecret?: string; eventMode?: string } })
            .lark;
          setLarkAppId(lark?.appId || '');
          setLarkAppSecret(lark?.appSecret || '');
          setLarkEventMode(lark?.eventMode === 'webhook' ? 'webhook' : 'long-connection');
          // 钉钉段（同上：Zod schema 里已声明，不会被剥掉）
          const ding = (c as { dingtalk?: { clientId?: string; clientSecret?: string } }).dingtalk;
          setDingClientId(ding?.clientId || '');
          setDingClientSecret(ding?.clientSecret || '');
        } else {
          setError(res.error || t('launch.adapter.readConfigFailed'));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    window.qqbat.official
      .status(projectPath)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setOfficialStatus(res.data.status);
      })
      .catch(() => {
        // 状态查询失败保持上次状态，由轮询兜底
      });
    const unsubStatus = window.qqbat.official.onStatusChange((data) => {
      if (data.projectPath === projectPath) setOfficialStatus(data.status);
    });
    const unsubMsg = window.qqbat.official.onMessage((data) => {
      if (data.projectPath === projectPath) {
        // JSON.stringify(undefined) 返回 undefined（非字符串），.slice() 会抛 TypeError
        const msgType = data.message?.type ?? 'unknown';
        const msgData = data.message?.data;
        const dataStr = msgData === undefined ? '(no data)' : JSON.stringify(msgData).slice(0, 120);
        setEvents((prev) => [`${msgType}: ${dataStr}`, ...prev].slice(0, 20));
      }
    });
    // 轮询兜底，确保状态灯同步
    const pollTimer = setInterval(() => {
      window.qqbat.official
        .status(projectPath)
        .then((res) => {
          if (cancelled) return;
          if (res.ok && res.data) setOfficialStatus(res.data.status);
        })
        .catch(() => {
          // 轮询失败忽略，等下一周期
        });
    }, 3000);
    return () => {
      cancelled = true;
      unsubStatus?.();
      unsubMsg?.();
      clearInterval(pollTimer);
    };
  }, [open, projectPath]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      // 基于原 config 展开，仅覆盖本次编辑的字段，避免丢失 ai/portBlock 等
      //
      // 平台段只写**当前选中**的那个：另一个平台已保存的值来自展开的 `...config`，
      // 不会被清空（用户切回 QQ 时凭据还在）。
      const payload: Record<string, unknown> = {
        ...config,
        adapter: platform,
        updatedAt: new Date().toISOString(),
      };
      if (platform === 'official') {
        payload.official = { appId, appSecret, sandbox, wsUrl };
      } else if (platform === 'lark') {
        payload.lark = { appId: larkAppId, appSecret: larkAppSecret, eventMode: larkEventMode };
      } else {
        payload.dingtalk = { clientId: dingClientId, clientSecret: dingClientSecret };
      }
      const res = await window.qqbat.project.saveConfig(payload, projectPath);
      if (res.ok) {
        setSuccess(true);
        onSaved?.();
        setTimeout(() => onClose(), 800);
      } else {
        setError(res.error || t('launch.common.saveFailed'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('launch.adapter.titleWithName', { name: config?.name ?? '...' })}
      width="520px"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('launch.common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={saving || !config}
            loading={saving}
          >
            {t('launch.common.save')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-500">{t('launch.common.loading')}</div>
      ) : !config ? (
        <div className="py-8 text-center text-sm text-red-400">
          {error || t('launch.adapter.configLoadFailed')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* 协议端：**可选**的平台选择器 */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {t('launch.adapter.protocol')}
            </label>
            <div className="flex gap-2">
              {[
                {
                  id: 'official' as const,
                  name: t('launch.adapter.officialApi'),
                  hint: t('launch.adapter.compliant'),
                },
                {
                  id: 'lark' as const,
                  name: t('launch.adapter.platformLark'),
                  hint: t('launch.adapter.platformLarkHint'),
                },
                {
                  id: 'dingtalk' as const,
                  name: t('launch.adapter.platformDingtalk'),
                  hint: t('launch.adapter.platformDingtalkHint'),
                },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  aria-pressed={platform === p.id}
                  className={`flex-1 border rounded flex flex-col items-start px-3 py-2 text-left transition-colors ${
                    platform === p.id
                      ? 'bg-blue-900/30 border-blue-500 text-blue-300'
                      : 'bg-zinc-800/40 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs opacity-70 mt-0.5">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* QQ 官方 API 配置（仅选中 QQ 时显示） */}
          {platform === 'official' && (
            <div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">AppID</label>
                <input
                  className={`w-full ${inputForm}`}
                  value={appId}
                  aria-label={t('launch.adapter.appIdAria')}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder={t('launch.adapter.appIdPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">AppSecret</label>
                <input
                  type="password"
                  className={`w-full ${inputForm}`}
                  value={appSecret}
                  aria-label={t('launch.adapter.appSecretAria')}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder={t('launch.adapter.appIdPlaceholder')}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={sandbox}
                  onChange={setSandbox}
                  label={t('launch.adapter.sandbox')}
                />
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{
                      backgroundColor:
                        officialStatus === 'connected'
                          ? '#22c55e'
                          : officialStatus === 'connecting'
                            ? '#eab308'
                            : '#6b7280',
                    }}
                  />
                  <span className="text-xs text-zinc-400">
                    {officialStatus === 'connected'
                      ? t('launch.adapter.wsConnected')
                      : officialStatus === 'connecting'
                        ? t('launch.adapter.statusConnecting')
                        : officialStatus === 'error'
                          ? t('launch.adapter.statusError')
                          : t('launch.adapter.statusDisconnected')}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {t('launch.adapter.wsUrlLabel')}
                </label>
                <input
                  className={`w-full ${inputForm}`}
                  value={wsUrl}
                  aria-label={t('launch.adapter.wsUrl')}
                  onChange={(e) => setWsUrl(e.target.value)}
                  placeholder={t('launch.adapter.wsUrlPlaceholder')}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={async () => {
                    setTesting(true);
                    setTestResult('idle');
                    try {
                      const res = await window.qqbat.official.testConnection(appId, appSecret);
                      setTestResult(res?.ok && res?.data?.connected ? 'ok' : 'fail');
                    } catch {
                      setTestResult('fail');
                    } finally {
                      setTesting(false);
                    }
                  }}
                  disabled={testing || !appId || !appSecret}
                  loading={testing}
                >
                  {t('launch.adapter.verifyCredentials')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={async () => {
                    if (!appId || !appSecret) return;
                    setTesting(true);
                    setError('');
                    try {
                      const res = await window.qqbat.official.saveConfig(
                        projectPath,
                        appId,
                        appSecret,
                        sandbox,
                      );
                      if (!res.ok) {
                        setError(res.error || t('launch.common.saveFailed'));
                        return;
                      }
                      const startRes = await window.qqbat.official.start(projectPath);
                      if (
                        !startRes.ok &&
                        !startRes.error?.includes(t('launch.adapter.alreadyRunning'))
                      ) {
                        setError(startRes.error || t('launch.adapter.startFailed'));
                      }
                      // 连接稳定后发 Hello World
                      setTimeout(async () => {
                        setTestResult('idle');
                        setTesting(false);
                      }, 2000);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('launch.adapter.testError'));
                      setTesting(false);
                    }
                  }}
                  disabled={testing || !appId || !appSecret}
                  loading={testing}
                >
                  {t('launch.adapter.startConnection')}
                </Button>
              </div>
              {testResult !== 'idle' && (
                <div
                  className={`text-xs px-3 py-2 rounded ${testResult === 'ok' ? 'text-green-400 bg-green-900/20' : 'text-red-400 bg-red-900/20'}`}
                >
                  {testResult === 'ok'
                    ? t('launch.adapter.credentialsValid')
                    : t('launch.adapter.credentialsInvalid')}
                </div>
              )}
              {events.length > 0 && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t('launch.adapter.liveEvents')}
                  </label>
                  <div className="bg-zinc-800/40 rounded max-h-[160px] overflow-y-auto p-2 space-y-1">
                    {events.map((e, i) => (
                      <div
                        key={i}
                        className="text-xs text-green-300 font-mono leading-tight break-all"
                      >
                        {e}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 飞书配置（仅选中飞书时显示） */}
          {platform === 'lark' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {t('launch.adapter.larkAppIdAria')}
                </label>
                <input
                  className={`w-full ${inputForm}`}
                  value={larkAppId}
                  aria-label={t('launch.adapter.larkAppIdAria')}
                  onChange={(e) => setLarkAppId(e.target.value)}
                  placeholder={t('launch.adapter.larkAppIdPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {t('launch.adapter.larkAppSecretAria')}
                </label>
                <input
                  type="password"
                  className={`w-full ${inputForm}`}
                  value={larkAppSecret}
                  aria-label={t('launch.adapter.larkAppSecretAria')}
                  onChange={(e) => setLarkAppSecret(e.target.value)}
                  placeholder={t('launch.adapter.larkAppSecretPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {t('launch.adapter.eventMode')}
                </label>
                <select
                  className={`w-full ${inputForm}`}
                  value={larkEventMode}
                  aria-label={t('launch.adapter.eventMode')}
                  onChange={(e) =>
                    setLarkEventMode(e.target.value === 'webhook' ? 'webhook' : 'long-connection')
                  }
                >
                  <option value="long-connection">{t('launch.adapter.eventModeLong')}</option>
                  <option value="webhook">{t('launch.adapter.eventModeWebhook')}</option>
                </select>
              </div>
              <div className="text-xs text-zinc-400 bg-zinc-800/40 px-3 py-2 rounded leading-relaxed">
                {t('launch.adapter.larkHint')}
              </div>
              <div className="text-xs text-amber-300/80 bg-amber-900/20 px-3 py-2 rounded">
                {t('launch.adapter.larkNotSupportedYet')}
              </div>
            </div>
          )}

          {/* 钉钉配置（仅选中钉钉时显示） */}
          {platform === 'dingtalk' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {t('launch.adapter.dingAppKeyAria')}
                </label>
                <input
                  className={`w-full ${inputForm}`}
                  value={dingClientId}
                  aria-label={t('launch.adapter.dingAppKeyAria')}
                  onChange={(e) => setDingClientId(e.target.value)}
                  placeholder={t('launch.adapter.dingAppKeyPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {t('launch.adapter.dingAppSecretAria')}
                </label>
                <input
                  type="password"
                  className={`w-full ${inputForm}`}
                  value={dingClientSecret}
                  aria-label={t('launch.adapter.dingAppSecretAria')}
                  onChange={(e) => setDingClientSecret(e.target.value)}
                  placeholder={t('launch.adapter.dingAppSecretPlaceholder')}
                />
              </div>
              <div className="text-xs text-zinc-400 bg-zinc-800/40 px-3 py-2 rounded leading-relaxed">
                {t('launch.adapter.dingHint')}
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded">{error}</div>
          )}
          {success && (
            <div className="text-xs text-green-400 bg-green-900/20 px-3 py-2 rounded">
              {t('launch.common.saveSuccess')}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
