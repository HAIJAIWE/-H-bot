// src/renderer/src/components/blocks/CommandPanelEditor.tsx
//
// 「指令面板」编辑器 —— 挑哪些指令进 QQ 的 `/` 快捷面板，以及它们在面板里长什么样。
//
// ## 它和「指令清单」的分工
//
// `CommandListPanel` 是**只读目录**（"表格里一个字都改不了，编辑永远回画布"）。
// 这个面板是**发布设置**：勾选 / 排序 / 填描述 —— 三件事都**只在这里做**，
// 所以没有"同一参数两处可改"的问题（它们也**不进**画布节点的属性抽屉，见设计文档 §三）。
//
// ## 为什么不照搬那张大表
//
// 大表有"回复摘要 / 节点数 / 问题数 / 读的表"四列，那是**排查**用的；
// 挑面板要的是"一屏能扫完 + 就地改描述 + 看得见第几条"。所以这里只留
// 命令词 / 描述 / 顺序三列，一行更矮，20 条在一屏里。
import { useEffect, useMemo, useState } from 'react';
import { X, ListPlus, Eye, CloudDownload, UploadCloud } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import { useProjectStore } from '../../stores/projectStore';
import { usePanelDriftStore } from '../../stores/panelDriftStore';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { buildCommandRows, type CommandRow } from '../../lib/command/commandList';
import { planPanelItems, findStaleItems, type PanelWarning } from '../../lib/canvas/panelSelection';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { inputForm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import type { RemotePanelInfo, ApplyPanelInfo } from '../../types/ipc';

/**
 * 面板按场景分开（官方 `scope`），界面上两个都管。
 * 真机实测（2026-09-29）：**一个场景只显示一个面板** —— 同步时同场景多余的会被删掉。
 */
const SCOPES = ['group', 'c2c'] as const;

const scopeLabel = (s: string) =>
  s === 'group' ? t('blocks.commandPanel.scopeGroup') : t('blocks.commandPanel.scopeC2c');

/** 警告编码 → 人话（编码由纯逻辑层给，文案在这里，见 panelSelection.ts 的头注释） */
function warningText(w: PanelWarning): string {
  switch (w.code) {
    case 'too-many':
      return t('blocks.commandPanel.warnTooMany', {
        count: w.detail ?? '',
        max: '20',
      });
    case 'name-too-long':
      return t('blocks.commandPanel.warnNameTooLong', { name: w.detail ?? '' });
    case 'desc-too-long':
      return t('blocks.commandPanel.warnDescTooLong', { name: w.detail ?? '' });
    case 'empty':
      return t('blocks.commandPanel.warnEmpty');
  }
}

export function CommandPanelEditor({ onClose }: { onClose: () => void }) {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const nodeIssues = useFlowStore((s) => s.nodeIssues);
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const setFocusNode = useFlowStore((s) => s.setFocusNode);
  const selectNode = useFlowStore((s) => s.selectNode);

  const [previewOpen, setPreviewOpen] = useState(false);

  const rows = useMemo(
    () => buildCommandRows(nodes, edges, nodeIssues),
    [nodes, edges, nodeIssues],
  );
  // 子流程不是"用户能发的指令"，不参与挑
  const pickable = useMemo(() => rows.filter((r) => !r.isSubflow && !!r.command), [rows]);
  const plan = useMemo(() => planPanelItems(rows), [rows]);

  const handleJump = (nodeId: string) => {
    setFocusNode(nodeId);
    selectNode(nodeId);
    focusNode(nodeId);
  };

  const toggle = (row: CommandRow) => updateNodeConfig(row.triggerId, { panel_on: !row.panel.on });

  const setDesc = (row: CommandRow, desc: string) =>
    updateNodeConfig(row.triggerId, { panel_desc: desc });

  const setOrder = (row: CommandRow, raw: string) => {
    const n = Number(raw);
    updateNodeConfig(row.triggerId, {
      panel_order: raw.trim() === '' || !Number.isFinite(n) ? undefined : n,
    });
  };

  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const toast = useToast();
  const [remote, setRemote] = useState<RemotePanelInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [confirmPreview, setConfirmPreview] = useState<ApplyPanelInfo[] | null>(null);
  const setDrift = usePanelDriftStore((s) => s.setDrift);

  /** 拉一次远端现状（只读）。两个场景都拉 —— 面板按场景分开。 */
  const refreshRemote = async () => {
    if (!projectPath) return;
    const all: RemotePanelInfo[] = [];
    for (const scope of SCOPES) {
      const res = await window.qqbat.panelSync.list(projectPath, scope);
      if (!res.ok) throw new Error(res.error ?? String(res));
      all.push(...(res.data ?? []));
    }
    setRemote(all);
  };

  const handleListRemote = async () => {
    setBusy(true);
    setRemoteError('');
    try {
      await refreshRemote();
    } catch (e) {
      setRemote(null);
      setRemoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 先 dryRun（只 GET，不写）拿到"将会发生什么"，再弹确认框 —— 写线上状态前必须先看见 */
  const handleSyncPreview = async () => {
    if (!projectPath) return;
    setBusy(true);
    try {
      const previews: ApplyPanelInfo[] = [];
      for (const scope of SCOPES) {
        const res = await window.qqbat.panelSync.apply(projectPath, {
          scope,
          items: plan.items,
          remark: 'command panel',
          dryRun: true,
        });
        if (!res.ok) throw new Error(res.error ?? String(res));
        if (res.data) previews.push(res.data);
      }
      setConfirmPreview(previews);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSync = async () => {
    setConfirmPreview(null);
    setBusy(true);
    try {
      const done: string[] = [];
      for (const scope of SCOPES) {
        const res = await window.qqbat.panelSync.apply(projectPath, {
          scope,
          items: plan.items,
          remark: 'command panel',
        });
        if (!res.ok) throw new Error(res.error ?? String(res));
        if (res.data) done.push(res.data.summary);
      }
      toast.success(t('blocks.commandPanel.syncDone', { summary: done.join('；') }));
      await refreshRemote();
    } catch (e) {
      toast.error(
        t('blocks.commandPanel.syncFailed', { error: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * **进面板就自动查一次远端**（只读）。
   *
   * 为什么不能靠用户点「查看远端」：面板是**远端副本**，图改了它不会自己变，
   * 而"图里改了、面板没跟上"是**静默**的 —— 用户不当场看到就永远不知道。
   * 所以一进来就把差异摆在他面前。这一步**只发 GET**，不改任何东西。
   */
  useEffect(() => {
    if (!projectPath) return;
    void handleListRemote();
    // 只在打开面板时查一次；切项目时重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  /**
   * 漂移：每个场景的远端面板，与"图上现在要发的东西"比。
   *
   * ⚠️ 比较前去掉前导斜杠 —— 真机实测平台会把 `name` 的 `/` 去掉
   * （发 `/骰子`，查回来是 `骰子`），不归一化的话**永远报"不一致"**。
   */
  const drift = useMemo(() => {
    const norm = (list: { name?: string; desc?: string }[]) =>
      list.map((i) => ({ name: String(i.name ?? '').replace(/^\//, ''), desc: i.desc ?? '' }));
    const want = norm(plan.items);
    if (!remote) return null;
    return SCOPES.map((scope) => {
      const panel = remote.find((p) => String(p.scope ?? '') === scope);
      const got = norm((panel?.panel?.items ?? []) as { name?: string; desc?: string }[]);
      const same =
        got.length === want.length &&
        got.every((x, i) => x.name === want[i].name && x.desc === want[i].desc);
      return { scope, exists: !!panel, same, count: got.length };
    });
  }, [remote, plan.items]);

  /** 面板里有、图里已经没有的条目（那种**点了没反应**） */
  const staleNames = (remote ?? []).flatMap((p) =>
    findStaleItems(
      (p.panel?.items ?? []) as { type: 'command'; name: string; desc: string }[],
      rows,
    ),
  );

  /**
   * 核对结果留给工具栏角标 —— 用户改完图就关面板了，不会为看一眼差异再打开一次，
   * 所以"图改了、面板没跟上"必须能在**关着面板时**也看得见。
   */
  useEffect(() => {
    if (!drift) return;
    setDrift(drift.filter((d) => !d.same).length, staleNames.length);
    // staleNames 每次渲染都是新数组，用长度当依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drift, staleNames.length, setDrift]);

  return (
    <div className="w-[400px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-full">
      {/* 标题栏 */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center gap-2 shrink-0">
        <ListPlus className="w-4 h-4 text-zinc-400" aria-hidden="true" />
        <span className="text-sm text-zinc-200 font-medium">{t('blocks.commandPanel.title')}</span>
        <span className="text-xs text-zinc-500">
          {t('blocks.commandPanel.selected', {
            count: plan.selected,
            max: String(plan.limit),
          })}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300"
          title={t('editor.action.close')}
          leftIcon={<X className="w-4 h-4" />}
        />
      </div>

      {/* 说明：这个面板是干什么的（一次配置、长期生效） */}
      <div className="px-3 py-2 border-b border-zinc-800 text-[11px] leading-relaxed text-zinc-500 shrink-0">
        {t('blocks.commandPanel.hint')}
      </div>

      {/* 会不会被官方拒（全是本地能查出来的硬伤，别等发出去才报错） */}
      {plan.warnings.length > 0 && (
        <div className="px-3 py-2 border-b border-zinc-800 space-y-1 shrink-0">
          {plan.warnings.map((w) => (
            <div key={w.code + (w.triggerId ?? '')} className="text-[11px] text-amber-400/90">
              {warningText(w)}
            </div>
          ))}
        </div>
      )}

      {/* 一屏扫完：勾选 / 命令词 / 描述 / 顺序 */}
      <div className="flex-1 overflow-y-auto">
        {pickable.length === 0 && (
          <div className="px-3 py-6 text-xs text-zinc-500">
            {t('blocks.commandPanel.noCommands')}
          </div>
        )}
        {pickable.map((row) => (
          <div
            key={row.triggerId}
            className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800/60"
          >
            <input
              type="checkbox"
              checked={row.panel.on}
              onChange={() => toggle(row)}
              aria-label={t('blocks.commandPanel.pickAria', { name: row.triggerText })}
              className="shrink-0 accent-blue-500"
            />
            <button
              type="button"
              onClick={() => handleJump(row.triggerId)}
              title={t('blocks.commandPanel.jump', { name: row.triggerText })}
              className="w-[86px] shrink-0 truncate text-left font-mono text-[11px] text-sky-300 hover:text-sky-200"
            >
              {row.triggerText}
            </button>
            <input
              type="text"
              value={row.panel.desc}
              onChange={(e) => setDesc(row, e.target.value)}
              placeholder={
                row.reply
                  ? t('blocks.commandPanel.descFromReply')
                  : t('blocks.commandPanel.descPlaceholder')
              }
              aria-label={t('blocks.commandPanel.descAria', { name: row.triggerText })}
              className={`min-w-0 flex-1 ${inputForm} text-[11px]`}
            />
            <input
              type="number"
              value={row.panel.order ?? ''}
              onChange={(e) => setOrder(row, e.target.value)}
              placeholder="—"
              aria-label={t('blocks.commandPanel.orderAria', { name: row.triggerText })}
              className={`w-12 shrink-0 ${inputForm} text-[11px] text-center`}
            />
          </div>
        ))}
      </div>

      {/* 底栏：没挑的有几条 + 预览 + 同步（同步在下一步接 panelSync，这里先只出预览） */}
      <div className="px-2 py-2 border-t border-zinc-800 space-y-1.5 shrink-0">
        {plan.notSelected > 0 && (
          <div className="text-[11px] text-zinc-500">
            {t('blocks.commandPanel.notSelected', { count: plan.notSelected })}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Eye className="w-3.5 h-3.5" />}
            onClick={() => setPreviewOpen((v) => !v)}
            title={t('blocks.commandPanel.previewTip')}
          >
            {t('blocks.commandPanel.preview')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !projectPath}
            leftIcon={<CloudDownload className="w-3.5 h-3.5" />}
            onClick={() => void handleListRemote()}
            title={t('blocks.commandPanel.remoteTip')}
          >
            {t('blocks.commandPanel.remote')}
          </Button>
          <div className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            className="bg-blue-600/40 hover:bg-blue-600/60 text-blue-100"
            disabled={busy || !projectPath || plan.warnings.some((w) => w.code === 'empty')}
            leftIcon={<UploadCloud className="w-3.5 h-3.5" />}
            onClick={() => void handleSyncPreview()}
            title={t('blocks.commandPanel.syncTip')}
          >
            {busy ? t('blocks.commandPanel.busy') : t('blocks.commandPanel.sync')}
          </Button>
        </div>

        {/* 真机实测：PC 端打 `/` 只有表情，面板只在手机端渲染 —— 不写出来用户会当成 bug */}
        <div className="text-[10px] text-zinc-600">{t('blocks.commandPanel.mobileOnly')}</div>

        {remoteError && (
          <div className="text-[11px] text-amber-400/90">
            {t('blocks.commandPanel.remoteFailed', { error: remoteError })}
          </div>
        )}

        {/* 与 QQ 的差异 —— 面板是远端副本，图改了它不会自己变，所以一进来就摆出来 */}
        {drift && (
          <div className="space-y-0.5">
            <div className="text-[11px] text-zinc-500">{t('blocks.commandPanel.driftTitle')}</div>
            {drift.map((d) => (
              <div
                key={d.scope}
                className={`text-[11px] ${d.same ? 'text-zinc-500' : 'text-amber-400'}`}
              >
                {!d.exists
                  ? t('blocks.commandPanel.driftMissing', { scope: scopeLabel(d.scope) })
                  : d.same
                    ? t('blocks.commandPanel.driftOk', {
                        scope: scopeLabel(d.scope),
                        count: String(d.count),
                      })
                    : t('blocks.commandPanel.driftDiff', {
                        scope: scopeLabel(d.scope),
                        count: String(d.count),
                        want: String(plan.items.length),
                      })}
              </div>
            ))}
          </div>
        )}

        {/* 远端现状：几个面板、各几条、以及**图里已经没有了**的失效条目（那种点了没反应） */}
        {remote && (
          <div className="max-h-32 space-y-0.5 overflow-auto">
            <div className="text-[11px] text-zinc-500">{t('blocks.commandPanel.remoteTitle')}</div>
            {remote.length === 0 && (
              <div className="text-[11px] text-zinc-600">
                {t('blocks.commandPanel.remoteEmpty')}
              </div>
            )}
            {remote.map((p) => {
              const items = (p.panel?.items ?? []) as {
                type: 'command';
                name: string;
                desc: string;
              }[];
              const stale = findStaleItems(items, rows);
              return (
                <div key={p.panel_id} className="truncate text-[10px] text-zinc-500">
                  {t('blocks.commandPanel.remoteLine', {
                    scope: scopeLabel(String(p.scope ?? '')),
                    count: String(items.length),
                    id: p.panel_id.slice(0, 12),
                  })}
                  {stale.length > 0 && (
                    <span className="text-amber-400">
                      {' '}
                      {t('blocks.commandPanel.stale', {
                        names: stale.map((s) => s.name).join(' '),
                      })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {previewOpen && (
          <pre
            data-testid="panel-preview"
            className="max-h-40 overflow-auto rounded border border-zinc-700/60 bg-zinc-950 p-2 text-[10px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-all"
          >
            {JSON.stringify(plan.items, null, 1)}
          </pre>
        )}

        {/* 写线上状态之前必须先把"将会发生什么"摆出来（官方是整体覆盖语义） */}
        <ConfirmDialog
          open={confirmPreview !== null}
          onClose={() => setConfirmPreview(null)}
          onConfirm={() => void handleConfirmSync()}
          title={t('blocks.commandPanel.syncConfirmTitle')}
          variant="danger"
        >
          <div className="space-y-1 text-xs text-zinc-300">
            <div>{t('blocks.commandPanel.syncConfirmBody', { count: plan.items.length })}</div>
            {confirmPreview?.map((p) => (
              <div key={p.summary} className="text-zinc-400">
                · {p.summary}
              </div>
            ))}
          </div>
        </ConfirmDialog>
      </div>
    </div>
  );
}
