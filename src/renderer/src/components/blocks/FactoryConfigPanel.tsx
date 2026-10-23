// src/renderer/src/components/blocks/FactoryConfigPanel.tsx
//
// 「出厂配置」—— 一台 QQ 机器人**上线之前该有的东西**，一屏看清每项是什么状态。
//
// ## 为什么要有这一屏
//
// 这几件事**都不体现在流程图里**（一次配置、长期生效，不针对某个会话），
// 所以它们散在"设置 / 后台网站 / 指令面板 / 单聊窗口"四个地方，谁也不会同时打开。
// 结果是"配了面板忘了菜单""凭据填了但没发布"这类事**没人发现**。
//
// ## 五项，以及每一项"能不能读"
//
//   1. 凭据        —— 能读：`panel:list` 成功就说明凭据可用（失败信息会明说没配）
//   2. 指令面板    —— 能读：`panel:list`（群聊 / 单聊 各几条）
//   3. 自定义菜单  —— 能读：`panel:menu`（版本号 + 项数）
//   4. 服务范围    —— **读不到**：平台后台配置，代码只能观测（指向能力自检）
//   5. 能力自检    —— **能读**：`capability:probe`（`src/main/ipc/capability.ts` 已注册，
//                     ipcReachability 闸门守着"每个 register*Ipc 都必须被 register.ts 引用"）
//
// 第 4 项**如实写"读不到"**（平台后台配置，代码只能观测）—— 一个假装全绿的自检
// 比没有自检更糟（用户会照着它去排障）。第 5 项现在是真能跑的 ✓
import { useCallback, useEffect, useState } from 'react';
import { X, ClipboardCheck, RefreshCw, Play } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import type { CapabilityItemInfo } from '../../types/ipc';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

type RowState = 'ok' | 'missing' | 'unknown' | 'unsupported';

interface Row {
  key: string;
  label: string;
  state: RowState;
  detail: string;
}

export function FactoryConfigPanel({ onClose }: { onClose: () => void }) {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const projectName = useProjectStore((s) => s.currentProject?.name ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<CapabilityItemInfo[] | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setBusy(true);
    const out: Row[] = [];

    // ① 凭据 + ② 指令面板：同一次调用就能回答两件事（读得到 = 凭据可用）
    let credState: RowState = 'unknown';
    let credDetail = '';
    let panelDetail = '';
    let panelState: RowState = 'unknown';
    try {
      const counts: string[] = [];
      for (const scope of ['group', 'c2c']) {
        const res = await window.qqbat.panelSync.list(projectPath, scope);
        if (!res.ok) throw new Error(res.error ?? String(res));
        counts.push(
          t('blocks.factoryConfig.panelCount', {
            scope:
              scope === 'group'
                ? t('blocks.commandPanel.scopeGroup')
                : t('blocks.commandPanel.scopeC2c'),
            count: String(res.data?.length ?? 0),
          }),
        );
      }
      credState = 'ok';
      credDetail = t('blocks.factoryConfig.credOk');
      panelState = 'ok';
      panelDetail = counts.join('　');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 服务层的报错里会明说"尚未配置 AppID / AppSecret" —— 据此区分"没配"和"别的错"
      const notConfigured = msg.includes('AppID');
      credState = notConfigured ? 'missing' : 'unknown';
      credDetail = msg.slice(0, 120);
      panelState = 'unknown';
      panelDetail = t('blocks.factoryConfig.panelUnknown');
    }
    out.push({
      key: 'cred',
      label: t('blocks.factoryConfig.rowCred'),
      state: credState,
      detail: credDetail,
    });
    out.push({
      key: 'panel',
      label: t('blocks.factoryConfig.rowPanel'),
      state: panelState,
      detail: panelDetail,
    });

    // ③ 自定义菜单
    try {
      const res = await window.qqbat.panelSync.menu(projectPath);
      if (!res.ok) throw new Error(res.error ?? String(res));
      const n = Array.isArray((res.data?.menu as { items?: unknown[] } | null)?.items)
        ? ((res.data?.menu as { items: unknown[] }).items.length as number)
        : 0;
      out.push({
        key: 'menu',
        label: t('blocks.factoryConfig.rowMenu'),
        state: n > 0 ? 'ok' : 'missing',
        detail:
          n > 0
            ? t('blocks.factoryConfig.menuOk', {
                version: String(res.data?.version ?? 0),
                count: String(n),
              })
            : t('blocks.factoryConfig.menuMissing'),
      });
    } catch (e) {
      out.push({
        key: 'menu',
        label: t('blocks.factoryConfig.rowMenu'),
        state: 'unknown',
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 120),
      });
    }

    // ④ 服务范围：平台后台配置，代码读不到 —— 如实说；但**跑过能力自检后**可以给"已观测"的结论 ✓
    //    （自检全程只发 GET，探的就是"这个号实际能用哪些能力" = 服务范围的可观测部分）
    const probeOk = probe ? probe.filter((i) => i.verdict === 'ok').length : 0;
    out.push({
      key: 'scope',
      label: t('blocks.factoryConfig.rowScope'),
      state: probe ? (probeOk > 0 ? 'ok' : 'missing') : 'unsupported',
      detail: probe
        ? t('blocks.factoryConfig.scopeObserved', {
            ok: String(probeOk),
            total: String(probe.length),
          })
        : t('blocks.factoryConfig.scopeUnsupported'),
    });
    // ⑤ 能力自检：**全程只发 GET**，问的是"这一个 bot 现在能用哪些能力"
    out.push({
      key: 'probe',
      label: t('blocks.factoryConfig.rowProbe'),
      state: probe ? 'ok' : 'unknown',
      detail: probe
        ? t('blocks.factoryConfig.probeDone', {
            ok: String(probe.filter((i) => i.verdict === 'ok').length),
            total: String(probe.length),
          })
        : t('blocks.factoryConfig.probeHint'),
    });

    setRows(out);
    setBusy(false);
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runProbe = async () => {
    if (!projectPath) return;
    setProbeBusy(true);
    try {
      const res = await window.qqbat.capability.probe(projectPath);
      if (!res.ok) throw new Error(res.error ?? String(res));
      setProbe(res.data?.items ?? []);
    } catch (e) {
      setProbe([]);
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setProbeBusy(false);
    }
  };

  const dot = (s: RowState) =>
    s === 'ok' ? 'text-emerald-400' : s === 'missing' ? 'text-amber-400' : 'text-zinc-500';
  const mark = (s: RowState) => (s === 'ok' ? '✓' : s === 'missing' ? '⚠' : '○');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="w-[560px] max-h-[80vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <ClipboardCheck aria-hidden="true" className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">
            {t('blocks.factoryConfig.title')}
          </span>
          <span className="text-xs text-zinc-500">{projectName}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void refresh()}
            title={t('blocks.factoryConfig.refresh')}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            title={t('editor.action.close')}
            leftIcon={<X className="h-4 w-4" />}
          />
        </div>

        <div className="px-4 py-2 text-[11px] leading-relaxed text-zinc-500">
          {t('blocks.factoryConfig.hint')}
        </div>

        {/* 自检明细：哪一项可用、哪一项被权限挡住 —— 这才是"这一个 bot 能用什么" */}
        {probe && probe.length > 0 && (
          <div className="border-t border-zinc-800 px-4 py-2">
            <div className="mb-1 text-[11px] text-zinc-500">
              {t('blocks.factoryConfig.probeTitle')}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {probe.map((it) => (
                <div key={it.id} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className={
                      it.verdict === 'ok'
                        ? 'text-emerald-400'
                        : it.verdict === 'bad_target'
                          ? 'text-zinc-500'
                          : 'text-amber-400'
                    }
                  >
                    {it.verdict === 'ok' ? '✓' : it.verdict === 'bad_target' ? '○' : '⚠'}
                  </span>
                  <span className="truncate text-zinc-400" title={`${it.note} ${it.status}`}>
                    {it.zhLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="divide-y divide-zinc-800">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start gap-2 px-4 py-2">
              <span className={`w-4 shrink-0 ${dot(r.state)}`}>{mark(r.state)}</span>
              <span className="w-24 shrink-0 text-xs text-zinc-300">{r.label}</span>
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-zinc-400">
                {r.detail}
              </span>
              {r.key === 'probe' && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={probeBusy}
                  leftIcon={<Play className="h-3 w-3" />}
                  onClick={() => void runProbe()}
                >
                  {probeBusy
                    ? t('blocks.factoryConfig.probeRunning')
                    : t('blocks.factoryConfig.runProbe')}
                </Button>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <div className="px-4 py-6 text-xs text-zinc-500">
              {t('blocks.factoryConfig.loading')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
