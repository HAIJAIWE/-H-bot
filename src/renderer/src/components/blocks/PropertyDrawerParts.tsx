// 从 PropertyDrawer.tsx 拆分而来（P0-D1 重构）
// PropertyDrawer 专用的展示子组件：Section（分区块）、PortBindingRow（数据端口绑定行）、
// InfoRow（信息行）、HelpIcon（帮助图标）。
import { useState, useId, memo } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Port, FlowNode, FlowEdge, ConfigApiBinding } from '@shared/types/flow';
import { getDataTypeMeta, HelpCircle } from './iconMap';
import { findBinding, DataBindingSelect } from './DataBindingSelect';
import { findSpec, nodeDisplayLabel } from '../../lib/node/nodeCatalog';
import { Button } from '../ui/Button';
import { portHint } from '../../i18n/fieldLabels';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 分区块组件 */
export function Section({
  title,
  icon: Icon,
  accent,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent?: 'amber' | 'blue';
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // useId 保证 id 唯一合法（标题含中文/空格时 slug 化不可靠，且同标题分节会重复）
  const sectionId = useId();
  const accentColor =
    accent === 'amber' ? 'text-amber-400' : accent === 'blue' ? 'text-blue-400' : 'text-zinc-300';
  return (
    <div className="border-b border-zinc-800">
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="w-full flex px-4 py-2.5 gap-2 hover:bg-zinc-800/30 transition-colors justify-start"
        onClick={() => collapsible && setOpen(!open)}
        aria-expanded={collapsible ? open : undefined}
        aria-controls={collapsible ? `section-${sectionId}` : undefined}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className={`text-xs font-medium ${accentColor}`}>{title}</span>
        {collapsible && <span className="ml-auto text-zinc-500 text-xs">{open ? '▾' : '▸'}</span>}
      </Button>
      {open && (
        <div id={collapsible ? `section-${sectionId}` : undefined} className="px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

/** 数据端口绑定行 */
export const PortBindingRow = memo(function PortBindingRow({
  port,
  node,
  edges,
  upstreamNodes,
  onBind,
  onClear,
  onConfigApiBind,
}: {
  port: Port;
  node: FlowNode;
  edges: FlowEdge[];
  upstreamNodes: FlowNode[];
  onBind: (portId: string, sourceNodeId: string, sourcePortId: string) => void;
  onClear: (portId: string) => void;
  onConfigApiBind?: (portId: string, configApi: ConfigApiBinding) => void;
}) {
  useLocaleSubscription();
  const meta = getDataTypeMeta(port.dataType);
  const TypeIcon = meta.icon;
  const hint = portHint(port.id) ?? port.description;
  const binding = findBinding(edges, node.id, port.id);
  // 检查是否绑定了配置 API
  const configApiBinding = edges.find(
    (e) => e.target === node.id && e.targetPort === port.id && e.source === '__config_api__',
  )?.configApi;

  // 找到绑定源节点的标签（配置 API 绑定单独处理）
  const sourceLabel = binding
    ? (() => {
        const srcNode = upstreamNodes.find((n) => n.id === binding.source);
        const srcSpec = srcNode ? findSpec(srcNode.data.nodeKind) : null;
        const srcPort = srcSpec?.outputs.find((p) => p.id === binding.sourcePort);
        return srcNode
          ? `${nodeDisplayLabel(srcNode)} · ${srcPort?.name ?? binding.sourcePort}`
          : binding.sourcePort;
      })()
    : configApiBinding
      ? `📦 ${configApiBinding.table}.${configApiBinding.field}`
      : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <TypeIcon className={`w-3.5 h-3.5 shrink-0 ${meta.color}`} />
        <span className="text-xs text-zinc-200 flex-1">{port.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded bg-zinc-800 ${meta.color} shrink-0`}>
          {meta.label}
        </span>
        {port.required && <span className="text-xs text-red-400">*</span>}
      </div>
      <DataBindingSelect
        currentNodeId={node.id}
        portId={port.id}
        edges={edges}
        upstreamNodes={upstreamNodes}
        onSelect={(srcId, srcPort) => onBind(port.id, srcId, srcPort)}
        onClear={() => onClear(port.id)}
        onConfigApiBind={onConfigApiBind ? (api) => onConfigApiBind(port.id, api) : undefined}
        targetDataType={port.dataType}
      />
      {sourceLabel && (
        <div
          className={`text-xs flex items-center gap-1 ${configApiBinding ? 'text-blue-400' : 'text-green-400'}`}
        >
          <span>←</span>
          <span className="truncate">{sourceLabel}</span>
        </div>
      )}
      {!sourceLabel && hint && (
        <div className="text-xs text-zinc-500 flex items-start gap-1">
          <HelpIcon text={hint} />
          <span className="line-clamp-2">
            {port.default !== undefined
              ? t('drawer.defaultValue', { value: String(port.default) })
              : hint.slice(0, 60)}
          </span>
        </div>
      )}
    </div>
  );
});

/** 信息行 */
export function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-500 shrink-0 w-16">{label}</span>
      <span className={`text-zinc-300 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

/** 帮助图标 */
export function HelpIcon({ text }: { text: string }) {
  return (
    <span className="cursor-help text-zinc-600 hover:text-zinc-400" title={text}>
      <HelpCircle className="w-3 h-3 inline" />
    </span>
  );
}

/** 子流程参数说明（subflow_call 专用，从 IIFE 提取而来） */
export function SubflowParamsSection({
  defineNode,
  sectionIcon: SectionIcon,
}: {
  defineNode: FlowNode | undefined;
  sectionIcon: LucideIcon;
}) {
  useLocaleSubscription();
  if (!defineNode) return null;
  let params: Array<{ name: string; type: string; description: string }> = [];
  try {
    const raw = defineNode.data.config.params;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) params = parsed;
  } catch {
    /* ignore */
  }
  if (params.length === 0) {
    return (
      <Section title={t('drawer.subflowParams')} icon={SectionIcon}>
        <div className="text-xs text-zinc-500">{t('drawer.noSubflowParams')}</div>
      </Section>
    );
  }
  return (
    <Section title={t('drawer.subflowParams')} icon={SectionIcon}>
      <div className="space-y-1.5">
        <div className="text-xs text-zinc-500">{t('drawer.subflowArgsHint')}</div>
        <div className="space-y-1">
          {params.map((p, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs bg-zinc-800/50 rounded px-2 py-1"
            >
              <code className="text-blue-300 font-mono">{p.name}</code>
              <span className="text-zinc-500">:</span>
              <span className="text-purple-300">{p.type}</span>
              {p.description && (
                <span className="text-zinc-500 ml-auto truncate">{p.description}</span>
              )}
            </div>
          ))}
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          {t('drawer.example')}:{' '}
          <code className="text-zinc-400 font-mono">{`{"${params[0]?.name}": ...}`}</code>
        </div>
      </div>
    </Section>
  );
}
