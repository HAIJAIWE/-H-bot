// src/renderer/src/components/blocks/SubflowParamsEditor.tsx
import { useMemo } from 'react';
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

export interface SubflowParam {
  name: string;
  type: string;
  description: string;
}

/** 参数类型选项 */
const PARAM_TYPE_OPTIONS = [
  {
    value: 'string',
    get label() {
      return t('field.label.text');
    },
  },
  {
    value: 'number',
    get label() {
      return t('type.number');
    },
  },
  {
    value: 'boolean',
    get label() {
      return t('type.boolean');
    },
  },
  {
    value: 'list',
    get label() {
      return t('type.list');
    },
  },
  {
    value: 'object',
    get label() {
      return t('type.object');
    },
  },
  { value: 'json', label: 'JSON' },
  {
    value: 'any',
    get label() {
      return t('type.any');
    },
  },
];

/**
 * subflow_defined 参数可视化编辑器
 *
 * config.params JSON 格式：
 * [{"name":"atk","type":"number","description":"攻击力"}, ...]
 *
 * 布局：参数表（名称 / 类型 / 说明 / 操作）+ 添加按钮 + JSON 预览
 */
export function SubflowParamsEditor({
  config,
  nodeId,
  onConfigChange,
}: {
  config: Record<string, unknown>;
  nodeId?: string;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  useLocaleSubscription();
  const params: SubflowParam[] = useMemo(() => {
    try {
      const raw = config.params;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }, [config.params]);

  const commit = (next: SubflowParam[]) => {
    onConfigChange({ params: JSON.stringify(next, null, 2) });
  };

  // 参数列表稳定 key（避免删除/编辑时输入框错位）
  const [paramKeys, removeParamKey] = useStableKeys(params.length);

  const addRow = () => {
    commit([...params, { name: '', type: 'any', description: '' }]);
  };

  const deleteRow = (idx: number) => {
    removeParamKey(idx);
    commit(params.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: keyof SubflowParam, value: string) => {
    const next = [...params];
    next[idx] = { ...next[idx], [field]: value };
    commit(next);
  };

  /** 防抖提交路径：从 store 读最新 params，避免旧闭包覆盖其他行的编辑（C 修复） */
  const commitRowFromStore = (idx: number, field: keyof SubflowParam, value: string) => {
    if (!nodeId) return;
    const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const raw = node.data.config?.params;
    let latest: SubflowParam[] = [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) latest = parsed;
    } catch {
      /* 保留空列表 */
    }
    const next = latest.map((p, i) => (i === idx ? { ...p, [field]: value } : p));
    commit(next);
  };

  // JSON 编辑模式（抽取为公共 hook，校验字段为 name）
  const json = useJsonEditMode(
    params,
    (parsed) => commit(parsed),
    (parsed) => {
      if (!Array.isArray(parsed)) return t('blocks.jsonEdit.mustBeArray');
      for (const item of parsed) {
        if (typeof item.name !== 'string') {
          return t('blocks.subflowParams.nameRequired');
        }
      }
      return '';
    },
  );

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-500 leading-relaxed">{t('blocks.subflowParams.note')}</div>
      {/* 参数表 */}
      <div className="overflow-x-auto border border-zinc-700 rounded">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-700">
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[80px]">
                {t('blocks.subflowParams.paramName')}
              </th>
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[80px]">
                {t('settings.crash.colType')}
              </th>
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[100px]">
                {t('blocks.subflowParams.description')}
              </th>
              <th className="px-2 py-2 border-b border-zinc-600 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {params.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-zinc-500 italic py-4 text-xs">
                  {t('blocks.subflowParams.empty')}
                </td>
              </tr>
            )}
            {params.map((param, idx) => (
              <tr key={paramKeys[idx]} className="hover:bg-zinc-800/40">
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <DebouncedTextInput
                    value={param.name}
                    onChange={(v) => commitRowFromStore(idx, 'name', v)}
                    placeholder={t('blocks.subflowParams.namePlaceholder')}
                    ariaLabel={t('blocks.subflowParams.paramName')}
                    className={`w-full ${inputSm} font-mono`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <Dropdown
                    value={param.type || 'any'}
                    ariaLabel={t('blocks.subflowParams.paramType')}
                    onChange={(v) => updateRow(idx, 'type', v)}
                    options={PARAM_TYPE_OPTIONS}
                    className={`w-full ${inputSm}`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <DebouncedTextInput
                    value={param.description}
                    onChange={(v) => commitRowFromStore(idx, 'description', v)}
                    placeholder={t('drawer.subflowParams')}
                    ariaLabel={t('drawer.subflowParams')}
                    className={`w-full ${inputSm}`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700 text-center">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => deleteRow(idx)}
                    className="shrink-0 bg-transparent hover:bg-transparent text-zinc-500 hover:text-red-400"
                    title={t('blocks.subflowParams.deleteParam')}
                    leftIcon={<X className="w-3.5 h-3.5" />}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 底部：添加参数 */}
      <Button
        variant="success"
        size="sm"
        onClick={addRow}
        className="border border-dashed border-zinc-700 bg-transparent hover:bg-zinc-800 text-green-400 hover:text-green-300"
      >
        {t('blocks.subflowParams.addParam')}
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
          ariaLabel={t('blocks.subflowParams.jsonAria')}
          previewData={params}
        />
      </div>
    </div>
  );
}
