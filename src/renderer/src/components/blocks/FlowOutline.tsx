// src/renderer/src/components/blocks/FlowOutline.tsx
import { useState, useMemo } from 'react';
import { X, ChevronRight, ChevronDown, ListTree, Search, AlertTriangle } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import {
  getExecutionChains,
  isSubflowDefine,
  type ExecutionChain,
} from '../../lib/canvas/executionOrder';
import { nodeDisplayLabel } from '../../lib/node/nodeCatalog';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { getNodeIcon } from './iconMap';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { inputForm } from '../ui/inputStyles';
import type { FlowNode, SystemGroup } from '@shared/types/flow';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/**
 * 生成节点简短摘要（用于大纲展示，<=20 字符）。
 * 参考 BlockView.tsx 中的 formatSummary，但更精简。
 */
function getNodeSummary(node: FlowNode): string {
  const cfg = node.data.config;
  switch (node.data.nodeKind) {
    // 触发器
    case 'message_received': {
      const match = cfg.match ?? 'any';
      if (match === 'command') return `/${cfg.command ?? ''}`;
      if (match === 'at_me') return t('canvas.summary.atMe');
      if (match === 'regex')
        return cfg.pattern ? `/${cfg.pattern}/` : t('canvas.summary.notConfigured');
      return `${match}`;
    }
    case 'request_received':
      return t('canvas.summary.requestEvent');
    case 'notice_received':
      return t('canvas.summary.noticeEvent');
    case 'button_clicked':
      return cfg.button_data
        ? t('blocks.outline.buttonLabel', { label: String(cfg.button_data) })
        : t('canvas.summary.anyButton');
    case 'scheduled':
      return `${cfg.cron ?? cfg.interval_seconds + 's'}`;

    // 动作
    case 'message_send': {
      const m = cfg.mode ?? 'text';
      if (m === 'keyboard') return `UI: "${String(cfg.markdown || '').slice(0, 12)}"`;
      if (m === 'segment') return t('field.label.segments');
      if (m === 'forward') return t('blocks.outline.forward');
      return `"${String(cfg.text || cfg.message || '').slice(0, 15)}"`;
    }
    case 'message_recall':
      return t('canvas.summary.recallMessage');
    case 'message_edit':
      return `"${String(cfg.new_text || '').slice(0, 15)}"`;

    // 逻辑
    case 'branch_if':
      return String(cfg.expression || t('canvas.summary.condition')).slice(0, 20);
    case 'delay':
      return `${cfg.seconds}s`;
    case 'variable_set':
      return `${cfg.var_name ?? ''} = ?`;
    case 'loop': {
      const mode = cfg.mode ?? 'times';
      if (mode === 'iterate') return t('canvas.summary.iterate');
      if (mode === 'while') return t('blocks.outline.conditionLoop');
      return t('blocks.outline.times', { count: Number(cfg.count ?? 0) });
    }
    case 'try_catch':
      return t('canvas.summary.tryCatch');
    case 'wait_input':
      return `${t('blocks.outline.waitForReply')} ${cfg.timeout ?? 60}s`;

    // 数学/表达式
    case 'expression_eval': {
      if (cfg.mode === 'formulas') return t('blocks.outline.multiFormula');
      return `"${String(cfg.expression || '').slice(0, 15)}"`;
    }
    case 'random':
      return cfg.mode === 'int'
        ? `[${cfg.min}, ${cfg.max}]`
        : cfg.mode === 'weighted'
          ? t('blocks.outline.weight')
          : t('blocks.outline.random');

    // 文本
    case 'format_text':
      return `"${String(cfg.template || '').slice(0, 15)}"`;
    // 列表（list_op 已拆成 4 个；老 kind 保留是因为老图可能还没迁移）
    case 'list_op':
    case 'list_edit':
    case 'list_query':
    case 'list_transform':
    case 'list_combine':
      return `${cfg.mode ?? ''}`;

    // 持久化（variable_persist 已拆成 7 个；老 kind 保留）
    case 'variable_persist':
    case 'load_variable':
    case 'save_variable':
    case 'incr_variable':
    case 'update_if_variable':
    case 'append_variable':
    case 'delete_variable':
    case 'exists_variable':
      return [cfg.mode ? String(cfg.mode) : '', String(cfg.key ?? '')].filter(Boolean).join(' · ');

    // 时间（time_op 已拆成 3 个；老 kind 保留）
    case 'time_op':
    case 'time_read':
    case 'time_check':
    case 'time_calc':
      return cfg.mode ? String(cfg.mode) : t('canvas.summary.timeNow');

    // JSON 操作
    case 'json_op':
      return `JSON: ${cfg.mode ?? 'get'}`;

    // 上下文（get_context 已拆成 3 个；老 kind 保留）
    case 'get_context':
    case 'get_ids':
    case 'get_message':
    case 'get_profile':
      return `${cfg.mode ?? 'user_id'}`;

    // 多分支
    case 'branch_switch':
      return `${cfg.default ?? 'default'}`;

    // 网络
    case 'http_request':
      return `${cfg.method} ${String(cfg.url || '').slice(0, 12)}`;

    // AI
    case 'agent_chat':
      return `${cfg.model ?? 'LLM'}`;
    case 'agent_chat':
      return t('blocks.outline.aiTool');
    case 'embedding':
      return t('blocks.outline.toVector');
    case 'memory_op':
      return t('blocks.outline.memory', { value: String(cfg.mode ?? 'add') });

    // 群管
    case 'group_op':
      return t('blocks.outline.groupAdmin', { value: String(cfg.mode ?? 'ban') });
    case 'check_permission':
      return t('blocks.outline.permission', { value: String(cfg.role ?? 'admin') });

    // 构造消息段
    case 'message_op':
      return `${cfg.segment_type ?? 'at'}`;

    // 文件操作（file_operate 已拆成只读/会改两个；老 kind 保留）
    case 'file_operate':
    case 'file_read':
    case 'file_write':
      return t('blocks.outline.file', { value: String(cfg.mode ?? 'read') });

    // 数据库
    case 'query':
      return t('blocks.outline.query', { value: String(cfg.mode ?? 'list') });
    case 'database_write':
      return `DB: ${cfg.mode ?? 'insert'}`;

    // API 调用
    case 'api_call':
      return `API: ${cfg.action || '?'}`;

    // 数据表/面板
    case 'table_define':
      return t('blocks.outline.table', {
        value: String(cfg.tableName || t('canvas.summary.unnamed')),
      });
    case 'panel_register':
      return t('blocks.outline.panel', { value: String(cfg.label ?? '') });

    // 控制流
    case 'loop_control':
      return cfg.mode === 'return' ? t('canvas.summary.earlyReturn') : t('blocks.outline.break');
    case 'error_op':
      return cfg.mode === 'throw' ? t('blocks.outline.throw') : t('blocks.outline.assert');
    case 'parallel_exec':
      return t('blocks.outline.parallel');

    // 子流程
    case 'subflow_defined':
      return `${cfg.subflow_name || t('canvas.summary.unnamed')}`;
    case 'subflow_call':
      return t('canvas.summary.callSubflow');

    // 正则提取
    case 'regex_extract':
      return cfg.pattern ? `/${cfg.pattern}/` : t('canvas.summary.notConfigured');

    // 工具
    case 'retry_exec':
      return t('blocks.outline.retry', { count: Number(cfg.max_retries ?? 3) });
    case 'timer':
      return `${cfg.mode ?? 'start'}`;
    case 'system_log':
      return `[${cfg.level ?? 'info'}]`;

    default:
      // ⚠️ 2026-10-03：原来是 `return ''` —— 于是**任何新加的节点在大纲里都是空白** ✗
      // （拆分之后 12 个新节点全中招，靠审查才发现）。
      // 回落到节点自己的标签：「读时间」「写文件」「存玩家数据」… 比空白有用得多，
      // 而且**以后任何新节点都自动有摘要**，不用再回来补 case。
      return nodeDisplayLabel(node);
  }
}

/** 节点执行状态徽章（执行中/已完成/错误） */
function NodeStatusBadge({ nodeId }: { nodeId: string }) {
  useLocaleSubscription();
  const isExecuting = useFlowStore((s) => s.executingNodeIds.has(nodeId));
  const isDone = useFlowStore((s) => s.doneNodeIds.has(nodeId));
  const hasError = useFlowStore((s) => s.errorNodeIds.has(nodeId));

  if (!isExecuting && !isDone && !hasError) return null;

  const label = hasError
    ? t('blocks.outline.execError')
    : isExecuting
      ? t('blocks.outline.executing')
      : isDone
        ? t('canvas.exec.done')
        : '';

  return (
    <div className="flex items-center gap-1 shrink-0" role="status" aria-label={label}>
      {hasError && <AlertTriangle aria-hidden="true" className="w-3 h-3 text-red-400" />}
      {isExecuting && (
        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" aria-hidden="true" />
      )}
      {isDone && !isExecuting && (
        <div className="w-2 h-2 rounded-full bg-green-400" aria-hidden="true" />
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  count: number;
  accent?: 'default' | 'purple';
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** 可折叠分区：标题 + 计数 + 折叠内容 */
function Section({
  title,
  icon,
  count,
  accent = 'default',
  defaultOpen = true,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isPurple = accent === 'purple';
  return (
    <div>
      <Button
        variant="ghost"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium uppercase tracking-wide rounded hover:bg-zinc-800/50 ${isPurple ? 'text-purple-300' : 'text-zinc-400'}`}
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight aria-hidden="true" className="w-3 h-3 shrink-0" />
        )}
        {icon}
        <span>{title}</span>
        <span className="text-zinc-600 normal-case font-normal">{count}</span>
      </Button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

interface ChainRowProps {
  chain: ExecutionChain;
  focusNodeId: string | null;
  onJump: (nodeId: string) => void;
  searchQuery: string;
  /** 右键节点时触发删除确认 */
  onDeleteNode: (node: FlowNode) => void;
}

/** 渲染单条链：可折叠，标题为触发器，展开后显示链内节点序列 */
function ChainRow({ chain, focusNodeId, onJump, searchQuery, onDeleteNode }: ChainRowProps) {
  useLocaleSubscription();
  const [open, setOpen] = useState(false);

  const trigger = chain.trigger;
  const TriggerIcon = getNodeIcon(trigger.data.nodeKind);
  const triggerSummary = getNodeSummary(trigger);
  const isFocus = focusNodeId === trigger.id;

  // 链内节点（含触发器作为首项）
  const sequence = chain.sequence;

  // 搜索过滤：链标题始终显示，仅过滤链内节点
  const q = searchQuery.trim().toLowerCase();
  const filteredSequence = q
    ? sequence.filter(
        (n) =>
          nodeDisplayLabel(n).toLowerCase().includes(q) ||
          n.data.nodeKind.toLowerCase().includes(q),
      )
    : sequence;
  // 搜索时自动展开（有匹配节点才展开）
  const effectiveOpen = open || (!!q && filteredSequence.length > 0);

  const handleNodeContextMenu = (e: React.MouseEvent, node: FlowNode) => {
    e.preventDefault();
    if (node.type === 'trigger') return;
    onDeleteNode(node);
  };

  return (
    <div className="pl-4">
      {/* 链标题：触发器 */}
      <div
        role="button"
        tabIndex={0}
        aria-label={nodeDisplayLabel(trigger)}
        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-zinc-800/50 ${isFocus ? 'bg-purple-900/40' : ''}`}
        onClick={() => onJump(trigger.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onJump(trigger.id);
          }
        }}
        onContextMenu={(e) => handleNodeContextMenu(e, trigger)}
      >
        <Button
          variant="ghost"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={effectiveOpen}
          className="text-zinc-500 hover:text-zinc-300 shrink-0"
          title={effectiveOpen ? t('common.collapse') : t('common.expand')}
          leftIcon={
            effectiveOpen ? (
              <ChevronDown aria-hidden="true" className="w-3 h-3" />
            ) : (
              <ChevronRight aria-hidden="true" className="w-3 h-3" />
            )
          }
        />
        <TriggerIcon className="w-3.5 h-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="text-zinc-200 truncate flex-1">{nodeDisplayLabel(trigger)}</span>
        {triggerSummary && (
          <span className="text-zinc-500 text-xs truncate max-w-[80px]" title={triggerSummary}>
            {triggerSummary}
          </span>
        )}
        <NodeStatusBadge nodeId={trigger.id} />
      </div>

      {/* 链内节点序列 */}
      {effectiveOpen && filteredSequence.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {filteredSequence.map((node) => {
            const Icon = getNodeIcon(node.data.nodeKind);
            const summary = getNodeSummary(node);
            const isNodeFocus = focusNodeId === node.id;
            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={nodeDisplayLabel(node)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-zinc-800/50 pl-8 ${isNodeFocus ? 'bg-purple-900/40' : ''}`}
                onClick={() => onJump(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onJump(node.id);
                  }
                }}
                onContextMenu={(e) => handleNodeContextMenu(e, node)}
                title={`${nodeDisplayLabel(node)}${summary ? ' · ' + summary : ''}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="text-zinc-200 truncate flex-1">{nodeDisplayLabel(node)}</span>
                {summary && (
                  <span className="text-zinc-500 text-xs truncate max-w-[80px]">{summary}</span>
                )}
                <NodeStatusBadge nodeId={node.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FlowOutline({ onClose }: { onClose: () => void }) {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const systems = useFlowStore((s) => s.systems);
  const focusNodeId = useFlowStore((s) => s.focusNodeId);
  const setFocusNode = useFlowStore((s) => s.setFocusNode);
  const selectNode = useFlowStore((s) => s.selectNode);
  const removeNode = useFlowStore((s) => s.removeNode);

  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FlowNode | null>(null);

  const chains = useMemo(() => getExecutionChains(nodes, edges), [nodes, edges]);

  // 分区：系统 / 子流程 / 未分组
  const groupedIds = useMemo(() => new Set(systems.flatMap((s: SystemGroup) => s.chainTriggerIds)), [systems]);
  const subflowChains = useMemo(
    () => chains.filter((c) => !groupedIds.has(c.trigger.id) && isSubflowDefine(c.trigger)),
    [chains, groupedIds],
  );
  const ungroupedChains = useMemo(
    () => chains.filter((c) => !groupedIds.has(c.trigger.id) && !isSubflowDefine(c.trigger)),
    [chains, groupedIds],
  );

  /** 点击节点/链标题：跳转高亮 + 选中 + 画布平移聚焦到该节点 */
  const handleJump = (nodeId: string) => {
    setFocusNode(nodeId);
    selectNode(nodeId);
    focusNode(nodeId);
  };

  const hasAny = nodes.length > 0;

  return (
    <div className="w-[280px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-full">
      {/* 标题栏 */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center gap-2 shrink-0">
        <ListTree className="w-4 h-4 text-zinc-400" />
        <span className="text-sm text-zinc-200 font-medium">{t('blocks.outline.title')}</span>
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
            placeholder={t('palette.searchPlaceholder')}
            className={`w-full ${inputForm} pl-8 focus:outline-none focus:border-zinc-600`}
          />
        </div>
      </div>

      {/* 树形内容 */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {!hasAny ? (
          <div className="text-center text-sm text-zinc-500 py-8">{t('blocks.outline.empty')}</div>
        ) : (
          <>
            {/* 系统分区 */}
            {systems.map((sys: SystemGroup) => {
              const sysChains = chains.filter((c) => sys.chainTriggerIds.includes(c.trigger.id));
              if (sysChains.length === 0) return null;
              return (
                <Section
                  key={sys.id}
                  title={sys.name}
                  icon={<span className="text-sm leading-none">{sys.icon}</span>}
                  count={sysChains.length}
                >
                  {sysChains.map((chain) => (
                    <ChainRow
                      key={chain.trigger.id}
                      chain={chain}
                      focusNodeId={focusNodeId}
                      onJump={handleJump}
                      searchQuery={searchQuery}
                      onDeleteNode={setDeleteTarget}
                    />
                  ))}
                </Section>
              );
            })}

            {/* 子流程分区（紫色主题） */}
            {subflowChains.length > 0 && (
              <Section
                title={t('drawer.subflowSelect')}
                icon={<span className="text-sm leading-none">📐</span>}
                count={subflowChains.length}
                accent="purple"
              >
                {subflowChains.map((chain) => (
                  <ChainRow
                    key={chain.trigger.id}
                    chain={chain}
                    focusNodeId={focusNodeId}
                    onJump={handleJump}
                    searchQuery={searchQuery}
                    onDeleteNode={setDeleteTarget}
                  />
                ))}
              </Section>
            )}

            {/* 未分组分区 */}
            {ungroupedChains.length > 0 && (
              <Section title={t('blocks.outline.ungrouped')} count={ungroupedChains.length}>
                {ungroupedChains.map((chain) => (
                  <ChainRow
                    key={chain.trigger.id}
                    chain={chain}
                    focusNodeId={focusNodeId}
                    onJump={handleJump}
                    searchQuery={searchQuery}
                    onDeleteNode={setDeleteTarget}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      {/* 删除节点确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) removeNode(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title={t('drawer.deleteNode')}
        message={t('blocks.outline.deleteNode', {
          name: deleteTarget ? nodeDisplayLabel(deleteTarget) : '',
        })}
        confirmText={t('drawer.confirmDelete')}
        variant="danger"
      />
    </div>
  );
}
