// src/renderer/src/components/blocks/FlowIssuesButton.tsx
//
// 运行前问题清单 —— 编辑器工具栏上的指示器。
//
// 目的：把"跑起来才知道错"变成"画的时候就看见"。问题来自主进程的统一真相层
// （`flow:validate` → normalizeFlow + validateFlow），因此与运行时、代码生成
// 用的是同一套判定，不会出现"编辑器说没问题、跑起来报错"。
//
// 交互：图变化后防抖 600ms 自动校验；点开列表可跳转到对应节点；
// 同时把问题按节点写进 `flowStore.nodeIssues`，画布上的节点会显示琥珀色 ⚠ 标记
// （否则用户不点开这个下拉就看不到任何变化）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import { useProjectStore } from '../../stores/projectStore';
import { groupIssuesByNode } from '../../lib/canvas/flowValidation';
import { splitIssuesByBaseline } from '@shared/nodes/issueBaseline';
import type { FlowIssue } from '@shared/nodes/flowNormalize';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface ValidateResponse {
  issues: FlowIssue[];
  normalizedNodes: number;
}

/**
 * 规则码 → 说人话的名字 + 一句"怎么办"。
 *
 * 为什么需要：一个 246 节点的老项目会一次性报出上百条问题（存量债），
 * 平铺成一张长列表对小白等于"一堵墙"。按规则分组、每组说清"这是什么、要不要管"，
 * 才是能读的东西（原则 10：术语与界面文案说人话）。
 * 未知规则码就照实显示原始 code —— 不藏。
 */
const ISSUE_RULE_LABELS: Record<string, { label: string; hint: string }> = {
  'unreachable-node': {
    get label() {
      return t('blocks.issues.unreachable');
    },
    get hint() {
      return t('blocks.issues.unreachableDesc');
    },
  },
  CONN_MISSING_REQUIRED_INPUT: {
    get label() {
      return t('blocks.issues.requiredPort');
    },
    get hint() {
      return t('blocks.issues.requiredPortDesc');
    },
  },
  CONN_ISOLATED_NODE: {
    get label() {
      return t('blocks.issues.isolated');
    },
    get hint() {
      return t('blocks.issues.isolatedDesc');
    },
  },
  'unknown-node-kind': {
    get label() {
      return t('blocks.issues.unknownKind');
    },
    get hint() {
      return t('blocks.issues.unknownKindDesc');
    },
  },
  'missing-required-config': {
    get label() {
      return t('blocks.issues.missingConfig');
    },
    get hint() {
      return t('blocks.issues.missingConfigDesc');
    },
  },
  'edge-invalid-source-port': {
    get label() {
      return t('blocks.issues.sourcePortMissing');
    },
    get hint() {
      return t('blocks.issues.sourcePortMissingDesc');
    },
  },
  'edge-invalid-target-port': {
    get label() {
      return t('blocks.issues.targetPortMissing');
    },
    get hint() {
      return t('blocks.issues.sourcePortMissingDesc');
    },
  },
  'duplicate-node-id': {
    get label() {
      return t('blocks.issues.duplicateNodeId');
    },
    get hint() {
      return t('blocks.issues.duplicateNodeIdDesc');
    },
  },
  'duplicate-edge-id': {
    get label() {
      return t('blocks.issues.duplicateEdgeId');
    },
    get hint() {
      return t('blocks.issues.duplicateEdgeIdDesc');
    },
  },
};

export interface IssueGroup {
  code: string;
  label: string;
  hint: string;
  severity: FlowIssue['severity'];
  count: number;
  items: FlowIssue[];
}

/** 把问题按规则码分组：错误在前、同档按数量从多到少 */
export function groupIssuesByRule(issues: FlowIssue[]): IssueGroup[] {
  const byCode = new Map<string, FlowIssue[]>();
  for (const issue of issues) {
    const list = byCode.get(issue.code);
    if (list) list.push(issue);
    else byCode.set(issue.code, [issue]);
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  return [...byCode.entries()]
    .map(([code, items]) => ({
      code,
      label: ISSUE_RULE_LABELS[code]?.label ?? code,
      hint: ISSUE_RULE_LABELS[code]?.hint ?? '',
      severity: items.some((i) => i.severity === 'error') ? 'error' : items[0].severity,
      count: items.length,
      items,
    }))
    .sort(
      (a, b) =>
        order[a.severity] - order[b.severity] || b.count - a.count || a.code.localeCompare(b.code),
    );
}

/** 一组里最多渲染多少条明细（其余的用一句"还有 N 条"如实带过） */
const MAX_ITEMS_PER_GROUP = 50;

export function FlowIssuesButton() {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const projectPath = useProjectStore((s) => s.currentProject?.path);

  const [issues, setIssues] = useState<FlowIssue[]>([]);
  const [normalizedNodes, setNormalizedNodes] = useState(0);
  // 面板开关放在 store 里：画布右下角的角标点一下也能把它打开（同一份数据、同一个入口）
  const open = useFlowStore((s) => s.issuesPanelOpen);
  const setOpen = useFlowStore((s) => s.setIssuesPanelOpen);
  /** 已展开的规则分组（默认全部收起：先看"都是些什么"，再决定看哪一组） */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runValidate = useCallback(async () => {
    if (!projectPath || nodes.length === 0) {
      setIssues([]);
      setNormalizedNodes(0);
      useFlowStore.getState().setNodeIssues({});
      useFlowStore.getState().setIssues([]);
      return;
    }
    try {
      // 用 exportGraph 取当前图（含未保存改动），与预览/保存走同一条路径
      const graph = useFlowStore.getState().exportGraph();
      const res = await window.qqbat.flow.validate(projectPath, graph);
      if (!res?.ok || !res.data) return;
      const data = res.data as ValidateResponse;
      const nextIssues = data.issues ?? [];
      setIssues(nextIssues);
      setNormalizedNodes(data.normalizedNodes ?? 0);
      // 把问题按节点归集后写进 store：画布节点会显示 ⚠ 标记，
      // 用户不用打开这个下拉也能看到"哪个节点有问题"
      useFlowStore.getState().setNodeIssues(groupIssuesByNode(nextIssues));
      // 同时存完整清单：画布右下角的摘要读它，保证与这里的数字完全一致
      useFlowStore.getState().setIssues(nextIssues);
      // 打开项目后的**第一次**校验结果记为基线：这些是"你打开时就有的"历史问题。
      // 之后新出现的才算新问题（见 @shared/nodes/issueBaseline.ts）。
      useFlowStore.getState().captureIssueBaseline(projectPath);
    } catch {
      /* 校验失败不打扰用户 */
    }
  }, [projectPath, nodes.length]);

  // 图变化 → 防抖校验（连续拖拽/输入不会打满主进程）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void runValidate();
    }, 600);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, runValidate]);

  /** 默认只看"新问题"：画布/面板不该在老项目的存量债上大喊大叫（可一键切到全部） */
  const [showAll, setShowAll] = useState(false);
  const issueBaseline = useFlowStore((s) => s.issueBaseline);
  const { newIssues, legacyIssues } = useMemo(
    () => splitIssuesByBaseline(issues, issueBaseline),
    [issues, issueBaseline],
  );
  const visibleIssues = showAll ? issues : newIssues;

  const errors = visibleIssues.filter((i) => i.severity === 'error');
  const warnings = visibleIssues.filter((i) => i.severity === 'warning');
  const infos = visibleIssues.filter((i) => i.severity === 'info');
  const newErrors = newIssues.filter((i) => i.severity === 'error').length;
  const hasNewIssues = newIssues.length > 0;
  const hasError = errors.length > 0;
  const groups = groupIssuesByRule(visibleIssues);

  const toggleGroup = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const label =
    issues.length === 0
      ? t('blocks.issues.none')
      : hasNewIssues
        ? newErrors > 0
          ? t('blocks.issues.newCountWithErrors', {
              count: newIssues.length,
              errors: newErrors,
            })
          : t('blocks.issues.newCount', { count: newIssues.length })
        : t('blocks.editor.historyIssues', { count: issues.length });

  const goToNode = (nodeId?: string) => {
    if (!nodeId) return;
    useFlowStore.getState().selectNode(nodeId);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          // 没问题时也允许点开：重新校验一次并说明"检查了什么"，
          // 否则这个按钮在健康流程上是个点不动的灰色胶囊，用户根本注意不到。
          if (!open) void runValidate();
          setOpen(!open);
        }}
        title={
          issues.length === 0
            ? t('blocks.issues.openTitle')
            : hasNewIssues
              ? t('blocks.issues.openNewTitle')
              : t('blocks.issues.openHistoryTitle')
        }
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors ${
          issues.length === 0
            ? 'bg-zinc-800/50 border-zinc-700/60 text-zinc-500 hover:text-zinc-300'
            : hasError
              ? 'bg-red-900/20 border-red-700/60 text-red-300 hover:bg-red-900/30'
              : hasNewIssues
                ? 'bg-amber-900/20 border-amber-700/60 text-amber-300 hover:bg-amber-900/30'
                : 'bg-zinc-800/50 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        {issues.length === 0 ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : hasError ? (
          <CircleAlert className="w-3.5 h-3.5" />
        ) : hasNewIssues ? (
          <AlertTriangle className="w-3.5 h-3.5" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5" />
        )}
        {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-96 max-h-80 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {normalizedNodes > 0 && (
            <div className="px-3 py-2 text-xs text-amber-300/80 border-b border-zinc-800">
              {t('blocks.issues.normalized', { count: normalizedNodes })}
            </div>
          )}
          {issues.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-400 leading-relaxed">
              {t('blocks.issues.allClear')}
              <span className="block text-zinc-500 mt-1">{t('blocks.issues.canvasHint')}</span>
            </div>
          ) : (
            <div>
              <div className="px-3 py-2 text-xs text-zinc-400 border-b border-zinc-800">
                {hasNewIssues
                  ? newErrors > 0
                    ? t('blocks.issues.summaryNewWithErrors', {
                        count: newIssues.length,
                        errors: newErrors,
                        history: legacyIssues.length,
                      })
                    : t('blocks.issues.summaryNew', {
                        count: newIssues.length,
                        history: legacyIssues.length,
                      })
                  : t('blocks.issues.summaryNoNew', { history: legacyIssues.length })}
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="ml-2 underline text-zinc-300 hover:text-white"
                >
                  {showAll
                    ? t('blocks.issues.onlyNew')
                    : t('blocks.issues.showAll', { count: issues.length })}
                </button>
                <span className="block text-zinc-500 mt-0.5">
                  {t('blocks.issues.visible', {
                    visible: visibleIssues.length,
                    errors: errors.length,
                    warnings: warnings.length,
                  })}
                  {infos.length > 0
                    ? ` · ${t('blocks.issues.tipCount', { count: infos.length })}`
                    : ''}
                </span>
              </div>
              {visibleIssues.length === 0 && (
                <div className="px-3 py-2 text-xs text-zinc-400 leading-relaxed">
                  {t('blocks.issues.noNewNow')}
                  <span className="block text-zinc-500 mt-1">
                    {t('blocks.issues.legacyNote', { count: legacyIssues.length })}
                  </span>
                </div>
              )}
              {groups.map((group) => {
                const isOpen = expanded.has(group.code);
                const tone =
                  group.severity === 'error'
                    ? 'text-red-400'
                    : group.severity === 'warning'
                      ? 'text-amber-400'
                      : 'text-zinc-400';
                return (
                  <div key={group.code} className="border-b border-zinc-800 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.code)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-800/60"
                    >
                      <span className="flex items-start gap-1.5">
                        <span className={`${tone} shrink-0`}>
                          {group.severity === 'error'
                            ? t('editor.filter.error')
                            : group.severity === 'warning'
                              ? t('blocks.issues.badgeWarn')
                              : t('blocks.issues.badgeTip')}
                        </span>
                        <span className="text-zinc-200 flex-1">
                          {group.label}
                          <span className="text-zinc-500"> × {group.count}</span>
                          {group.hint && (
                            <span className="block text-zinc-500 mt-0.5">{group.hint}</span>
                          )}
                        </span>
                        <span className="text-zinc-500 shrink-0">
                          {isOpen ? t('blocks.issues.collapse') : t('common.expand')}
                        </span>
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="pb-1">
                        {group.items.slice(0, MAX_ITEMS_PER_GROUP).map((issue, idx) => (
                          <li key={idx}>
                            <button
                              type="button"
                              onClick={() => goToNode(issue.nodeId)}
                              disabled={!issue.nodeId}
                              className={`w-full text-left pl-6 pr-3 py-1.5 text-xs text-zinc-300 ${
                                issue.nodeId
                                  ? 'hover:bg-zinc-800/60 cursor-pointer'
                                  : 'cursor-default'
                              }`}
                              title={issue.nodeId ? t('blocks.issues.jumpToNode') : undefined}
                            >
                              {issue.message}
                            </button>
                          </li>
                        ))}
                        {group.items.length > MAX_ITEMS_PER_GROUP && (
                          <li className="pl-6 pr-3 py-1 text-[11px] text-zinc-500">
                            {t('blocks.issues.moreNotListed', {
                              count: group.items.length - MAX_ITEMS_PER_GROUP,
                            })}
                          </li>
                        )}
                        {/* 无入口节点=永远不会执行的死代码，给一个可撤销的清理入口 */}
                        {group.code === 'unreachable-node' && (
                          <li className="pl-6 pr-3 py-2">
                            <button
                              type="button"
                              onClick={() => {
                                const removed = useFlowStore.getState().deleteUnreachableNodes();
                                if (removed > 0) void runValidate();
                              }}
                              className="px-2 py-1 rounded border border-red-700/60 bg-red-900/20 text-[11px] text-red-300 hover:bg-red-900/40"
                            >
                              {t('blocks.issues.deleteThese', { count: group.count })}
                            </button>
                            <span className="block text-[11px] text-zinc-500 mt-1">
                              {t('blocks.issues.unreachableBulkHint')}
                            </span>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
