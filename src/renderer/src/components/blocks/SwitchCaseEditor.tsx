import { useMemo } from 'react';
import { useStableKeys } from '../../hooks/useStableKeys';
import { useJsonEditMode } from '../../hooks/useJsonEditMode';
import { Button } from '../ui/Button';
import { JsonEditModePanel } from '../ui/JsonEditModePanel';
import { X } from 'lucide-react';
import { inputSm, inputMd } from '../ui/inputStyles';
import { DebouncedTextInput } from './DebouncedInputs';
import { useFlowStore } from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

function SwitchCaseEditor({
  nodeId,
  config,
  onConfigChange,
}: {
  nodeId: string;
  config: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  useLocaleSubscription();
  const items: Array<{ label: string; match: string }> = useMemo(() => {
    try {
      const raw = config.cases;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }, [config.cases]);

  const defaultBranch = String(config.default ?? 'default');

  const [itemKeys, removeItemKey] = useStableKeys(items.length);

  const commit = (nextItems: Array<{ label: string; match: string }>, nextDefault: string) => {
    onConfigChange({
      cases: JSON.stringify(nextItems, null, 2),
      default: nextDefault,
    });
  };

  const addRow = () => {
    // 默认分支名写进 config.cases[].label，而 label 同时是 branch_switch 的**端口名**
    // （getBranchLabel/getBranchColor 都用它，边也按它连）。属结构性数据、且用户可改，
    // 不能翻译 —— 否则切换语言会让端口名对不上、已有连线失配。
    const next = [...items, { label: `分支${items.length + 1}`, match: '' }];
    commit(next, defaultBranch);
  };

  const deleteRow = (idx: number) => {
    removeItemKey(idx);
    const next = items.filter((_, i) => i !== idx);
    commit(next, defaultBranch);
  };

  /** 防抖提交路径：从 store 读最新 cases/default，避免旧闭包覆盖其他行的编辑（C 修复） */
  const commitRowFromStore = (idx: number, field: 'label' | 'match', value: string) => {
    const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const raw = node.data.config?.cases;
    let latest: Array<{ label: string; match: string }> = [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) latest = parsed;
    } catch {
      /* 保留空列表 */
    }
    const next = latest.map((it, i) => (i === idx ? { ...it, [field]: value } : it));
    const latestDefault = String(node.data.config?.default ?? 'default');
    onConfigChange({
      cases: JSON.stringify(next, null, 2),
      default: latestDefault,
    });
  };

  const labelOptions = useMemo(() => items.map((i) => i.label).filter(Boolean), [items]);

  // JSON 编辑模式（抽取为公共 hook，校验字段为 label + match）
  const json = useJsonEditMode(
    items,
    (parsed) => commit(parsed, defaultBranch),
    (parsed) => {
      if (!Array.isArray(parsed)) return t('blocks.jsonEdit.mustBeArray');
      for (const item of parsed) {
        if (typeof item.label !== 'string' || typeof item.match !== 'string') {
          return t('blocks.switchCase.labelMatchRequired');
        }
      }
      return '';
    },
  );

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-zinc-700 rounded">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-700">
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[80px]">
                {t('blocks.switchCase.caseLabel')}
              </th>
              <th className="text-left px-2 py-2 text-zinc-200 font-medium border-b border-zinc-600 min-w-[120px]">
                {t('blocks.switchCase.matchValue')}
              </th>
              <th className="px-2 py-2 border-b border-zinc-600 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-zinc-500 italic py-4 text-xs">
                  {t('blocks.switchCase.empty')}
                </td>
              </tr>
            )}
            {items.map((item, idx) => (
              <tr key={itemKeys[idx]} className="hover:bg-zinc-800/40">
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <DebouncedTextInput
                    value={item.label}
                    onChange={(v) => commitRowFromStore(idx, 'label', v)}
                    placeholder={t('blocks.switchCase.caseLabel')}
                    ariaLabel={t('blocks.switchCase.caseLabel')}
                    className={`w-full ${inputSm}`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700">
                  <DebouncedTextInput
                    value={item.match}
                    onChange={(v) => commitRowFromStore(idx, 'match', v)}
                    placeholder={t('blocks.switchCase.matchPlaceholder')}
                    ariaLabel={t('blocks.switchCase.matchValue')}
                    className={`w-full ${inputSm} font-mono`}
                  />
                </td>
                <td className="px-1.5 py-1 border-b border-zinc-700 text-center">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => deleteRow(idx)}
                    className="shrink-0 bg-transparent hover:bg-transparent text-zinc-500 hover:text-red-400"
                    title={t('blocks.switchCase.deleteCase')}
                    leftIcon={<X className="w-3.5 h-3.5" />}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="success"
          size="sm"
          onClick={addRow}
          className="border border-dashed border-zinc-700 bg-transparent hover:bg-zinc-800 text-green-400 hover:text-green-300"
        >
          {t('blocks.switchCase.addCase')}
        </Button>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-zinc-400" title={t('blocks.switchCase.defaultHint')}>
            {t('field.label.default')}{' '}
            <span className="text-zinc-600">{t('blocks.switchCase.noMatch')}</span>:
          </span>
          <DebouncedTextInput
            value={defaultBranch}
            onChange={(v) => {
              // 防抖提交：从 store 读最新 items（防抖窗口内其他行的提交可能已生效）
              const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
              if (!node) return;
              const raw = node.data.config?.cases;
              let latest: Array<{ label: string; match: string }> = [];
              try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(parsed)) latest = parsed;
              } catch {
                /* 保留空列表 */
              }
              commit(latest, v);
            }}
            list={`switch-default-${nodeId}`}
            placeholder={t('field.label.default')}
            ariaLabel={t('field.label.default')}
            className={`w-24 ${inputMd}`}
          />
          <datalist id={`switch-default-${nodeId}`}>
            {labelOptions.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-2">
        <JsonEditModePanel
          jsonMode={json.jsonMode}
          jsonText={json.jsonText}
          jsonError={json.jsonError}
          onEnter={json.enterJsonMode}
          onExit={json.exitJsonMode}
          onApply={json.applyJson}
          onTextChange={json.updateJsonText}
          ariaLabel={t('blocks.switchCase.jsonAria')}
          previewData={items}
        />
      </div>
    </div>
  );
}

export { SwitchCaseEditor };
export default SwitchCaseEditor;
