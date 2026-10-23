// src/renderer/src/components/ai/ProposalCard.tsx
import { useState, useEffect } from 'react';
import { hasBlockingIssue, type Proposal, type ProposalOperation } from '@shared/types/proposal';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { useProjectStore } from '../../stores/projectStore';
import { useFrameworkDevStore } from '../../stores/frameworkDevStore';
import { securityCriticalEntryFor } from '@shared/files/securityCriticalPaths';
import { lineDiff } from './fileDiff';

/** 校验块最多列几条问题（列满一屏等于没列 —— 用户会直接跳过） */
const MAX_LISTED_ISSUES = 5;

interface Props {
  proposal: Proposal;
  onApply: (selectedOps: ProposalOperation[]) => void;
  onReject: () => void;
}

const RISK_LABEL: Record<Proposal['riskLevel'], string> = {
  get low() {
    return t('ai.proposal.riskLow');
  },
  get medium() {
    return t('ai.proposal.riskMedium');
  },
  get high() {
    return t('ai.proposal.riskHigh');
  },
};
const RISK_COLOR: Record<Proposal['riskLevel'], string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

/** 预览框里最多列几行改动（列满一屏等于没列） */
const MAX_PREVIEW_LINES = 60;

/**
 * **「它到底写了什么」**（2026-10-15，用户原话：「他不像其他的智能体，生成代码不知道怎么回事」）。
 *
 * 别的编码智能体（Cursor / Claude Code）会把改动摊在对话里；我们这边原来只有一行
 * 「写文件 plugins/x/index.js」—— 写了什么、覆盖了什么，全靠模型自己说。
 *
 * 这里只列**改动行**（新增/删除），不列上下文：对不懂编程的用户，「改了这 3 行」
 * 比「整份文件带上下文」可读得多；新建文件时，新增行本身就是内容。
 *
 * 原文件内容**展开时才读**（不给每条提案都打一次文件 IPC）。
 */
function FileChangePreview({ filePath, content }: { filePath: string; content: string }) {
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const [open, setOpen] = useState(false);
  /** undefined = 还没读；null = 读不到/不存在；string = 原文件内容 */
  const [existing, setExisting] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!open || existing !== undefined || !projectPath) return;
    let alive = true;
    void (async () => {
      try {
        const res = await window.qqbat.file.read(projectPath, filePath);
        if (alive) setExisting(res.ok ? (res.data ?? '') : null);
      } catch {
        if (alive) setExisting(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, existing, projectPath, filePath]);

  const isNew = existing === null;
  const diff = typeof existing === 'string' ? lineDiff(existing, content) : null;
  const contentLines = content ? content.replace(/\r\n?/g, '\n').split('\n') : [];
  const changed = diff ? diff.lines.filter((l) => l.type !== 'same') : [];
  const shownChanged = changed.slice(0, MAX_PREVIEW_LINES);
  const shownNew = contentLines.slice(0, MAX_PREVIEW_LINES);
  const hiddenCount = diff
    ? Math.max(0, changed.length - MAX_PREVIEW_LINES)
    : isNew
      ? Math.max(0, contentLines.length - MAX_PREVIEW_LINES)
      : 0;

  return (
    <div className="ml-6 mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-blue-400 underline decoration-dotted hover:text-blue-300"
      >
        {t(open ? 'ai.proposal.file.collapse' : 'ai.proposal.file.expand')}
        {diff && (
          <span className="ml-2 text-zinc-500">
            {diff.added === 0 && diff.removed === 0
              ? t('ai.proposal.file.noChange')
              : t('ai.proposal.file.changed', {
                  added: String(diff.added),
                  removed: String(diff.removed),
                })}
          </span>
        )}
        {isNew && (
          <span className="ml-2 text-zinc-500">
            {t('ai.proposal.file.newFile', { lines: String(contentLines.length) })}
          </span>
        )}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] leading-5">
          {(diff ? shownChanged : isNew ? shownNew : []).map((line, i) => {
            const isStr = typeof line === 'string';
            const text = isStr ? line : line.text;
            const kind = isStr ? 'add' : line.type;
            const color =
              kind === 'add' ? 'text-green-400' : kind === 'del' ? 'text-red-400' : 'text-zinc-400';
            const sign = kind === 'add' ? '+' : kind === 'del' ? '-' : ' ';
            return (
              <div key={i} className={color}>
                {sign + ' ' + text}
              </div>
            );
          })}
          {!diff && !isNew && (
            <span className="text-zinc-500">{t('ai.proposal.file.loading')}</span>
          )}
          {hiddenCount > 0 && (
            <div className="mt-1 text-zinc-500">
              {t('ai.proposal.file.truncated', { shown: String(MAX_PREVIEW_LINES) })}
            </div>
          )}
        </pre>
      )}
    </div>
  );
}

function opLabel(op: ProposalOperation): string {
  switch (op.kind) {
    case 'add_node':
      return t('ai.proposal.op.addNode', {
        label: op.label || op.nodeKind,
        kind: op.nodeKind,
      });
    case 'connect':
      return t('ai.proposal.op.connect', {
        source: `${op.sourceRef}.${op.sourcePortId}`,
        target: `${op.targetRef}.${op.targetPortId}`,
      });
    case 'update_config':
      return t('ai.proposal.op.updateConfig', { node: op.nodeRef });
    case 'delete_node':
      return t('ai.proposal.op.deleteNode', { node: op.nodeRef });
    case 'write_code':
      return t('ai.proposal.op.writeCode', { file: op.filePath });
    case 'generate_code':
      return t('ai.proposal.op.generateCode');
    case 'apply_template':
      return t('ai.proposal.op.applyTemplate', { id: op.templateId });
    case 'new_command':
      return t('ai.proposal.op.newCommand', { command: op.command });
    case 'new_lookup':
      return t('ai.proposal.op.newLookup', { command: op.command, table: op.table });
    case 'capability':
      // 有 impact（影响面说明）时用另一条文案：用户要能一眼看出这次调用的后果
      return op.impact
        ? t('ai.proposal.op.capabilityWithImpact', { id: op.capabilityId })
        : t('ai.proposal.op.capability', { id: op.capabilityId });
  }
  // 穷尽性：将来新增 operation kind 却没在这里给文案 → **编译报错**，
  // 而不是界面上显示一行 undefined（这正是加这两条 kind 时编译器替我们发现的事）。
  const exhaustive: never = op;
  return String(exhaustive);
}

/**
 * 结构校验结果块。
 *
 * 对不懂编程的机器人作者，**这是提案上唯一看得懂的判据** ——
 * 「风险：中」他判断不了，"这 2 处连线会断"他能判断。
 *
 * 没有 `validation`（老提案 / 拿不到图 / 校验失败）时**什么都不显示** ——
 * 校验是增益不是关卡，不能因为多了个功能就让所有老路径看起来像出了问题。
 */
function ValidationBlock({ proposal }: { proposal: Proposal }) {
  const v = proposal.validation;
  if (!v) return null;

  const errors = v.introduced.filter((i) => i.severity === 'error');
  const warnings = v.introduced.filter((i) => i.severity !== 'error');

  if (errors.length > 0) {
    return (
      <div className="mb-2 rounded border border-red-800 bg-red-950/40 px-2 py-1.5">
        <div className="text-xs font-medium text-red-300">
          {t('ai.proposal.validation.errors', { count: String(errors.length) })}
        </div>
        <ul className="mt-1 space-y-0.5">
          {errors.slice(0, MAX_LISTED_ISSUES).map((i, k) => (
            <li key={k} className="text-xs text-red-200/90">
              · {i.message}
            </li>
          ))}
        </ul>
        {errors.length > MAX_LISTED_ISSUES && (
          <div className="mt-0.5 text-xs text-red-300/70">
            {t('ai.proposal.validation.more', {
              count: String(errors.length - MAX_LISTED_ISSUES),
            })}
          </div>
        )}
      </div>
    );
  }

  if (warnings.length > 0) {
    return (
      <div className="mb-2 rounded border border-amber-800 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-300">
        {t('ai.proposal.validation.warnings', { count: String(warnings.length) })}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded border border-green-900 bg-green-950/30 px-2 py-1.5 text-xs text-green-400">
      {t('ai.proposal.validation.passed')}
      {v.preexisting > 0 && (
        <span className="ml-1 text-zinc-500">
          {t('ai.proposal.validation.preexisting', { count: String(v.preexisting) })}
        </span>
      )}
    </div>
  );
}

/**
 * 验证者结论块（评审文档 §三·补 M4）。
 *
 * 与上面「结构校验」的分工：那块回答"图有没有被改坏"，这块回答"**计划本身合不合理**"
 * （例如同一个片段套了两遍 → 两条重复的链）。v1 是静态验证（不调模型），所以文案里写明"静态"，
 * 不让用户以为背后有个模型复核过。
 */
function VerdictBlock({ proposal }: { proposal: Proposal }) {
  const verdict = proposal.verdict;
  if (!verdict) return null;

  const errors = verdict.issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) {
    return (
      <div className="mb-2 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-400">
        {t('ai.proposal.verdict.passed')}
      </div>
    );
  }
  return (
    <div className="mb-2 rounded border border-red-800 bg-red-950/40 px-2 py-1.5">
      <div className="text-xs font-medium text-red-300">
        {t('ai.proposal.verdict.planIssues', { count: String(errors.length) })}
      </div>
      <ul className="mt-1 space-y-0.5">
        {errors.slice(0, MAX_LISTED_ISSUES).map((i, k) => (
          <li key={k} className="text-xs text-red-200/90">
            · {i.what}
            {i.howToFix ? <span className="text-red-300/70"> —— {i.howToFix}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProposalCard({ proposal, onApply, onReject }: Props) {
  useLocaleSubscription();
  const [selected, setSelected] = useState<Set<number>>(
    new Set(proposal.operations.map((_, i) => i)),
  );
  /**
   * **护栏可见性**（2026-10-16）：这条提案里有没有"改护栏自己"的文件？
   *
   * 必须在**用户点「应用」之前**就标出来（事后翻日志太晚）。
   *
   * ⚠️ 只在**框架工作区**里判：机器人项目里恰好也有个 `src/main/ipc/file.ts` 的话，
   * 那不是我们的护栏 —— 误报会把警告变成噪音，用户就再也不看了。
   * （主进程写入路径用的是同一个判据：目标在框架根内 + 命中清单。）
   */
  const inWorkspace = useFrameworkDevStore((s) => s.inWorkspace);
  const criticalOps = new Map<number, { path: string; why: string }>();
  if (inWorkspace) {
    proposal.operations.forEach((op, i) => {
      // 只有"写文件"这类操作才有目标文件；图编辑操作不涉及护栏
      if (op.kind !== 'write_code') return;
      const hit = securityCriticalEntryFor(op.filePath);
      if (hit) criticalOps.set(i, { path: op.filePath, why: hit.why });
    });
  }
  /**
   * 用户是否已经"明知有问题还是要应用"。
   *
   * fail-closed：引入 error 级问题时，应用按钮**默认不可点** ——
   * 但**不是禁用到底**（用户可能有正当理由，禁用只会逼他去别处绕）。
   * 显式点一次「我知道有问题，仍然应用」才放行。
   */
  const [overrideAck, setOverrideAck] = useState(false);

  /**
   * **按子代理 lane 筛选**（多智能体可见性）：只有并行 lane 产出的操作才带 lane。
   * 点一次筛选、再点一次取消；标签直接用 lane id（L1/L2），不需要翻译键。
   */
  const laneIds = Array.from(
    new Set(proposal.operations.map((o) => o.lane).filter((l): l is string => Boolean(l))),
  );
  const [laneFilter, setLaneFilter] = useState<string | null>(null);

  // 结构问题 **或** 验证者发现计划问题 → 都要显式二次确认（fail-closed，但不是禁用到底）
  const blocking = hasBlockingIssue(proposal.validation) || proposal.verdict?.ok === false;

  // proposal.id 变化时重置 selected 为全选
  useEffect(() => {
    setSelected(new Set(proposal.operations.map((_, i) => i)));
    setOverrideAck(false);
  }, [proposal.id, proposal.operations]);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(proposal.operations.map((_, i) => i)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const apply = () => {
    onApply(proposal.operations.filter((_, i) => selected.has(i)));
  };

  return (
    <div className="border rounded-lg p-3 my-2 bg-zinc-900 border-zinc-700">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium text-zinc-200">{proposal.summary}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${RISK_COLOR[proposal.riskLevel]}`}>
          {RISK_LABEL[proposal.riskLevel]}
        </span>
      </div>
      {/*
        本次运行摘要 + 子代理回报（零新 IPC：数据由主进程随提案一起给）。
        折叠起来：默认只看提案，想复盘再展开。文案全部来自主进程数据，渲染层不拼中文。
      */}
      {(proposal.runSummary || proposal.lanes) && (
        <details className="mb-2 rounded border border-zinc-700 bg-zinc-800/40 px-2.5 py-2 text-xs text-zinc-300">
          <summary className="cursor-pointer text-zinc-400">{proposal.runSummary ?? '…'}</summary>
          {proposal.lanes && (
            <pre className="mt-1 whitespace-pre-wrap font-sans text-zinc-300">{proposal.lanes}</pre>
          )}
        </details>
      )}
      <ValidationBlock proposal={proposal} />
      <VerdictBlock proposal={proposal} />
      {/* 改到护栏自己：整卡一条醒目提醒（点应用之前就看得到） */}
      {criticalOps.size > 0 && (
        <div className="mb-2 rounded border border-red-600 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">
          <div className="font-semibold">{t('ai.proposal.securityCriticalTitle')}</div>
          <ul className="mt-1 space-y-0.5">
            {[...criticalOps.values()].map((c) => (
              <li key={c.path}>
                · {t('ai.proposal.securityCriticalItem', { file: c.path, why: c.why })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {laneIds.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {laneIds.map((lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => setLaneFilter((cur) => (cur === lane ? null : lane))}
              className={
                'rounded px-1.5 py-0.5 text-[11px] ' +
                (laneFilter === lane
                  ? 'bg-zinc-200 text-zinc-900'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600')
              }
            >
              {lane}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1 mb-3">
        {proposal.operations
          .map((op, i) => ({ op, i }))
          .filter(({ op }) => !laneFilter || op.lane === laneFilter)
          .map(({ op, i }) => (
            <div key={i}>
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                <span>{opLabel(op)}</span>
                {op.lane && (
                  <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300">
                    {op.lane}
                  </span>
                )}
              </label>
              {criticalOps.has(i) && (
                <span
                  className="ml-6 inline-block rounded bg-red-500/20 px-1.5 py-0.5 text-[11px] text-red-300"
                  title={criticalOps.get(i)?.why}
                >
                  🛡 {t('ai.proposal.securityCriticalBadge')}
                </span>
              )}
              {/* 写了什么：只在写磁盘的操作上显示（图编辑不需要） */}
              {op.kind === 'write_code' && (
                <FileChangePreview filePath={op.filePath} content={op.content} />
              )}
            </div>
          ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={selectAll}
          className="px-3 py-1 bg-zinc-100 rounded text-sm"
        >
          {t('ai.proposal.approveAll')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={selectNone}
          className="px-3 py-1 bg-zinc-100 rounded text-sm"
        >
          {t('ai.proposal.rejectAll')}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={apply}
          disabled={selected.size === 0 || (blocking && !overrideAck)}
        >
          {t('ai.proposal.applyAll')}
        </Button>
        {blocking && !overrideAck && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOverrideAck(true)}
            className="px-3 py-1 bg-red-900/40 border border-red-800 rounded text-sm text-red-200"
          >
            {t('ai.proposal.validation.override')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={onReject}
          className="px-3 py-1 bg-zinc-200 rounded text-sm"
        >
          {t('ai.proposal.reject')}
        </Button>
      </div>
    </div>
  );
}
