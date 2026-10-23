// src/main/codegen/controlFlowEmitter.ts
// 块生成 + 控制流节点发射器（if_branch / switch_case / loop）。
// 生成 TypeScript 代码（基于 Router + Middleware + Hook + StandardEvent）。
// - generateBlock: 从 startNode 沿控制流遍历生成连续节点代码
// - emitIfBranch: branch_if 节点 → TS if/else
// - emitSwitchCase: branch_switch 多分支节点 → TS if/else if/else
// - emitLoop: loop 三合一节点 → TS for/while
// - emitTryCatch: try_catch 异常捕获
// - emitRetryExec: retry_exec 重试执行
// - emitEndNode: end_node 流程结束
// - emitLoopControl: loop_control break/return

import type { FlowGraph, FlowNode } from '@shared/types/flow';
import { indentStr, tsLiteral } from './typescriptUtils';
import { nextNode, nextNodes } from './topo';
import { assignOutputVariables, resolveDataInput, getVariableAccessor } from './dataflow';
import { emitNode, type EmitContext } from './emitters';
import { checkExpressionSafety } from './expressionSafety';

/**
 * 从 startNode 沿控制流遍历生成连续节点代码。
 * visited 共享给 loop 的 body/done 子链，避免 done 子链节点被 body 提前生成。
 */
export function generateBlock(
  startNode: FlowNode,
  graph: FlowGraph,
  ctx: EmitContext,
  indent: number,
  debugMode = false,
  visited: Set<string> = new Set(),
): string {
  let code = '';
  let current: FlowNode | null = startNode;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);

    // Debug trace
    if (debugMode) {
      code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
    }

    // branch_if 条件分支
    if (current.data.nodeKind === 'branch_if') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      code += emitIfBranch(current, graph, ctx, indent, debugMode);
      break;
    }

    // branch_switch 多分支节点
    if (current.data.nodeKind === 'branch_switch') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      code += emitSwitchCase(current, graph, ctx, indent, debugMode);
      break;
    }

    // loop 循环节点
    if (current.data.nodeKind === 'loop') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      code += emitLoop(current, graph, ctx, indent, debugMode, visited);
      
      const doneNexts = nextNodes(current, 'done', graph);
      if (doneNexts.length === 1) {
        current = doneNexts[0];
        continue;
      }
      if (doneNexts.length > 1) {
        for (const dn of doneNexts) {
          code += generateBlock(dn, graph, ctx, indent, debugMode, visited);
        }
      }
      break;
    }

    // try_catch 异常捕获节点
    if (current.data.nodeKind === 'try_catch') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      code += emitTryCatch(current, graph, ctx, indent, debugMode, visited);
      break;
    }

    // retry_exec 重试执行节点
    if (current.data.nodeKind === 'retry_exec') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      code += emitRetryExec(current, graph, ctx, indent, debugMode, visited);
      break;
    }

    // flow_control 特殊处理：break/return 语句生成
    if (current.data.nodeKind === 'loop_control') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      const fcMode = (current.data.config.mode as string) ?? 'break';
      if (fcMode === 'return') {
        const valueExpr = resolveDataInput(current, 'value', ctx.dataflow);
        code += `${indentStr(indent)}return ${valueExpr}\n`;
      } else {
        code += `${indentStr(indent)}break\n`;
      }
      break;
    }

    // end_node 流程结束节点
    if (current.data.nodeKind === 'end_node') {
      if (debugMode) {
        code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
      }
      code += emitEndNode(current, ctx, indent);
      break;
    }

    // 普通节点
    if (debugMode) {
      code += `${indentStr(indent)}ctx.hooks.emit('onDebug', { nodeId: ${tsLiteral(current.id)}, label: ${tsLiteral(current.data.label)} });\n`;
    }
    code += emitNode(current, ctx, indent);

    // variable_set 后处理：把 result 注入到 ctx.xxxVars 供 {{var}} 引用
    if (current.data.nodeKind === 'variable_set') {
      const resultVar = ctx.dataflow.variables.get(`${current.id}:result`);
      if (resultVar) {
        const currentNodeId = current.id;
        const varNameEdge = ctx.dataflow.graph.edges.find(
          (e) => e.target === currentNodeId && e.targetPort === 'var_name',
        );
        let keyExpr: string | null = null;
        if (varNameEdge) {
          const upstreamVar = ctx.dataflow.variables.get(
            `${varNameEdge.source}:${varNameEdge.sourcePort}`,
          );
          if (upstreamVar) keyExpr = upstreamVar;
        } else {
          const rawName = String(current.data.config.var_name ?? '').trim();
          if (rawName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rawName)) {
            keyExpr = tsLiteral(rawName);
          }
        }
        if (keyExpr) {
          const accessor = getVariableAccessor('flow');
          code += `${indentStr(indent)}${accessor}[${keyExpr}] = ${resultVar}  // 注入命名变量供 {{var}} 引用\n`;
        }
      }
    }

    let nextPortId = current.data.outputs.find((p) => p.kind === 'control')?.id;
    let nextCtrlNodes: FlowNode[] = [];
    if (nextPortId) {
      nextCtrlNodes = nextNodes(current, nextPortId, graph);
    } else if (current.data.outputs.length === 0) {
      const firstEdges = graph.edges.filter((e) => e.source === current!.id);
      nextCtrlNodes = firstEdges
        .map((e) => graph.nodes.find((n) => n.id === e.target))
        .filter((n): n is FlowNode => n !== undefined && n !== null);
    }
    if (nextCtrlNodes.length === 0) break;
    if (nextCtrlNodes.length === 1) {
      current = nextCtrlNodes[0];
      continue;
    }
    // 扇出
    for (const fn of nextCtrlNodes) {
      code += generateBlock(fn, graph, ctx, indent, debugMode, visited);
    }
    break;
  }

  return code;
}

/**
 * branch_if 条件分支节点代码生成。
 * 生成结构：
 *   if <expression>:
 *       <true 子链>
 *   else:
 *       <false 子链>
 */
function emitIfBranch(
  node: FlowNode,
  graph: FlowGraph,
  ctx: EmitContext,
  indent: number,
  debugMode = false,
): string {
  const ind = indentStr(indent);

  const valueExpr = resolveDataInput(node, 'value', ctx.dataflow);
  const hasDataflow =
    valueExpr && valueExpr !== 'true' && valueExpr !== 'false' && valueExpr !== 'null';

  const rawExprStr = (node.data.config.expression as string) ?? '';
  let expression: string;

  if (hasDataflow && rawExprStr) {
    if (/\bvalue\b/.test(rawExprStr)) {
      const safety = checkExpressionSafety(rawExprStr);
      expression = safety.safe ? rawExprStr.replace(/\bvalue\b/g, valueExpr) : `Boolean(${valueExpr})`;
    } else {
      expression = `Boolean(${valueExpr})`;
    }
  } else if (hasDataflow) {
    expression = `Boolean(${valueExpr})`;
  } else {
    const safety = checkExpressionSafety(rawExprStr);
    expression = safety.safe ? rawExprStr : 'false';
  }

  let code = `${ind}if (${expression}) {\n`;
  const trueNext = nextNode(node, 'true', graph);
  if (trueNext) {
    code += generateBlock(trueNext, graph, ctx, indent + 1, debugMode);
  } else {
    code += `${indentStr(indent + 1)}// no-op\n`;
  }

  code += `${ind}} else {\n`;
  const falseNext = nextNode(node, 'false', graph);
  if (falseNext) {
    code += generateBlock(falseNext, graph, ctx, indent + 1, debugMode);
  } else {
    code += `${indentStr(indent + 1)}// no-op\n`;
  }

  code += `${ind}}\n`;
  return code;
}

/**
 * branch_switch 多分支节点代码生成。
 * 生成结构：
 *   const matched = <switch_case 调用>
 *   if (matched === "label1") { ... }
 *   else if (matched === "label2") { ... }
 *   else { <默认分支> }
 */
function emitSwitchCase(
  node: FlowNode,
  graph: FlowGraph,
  ctx: EmitContext,
  indent: number,
  debugMode = false,
): string {
  const ind = indentStr(indent);

  // 1. 发射 switch_case 内置调用
  let code = emitNode(node, ctx, indent);

  // 2. 获取 matched 输出变量名
  const cleanNodeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
  const matchedVar = ctx.dataflow.variables.get(`${node.id}:matched`) ?? `${cleanNodeId}_matched`;
  if (!ctx.dataflow.variables.has(`${node.id}:matched`)) {
    ctx.errors.push(`branch_switch 节点 ${node.id} 输出端口定义丢失，无法提取 matched 字段`);
    code += `${ind}const ${matchedVar} = null;\n`;
  }

  // 解析 cases 配置
  const casesStr = (node.data.config.cases as string) ?? '[]';
  let cases: Array<{ match?: string; label?: string }> = [];
  try {
    const parsed = JSON.parse(casesStr);
    if (Array.isArray(parsed)) {
      cases = parsed.filter(
        (c: unknown): c is { match?: string; label?: string } =>
          typeof c === 'object' && c !== null,
      );
    }
  } catch {
    ctx.errors.push(`branch_switch 节点 ${node.id} 的 cases 配置不是合法 JSON: ${casesStr}`);
  }

  const defaultLabel = (node.data.config.default as string) ?? 'default';

  const seenLabels = new Set<string>();
  let firstBranch = true;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const label = c.label ?? `case_${i}`;
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);

    const branchNext = nextNode(node, label, graph);
    if (!branchNext) continue;

    const keyword = firstBranch ? 'if' : 'else if';
    firstBranch = false;
    code += `${ind}${keyword} (${matchedVar} === ${tsLiteral(label)}) {\n`;
    code += generateBlock(branchNext, graph, ctx, indent + 1, debugMode);
    code += `${ind}}\n`;
  }

  const defaultNext = nextNode(node, defaultLabel, graph);
  if (defaultNext) {
    if (firstBranch) {
      code += generateBlock(defaultNext, graph, ctx, indent, debugMode);
    } else {
      code += `${ind}else {\n`;
      code += generateBlock(defaultNext, graph, ctx, indent + 1, debugMode);
      code += `${ind}}\n`;
    }
  } else if (firstBranch) {
    code += `${ind}// no matching branch\n`;
  }

  return code;
}

/**
 * try_catch 异常捕获节点代码生成。
 * 生成结构：
 *   try {
 *       <try 子链>
 *       result = "ok"; error = ""
 *   } catch (_e) {
 *       error = String(_e); result = "error";
 *       <catch 子链>
 *   } finally {
 *       <finally 子链>
 *   }
 */
function emitTryCatch(
  node: FlowNode,
  graph: FlowGraph,
  ctx: EmitContext,
  indent: number,
  debugMode = false,
  visited: Set<string> = new Set(),
): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');

  const outVars = assignOutputVariables(node, ctx.dataflow);
  const resultVar = outVars.result ?? `_try_${safeId}_result`;
  const errorVar = outVars.error_message ?? `_try_${safeId}_error`;

  const tryNode = nextNode(node, 'try', graph);
  const catchNode = nextNode(node, 'catch', graph);
  const finallyNode = nextNode(node, 'finally', graph);

  let code = `${ind}// 节点: ${node.data.label} (${node.id}) — try/catch/finally\n`;
  code += `${ind}try {\n`;
  if (tryNode) {
    code += generateBlock(tryNode, graph, ctx, indent + 1, debugMode, new Set(visited));
  } else {
    code += `${indBody}// no-op\n`;
  }
  code += `${indBody}${resultVar} = "ok";\n`;
  code += `${indBody}${errorVar} = "";\n`;
  code += `${ind}} catch (_e) {\n`;
  code += `${indBody}${errorVar} = String(_e);\n`;
  code += `${indBody}${resultVar} = "error";\n`;
  if (catchNode) {
    code += generateBlock(catchNode, graph, ctx, indent + 1, debugMode, new Set(visited));
  }
  code += `${ind}} finally {\n`;
  if (finallyNode) {
    code += generateBlock(finallyNode, graph, ctx, indent + 1, debugMode, new Set(visited));
  } else {
    code += `${indBody}// no-op\n`;
  }
  code += `${ind}}\n`;
  return code;
}

/**
 * retry_exec 重试执行节点代码生成。
 */
function emitRetryExec(
  node: FlowNode,
  graph: FlowGraph,
  ctx: EmitContext,
  indent: number,
  debugMode = false,
  visited: Set<string> = new Set(),
): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const _indBody2 = indentStr(indent + 2);
  const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');

  const outVars = assignOutputVariables(node, ctx.dataflow);
  const attemptsVar = outVars.attempts ?? `_retry_${safeId}_attempts`;
  const errorVar = outVars.error ?? `_retry_${safeId}_error`;

  const maxRetriesExpr = resolveDataInput(node, 'max_retries', ctx.dataflow);
  const delayExpr = resolveDataInput(node, 'delay', ctx.dataflow);
  const maxRetriesVar = `_retry_${safeId}_max`;
  const delayVar = `_retry_${safeId}_delay`;

  const bodyNode = nextNode(node, 'body', graph);
  const successNode = nextNode(node, 'success', graph);
  const failedNode = nextNode(node, 'failed', graph);

  ctx.imports.add('import { sleep } from "@qqbot/utils";');

  let code = `${ind}// 节点: ${node.data.label} (${node.id}) — 重试执行\n`;
  code += `${ind}const ${maxRetriesVar} = Math.max(1, Math.floor(${maxRetriesExpr}));\n`;
  code += `${ind}const ${delayVar} = Math.max(0, Number(${delayExpr}));\n`;
  code += `${ind}let ${attemptsVar} = 0;\n`;
  code += `${ind}let ${errorVar} = "";\n`;
  code += `${ind}for (let _attempt = 1; _attempt <= ${maxRetriesVar}; _attempt++) {\n`;
  code += `${indentStr(indent + 1)}const _attempt = _attempt;\n`;
  code += `${ind}try {\n`;
  if (bodyNode) {
    code += generateBlock(bodyNode, graph, ctx, indent + 1, debugMode, new Set(visited));
  } else {
    code += `${indentStr(indent + 1)}// no-op\n`;
  }
  code += `${indBody}${errorVar} = "";\n`;
  code += `${indBody}break;\n`;
  code += `${ind}} catch (_e) {\n`;
  code += `${indBody}${errorVar} = String(_e);\n`;
  code += `${indBody}if (_attempt < ${maxRetriesVar} && ${delayVar} > 0) {\n`;
  code += `${indBody}  await sleep(${delayVar});\n`;
  code += `${indBody}}\n`;
  code += `${ind}}\n`;
  code += `${ind}if (!${errorVar}) {\n`;
  if (successNode) {
    code += generateBlock(successNode, graph, ctx, indent + 1, debugMode, new Set(visited));
  } else {
    code += `${indentStr(indent + 1)}// success\n`;
  }
  code += `${ind}} else {\n`;
  if (failedNode) {
    code += generateBlock(failedNode, graph, ctx, indent + 1, debugMode, new Set(visited));
  } else {
    code += `${indentStr(indent + 1)}// failed\n`;
  }
  code += `${ind}}\n`;
  return code;
}

/**
 * loop 循环节点代码生成（三合一：times/iterate/while）。
 */
function emitLoop(
  node: FlowNode,
  graph: FlowGraph,
  ctx: EmitContext,
  indent: number,
  debugMode: boolean,
  visited: Set<string>,
): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');

  const outVars = assignOutputVariables(node, ctx.dataflow);
  const indexVar = outVars.index ?? `_loop_${safeId}_i`;
  const countVar = outVars.count ?? `_loop_${safeId}_count`;

  let code = '';

  let mode = (node.data.config.mode as string) ?? 'times';
  if (mode === 'count') mode = 'times';

  const bodyNext = nextNode(node, 'body', graph);

  if (mode === 'iterate') {
    const itemVar = outVars.item ?? `_loop_${safeId}_item`;
    const keyVar = outVars.key ?? `_loop_${safeId}_key`;
    const dataVar = `_loop_data_${safeId}`;
    const itemsVar = `_loop_items_${safeId}`;

    code += `${ind}const ${dataVar} = ${resolveDataInput(node, 'list', ctx.dataflow)};\n`;
    code += `${ind}let ${itemsVar}: [any, any][] = [];\n`;
    code += `${ind}if (typeof ${dataVar} === 'object' && ${dataVar} !== null) {\n`;
    code += `${indBody}if (Array.isArray(${dataVar})) {\n`;
    code += `${indBody}  ${itemsVar} = ${dataVar}.map((v, i) => [i, v]);\n`;
    code += `${indBody}} else if (typeof ${dataVar} === 'object') {\n`;
    code += `${indBody}  ${itemsVar} = Object.entries(${dataVar});\n`;
    code += `${indBody}}\n`;
    code += `${ind}}\n`;
    code += `${ind}const ${countVar} = ${itemsVar}.length;\n`;
    code += `${ind}for (const [${keyVar}, ${itemVar}] of ${itemsVar}) {\n`;
    code += `${indBody}const ${indexVar} = typeof ${keyVar} === 'number' ? ${keyVar} : 0;\n`;

    if (bodyNext) {
      code += generateBlock(bodyNext, graph, ctx, indent + 1, debugMode, visited);
    } else {
      code += `${indBody}// no-op\n`;
    }
    code += `${ind}}\n`;
    return code;
  }

  if (mode === 'while') {
    const resultVar = outVars.result ?? `_loop_${safeId}_result`;
    const maxIterExpr = resolveDataInput(node, 'max_iterations', ctx.dataflow);
    const rawExprStr = (node.data.config.expression as string) ?? 'value === true';
    const valueExpr = resolveDataInput(node, 'value', ctx.dataflow);
    const hasDataflow = valueExpr && valueExpr !== 'true' && valueExpr !== 'false' && valueExpr !== 'null';
    let whileCond: string;

    if (hasDataflow && rawExprStr) {
      if (/\bvalue\b/.test(rawExprStr)) {
        const safety = checkExpressionSafety(rawExprStr);
        whileCond = safety.safe ? rawExprStr.replace(/\bvalue\b/g, valueExpr) : `Boolean(${valueExpr})`;
      } else {
        whileCond = `Boolean(${valueExpr})`;
      }
    } else if (hasDataflow) {
      whileCond = `Boolean(${valueExpr})`;
    } else {
      const safety = checkExpressionSafety(rawExprStr);
      whileCond = safety.safe ? rawExprStr : 'false';
    }

    const safeId2 = safeId.replace(/[^a-zA-Z0-9_]/g, '_');
    code += `${ind}let ${resultVar} = 0;\n`;
    code += `${ind}const _max_iter_${safeId2} = Math.min(Math.floor(Number(${maxIterExpr})), 10000);\n`;
    code += `${ind}while (${resultVar} < _max_iter_${safeId2}) {\n`;
    code += `${indBody}const ${indexVar} = ${resultVar};\n`;
    code += `${indBody}if (!(${whileCond})) {\n`;
    code += `${indBody}  break;\n`;
    code += `${indBody}}\n`;

    const bodyNext = nextNode(node, 'body', graph);
    if (bodyNext) {
      code += generateBlock(bodyNext, graph, ctx, indent + 1, debugMode, visited);
    } else {
      code += `${indBody}// no-op\n`;
    }
    code += `${indBody}${resultVar}++;\n`;
    code += `${ind}}\n`;
    return code;
  }

  // mode='times'
  //
  // ⚠️ 次数取 `config.max_iterations`（运行时也是这么算的：`FlowInterpreter` 的
  // `config.max_iterations ?? DEFAULT`）。旧实现把它只当**上限**，真正的次数去读
  // `count` 端口 —— 而 loop 节点**没有 count 这个端口**，`resolveDataInput` 返回 null，
  // `Number(null)` = 0，于是快照里**每个 times 循环都渲染成「0 次」**（假信息）。
  const rawMaxIter = Number(node.data.config.max_iterations);
  const maxIterations = Number.isFinite(rawMaxIter) && rawMaxIter > 0 ? Math.floor(rawMaxIter) : 1000;
  const countExpr = resolveDataInput(node, 'count', ctx.dataflow);
  const hasCountPort = !!countExpr && countExpr !== 'null' && countExpr !== 'undefined';
  code += `${ind}const ${countVar} = ${
    hasCountPort ? `Math.min(Math.floor(Number(${countExpr})), ${maxIterations})` : String(maxIterations)
  };\n`;
  code += `${ind}for (let ${indexVar} = 0; ${indexVar} < ${countVar}; ${indexVar}++) {\n`;

  if (bodyNext) {
    code += generateBlock(bodyNext, graph, ctx, indent + 1, debugMode, visited);
  } else {
    code += `${indBody}// no-op\n`;
  }
  code += `${ind}}\n`;

  return code;
}

/**
 * end_node 流程结束节点代码生成。
 */
export function emitEndNode(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);

  if (!ctx.isSubflowChain) {
    return `${ind}// 流程结束 (end_node)\n`;
  }

  const returnsStr = (node.data.config.returns as string) ?? '[]';
  let entries: Array<{ field?: unknown; source?: unknown }> = [];
  try {
    const parsed = JSON.parse(returnsStr);
    if (Array.isArray(parsed)) {
      entries = parsed.filter(
        (e): e is { field?: unknown; source?: unknown } => typeof e === 'object' && e !== null,
      );
    }
  } catch {
    ctx.errors.push(`end_node ${node.id} 的 returns 配置不是合法 JSON: ${returnsStr}`);
    return `${ind}return {}  // returns 配置解析失败\n`;
  }

  if (entries.length === 0) {
    return `${ind}return {}  // 子流程结束 (end_node, 无返回值)\n`;
  }

  const pairs: string[] = [];
  for (const entry of entries) {
    const rawField = String(entry.field ?? '').trim();
    if (!rawField) {
      ctx.errors.push(`end_node ${node.id} 的 returns 中存在空 field`);
      continue;
    }
    const field = rawField.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
    if (!field) {
      ctx.errors.push(`end_node ${node.id} 的 returns field "${rawField}" 不是合法标识符`);
      continue;
    }

    const sourceStr = String(entry.source ?? '').trim();
    if (!sourceStr) {
      ctx.errors.push(`end_node ${node.id} 的 returns field "${rawField}" 缺少 source`);
      pairs.push(`${field}: undefined  // source 缺失`);
      continue;
    }

    const colonIdx = sourceStr.lastIndexOf(':');
    if (colonIdx <= 0) {
      ctx.errors.push(`end_node ${node.id} 的 returns field "${rawField}" 的 source "${sourceStr}" 格式错误（应为 nodeId:portId）`);
      pairs.push(`${field}: undefined  // source 格式错误`);
      continue;
    }

    const varKey = sourceStr;
    const varName = ctx.dataflow.variables.get(varKey);
    if (!varName) {
      ctx.errors.push(`end_node ${node.id} 的 returns field "${rawField}" 引用的变量 ${varKey} 不存在`);
      pairs.push(`${field}: undefined  // 变量未定义: ${varKey}`);
      continue;
    }

    pairs.push(`${field}: ${varName}`);
  }

  return `${ind}return { ${pairs.join(', ')} }  // 子流程结束 (end_node)\n`;
}

export function emitLoopControl(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const fcMode = (node.data.config.mode as string) ?? 'break';
  if (fcMode === 'return') {
    const valueExpr = resolveDataInput(node, 'value', ctx.dataflow);
    return `${ind}return ${valueExpr}\n`;
  }
  return `${ind}break\n`;
}