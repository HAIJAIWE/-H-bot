// src/renderer/src/components/blocks/FormulaEditor.tsx
//
// **expression_eval 的公式编辑器**（从 `PropertyDrawer` 抽出的第一块，拆分 Step 1）。
//
// 为什么先抽它：它是抽屉里**最自洽**的一块 —— 一个 Section、一套"多公式"编辑，
// 依赖只有 5 个外部量（node / formulasList / formulaKeys / removeFormulaKey / updateNodeConfig）。
//
// ⚠️ 组件用了 `t()` → **必须** useLocaleSubscription() ✓
//（BlockEditor 拆分时就是漏了这条被 i18n 闸门抓住的 ✗，这里预防性加上 ✓）
import { t } from '@renderer/i18n';
import { useLocaleSubscription } from '@renderer/stores/i18nStore';
import { useFlowStore } from '@renderer/stores/flowStore';
import { Button } from '../ui/Button';
import { Section } from './PropertyDrawerParts';
import { DebouncedTextInput } from './DebouncedInputs';
import { Sigma, Trash2, Plus } from 'lucide-react';
import type { FlowNode } from '@shared/types/flow';

export interface FormulaEditorProps {
  node: FlowNode;
  formulasList: Array<{ name: string; expression: string }>;
  formulaKeys: readonly (string | number)[];
  removeFormulaKey: (idx: number) => void;
  updateNodeConfig: (id: string, patch: Record<string, unknown>) => void;
}

export function FormulaEditor({
  node,
  formulasList,
  formulaKeys,
  removeFormulaKey,
  updateNodeConfig,
}: FormulaEditorProps) {
  useLocaleSubscription();

  return (
    <Section title={t('drawer.formulaEditor')} icon={Sigma} collapsible defaultOpen={true}>
      <div className="space-y-3">
        <div className="text-xs text-zinc-500 leading-relaxed">{t('drawer.formulaHint')}</div>
        {/* 多公式**共享上下文**的唯一入口：把公共前置逻辑算一次接到「命名变量」端口。
                    实测（2026-09-26）：不知道这条时全库 formulas 代码 54% 是重复的前置逻辑，
                    最多的节点同一段 1,721 字符抄了 4 遍。这里点一句，省得再靠口口相传。 */}
        <div className="text-xs text-amber-400/80 leading-relaxed">
          {t('drawer.formulaSharedHint')}
        </div>
        {formulasList.map((formula, idx) => (
          <div
            key={formulaKeys[idx]}
            className="space-y-1.5 p-2 bg-zinc-900/50 rounded border border-zinc-800"
          >
            <div className="flex items-center gap-2">
              <DebouncedTextInput
                value={formula.name ?? ''}
                onChange={(v) => {
                  // 防抖提交：从 store 读最新 formulas，避免旧闭包覆盖其他行的编辑
                  const st = useFlowStore.getState();
                  const latest = [
                    ...((st.nodes.find((n) => n.id === node.id)?.data.config?.formulas as Array<{
                      name: string;
                      expression: string;
                    }>) ?? []),
                  ];
                  latest[idx] = { ...latest[idx], name: v };
                  updateNodeConfig(node.id, { formulas: latest });
                }}
                placeholder={t('drawer.formulaOutputPlaceholder')}
                ariaLabel={t('drawer.formulaOutputAria')}
                className="flex-1 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 font-mono"
              />
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  removeFormulaKey(idx);
                  const formulas = [...formulasList];
                  formulas.splice(idx, 1);
                  updateNodeConfig(node.id, { formulas });
                }}
                className="px-1.5 py-1"
                title={t('drawer.deleteFormula')}
                leftIcon={<Trash2 className="w-3 h-3" />}
              />
            </div>
            <DebouncedTextInput
              value={formula.expression ?? ''}
              onChange={(v) => {
                const st = useFlowStore.getState();
                const latest = [
                  ...((st.nodes.find((n) => n.id === node.id)?.data.config?.formulas as Array<{
                    name: string;
                    expression: string;
                  }>) ?? []),
                ];
                latest[idx] = { ...latest[idx], expression: v };
                updateNodeConfig(node.id, { formulas: latest });
              }}
              placeholder={t('drawer.formulaPlaceholder')}
              ariaLabel={t('drawer.formulaAria')}
              className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 font-mono"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const formulas = [
              ...((node.data.config?.formulas as Array<{
                name: string;
                expression: string;
              }>) ?? []),
            ];
            formulas.push({ name: '', expression: '' });
            updateNodeConfig(node.id, { formulas });
          }}
          className="w-full border border-zinc-700 text-blue-400 hover:text-blue-300"
          leftIcon={<Plus className="w-3 h-3" />}
        >
          {t('drawer.addFormula')}
        </Button>
      </div>
    </Section>
  );
}
