// src/renderer/src/components/blocks/IfBranchBuilder.tsx
import { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { X } from 'lucide-react';
import { useStableKeys } from '../../hooks/useStableKeys';
import { DebouncedTextInput, DebouncedTextarea } from './DebouncedInputs';
import { useFlowStore } from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 比较运算符选项 */
const IF_OP_OPTIONS: { value: string; label: string; needRight: boolean }[] = [
  {
    value: '==',
    get label() {
      return t('blocks.ifBranch.opEq');
    },
    needRight: true,
  },
  {
    value: '!=',
    get label() {
      return t('blocks.ifBranch.opNe');
    },
    needRight: true,
  },
  {
    value: '>',
    get label() {
      return t('blocks.ifBranch.opGt');
    },
    needRight: true,
  },
  {
    value: '<',
    get label() {
      return t('blocks.ifBranch.opLt');
    },
    needRight: true,
  },
  {
    value: '>=',
    get label() {
      return t('blocks.ifBranch.opGte');
    },
    needRight: true,
  },
  {
    value: '<=',
    get label() {
      return t('blocks.ifBranch.opLte');
    },
    needRight: true,
  },
  {
    value: 'is_none',
    get label() {
      return t('blocks.ifBranch.opIsNone');
    },
    needRight: false,
  },
  {
    value: 'is_not_none',
    get label() {
      return t('data.field.notNull');
    },
    needRight: false,
  },
  {
    value: 'in',
    get label() {
      return t('blocks.ifBranch.opIn');
    },
    needRight: true,
  },
];

export interface IfCondition {
  left: string;
  op: string;
  right: string;
  /** 与下一条件的逻辑连接（最后一个条件的此字段不使用） */
  logic: 'and' | 'or';
}

/** 从单个表达式片段解析条件 */
function parseSingleCondition(part: string): Omit<IfCondition, 'logic'> | null {
  let m = part.match(/^(\w+)\s+is\s+not\s+None$/);
  if (m) return { left: m[1], op: 'is_not_none', right: '' };
  m = part.match(/^(\w+)\s+is\s+None$/);
  if (m) return { left: m[1], op: 'is_none', right: '' };
  m = part.match(/^(\w+)\s+in\s+(.+)$/);
  if (m) return { left: m[1], op: 'in', right: m[2].trim() };
  m = part.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (m) return { left: m[1], op: m[2], right: m[3].trim() };
  return null;
}

/** 从 expression 字符串解析条件列表（仅支持单一逻辑连接符，不支持 and/or 混用） */
function parseExpression(expr: string): IfCondition[] | null {
  const trimmed = (expr || '').trim();
  if (!trimmed) return [];
  const hasAnd = /\sand\s/.test(trimmed);
  const hasOr = /\sor\s/.test(trimmed);
  if (hasAnd && hasOr) return null; // 混合逻辑不支持可视化解析
  const logic: 'and' | 'or' = hasOr ? 'or' : 'and';
  const parts = trimmed
    .split(new RegExp(`\\s+${logic}\\s+`, 'i'))
    .map((p) => p.trim())
    .filter(Boolean);
  const conditions: IfCondition[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cond = parseSingleCondition(parts[i]);
    if (!cond) return null;
    conditions.push({ ...cond, logic: i < parts.length - 1 ? logic : 'and' });
  }
  return conditions;
}

/** 根据条件列表生成 expression 字符串 */
function generateExpression(conditions: IfCondition[]): string {
  if (conditions.length === 0) return '';
  const parts = conditions.map((c) => {
    switch (c.op) {
      case 'is_none':
        return `${c.left} is None`;
      case 'is_not_none':
        return `${c.left} is not None`;
      case 'in':
        return `${c.left} in ${c.right}`;
      default:
        return `${c.left} ${c.op} ${c.right}`;
    }
  });
  let expr = parts[0];
  for (let i = 1; i < conditions.length; i++) {
    expr += ` ${conditions[i - 1].logic} ${parts[i]}`;
  }
  return expr;
}

/** branch_if 可视化条件构建器 */
export function IfBranchBuilder({
  config,
  nodeId,
  onChange,
}: {
  config: Record<string, unknown>;
  nodeId?: string;
  onChange: (k: string, v: unknown) => void;
}) {
  useLocaleSubscription();
  const expression = String(config.expression ?? '');
  const [advanced, setAdvanced] = useState(false);
  const [conditions, setConditions] = useState<IfCondition[]>(() => {
    const parsed = parseExpression(expression);
    return parsed ?? [];
  });
  const [parseError, setParseError] = useState(() => expression && !parseExpression(expression));

  const generatedFromConditions = generateExpression(conditions);
  // 判断 expression 是否与本地条件生成的表达式同步（同步则不触发重新解析）
  const inSync = generatedFromConditions === expression;

  useEffect(() => {
    if (!inSync) {
      const parsed = parseExpression(expression);
      if (parsed) {
        setConditions(parsed);
        setParseError(false);
      } else if (expression) {
        setParseError(true);
      } else {
        setConditions([]);
        setParseError(false);
      }
    }
  }, [expression, inSync]);

  const updateConditions = (next: IfCondition[]) => {
    setConditions(next);
    onChange('expression', generateExpression(next));
  };

  // 防抖提交路径：从 store 读最新 expression 解析合并，避免旧闭包覆盖其他条件的编辑（C 修复）
  const conditionsRef = useRef(conditions);
  conditionsRef.current = conditions;
  const commitCondition = (idx: number, patch: Partial<IfCondition>) => {
    let base = conditionsRef.current;
    if (nodeId) {
      const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
      const expr = node ? String(node.data.config?.expression ?? '') : '';
      const parsed = expr ? parseExpression(expr) : [];
      if (parsed) base = parsed;
    }
    const next = base.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setConditions(next);
    onChange('expression', generateExpression(next));
  };

  // 条件列表稳定 key（避免删除/编辑时输入框错位）
  const [condKeys, removeCondKey] = useStableKeys(conditions.length);

  return (
    <div className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-800/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300 font-medium">{t('blocks.ifBranch.title')}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdvanced(!advanced)}
          className="text-blue-400 hover:text-blue-300"
        >
          {advanced ? t('blocks.ifBranch.visualMode') : t('blocks.ifBranch.advancedMode')}
        </Button>
      </div>
      {!advanced && (
        <div className="text-xs text-zinc-500 leading-relaxed">
          {t('blocks.ifBranch.visualHintPrefix')}{' '}
          <code className="text-emerald-300">expression_eval</code>
          {t('blocks.ifBranch.visualHintSuffix')}
        </div>
      )}

      {advanced ? (
        <DebouncedTextarea
          value={expression}
          onChange={(v) => onChange('expression', v)}
          placeholder={t('blocks.ifBranch.exprPlaceholder')}
          rows={3}
          ariaLabel={t('blocks.ifBranch.exprAria')}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono resize-y"
        />
      ) : parseError ? (
        <div className="space-y-1.5">
          <div className="text-xs text-amber-400">{t('blocks.ifBranch.complexNote')}</div>
          <div className="text-xs text-zinc-500 font-mono bg-zinc-900 rounded px-2 py-1.5 border border-zinc-700 break-all">
            {expression}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setParseError(false);
              setConditions([{ left: 'value', op: '==', right: 'True', logic: 'and' }]);
              onChange('expression', 'value == True');
            }}
            className="text-blue-400 hover:text-blue-300"
          >
            {t('blocks.ifBranch.resetSimple')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {conditions.length === 0 && (
            <div className="text-xs text-zinc-500 italic">{t('blocks.ifBranch.noConditions')}</div>
          )}
          {conditions.map((cond, idx) => {
            const opMeta = IF_OP_OPTIONS.find((o) => o.value === cond.op);
            const needRight = opMeta?.needRight ?? true;
            return (
              <div key={condKeys[idx]} className="space-y-1.5">
                {idx > 0 && (
                  <Dropdown
                    value={conditions[idx - 1].logic}
                    ariaLabel={t('blocks.ifBranch.logicAria')}
                    onChange={(v) => {
                      const next = [...conditions];
                      next[idx - 1] = { ...next[idx - 1], logic: v as 'and' | 'or' };
                      updateConditions(next);
                    }}
                    options={[
                      { value: 'and', label: t('blocks.ifBranch.logicAnd') },
                      { value: 'or', label: t('blocks.ifBranch.logicOr') },
                    ]}
                    className="bg-zinc-700 border border-zinc-600"
                  />
                )}
                <div className="flex items-center gap-1">
                  <DebouncedTextInput
                    value={cond.left}
                    onChange={(v) => commitCondition(idx, { left: v })}
                    placeholder={t('panel.right.variables')}
                    ariaLabel={t('blocks.ifBranch.leftAria')}
                    className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1.5 text-xs text-zinc-200 font-mono"
                  />
                  <Dropdown
                    value={cond.op}
                    ariaLabel={t('blocks.ifBranch.opAria')}
                    onChange={(v) => {
                      const next = [...conditions];
                      next[idx] = { ...cond, op: v };
                      updateConditions(next);
                    }}
                    options={IF_OP_OPTIONS}
                    className="bg-zinc-900 border border-zinc-700"
                  />
                  {needRight ? (
                    <DebouncedTextInput
                      value={cond.right}
                      onChange={(v) => commitCondition(idx, { right: v })}
                      placeholder={t('blocks.ifBranch.rightPlaceholder')}
                      ariaLabel={t('blocks.ifBranch.rightAria')}
                      className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1.5 text-xs text-zinc-200 font-mono"
                    />
                  ) : (
                    <div className="flex-1 text-xs text-zinc-500 italic">
                      {t('blocks.ifBranch.noRightNeeded')}
                    </div>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      removeCondKey(idx);
                      updateConditions(conditions.filter((_, i) => i !== idx));
                    }}
                    className="shrink-0 px-1 bg-transparent hover:bg-transparent text-zinc-500 hover:text-red-400"
                    title={t('common.delete')}
                    leftIcon={<X className="w-3 h-3" />}
                  />
                </div>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              updateConditions([
                ...conditions,
                { left: 'value', op: '==', right: '', logic: 'and' },
              ])
            }
            className="w-full text-blue-400 hover:text-blue-300 hover:bg-zinc-800 rounded py-1.5 border border-dashed border-zinc-700"
          >
            {t('blocks.ifBranch.addCondition')}
          </Button>
        </div>
      )}

      {/* 生成的表达式预览 */}
      {!advanced && !parseError && conditions.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-zinc-500">{t('blocks.ifBranch.generated')}</span>
          <div className="text-xs text-zinc-300 font-mono bg-zinc-900 rounded px-2 py-1.5 border border-zinc-700 break-all">
            {generatedFromConditions || t('ai.tool.empty')}
          </div>
        </div>
      )}
    </div>
  );
}
