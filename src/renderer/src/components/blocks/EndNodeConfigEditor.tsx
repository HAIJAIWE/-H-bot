// src/renderer/src/components/blocks/EndNodeConfigEditor.tsx
import { useMemo } from 'react';
import type { FlowNode } from '@shared/types/flow';
import { collectBindingOptions } from './DataBindingSelect';
import { buildParamSourceOptions } from '../../lib/expression/paramSourceOptions';
import { findEnclosingSubflowId, namedVariablesOf } from '../../lib/expression/variableRegistry';
import { useStableKeys } from '../../hooks/useStableKeys';
import { useJsonEditMode } from '../../hooks/useJsonEditMode';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { JsonEditModePanel } from '../ui/JsonEditModePanel';
import { inputSm } from '../ui/inputStyles';
import { X } from 'lucide-react';
import { DebouncedTextInput } from './DebouncedInputs';
import { useFlowStore } from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface EndReturn {
  field: string;
  source: string; // "nodeId:portId" 或空串
}

/**
 * end_node 专属编辑器：returns 可视化表格 + JSON 模式切换。
 *
 * config.returns JSON 格式：
 * [{"field":"result","source":"sv1:result"}, ...]
 *
 * - 普通链（isSubflow=false）：end_node 仅作结束标记，显示说明文案，无返回值配置。
 * - 子流程链（isSubflow=true）：显示 returns 映射表，field 是返回字典键名，
 *   source 从上游节点数据输出中选择（复用 collectBindingOptions，已消费 showWhen 过滤）。
 *
 * 布局：返回值表（字段名 / 数据来源 / 操作）+ 添加按钮 + JSON 编辑模式
 */
export function EndNodeConfigEditor({
  config,
  nodeId,
  onConfigChange,
  upstreamNodes,
  isSubflow,
}: {
  config: Record<string, unknown>;
  nodeId?: string;
  onConfigChange: (patch: Record<string, unknown>) => void;
  upstreamNodes: FlowNode[];
  isSubflow: boolean;
}) {
  useLocaleSubscription();
  const returns: EndReturn[] = useMemo(() => {
    try {
      const raw = config.returns;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }, [config.returns]);

  // 上游节点数据输出选项（复用 collectBindingOptions，已消费 showWhen 过滤）
  // 数据来源选项：上游节点端口 + 命名变量（子流程参数按作用域过滤）
  //
  // 「命名变量」这一组是补上的：运行时（`resolveEndNodeReturns`）一直支持
  // `__var__:<名>` 这种来源，但界面上只能选上游节点端口 —— 于是"子流程把自己的参数
  // 原样传回去""把「变量赋值」算出的中间值传回去"这两件最自然的写法，用户根本写不出来
  // （得去手改 JSON）。这和配置绑定的「参数来源」现在是同一套选项、同一个编码
  // （`@shared/nodes/varRef`）。
  const flowNodes = useFlowStore((s) => s.nodes);
  const flowEdges = useFlowStore((s) => s.edges);
  const enclosingSubflowId = useMemo(
    () => (nodeId ? findEnclosingSubflowId(nodeId, flowNodes, flowEdges) : null),
    [nodeId, flowNodes, flowEdges],
  );
  const namedVariables = useMemo(() => namedVariablesOf(flowNodes), [flowNodes]);
  const sourceOptions = useMemo(
    () =>
      buildParamSourceOptions({
        portOptions: collectBindingOptions(upstreamNodes).map((opt) => ({
          value: `${opt.nodeId}:${opt.portId}`,
          label: opt.label,
        })),
        namedVariables,
        enclosingSubflowId,
      }),
    [upstreamNodes, namedVariables, enclosingSubflowId],
  );

  const commit = (next: EndReturn[]) => {
    onConfigChange({ returns: JSON.stringify(next, null, 2) });
  };

  // 返回值列表稳定 key（避免删除/编辑时输入框错位）
  const [rowKeys, removeRowKey] = useStableKeys(returns.length);

  const addRow = () => {
    commit([...returns, { field: '', source: '' }]);
  };

  const deleteRow = (idx: number) => {
    removeRowKey(idx);
    commit(returns.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: keyof EndReturn, value: string) => {
    const next = [...returns];
    next[idx] = { ...next[idx], [field]: value };
    commit(next);
  };

  /** 防抖提交路径：从 store 读最新 returns，避免旧闭包覆盖其他行的编辑（C 修复） */
  const commitRowFromStore = (idx: number, field: keyof EndReturn, value: string) => {
    if (!nodeId) return;
    const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const raw = node.data.config?.returns;
    let latest: EndReturn[] = [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) latest = parsed;
    } catch {
      /* 保留空列表 */
    }
    const next = latest.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    commit(next);
  };

  // JSON 编辑模式（抽取为公共 hook，校验字段为 field）
  const json = useJsonEditMode(
    returns,
    (parsed) => commit(parsed),
    (parsed) => {
      if (!Array.isArray(parsed)) return t('blocks.jsonEdit.mustBeArray');
      for (const item of parsed) {
        if (typeof item.field !== 'string') {
          return t('blocks.endNode.fieldRequired');
        }
      }
      return '';
    },
  );

  // 普通链：end_node 仅作结束标记，无返回值
  if (!isSubflow) {
    return (
      <div className="text-xs text-zinc-500 italic leading-relaxed">
        {t('blocks.endNode.plainNote')}
      </div>
    );
  }

  // 子流程链：显示 returns 映射表
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-500 leading-relaxed">{t('blocks.endNode.subflowNote')}</div>
      {/* 返回值表 */}
      <div className="overflow-x-auto border border-zinc-700 rounded">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-700">
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[80px]">
                {t('blocks.endNode.fieldName')}
              </th>
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[120px]">
                {t('blocks.endNode.source')}
              </th>
              <th className="px-2 py-2 border-b border-zinc-600 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {returns.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-zinc-500 italic py-4 text-xs">
                  {t('blocks.endNode.empty')}
                </td>
              </tr>
            )}
            {returns.map((ret, idx) => (
              <tr key={rowKeys[idx]} className="hover:bg-zinc-800/40">
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <DebouncedTextInput
                    value={ret.field}
                    onChange={(v) => commitRowFromStore(idx, 'field', v)}
                    placeholder={t('blocks.endNode.fieldPlaceholder')}
                    ariaLabel={t('blocks.endNode.fieldName')}
                    className={`w-full ${inputSm} font-mono`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <Dropdown
                    value={ret.source}
                    ariaLabel={t('blocks.endNode.source')}
                    onChange={(v) => updateRow(idx, 'source', v)}
                    options={[
                      { value: '', label: t('blocks.endNode.emptyOption') },
                      ...sourceOptions.map((opt) => ({
                        value: opt.value,
                        label: opt.label,
                        group: opt.group,
                      })),
                    ]}
                    className={`w-full ${inputSm}`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700 text-center">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => deleteRow(idx)}
                    className="shrink-0 bg-transparent hover:bg-transparent text-zinc-500 hover:text-red-400"
                    title={t('blocks.endNode.deleteReturn')}
                    leftIcon={<X className="w-3.5 h-3.5" />}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 底部：添加返回值 */}
      <Button
        variant="success"
        size="sm"
        onClick={addRow}
        className="border border-dashed border-zinc-700 bg-transparent hover:bg-zinc-800 text-green-400 hover:text-green-300"
      >
        {t('blocks.endNode.addReturn')}
      </Button>

      {/* JSON 编辑模式切换 */}
      <div className="border-t border-zinc-800 pt-2">
        <JsonEditModePanel
          jsonMode={json.jsonMode}
          jsonText={json.jsonText}
          jsonError={json.jsonError}
          onEnter={json.enterJsonMode}
          onExit={json.exitJsonMode}
          onApply={json.applyJson}
          onTextChange={json.updateJsonText}
          ariaLabel={t('blocks.endNode.jsonAria')}
          previewData={returns}
        />
      </div>
    </div>
  );
}
