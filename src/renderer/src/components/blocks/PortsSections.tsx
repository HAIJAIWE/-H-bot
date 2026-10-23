// src/renderer/src/components/blocks/PortsSections.tsx
//
// **端口三区**（数据来源-必填 / 可选 / 输出端口）—— 从 `PropertyDrawer` 抽出的第二块（拆分 Step 2）。
//
// 为什么抽它：三块都是"列出端口 + 连线状态"的展示，依赖只有 7 个外部量，
// 与抽屉里其它逻辑（配置字段、分支编辑器等）没有耦合 ✓
//
// ⚠️ 用了 `t()` → 必须 useLocaleSubscription() ✓（BlockEditor 拆分时漏过这条 ✗）
import { useLocaleSubscription } from '@renderer/stores/i18nStore';
import { getDataTypeMeta, SECTION_ICONS } from './iconMap';
import { t } from '../../i18n';
import { Section, PortBindingRow } from './PropertyDrawerParts';
import type { ConfigApiBinding, FlowEdge, FlowNode, Port } from '@shared/types/flow';

export interface PortsSectionsProps {
  node: FlowNode;
  edges: FlowEdge[];
  upstreamNodes: FlowNode[];
  requiredInputs: Port[];
  optionalInputs: Port[];
  dataOutputs: Port[];
  handleBinding: (portId: string, sourceNodeId: string, sourcePortId: string) => void;
  handleClearBinding: (portId: string) => void;
  handleConfigApiBinding: (portId: string, configApi: ConfigApiBinding) => void;
  /** 端口 id → 下游连线数（映射表，不是函数） */
  outputConnectionCount: Record<string, number>;
}

export function PortsSections(props: PortsSectionsProps) {
  const {
    node,
    edges,
    upstreamNodes,
    requiredInputs,
    optionalInputs,
    dataOutputs,
    handleBinding,
    handleClearBinding,
    handleConfigApiBinding,
    outputConnectionCount,
  } = props;
  useLocaleSubscription();
  // 这三个在区域里是读取用（端口连线状态 / 上游来源）—— 显式引用，别被"未使用"误删
  void node;
  void edges;
  void upstreamNodes;

  return (
    <>
      {/* ============ 数据来源 - 必填 ============ */}
      {requiredInputs.length > 0 && (
        <Section
          title={t('drawer.requiredSources')}
          icon={SECTION_ICONS.requiredInputs}
          accent="amber"
          collapsible
          defaultOpen={true}
        >
          <div className="text-xs text-zinc-500 mb-2 leading-relaxed">
            {t('drawer.requiredSourcesHint')}
          </div>
          <div className="space-y-2.5">
            {requiredInputs.map((port) => (
              <PortBindingRow
                key={port.id}
                port={port}
                node={node}
                edges={edges}
                upstreamNodes={upstreamNodes}
                onBind={handleBinding}
                onClear={handleClearBinding}
                onConfigApiBind={handleConfigApiBinding}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ============ 数据来源 - 可选 ============ */}
      {optionalInputs.length > 0 && (
        <Section
          title={t('drawer.optionalSources')}
          icon={SECTION_ICONS.optionalInputs}
          collapsible
          defaultOpen={true}
        >
          <div className="text-xs text-zinc-500 mb-2 leading-relaxed">
            {t('drawer.optionalSourcesHint')}
          </div>
          <div className="space-y-2.5">
            {optionalInputs.map((port) => (
              <PortBindingRow
                key={port.id}
                port={port}
                node={node}
                edges={edges}
                upstreamNodes={upstreamNodes}
                onBind={handleBinding}
                onClear={handleClearBinding}
                onConfigApiBind={handleConfigApiBinding}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ============ 输出端口 ============ */}
      {dataOutputs.length > 0 && (
        <Section
          title={t('drawer.outputPorts')}
          icon={SECTION_ICONS.outputs}
          collapsible
          defaultOpen={true}
        >
          <div className="text-xs text-zinc-500 mb-2 leading-relaxed">
            {t('drawer.outputPortsHint')}
          </div>
          <div className="space-y-1.5">
            {dataOutputs.map((port) => {
              const meta = getDataTypeMeta(port.dataType);
              const connCount = outputConnectionCount[port.id] ?? 0;
              const TypeIcon = meta.icon;
              return (
                <div
                  key={port.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800/40 rounded border border-zinc-800"
                  title={t('drawer.portIdTip', { id: port.id })}
                >
                  <TypeIcon className={`w-3.5 h-3.5 shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200 truncate">{port.name}</div>
                    {port.description && (
                      <div className="text-xs text-zinc-500 truncate">{port.description}</div>
                    )}
                  </div>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded bg-zinc-800 ${meta.color} shrink-0`}
                  >
                    {meta.label}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                      connCount > 0 ? 'bg-green-900/40 text-green-400' : 'bg-zinc-800 text-zinc-500'
                    }`}
                    title={
                      connCount > 0
                        ? t('drawer.connectedDownstream', { count: String(connCount) })
                        : t('drawer.notUsedDownstream')
                    }
                  >
                    {connCount > 0
                      ? t('drawer.usedCount', { count: String(connCount) })
                      : t('drawer.unused')}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}
