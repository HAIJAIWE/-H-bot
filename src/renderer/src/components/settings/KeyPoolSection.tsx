// src/renderer/src/components/settings/KeyPoolSection.tsx
//
// **模型 Key 池（回退链）** —— 全局智能体的设置区块。
//
// ## 为什么它单独一条通道，而不是塞进 ai:setAppConfig
//
// appAiConfig.ts 里那段注释写得很明确：回退链**刻意不进** `aiConfigSchema` ——
// 进了通用载荷就会变成「渲染层能设置、却被 zod 静默剥掉」的假字段（`enableThinking` 踩过）。
// 所以：**读取**走 `ai:getAppConfig`（它返回整份文件配置，本来就带 fallbacks），
// **写入**走 `ai:setFallbacks`（专用载荷 + 上限 8 校验）。
//
// ## 契约（与 src/shared/types/ai.ts / appAiConfig.ts 一致）
//
//   · 扁平：池里的一项**不许再嵌套** fallbacks（回退链只有一层）；
//   · 上限 **8**（服务端也校验，这里先拦一道，别等保存才报错）；
//   · 「测一次」复用现成的 `ai:testConfig`（零副作用，不走 provider 注册表）。
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 池里的一项（与主配置同形，但不再嵌套） */
interface PoolRow {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/** 上限：与 shared/types/ai.ts 的注释、主进程 aiFallbacksSchema 三处一致 */
const MAX_POOL = 8;

export function KeyPoolSection() {
  useLocaleSubscription();
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 正在测第几项 */
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [tested, setTested] = useState<Record<number, { ok: boolean; text: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.qqbat?.ai?.getAppConfig?.();
    const cfg = res?.ok ? res.data : null;
    setRows(Array.isArray(cfg?.fallbacks) ? (cfg!.fallbacks as PoolRow[]) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(i: number, next: Partial<PoolRow>) {
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...next } : r)));
    setTested((prev) => ({ ...prev, [i]: { ok: true, text: '' } }));
  }

  function move(i: number, delta: number) {
    setRows((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await window.qqbat?.ai?.setAiFallbacks?.(rows);
      if (res && res.ok === false) setMsg({ ok: false, text: res.error ?? 'save failed' });
      else setMsg({ ok: true, text: t('agent.saved') });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function test(i: number) {
    setTestingIndex(i);
    try {
      const res = await window.qqbat?.ai?.testConfig?.(rows[i] as never);
      const text = res?.ok
        ? ((res.data as { message?: string } | undefined)?.message ?? 'OK')
        : (res?.error ?? 'failed');
      setTested((prev) => ({ ...prev, [i]: { ok: Boolean(res?.ok), text: String(text) } }));
    } finally {
      setTestingIndex(null);
    }
  }

  const input =
    'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50';

  return (
    <section className="mt-3 border-t border-zinc-700 pt-3" data-testid="key-pool">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-zinc-300">{t('ai.pool.title')}</h4>
        <span className="text-[11px] text-zinc-500">
          {rows.length}/{MAX_POOL}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500">{t('ai.pool.hint')}</p>

      {loading ? (
        <p className="mt-2 text-[11px] text-zinc-500">…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-500">{t('ai.pool.empty')}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="rounded border border-zinc-700/60 bg-zinc-900/40 p-2">
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] text-zinc-500">{t('ai.pool.provider')}</span>
                  <input
                    className={input}
                    value={row.provider}
                    onChange={(e) => patch(i, { provider: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-zinc-500">{t('ai.pool.model')}</span>
                  <input
                    className={input}
                    value={row.model}
                    onChange={(e) => patch(i, { model: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-zinc-500">{t('ai.pool.key')}</span>
                  <input
                    className={input}
                    type="password"
                    value={row.apiKey}
                    onChange={(e) => patch(i, { apiKey: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                  disabled={i === 0}
                  title={t('ai.pool.moveUp')}
                  onClick={() => move(i, -1)}
                >
                  ↑ {t('ai.pool.moveUp')}
                </button>
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                  disabled={i === rows.length - 1}
                  title={t('ai.pool.moveDown')}
                  onClick={() => move(i, 1)}
                >
                  ↓ {t('ai.pool.moveDown')}
                </button>
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                  disabled={testingIndex === i}
                  onClick={() => void test(i)}
                >
                  {testingIndex === i ? '…' : t('ai.pool.test')}
                </button>
                {tested[i]?.text ? (
                  <span className={tested[i].ok ? 'text-emerald-400' : 'text-rose-400'}>
                    {tested[i].text}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-auto text-rose-400 hover:text-rose-300"
                  title={t('ai.pool.remove')}
                  onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}
                >
                  ✕ {t('ai.pool.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={rows.length >= MAX_POOL}
          onClick={() => setRows((prev) => [...prev, { provider: '', model: '', apiKey: '' }])}
        >
          {t('ai.pool.add')}
        </Button>
        <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
          {t('agent.save')}
        </Button>
        {msg && (
          <span className={msg.ok ? 'text-[11px] text-emerald-400' : 'text-[11px] text-rose-400'}>
            {msg.text}
          </span>
        )}
        {rows.length >= MAX_POOL && (
          <span className="text-[11px] text-amber-400">≤ {MAX_POOL}</span>
        )}
      </div>
    </section>
  );
}
