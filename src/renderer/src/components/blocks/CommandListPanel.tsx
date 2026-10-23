// src/renderer/src/components/blocks/CommandListPanel.tsx
//
// 「指令清单」：只读表格，一屏看清所有指令（命令词 / 回复摘要 / 节点数 / 问题数 / 读的表）。
//
// 定位（见 docs/architecture/large-project-design.md 方案 A）：这是画布的**目录**，不是第二个编辑器。
// 表格里一个字都改不了，编辑永远回画布 —— 避免"同一文案两处可改"的双真相
// （设计原则 4：同一参数只出现在一个地方）。
//
// 同时承载"形状重复"提示（同文档 §七 决策 4）：形状是**目录的属性**（"这 7 条长得一样"），
// 不是错误，所以放在目录里而不是问题面板里；而且这里能直接复用 `getExecutionChains`，
// 不必把链切分逻辑再抄一份到共享层。
import { useMemo, useState } from 'react';
import {
  X,
  Search,
  ListChecks,
  AlertTriangle,
  Package,
  Copy,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Boxes,
} from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { buildCommandRows, filterCommandRows } from '../../lib/command/commandList';
import { findDuplicateShapes, mapShapesByTrigger } from '../../lib/canvas/chainShape';
import { applyFlattenPlan, planFlattenTemplates } from '../../lib/command/flattenTemplate';
import { planAutoGroups } from '../../lib/canvas/autoGroup';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { inputForm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function CommandListPanel({ onClose }: { onClose: () => void }) {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const nodeIssues = useFlowStore((s) => s.nodeIssues);
  const focusNodeId = useFlowStore((s) => s.focusNodeId);
  const setFocusNode = useFlowStore((s) => s.setFocusNode);
  const selectNode = useFlowStore((s) => s.selectNode);
  const replaceGraph = useFlowStore((s) => s.replaceGraph);
  const nodeGroups = useFlowStore((s) => s.nodeGroups);
  const addNodeGroups = useFlowStore((s) => s.addNodeGroups);
  const removeAllNodeGroups = useFlowStore((s) => s.removeAllNodeGroups);
  const toast = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [shapesOpen, setShapesOpen] = useState(false);
  const [flattenConfirmOpen, setFlattenConfirmOpen] = useState(false);
  const [autoGroupConfirmOpen, setAutoGroupConfirmOpen] = useState(false);

  const rows = useMemo(
    () => buildCommandRows(nodes, edges, nodeIssues),
    [nodes, edges, nodeIssues],
  );
  const visibleRows = useMemo(() => filterCommandRows(rows, searchQuery), [rows, searchQuery]);

  const shapeGroups = useMemo(() => findDuplicateShapes(nodes, edges), [nodes, edges]);
  const shapeByTrigger = useMemo(() => mapShapesByTrigger(shapeGroups), [shapeGroups]);
  const reusableCount = shapeGroups.reduce((sum, g) => sum + g.triggerIds.length, 0);

  const flattenPlan = useMemo(() => planFlattenTemplates(nodes, edges), [nodes, edges]);
  const flattenCount = flattenPlan.items.length;

  // 「按指令自动分组」的计划（纯函数，见 lib/canvas/autoGroup.ts）。
  // ⚠️ 分组**不可撤销**（不在撤销栈里），所以先把计划算出来给用户看，点了才落地。
  const autoGroupPlan = useMemo(
    () => planAutoGroups(nodes, edges, nodeGroups),
    [nodes, edges, nodeGroups],
  );
  const autoGroupCount = autoGroupPlan.groups.length;

  const commandCount = rows.filter((r) => !r.isSubflow).length;
  const issueTotal = rows.reduce((sum, r) => sum + r.issueCount, 0);

  /**
   * 折平：文案与数据线搬进下游「发消息」，删掉「文本模板」节点。
   *
   * 走 `replaceGraph`（单次历史）而不是逐个 `removeNode`：20 个节点逐个删会产生
   * 20 多条撤销记录，用户要按几十次 Ctrl+Z 才回到操作前。
   */
  const handleFlatten = () => {
    const plan = planFlattenTemplates(nodes, edges);
    const next = applyFlattenPlan(nodes, edges, plan);
    replaceGraph(next.nodes, next.edges);
    setFlattenConfirmOpen(false);
    toast.success(
      t('blocks.commandList.flattened', {
        count: plan.items.length,
        nodes: `${nodes.length} → ${next.nodes.length}`,
      }),
    );
  };

  /**
   * 按指令自动分组：**先看计划，再落地**。
   *
   * ⚠️ 分组**不在撤销栈里**（`pushHistory` 只快照 nodes/edges），
   * 所以这里不直接改图，而是打开确认弹窗把"将创建 N 个、跳过 M 条（附原因）"摊给用户看。
   * 用户点了才 `addNodeGroups`（一次 `set`，不闪屏）。
   */
  const handleAutoGroup = () => {
    const plan = planAutoGroups(nodes, edges, nodeGroups);
    addNodeGroups(plan.groups);
    setAutoGroupConfirmOpen(false);
    toast.success(t('blocks.commandList.autoGrouped', { count: plan.groups.length }));
  };

  /** 清除全部分组（只删分组框，不删节点）—— 自动分组之后的后悔药 */
  const handleClearGroups = () => {
    const count = nodeGroups.length;
    removeAllNodeGroups();
    toast.success(t('blocks.commandList.groupsCleared', { count }));
  };

  /** 点击一行：高亮 + 选中 + 画布平移聚焦（与大纲面板同一套跳转语义） */
  const handleJump = (nodeId: string) => {
    setFocusNode(nodeId);
    selectNode(nodeId);
    focusNode(nodeId);
  };

  return (
    <div className="w-[400px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-full">
      {/* 标题栏 */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center gap-2 shrink-0">
        <ListChecks className="w-4 h-4 text-zinc-400" aria-hidden="true" />
        <span className="text-sm text-zinc-200 font-medium">{t('blocks.commandList.title')}</span>
        <span className="text-xs text-zinc-500">
          {t('blocks.commandList.commandCount', { count: commandCount })}
          {issueTotal > 0 && (
            <span className="text-amber-400">
              {' '}
              · {t('blocks.commandList.issueCount', { count: issueTotal })}
            </span>
          )}
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

      {/* 搜索框 */}
      <div className="px-2 py-2 border-b border-zinc-800 shrink-0">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('blocks.commandList.searchPlaceholder')}
            aria-label={t('blocks.commandList.searchAria')}
            className={`w-full ${inputForm} pl-8 focus:outline-none focus:border-zinc-600`}
          />
        </div>
      </div>

      {/* 形状重复提示：只显示"达到阈值"的组，没有就不占地方 */}
      {shapeGroups.length > 0 && (
        <div className="border-b border-zinc-800 shrink-0">
          <Button
            variant="ghost"
            type="button"
            onClick={() => setShapesOpen((v) => !v)}
            aria-expanded={shapesOpen}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-sky-300 hover:bg-zinc-800/50 rounded-none"
            title={t('blocks.commandList.sameShapeTip')}
            leftIcon={
              shapesOpen ? (
                <ChevronDown aria-hidden="true" className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight aria-hidden="true" className="w-3 h-3 shrink-0" />
              )
            }
          >
            <Copy aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
            <span>{t('blocks.commandList.shapeGroups', { count: shapeGroups.length })}</span>
            <span className="text-zinc-500 font-normal">
              · {t('blocks.commandList.reusable', { count: reusableCount })}
            </span>
          </Button>
          {shapesOpen && (
            <div className="px-2 pb-2 space-y-1.5">
              {shapeGroups.map((group) => (
                <div
                  key={group.signature}
                  role="button"
                  tabIndex={0}
                  aria-label={t('blocks.commandList.jumpTo', { name: group.labels[0] })}
                  className="rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 cursor-pointer hover:border-zinc-700"
                  onClick={() => handleJump(group.triggerIds[0])}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleJump(group.triggerIds[0]);
                    }
                  }}
                  title={t('blocks.commandList.clickToJump', { name: group.labels[0] })}
                >
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-sky-300 tabular-nums shrink-0">
                      {t('blocks.commandList.lines', { count: group.triggerIds.length })}
                    </span>
                    <span className="text-zinc-400 truncate">{group.shapeText}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500 leading-relaxed">
                    {group.labels.join(' ')}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                {t('blocks.commandList.extractHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 文本模板折平：「发消息」自己就支持 {var1}~{var4}，多串一个「文本模板」是同一语义两处表达 */}
      {flattenCount > 0 && (
        <div
          className="px-2 py-1.5 border-b border-zinc-800 shrink-0 flex items-center gap-1.5 text-xs"
          title={
            flattenPlan.skipped.length > 0
              ? t('blocks.commandList.someTemplatesNotFlattened', {
                  count: flattenPlan.skipped.length,
                  names: flattenPlan.skipped.map((s) => `· ${s.reason}`).join('\n'),
                })
              : t('blocks.commandList.flattenTip')
          }
        >
          <CornerDownRight aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          <span className="flex-1 text-zinc-400">
            <span className="text-emerald-300"> {flattenCount}</span>{' '}
            {t('blocks.commandList.flattenable')}
            <span className="text-zinc-500">
              {' '}
              · {t('blocks.commandList.savesNodes', { count: flattenCount })}
            </span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            onClick={() => setFlattenConfirmOpen(true)}
            title={t('blocks.commandList.flatten')}
          >
            {t('common.collapse')}
          </Button>
        </div>
      )}

      {/* 按指令自动分组（D5 第 3 步「指令卡」）：把每条链包成一张可折叠的卡片，
          默认折叠 —— 20 条指令一屏看完，而不是 77 个节点平铺。
          ⚠️ 与折平不同，这个**不删节点**，只加分组框（非破坏性）。 */}
      {(autoGroupCount > 0 || nodeGroups.length > 0) && (
        <div
          className="px-2 py-1.5 border-b border-zinc-800 shrink-0 flex items-center gap-1.5 text-xs"
          title={
            autoGroupPlan.skipped.length > 0
              ? t('blocks.commandList.autoGroupSkipped', {
                  count: autoGroupPlan.skipped.length,
                  names: autoGroupPlan.skipped.map((s) => `· ${s.name}：${s.reason}`).join('\n'),
                })
              : t('blocks.commandList.autoGroupTip')
          }
        >
          <Boxes aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          <span className="flex-1 text-zinc-400">
            {autoGroupCount > 0 ? (
              <>
                <span className="text-sky-300"> {autoGroupCount}</span>{' '}
                {t('blocks.commandList.autoGroupable')}
              </>
            ) : (
              t('blocks.commandList.allGrouped', { count: nodeGroups.length })
            )}
          </span>
          {nodeGroups.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-500 hover:text-zinc-300"
              onClick={handleClearGroups}
              title={t('blocks.commandList.clearGroupsTip')}
            >
              {t('blocks.commandList.clearGroups')}
            </Button>
          )}
          {autoGroupCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              onClick={() => setAutoGroupConfirmOpen(true)}
              title={t('blocks.commandList.autoGroup')}
            >
              {t('blocks.commandList.autoGroupAction')}
            </Button>
          )}
        </div>
      )}

      {/* 表头 */}
      <div className="px-2 py-1 border-b border-zinc-800 flex items-center gap-2 text-[11px] text-zinc-500 shrink-0">
        <span className="w-24 shrink-0">{t('blocks.commandList.colCommand')}</span>
        <span className="flex-1">{t('blocks.commandList.colReply')}</span>
        <span className="w-8 shrink-0 text-right" title={t('blocks.commandList.colNodes')}>
          {t('editor.test.label.node')}
        </span>
        <span className="w-8 shrink-0 text-right" title={t('blocks.commandList.colIssues')}>
          {t('editor.tab.problems')}
        </span>
      </div>

      {/* 行 */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center text-sm text-zinc-500 py-8">
            {t('blocks.commandList.noTriggers')}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="text-center text-sm text-zinc-500 py-8">
            {t('blocks.commandList.noMatch')}
          </div>
        ) : (
          visibleRows.map((row) => {
            const isFocus = focusNodeId === row.triggerId;
            const shape = shapeByTrigger.get(row.triggerId);
            return (
              <div
                key={row.triggerId}
                role="button"
                tabIndex={0}
                aria-label={t('blocks.commandList.jumpTo', { name: row.triggerText })}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/50 ${
                  isFocus ? 'bg-purple-900/40' : ''
                }`}
                onClick={() => handleJump(row.triggerId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleJump(row.triggerId);
                  }
                }}
                title={`${row.triggerText}${row.reply ? ` → ${row.reply}` : ''}`}
              >
                <span
                  className={`w-24 shrink-0 truncate font-mono text-xs ${
                    row.command ? 'text-blue-300' : 'text-zinc-400'
                  }`}
                >
                  {row.isSubflow && <span title={t('blocks.commandList.subflowDefs')}>📐 </span>}
                  {row.triggerText}
                </span>
                {shape && (
                  <span
                    className="shrink-0 text-[10px] text-sky-400/80 tabular-nums"
                    title={t('blocks.commandList.sameShape', {
                      count: shape.triggerIds.length - 1,
                      names: shape.labels.filter((l) => l !== row.triggerText).join(' '),
                    })}
                  >
                    ⧉{shape.triggerIds.length}
                  </span>
                )}
                <span className="flex-1 truncate text-xs text-zinc-400">
                  {row.reply ?? (
                    <span className="text-zinc-600">{t('blocks.commandList.noText')}</span>
                  )}
                </span>
                {row.configTables.length > 0 && (
                  <span
                    className="shrink-0 text-amber-400/80"
                    title={t('blocks.commandList.readsTable', {
                      table: row.configTables.join(', '),
                    })}
                  >
                    <Package className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                )}
                <span className="w-8 shrink-0 text-right text-xs text-zinc-500 tabular-nums">
                  {row.nodeCount}
                </span>
                <span className="w-8 shrink-0 flex justify-end">
                  {row.issueCount > 0 ? (
                    <span
                      className="flex items-center gap-0.5 text-xs text-amber-400 tabular-nums"
                      title={t('blocks.commandList.issueCount', { count: row.issueCount })}
                    >
                      <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                      {row.issueCount}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-700">—</span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 只读说明：明确"这里是目录，改不了" */}
      <div className="px-3 py-2 border-t border-zinc-800 text-[11px] text-zinc-600 shrink-0">
        {t('blocks.commandList.readOnlyHint')}
      </div>

      <ConfirmDialog
        open={flattenConfirmOpen}
        onClose={() => setFlattenConfirmOpen(false)}
        onConfirm={handleFlatten}
        title={t('blocks.commandList.flattenTitle')}
        message={t('blocks.commandList.flattenConfirm', {
          count: flattenCount,
          nodes: `${nodes.length} → ${nodes.length - flattenCount}`,
        })}
        confirmText={t('blocks.commandList.collapseNodes', { count: flattenCount })}
        variant="danger"
        warning
      />

      <ConfirmDialog
        open={autoGroupConfirmOpen}
        onClose={() => setAutoGroupConfirmOpen(false)}
        onConfirm={handleAutoGroup}
        title={t('blocks.commandList.autoGroupTitle')}
        message={t('blocks.commandList.autoGroupConfirm', {
          count: autoGroupCount,
          skipped: autoGroupPlan.skipped.length,
        })}
        confirmText={t('blocks.commandList.autoGroupAction')}
        warning
      />
    </div>
  );
}
