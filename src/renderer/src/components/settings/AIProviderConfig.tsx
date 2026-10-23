// src/renderer/src/components/settings/AIProviderConfig.tsx
import { useState, useEffect, useRef } from 'react';
import { Dropdown } from '../ui/Dropdown';
import { Modal, ModalFooter } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { inputForm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { findLlmPreset } from '@shared/types/llm-presets';
import type { AiProvider } from '@shared/types/ai';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { useProjectStore } from '../../stores/projectStore';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
}

interface ProviderForm {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/**
 * provider 元信息 —— **从 `llm-presets` 派生**，不再在本文件维护第二份。
 *
 * 本文件原来有一份自己的 `PROVIDER_META`（默认地址/模型/占位符），而智能体面板
 * 走的是 `llm-presets` —— 两份清单会各自演化、必然漂移。现在只有一份真相。
 *
 * 保留这个薄封装是因为本文件的消费方式（`meta.defaultBaseUrl` / `meta.keyPlaceholder`）
 * 与预设表的字段名不同；薄封装比全文件改名改动面小。
 */
function providerMeta(id: string) {
  const p = findLlmPreset(id);
  if (!p) return undefined;
  return {
    label: p.label,
    models: p.models as readonly string[],
    defaultModel: p.defaultModel,
    defaultBaseUrl: p.baseUrl,
    needsKey: p.needsKey,
    keyPlaceholder: p.needsKey
      ? t('settings.aiProvider.keyPlaceholder')
      : t('settings.aiProvider.localNoKey'),
    docsUrl: p.docsUrl,
  };
}

export function AIProviderConfig({ onClose, onSaved }: Props) {
  useLocaleSubscription();
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  /**
   * 工具结果上限（**应用级**设置，与 provider 表单各存各的）。
   *
   * 初值故意给默认值而不是 `null`：面板一打开就该显示"当前是什么"，
   * 而 `useEffect` 里的读盘会在下一帧覆盖它 —— 若中途渲染 `null`，
   * 开关会闪一下"关"，用户以为设置丢了。
   */
  const [budget, setBudget] = useState({ enabled: true, thresholdChars: 8192 });
  const [budgetError, setBudgetError] = useState('');
  const [form, setForm] = useState<ProviderForm>({
    provider: 'glm',
    apiKey: '',
    model: 'glm-4',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // 自定义模型名独立 state：避免与 '__custom__' 哨兵值冲突导致输入框卸载
  const [customModel, setCustomModel] = useState('');
  /** 正在回显已保存配置：给下面那个"换 provider 就重置默认值"的 effect 打标记 */
  const hydratingRef = useRef(false);

  // 加载可用 Provider 列表 + **回显已保存的配置**
  //
  // 这里以前只读回 provider 名字，model/baseUrl/apiKey 全是默认值：冷启动看到的是假的，
  // 用户一点保存就把磁盘上那份好配置覆盖成默认值（真机上表现为"密钥老是丢"）。
  useEffect(() => {
    const projectPath = useProjectStore.getState().currentProject?.path ?? '';
    window.qqbat.aiProvider.list().then((res) => {
      const data = res.data;
      if (res.ok && data) {
        setAvailableProviders(data.providers);
        const currentProvider = data.current;
        if (currentProvider) {
          setForm((prev) => ({ ...prev, provider: currentProvider }));
        }
      }
    });
    if (!projectPath) return;
    void window.qqbat.ai.getConfig(projectPath).then((res) => {
      const saved = res.data;
      if (!res.ok || !saved) return;
      hydratingRef.current = true;
      setForm((prev) => ({
        ...prev,
        provider: (saved.provider as ProviderForm['provider']) ?? prev.provider,
        apiKey: saved.apiKey ?? prev.apiKey,
        model: saved.model ?? prev.model,
        baseUrl: saved.baseUrl ?? prev.baseUrl,
      }));
      // 模型不在预设列表里时走"自定义模型名"输入框，否则会被下面那个 effect 重置掉
      const meta = providerMeta(String(saved.provider));
      if (meta && saved.model && !meta.models.includes(saved.model)) {
        setCustomModel(saved.model);
      }
    });
  }, []);

  // 切换 Provider 时更新默认值
  // ⚠️ 回显保存的配置时**不能**重置：那是"用户换 provider"，不是"恢复已存配置"。
  // 少了这个标记，上面 effect 刚把 model/baseUrl 恢复回来，这里立刻按默认值覆盖掉。
  useEffect(() => {
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    const meta = providerMeta(form.provider);
    if (meta) {
      setForm((prev) => ({
        ...prev,
        model: meta.defaultModel,
        baseUrl: meta.defaultBaseUrl,
        apiKey: meta.needsKey ? prev.apiKey : '',
      }));
    }
  }, [form.provider]);

  const meta = providerMeta(form.provider);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.qqbat.aiProvider.test({
        provider: form.provider,
        apiKey: form.apiKey,
        model: form.model,
        baseUrl: form.baseUrl || undefined,
      });
      if (res.ok) {
        setTestResult({
          ok: true,
          message: t('settings.aiProvider.connected', {
            response: res.data?.response || t('settings.aiProvider.normal'),
          }),
        });
      } else {
        setTestResult({
          ok: false,
          message: `❌ ${res.error || t('settings.aiProvider.connectFailed')}`,
        });
      }
    } catch (e) {
      setTestResult({ ok: false, message: `❌ ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await window.qqbat.aiProvider.switch(form.provider, {
        provider: form.provider,
        apiKey: form.apiKey,
        model: form.model,
        baseUrl: form.baseUrl || undefined,
      });
      if (res.ok) {
        // 同步更新老接口的 ai 配置
        await window.qqbat.ai.setConfig({
          provider: form.provider as AiProvider,
          apiKey: form.apiKey,
          model: form.model,
          baseUrl: form.baseUrl || undefined,
        });
        // 落盘到项目的 .qqbat/project.json —— 不落盘的话重启就丢（历史缺陷）
        const projectPath = useProjectStore.getState().currentProject?.path ?? '';
        if (projectPath) {
          const persisted = await window.qqbat.ai.saveProjectConfig(projectPath, {
            provider: form.provider as AiProvider,
            apiKey: form.apiKey,
            model: form.model,
            baseUrl: form.baseUrl || undefined,
          });
          if (!persisted.ok) {
            setError(persisted.error || t('editor.code.saveFailed'));
            return;
          }
        }
        onSaved?.();
        onClose();
      } else {
        setError(res.error || t('editor.code.saveFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editor.code.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  /** 读当前上限设置（面板打开时一次） */
  useEffect(() => {
    void window.qqbat.ai.getToolBudget().then((res) => {
      if (res?.ok && res.data) setBudget(res.data);
    });
  }, []);

  /**
   * 存上限设置：**改完立刻生效**，不等 provider 表单那个"保存"按钮 ——
   * 两者是不同的东西（一个应用级、一个跟着 provider 走），
   * 让用户为了改上限去点一个写着"保存"的按钮只会让他以为没生效。
   */
  const saveBudget = async (next: { enabled: boolean; thresholdChars: number }) => {
    setBudget(next);
    setBudgetError('');
    const res = await window.qqbat.ai.setToolBudget(next);
    if (!res?.ok) {
      setBudgetError(res?.error || t('settings.aiProvider.toolBudget.saveFailed'));
      return;
    }
    if (res.data) setBudget(res.data);
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('settings.aiProvider.title')}
      width="520px"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={handleSave}
          confirmText={
            saving ? t('settings.aiProvider.saving') : t('settings.aiProvider.confirmSave')
          }
          confirmDisabled={saving || !form.model || (meta?.needsKey && !form.apiKey)}
          confirmTitle={
            !form.model
              ? t('settings.aiProvider.selectModel')
              : meta?.needsKey && !form.apiKey
                ? t('settings.aiProvider.enterApiKey')
                : undefined
          }
        />
      }
    >
      <p className="text-xs text-zinc-500 mb-4">{t('settings.aiProvider.description')}</p>
      {/* 明确指向另一个入口：这两个地方配的不是同一件事，不写清用户会以为重复 */}
      <p className="-mt-3 mb-4 text-xs text-sky-400/80">{t('settings.aiProvider.scopeHint')}</p>

      <div className="space-y-4">
        {/* Provider 下拉选择 */}
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            {t('settings.aiProvider.provider')}
          </label>
          <Dropdown
            value={form.provider}
            onChange={(v) => setForm((prev) => ({ ...prev, provider: v }))}
            options={availableProviders.map((p) => ({
              value: p,
              label: providerMeta(p)?.label || p,
            }))}
          />
        </div>

        {/* API Key */}
        {meta?.needsKey && (
          <div>
            <label className="block text-sm text-zinc-400 mb-1">API Key</label>
            <input
              type="password"
              className={`w-full ${inputForm}`}
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder={meta?.keyPlaceholder}
            />
          </div>
        )}
        {!meta?.needsKey && (
          <div>
            <label className="block text-sm text-zinc-400 mb-1">API Key</label>
            <input
              className={`w-full ${inputForm} text-zinc-500`}
              value={t('settings.aiProvider.localNoKey')}
              disabled
            />
          </div>
        )}

        {/* 模型选择/输入 */}
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            {t('settings.aiProvider.model')}
          </label>
          {meta ? (
            <div className="flex gap-2">
              <Dropdown
                value={form.model}
                onChange={(v) => setForm((prev) => ({ ...prev, model: v }))}
                options={[
                  ...meta.models.map((m) => ({ value: m, label: m })),
                  { value: '__custom__', label: t('settings.aiProvider.custom') },
                ]}
                className="flex-1"
              />
              {form.model === '__custom__' && (
                <input
                  className={`flex-1 ${inputForm}`}
                  value={customModel}
                  onChange={(e) => {
                    setCustomModel(e.target.value);
                    setForm((prev) => ({ ...prev, model: e.target.value }));
                  }}
                  placeholder={t('settings.aiProvider.modelPlaceholder')}
                  autoFocus
                />
              )}
            </div>
          ) : (
            <input
              className={`w-full ${inputForm}`}
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder={t('settings.aiProvider.modelName')}
            />
          )}
        </div>

        {/* Base URL */}
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            {t('settings.aiProvider.baseUrl')}
          </label>
          <input
            className={`w-full ${inputForm}`}
            value={form.baseUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder={meta?.defaultBaseUrl || 'https://...'}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('settings.aiProvider.baseUrlHint')}</p>
        </div>

        {/* 测试连接 */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="lg" disabled={testing} onClick={handleTest}>
            {testing ? t('settings.aiProvider.testing') : t('settings.aiProvider.test')}
          </Button>
          {testResult && (
            <span className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.message}
            </span>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {/* ── 工具结果上限 ───────────────────────────────────────────────
            这是**应用级**设置，与上面的 provider 表单无关，所以改动**立即生效**、
            不需要点"保存"（那个按钮只保存 provider/model/key）。
            放在这个对话框里是因为用户找 AI 相关设置只会来这一处。 */}
        <div className="border-t border-zinc-700 pt-4">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-zinc-400">
              {t('settings.aiProvider.toolBudget.title')}
            </label>
            <Switch
              checked={budget.enabled}
              onChange={(v) => void saveBudget({ ...budget, enabled: v })}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{t('settings.aiProvider.toolBudget.hint')}</p>

          {budget.enabled && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-zinc-500">
                {t('settings.aiProvider.toolBudget.threshold')}
              </span>
              <input
                type="number"
                min={512}
                max={200000}
                step={1024}
                className={`w-32 ${inputForm}`}
                value={budget.thresholdChars}
                onChange={(e) =>
                  setBudget((prev) => ({ ...prev, thresholdChars: Number(e.target.value) || 0 }))
                }
                // 失焦才落盘：边打字边存会把 "8" "81" "819" 这些中间态也写进去
                onBlur={() => void saveBudget(budget)}
              />
              <span className="text-xs text-zinc-500">
                {t('settings.aiProvider.toolBudget.unit')}
              </span>
            </div>
          )}

          {!budget.enabled && (
            <p className="mt-1 text-xs text-amber-400/80">
              {t('settings.aiProvider.toolBudget.offHint')}
            </p>
          )}
          {budgetError && <p className="mt-1 text-xs text-red-400">{budgetError}</p>}
        </div>
      </div>
    </Modal>
  );
}
