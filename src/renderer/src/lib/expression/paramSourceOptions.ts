// src/renderer/src/lib/expression/paramSourceOptions.ts
//
// 「WHERE 参数来源」下拉框的选项构造 —— 纯函数，便于单测。
//
// 两类来源，编码方式见 `@shared/nodes/varRef`：
// - **节点输出端口**：`<节点id>:<端口id>`（一直都有）
// - **命名变量**：`__var__:<名>`（2026-09 补 —— 之前配置绑定读不到命名变量，
//   于是子流程参数拿不到表查询的 WHERE 条件，"把重复逻辑收成子流程"在查表这一步卡死）
//
// ## 为什么要限定作用域
//
// 命名变量不是全局的：
// - **子流程参数**只存在于那个子流程体里（运行时给子流程单独建 `ExecContext`）；
// - **`variable_set` 的值**只存在于本次链执行里（不跨链、不按用户/群隔离）。
//
// 所以这里做两件事：只列**当前子流程**的参数；其余变量照列（面板也拦不住跨链引用），
// 但 UI 会把作用域限制写在提示里，让用户知道"要先赋值才能读"。

import type { Variable } from '@shared/types/flow';
import { NAMED_VAR_REF_NODE } from '@shared/nodes/varRef';
import { t } from '../../i18n';

export interface ParamSourceOption {
  value: string;
  label: string;
  /** 分组标题（`Dropdown` 有 group 就按组渲染） */
  group: string;
}

export interface BuildParamSourceOptionsInput {
  /** 上游节点的数据输出端口（由调用方用 `collectBindingOptions` 算好，这里只管排序/分组） */
  portOptions: Array<{ value: string; label: string }>;
  /** `collectNamedVariables(graph)` 的结果 */
  namedVariables: Variable[];
  /** 当前节点所属的子流程定义 id（`findEnclosingSubflowId`）；不在子流程里传 null */
  enclosingSubflowId: string | null;
}

/**
 * 命名变量 → 选项。顺带**过滤掉不属于当前子流程的子流程参数**。
 */
export function buildParamSourceOptions(input: BuildParamSourceOptionsInput): ParamSourceOption[] {
  const portGroup = t('blocks.configApi.groupPorts');
  const varGroup = t('blocks.configApi.groupVars');

  const options: ParamSourceOption[] = input.portOptions.map((o) => ({
    value: o.value,
    label: o.label,
    group: portGroup,
  }));

  for (const v of input.namedVariables) {
    // 别的子流程的参数在这里读不到（运行时各自独立的 ExecContext）——列出来只会误导
    if (v.sourceType === 'subflow_param' && v.source !== input.enclosingSubflowId) continue;
    options.push({
      value: `${NAMED_VAR_REF_NODE}:${v.name}`,
      label: describeVariable(v),
      group: varGroup,
    });
  }

  return options;
}

function describeVariable(v: Variable): string {
  switch (v.sourceType) {
    case 'subflow_param':
      return t('blocks.configApi.paramSourceVarSubflow', { name: v.name });
    case 'variable_set':
      return t('blocks.configApi.paramSourceVarSet', { name: v.name });
    default:
      return t('blocks.configApi.paramSourceVarManual', { name: v.name });
  }
}
