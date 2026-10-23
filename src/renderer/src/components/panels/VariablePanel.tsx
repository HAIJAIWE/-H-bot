// src/renderer/src/components/panels/VariablePanel.tsx
//
// 变量管理面板 — 展示当前流程里可用的**命名变量**，并告诉用户怎么写。
//
// 变量来源（自动收集，无需手动配置）：
// 1. variable_set 节点的 var_name
// 2. subflow_defined 的参数（子流程体里可用）
// 3. graph.variables 手动声明（当前为预留，后续支持）
//
// ⚠️ 写法（2026-09-26 更正）：
// - **表达式 / 条件**（表达式求值、条件分支、循环条件）：直接写变量名 → `lv > 3`
// - **文本模板**（文本模板、发消息的 text/markdown）：写**单层**大括号 → `等级={lv}`
// - **配置绑定的 WHERE 参数、结束节点的返回值来源**：从下拉框里选，不用写
//
// 这里以前写的是「输入 `{{变量名}}` 即可引用」—— 那个语法属于**已死掉的 Python codegen
// 路径**，TS 运行时只有 `formatText` 的单层 `{key}` 替换。照着旧文案写会渲染成 `{小明}`
// （多一层大括号）而且不报错。见 `tests/main/runtime/templateSyntax.test.ts`。

import { useMemo } from 'react';
import { useFlowStore } from '../../stores/flowStore';
import { namedVariablesOf } from '../../lib/expression/variableRegistry';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 来源类型中文标签 */
const SOURCE_TYPE_LABEL: Record<string, string> = {
  get variable_set() {
    return t('panel.variable.source.variableSet');
  },
  get subflow_param() {
    return t('panel.variable.source.subflowParam');
  },
  get manual() {
    return t('panel.variable.source.manual');
  },
};

/** 来源类型颜色 */
const SOURCE_TYPE_COLOR: Record<string, string> = {
  variable_set: 'text-emerald-400',
  subflow_param: 'text-blue-400',
  manual: 'text-zinc-400',
};

export function VariablePanel() {
  useLocaleSubscription();
  const nodes = useFlowStore((s) => s.nodes);

  const variables = useMemo(() => namedVariablesOf(nodes), [nodes]);

  return (
    <div className="flex flex-col h-full" aria-label={t('panel.variable.title')}>
      {/* 头部说明 */}
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <h3 className="text-xs font-medium text-zinc-200">{t('panel.variable.heading')}</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          {t('panel.variable.refPrefix')}{' '}
          <code className="text-zinc-400 bg-zinc-800 px-1 rounded">
            {t('panel.variable.placeholder')}
          </code>{' '}
          {t('panel.variable.refSuffix', { count: variables.length })}
        </p>
      </div>

      {/* 变量列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {variables.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-zinc-500">
            <p>{t('panel.variable.empty')}</p>
            <p className="mt-2 text-zinc-600">
              {t('panel.variable.emptyPrefix')} <code className="text-zinc-500">variable_set</code>{' '}
              {t('panel.variable.emptyMid')} <code className="text-zinc-500">start_node</code>{' '}
              {t('panel.variable.emptySuffix')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {variables.map((v) => (
              <div key={v.id} className="px-3 py-2 hover:bg-zinc-800/30">
                <div className="flex items-center justify-between gap-2">
                  {/* 显示**变量名本身**，不加大括号：这个名字在表达式里就是这么写的，
                      在文本模板里再加一层 `{}`（底部提示会说）。以前这里渲染成
                      `{{name}}` —— 用户照着复制就会多出一层大括号（见文件头注释）。 */}
                  <code className="text-xs text-zinc-200 font-mono truncate">{v.name}</code>
                  <span className="text-xs text-zinc-500 shrink-0">{v.dataType}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span
                    className={`text-xs ${SOURCE_TYPE_COLOR[v.sourceType ?? 'manual'] ?? 'text-zinc-500'} truncate`}
                  >
                    {SOURCE_TYPE_LABEL[v.sourceType ?? 'manual'] ?? v.sourceType}
                  </span>
                  {v.source && (
                    <span className="text-xs text-zinc-600 shrink-0 font-mono" title={v.source}>
                      {v.source.slice(0, 8)}
                    </span>
                  )}
                </div>
                {v.description && (
                  <p className="text-xs text-zinc-600 mt-0.5 truncate" title={v.description}>
                    {v.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部使用提示 */}
      <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900/50 shrink-0">
        <p className="text-xs text-zinc-600">
          {t('panel.variable.usagePrefix')}{' '}
          <code className="text-zinc-500 bg-zinc-800 px-1 rounded">
            {t('panel.variable.usagePlaceholder')}
          </code>{' '}
          {t('panel.variable.usageSuffix')}
        </p>
      </div>
    </div>
  );
}
