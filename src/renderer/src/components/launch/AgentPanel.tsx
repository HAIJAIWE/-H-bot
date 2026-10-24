// src/renderer/src/components/launch/AgentPanel.tsx
//
// 「启动 → 智能体」面板 —— 两套 AI 的模型与密钥。
//
// ## 这一屏要解决的核心问题
//
// 用户原话：「一个全局智能体 ai，一个机器人项目里的 ai。面板来给所有的 ai 选择模型和密钥呀」，
// 以及最关键的一条诉求：**「不用切项目就能配」**。
//
// 所以这里**一次列出所有项目**（不是只列当前项目），点某一行就地展开编辑。
// 如果做成"只配当前项目"，用户配 5 个机器人就要切 5 次项目。
//
// ## 两栏的作用域不同（别混）
//
//   ① 全局智能体 —— 应用级一份，**帮你开发所有项目**。换项目不该变。
//   ② 机器人项目 —— 每个项目一份，是**机器人在群里跟人对话**用的模型。
//      新项目默认"跟随全局"，零配置可用。
//
// 每行都显示**实际会用的那个模型**（自己配了用自己的，否则显示全局的），
// 不让用户猜"这个项目到底跟不跟随" —— 那是最容易配错的地方。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyPoolSection } from '../settings/KeyPoolSection';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import type { AiConfig } from '@shared/types/ai';
import { DOMESTIC_LLM_PRESETS, findLlmPreset } from '@shared/types/llm-presets';
import { DeployDialog } from '@renderer/components/deploy/DeployDialog';

interface ProjectRow {
  projectPath: string;
  name: string;
  own: AiConfig | null;
  effective: AiConfig | null;
  followsGlobal: boolean;
}

interface ListResult {
  global: AiConfig | null;
  projects: ProjectRow[];
}

/** 自定义模型名选项的哨兵值（与真实模型名不会冲突） */
const CUSTOM_MODEL = '__custom__';

/** 一个配置编辑表单（全局卡片与项目行共用，避免两处漂移） */
function ConfigForm({
  value,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: AiConfig | null;
  onSave: (config: AiConfig) => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  const preset = findLlmPreset(String(value?.provider ?? 'glm')) ?? DOMESTIC_LLM_PRESETS[0];
  const [provider, setProvider] = useState<string>(value?.provider ?? preset.id);
  const [model, setModel] = useState(value?.model ?? preset.defaultModel);
  const [apiKey, setApiKey] = useState(value?.apiKey ?? '');
  // 地址默认**填好**而不是留空：各家路径不一样（智谱 /api/paas/v4、百炼要带
  // /compatible-mode/v1），留空让用户自己查文档是最容易错的一步。
  const [baseUrl, setBaseUrl] = useState(value?.baseUrl || preset.baseUrl);
  /** 模型下拉的选中值；用户选"自定义"时用 CUSTOM_MODEL */
  const [modelChoice, setModelChoice] = useState<string>(
    // 预设表是 `as const`（为了不让 AiProvider 退化成 string），于是每条 models 都是
    // **字面量元组**；这里只做"用户存的模型名还在不在候选里"的包含判断，放宽成 readonly string[] 即可。
    (preset.models as readonly string[]).includes(value?.model ?? '')
      ? (value?.model as string)
      : value?.model
        ? CUSTOM_MODEL
        : preset.defaultModel,
  );

  const current = findLlmPreset(provider) ?? preset;

  /**
   * 「测试」：拿**表单里此刻这份**（可能还没保存）配置真的发一次最小请求。
   *
   * 为什么必须有（2026-10-06 用户提）：key 粘错、baseUrl 少一段路径、模型名过期，
   * 这三种错在保存时都**不报错** —— 用户只能靠"发一句话看有没有回"来试，
   * 而那要切到对话面板、还要分清"是配置错还是模型慢"。就地测一次最省事。
   */
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const runTest = async (): Promise<void> => {
    /**
     * 桥里没有这条能力 = **应用还在旧的一次构建上**（renderer 有 HMR，preload/主进程没有）。
     * 直接调会抛 `testConfig is not a function` —— 那行报错对用户毫无意义，
     * 不如直说"重启应用"（2026-10-06 真机上就是这么撞上的）。
     */
    if (typeof window.qqbat?.ai?.testConfig !== 'function') {
      setTestResult({
        ok: false,
        text: t('agent.testFailed', { error: t('agent.testNeedRestart') }),
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.qqbat.ai.testConfig({
        provider: provider as AiConfig['provider'],
        model: model.trim(),
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (!res.ok) {
        setTestResult({ ok: false, text: t('agent.testFailed', { error: res.error ?? '' }) });
      } else if (res.data?.ok) {
        const sample = res.data.sample ? t('agent.testSample', { sample: res.data.sample }) : '';
        setTestResult({
          ok: true,
          text:
            t('agent.testOk', {
              model: res.data.model ?? model,
              ms: String(res.data.latencyMs ?? 0),
            }) + sample,
        });
      } else {
        setTestResult({
          ok: false,
          text: t('agent.testFailed', { error: res.data?.error ?? '' }),
        });
      }
    } catch (e) {
      setTestResult({ ok: false, text: t('agent.testFailed', { error: String(e) }) });
    } finally {
      setTesting(false);
    }
  };

  /** 换服务商：地址与模型跟着换成该家的默认值，Key 清空（不同家的 Key 不通用） */
  const switchProvider = (id: string): void => {
    const next = findLlmPreset(id);
    if (!next) return;
    setProvider(id);
    setBaseUrl(next.baseUrl);
    setModel(next.defaultModel);
    setModelChoice(next.defaultModel);
    setApiKey('');
  };

  return (
    <div className="grid gap-2 mt-2">
      <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs">
        <span className="text-zinc-400">{t('agent.field.provider')}</span>
        <select
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
          value={provider}
          onChange={(e) => switchProvider(e.target.value)}
        >
          {DOMESTIC_LLM_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs">
        <span className="text-zinc-400">{t('agent.field.model')}</span>
        <div className="flex gap-2">
          <select
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 flex-1"
            value={modelChoice}
            onChange={(e) => {
              const v = e.target.value;
              setModelChoice(v);
              if (v !== CUSTOM_MODEL) setModel(v);
            }}
          >
            {current.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>{t('agent.model.custom')}</option>
          </select>
          {/* 模型名会过期（实测 moonshot-v1 已全线下线）—— 给出官方列表页，别让用户猜 */}
          <a
            href={current.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap self-center"
            title={current.docsUrl}
          >
            {t('agent.model.docs')} ↗
          </a>
          {/* 选了"自定义"才出现输入框 —— 模型名迭代很快，不能只给固定列表 */}
          {modelChoice === CUSTOM_MODEL && (
            <input
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 flex-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={current.defaultModel}
            />
          )}
        </div>
      </label>

      <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs">
        <span className="text-zinc-400">{t('agent.field.apiKey')}</span>
        <div className="flex gap-2 items-center">
          <input
            type="password"
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 flex-1"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              current.needsKey
                ? t('agent.field.apiKeyPlaceholder')
                : t('agent.field.apiKeyOptional')
            }
          />
          {/* 「链接」：去哪申请 Key。这是用户最容易卡住的一步，直接给可点入口 */}
          <a
            href={current.keyPage}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap"
            title={current.keyPage}
          >
            {t('agent.field.getKey')} ↗
          </a>
        </div>
      </label>

      <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs">
        <span className="text-zinc-400">{t('agent.field.baseUrl')}</span>
        <input
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={t('agent.field.baseUrlHint')}
        />
      </label>

      {/* 服务商自己的注意事项（如"百炼必须带 /compatible-mode/v1"）—— 这些是踩过的坑 */}
      {current.note && <p className="text-xs text-zinc-500 pl-[5.5rem]">{current.note}</p>}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* 测试结果就地显示：成功给"模型 + 耗时 + 它回了什么"，失败给原始错误 */}
      {testResult && (
        <p className={'text-xs ' + (testResult.ok ? 'text-emerald-400' : 'text-red-400')}>
          {testResult.text}
        </p>
      )}

      <div className="flex gap-2 items-center">
        <Button
          size="sm"
          variant="primary"
          disabled={saving || !model.trim()}
          onClick={() =>
            onSave({
              provider: provider as AiConfig['provider'],
              model: model.trim(),
              apiKey: apiKey.trim(),
              ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
            })
          }
        >
          {saving ? t('agent.saving') : t('agent.save')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={testing}
          disabled={saving || testing || !model.trim()}
          onClick={() => void runTest()}
        >
          {testing ? t('agent.testing') : t('agent.test')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving || testing}>
          {t('agent.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * 服务商**显示名**：预设表里那份中文名。
 *
 * 面板头与项目行原来直接写 `provider` id（"dashscope · qwen3.8-flash"），
 * 而下面的表单里显示的是"通义千问（阿里云百炼）"—— 同一个东西两个名字，
 * 用户对不上号（2026-10-06 截图）。
 */
function providerLabel(id: string): string {
  return findLlmPreset(id)?.label ?? id;
}

export function AgentPanel() {
  useLocaleSubscription();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingGlobal, setEditingGlobal] = useState(false);
  /** 正在展开编辑的项目路径（null = 都没展开） */
  const [editingProject, setEditingProject] = useState<string | null>(null);
  /** 部署对话框的目标项目（null = 不显示）—— 部署能力一直在，只是入口曾被拆掉 */
  const [deployTarget, setDeployTarget] = useState<{ path: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    window.qqbat.ai
      .listProjectBotConfigs()
      .then((res) => {
        if (res.ok && res.data) setData(res.data as ListResult);
        else setError(res.error || t('agent.loadFailed'));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 统一的保存收尾：清状态 → 重载（保证"实际会用哪个模型"是最新的） */
  const finishSave = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setSaving(true);
      setFormError('');
      try {
        const res = await fn();
        if (!res.ok) {
          setFormError(res.error || t('agent.saveFailed'));
          return;
        }
        setEditingGlobal(false);
        setEditingProject(null);
        load();
      } catch (e) {
        setFormError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const globalSummary = useMemo(() => {
    const g = data?.global;
    if (!g) return t('agent.notConfigured');
    return `${providerLabel(g.provider)} · ${g.model}`;
  }, [data]);

  /** 脱敏显示密钥（只给"配没配"的信息，不回显明文） */
  const keyHint = (c: AiConfig | null) => (c?.apiKey ? '••••' : t('agent.keyEmpty'));

  if (loading) {
    return (
      <div className="p-6 flex items-center text-xs text-zinc-500">
        <Spinner size="sm" />
        <span className="ml-2">{t('agent.loading')}</span>
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-auto">
      {error && (
        <div className="mb-4 text-xs text-red-400 flex items-center gap-3">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={load}>
            {t('agent.retry')}
          </Button>
        </div>
      )}

      {/* 指引：本面板两栏各管一件事（① 开发助手 / ② 机器人用的模型） */}
      <p className="mb-3 text-xs text-zinc-500">{t('agent.devAssistantHint')}</p>

      {/* ── ① 全局智能体 ── */}
      <section className="mb-5 border border-zinc-700 rounded-lg bg-zinc-900/40">
        <header className="px-3 py-2 border-b border-zinc-700 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm text-zinc-200">{t('agent.global.title')}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{t('agent.global.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-400">{globalSummary}</span>
            {!editingGlobal && (
              <Button size="sm" variant="secondary" onClick={() => setEditingGlobal(true)}>
                {data?.global ? t('agent.edit') : t('agent.configure')}
              </Button>
            )}
          </div>
        </header>
        {editingGlobal && (
          <div className="px-3 pb-3">
            <ConfigForm
              value={data?.global ?? null}
              saving={saving}
              error={formError}
              onCancel={() => {
                setEditingGlobal(false);
                setFormError('');
              }}
              onSave={(config) => void finishSave(() => window.qqbat.ai.setAppConfig(config))}
            />
            {/* Key 池（回退链）：**应用级**设置，只挂全局智能体这一栏（项目级没有它） */}
            <KeyPoolSection />
          </div>
        )}
      </section>

      {/* ── ② 机器人项目 ── */}
      <section className="border border-zinc-700 rounded-lg bg-zinc-900/40">
        <header className="px-3 py-2 border-b border-zinc-700">
          <h3 className="text-sm text-zinc-200">{t('agent.projects.title')}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">{t('agent.projects.subtitle')}</p>
        </header>

        {!data?.projects.length ? (
          <p className="px-3 py-4 text-xs text-zinc-500">{t('agent.projects.empty')}</p>
        ) : (
          <ul>
            {data.projects.map((row) => {
              const open = editingProject === row.projectPath;
              return (
                <li key={row.projectPath} className="border-b border-zinc-800 last:border-b-0">
                  {/* 中栏窄时换行堆叠：模型名/Key/跟随状态各占固定宽度，挤在一起会变成竖排单字 */}
                  <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      className="text-zinc-300 text-xs flex-1 min-w-24 text-left hover:text-zinc-100 whitespace-nowrap"
                      onClick={() => {
                        setEditingProject(open ? null : row.projectPath);
                        setFormError('');
                      }}
                    >
                      <span className="text-zinc-500 mr-2">{open ? '▾' : '▸'}</span>
                      {row.name}
                    </button>

                    <span className="text-xs text-zinc-400 w-40 max-w-full truncate">
                      {row.effective
                        ? `${providerLabel(row.effective.provider)} · ${row.effective.model}`
                        : t('agent.notConfigured')}
                    </span>
                    <span className="text-xs text-zinc-500 w-14">{keyHint(row.effective)}</span>
                    {/* 「跟随全局」要说出来 —— 否则用户分不清"没配"和"故意跟随" */}
                    <span
                      className={`text-xs w-20 ${row.followsGlobal ? 'text-zinc-500' : 'text-emerald-400'}`}
                    >
                      {row.followsGlobal ? t('agent.followGlobal') : t('agent.ownConfig')}
                    </span>
                    {/* 部署入口：能力一直在，只是入口曾随 ProjectCard/ProjectSelector 被拆掉 */}
                    <button
                      type="button"
                      className="text-xs text-zinc-400 hover:text-emerald-300 shrink-0"
                      onClick={() => setDeployTarget({ path: row.projectPath, name: row.name })}
                    >
                      {t('launch.card.deploy')}
                    </button>
                  </div>

                  {open && (
                    <div className="px-3 pb-3 bg-zinc-950/40">
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={row.followsGlobal || saving}
                          onClick={() =>
                            void finishSave(() =>
                              window.qqbat.ai.setProjectBotConfig(row.projectPath, null),
                            )
                          }
                        >
                          {t('agent.followGlobalAction')}
                        </Button>
                        <span className="text-xs text-zinc-500 min-w-0 truncate">
                          {t('agent.followGlobalHint')}
                        </span>
                      </div>
                      <ConfigForm
                        value={row.own ?? data?.global ?? null}
                        saving={saving}
                        error={formError}
                        onCancel={() => {
                          setEditingProject(null);
                          setFormError('');
                        }}
                        onSave={(config) =>
                          void finishSave(() =>
                            window.qqbat.ai.setProjectBotConfig(row.projectPath, config),
                          )
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {/* 部署对话框：整条链（IPC / preload / 类型 / 组件）都在，只缺这个入口 */}
      <DeployDialog
        open={deployTarget !== null}
        onClose={() => setDeployTarget(null)}
        projectPath={deployTarget?.path ?? ''}
        projectName={deployTarget?.name ?? ''}
      />
    </div>
  );
}
