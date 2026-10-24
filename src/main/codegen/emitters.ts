// src/main/codegen/emitters.ts
// 代码生成器 - Node 节点发射器 (TypeScript 版本)
// 生成基于 Router + Middleware + Hook 的 TypeScript 机器人代码

import type { FlowNode } from '@shared/types/flow';
import type { ImportCollector } from './typescriptUtils';
import { indentStr, tsLiteral } from './typescriptUtils';
import { DataflowContext, resolveDataInput, assignOutputVariables } from './dataflow';
import { getNodeEmitterRegistry } from './nodeRegistry';
import { findPluginNode } from '../services/plugins/pluginLoader';

/** TypeScript 标识符合法性校验 */
export function isValidTSIdentifier(value: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value);
}

/** 生成上下文 */
export interface EmitContext {
  dataflow: DataflowContext;
  imports: ImportCollector;
  customCalls: Set<string>;
  matcherVar: string;
  traceVar: string;
  errors: string[];
  graph?: unknown;
  isSubflowChain?: boolean;
  /** 可用变量名列表（用于表达式编译） */
  availableVars?: string[];
}

/**
 * 保证节点代码块以换行结束。
 *
 * 修复：多数 emitter 返回的字符串没有尾随换行，导致 generateBlock 拼接下一个节点
 * 时语句粘在同一行（如 `sendMessage("x")    if (cond) {`），生成结果不再是合法 TS，
 * 行首锚定的断言/可读性也全部失效。这里作为唯一收口点统一补齐。
 */
function block(code: string): string {
  return code.endsWith('\n') ? code : `${code}\n`;
}

/** 发射节点代码 */
export function emitNode(node: FlowNode, ctx: EmitContext, indent: number): string {
  const kind = node.data?.nodeKind;
  if (!kind) {
    return block(`${indentStr(indent)}// 节点 ${node.id} 缺少 nodeKind`);
  }

  // 1. 特殊节点处理
  if (kind === 'subflow_call') {
    return block(emitSubflowCall(node, ctx, indent));
  }

  // 2. 查找发射器
  const registry = getNodeEmitterRegistry();
  const spec = registry.find(kind);

  if (spec) {
    // 内置节点
    if (spec.emit) {
      // 关键：自定义发射器不会自己登记输出端口变量，必须在这里分配，
      // 否则下游的 resolveDataInput 取不到上游变量、variable_set 的
      // `ctx.flowVars[...]` 注入与子流程 end_node 的 return 都会拿到 undefined。
      // 注意：只能在此分支调用 —— emitBuiltinCall / emitCustomNode 内部已自行分配，
      // 重复调用会向 availableVarNames 推入重复项。
      assignOutputVariables(node, ctx.dataflow);
      return block(spec.emit(node, ctx, indent));
    }
    // 默认发射器：调用 handler（内部会分配输出变量）
    return block(emitBuiltinCall(node, ctx, indent, spec.handlerModule, spec.importPath));
  }

  // 2. 自定义节点
  if (kind?.startsWith('custom_')) {
    return block(emitCustomNode(node, ctx, indent));
  }

  // 3. 插件节点
  if (kind?.startsWith('plugin_')) {
    return block(emitPluginNode(node, ctx, indent));
  }

  // 4. AI 生成节点
  if (kind?.startsWith('ai_generated_')) {
    // AI 生成节点由 aiGeneratedScanner 注册为内置 emitter；走到这里说明未注册，
    // 按内置 handler 约定发起调用（与 emitterV2 的 Python 版行为一致）。
    return block(emitBuiltinCall(node, ctx, indent, kind));
  }

  // 5. 未知节点类型
  ctx.errors?.push(`未知节点类型: ${kind} (节点 ${node.id})`);
  return block(`${indentStr(indent)}// 未知节点类型: ${kind}`);
}

/** 生成内置节点调用 */
function emitBuiltinCall(
  node: FlowNode,
  ctx: EmitContext,
  indent: number,
  handlerModule: string,
  importPath?: string
): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  // handlerModule 形如 'message_send'（registry 里的 handlerModule）或已是函数名。
  const handlerName = handlerModule.replace(/^handler_/, '');

  // 添加 import
  if (importPath) {
    ctx.imports.add(`import { ${handlerName} } from '${importPath}';`);
  }

  // 生成参数
  const args: string[] = ['ctx'];
  for (const input of node.data?.inputs?.filter((p) => p.kind === 'data') || []) {
    const value = resolveDataInput(node, input.id, ctx.dataflow);
    args.push(`${input.id}=${value}`);
  }

  const outVars = assignOutputVariables(node, ctx.dataflow);
  const firstOut = Object.values(outVars)[0];

  if (firstOut) {
    const isErrorPort = firstOut === 'error';
    return (
      `${ind}// 节点: ${node.data?.label} (${node.id})\n` +
      `${ind}try {\n` +
      `${indBody}${firstOut} = await ${handlerName}(${args.join(', ')})\n` +
      `${ind}} catch (_e) {\n` +
      `${indBody}${firstOut} = ${isErrorPort ? 'String(_e)' : 'null'}\n` +
      `${indBody}ctx.hooks.emit('onNodeError', { nodeId: ${tsLiteral(node.id)}, error: _e });\n` +
      `${ind}}`
    );
  }

  return (
    `${ind}// 节点: ${node.data?.label} (${node.id})\n` +
    `${ind}try {\n` +
    `${indBody}await ${handlerName}(${args.join(', ')})\n` +
    `${ind}} catch (_e) {\n` +
    `${indBody}ctx.hooks.emit('onNodeError', { nodeId: ${tsLiteral(node.id)}, error: _e });\n` +
    `${ind}}`
  );
}

/** 生成自定义节点调用 */
function emitCustomNode(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const funcName = node.data?.nodeKind?.replace('custom_', '') || 'unknown';
  
  if (!isValidTSIdentifier(funcName)) {
    return `${ind}// 非法自定义节点: ${node.data?.nodeKind}\n`;
  }
  ctx.customCalls.add(funcName);

  const args: string[] = ['ctx'];
  for (const input of node.data?.inputs?.filter((p) => p.kind === 'data') || []) {
    const value = resolveDataInput(node, input.id, ctx.dataflow);
    args.push(`${input.id}=${value}`);
  }

  const outVars = assignOutputVariables(node, ctx.dataflow);
  const firstOut = Object.values(outVars)[0];

  const callLine = `await ${funcName}(${args.join(', ')})`;

  if (firstOut) {
    return (
      `${ind}// 节点: ${node.data?.label} (${node.id})\n` +
      `${ind}try {\n` +
      `${indBody}${firstOut} = ${callLine}\n` +
      `${ind}} catch (_e) {\n` +
      `${indBody}${firstOut} = ${firstOut === 'error' ? 'String(_e)' : 'null'}\n` +
      `${indBody}ctx.hooks.emit('onNodeError', { nodeId: ${tsLiteral(node.id)}, error: _e });\n` +
      `${ind}}`
    );
  }
  return (
    `${ind}// 节点: ${node.data?.label} (${node.id})\n` +
    `${ind}try {\n` +
    `${indBody}${callLine}\n` +
    `${ind}} catch (_e) {\n` +
    `${indBody}ctx.hooks.emit('onNodeError', { nodeId: ${tsLiteral(node.id)}, error: _e });\n` +
    `${ind}}`
  );
}

/** 生成插件节点调用 */
function emitPluginNode(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  
  let pluginName = '';
  let rawKind = '';
  try {
    const found = findPluginNode(node.data?.nodeKind);
    if (found) {
      pluginName = found.pluginName;
      rawKind = found.nodeKind;
    }
  } catch {
    // ignore
  }
  if (!pluginName) {
    const rest = node.data?.nodeKind?.startsWith('plugin_')
      ? node.data.nodeKind.slice('plugin_'.length)
      : node.data?.nodeKind || '';
    const firstUnderscore = rest.indexOf('_');
    if (firstUnderscore <= 0) {
      // 修复：旧实现只输出注释、不记录错误，插件节点配置错误会被静默吞掉
      ctx.errors?.push(`无效的插件节点: ${node.data?.nodeKind} (节点 ${node.id})`);
      return `${ind}// 未知插件节点: ${node.data?.nodeKind}\n`;
    }
    pluginName = rest.slice(0, firstUnderscore);
    rawKind = rest.slice(firstUnderscore + 1);
    if (!rawKind) {
      ctx.errors?.push(`插件节点缺少 handler 名: ${node.data?.nodeKind} (节点 ${node.id})`);
      return `${ind}// 插件节点 kind 为空: ${node.data?.nodeKind}\n`;
    }
  }

  if (!isValidTSIdentifier(pluginName) || !isValidTSIdentifier(rawKind)) {
    ctx.errors?.push(
      `非法插件节点标识: pluginName=${pluginName} handler=${rawKind} (节点 ${node.id})`,
    );
    return `${ind}// 非法插件名: ${pluginName} 或 handler: ${rawKind}\n`;
  }

  const handlerName = `handler_${rawKind}`;

  const args: string[] = ['ctx'];
  for (const input of (node.data?.inputs?.filter((p) => p.kind === 'data') || [])) {
    const value = resolveDataInput(node, input.id, ctx.dataflow);
    args.push(`${input.id}=${value}`);
  }

  const outVars = assignOutputVariables(node, ctx.dataflow);
  const firstOut = Object.values(outVars)[0];

  if (firstOut) {
    return (
      `${ind}// 节点: ${node.data?.label} (${node.id})\n` +
      `${ind}try {\n` +
      `${indBody}${firstOut} = await ${handlerName}(${args.join(', ')})\n` +
      `${ind}} catch (_e) {\n` +
      `${indBody}${firstOut} = ${firstOut === 'error' ? 'String(_e)' : 'null'}\n` +
      `${indBody}ctx.hooks.emit('onNodeError', { nodeId: ${tsLiteral(node.id)}, error: _e });\n` +
      `${ind}}`
    );
  }
  return (
    `${ind}// 节点: ${node.data?.label} (${node.id})\n` +
    `${ind}try {\n` +
    `${indBody}await ${handlerName}(${args.join(', ')})\n` +
    `${ind}} catch (_e) {\n` +
    `${indBody}ctx.hooks.emit('onNodeError', { nodeId: ${tsLiteral(node.id)}, error: _e });\n` +
    `${ind}}`
  );
}

function emitSubflowCall(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const subflowId = node.data?.config?.subflow_id as string | undefined;

  if (!subflowId) {
    ctx.errors?.push(`subflow_call 节点 ${node.id} 缺少 subflow_id 配置`);
    return `${ind}// subflow_call 缺少 subflow_id\n`;
  }

  // 与 emitterV2 / handlerRegistry.subflow_call 的调用约定保持一致
  const args: string[] = ['ctx', tsLiteral(subflowId)];
  for (const input of node.data?.inputs?.filter((p) => p.kind === 'data') || []) {
    if (input.id === 'in' || input.id === 'next') continue;
    args.push(resolveDataInput(node, input.id, ctx.dataflow));
  }

  return (
    `${ind}// 调用子流程: ${subflowId}\n` +
    `${ind}await subflowCall(${args.join(', ')});`
  );
}

// 重新导出
// 注意：类型必须用 `export type`，否则打包器（rolldown/rollup）会把类型名当成
// 运行时导出解析，报 MISSING_EXPORT 并中断构建。
export { indentStr, tsLiteral, tsIdentifier } from './typescriptUtils';
export { compileExpression } from './expressionCompiler';
export type { CompiledExpression } from './expressionCompiler';
export { getNodeEmitterRegistry } from './nodeRegistry';
export type { NodeEmitterSpec } from './nodeRegistry';
export { resolveDataInput, assignOutputVariables, generateVariableDestructuring } from './dataflow';
export type { DataflowContext, VariableScope, VariableInfo } from './dataflow';