// src/renderer/src/lib/variableRegistry.ts
//
// 命名变量注册表 — 扫描流程图收集所有可被 {{var}} 语法引用的命名变量。
//
// 变量来源（3 类）：
// 1. variable_set 节点：config.var_name 字段，运行时由代码生成注入 _vars 字典
// 2. start_node（subflow_defined）的 params：子流程输入参数，运行时注入 _vars
// 3. graph.variables 手动声明：用户在变量面板手动添加的变量
//
// 供 VariablePanel 展示变量列表 + DataBindingSelect 自动补全使用。

import type { FlowGraph, FlowNode, FlowEdge, Variable } from '@shared/types/flow';
import { FLOW_SCHEMA_VERSION } from '@shared/types/flow';
import { nodeDisplayLabel } from './nodeCatalog';
import { parseSubflowParams } from '@shared/nodes/varRef';
import { collectSubflowMembers } from './autoLayout';
import { t } from '../i18n';

/** variable_set 节点提取的变量信息 */
interface SetVarInfo {
  varName: string;
  nodeId: string;
  nodeLabel: string;
}

/** 从 variable_set 节点提取变量名 */
function extractFromSetVariable(node: FlowNode): SetVarInfo | null {
  if (node.data.nodeKind !== 'variable_set') return null;
  const varName = (node.data.config.var_name as string) ?? '';
  if (!varName.trim()) return null;
  return {
    varName: varName.trim(),
    nodeId: node.id,
    nodeLabel: nodeDisplayLabel(node) || node.data.nodeKind,
  };
}

/** start_node 子流程参数（subflow_defined 模式） */
interface SubflowParamInfo {
  name: string;
  type: string;
  description: string;
  nodeId: string;
}

/**
 * 判断这个节点是不是"子流程定义"，取出它的参数列表。
 *
 * ⚠️ 有**两种**形态，都必须认（历史上只认了后一种，于是现代流程的子流程参数
 * 在变量面板里**一个都看不到**）：
 *
 * 1. `nodeKind === 'subflow_defined'` —— 现在的形态。`flowStore.createSubflowFromSelection`
 *    （画布上"折叠成子流程"）建的、目录里 `subflow_defined` 这个节点都是它，
 *    运行时 `execSubflowCall` 也**只**认这个 kind。
 * 2. `nodeKind === 'start_node'` + `config.trigger_type === 'subflow_defined'` —— 早期形态。
 *    运行时**不认**它（`subflow_call` 找不到定义会报"找不到 ID 为 X 的子流程定义"），
 *    但 `flow.json` 里可能还留着，变量面板照旧列出来，免得用户看不出自己写的东西去哪了。
 *
 * `config.params` 本身也有两种存法（JSON 字符串 / 数组），统一走
 * `parseSubflowParams` 处理。
 */
export function extractSubflowParams(node: FlowNode): SubflowParamInfo[] {
  const kind = node.data.nodeKind;
  if (kind === 'subflow_defined') {
    // 继续走下面的通用解析
  } else if (kind === 'start_node') {
    const triggerType = (node.data.config.trigger_type as string) ?? 'message_received';
    if (triggerType !== 'subflow_defined') return [];
  } else {
    return [];
  }

  const raw = node.data.config.params;
  let rows: Array<{ name?: unknown; type?: unknown; description?: unknown }> = [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) rows = parsed.filter((p) => typeof p === 'object' && p !== null);
  } catch {
    return [];
  }

  const names = parseSubflowParams(raw);
  return names.map((name) => {
    const row = rows.find((r) => String(r.name ?? '').trim() === name) ?? {};
    return {
      name,
      type: String(row.type ?? 'any'),
      description: String(row.description ?? ''),
      nodeId: node.id,
    };
  });
}

/**
 * 扫描流程图，收集所有命名变量。
 *
 * 优先级：手动声明 > variable_set > subflow_param（同名变量取先出现的）
 * 去重：按变量名去重，保留首次出现的来源信息。
 *
 * @returns Variable[] 供 VariablePanel 和 DataBindingSelect 使用
 */
export function collectNamedVariables(graph: FlowGraph): Variable[] {
  const seen = new Set<string>();
  const result: Variable[] = [];

  // 1. 手动声明的变量（graph.variables，优先级最高）
  for (const v of graph.variables ?? []) {
    if (!v.name || seen.has(v.name)) continue;
    seen.add(v.name);
    result.push({
      ...v,
      sourceType: 'manual',
    });
  }

  // 2. variable_set 节点的 var_name
  for (const node of graph.nodes) {
    const info = extractFromSetVariable(node);
    if (!info || seen.has(info.varName)) continue;
    seen.add(info.varName);
    result.push({
      id: `setvar_${node.id}`,
      name: info.varName,
      dataType: 'any',
      scope: 'session',
      source: node.id,
      sourceType: 'variable_set',
      description: t('variable.fromNode', { label: info.nodeLabel }),
    });
  }

  // 3. 子流程参数（subflow_defined 节点 / 早期 start_node 形态）
  for (const node of graph.nodes) {
    const params = extractSubflowParams(node);
    for (const p of params) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      result.push({
        id: `subflowparam_${node.id}_${p.name}`,
        name: p.name,
        dataType: p.type,
        scope: 'session',
        source: node.id,
        sourceType: 'subflow_param',
        description: p.description || t('variable.subflowParam'),
      });
    }
  }

  return result;
}

/**
 * 找出某个节点属于哪个子流程（返回 `subflow_defined` 的节点 id；不在任何子流程里则 null）。
 *
 * 用途：`ConfigApiPicker` 只应把**当前子流程**的参数列为可选项 —— 子流程参数的作用域
 * 就是那个子流程体（运行时 `execSubflowCall` 给子流程单独造一个 `ExecContext`，
 * 参数只注入到那个上下文里），把别的子流程的参数列出来会让用户选到一个永远读不到的变量。
 *
 * 复用 `autoLayout.collectSubflowMembers`，**刻意不另写一份"成员判定"**：
 * 两份实现一旦漂移，画布上画出来的子流程边界和这里的作用域就会不一致。
 */
export function findEnclosingSubflowId(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): string | null {
  for (const node of nodes) {
    if (node.data.nodeKind !== 'subflow_defined') continue;
    if (collectSubflowMembers(node.id, nodes, edges).includes(nodeId)) return node.id;
  }
  return null;
}

/**
 * 从 store 里的节点列表取出命名变量（面板/下拉框的常用入口）。
 *
 * 为什么需要它：`collectNamedVariables` 要一个完整 `FlowGraph`，而 `flowStore` 里
 * `nodes` / `edges` 是分开存的、`variables` 甚至**没有状态**（`exportGraph()` 就是硬写
 * `variables: []`，手动声明还是预留态）。这段"拼一个临时 graph"的样板原先散在
 * `VariablePanel` 里，现在有三处要用了（变量面板、配置绑定的参数来源、结束节点的
 * 返回值来源），收在这里一份，免得哪天 `variables` 真接上 store 时有地方漏改。
 *
 * `edges: []` 是**故意的**：变量收集不依赖边（子流程作用域判定另有
 * `findEnclosingSubflowId`，那个才要边）。
 */
export function namedVariablesOf(nodes: FlowNode[]): Variable[] {
  return collectNamedVariables({
    schemaVersion: FLOW_SCHEMA_VERSION,
    systems: [],
    nodes,
    edges: [],
    variables: [],
    metadata: { name: '', version: '1.0', runtime: 'typescript', createdAt: '', updatedAt: '' },
  });
}

/**
 * ⚠️ 这里原本有两个导出：`hasNamedVarSyntax` / `extractVarReferences`，都按 `{{var}}`
 * 语法做正则匹配。**已删除**（2026-09-26），原因：
 *
 * 1. `{{var}}` 是**已死掉的 Python codegen 路径**的语法（只在 `codegen/dataflow.ts`
 *    与 `codeflowEmitter.ts` 里实现）。TS 运行时——真正在跑的那个——只有
 *    `formatText` 的单层 `{key}` 替换，写 `{{name}}` 会渲染成 `{值}`（多一层大括号）。
 * 2. 这两个函数**全代码库零调用**（连测试都没有），却会让后来者以为 `{{var}}` 是
 *    现行语法，照着它写校验/补全。
 *
 * 真要"检测某个字段引用了哪些命名变量"，正确做法是同时认两种写法：
 * 表达式里的裸变量名（需要能查变量表，不能靠正则）和文本里的 `{名}`。
 */
